/**
 * Configuração dos modelos simulados.
 *
 * Por enquanto há um modelo, o processador vetorial; os modelos de GPU e TPU usarão o mesmo formato, com
 * uma seção própria cada.
 */
import { VECTOR_CLASSES } from '../riscv/vector.js';
import { t } from '../i18n/index.js';

/** Modelos, na ordem de exibição. */
export const MODE_IDS = ['vector'];

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
    return { config: c, errors };
}

/**
 * Verifica se todas as classes vetoriais usadas pelo programa têm alguma unidade funcional que as execute.
 * @returns {string[]} erros
 */
export function checkProgram(program, config) {
    const served = new Set(config.vector.units.flatMap((u) => u.classes));
    const missing = new Map();
    for (const inst of program.instructions) {
        const cls = inst.def.cls;
        if (VECTOR_CLASSES.includes(cls) && !served.has(cls) && !missing.has(cls)) missing.set(cls, inst);
    }
    return [...missing].map(([cls, inst]) => t('config.classUnserved', { cls: className(cls), inst: inst.text, line: inst.line }));
}
