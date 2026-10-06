import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../js/examples.js';
import { asm, CONFIGS, TPU_CONFIGS, GPU_CONFIGS, assertMatchesReference } from './helpers.js';

test('todos os exemplos montam, terminam e coincidem com a referência em todas as configurações', () => {
    for (const ex of EXAMPLES) {
        const program = asm(ex.code);
        const configs = { tpu: TPU_CONFIGS, gpu: GPU_CONFIGS }[ex.config?.mode] ?? CONFIGS;
        for (const [name, config] of Object.entries(configs))
            assertMatchesReference(program, { ...config, mode: ex.config?.mode ?? 'vector', trace: false }, `${ex.id} / ${name}`);
    }
});

test('os exemplos produzem os resultados esperados', () => {
    const results = {};
    for (const ex of EXAMPLES) results[ex.id] = assertMatchesReference(asm(ex.code), { trace: false, ...(ex.config ?? {}) }, ex.id);
    const f32 = (sim, label, i) => {
        const p = sim.program.dataLabels.find((l) => l.name === label).addr + BigInt(4 * i);
        const v = new DataView(new ArrayBuffer(4));
        v.setUint32(0, Number([0, 1, 2, 3].reduce((acc, k) => acc | (BigInt(sim.final.mem.get(p + BigInt(k)) ?? 0) << BigInt(8 * k)), 0n)));
        return v.getFloat32(0);
    };
    assert.deepEqual(Array.from({ length: 32 }, (_, i) => f32(results.saxpy, 'y', i)), Array.from({ length: 32 }, (_, i) => 12 * (i + 1)));
    assert.deepEqual(Array.from({ length: 32 }, (_, i) => f32(results['saxpy-scalar'], 'y', i)), Array.from({ length: 32 }, (_, i) => 12 * (i + 1)));
    assert.deepEqual(Array.from({ length: 32 }, (_, i) => f32(results['saxpy-lmul'], 'y', i)), Array.from({ length: 32 }, (_, i) => 12 * (i + 1)));
    assert.ok(results['saxpy-lmul'].stats.instructions < results.saxpy.stats.instructions / 2);
    assert.equal(results.dot.final.f[10], 68);
    assert.equal(results.mask.final.x[10], 3n);
    assert.deepEqual(Array.from({ length: 4 }, (_, i) => f32(results.matvec, 'y', i)), [34.5, 39, 43.5, 48]);
    const i32 = (sim, label, i) => {
        const p = sim.program.dataLabels.find((l) => l.name === label).addr + BigInt(4 * i);
        return Number(BigInt.asIntN(32, [0, 1, 2, 3].reduce((acc, k) => acc | (BigInt(sim.final.mem.get(p + BigInt(k)) ?? 0) << BigInt(8 * k)), 0n)));
    };
    const mat = (sim, label, n) => Array.from({ length: n }, (_, i) => i32(sim, label, i));
    assert.deepEqual(mat(results['tpu-matmul'], 'C', 16), [5, 8, 13, 4, 13, 20, 29, 8, 0, 0, 0, 0, 1, 3, 1, 1]);
    assert.deepEqual(mat(results['tpu-small'], 'Y', 16), [1, 2, 3, 4, 2, 4, 6, 8, 4, 3, 2, 1, 10, 10, 10, 10]);
    // C = A0 x B0 + A1 x B1, conferido em Python
    assert.deepEqual(mat(results['tpu-ktile'], 'C', 16), [5, 6, 7, 8, 0, 2, 0, 2, 1, 2, 1, 2, 4, 0, 3, 0]);
    assert.equal(results['tpu-batch'].stats.macs, 12 * 16);
    const f32g = (sim, label, i) => {
        const p = sim.program.dataLabels.find((l) => l.name === label).addr + BigInt(4 * i);
        const v = new DataView(new ArrayBuffer(4));
        v.setUint32(0, Number([0, 1, 2, 3].reduce((acc, k) => acc | (BigInt(sim.final.mem.get(p + BigInt(k)) ?? 0) << BigInt(8 * k)), 0n)));
        return v.getFloat32(0);
    };
    assert.deepEqual(Array.from({ length: 32 }, (_, i) => f32g(results['gpu-saxpy'], 'y', i)), Array.from({ length: 32 }, (_, i) => 12 * (i + 1)));
    assert.deepEqual(mat(results['gpu-divergence'], 'v', 32), Array.from({ length: 32 }, (_, i) => (i % 2 ? i * i : i + 100)));
    assert.deepEqual(mat(results['gpu-reduction'], 'out', 4), [36, 100, 164, 228]);
    assert.equal(results['gpu-reduction'].stats.maxResident, 4);
    assert.equal(results['gpu-banks'].stats.maxDegree, 8);
    assert.equal(results['gpu-banks'].stats.bankConflicts, 7);
    assert.equal(results['gpu-coalescing'].stats.transactions, 48);
    assert.equal(results['gpu-divergence'].stats.divergent, 4);
    // A mesma GEMM nos três modelos dá o mesmo C (a TPU grava C em dois blocos de colunas).
    const A = Array.from({ length: 8 }, (_, i) => Array.from({ length: 8 }, (_, k) => ((i * 8 + k) % 7) - 3));
    const Bm = Array.from({ length: 8 }, (_, k) => Array.from({ length: 8 }, (_, j) => ((k + 2 * j) % 5) - 2));
    const C = A.map((row) => Bm[0].map((_, j) => row.reduce((acc, a, k) => acc + a * Bm[k][j], 0)));
    for (const id of ['gemm-vector', 'gemm-gpu', 'gemm-gpu-shared']) assert.deepEqual(mat(results[id], 'C', 64), C.flat(), id);
    const tpuC = C.map((row, i) => [...mat(results['gemm-tpu'], 'C0', 32).slice(4 * i, 4 * i + 4), ...mat(results['gemm-tpu'], 'C1', 32).slice(4 * i, 4 * i + 4)]);
    assert.deepEqual(tpuC, C);
});
