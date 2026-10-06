/**
 * GPU didática: um multiprocessador (SM) que executa o kernel em warps de threads (SIMT).
 *
 * Modelo temporal:
 *   o kernel é lançado em uma grade de blocos; o SM recebe ao mesmo tempo quantos blocos couberem no limite
 *   de warps residentes (maxWarps) e na memória compartilhada (smemBytes); quando um bloco termina, o
 *   próximo da grade ocupa o lugar dele no ciclo seguinte (ocupação);
 *   a cada ciclo o escalonador escolhe um warp pronto entre os residentes e emite a próxima instrução dele,
 *   para todas as threads ativas ao mesmo tempo (uma instrução de warp por ciclo no SM);
 *   um warp está pronto se não terminou, não está em uma barreira, não espera a resolução de um desvio,
 *   os registradores lidos e escrito não têm escrita pendente (scoreboard por warp) e a unidade da instrução
 *   está livre;
 *   escalonadores: rodízio (rr: começa pelo warp seguinte ao último emitido) ou guloso (gto: repete o mesmo
 *   warp enquanto ele estiver pronto; senão, o mais antigo, de menor índice);
 *   unidades ALU (inteiros, desvios e instruções da GPU), FPU (ponto flutuante, multiplicação e divisão
 *   inteira) e LSU (loads e stores), cada uma com `lanes` vias: um warp ocupa a unidade por
 *   ceil(tamanho do warp ÷ lanes) ciclos;
 *   memória global: a LSU junta (coalesce) os acessos das threads em transações de `lineBytes` bytes e envia
 *   uma por ciclo; cada uma leva a latência da memória ou, com a cache L1 ligada e a linha presente, a
 *   latência da L1 (L1 associativa por conjunto, LRU, escrita direta sem alocação nos stores);
 *   memória compartilhada (seção .shared, uma por bloco): dividida em `smemBanks` bancos de 4 bytes; acessos
 *   de threads diferentes a palavras diferentes do mesmo banco são serializados (conflito de banco), e a
 *   mesma palavra é difundida sem custo;
 *   divergência: pilha SIMT por warp, com reconvergência no pós dominador imediato do desvio.
 *
 * Os valores são calculados quando a instrução é emitida; os registradores e a memória exibidos mudam no
 * ciclo em que o resultado é escrito.
 */
import * as memory from '../riscv/memory.js';
import { f32ToBits, f64ToBits } from '../riscv/bits.js';
import { writeReg, indexAt } from '../riscv/machine.js';
import { TEXT_BASE } from '../riscv/parser.js';
import {
    initialThreads, execThread, immediatePostDominators, GpuError, gpuFail, threadsPerBlock, createShared,
} from '../riscv/gpu.js';
import * as fmt from '../riscv/format.js';
import { t } from '../i18n/index.js';
import { normalizeConfig, checkProgram } from '../core/config.js';
import { Recorder } from '../core/recorder.js';
import { SCALAR_LAT } from './host.js';

export const GPU_UNITS = ['ALU', 'FPU', 'LSU'];
const UNIT_OF = { load: 2, store: 2, fadd: 1, fmul: 1, fdiv: 1, mul: 1, div: 1 };

/** Blocos residentes ao mesmo tempo no SM (limites de warps e de memória compartilhada). */
export function residentBlocks(gc, sharedSize) {
    const byWarps = Math.floor(gc.maxWarps / gc.warps);
    const bySmem = sharedSize > 0 ? Math.floor(gc.smemBytes / sharedSize) : Infinity;
    return Math.max(1, Math.min(gc.blocks, byWarps, bySmem));
}

/** Grau de conflito de um acesso à memória compartilhada: maior número de palavras distintas em um banco. */
export function bankConflict(accesses, banks) {
    const perBank = new Map();
    const bankOf = [];
    for (const a of accesses) {
        if (!a) { bankOf.push(null); continue; }
        const lanes = [];
        for (let w = a.addr >> 2n; w <= (a.addr + BigInt(a.size - 1)) >> 2n; w++) {
            const b = Number(w % BigInt(banks));
            if (!perBank.has(b)) perBank.set(b, new Set());
            perBank.get(b).add(w);
            lanes.push(b);
        }
        bankOf.push(lanes[0]);
    }
    let degree = 1;
    for (const s of perBank.values()) degree = Math.max(degree, s.size);
    return { degree, bankOf };
}

/** Cache L1 associativa por conjunto com substituição LRU; só afeta o tempo. */
class L1Cache {
    constructor(gc) {
        this.ways = gc.l1Ways;
        this.sets = Math.max(1, gc.l1Bytes / gc.lineBytes / gc.l1Ways);
        this.lines = Array.from({ length: this.sets }, () => []);
        this.clock = 0;
    }
    find(line) {
        const set = this.lines[Number(line % BigInt(this.sets))];
        return set.find((e) => e.line === line) ?? null;
    }
    touch(e) { e.used = ++this.clock; }
    fill(line, ready) {
        const set = this.lines[Number(line % BigInt(this.sets))];
        let e = set.find((x) => x.line === line);
        if (!e) {
            if (set.length >= this.ways) {
                const victim = set.reduce((a, b) => (a.used <= b.used ? a : b));
                set.splice(set.indexOf(victim), 1);
            }
            e = { line, ready, used: 0 };
            set.push(e);
        }
        e.ready = ready;
        this.touch(e);
    }
}

export function simulateGpu(program, userConfig = {}) {
    const { config: cfg, errors } = normalizeConfig({ ...userConfig, xlen: program.xlen });
    if (errors.length > 0) return { errors };
    const wrong = checkProgram(program, cfg);
    if (wrong.length > 0) return { errors: wrong };

    const xlen = program.xlen;
    const gc = cfg.gpu;
    const WS = gc.warpSize;
    const WPB = gc.warps;
    const TPB = threadsPerBlock(gc);
    const G = Math.ceil(WS / gc.lanes);
    const shSize = program.shared?.size ?? 0;
    const maxResident = residentBlocks(gc, shSize);
    const { threads, mem: funMem } = initialThreads(program, gc, { exampleValues: cfg.exampleValues });
    const ipdom = immediatePostDominators(program);
    const pcOf = (k) => (k < 0 ? -1 : program.instructions[k].pc);
    const l1 = gc.l1 ? new L1Cache(gc) : null;

    const blocks = Array.from({ length: gc.blocks }, (_, id) => ({ id, state: 'pending', smem: null, start: null, end: null }));
    const warps = Array.from({ length: gc.blocks * WPB }, (_, id) => ({
        id,
        block: Math.floor(id / WPB),
        wib: id % WPB,
        stack: [{ pc: TEXT_BASE, rpc: -1, mask: new Array(WS).fill(true) }],
        launched: false,
        done: false,
        atBar: false,
        ready: 1,
        sb: new Map(),
        waitBranch: false,
    }));
    const resident = () => warps.filter((w) => w.launched && blocks[w.block].state === 'running');

    // Estado exibido ------------------------------------------------------------------------------------------
    // Registradores das threads agrupados por warp; cada grupo e a lista são substituídos (nunca alterados no
    // lugar) a cada escrita, para que os instantâneos os compartilhem sem cópia.
    const S = {
        cycle: 0,
        tw: warps.map((w) => threads.slice(w.id * WS, (w.id + 1) * WS).map((th) => ({ x: [...th.x], f: [...th.f] }))),
        mem: memory.PagedMemory.from(funMem),
        sm: {},
        warps: [],
        blocks: [],
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
        sharedAccesses: 0, bankConflicts: 0, maxDegree: 1, l1Hits: 0, l1Misses: 0,
        blocks: gc.blocks, maxResident, residentWarpCycles: 0,
    };

    const rec = new Recorder(userConfig.trace !== false, () => ({
        cycle: S.cycle, tw: S.tw, sm: S.sm, warps: S.warps, blocks: S.blocks, issued: S.issued, units: S.units, lastMem: S.lastMem,
        written: S.written, halted: S.halted,
    }), () => S.mem, ['tw', 'sm', 'warps', 'blocks', 'units', 'lastMem', 'issued']);
    const step = (msg, focus = []) => rec.step(msg, focus);
    const B = (x) => `**${x}**`;
    const wname = (w) => (gc.blocks > 1 ? `b${w.block}w${w.wib}` : `w${w.id}`);

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
        if (!w.launched) return { state: 'pending' };
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
        const n = warps.length;
        const order = [];
        if (gc.scheduler === 'gto') {
            if (last >= 0) order.push(last);
            for (let i = 0; i < n; i++) if (i !== last) order.push(i);
        } else {
            for (let k = 1; k <= n; k++) order.push((last + k + n) % n);
        }
        return order.find((i) => pre[i].state === 'ready') ?? -1;
    }

    // Blocos -------------------------------------------------------------------------------------------------

    function launch(b, c) {
        b.state = 'running';
        b.start = c;
        b.smem = createShared(program);
        if (S.sm[b.id]) { S.sm = { ...S.sm }; delete S.sm[b.id]; }
        for (const w of warps.slice(b.id * WPB, (b.id + 1) * WPB)) {
            w.launched = true;
            w.ready = Math.max(c, 1);
            settle(w);
        }
    }

    /** Retira os blocos que terminaram e lança os próximos da grade nos lugares livres. */
    function manageBlocks(c) {
        const retired = [], launched = [];
        for (const b of blocks) {
            if (b.state !== 'running') continue;
            if (warps.slice(b.id * WPB, (b.id + 1) * WPB).every((w) => w.done)) {
                b.state = 'done';
                b.end = c - 1;
                retired.push(b.id);
            }
        }
        let running = blocks.filter((b) => b.state === 'running').length;
        for (const b of blocks) {
            if (running >= maxResident) break;
            if (b.state !== 'pending') continue;
            launch(b, c);
            launched.push(b.id);
            running++;
        }
        return { retired, launched };
    }

    // Emissão ----------------------------------------------------------------------------------------------------

    function memTiming(w, d, inst, lanes, results, c) {
        const cls = inst.def.cls;
        const shared = lanes.map((l) => results.get(l).shared);
        if (shared.some(Boolean) && !shared.every(Boolean)) gpuFail('gpu.mixedSpaces', { inst: inst.text });
        const addrs = new Array(WS).fill(null);
        for (const lane of lanes) addrs[lane] = results.get(lane).addr;
        stats.memInstructions++;
        if (shared.length > 0 && shared[0]) {
            const acc = new Array(WS).fill(null);
            for (const lane of lanes) acc[lane] = { addr: results.get(lane).addr, size: results.get(lane).size };
            const { degree, bankOf } = bankConflict(acc, gc.smemBanks);
            stats.sharedAccesses++;
            stats.bankConflicts += degree - 1;
            stats.maxDegree = Math.max(stats.maxDegree, degree);
            const occ = Math.max(G, degree);
            S.lastMem = { kind: 'shared', dyn: d.id, addrs, banks: bankOf, degree };
            return { occ, lat: gc.smemLatency, txn: null, degree, msg: t('gpu.banks', { k: degree }) };
        }
        const lines = new Set();
        for (const lane of lanes) {
            const r = results.get(lane);
            const first = r.addr / BigInt(gc.lineBytes), lastLine = (r.addr + BigInt(r.size - 1)) / BigInt(gc.lineBytes);
            for (let x = first; x <= lastLine; x++) lines.add(x);
        }
        const sorted = [...lines].sort((a, b) => (a < b ? -1 : 1));
        const txn = sorted.length;
        const occ = Math.max(G, txn);
        stats.transactions += txn;
        let lat = gc.memLatency;
        let hits = null;
        if (l1 && cls === 'load') {
            hits = sorted.map((x) => l1.find(x));
            const end = c + occ - 1;
            if (hits.every(Boolean)) {
                lat = gc.l1Latency;
                // Linhas ainda chegando de uma falta anterior: espera os dados.
                for (const e of hits) lat = Math.max(lat, e.ready - end + 1);
            }
            hits.forEach((e) => { if (e) l1.touch(e); });
            const done = end + lat - 1;
            sorted.forEach((x, k) => { if (!hits[k]) l1.fill(x, done); });
            const nh = hits.filter(Boolean).length;
            stats.l1Hits += nh;
            stats.l1Misses += txn - nh;
            hits = hits.map(Boolean);
        }
        S.lastMem = { kind: 'global', dyn: d.id, addrs, lines: sorted.map((x) => x * BigInt(gc.lineBytes)), k: txn, hits };
        let msg = t('gpu.coalesce', { k: txn, lines: txn === 1 ? t('gpu.oneLine') : t('gpu.nLines', { n: txn }) });
        if (hits) msg += ' ' + t('gpu.l1', { h: hits.filter(Boolean).length, m: hits.filter((x) => !x).length });
        return { occ, lat, txn, msg };
    }

    function issue(w, c) {
        const e = top(w);
        const k = indexAt(program, e.pc);
        const inst = program.instructions[k];
        const mask = live(w, e.mask);
        const lanes = mask.map((m, l) => (m ? l : -1)).filter((l) => l >= 0);
        const results = new Map();
        const smem = blocks[w.block].smem;
        for (const lane of lanes) {
            const tid = w.id * WS + lane;
            results.set(lane, execThread(threads[tid], funMem, inst, tid, gc, xlen, smem));
        }
        const d = {
            id: dyn.length, index: k, pc: inst.pc, text: `${wname(w)}: ${inst.text}`, vector: true, warp: w.id, block: w.block,
            mask: maskText(mask), issue: c, first: null, commit: null, squashed: null, mispredicted: false, marks: [],
        };
        dyn.push(d);
        stats.instructions++;
        stats.threadInstructions += lanes.length;
        const cls = inst.def.cls;
        const u = UNIT_OF[cls] ?? 0;
        let occ = G;
        let lat = cfg.latency[SCALAR_LAT[cls] ?? 'alu'];
        let txn = null;
        let memMsg = '';
        let degree = null;
        const msgs = [];
        if ((cls === 'load' || cls === 'store') && lanes.length > 0) {
            const m = memTiming(w, d, inst, lanes, results, c);
            ({ occ, lat, txn } = m);
            degree = m.degree ?? null;
            memMsg = m.msg;
        }
        const done = c + occ - 1 + lat - 1;
        d.first = done;
        d.commit = done;
        d.timing = { t0: c, occ, lat, done, unit: u, warp: w.id, block: w.block, lanes: lanes.length, txn, degree };
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
                if (r.value !== null && r.value !== undefined) writes.push({ lane, reg: inst.rd, value: r.value });
            }
            w.sb.set(inst.rd, done + 1);
        }
        const stores = [];
        if (cls === 'store') {
            for (const lane of lanes) {
                const tid = w.id * WS + lane;
                const r = results.get(lane);
                const v = threads[tid][inst.rs2[0] === 'x' ? 'x' : 'f'][+inst.rs2.slice(1)];
                const raw = inst.def.mem.fp === 's' ? f32ToBits(v) : (inst.def.mem.fp === 'd' ? f64ToBits(v) : BigInt(inst.rs2 === 'x0' ? 0n : v));
                stores.push({ addr: r.addr, size: r.size, raw, block: r.shared ? w.block : null });
            }
        }
        active.push({ dyn: d.id, warp: w.id, unit: u, t0: c, occ, done, writes, stores, inst, txn, lanes: lanes.length });

        // Fluxo de controle: pilha SIMT.
        const kinds = new Set([...results.values()].map((r) => r.kind));
        if (kinds.has('exit')) {
            for (const lane of lanes) threads[w.id * WS + lane].done = true;
            msgs.push(t('gpu.exit', { warp: B(wname(w)), n: lanes.length }));
        } else if (kinds.has('bar')) {
            e.pc = inst.pc + 4;
            w.atBar = true;
            stats.barriers++;
            msgs.push(t('gpu.barArrive', { warp: B(wname(w)) }));
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
                    warp: B(wname(w)), taken: maskText(toMask(takenLanes)), not: maskText(toMask(notLanes)),
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

        step(t('gpu.issue', {
            warp: B(wname(w)), inst: `\`${inst.text}\``, n: lanes.length, size: WS, unit: B(GPU_UNITS[u]), occ, done,
        }) + (memMsg ? ' ' + memMsg : '') + (msgs.length ? ' ' + msgs.join(' ') : ''),
        ['sched', `warp:${w.id}`, `unit:${GPU_UNITS[u]}`, ...(memMsg ? ['lsu'] : [])]);
        return d;
    }

    function applyWrites(op, c) {
        if (op.done !== c) return;
        const focus = [];
        const parts = [];
        if (op.writes.length) {
            const group = S.tw[op.warp].slice();
            for (const wr of op.writes) {
                const th = group[wr.lane];
                const copy = { x: [...th.x], f: [...th.f] };
                writeReg(copy, wr.reg, wr.value);
                group[wr.lane] = copy;
                (S.written[op.warp * WS + wr.lane] ??= []).push(wr.reg);
            }
            S.tw = S.tw.slice();
            S.tw[op.warp] = group;
            parts.push(t('gpu.writeRegs', { reg: B(op.writes[0].reg), n: op.writes.length }));
            focus.push('threads');
        }
        if (op.stores.length) {
            if (op.stores[0].block !== null) {
                const b = op.stores[0].block;
                S.sm = { ...S.sm, [b]: S.sm[b] ? memory.forkMem(S.sm[b]) : new memory.PagedMemory() };
                for (const st of op.stores) memory.writeRaw(S.sm[b], st.addr, st.size, st.raw);
                focus.push('smem');
                parts.push(t('gpu.writeShared', { n: op.stores.length }));
            } else {
                S.mem = memory.forkMem(S.mem);
                for (const st of op.stores) {
                    memory.writeRaw(S.mem, st.addr, st.size, st.raw);
                    focus.push(`mem:${st.addr}`);
                }
                parts.push(t('gpu.writeMem', { n: op.stores.length }));
            }
        }
        if (parts.length) step(t('gpu.complete', { inst: `\`${dyn[op.dyn].text}\``, list: parts.join('; ') }), focus);
    }

    function label(op, c) {
        if (c === op.t0) return 'Issue';
        if (c < op.t0 + op.occ) return 'Exec';
        return 'Lat';
    }

    // Visões dos warps do ciclo anterior: uma visão igual é reaproveitada, para que os instantâneos (que as
    // guardam por referência) compartilhem os warps que não mudaram.
    const warpViews = new Map();

    function view(c, pre) {
        S.warps = resident().map((w) => {
            const st = S.issued?.warp === w.id ? { state: 'issued' } : pre[w.id];
            const e = top(w);
            const v = {
                id: w.id, name: wname(w), block: w.block, done: w.done, state: st.state, reg: st.reg ?? null, unit: st.unit ?? null,
                until: st.until ?? null, pc: e ? e.pc : null, mask: e ? live(w, e.mask) : new Array(WS).fill(false),
                stack: w.stack.map((x) => ({ pc: x.pc, rpc: x.rpc, mask: maskText(live(w, x.mask)) })),
            };
            const key = JSON.stringify(v);
            const old = warpViews.get(w.id);
            if (old && old.key === key) return old.v;
            warpViews.set(w.id, { key, v });
            return v;
        });
        S.blocks = blocks.map((b) => b.state);
        S.units = GPU_UNITS.map((name, u) => ({
            name,
            ops: active.filter((op) => op.unit === u && op.t0 <= c && op.done >= c).map((op) => ({ dyn: op.dyn, t0: op.t0, occ: op.occ, done: op.done, txn: op.txn })),
        }));
    }

    // Laço principal ---------------------------------------------------------------------------------------------

    const isDone = () => warps.every((w) => w.done) && active.length === 0;

    manageBlocks(0);
    for (const w of warps) w.ready = 1;
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
            const { retired, launched } = manageBlocks(c);
            if (retired.length || launched.length) {
                const parts = [];
                if (retired.length) parts.push(t('gpu.blockDone', { list: retired.map((b) => `b${b}`).join(', ') }));
                if (launched.length) parts.push(t('gpu.blockLaunch', { list: launched.map((b) => `b${b}`).join(', ') }));
                step(parts.join(' '), ['blocks']);
            }
            // Barreira de cada bloco: libera os warps quando todos os que ainda executam chegaram.
            for (const b of blocks) {
                if (b.state !== 'running') continue;
                const running = warps.slice(b.id * WPB, (b.id + 1) * WPB).filter((w) => !w.done);
                if (running.length > 0 && running.every((w) => w.atBar)) {
                    for (const w of running) { w.atBar = false; w.ready = Math.max(w.ready, c); }
                    step(gc.blocks > 1 ? t('gpu.barReleaseBlock', { n: running.length, b: b.id }) : t('gpu.barRelease', { n: running.length }), ['sched']);
                }
            }
            const pre = warps.map((w) => status(w, c));
            stats.residentWarpCycles += warps.filter((w) => w.launched && !w.done).length;
            const i = pick(pre);
            if (i >= 0) {
                const d = issue(warps[i], c);
                S.issued = { warp: i, dyn: d.id };
                applyWrites(active[active.length - 1], c);
            } else if (!warps.every((w) => w.done)) {
                stats.idle++;
                const st = pre.filter((x) => x.state !== 'done' && x.state !== 'pending').map((x) => x.state);
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
    for (const b of blocks) if (b.state === 'running' && warps.slice(b.id * WPB, (b.id + 1) * WPB).every((w) => w.done)) { b.state = 'done'; b.end = S.cycle; }

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
        blocks: blocks.map((b) => ({ id: b.id, start: b.start, end: b.end })),
        stats: {
            ...stats, cycles, ipc: cycles > 0 ? stats.instructions / cycles : 0,
            cpi: stats.instructions > 0 ? cycles / stats.instructions : 0,
            occupancy: cycles > 0 ? stats.residentWarpCycles / (cycles * gc.maxWarps) : 0,
        },
        final: { threads: S.tw.flat(), mem: S.mem },
    };
}
