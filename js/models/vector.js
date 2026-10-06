/**
 * Processador vetorial: um núcleo escalar em ordem acoplado a uma unidade vetorial com lanes, no estilo do
 * RV64V de Hennessy e Patterson (capítulo 4), executando a extensão V do RISC-V.
 *
 * Modelo temporal:
 *   uma instrução é emitida por ciclo, em ordem; se não puder começar, a emissão para (stall) e as
 *   seguintes esperam;
 *   uma instrução vetorial ocupa uma unidade funcional: a cada ciclo entram `lanes` elementos (ou
 *   `stridedRate` elementos, em acessos à memória com passo ou indexados); cada elemento leva a latência
 *   de partida da classe (profundidade do pipeline da unidade) até ter o resultado escrito;
 *   com encadeamento (chaining), um elemento pode ser lido no ciclo seguinte à escrita do mesmo elemento
 *   pela instrução produtora; sem encadeamento, a consumidora só começa depois que a produtora termina;
 *   dependências são verificadas bit a bit nos registradores vetoriais (RAW, WAR e WAW; bit a bit porque
 *   uma máscara tem um bit por elemento), por registrador nos escalares e por endereço na memória;
 *   reduções e instruções que produzem um escalar escrevem o resultado só no fim, depois de uma árvore de
 *   soma entre as lanes (log2 das lanes ativas, em ciclos).
 *
 * Os valores são calculados pelo executor funcional no momento em que a instrução chega à emissão (em
 * ordem de programa); o estado exibido muda nos ciclos em que cada elemento é escrito.
 */
import * as memory from '../riscv/memory.js';
import { f32ToBits, f64ToBits } from '../riscv/bits.js';
import { initialState, readReg, writeReg, effectiveAddress, indexAt, resolveControl } from '../riscv/machine.js';
import { TEXT_BASE } from '../riscv/parser.js';
import { index } from '../riscv/registers.js';
import { execVector, VectorError, VECTOR_CLASSES } from '../riscv/vector.js';
import * as fmt from '../riscv/format.js';
import { t } from '../i18n/index.js';
import { normalizeConfig, checkProgram } from '../core/config.js';
import { Recorder } from '../core/recorder.js';

/** Latência escalar de cada classe. */
const SCALAR_LAT = { alu: 'alu', branch: 'alu', jump: 'alu', vset: 'alu', system: 'alu', mul: 'mul', div: 'div', load: 'load', store: 'store', fadd: 'fadd', fmul: 'fmul', fdiv: 'fdiv' };

/** Tipo de exibição dos elementos escritos por uma instrução: inteiro, ponto flutuante ou máscara. */
function viewType(def) {
    if (def.kind === 'cmp' || def.kind === 'mlog') return 'm';
    if (def.type === 'f' || def.tout === 'f') return 'f';
    if (def.kind === 'load' || def.kind === 'store' || def.kind === 'mv' || def.kind === 'merge' || def.kind === 'fromScalar') return null;
    return 'i';
}

const NEG = -Infinity;

export function simulateVector(program, userConfig = {}) {
    const { config: cfg, errors } = normalizeConfig({ ...userConfig, xlen: program.xlen });
    if (errors.length > 0) return { errors };
    const unserved = checkProgram(program, cfg);
    if (unserved.length > 0) return { errors: unserved };

    const xlen = program.xlen;
    const vc = cfg.vector;
    const L = vc.lanes;
    const nbits = vc.vlen;
    const fun = initialState(program, { exampleValues: cfg.exampleValues, vlen: vc.vlen });

    // Registradores vetoriais usados como ponto flutuante em algum ponto do programa (para a exibição dos
    // valores carregados da memória ou copiados, cujo tipo a instrução não define).
    const fpRegs = new Set();
    for (const inst of program.instructions) {
        const d = inst.def;
        if (!d.vector || !(d.type === 'f' || d.tin === 'f' || d.tout === 'f')) continue;
        for (const r of [inst.vs1, inst.vs2, inst.vs3]) if (r) fpRegs.add(index(r));
        if (inst.vd && d.kind !== 'cmp') fpRegs.add(index(inst.vd));
    }

    // Estado exibido ------------------------------------------------------------------------------------------
    const S = {
        cycle: 0,
        pc: TEXT_BASE,
        halted: false,
        vl: 0,
        vtype: null,
        regs: { x: [...fun.x], f: [...fun.f] },
        v: fun.v.map((r) => [...r]),
        view: new Array(32).fill(null),
        mem: new Map(fun.mem),
        issue: null,
        units: [],
        scalar: [],
        written: {},
    };

    // Tabelas de tempo para as dependências ---------------------------------------------------------------------
    const vW = Array.from({ length: 32 }, () => new Array(nbits).fill(NEG));
    const vD = Array.from({ length: 32 }, () => new Array(nbits).fill(NEG));
    const vWho = Array.from({ length: 32 }, () => new Array(nbits).fill(null));
    const vR = Array.from({ length: 32 }, () => new Array(nbits).fill(NEG));
    const xAvail = new Map(), xW = new Map(), xWho = new Map();
    const memW = new Map(), memR = new Map(), memWho = new Map();
    const unitFree = vc.units.map(() => 1);
    let frontFree = 1;

    const dyn = [];
    const active = [];
    let head = null;
    const warnings = [];
    const stats = {
        instructions: 0, scalarInstructions: 0, vectorInstructions: 0, elements: 0, flops: 0, branches: 0, taken: 0,
        stallRaw: 0, stallWar: 0, stallWaw: 0, stallStruct: 0, stallScalar: 0, stallMem: 0, bubbles: 0,
        unitBusy: vc.units.map(() => 0), unitSlots: vc.units.map(() => 0),
    };

    const rec = new Recorder(userConfig.trace !== false, () => ({
        cycle: S.cycle, pc: S.pc, halted: S.halted, vl: S.vl, vtype: S.vtype, regs: S.regs, v: S.v, view: S.view,
        issue: S.issue, units: S.units, scalar: S.scalar, written: S.written,
    }), () => S.mem);
    const step = (msg, focus = []) => rec.step(msg, focus);
    const code = (op) => `\`${op.inst.text}\``;
    const R = (r) => `**${r}**`;
    const V = (x) => `//${fmt.value(x)}//`;

    // Execução funcional ------------------------------------------------------------------------------------------

    function execScalar(inst) {
        const d = inst.def;
        const fx = { slots: 1, reads: [], writes: [], mreads: [], mwrites: [], xreads: [], xwrite: null, active: 1, flops: 0, strided: false, end: false };
        for (const r of [inst.rs1, inst.rs2, inst.rs3]) if (r) fx.xreads.push(r);
        const a = readReg(fun, inst.rs1), b = readReg(fun, inst.rs2), c = readReg(fun, inst.rs3);
        switch (d.cls) {
            case 'system':
                fx.system = true;
                break;
            case 'load': {
                const addr = effectiveAddress(inst, a, xlen);
                const value = memory.load(fun.mem, addr, d.mem, xlen);
                writeReg(fun, inst.rd, value);
                fx.mreads.push([0, addr, d.mem.size]);
                fx.xwrite = { reg: inst.rd, value };
                break;
            }
            case 'store': {
                const addr = effectiveAddress(inst, a, xlen);
                memory.store(fun.mem, addr, d.mem, b);
                const raw = d.mem.fp === 's' ? f32ToBits(b) : (d.mem.fp === 'd' ? f64ToBits(b) : BigInt(b));
                fx.mwrites.push([0, addr, d.mem.size, raw]);
                break;
            }
            case 'branch': case 'jump': {
                const r = resolveControl(inst, a, b, xlen);
                if (r.value !== null) {
                    writeReg(fun, inst.rd, r.value);
                    fx.xwrite = { reg: inst.rd, value: r.value };
                }
                fx.next = r.next;
                fx.taken = r.taken;
                break;
            }
            default: {
                const value = d.exec(a, b, inst, xlen, c);
                writeReg(fun, inst.rd, value);
                fx.xwrite = { reg: inst.rd, value };
            }
        }
        return fx;
    }

    // Tempo de cada elemento ---------------------------------------------------------------------------------------

    /** Dados temporais de uma instrução, a partir dos acessos devolvidos pelo executor. */
    function plan(inst, fx) {
        const d = inst.def;
        const vector = Boolean(d.vector) && d.kind !== 'vset';
        const op = { inst, fx, vector, cls: d.cls, unit: null };
        if (!vector) {
            op.S = cfg.latency[SCALAR_LAT[d.cls] ?? 'alu'];
            op.rate = 1;
            op.G = 1;
            op.extra = 0;
            return op;
        }
        op.S = cfg.latency[d.cls];
        op.rate = fx.strided ? Math.min(vc.stridedRate, L) : L;
        op.G = Math.ceil(fx.slots / op.rate);
        op.extra = 0;
        if (d.kind === 'red' || d.kind === 'mscalar') op.extra = Math.ceil(Math.log2(Math.max(1, Math.min(fx.slots, L))));
        return op;
    }

    const off = (op, slot) => Math.floor(slot / op.rate);
    /** Deslocamento, a partir do início, do ciclo em que o slot é escrito (slot -1: fim da instrução). */
    const wOff = (op, slot) => (slot < 0 ? endOff(op) : off(op, slot) + op.S - 1);
    const endOff = (op) => (op.G === 0 ? 0 : op.G - 1 + op.S - 1 + op.extra);

    /** Ciclo mais cedo em que a instrução pode começar, com o motivo da espera. */
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
        for (const [slot, reg, lo, hi] of fx.reads) {
            const o = off(op, slot);
            for (let b = lo; b < hi; b++) {
                if (vW[reg][b] === NEG) continue;
                if (vc.chaining) need(vW[reg][b] + 1 - o, 'raw', { reg: `v${reg}`, who: vWho[reg][b] });
                else need(vD[reg][b] + 1, 'raw', { reg: `v${reg}`, who: vWho[reg][b] });
            }
        }
        for (const [slot, reg, lo, hi] of fx.writes) {
            const k = wOff(op, slot);
            for (let b = lo; b < hi; b++) {
                if (vW[reg][b] !== NEG) need(vW[reg][b] + 1 - k, 'waw', { reg: `v${reg}`, who: vWho[reg][b] });
                if (vR[reg][b] !== NEG) need(vR[reg][b] - k, 'war', { reg: `v${reg}` });
            }
        }
        for (const [slot, addr, size] of fx.mreads) {
            const o = off(op, slot);
            for (let i = 0n; i < BigInt(size); i++) {
                const w = memW.get(addr + i);
                if (w !== undefined) need(w + 1 - o, 'mem', { addr: addr + i, who: memWho.get(addr + i) });
            }
        }
        for (const [slot, addr, size] of fx.mwrites) {
            const k = op.vector ? wOff(op, slot) : op.S - 1;
            for (let i = 0n; i < BigInt(size); i++) {
                const w = memW.get(addr + i), r = memR.get(addr + i);
                if (w !== undefined) need(w + 1 - k, 'mem', { addr: addr + i, who: memWho.get(addr + i) });
                if (r !== undefined) need(r - k, 'mem', { addr: addr + i });
            }
        }
        if (op.vector) {
            let unit = -1;
            vc.units.forEach((u, i) => {
                if (u.classes.includes(op.cls) && (unit < 0 || unitFree[i] < unitFree[unit])) unit = i;
            });
            op.unit = unit;
            need(unitFree[unit], 'struct', { unit: vc.units[unit].name });
        }
        return best;
    }

    /** Registra os tempos de uma instrução que começou no ciclo t0. */
    function commitTiming(op, t0, d) {
        const fx = op.fx;
        op.t0 = t0;
        op.done = t0 + (op.vector ? endOff(op) : op.S - 1);
        op.first = op.vector ? (fx.end ? op.done : t0 + op.S - 1) : op.done;
        for (const [slot, reg, lo, hi] of fx.reads)
            for (let b = lo; b < hi; b++) vR[reg][b] = Math.max(vR[reg][b], t0 + off(op, slot));
        for (const [slot, reg, lo, hi] of fx.writes) {
            const w = t0 + wOff(op, slot);
            for (let b = lo; b < hi; b++) {
                vW[reg][b] = Math.max(vW[reg][b] === NEG ? w : vW[reg][b], w);
                vD[reg][b] = op.done;
                vWho[reg][b] = d.id;
            }
        }
        if (fx.xwrite) {
            xW.set(fx.xwrite.reg, op.done);
            xAvail.set(fx.xwrite.reg, op.done + 1);
            xWho.set(fx.xwrite.reg, d.id);
        }
        for (const [slot, addr, size] of fx.mreads)
            for (let i = 0n; i < BigInt(size); i++) memR.set(addr + i, Math.max(memR.get(addr + i) ?? NEG, t0 + off(op, slot)));
        for (const [slot, addr, size] of fx.mwrites) {
            const w = t0 + (op.vector ? wOff(op, slot) : op.S - 1);
            for (let i = 0n; i < BigInt(size); i++) {
                memW.set(addr + i, w);
                memWho.set(addr + i, d.id);
            }
        }
        if (op.vector) {
            const occ = Math.max(1, op.G);
            unitFree[op.unit] = vc.units[op.unit].pipelined ? t0 + occ : op.done + 1;
            stats.unitBusy[op.unit] += occ;
            stats.unitSlots[op.unit] += fx.slots;
        }
    }

    // Emissão ---------------------------------------------------------------------------------------------------------

    function stallMessage(op, w) {
        const who = w.who !== undefined && w.who !== null ? `\`${dyn[w.who].text}\`` : '';
        switch (w.reason) {
            case 'raw': return t(vc.chaining ? 'vec.stall.raw' : 'vec.stall.rawNoChain', { inst: code(op), reg: R(w.reg), who, t: w.t });
            case 'war': return t('vec.stall.war', { inst: code(op), reg: R(w.reg), t: w.t });
            case 'waw': return t('vec.stall.waw', { inst: code(op), reg: R(w.reg), who, t: w.t });
            case 'struct': return t('vec.stall.struct', { inst: code(op), unit: R(w.unit), t: w.t });
            case 'scalar': return t('vec.stall.scalar', { inst: code(op), reg: R(w.reg), who, t: w.t });
            case 'mem': return t('vec.stall.mem', { inst: code(op), addr: fmt.address(w.addr), t: w.t });
            default: return t('vec.stall.front', { inst: code(op), t: w.t });
        }
    }

    const STALL_STAT = { raw: 'stallRaw', war: 'stallWar', waw: 'stallWaw', struct: 'stallStruct', scalar: 'stallScalar', mem: 'stallMem' };

    function fetchHead(c) {
        const i = indexAt(program, S.pc);
        if (i < 0) return false;
        const inst = program.instructions[i];
        const d = {
            id: dyn.length, index: i, pc: inst.pc, text: inst.text, vector: Boolean(inst.def.vector) && inst.def.kind !== 'vset',
            issue: null, first: null, commit: null, squashed: null, mispredicted: false, marks: [], stalls: 0,
        };
        let fx;
        try {
            fx = inst.def.vector ? execVector(fun, inst, xlen, vc.vlen) : execScalar(inst);
        } catch (e) {
            if (!(e instanceof VectorError)) throw e;
            warnings.push(e.message);
            S.halted = true;
            step(e.message, ['issue']);
            return false;
        }
        if (fx.xwrite && (fx.xwrite.reg === null || fx.xwrite.reg === 'x0')) fx.xwrite = null;
        dyn.push(d);
        const op = plan(inst, fx);
        op.dyn = d.id;
        op.sew = fun.vtype?.sew ?? 32;
        if (inst.def.kind === 'vset') {
            op.vl = fun.vl;
            op.vtype = { ...fun.vtype };
        }
        const w = earliest(op, c);
        head = { op, d, wait: w, announced: false };
        return true;
    }

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
            S.issue = { kind: 'stall', dyn: d.id, reason: wait.reason, reg: wait.reg ?? null, unit: wait.unit ?? null, who: wait.who ?? null, until: wait.t };
            if (!head.announced) {
                head.announced = true;
                const focus = ['issue'];
                if (wait.reg) focus.push(wait.reg[0] === 'v' ? `vreg:${wait.reg}` : `reg:${wait.reg}`);
                if (wait.unit) focus.push(`unit:${wait.unit}`);
                step(stallMessage(op, wait), focus);
            }
            return;
        }
        // Começa no ciclo c. Instruções ainda em andamento cujos elementos ela lê: encadeamento.
        head = null;
        const chained = new Set();
        if (vc.chaining && op.vector)
            for (const [, reg, lo, hi] of op.fx.reads)
                for (let b = lo; b < hi; b++)
                    if (vWho[reg][b] !== null && vD[reg][b] >= c) chained.add(vWho[reg][b]);
        commitTiming(op, c, d);
        d.issue = c;
        d.first = op.first;
        d.commit = op.done;
        d.timing = { t0: c, S: op.S, rate: op.rate, G: op.G, extra: op.extra, unit: op.unit, done: op.done, vector: op.vector };
        stats.instructions++;
        const inst = op.inst;
        const fx = op.fx;
        S.issue = { kind: 'issued', dyn: d.id };
        if (op.vector) {
            stats.vectorInstructions++;
            stats.elements += fx.active;
            stats.flops += fx.flops;
            const unit = vc.units[op.unit].name;
            let msg;
            if (fx.slots === 0) msg = t('vec.issueEmpty', { inst: code(op), unit: R(unit) });
            else msg = t(fx.end ? 'vec.issueEnd' : 'vec.issue', {
                inst: code(op), unit: R(unit), n: fx.slots, rate: op.rate, g: op.G, s: op.S, first: op.first, done: op.done,
            });
            if (chained.size > 0) msg += ' ' + t('vec.chained', { list: [...chained].map((id) => `\`${dyn[id].text}\``).join(', ') });
            step(msg, ['issue', `unit:${unit}`]);
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
            } else if (inst.def.kind === 'vset') {
                step(t('vec.issueVset', { inst: code(op), vl: fun.vl, sew: fun.vtype.sew, max: vc.vlen / fun.vtype.sew }), ['issue', 'vl']);
            } else {
                step(t('vec.issueScalar', { inst: code(op), done: op.done }), ['issue']);
            }
        }
        if (!fx.system && fx.next === undefined) S.pc = inst.pc + 4;
        if (frontFree <= c) frontFree = c + 1;
        active.push(op);
    }

    // Escritas e conclusão ------------------------------------------------------------------------------------------------

    function applyWrites(op, c) {
        const fx = op.fx;
        const inst = op.inst;
        const def = inst.def;
        const focus = [];
        const parts = [];
        // Registradores vetoriais
        const touched = new Map();
        for (const w of fx.writes) {
            const [slot, reg, , , byteLo, bytes] = w;
            if (op.t0 + wOff(op, slot) !== c) continue;
            for (let i = 0; i < bytes.length; i++) S.v[reg][byteLo + i] = bytes[i];
            if (!touched.has(reg)) touched.set(reg, new Set());
            touched.get(reg).add(slot < 0 ? 0 : slot);
        }
        for (const [reg, slots] of touched) {
            S.view[reg] = { sew: op.sew, type: viewType(def) ?? (fpRegs.has(reg) ? 'f' : 'i') };
            const list = [...slots].sort((a, b) => a - b);
            S.written[`v${reg}`] = [...(S.written[`v${reg}`] ?? []), ...list];
            focus.push(`vreg:v${reg}`);
            parts.push(t('vec.writeElems', { reg: R(`v${reg}`), list: rangeText(list) }));
        }
        // Memória
        const stores = fx.mwrites.filter(([slot]) => op.t0 + (op.vector ? wOff(op, slot) : op.S - 1) === c);
        if (stores.length > 0) {
            S.mem = new Map(S.mem);
            for (const [, addr, size, raw] of stores) {
                memory.writeRaw(S.mem, addr, size, raw);
                focus.push(`mem:${addr}`);
            }
            parts.push(t('vec.writeMem', { n: stores.length, addr: fmt.address(stores[0][1]) }));
        }
        // Escalar e vsetvli (no fim)
        if (c === op.done) {
            if (fx.xwrite) {
                writeReg(S.regs, fx.xwrite.reg, fx.xwrite.value);
                focus.push(`reg:${fx.xwrite.reg}`);
                parts.push(t('vec.writeReg', { reg: R(fx.xwrite.reg), value: V(fx.xwrite.value) }));
            }
            if (def.kind === 'vset') {
                S.vl = op.vl;
                S.vtype = op.vtype;
                focus.push('vl');
            }
        }
        if (parts.length > 0) {
            const key = c === op.done ? 'vec.writeDone' : 'vec.write';
            step(t(key, { inst: code(op), list: parts.join('; ') }), focus);
        } else if (c === op.done && op.vector && fx.writes.length === 0 && fx.mwrites.length === 0) {
            step(t('vec.done', { inst: code(op) }), []);
        }
    }

    function rangeText(list) {
        const out = [];
        let i = 0;
        while (i < list.length) {
            let j = i;
            while (j + 1 < list.length && list[j + 1] === list[j] + 1) j++;
            out.push(i === j ? `${list[i]}` : `${list[i]}..${list[j]}`);
            i = j + 1;
        }
        return out.join(', ');
    }

    function label(op, c) {
        if (c === op.t0) return 'Issue';
        if (op.vector && c < op.t0 + Math.max(1, op.G)) return 'Exec';
        return op.vector ? 'Lat' : 'Exec';
    }

    /** Ocupação das unidades no ciclo, para o diagrama. */
    function unitView(c) {
        S.units = vc.units.map((u, i) => ({
            name: u.name,
            ops: active.filter((op) => op.vector && op.unit === i && op.t0 <= c && op.done >= c)
                .map((op) => ({ dyn: op.dyn, t0: op.t0, rate: op.rate, S: op.S, slots: op.fx.slots, G: op.G, done: op.done, extra: op.extra, end: op.fx.end })),
        }));
        S.scalar = active.filter((op) => !op.vector && op.t0 <= c && op.done >= c).map((op) => ({ dyn: op.dyn, t0: op.t0, done: op.done }));
    }

    // Laço principal ---------------------------------------------------------------------------------------------------

    const isDone = () => (S.halted || (!head && indexAt(program, S.pc) < 0)) && active.length === 0;

    unitView(0);
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
        // Uma instrução parada continua aparecendo na emissão até ser emitida.
        if (!(head && S.issue?.kind === 'stall')) S.issue = null;
        for (const op of active) applyWrites(op, c);
        const before = active.length;
        issue(c);
        if (active.length > before) applyWrites(active[active.length - 1], c);
        for (const op of active) rec.mark(dyn[op.dyn], c, label(op, c));
        unitView(c);
        for (let i = active.length - 1; i >= 0; i--) if (active[i].done <= c) active.splice(i, 1);
        rec.endCycle(t('common.endOfCycle'));
    }

    const cycles = S.cycle;
    return {
        errors: [],
        model: 'vector',
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
        final: { x: S.regs.x, f: S.regs.f, v: S.v, vl: S.vl, vtype: S.vtype, mem: S.mem },
    };
}

export { VECTOR_CLASSES };
