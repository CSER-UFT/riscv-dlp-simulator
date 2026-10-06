import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../js/examples.js';
import { asm, CONFIGS, assertMatchesReference } from './helpers.js';

test('todos os exemplos montam, terminam e coincidem com a referência em todas as configurações', () => {
    for (const ex of EXAMPLES) {
        const program = asm(ex.code);
        for (const [name, config] of Object.entries(CONFIGS))
            assertMatchesReference(program, { ...config, ...(ex.config ?? {}), trace: false }, `${ex.id} / ${name}`);
    }
});

test('os exemplos produzem os resultados esperados', () => {
    const results = {};
    for (const ex of EXAMPLES) results[ex.id] = assertMatchesReference(asm(ex.code), { trace: false }, ex.id);
    const f32 = (sim, label, i) => {
        const p = sim.program.dataLabels.find((l) => l.name === label).addr + BigInt(4 * i);
        const v = new DataView(new ArrayBuffer(4));
        v.setUint32(0, Number([0, 1, 2, 3].reduce((acc, k) => acc | (BigInt(sim.final.mem.get(p + BigInt(k)) ?? 0) << BigInt(8 * k)), 0n)));
        return v.getFloat32(0);
    };
    assert.deepEqual(Array.from({ length: 12 }, (_, i) => f32(results.saxpy, 'y', i)), [12, 24, 36, 48, 60, 72, 84, 96, 108, 120, 132, 144]);
    assert.deepEqual(Array.from({ length: 12 }, (_, i) => f32(results['saxpy-scalar'], 'y', i)), [12, 24, 36, 48, 60, 72, 84, 96, 108, 120, 132, 144]);
    assert.equal(results.dot.final.f[10], 68);
    assert.equal(results.mask.final.x[10], 3n);
    assert.deepEqual(Array.from({ length: 4 }, (_, i) => f32(results.matvec, 'y', i)), [34.5, 39, 43.5, 48]);
});
