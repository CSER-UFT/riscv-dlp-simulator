/** Exportação do estado de um ciclo em LaTeX/TikZ para todos os exemplos e nos dois idiomas. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../js/examples.js';
import { simulate } from '../js/simulator.js';
import { assemble } from '../js/riscv/parser.js';
import { createContext } from '../js/ui/panels.js';
import { stateLatex } from '../js/ui/export-state.js';
import { eventsLatex, timelineLatex } from '../js/ui/export.js';
import { setLanguage } from '../js/i18n/index.js';

/** Chaves balanceadas, sem contar as escapadas (\{ e \}). */
function balanced(s) {
    let depth = 0;
    const clean = s.replace(/\\[{}]/g, '');
    for (const ch of clean) {
        if (ch === '{') depth++;
        else if (ch === '}' && --depth < 0) return false;
    }
    return depth === 0;
}

for (const lang of ['pt', 'en']) {
    test(`estado em LaTeX (${lang}): todos os exemplos, vários ciclos`, () => {
        setLanguage(lang);
        for (const ex of EXAMPLES) {
            const sim = simulate(assemble(ex.code), ex.config);
            assert.deepEqual(sim.errors, [], ex.id);
            const ctx = createContext(sim);
            for (const k of [0, Math.floor(sim.states.length / 3), Math.floor((2 * sim.states.length) / 3), sim.states.length - 1]) {
                const s = stateLatex(ctx, sim.states[k]);
                assert.ok(balanced(s), `${ex.id}, ciclo ${k}: chaves desbalanceadas`);
                assert.ok(!/undefined|NaN|\[object/.test(s), `${ex.id}, ciclo ${k}: valor ausente`);
                assert.doesNotMatch(s, /[–—]/, `${ex.id}: travessão`);
                if (s.includes('\\begin{tabular}')) assert.match(s, /\\rowcolor\{tabAzul\}/);
                assert.doesNotMatch(s, /toprule|midrule|bottomrule/);
                if (sim.model === 'tpu') assert.match(s, /tikzpicture/);
            }
            assert.ok(balanced(eventsLatex(sim)) && balanced(timelineLatex(sim)), ex.id);
        }
        setLanguage('pt');
    });
}
