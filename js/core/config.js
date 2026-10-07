/**
 * Configuração dos modelos simulados. Cada modelo tem uma seção própria (vector, tpu); as latências
 * escalares, a frequência e o limite de ciclos são comuns.
 */
import { VECTOR_CLASSES } from '../riscv/vector.js';
import { DEFAULT_TPU, TPU_DTYPES } from '../riscv/tpu.js';
import { DEFAULT_GPU, SCHEDULERS, MAX_THREADS } from '../riscv/gpu.js';
import { t } from '../i18n/index.js';

/** Modelos, na ordem de exibição. */
export const MODE_IDS = ['vector', 'gpu', 'tpu'];

/** Classes escalares com latência configurável (desvios, saltos e vsetvli usam a da ALU). */
export const SCALAR_LATENCY_IDS = ['alu', 'mul', 'div', 'load', 'store', 'fadd', 'fmul', 'fdiv'];

/** Classes vetoriais (atendidas pelas unidades funcionais vetoriais). */
export const VECTOR_LATENCY_IDS = VECTOR_CLASSES;

/** Nome traduzido de uma classe de instrução. */
export const className = (cls) => t(`class.${cls}`);

/** Número máximo de lanes SIMD da GPU. */
export const MAX_GPU_LANES = 16;

/** Número máximo de lanes do processador vetorial. */
export const MAX_VECTOR_LANES = 8;

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
    gpu: { ...DEFAULT_GPU },
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

function normalizeGpu(pg, errors) {
    const d = DEFAULT_GPU;
    const warpSize = intIn(pg.warpSize, 1, 32, d.warpSize);
    const warps = intIn(pg.warps, 1, 16, d.warps);
    const g = {
        warps,
        warpSize,
        // Até 16 lanes SIMD, como na figura do Patterson e Hennessy; valores maiores (de links antigos) são limitados.
        lanes: Math.min(warpSize, MAX_GPU_LANES, intIn(pg.lanes, 1, 32, d.lanes)),
        scheduler: SCHEDULERS.includes(pg.scheduler) ? pg.scheduler : d.scheduler,
        memLatency: intIn(pg.memLatency, 1, 400, d.memLatency),
        lineBytes: [4, 8, 16, 32, 64, 128].includes(Number(pg.lineBytes)) ? Number(pg.lineBytes) : d.lineBytes,
        blocks: intIn(pg.blocks, 1, 256, d.blocks),
        maxWarps: intIn(pg.maxWarps, 1, 64, Math.max(d.maxWarps, warps)),
        smemBytes: intIn(pg.smemBytes, 0, 65536, d.smemBytes),
        smemBanks: [1, 2, 4, 8, 16, 32].includes(Number(pg.smemBanks)) ? Number(pg.smemBanks) : d.smemBanks,
        smemLatency: intIn(pg.smemLatency, 1, 100, d.smemLatency),
        l1: bool(pg.l1, d.l1),
        l1Bytes: [64, 128, 256, 512, 1024, 2048, 4096].includes(Number(pg.l1Bytes)) ? Number(pg.l1Bytes) : d.l1Bytes,
        l1Ways: [1, 2, 4, 8].includes(Number(pg.l1Ways)) ? Number(pg.l1Ways) : d.l1Ways,
        l1Latency: intIn(pg.l1Latency, 1, 100, d.l1Latency),
    };
    if (g.blocks * g.warps * g.warpSize > MAX_THREADS) errors.push(t('config.tooManyThreads', { n: g.blocks * g.warps * g.warpSize, max: MAX_THREADS }));
    if (g.warps > g.maxWarps) errors.push(t('config.blockWarps', { w: g.warps, max: g.maxWarps }));
    if (g.l1 && g.l1Bytes < g.lineBytes * g.l1Ways) errors.push(t('config.l1Small'));
    return g;
}

function normalizeTpu(pt) {
    const d = DEFAULT_TPU;
    return {
        n: intIn(pt.n, 2, 16, d.n),
        ubRows: intIn(pt.ubRows, 1, 256, d.ubRows),
        accRows: intIn(pt.accRows, 1, 256, d.accRows),
        fifoDepth: intIn(pt.fifoDepth, 1, 8, d.fifoDepth),
        memLatency: intIn(pt.memLatency, 1, 100, d.memLatency),
        actLatency: intIn(pt.actLatency, 1, 20, d.actLatency),
        dtype: TPU_DTYPES.includes(pt.dtype) ? pt.dtype : d.dtype,
        shift: intIn(pt.shift, 0, 24, d.shift),
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
            // Até 8 lanes, o que basta para fins didáticos e cabe no diagrama; valores maiores (de links antigos) são limitados.
            lanes: Math.min(MAX_VECTOR_LANES, intIn(pv.lanes, 1, 64, d.vector.lanes)),
            chaining: bool(pv.chaining, d.vector.chaining),
            stridedRate: intIn(pv.stridedRate, 1, 64, d.vector.stridedRate),
            units: [],
        },
        tpu: normalizeTpu(partial.tpu ?? {}),
        gpu: null,
        latency: {},
    };
    const gpuErrors = [];
    c.gpu = normalizeGpu(partial.gpu ?? {}, gpuErrors);
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
    // Erros de cada seção só importam no seu modelo.
    return { config: c, errors: c.mode === 'vector' ? errors : c.mode === 'gpu' ? gpuErrors : [] };
}

/**
 * Verifica se todas as classes vetoriais usadas pelo programa têm alguma unidade funcional que as execute.
 * @returns {string[]} erros
 */
export function checkProgram(program, config) {
    const errors = [];
    // Instruções de outro modelo: vetoriais só no processador vetorial, da TPU só na TPU.
    const owner = (d) => (d.vector ? 'vector' : d.tpu ? 'tpu' : d.gpu ? 'gpu' : null);
    const foreign = program.instructions.find((i) => owner(i.def) && owner(i.def) !== config.mode);
    if (foreign) errors.push(t('config.wrongModel', { inst: foreign.text, line: foreign.line, model: t(`mode.${config.mode}`) }));
    const smem = program.shared?.size ?? 0;
    if (smem > 0 && config.mode !== 'gpu') errors.push(t('config.sharedOnlyGpu'));
    if (config.mode === 'gpu' && smem > config.gpu.smemBytes) errors.push(t('config.sharedTooBig', { need: smem, have: config.gpu.smemBytes }));
    if (config.mode !== 'vector') return errors;
    const served = new Set(config.vector.units.flatMap((u) => u.classes));
    const missing = new Map();
    for (const inst of program.instructions) {
        const cls = inst.def.cls;
        if (VECTOR_CLASSES.includes(cls) && !served.has(cls) && !missing.has(cls)) missing.set(cls, inst);
    }
    return [...errors, ...[...missing].map(([cls, inst]) => t('config.classUnserved', { cls: className(cls), inst: inst.text, line: inst.line }))];
}
