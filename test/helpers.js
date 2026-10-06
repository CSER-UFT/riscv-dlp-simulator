import assert from 'node:assert/strict';
import { assemble } from '../js/riscv/parser.js';
import { runReference, initialState, effectiveAddress, resolveControl } from '../js/riscv/machine.js';
import * as memory from '../js/riscv/memory.js';
import { execVector } from '../js/riscv/vector.js';
import { simulate } from '../js/simulator.js';
import { normalizeConfig } from '../js/core/config.js';

/** Monta um programa e falha o teste se houver erros. */
export function asm(source, options = {}) {
    const p = assemble(source, options);
    assert.deepEqual(p.errors, [], `erros de montagem:\n${p.errors.map((e) => `${e.line}: ${e.message}`).join('\n')}`);
    return p;
}

/** Configurações de hardware variadas para exercitar o modelo vetorial. */
export const CONFIGS = {
    'padrão': {},
    'sem encadeamento': { vector: { chaining: false } },
    '1 lane': { vector: { lanes: 1 } },
    '8 lanes, VLEN 512': { vector: { lanes: 8, vlen: 512 } },
    'VLEN 128, 2 lanes, passo 2': { vector: { vlen: 128, lanes: 2, stridedRate: 2 } },
    'VLEN 64': { vector: { vlen: 64, lanes: 2 } },
    'unidade única sem pipeline': {
        vector: { units: [{ name: 'U', classes: ['vload', 'vstore', 'valu', 'vmul', 'vdiv', 'vfadd', 'vfmul', 'vfdiv'], pipelined: false }] },
    },
    'duas ALUs e LSU separadas': {
        vector: {
            lanes: 2,
            units: [
                { name: 'LD', classes: ['vload'] },
                { name: 'ST', classes: ['vstore'] },
                { name: 'A1', classes: ['valu', 'vfadd', 'vmul', 'vfmul'] },
                { name: 'A2', classes: ['valu', 'vfadd', 'vmul', 'vfmul'] },
                { name: 'D', classes: ['vdiv', 'vfdiv'], pipelined: false },
            ],
        },
    },
    'latências altas, sem encadeamento': {
        branchPenalty: 3,
        vector: { chaining: false, lanes: 3 },
        latency: { alu: 2, mul: 5, div: 12, load: 4, store: 2, fadd: 4, fmul: 5, fdiv: 12, vload: 12, vstore: 9, valu: 6, vmul: 7, vdiv: 20, vfadd: 6, vfmul: 7, vfdiv: 20 },
    },
    'latência 1 em tudo': {
        branchPenalty: 0,
        latency: { alu: 1, mul: 1, div: 1, load: 1, store: 1, fadd: 1, fmul: 1, fdiv: 1, vload: 1, vstore: 1, valu: 1, vmul: 1, vdiv: 1, vfadd: 1, vfmul: 1, vfdiv: 1 },
    },
};

/** Compara o estado final do modelo com o simulador de referência e verifica as regras de tempo. */
export function assertMatchesReference(program, config, label = '') {
    const cfg = normalizeConfig(config).config;
    const ref = runReference(program, { exampleValues: cfg.exampleValues, vlen: cfg.vector.vlen });
    const sim = simulate(program, { maxCycles: 50000, ...config });
    assert.deepEqual(sim.errors ?? [], [], `${label}: erros de configuração`);
    assert.ok(sim.finished, `${label}: a simulação não terminou (${sim.warnings.join(' ')})`);
    for (let i = 0; i < 32; i++) {
        assert.equal(sim.final.x[i], ref.x[i], `${label}: x${i} difere (modelo ${sim.final.x[i]}, referência ${ref.x[i]})`);
        assert.ok(Object.is(sim.final.f[i], ref.f[i]), `${label}: f${i} difere (modelo ${sim.final.f[i]}, referência ${ref.f[i]})`);
        assert.deepEqual(sim.final.v[i], ref.v[i], `${label}: v${i} difere`);
    }
    assert.equal(sim.final.vl, ref.vl, `${label}: vl difere`);
    const addrs = new Set([...ref.mem.keys(), ...sim.final.mem.keys()]);
    for (const a of addrs)
        assert.equal(sim.final.mem.get(a) ?? 0, ref.mem.get(a) ?? 0, `${label}: memória em 0x${a.toString(16)} difere`);
    assert.equal(sim.dyn.length, ref.executed, `${label}: número de instruções executadas difere`);
    checkTiming(sim, label);
    return sim;
}

/**
 * Verificação independente das regras de tempo: reexecuta o programa no executor funcional, na ordem em que
 * as instruções foram emitidas, calcula o ciclo de leitura e de escrita de cada bit de registrador vetorial e
 * de cada byte de memória e confere RAW (com e sem encadeamento), WAR, WAW e a ocupação das unidades.
 */
export function checkTiming(sim, label = '') {
    const cfg = sim.config;
    const vc = cfg.vector;
    const st = initialState(sim.program, { exampleValues: cfg.exampleValues, vlen: vc.vlen });
    const W = new Map(), D = new Map(), R = new Map(), MW = new Map(), MR = new Map(), XW = new Map();
    const busy = vc.units.map(() => []);
    let prevIssue = 0;
    for (const d of sim.dyn) {
        const tm = d.timing;
        assert.ok(tm, `${label}: instrução sem tempo registrado (${d.text})`);
        assert.ok(tm.t0 > prevIssue, `${label}: emissão fora de ordem ou duas no mesmo ciclo (${d.text})`);
        prevIssue = tm.t0;
        const inst = sim.program.instructions[d.index];
        if (!inst.def.vector) {
            // Instruções escalares: só a dependência de registradores escalares produzidos por instruções vetoriais.
            for (const r of [inst.rs1, inst.rs2, inst.rs3]) {
                if (r && r !== 'x0' && XW.has(r)) assert.ok(tm.t0 > XW.get(r), `${label}: ${d.text} leu ${r} antes da escrita`);
            }
            if (inst.rd) XW.delete(inst.rd);
            stepScalar(st, inst, sim.program.xlen);
            continue;
        }
        const fx = execVector(st, inst, sim.program.xlen, vc.vlen);
        for (const r of [inst.rs1, inst.rs2]) {
            if (r && r !== 'x0' && XW.has(r)) assert.ok(tm.t0 > XW.get(r), `${label}: ${d.text} leu ${r} antes da escrita`);
        }
        if (inst.def.kind === 'vset') {
            if (inst.rd) XW.delete(inst.rd);
            continue;
        }
        const off = (slot) => Math.floor(slot / tm.rate);
        const end = tm.G === 0 ? 0 : tm.G - 1 + tm.S - 1 + tm.extra;
        const wt = (slot) => tm.t0 + (slot < 0 ? end : off(slot) + tm.S - 1);
        for (const [slot, reg, lo, hi] of fx.reads) {
            const r = tm.t0 + off(slot);
            for (let b = lo; b < hi; b++) {
                const k = `${reg}.${b}`;
                if (!W.has(k)) continue;
                if (vc.chaining) assert.ok(r > W.get(k), `${label}: ${d.text} leu v${reg} bit ${b} no ciclo ${r}, escrito no ciclo ${W.get(k)}`);
                else assert.ok(tm.t0 > D.get(k), `${label}: ${d.text} começou antes do fim da produtora de v${reg}`);
            }
        }
        for (const [slot, reg, lo, hi] of fx.writes) {
            const w = wt(slot);
            for (let b = lo; b < hi; b++) {
                const k = `${reg}.${b}`;
                if (W.has(k)) assert.ok(w > W.get(k), `${label}: ${d.text} escreveu v${reg} bit ${b} antes de uma escrita anterior (WAW)`);
                if (R.has(k)) assert.ok(w >= R.get(k), `${label}: ${d.text} escreveu v${reg} bit ${b} antes de uma leitura anterior (WAR)`);
            }
        }
        for (const [slot, reg, lo, hi] of fx.reads)
            for (let b = lo; b < hi; b++) R.set(`${reg}.${b}`, Math.max(R.get(`${reg}.${b}`) ?? -1, tm.t0 + off(slot)));
        for (const [slot, reg, lo, hi] of fx.writes)
            for (let b = lo; b < hi; b++) {
                W.set(`${reg}.${b}`, wt(slot));
                D.set(`${reg}.${b}`, tm.done);
            }
        // Memória: compara só com instruções anteriores (elementos da mesma instrução podem repetir endereços).
        for (const [slot, addr, size] of fx.mreads)
            for (let i = 0n; i < BigInt(size); i++)
                if (MW.has(addr + i)) assert.ok(tm.t0 + off(slot) > MW.get(addr + i), `${label}: ${d.text} leu a memória antes da escrita`);
        for (const [slot, addr, size] of fx.mwrites)
            for (let i = 0n; i < BigInt(size); i++) {
                const k = addr + i;
                if (MW.has(k)) assert.ok(wt(slot) > MW.get(k), `${label}: ${d.text} escreveu a memória antes de uma escrita anterior`);
                if (MR.has(k)) assert.ok(wt(slot) >= MR.get(k), `${label}: ${d.text} escreveu a memória antes de uma leitura anterior`);
            }
        for (const [slot, addr, size] of fx.mreads)
            for (let i = 0n; i < BigInt(size); i++) MR.set(addr + i, Math.max(MR.get(addr + i) ?? -1, tm.t0 + off(slot)));
        for (const [slot, addr, size] of fx.mwrites)
            for (let i = 0n; i < BigInt(size); i++) MW.set(addr + i, Math.max(MW.get(addr + i) ?? -1, wt(slot)));
        if (fx.xwrite && fx.xwrite.reg !== 'x0') XW.set(fx.xwrite.reg, tm.done);
        const u = vc.units[tm.unit];
        assert.ok(u.classes.includes(inst.def.cls), `${label}: ${d.text} na unidade errada`);
        const occ = [tm.t0, u.pipelined ? tm.t0 + Math.max(1, tm.G) - 1 : tm.done];
        for (const [a, b] of busy[tm.unit]) assert.ok(occ[1] < a || occ[0] > b, `${label}: ${d.text} ocupou ${u.name} junto com outra instrução`);
        busy[tm.unit].push(occ);
    }
}

/** Executa uma instrução escalar no estado funcional (para checkTiming). */
function stepScalar(st, inst, xlen) {
    const d = inst.def;
    const read = (r) => (r === null ? null : r === 'x0' ? 0n : r[0] === 'x' ? st.x[+r.slice(1)] : st.f[+r.slice(1)]);
    const write = (r, v) => { if (r && r !== 'x0') (r[0] === 'x' ? st.x : st.f)[+r.slice(1)] = v; };
    const a = read(inst.rs1), b = read(inst.rs2), c = read(inst.rs3);
    switch (d.cls) {
        case 'system': return;
        case 'load': return write(inst.rd, memory.load(st.mem, effectiveAddress(inst, a, xlen), d.mem, xlen));
        case 'store': return memory.store(st.mem, effectiveAddress(inst, a, xlen), d.mem, b);
        case 'branch': case 'jump': {
            const r = resolveControl(inst, a, b, xlen);
            if (r.value !== null) write(inst.rd, r.value);
            return;
        }
        default: return write(inst.rd, d.exec(a, b, inst, xlen, c));
    }
}
