/**
 * Figuras em SVG: os diagramas de blocos do processador vetorial, da GPU e da TPU são desenhados em todos os passos
 * dos exemplos, sem valores indefinidos e com o SVG bem formado (tags balanceadas).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../js/examples.js';
import { assemble } from '../js/riscv/parser.js';
import { simulate } from '../js/simulator.js';
import { createContext } from '../js/ui/panels.js';
import { vectorSvg } from '../js/ui/vector-svg.js';
import { gpuSvg } from '../js/ui/gpu-svg.js';
import { tpuSvg } from '../js/ui/tpu-svg.js';

function check(svg, label) {
    assert.doesNotMatch(svg, /undefined|NaN|\[object/, label);
    for (const tag of ['g', 'svg']) {
        const open = (svg.match(new RegExp(`<${tag}[\\s>]`, 'g')) ?? []).length;
        const close = (svg.match(new RegExp(`</${tag}>`, 'g')) ?? []).length;
        assert.equal(open, close, `${label}: <${tag}> desbalanceado`);
    }
}

for (const [mode, draw] of [['vector', vectorSvg], ['gpu', gpuSvg], ['tpu', tpuSvg]]) {
    test(`figura do modelo ${mode} em todos os passos dos exemplos`, () => {
        let drawn = 0;
        for (const ex of EXAMPLES) {
            if ((ex.config?.mode ?? 'vector') !== mode) continue;
            const program = assemble(ex.code);
            if (program.errors?.length) continue;
            const sim = simulate(program, { ...ex.config, maxCycles: 600 });
            if (sim.errors?.length) continue;
            const ctx = createContext(sim);
            const snaps = [...sim.states, ...sim.interStates.flat().map(([, s]) => s)];
            for (const snap of snaps) { check(draw(ctx, snap, new Set(snap.focus ?? [])), `${ex.id} ciclo ${snap.cycle}`); drawn++; }
        }
        assert.ok(drawn > 200, `poucos passos desenhados: ${drawn}`);
    });
}
