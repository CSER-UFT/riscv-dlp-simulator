/**
 * GPU didática (SIMT): o programa é um kernel RISC-V executado por todas as threads, agrupadas em warps.
 *
 * Instruções próprias:
 *   gpu.tid rd     índice global da thread (warp × tamanho do warp + lane)
 *   gpu.ntid rd    número total de threads
 *   gpu.wid rd     índice do warp
 *   gpu.lane rd    índice da thread dentro do warp
 *   gpu.bar        barreira: o warp espera todos os warps chegarem
 * Uma thread termina em ecall/ebreak ou ao passar do fim do código.
 *
 * Divergência: quando as threads ativas de um warp seguem caminhos diferentes em um desvio, o warp executa
 * os dois caminhos em sequência, com máscaras complementares, e as threads voltam a se juntar no pós
 * dominador imediato do desvio (pilha SIMT de reconvergência).
 *
 * Este módulo também contém o simulador funcional de referência da GPU, que executa cada thread em sequência
 * (fase a fase, entre barreiras). Para programas sem condição de corrida, o estado final é o mesmo de
 * qualquer escalonamento dos warps.
 */
import { initialState, readReg, writeReg, effectiveAddress, indexAt, resolveControl } from './machine.js';
import { TEXT_BASE, STACK_TOP } from './parser.js';
import * as memory from './memory.js';
import { t } from '../i18n/index.js';

export const DEFAULT_GPU = { warps: 4, warpSize: 8, lanes: 8, scheduler: 'rr', memLatency: 20, lineBytes: 32 };
export const SCHEDULERS = ['rr', 'gto'];

export class GpuError extends Error { }

export function registerGpu(def) {
    const G = (name, props) => def(name, { fmt: 'V', gpu: true, masked: false, cls: 'alu', ...props });
    G('gpu.tid', { kind: 'tid', rd: 'x', vops: ['rd'] });
    G('gpu.ntid', { kind: 'ntid', rd: 'x', vops: ['rd'] });
    G('gpu.wid', { kind: 'wid', rd: 'x', vops: ['rd'] });
    G('gpu.lane', { kind: 'lane', rd: 'x', vops: ['rd'] });
    G('gpu.bar', { kind: 'bar', cls: 'system', vops: [] });
}

/** Espaço de pilha de cada thread (bytes). */
export const STACK_PER_THREAD = 256;

/** Estado inicial de todas as threads: registradores próprios (sp separado) e memória compartilhada. */
export function initialThreads(program, gc, { exampleValues = true } = {}) {
    const base = initialState(program, { exampleValues });
    const n = gc.warps * gc.warpSize;
    const threads = Array.from({ length: n }, (_, tid) => {
        const x = [...base.x];
        x[2] = BigInt(STACK_TOP - tid * STACK_PER_THREAD);
        return { x, f: [...base.f], done: false };
    });
    return { threads, mem: base.mem };
}

/**
 * Executa uma instrução em uma thread (registradores próprios, memória compartilhada).
 * @returns {{next: number, value: *|null, kind: string, addr?: bigint, size?: number, raw?: bigint}}
 */
export function execThread(th, mem, inst, tid, gc, xlen) {
    const d = inst.def;
    const a = readReg(th, inst.rs1), b = readReg(th, inst.rs2), c = readReg(th, inst.rs3);
    const out = { next: inst.pc + 4, value: null, kind: 'op' };
    if (d.gpu) {
        if (d.kind === 'bar') { out.kind = 'bar'; return out; }
        const v = { tid, ntid: gc.warps * gc.warpSize, wid: Math.floor(tid / gc.warpSize), lane: tid % gc.warpSize }[d.kind];
        out.value = BigInt(v);
        writeReg(th, inst.rd, out.value);
        return out;
    }
    switch (d.cls) {
        case 'system':
            out.kind = 'exit';
            return out;
        case 'load': {
            const addr = effectiveAddress(inst, a, xlen);
            out.value = memory.load(mem, addr, d.mem, xlen);
            out.kind = 'load';
            out.addr = addr;
            out.size = d.mem.size;
            writeReg(th, inst.rd, out.value);
            return out;
        }
        case 'store': {
            const addr = effectiveAddress(inst, a, xlen);
            memory.store(mem, addr, d.mem, b);
            out.kind = 'store';
            out.addr = addr;
            out.size = d.mem.size;
            return out;
        }
        case 'branch': case 'jump': {
            const r = resolveControl(inst, a, b, xlen);
            if (r.value !== null) writeReg(th, inst.rd, r.value);
            out.value = r.value;
            out.next = r.next;
            out.kind = 'control';
            return out;
        }
        default:
            out.value = d.exec(a, b, inst, xlen, c);
            writeReg(th, inst.rd, out.value);
            return out;
    }
}

/**
 * Pós dominador imediato de cada instrução (índice), ou -1 se for a saída do programa.
 * Chamadas (jal com destino diferente de x0) são tratadas como instruções que seguem para a próxima;
 * jalr, ecall e ebreak vão para a saída.
 */
export function immediatePostDominators(program) {
    const n = program.instructions.length;
    const EXIT = n;
    const succ = program.instructions.map((inst, i) => {
        const at = (pc) => { const k = indexAt(program, pc); return k < 0 ? EXIT : k; };
        const next = i + 1 < n ? i + 1 : EXIT;
        const cls = inst.def.cls;
        if (cls === 'branch') return [...new Set([next, at(inst.target)])];
        if (inst.name === 'jal') return inst.rd === 'x0' ? [at(inst.target)] : [next];
        if (inst.name === 'jalr' || cls === 'system' && !inst.def.gpu) return [EXIT];
        return [next];
    });
    const all = new Set(Array.from({ length: n + 1 }, (_, i) => i));
    const pdom = Array.from({ length: n + 1 }, (_, i) => (i === EXIT ? new Set([EXIT]) : new Set(all)));
    let changed = true;
    while (changed) {
        changed = false;
        for (let i = n - 1; i >= 0; i--) {
            let inter = null;
            for (const s of succ[i]) {
                if (inter === null) inter = new Set(pdom[s]);
                else for (const x of inter) if (!pdom[s].has(x)) inter.delete(x);
            }
            inter.add(i);
            if (inter.size !== pdom[i].size) {
                pdom[i] = inter;
                changed = true;
            }
        }
    }
    return Array.from({ length: n }, (_, i) => {
        const strict = [...pdom[i]].filter((x) => x !== i);
        // O imediato é o pós dominador estrito cujo conjunto de pós dominadores é o dos demais.
        const ip = strict.find((d) => pdom[d].size === strict.length);
        return ip === undefined || ip === EXIT ? -1 : ip;
    });
}

/**
 * Simulador funcional de referência: executa cada thread em sequência até a próxima barreira (ou o fim),
 * fase a fase.
 */
export function runGpuReference(program, gc, { exampleValues = true, maxInstructions = 400000 } = {}) {
    const xlen = program.xlen;
    const { threads, mem } = initialThreads(program, gc, { exampleValues });
    const pcs = threads.map(() => TEXT_BASE);
    let executed = 0;
    let reason = 'fim do código';
    for (;;) {
        let any = false;
        for (let tid = 0; tid < threads.length; tid++) {
            const th = threads[tid];
            while (!th.done) {
                const i = indexAt(program, pcs[tid]);
                if (i < 0) { th.done = true; break; }
                if (executed >= maxInstructions) return { threads, mem, executed, reason: 'limite de instruções' };
                const inst = program.instructions[i];
                const r = execThread(th, mem, inst, tid, gc, xlen);
                executed++;
                if (r.kind === 'exit') { th.done = true; break; }
                pcs[tid] = r.next;
                if (r.kind === 'bar') { any = true; break; }
            }
        }
        if (!any) break;
        if (threads.every((th) => th.done)) break;
    }
    return { threads, mem, executed, reason };
}

export const gpuFail = (key, params) => { throw new GpuError(t(key, params)); };
