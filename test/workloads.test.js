/** Comparação entre modelos: todas as versões executam e os números citados nos exemplos conferem. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WORKLOADS, runWorkload } from '../js/core/workloads.js';
import { EXAMPLES } from '../js/examples.js';
import { simulate } from '../js/simulator.js';
import { asm } from './helpers.js';

test('todas as versões das cargas de trabalho executam até o fim', () => {
    for (const w of WORKLOADS) {
        for (const r of runWorkload(w)) {
            if (r.na) continue;
            assert.equal(r.error, undefined, `${w.id}/${r.example}`);
            assert.ok(r.sim.finished, `${w.id}/${r.example}`);
            assert.ok((r.variant === 'scalar' || r.metric.value > 0) && r.metric.value <= 1, `${w.id}/${r.example}: métrica ${r.metric.value}`);
        }
    }
    const gemm = runWorkload(WORKLOADS.find((w) => w.id === 'gemm'));
    const tpu = gemm.find((r) => r.model === 'tpu');
    assert.ok(gemm.every((r) => r === tpu || r.cycles > 5 * tpu.cycles), 'a TPU é bem mais rápida na GEMM');
});

test('GEMM na GPU: números citados no exemplo com memória compartilhada', () => {
    const run = (id) => simulate(asm(EXAMPLES.find((e) => e.id === id).code), { mode: 'gpu', gpu: { blocks: 1, warps: 2 }, trace: false });
    const g = run('gemm-gpu'), s = run('gemm-gpu-shared');
    assert.deepEqual([g.stats.transactions, g.stats.cycles], [136, 1265]);
    assert.deepEqual([s.stats.transactions, s.stats.cycles], [24, 959]);
});

test('perguntas do exercício: respostas conferem com a simulação', async () => {
    const { buildQuestions, checkAnswer, answerText } = await import('../js/ui/questions.js');
    for (const ex of EXAMPLES) {
        const sim = simulate(asm(ex.code), { ...(ex.config ?? {}), trace: false });
        const qs = buildQuestions(sim);
        assert.ok(qs.length >= 1 && qs.length <= 8, ex.id);
        for (const q of qs) {
            assert.ok(checkAnswer(q, answerText(q)), `${ex.id}: ${q.text}`);
            assert.ok(!checkAnswer(q, ''), ex.id);
        }
    }
    const div = buildQuestions(simulate(asm(EXAMPLES.find((e) => e.id === 'gpu-divergence').code), { mode: 'gpu', trace: false }));
    const mask = div.find((q) => q.kind === 'mask');
    assert.equal(mask.answer, '10101010');
    assert.ok(checkAnswer(mask, '1010 1010'));
    const reconv = div.find((q) => q.kind === 'addr');
    assert.ok(checkAnswer(reconv, `0x${reconv.answer.toString(16)}`));
    const banks = buildQuestions(simulate(asm(EXAMPLES.find((e) => e.id === 'gpu-banks').code), { mode: 'gpu', gpu: { warps: 1, warpSize: 8 }, trace: false }));
    assert.equal(banks.find((q) => q.text.includes('conflito') || q.text.includes('conflict')).answer, 8);
});
