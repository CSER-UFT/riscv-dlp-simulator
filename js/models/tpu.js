/**
 * TPU didática: um núcleo RISC-V escalar em ordem que comanda uma unidade de multiplicação de matrizes com
 * um array sistólico N x N, no estilo da TPU v1 do Google.
 *
 * Unidades (todas com pipeline, uma linha por ciclo):
 *   DMA   memória do host <-> Unified Buffer (tpu.rdhost, tpu.wrhost), latência memLatency;
 *   WDMA  memória -> fila de pesos (tpu.rdw), latência memLatency;
 *   MXU   array sistólico (tpu.matmul): a linha r entra no ciclo t0 + r, o elemento i dela entra na linha i
 *         do array no ciclo t0 + r + i, atravessa as colunas para a direita, e as somas parciais descem pelas
 *         colunas; a coluna j da linha r sai no ciclo t0 + r + (N - 1) + j, e a linha inteira fica pronta nos
 *         acumuladores no ciclo t0 + r + 2N - 2 (latência 2N - 1);
 *   ACT   ativação (tpu.act), latência actLatency.
 *
 * Os pesos ficam parados no array (weight stationary). Um bloco de pesos entra no array nos N ciclos
 * anteriores ao tpu.matmul que o usa, por um buffer duplo: a carga do bloco seguinte pode acontecer enquanto
 * o array ainda multiplica com o anterior, mas só começa quando a multiplicação anterior começou. Por isso
 * dois tpu.matmul seguidos ficam separados por pelo menos max(linhas, N) ciclos.
 *
 * Dependências entre linhas do Unified Buffer, dos acumuladores e da fila de pesos são verificadas linha a
 * linha (RAW, WAR e WAW): uma ativação pode começar a ler uma linha dos acumuladores no ciclo seguinte ao da
 * sua escrita, enquanto o array ainda produz as linhas seguintes.
 */
import * as memory from '../riscv/memory.js';
import { initialState, writeReg, indexAt } from '../riscv/machine.js';
import { TEXT_BASE } from '../riscv/parser.js';
import { execTpu, TpuError } from '../riscv/tpu.js';
import * as fmt from '../riscv/format.js';
import { t } from '../i18n/index.js';
import { normalizeConfig, checkProgram } from '../core/config.js';
import { Recorder } from '../core/recorder.js';
import { SCALAR_LAT, execScalar, rangeText } from './host.js';

export const TPU_UNITS = [
    { name: 'DMA', cls: 'tdma' },
    { name: 'WDMA', cls: 'twload' },
    { name: 'MXU', cls: 'tmxu' },
    { name: 'ACT', cls: 'tact' },
];

const NEG = -Infinity;

/** Nome legível de um recurso: ub3 -> UB[3], acc0 -> ACC[0], wf1r2 -> fila de pesos, posição 1. */
export function resourceName(key) {
    let m;
    if ((m = /^ub(\d+)$/.exec(key))) return `UB[${m[1]}]`;
    if ((m = /^acc(\d+)$/.exec(key))) return `ACC[${m[1]}]`;
    if ((m = /^wf(\d+)r\d+$/.exec(key))) return t('tpu.fifoSlot', { n: m[1] });
    return key;
}

export function simulateTpu(program, userConfig = {}) {
    const { config: cfg, errors } = normalizeConfig({ ...userConfig, xlen: program.xlen });
    if (errors.length > 0) return { errors };
    const wrong = checkProgram(program, cfg);
    if (wrong.length > 0) return { errors: wrong };

    const xlen = program.xlen;
    const tc = cfg.tpu;
    const N = tc.n;
    const fun = initialState(program, { exampleValues: cfg.exampleValues, tpu: tc });

    // Estado exibido ------------------------------------------------------------------------------------------
    const S = {
        cycle: 0,
        pc: TEXT_BASE,
        halted: false,
        regs: { x: [...fun.x], f: [...fun.f] },
        mem: new Map(fun.mem),
        ub: fun.tpu.ub.map((r) => [...r]),
        acc: fun.tpu.acc.map((r) => [...r]),
        issue: null,
        units: [],
        scalar: [],
        mxu: [],
        fifo: [],
        array: null,
        written: {},
    };

    // Tabelas de tempo -----------------------------------------------------------------------------------------
    const W = new Map(), D = new Map(), R = new Map(), Who = new Map();
    const xAvail = new Map(), xW = new Map(), xWho = new Map();
    const memW = new Map(), memR = new Map(), memWho = new Map();
    const unitFree = TPU_UNITS.map(() => 1);
    let lastMatmul = NEG;
    let frontFree = 1;
    const tiles = [];

    const dyn = [];
    const active = [];
    let head = null;
    const warnings = [];
    const stats = {
        instructions: 0, scalarInstructions: 0, tpuInstructions: 0, macs: 0, rowsIn: 0, branches: 0, taken: 0,
        stallRaw: 0, stallWar: 0, stallWaw: 0, stallStruct: 0, stallWeights: 0, stallScalar: 0, stallMem: 0, bubbles: 0,
        unitBusy: TPU_UNITS.map(() => 0),
    };

    const rec = new Recorder(userConfig.trace !== false, () => ({
        cycle: S.cycle, pc: S.pc, halted: S.halted, regs: S.regs, ub: S.ub, acc: S.acc, issue: S.issue, units: S.units,
        scalar: S.scalar, mxu: S.mxu, fifo: S.fifo, array: S.array, written: S.written,
    }), () => S.mem);
    const step = (msg, focus = []) => rec.step(msg, focus);
    const code = (op) => `\`${op.inst.text}\``;
    const B = (r) => `**${r}**`;
    const V = (x) => `//${fmt.value(x)}//`;

    // Tempo de cada linha -------------------------------------------------------------------------------------------

    function plan(inst, fx) {
        const d = inst.def;
        const op = { inst, fx, tpu: Boolean(d.tpu), cls: d.cls, unit: null, rate: 1, extra: 0 };
        if (!op.tpu) {
            op.S = cfg.latency[SCALAR_LAT[d.cls] ?? 'alu'];
            op.G = 1;
            return op;
        }
        op.unit = TPU_UNITS.findIndex((u) => u.cls === d.cls);
        op.S = { tdma: tc.memLatency, twload: tc.memLatency, tmxu: 2 * N - 1, tact: tc.actLatency }[d.cls];
        op.G = fx.slots;
        return op;
    }

    const endOff = (op) => (op.G === 0 ? 0 : op.G - 1 + op.S - 1);
    const wOff = (op, slot) => (op.tpu ? slot + op.S - 1 : op.S - 1);
    const rOff = (op, entry) => {
        const o = entry[2];
        if (o === 'write') return wOff(op, entry[0]);
        return o ?? (op.tpu ? entry[0] : 0);
    };

    function earliest(op, cycle) {
        const fx = op.fx;
        let best = { t: cycle, reason: null };
        const need = (tt, reason, info) => { if (tt > best.t) best = { t: tt, reason, ...info }; };
        need(frontFree, 'front', {});
        for (const r of fx.xreads) {
            if (r === 'x0') continue;
            if (xAvail.has(r)) need(xAvail.get(r), 'scalar', { reg: r, who: xWho.get(r) });
        }
        if (fx.xwrite && xW.has(fx.xwrite.reg)) need(xW.get(fx.xwrite.reg) + 1 - endOff(op), 'waw', { reg: fx.xwrite.reg, who: xWho.get(fx.xwrite.reg) });
        for (const entry of fx.reads) {
            const key = entry[1];
            if (W.has(key)) need(W.get(key) + 1 - rOff(op, entry), 'raw', { res: key, who: Who.get(key) });
        }
        for (const [slot, key] of fx.writes) {
            const k = wOff(op, slot);
            if (W.has(key)) need(W.get(key) + 1 - k, 'waw', { res: key, who: Who.get(key) });
            if (R.has(key)) need(R.get(key) - k, 'war', { res: key });
        }
        for (const [slot, addr, size] of fx.mreads) {
            const o = op.tpu ? slot : 0;
            for (let i = 0n; i < BigInt(size); i++) {
                const w = memW.get(addr + i);
                if (w !== undefined) need(w + 1 - o, 'mem', { addr: addr + i, who: memWho.get(addr + i) });
            }
        }
        for (const [slot, addr, size] of fx.mwrites) {
            const k = wOff(op, slot);
            for (let i = 0n; i < BigInt(size); i++) {
                const w = memW.get(addr + i), r = memR.get(addr + i);
                if (w !== undefined) need(w + 1 - k, 'mem', { addr: addr + i, who: memWho.get(addr + i) });
                if (r !== undefined) need(r - k, 'mem', { addr: addr + i });
            }
        }
        if (op.tpu) need(unitFree[op.unit], 'struct', { unit: TPU_UNITS[op.unit].name });
        // Buffer duplo de pesos: o bloco só começa a entrar no array quando a multiplicação anterior começou.
        if (op.cls === 'tmxu') need(lastMatmul + N, 'weights', {});
        return best;
    }

    function commitTiming(op, t0, d) {
        const fx = op.fx;
        op.t0 = t0;
        op.done = t0 + endOff(op);
        op.first = t0 + op.S - 1;
        for (const entry of fx.reads) R.set(entry[1], Math.max(R.get(entry[1]) ?? NEG, t0 + rOff(op, entry)));
        for (const [slot, key] of fx.writes) {
            W.set(key, t0 + wOff(op, slot));
            D.set(key, op.done);
            Who.set(key, d.id);
        }
        if (fx.xwrite) {
            xW.set(fx.xwrite.reg, op.done);
            xAvail.set(fx.xwrite.reg, op.done + 1);
            xWho.set(fx.xwrite.reg, d.id);
        }
        for (const [slot, addr, size] of fx.mreads) {
            const r = t0 + (op.tpu ? slot : 0);
            for (let i = 0n; i < BigInt(size); i++) memR.set(addr + i, Math.max(memR.get(addr + i) ?? NEG, r));
        }
        for (const [slot, addr, size] of fx.mwrites) {
            const w = t0 + wOff(op, slot);
            for (let i = 0n; i < BigInt(size); i++) {
                memW.set(addr + i, w);
                memWho.set(addr + i, d.id);
            }
        }
        if (op.tpu) {
            unitFree[op.unit] = t0 + Math.max(1, op.G);
            stats.unitBusy[op.unit] += Math.max(1, op.G);
        }
        if (op.cls === 'tmxu') {
            lastMatmul = t0;
            const tile = tiles.find((x) => x.k === fx.tile);
            tile.loadAt = t0 - N;
            tile.useAt = t0;
            tile.op = op;
        }
        if (op.cls === 'twload') tiles.push({ k: fx.tile, slot: fx.tile % tc.fifoDepth, readAt: t0, readyAt: op.done, loadAt: null, useAt: null });
    }

    // Emissão ---------------------------------------------------------------------------------------------------------

    function stallMessage(op, w) {
        const who = w.who !== undefined && w.who !== null ? `\`${dyn[w.who].text}\`` : '';
        const res = w.res ? B(resourceName(w.res)) : B(w.reg ?? '');
        switch (w.reason) {
            case 'raw': return t('tpu.stall.raw', { inst: code(op), res, who, t: w.t });
            case 'war': return t('tpu.stall.war', { inst: code(op), res, t: w.t });
            case 'waw': return t('tpu.stall.waw', { inst: code(op), res, who, t: w.t });
            case 'struct': return t('vec.stall.struct', { inst: code(op), unit: B(w.unit), t: w.t });
            case 'weights': return t('tpu.stall.weights', { inst: code(op), n: N, t: w.t });
            case 'scalar': return t('vec.stall.scalar', { inst: code(op), reg: B(w.reg), who, t: w.t });
            case 'mem': return t('vec.stall.mem', { inst: code(op), addr: fmt.address(w.addr), t: w.t });
            default: return t('vec.stall.front', { inst: code(op), t: w.t });
        }
    }

    const STALL_STAT = { raw: 'stallRaw', war: 'stallWar', waw: 'stallWaw', struct: 'stallStruct', weights: 'stallWeights', scalar: 'stallScalar', mem: 'stallMem' };

    function fetchHead(c) {
        const i = indexAt(program, S.pc);
        if (i < 0) return false;
        const inst = program.instructions[i];
        const d = {
            id: dyn.length, index: i, pc: inst.pc, text: inst.text, vector: Boolean(inst.def.tpu),
            issue: null, first: null, commit: null, squashed: null, mispredicted: false, marks: [], stalls: 0,
        };
        let fx;
        try {
            fx = inst.def.tpu ? execTpu(fun, inst, xlen, tc) : execScalar(fun, inst, xlen);
        } catch (e) {
            if (!(e instanceof TpuError)) throw e;
            warnings.push(e.message);
            S.halted = true;
            step(e.message, ['issue']);
            return false;
        }
        if (fx.xwrite && (fx.xwrite.reg === null || fx.xwrite.reg === 'x0')) fx.xwrite = null;
        dyn.push(d);
        const op = plan(inst, fx);
        op.dyn = d.id;
        head = { op, d, wait: earliest(op, c), announced: false };
        return true;
    }

    function issueMessage(op) {
        const inst = op.inst;
        const fx = op.fx;
        const unit = B(TPU_UNITS[op.unit].name);
        const p = { inst: code(op), unit, n: fx.slots, s: op.S, first: op.first, done: op.done };
        switch (inst.def.kind) {
            case 'rdhost': return t('tpu.issue.rdhost', { ...p, ub: rangeText(range(inst.dst, fx.slots)) });
            case 'wrhost': return t('tpu.issue.wrhost', { ...p, ub: rangeText(range(inst.src, fx.slots)) });
            case 'rdw': return t('tpu.issue.rdw', { ...p, k: fx.tile, slot: fx.tile % tc.fifoDepth });
            case 'matmul': return t(inst.def.accumulate ? 'tpu.issue.matmulAcc' : 'tpu.issue.matmul', { ...p, size: `${N} × ${N}`, k: fx.tile, load: op.t0 - N, nn: N });
            default: return t('tpu.issue.act', { ...p, func: inst.func });
        }
    }

    const range = (first, n) => Array.from({ length: n }, (_, i) => first + i);

    function issue(c) {
        if (S.halted) return;
        if (!head) {
            if (c < frontFree) {
                stats.bubbles++;
                S.issue = { kind: 'bubble' };
                return;
            }
            if (!fetchHead(c)) {
                S.issue = S.halted ? { kind: 'halted' } : { kind: 'end' };
                return;
            }
        }
        const { op, d, wait } = head;
        if (wait.t > c) {
            rec.mark(d, c, 'Stall');
            d.stalls++;
            if (STALL_STAT[wait.reason]) stats[STALL_STAT[wait.reason]]++;
            S.issue = { kind: 'stall', dyn: d.id, reason: wait.reason, reg: wait.reg ?? (wait.res ? resourceName(wait.res) : null), unit: wait.unit ?? null, until: wait.t };
            if (!head.announced) {
                head.announced = true;
                const focus = ['issue'];
                if (wait.unit) focus.push(`unit:${wait.unit}`);
                if (wait.reason === 'weights') focus.push('unit:MXU');
                if (wait.reg) focus.push(`reg:${wait.reg}`);
                step(stallMessage(op, wait), focus);
            }
            return;
        }
        head = null;
        commitTiming(op, c, d);
        d.issue = c;
        d.first = op.first;
        d.commit = op.done;
        d.timing = { t0: c, S: op.S, G: op.G, unit: op.unit, done: op.done, tpu: op.tpu };
        stats.instructions++;
        const inst = op.inst;
        const fx = op.fx;
        S.issue = { kind: 'issued', dyn: d.id };
        if (op.tpu) {
            stats.tpuInstructions++;
            stats.macs += fx.macs;
            if (op.cls === 'tmxu') stats.rowsIn += fx.slots;
            step(issueMessage(op), ['issue', `unit:${TPU_UNITS[op.unit].name}`]);
        } else {
            stats.scalarInstructions++;
            if (inst.def.cls === 'branch') stats.branches++;
            if (fx.system) {
                S.halted = true;
                step(t('vec.halt', { inst: code(op) }), ['issue']);
            } else if (fx.next !== undefined) {
                S.pc = fx.next;
                if (fx.taken) {
                    if (inst.def.cls === 'branch') stats.taken++;
                    frontFree = c + 1 + cfg.branchPenalty;
                    step(t('vec.branchTaken', { inst: code(op), addr: fmt.address(fx.next), n: cfg.branchPenalty }), ['issue', 'pc']);
                } else {
                    step(t('vec.branchNotTaken', { inst: code(op) }), ['issue', 'pc']);
                }
            } else {
                step(t('vec.issueScalar', { inst: code(op), done: op.done }), ['issue']);
            }
        }
        if (!fx.system && fx.next === undefined) S.pc = inst.pc + 4;
        if (frontFree <= c) frontFree = c + 1;
        active.push(op);
    }

    // Escritas ------------------------------------------------------------------------------------------------------

    function applyWrites(op, c) {
        const fx = op.fx;
        const focus = [];
        const parts = [];
        const touched = { ub: [], acc: [], wf: false };
        for (const [slot, key, values] of fx.writes) {
            if (op.t0 + wOff(op, slot) !== c) continue;
            let m;
            if ((m = /^ub(\d+)$/.exec(key))) { S.ub[+m[1]] = values; touched.ub.push(+m[1]); }
            else if ((m = /^acc(\d+)$/.exec(key))) { S.acc[+m[1]] = values; touched.acc.push(+m[1]); }
            else touched.wf = true;
        }
        if (touched.ub.length) {
            S.written.ub = [...(S.written.ub ?? []), ...touched.ub];
            parts.push(`**UB**[${rangeText(touched.ub)}]`);
            focus.push('ub');
        }
        if (touched.acc.length) {
            S.written.acc = [...(S.written.acc ?? []), ...touched.acc];
            parts.push(`**ACC**[${rangeText(touched.acc)}]`);
            focus.push('acc');
        }
        if (touched.wf) {
            parts.push(t('tpu.fifoRow'));
            focus.push('fifo');
        }
        const stores = fx.mwrites.filter(([slot]) => op.t0 + wOff(op, slot) === c);
        if (stores.length > 0) {
            S.mem = new Map(S.mem);
            for (const [, addr, size, raw] of stores) {
                memory.writeRaw(S.mem, addr, size, raw);
                focus.push(`mem:${addr}`);
            }
            parts.push(t('vec.writeMem', { n: stores.length * (op.tpu ? N : 1), addr: fmt.address(stores[0][1]) }));
        }
        if (c === op.done && fx.xwrite) {
            writeReg(S.regs, fx.xwrite.reg, fx.xwrite.value);
            focus.push(`reg:${fx.xwrite.reg}`);
            parts.push(t('vec.writeReg', { reg: B(fx.xwrite.reg), value: V(fx.xwrite.value) }));
        }
        if (parts.length > 0) step(t(c === op.done ? 'vec.writeDone' : 'vec.write', { inst: code(op), list: parts.join('; ') }), focus);
    }

    function label(op, c) {
        if (c === op.t0) return 'Issue';
        if (op.tpu && c < op.t0 + Math.max(1, op.G)) return 'Exec';
        return op.tpu ? 'Lat' : 'Exec';
    }

    /** Ocupação das unidades, multiplicações no array e fila de pesos no ciclo, para o diagrama. */
    function view(c) {
        const inUnit = (i) => active.filter((op) => op.tpu && op.unit === i && op.t0 <= c && op.done >= c);
        S.units = TPU_UNITS.map((u, i) => ({
            name: u.name,
            ops: inUnit(i).map((op) => ({ dyn: op.dyn, t0: op.t0, S: op.S, G: op.G, done: op.done })),
        }));
        S.scalar = active.filter((op) => !op.tpu && op.t0 <= c && op.done >= c).map((op) => ({ dyn: op.dyn, done: op.done }));
        S.mxu = inUnit(2).map((op) => ({
            dyn: op.dyn, t0: op.t0, rows: op.G, X: op.fx.inputs, W: op.fx.W, tile: op.fx.tile, acc: op.inst.dst, accumulate: Boolean(op.inst.def.accumulate),
        }));
        S.fifo = tiles.filter((x) => x.readAt <= c && (x.useAt === null || x.useAt > c)).map((x) => ({
            k: x.k, slot: x.slot, state: c < x.readyAt ? 'reading' : (x.loadAt !== null && c >= x.loadAt ? 'shifting' : 'ready'),
        }));
        const inArray = tiles.filter((x) => x.useAt !== null && x.useAt <= c).pop();
        S.array = inArray ? { k: inArray.k, W: inArray.op.fx.W } : null;
    }

    // Laço principal -------------------------------------------------------------------------------------------------

    const isDone = () => (S.halted || (!head && indexAt(program, S.pc) < 0)) && active.length === 0;

    view(0);
    rec.endCycle();
    while (!isDone()) {
        if (S.cycle >= cfg.maxCycles) {
            warnings.push(t('common.maxCycles', { n: cfg.maxCycles }));
            break;
        }
        S.cycle++;
        const c = S.cycle;
        rec.beginCycle();
        S.written = {};
        if (!(head && S.issue?.kind === 'stall')) S.issue = null;
        for (const op of active) applyWrites(op, c);
        const before = active.length;
        issue(c);
        if (active.length > before) applyWrites(active[active.length - 1], c);
        for (const op of active) rec.mark(dyn[op.dyn], c, label(op, c));
        view(c);
        for (let i = active.length - 1; i >= 0; i--) if (active[i].done <= c) active.splice(i, 1);
        rec.endCycle(t('common.endOfCycle'));
    }

    const cycles = S.cycle;
    return {
        errors: [],
        model: 'tpu',
        config: cfg,
        program,
        states: rec.states,
        interStates: rec.interStates,
        dyn,
        warnings,
        finished: isDone(),
        stats: {
            ...stats, cycles, ipc: cycles > 0 ? stats.instructions / cycles : 0,
            cpi: stats.instructions > 0 ? cycles / stats.instructions : 0,
        },
        final: { x: S.regs.x, f: S.regs.f, mem: S.mem, ub: S.ub, acc: S.acc },
    };
}
