/**
 * GPU didática: um multiprocessador (SM) que executa o kernel em warps de threads (SIMT).
 *
 * Modelo temporal:
 *   a cada ciclo o escalonador escolhe um warp pronto e emite a próxima instrução dele, para todas as
 *   threads ativas ao mesmo tempo (uma instrução de warp por ciclo no SM);
 *   um warp está pronto se não terminou, não está em uma barreira, não espera a resolução de um desvio,
 *   os registradores lidos e escrito não têm escrita pendente (scoreboard por warp) e a unidade da instrução
 *   está livre;
 *   escalonadores: rodízio (rr: começa pelo warp seguinte ao último emitido) ou guloso (gto: repete o mesmo
 *   warp enquanto ele estiver pronto; senão, o mais antigo, de menor índice);
 *   unidades ALU (inteiros, desvios e instruções da GPU), FPU (ponto flutuante, multiplicação e divisão
 *   inteira) e LSU (loads e stores), cada uma com `lanes` vias: um warp ocupa a unidade por
 *   ceil(tamanho do warp ÷ lanes) ciclos;
 *   loads e stores juntam (coalescem) os acessos das threads em transações de `lineBytes` bytes; a LSU
 *   envia uma transação por ciclo, e cada uma leva a latência da memória;
 *   divergência: pilha SIMT por warp, com reconvergência no pós dominador imediato do desvio.
 *
 * Os valores são calculados quando a instrução é emitida; os registradores e a memória exibidos mudam no
 * ciclo em que o resultado é escrito.
 */
import * as memory from '../riscv/memory.js';
import { f32ToBits, f64ToBits } from '../riscv/bits.js';
import { writeReg, indexAt } from '../riscv/machine.js';
import { TEXT_BASE } from '../riscv/parser.js';
import { initialThreads, execThread, immediatePostDominators, GpuError, gpuFail } from '../riscv/gpu.js';
import * as fmt from '../riscv/format.js';
import { t } from '../i18n/index.js';
import { normalizeConfig, checkProgram } from '../core/config.js';
import { Recorder } from '../core/recorder.js';
import { SCALAR_LAT } from './host.js';

export const GPU_UNITS = ['ALU', 'FPU', 'LSU'];
const UNIT_OF = { load: 2, store: 2, fadd: 1, fmul: 1, fdiv: 1, mul: 1, div: 1 };

export function simulateGpu(program, userConfig = {}) {
    const { config: cfg, errors } = normalizeConfig({ ...userConfig, xlen: program.xlen });
    if (errors.length > 0) return { errors };
    const wrong = checkProgram(program, cfg);
    if (wrong.length > 0) return { errors: wrong };

    const xlen = program.xlen;
    const gc = cfg.gpu;
    const WS = gc.warpSize;
    const G = Math.ceil(WS / gc.lanes);
    const { threads, mem: funMem } = initialThreads(program, gc, { exampleValues: cfg.exampleValues });
    const ipdom = immediatePostDominators(program);
    const pcOf = (k) => (k < 0 ? -1 : program.instructions[k].pc);

    const warps = Array.from({ length: gc.warps }, (_, id) => ({
        id,
        stack: [{ pc: TEXT_BASE, rpc: -1, mask: new Array(WS).fill(true) }],
        done: false,
        atBar: false,
        ready: 1,
        sb: new Map(),
        sbWho: new Map(),
        waitBranch: false,
    }));

    // Estado exibido ------------------------------------------------------------------------------------------
    const S = {
        cycle: 0,
        threads: threads.map((th) => ({ x: [...th.x], f: [...th.f] })),
        mem: new Map(funMem),
        warps: [],
        issued: null,
        units: [],
        lastMem: null,
        written: {},
        halted: false,
    };

    const dyn = [];
    const active = [];
    const unitFree = GPU_UNITS.map(() => 1);
    let last = -1;
    const warnings = [];
    const stats = {
        instructions: 0, threadInstructions: 0, memInstructions: 0, transactions: 0, divergent: 0, branches: 0,
        idle: 0, waitDep: 0, waitUnit: 0, waitBranch: 0, waitBar: 0, barriers: 0,
        unitBusy: GPU_UNITS.map(() => 0),
    };

    const rec = new Recorder(userConfig.trace !== false, () => ({
        cycle: S.cycle, threads: S.threads, warps: S.warps, issued: S.issued, units: S.units, lastMem: S.lastMem,
        written: S.written, halted: S.halted,
    }), () => S.mem);
    const step = (msg, focus = []) => rec.step(msg, focus);
    const B = (x) => `**${x}**`;

    const top = (w) => w.stack[w.stack.length - 1];
    const live = (w, mask) => mask.map((m, lane) => m && !threads[w.id * WS + lane].done);
    const maskText = (mask) => mask.map((m) => (m ? '1' : '0')).join('');

    /** Remove entradas vazias e as que chegaram ao ponto de reconvergência. */
    function settle(w) {
        for (;;) {
            const e = top(w);
            if (!e) break;
            const m = live(w, e.mask);
            if (!m.some(Boolean) || (e.rpc !== -1 && e.pc === e.rpc)) {
                w.stack.pop();
                continue;
            }
            if (indexAt(program, e.pc) < 0) {
                // Passou do fim do código: as threads terminam.
                m.forEach((on, lane) => { if (on) threads[w.id * WS + lane].done = true; });
                continue;
            }
            break;
        }
        if (w.stack.length === 0) w.done = true;
    }

    function sources(inst) {
        return [inst.rs1, inst.rs2, inst.rs3].filter((r) => r && r !== 'x0');
    }

    /** Situação do warp no ciclo: pronto ou o motivo da espera. */
    function status(w, c) {
        if (w.done) return { state: 'done' };
        if (w.atBar) return { state: 'bar' };
        if (w.ready > c) return { state: w.waitBranch ? 'branch' : 'busy', until: w.ready };
        const inst = program.instructions[indexAt(program, top(w).pc)];
        for (const r of [...sources(inst), inst.rd].filter((r) => r && r !== 'x0'))
            if ((w.sb.get(r) ?? 0) > c) return { state: 'dep', reg: r, until: w.sb.get(r) };
        const u = UNIT_OF[inst.def.cls] ?? 0;
        if (unitFree[u] > c) return { state: 'unit', unit: GPU_UNITS[u], until: unitFree[u] };
        return { state: 'ready' };
    }

    function pick(pre) {
        const order = [];
        if (gc.scheduler === 'gto') {
            if (last >= 0) order.push(last);
            for (let i = 0; i < warps.length; i++) if (i !== last) order.push(i);
        } else {
            for (let k = 1; k <= warps.length; k++) order.push((last + k + warps.length) % warps.length);
        }
        return order.find((i) => pre[i].state === 'ready') ?? -1;
    }

    // Emissão ----------------------------------------------------------------------------------------------------

    function issue(w, c) {
        const e = top(w);
        const k = indexAt(program, e.pc);
        const inst = program.instructions[k];
        const mask = live(w, e.mask);
        const lanes = mask.map((m, l) => (m ? l : -1)).filter((l) => l >= 0);
        const results = new Map();
        for (const lane of lanes) {
            const tid = w.id * WS + lane;
            results.set(lane, execThread(threads[tid], funMem, inst, tid, gc, xlen));
        }
        const d = {
            id: dyn.length, index: k, pc: inst.pc, text: `w${w.id}: ${inst.text}`, vector: true, warp: w.id, mask: maskText(mask),
            issue: c, first: null, commit: null, squashed: null, mispredicted: false, marks: [],
        };
        dyn.push(d);
        stats.instructions++;
        stats.threadInstructions += lanes.length;
        const cls = inst.def.cls;
        const u = UNIT_OF[cls] ?? 0;
        let occ = G;
        let lat = cfg.latency[SCALAR_LAT[cls] ?? 'alu'];
        let txn = null;
        const msgs = [];
        if (cls === 'load' || cls === 'store') {
            const lines = new Set();
            const addrs = new Array(WS).fill(null);
            for (const lane of lanes) {
                const r = results.get(lane);
                addrs[lane] = r.addr;
                const first = r.addr / BigInt(gc.lineBytes), lastLine = (r.addr + BigInt(r.size - 1)) / BigInt(gc.lineBytes);
                for (let x = first; x <= lastLine; x++) lines.add(x);
            }
            txn = lines.size;
            occ = Math.max(G, txn);
            lat = gc.memLatency;
            stats.memInstructions++;
            stats.transactions += txn;
            S.lastMem = { dyn: d.id, addrs, lines: [...lines].sort((a, b) => (a < b ? -1 : 1)).map((x) => x * BigInt(gc.lineBytes)), k: txn };
        }
        const done = c + occ - 1 + lat - 1;
        d.first = done;
        d.commit = done;
        d.timing = { t0: c, occ, done, unit: u, warp: w.id, lanes: lanes.length };
        unitFree[u] = c + occ;
        stats.unitBusy[u] += occ;
        w.ready = c + 1;
        w.waitBranch = false;
        last = w.id;

        // Escritas pendentes (registradores das threads e memória), aplicadas no ciclo da conclusão.
        const writes = [];
        if (inst.rd && inst.rd !== 'x0' && cls !== 'store') {
            for (const lane of lanes) {
                const r = results.get(lane);
                if (r.value !== null && r.value !== undefined) writes.push({ tid: w.id * WS + lane, reg: inst.rd, value: r.value });
            }
            w.sb.set(inst.rd, done + 1);
            w.sbWho.set(inst.rd, d.id);
        }
        const stores = [];
        if (cls === 'store') {
            for (const lane of lanes) {
                const tid = w.id * WS + lane;
                const r = results.get(lane);
                const v = threads[tid][inst.rs2[0] === 'x' ? 'x' : 'f'][+inst.rs2.slice(1)];
                const raw = inst.def.mem.fp === 's' ? f32ToBits(v) : (inst.def.mem.fp === 'd' ? f64ToBits(v) : BigInt(inst.rs2 === 'x0' ? 0n : v));
                stores.push({ addr: r.addr, size: r.size, raw });
            }
        }
        active.push({ dyn: d.id, warp: w.id, unit: u, t0: c, occ, done, writes, stores, inst, txn, lanes: lanes.length });

        // Fluxo de controle: pilha SIMT.
        const kinds = new Set([...results.values()].map((r) => r.kind));
        if (kinds.has('exit')) {
            for (const lane of lanes) threads[w.id * WS + lane].done = true;
            msgs.push(t('gpu.exit', { warp: B(`w${w.id}`), n: lanes.length }));
        } else if (kinds.has('bar')) {
            e.pc = inst.pc + 4;
            w.atBar = true;
            stats.barriers++;
            msgs.push(t('gpu.barArrive', { warp: B(`w${w.id}`) }));
        } else if (cls === 'branch' || cls === 'jump') {
            w.ready = done + 1;
            w.waitBranch = true;
            if (cls === 'branch') stats.branches++;
            const groups = new Map();
            for (const lane of lanes) {
                const next = results.get(lane).next;
                if (!groups.has(next)) groups.set(next, []);
                groups.get(next).push(lane);
            }
            if (groups.size === 1) {
                e.pc = [...groups.keys()][0];
            } else if (cls === 'jump') {
                gpuFail('gpu.indirect', { inst: inst.text });
            } else {
                stats.divergent++;
                const R = pcOf(ipdom[k]);
                const takenLanes = groups.get(inst.target) ?? [];
                const notLanes = groups.get(inst.pc + 4) ?? [];
                const toMask = (ls) => { const m = new Array(WS).fill(false); for (const l of ls) m[l] = true; return m; };
                e.pc = R;
                if (R === -1) e.exitEntry = true;
                w.stack.push({ pc: inst.pc + 4, rpc: R, mask: toMask(notLanes) });
                w.stack.push({ pc: inst.target, rpc: R, mask: toMask(takenLanes) });
                msgs.push(t('gpu.diverge', {
                    warp: B(`w${w.id}`), taken: maskText(toMask(takenLanes)), not: maskText(toMask(notLanes)),
                    rpc: R === -1 ? t('gpu.atExit') : fmt.address(R),
                }));
            }
        } else {
            e.pc = inst.pc + 4;
        }
        settle(w);
        // Entrada de reconvergência na saída: as threads que chegam a ela terminam.
        while (!w.done && top(w).exitEntry) {
            const m = live(w, top(w).mask);
            m.forEach((on, lane) => { if (on) threads[w.id * WS + lane].done = true; });
            settle(w);
        }

        const extra = txn !== null ? ' ' + t('gpu.coalesce', { k: txn, lines: txn === 1 ? t('gpu.oneLine') : t('gpu.nLines', { n: txn }) }) : '';
        step(t('gpu.issue', {
            warp: B(`w${w.id}`), inst: `\`${inst.text}\``, n: lanes.length, size: WS, unit: B(GPU_UNITS[u]), occ, done,
        }) + extra + (msgs.length ? ' ' + msgs.join(' ') : ''), ['sched', `warp:${w.id}`, `unit:${GPU_UNITS[u]}`, ...(txn !== null ? ['lsu'] : [])]);
        return d;
    }

    function applyWrites(op, c) {
        if (op.done !== c) return;
        const focus = [];
        const parts = [];
        if (op.writes.length) {
            for (const wr of op.writes) {
                const th = S.threads[wr.tid];
                const copy = { x: [...th.x], f: [...th.f] };
                writeReg(copy, wr.reg, wr.value);
                S.threads[wr.tid] = copy;
                (S.written[wr.tid] ??= []).push(wr.reg);
            }
            parts.push(t('gpu.writeRegs', { reg: B(op.writes[0].reg), n: op.writes.length }));
            focus.push('threads');
        }
        if (op.stores.length) {
            S.mem = new Map(S.mem);
            for (const st of op.stores) {
                memory.writeRaw(S.mem, st.addr, st.size, st.raw);
                focus.push(`mem:${st.addr}`);
            }
            parts.push(t('gpu.writeMem', { n: op.stores.length }));
        }
        if (parts.length) step(t('gpu.complete', { inst: `\`${dyn[op.dyn].text}\``, list: parts.join('; ') }), focus);
    }

    function label(op, c) {
        if (c === op.t0) return 'Issue';
        if (c < op.t0 + op.occ) return 'Exec';
        return 'Lat';
    }

    function view(c, pre) {
        S.warps = warps.map((w, i) => {
            const st = S.issued?.warp === i ? { state: 'issued' } : pre[i];
            const e = top(w);
            return {
                id: w.id, done: w.done, state: st.state, reg: st.reg ?? null, unit: st.unit ?? null, until: st.until ?? null,
                pc: e ? e.pc : null, mask: e ? live(w, e.mask) : new Array(WS).fill(false),
                stack: w.stack.map((x) => ({ pc: x.pc, rpc: x.rpc, mask: maskText(live(w, x.mask)) })),
            };
        });
        S.units = GPU_UNITS.map((name, u) => ({
            name,
            ops: active.filter((op) => op.unit === u && op.t0 <= c && op.done >= c).map((op) => ({ dyn: op.dyn, t0: op.t0, occ: op.occ, done: op.done, txn: op.txn })),
        }));
    }

    // Laço principal ---------------------------------------------------------------------------------------------

    const isDone = () => warps.every((w) => w.done) && active.length === 0;

    for (const w of warps) settle(w);
    view(0, warps.map((w) => status(w, 1)));
    rec.endCycle();
    try {
        while (!isDone()) {
            if (S.cycle >= cfg.maxCycles) {
                warnings.push(t('common.maxCycles', { n: cfg.maxCycles }));
                break;
            }
            S.cycle++;
            const c = S.cycle;
            rec.beginCycle();
            S.written = {};
            S.issued = null;
            for (const op of active) applyWrites(op, c);
            // Barreira: libera todos quando os warps que ainda executam chegaram.
            const running = warps.filter((w) => !w.done);
            if (running.length > 0 && running.every((w) => w.atBar)) {
                for (const w of running) { w.atBar = false; w.ready = Math.max(w.ready, c); }
                step(t('gpu.barRelease', { n: running.length }), ['sched']);
            }
            const pre = warps.map((w) => status(w, c));
            const i = pick(pre);
            if (i >= 0) {
                const d = issue(warps[i], c);
                S.issued = { warp: i, dyn: d.id };
                applyWrites(active[active.length - 1], c);
            } else if (!warps.every((w) => w.done)) {
                stats.idle++;
                const st = pre.filter((x) => x.state !== 'done').map((x) => x.state);
                if (st.includes('dep')) stats.waitDep++;
                else if (st.includes('unit')) stats.waitUnit++;
                else if (st.includes('branch')) stats.waitBranch++;
                else if (st.includes('bar')) stats.waitBar++;
                step(t('gpu.idle'), ['sched']);
            }
            for (const op of active) rec.mark(dyn[op.dyn], c, label(op, c));
            view(c, pre);
            for (let k = active.length - 1; k >= 0; k--) if (active[k].done <= c) active.splice(k, 1);
            rec.endCycle(t('common.endOfCycle'));
        }
    } catch (e) {
        if (!(e instanceof GpuError)) throw e;
        warnings.push(e.message);
        S.halted = true;
        step(e.message, ['sched']);
        rec.endCycle();
    }

    const cycles = S.cycle;
    return {
        errors: [],
        model: 'gpu',
        config: cfg,
        program,
        states: rec.states,
        interStates: rec.interStates,
        dyn,
        warnings,
        finished: isDone() || S.halted,
        stats: {
            ...stats, cycles, ipc: cycles > 0 ? stats.instructions / cycles : 0,
            cpi: stats.instructions > 0 ? cycles / stats.instructions : 0,
        },
        final: { threads: S.threads, mem: S.mem },
    };
}
