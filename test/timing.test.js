/**
 * Comportamento temporal do processador vetorial em programas pequenos, com os ciclos calculados à mão a
 * partir das convenções da ajuda (latências padrão: valu 2, vload 6, vstore 6, vmul 5, vdiv 16, vfadd 4).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate } from '../js/simulator.js';
import { EXAMPLES } from '../js/examples.js';
import { asm } from './helpers.js';

const run = (src, config = {}) => {
    const sim = simulate(asm(src), { trace: false, ...config });
    assert.deepEqual(sim.errors, []);
    return sim;
};
/** Ciclos [emissão, primeiro resultado, conclusão] da instrução de índice i (ordem de execução). */
const ev = (sim, i) => [sim.dyn[i].issue, sim.dyn[i].first, sim.dyn[i].commit];

test('uma instrução vetorial: vl ÷ lanes ciclos de entrada mais a latência de partida', () => {
    const sim = run('vsetivli zero, 8, e32, m1, ta, ma\nvadd.vv v3, v1, v2');
    assert.deepEqual(ev(sim, 1), [2, 3, 4]);
    assert.equal(sim.stats.cycles, 4);
    const one = run('vsetivli zero, 8, e32, m1, ta, ma\nvadd.vv v3, v1, v2', { vector: { lanes: 1 } });
    assert.deepEqual(ev(one, 1), [2, 3, 10]);
});

test('encadeamento: a consumidora começa no ciclo seguinte à escrita dos primeiros elementos', () => {
    const src = 'vsetivli zero, 8, e32, m1, ta, ma\nvle32.v v1, (a0)\nvadd.vv v2, v1, v1';
    const on = run(src);
    assert.deepEqual(ev(on, 1), [2, 7, 8]);
    assert.deepEqual(ev(on, 2), [8, 9, 10]);
    const off = run(src, { vector: { chaining: false } });
    assert.deepEqual(ev(off, 2), [9, 10, 11]);
    assert.equal(off.stats.stallRaw, 6);
});

test('conflito estrutural: uma única unidade de load e store', () => {
    const sim = run('vsetivli zero, 8, e32, m1, ta, ma\nvle32.v v1, (a0)\nvle32.v v2, (a1)');
    assert.equal(sim.dyn[2].issue, 4);
    assert.equal(sim.stats.stallStruct, 1);
});

test('unidade sem pipeline só aceita outra instrução quando a anterior termina', () => {
    const sim = run('vsetivli zero, 8, e32, m1, ta, ma\nvdiv.vv v3, v1, v2\nvdiv.vv v4, v1, v2');
    assert.deepEqual(ev(sim, 1), [2, 17, 18]);
    assert.equal(sim.dyn[2].issue, 19);
});

test('acesso com passo entrega um elemento por ciclo', () => {
    const sim = run('vsetivli zero, 8, e32, m1, ta, ma\nli t0, 8\nvlse32.v v1, (a0), t0');
    assert.deepEqual(ev(sim, 2), [3, 8, 15]);
    const fast = run('vsetivli zero, 8, e32, m1, ta, ma\nli t0, 8\nvlse32.v v1, (a0), t0', { vector: { stridedRate: 4 } });
    assert.deepEqual(ev(fast, 2), [3, 8, 9]);
});

test('redução: resultado no fim, depois da árvore entre as lanes', () => {
    const sim = run('vsetivli zero, 8, e32, m1, ta, ma\nvredsum.vs v2, v1, v3\nvmv.x.s a0, v2\naddi a1, a0, 1');
    // entrada em 2 e 3, latência 2 (último resultado no ciclo 4), mais log2(4) = 2 ciclos de árvore
    assert.deepEqual(ev(sim, 1), [2, 6, 6]);
    assert.deepEqual(ev(sim, 2), [7, 8, 8]);
    assert.equal(sim.dyn[3].issue, 9);
});

test('WAR: uma escrita rápida espera a leitura lenta de um store com passo', () => {
    const sim = run('vsetivli zero, 8, e32, m1, ta, ma\nli t0, 4\nvsse32.v v1, (a0), t0\nvadd.vv v1, v2, v2');
    // o store lê v1[7] no ciclo 3 + 7 = 10; o vadd escreve v1[7] no ciclo t0 + 1 + 1
    assert.equal(sim.dyn[2].issue, 3);
    assert.equal(sim.dyn[3].issue, 8);
    assert.equal(sim.stats.stallWar, 4);
});

test('WAW: uma escrita rápida não ultrapassa uma escrita lenta no mesmo registrador', () => {
    const sim = run('vsetivli zero, 8, e32, m1, ta, ma\nvle32.v v1, (a0)\nvadd.vv v1, v2, v2');
    // vle escreve v1[0..3] no ciclo 7 e v1[4..7] no 8; vadd (latência 2) precisa escrever depois
    assert.equal(sim.dyn[2].issue, 7);
});

test('dependência pela memória: load depois de store no mesmo endereço', () => {
    const sim = run('vsetivli zero, 8, e32, m1, ta, ma\nvse32.v v1, (a0)\nlw t0, 28(a0)');
    // o store começa no ciclo 2 e escreve os elementos 4..7 no fim do ciclo 3 + 6 menos 1 = 8; o lw para de 3 a 8
    assert.equal(sim.dyn[2].issue, 9);
    assert.equal(sim.stats.stallMem, 6);
});

test('desvio tomado custa as bolhas configuradas', () => {
    const src = 'li t0, 2\nl: addi t0, t0, -1\nbnez t0, l\naddi t1, t1, 1';
    const a = run(src);
    const b = run(src, { branchPenalty: 3 });
    assert.equal(b.stats.cycles - a.stats.cycles, 2);
    assert.equal(a.stats.bubbles, 1);
});

test('números citados na ajuda para os exemplos', () => {
    const cycles = (id, config = {}) => run(EXAMPLES.find((e) => e.id === id).code, config).stats.cycles;
    assert.equal(cycles('chaining'), 42);
    assert.equal(cycles('chaining', { vector: { chaining: false } }), 63);
    assert.deepEqual([1, 2, 4, 8].map((lanes) => cycles('lanes', { vector: { lanes } })), [109, 61, 37, 29]);
});

test('mais lanes nunca deixam um programa mais lento', () => {
    for (const ex of EXAMPLES.filter((e) => e.config?.mode === 'vector')) {
        let prev = Infinity;
        for (const lanes of [1, 2, 4, 8]) {
            const c = run(ex.code, { vector: { lanes } }).stats.cycles;
            assert.ok(c <= prev, `${ex.id}: ${lanes} lanes`);
            prev = c;
        }
    }
});
