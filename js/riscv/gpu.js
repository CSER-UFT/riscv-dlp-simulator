/**
 * GPU didática (SIMT): o programa é um kernel RISC-V executado por todas as threads, agrupadas em warps.
 *
 * O kernel é lançado em uma grade de `blocks` blocos, cada um com `warps` warps de `warpSize` threads.
 *
 * Instruções próprias:
 *   gpu.tid rd     índice global da thread (bloco × threads por bloco + índice no bloco)
 *   gpu.ntid rd    número total de threads da grade
 *   gpu.bid rd     índice do bloco
 *   gpu.nbid rd    número de blocos
 *   gpu.btid rd    índice da thread dentro do bloco
 *   gpu.bdim rd    threads por bloco
 *   gpu.wid rd     índice do warp dentro do bloco
 *   gpu.lane rd    índice da thread dentro do warp
 *   gpu.bar        barreira: o warp espera todos os warps do seu bloco chegarem
 * Uma thread termina em ecall/ebreak ou ao passar do fim do código.
 *
 * Memória compartilhada: os endereços da seção .shared (a partir de SHARED_BASE) pertencem a cada bloco;
 * threads de blocos diferentes veem cópias diferentes, que começam zeradas.
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
import { TEXT_BASE, STACK_TOP, SHARED_BASE, SHARED_MAX } from './parser.js';
import * as memory from './memory.js';
import { t } from '../i18n/index.js';

export const DEFAULT_GPU = {
    warps: 4, warpSize: 8, lanes: 8, scheduler: 'rr', memLatency: 20, lineBytes: 32,
    blocks: 1, maxWarps: 8, smemBytes: 1024, smemBanks: 8, smemLatency: 2,
    l1: false, l1Bytes: 256, l1Ways: 2, l1Latency: 4,
};
/** Limite de threads da grade (pilhas separadas de 256 bytes abaixo de STACK_TOP). */
export const MAX_THREADS = 1024;
export const SCHEDULERS = ['rr', 'gto'];

export class GpuError extends Error { }

export function registerGpu(def) {
    const G = (name, props) => def(name, { fmt: 'V', gpu: true, masked: false, cls: 'alu', ...props });
    G('gpu.tid', { kind: 'tid', rd: 'x', vops: ['rd'] });
    G('gpu.ntid', { kind: 'ntid', rd: 'x', vops: ['rd'] });
    G('gpu.bid', { kind: 'bid', rd: 'x', vops: ['rd'] });
    G('gpu.nbid', { kind: 'nbid', rd: 'x', vops: ['rd'] });
    G('gpu.btid', { kind: 'btid', rd: 'x', vops: ['rd'] });
    G('gpu.bdim', { kind: 'bdim', rd: 'x', vops: ['rd'] });
    G('gpu.wid', { kind: 'wid', rd: 'x', vops: ['rd'] });
    G('gpu.lane', { kind: 'lane', rd: 'x', vops: ['rd'] });
    G('gpu.bar', { kind: 'bar', cls: 'system', vops: [] });
}

/** Espaço de pilha de cada thread (bytes). */
export const STACK_PER_THREAD = 256;

/** Threads por bloco e total da grade. */
export const threadsPerBlock = (gc) => gc.warps * gc.warpSize;
export const totalThreads = (gc) => gc.blocks * gc.warps * gc.warpSize;

/** É um endereço da memória compartilhada? */
export const isShared = (addr) => addr >= BigInt(SHARED_BASE) && addr < BigInt(SHARED_BASE + SHARED_MAX);

/** Memória compartilhada de um bloco: o conteúdo e o tamanho declarado na seção .shared. */
export const createShared = (program) => ({ map: new Map(), size: program.shared?.size ?? 0 });

/** Estado inicial de todas as threads da grade: registradores próprios (sp separado) e memória global. */
export function initialThreads(program, gc, { exampleValues = true } = {}) {
    const base = initialState(program, { exampleValues });
    const n = totalThreads(gc);
    const threads = Array.from({ length: n }, (_, tid) => {
        const x = [...base.x];
        x[2] = BigInt(STACK_TOP - tid * STACK_PER_THREAD);
        return { x, f: [...base.f], done: false };
    });
    return { threads, mem: base.mem };
}

/** Escolhe a memória (global ou compartilhada do bloco) de um acesso e confere os limites da compartilhada. */
function memFor(mem, smem, addr, size, inst) {
    if (!isShared(addr)) return mem;
    if (!smem) return mem;
    const off = Number(addr - BigInt(SHARED_BASE));
    if (off + size > smem.size) gpuFail('gpu.sharedRange', { inst: inst.text, addr: `0x${addr.toString(16)}`, size: smem.size });
    return smem.map;
}

/**
 * Executa uma instrução em uma thread (registradores próprios, memória global e compartilhada do bloco).
 * @param {{map: Map, size: number}|null} smem memória compartilhada do bloco da thread
 * @returns {{next: number, value: *|null, kind: string, addr?: bigint, size?: number, shared?: boolean}}
 */
export function execThread(th, mem, inst, tid, gc, xlen, smem = null) {
    const d = inst.def;
    const a = readReg(th, inst.rs1), b = readReg(th, inst.rs2), c = readReg(th, inst.rs3);
    const out = { next: inst.pc + 4, value: null, kind: 'op' };
    if (d.gpu) {
        if (d.kind === 'bar') { out.kind = 'bar'; return out; }
        const tpb = threadsPerBlock(gc);
        const btid = tid % tpb;
        const v = {
            tid, ntid: totalThreads(gc), bid: Math.floor(tid / tpb), nbid: gc.blocks, btid, bdim: tpb,
            wid: Math.floor(btid / gc.warpSize), lane: tid % gc.warpSize,
        }[d.kind];
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
            out.value = memory.load(memFor(mem, smem, addr, d.mem.size, inst), addr, d.mem, xlen);
            out.shared = smem !== null && isShared(addr);
            out.kind = 'load';
            out.addr = addr;
            out.size = d.mem.size;
            writeReg(th, inst.rd, out.value);
            return out;
        }
        case 'store': {
            const addr = effectiveAddress(inst, a, xlen);
            memory.store(memFor(mem, smem, addr, d.mem.size, inst), addr, d.mem, b);
            out.shared = smem !== null && isShared(addr);
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
 * Simulador funcional de referência: executa os blocos um depois do outro e, dentro de cada bloco, cada
 * thread em sequência até a próxima barreira (ou o fim), fase a fase.
 */
export function runGpuReference(program, gc, { exampleValues = true, maxInstructions = 400000 } = {}) {
    const xlen = program.xlen;
    const { threads, mem } = initialThreads(program, gc, { exampleValues });
    const pcs = threads.map(() => TEXT_BASE);
    const tpb = threadsPerBlock(gc);
    let executed = 0;
    let error = null;
    try {
        for (let blk = 0; blk < gc.blocks; blk++) {
            const smem = createShared(program);
            const mine = threads.slice(blk * tpb, (blk + 1) * tpb);
            for (;;) {
                let any = false;
                for (let k = 0; k < mine.length; k++) {
                    const tid = blk * tpb + k;
                    const th = mine[k];
                    while (!th.done) {
                        const i = indexAt(program, pcs[tid]);
                        if (i < 0) { th.done = true; break; }
                        if (executed >= maxInstructions) return { threads, mem, executed, reason: 'limite de instruções' };
                        const inst = program.instructions[i];
                        const r = execThread(th, mem, inst, tid, gc, xlen, smem);
                        executed++;
                        if (r.kind === 'exit') { th.done = true; break; }
                        pcs[tid] = r.next;
                        if (r.kind === 'bar') { any = true; break; }
                    }
                }
                if (!any || mine.every((th) => th.done)) break;
            }
        }
    } catch (e) {
        if (!(e instanceof GpuError)) throw e;
        error = e.message;
    }
    return { threads, mem, executed, reason: error ?? 'fim do código', error };
}

export const gpuFail = (key, params) => { throw new GpuError(t(key, params)); };
