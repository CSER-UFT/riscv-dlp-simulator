/**
 * Cargas de trabalho comparáveis entre os modelos: o mesmo cálculo escrito para o processador vetorial, a
 * GPU e a TPU (exemplos em examples.js), com o número de operações úteis para calcular a vazão.
 */
import { EXAMPLES } from '../examples.js';
import { assemble } from '../riscv/parser.js';
import { simulate } from '../simulator.js';
import { normalizeConfig } from './config.js';

/**
 * Cada carga lista as versões (modelo, exemplo e variante); `example: null` indica que o modelo não executa
 * esse cálculo. `ops` conta multiplicações e somas úteis (um MAC são duas operações).
 */
export const WORKLOADS = [
    {
        id: 'saxpy',
        ops: 64,
        versions: [
            { model: 'vector', example: 'saxpy' },
            { model: 'vector', example: 'saxpy-scalar', variant: 'scalar' },
            { model: 'gpu', example: 'gpu-saxpy' },
            { model: 'tpu', example: null },
        ],
    },
    {
        id: 'gemm',
        ops: 1024,
        versions: [
            { model: 'vector', example: 'gemm-vector' },
            { model: 'gpu', example: 'gemm-gpu' },
            { model: 'gpu', example: 'gemm-gpu-shared', variant: 'shared' },
            { model: 'tpu', example: 'gemm-tpu' },
        ],
    },
];

/** Configuração de um exemplo: a padrão com os ajustes do exemplo. */
export function exampleConfig(ex) {
    return normalizeConfig(ex.config ?? {}).config;
}

/** Métrica própria de cada modelo: chave de tradução e valor entre 0 e 1. */
export function nativeMetric(sim) {
    const s = sim.stats;
    if (sim.model === 'gpu') return { key: 'models.metric.gpu', value: s.instructions ? s.threadInstructions / (s.instructions * sim.config.gpu.warpSize) : 0 };
    if (sim.model === 'tpu') return { key: 'models.metric.tpu', value: s.cycles ? s.macs / (s.cycles * sim.config.tpu.n ** 2) : 0 };
    const v = sim.config.vector;
    const best = Math.max(0, ...s.unitSlots);
    return { key: 'models.metric.vector', value: s.cycles ? best / (s.cycles * v.lanes) : 0 };
}

/** Executa todas as versões de uma carga; devolve uma linha por versão. */
export function runWorkload(w) {
    return w.versions.map((v) => {
        if (!v.example) return { ...v, na: true };
        const ex = EXAMPLES.find((e) => e.id === v.example);
        const config = exampleConfig(ex);
        const sim = simulate(assemble(ex.code, { xlen: config.xlen }), { ...config, trace: false });
        if (sim.errors?.length) return { ...v, error: sim.errors.join(' ') };
        return {
            ...v,
            ex,
            config,
            sim,
            cycles: sim.stats.cycles,
            timeNs: sim.timing.timeNs,
            instructions: sim.stats.instructions,
            opsPerCycle: sim.stats.cycles ? w.ops / sim.stats.cycles : 0,
            metric: nativeMetric(sim),
        };
    });
}
