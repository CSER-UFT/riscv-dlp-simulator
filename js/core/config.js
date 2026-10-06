/**
 * Configuração dos modelos simulados. Cada modelo tem uma seção própria (vector, tpu); as latências
 * escalares, a frequência e o limite de ciclos são comuns.
 */
import { VECTOR_CLASSES } from '../riscv/vector.js';
import { DEFAULT_TPU } from '../riscv/tpu.js';
import { t } from '../i18n/index.js';

/** Modelos, na ordem de exibição. */
export const MODE_IDS = ['vector', 'tpu'];

/** Classes escalares com latência configurável (desvios, saltos e vsetvli usam a da ALU). */
export const SCALAR_LATENCY_IDS = ['alu', 'mul', 'div', 'load', 'store', 'fadd', 'fmul', 'fdiv'];

/** Classes vetoriais (atendidas pelas unidades funcionais vetoriais). */
export const VECTOR_LATENCY_IDS = VECTOR_CLASSES;

/** Nome traduzido de uma classe de instrução. */
export const className = (cls) => t(`class.${cls}`);

export const DEFAULT_CONFIG = {
    mode: 'vector',
    xlen: 32,
    maxCycles: 5000,
    exampleValues: true,
    freqGHz: 1,
    branchPenalty: 1,
    vector: {
        vlen: 256,
        lanes: 4,
        chaining: true,
        stridedRate: 1,
        units: [
            { name: 'LSU', classes: ['vload', 'vstore'], pipelined: true },
            { name: 'ALU', classes: ['valu', 'vfadd'], pipelined: true },
            { name: 'MUL', classes: ['vmul', 'vfmul'], pipelined: true },
            { name: 'DIV', classes: ['vdiv', 'vfdiv'], pipelined: false },
        ],
    },
    tpu: { ...DEFAULT_TPU },
    latency: {
        alu: 1, mul: 3, div: 10, load: 2, store: 1, fadd: 3, fmul: 4, fdiv: 10,
        vload: 6, vstore: 6, valu: 2, vmul: 5, vdiv: 16, vfadd: 4, vfmul: 5, vfdiv: 16,
    },
};

const intIn = (v, lo, hi, def) => {
    const n = Math.trunc(Number(v));
    return Number.isFinite(n) && n >= lo && n <= hi ? n : def;
};
const bool = (v, def) => (v === undefined ? def : Boolean(v));
const isPow2 = (n) => n > 0 && (n & (n - 1)) === 0;

function normalizeTpu(pt) {
    const d = DEFAULT_TPU;
    return {
        n: intIn(pt.n, 2, 16, d.n),
        ubRows: intIn(pt.ubRows, 1, 256, d.ubRows),
        accRows: intIn(pt.accRows, 1, 256, d.accRows),
        fifoDepth: intIn(pt.fifoDepth, 1, 8, d.fifoDepth),
        memLatency: intIn(pt.memLatency, 1, 100, d.memLatency),
        actLatency: intIn(pt.actLatency, 1, 20, d.actLatency),
    };
}

/**
 * Completa uma configuração parcial com os valores padrão e normaliza os campos.
 * @returns {{config: object, errors: string[]}}
 */
export function normalizeConfig(partial = {}) {
    const d = DEFAULT_CONFIG;
    const errors = [];
    const pv = partial.vector ?? {};
    const f = Number(partial.freqGHz);
    const c = {
        mode: MODE_IDS.includes(partial.mode) ? partial.mode : d.mode,
        xlen: Number(partial.xlen) === 64 ? 64 : 32,
        maxCycles: intIn(partial.maxCycles, 1, 100000, d.maxCycles),
        exampleValues: bool(partial.exampleValues, d.exampleValues),
        freqGHz: Number.isFinite(f) && f > 0 && f <= 100 ? f : d.freqGHz,
        branchPenalty: intIn(partial.branchPenalty, 0, 20, d.branchPenalty),
        vector: {
            vlen: intIn(pv.vlen, 64, 4096, d.vector.vlen),
            lanes: intIn(pv.lanes, 1, 64, d.vector.lanes),
            chaining: bool(pv.chaining, d.vector.chaining),
            stridedRate: intIn(pv.stridedRate, 1, 64, d.vector.stridedRate),
            units: [],
        },
        tpu: normalizeTpu(partial.tpu ?? {}),
        latency: {},
    };
    if (!isPow2(c.vector.vlen)) errors.push(t('config.vlenPow2'));
    for (const k of [...SCALAR_LATENCY_IDS, ...VECTOR_LATENCY_IDS])
        c.latency[k] = intIn(partial.latency?.[k], 1, 100, d.latency[k]);

    const names = new Set();
    for (const u of pv.units ?? d.vector.units) {
        const name = String(u.name ?? '').trim().replace(/[^\w]/g, '');
        if (!name) { errors.push(t('config.unitNoName')); continue; }
        if (names.has(name)) { errors.push(t('config.unitRepeated', { name })); continue; }
        names.add(name);
        const classes = (u.classes ?? []).filter((x) => VECTOR_CLASSES.includes(x));
        if (classes.length === 0) errors.push(t('config.unitNoClass', { name }));
        c.vector.units.push({ name, classes, pipelined: bool(u.pipelined, true) });
    }
    if (c.vector.units.length === 0) errors.push(t('config.noUnits'));
    // Erros da seção vetorial só importam no modelo vetorial.
    return { config: c, errors: c.mode === 'vector' ? errors : [] };
}

/**
 * Verifica se todas as classes vetoriais usadas pelo programa têm alguma unidade funcional que as execute.
 * @returns {string[]} erros
 */
export function checkProgram(program, config) {
    const errors = [];
    // Instruções de outro modelo: vetoriais só no processador vetorial, da TPU só na TPU.
    const foreign = program.instructions.find((i) => (config.mode === 'vector' && i.def.tpu) || (config.mode !== 'vector' && i.def.vector));
    if (foreign) errors.push(t('config.wrongModel', { inst: foreign.text, line: foreign.line, model: t(`mode.${config.mode}`) }));
    if (config.mode !== 'vector') return errors;
    const served = new Set(config.vector.units.flatMap((u) => u.classes));
    const missing = new Map();
    for (const inst of program.instructions) {
        const cls = inst.def.cls;
        if (VECTOR_CLASSES.includes(cls) && !served.has(cls) && !missing.has(cls)) missing.set(cls, inst);
    }
    return [...errors, ...[...missing].map(([cls, inst]) => t('config.classUnserved', { cls: className(cls), inst: inst.text, line: inst.line }))];
}
