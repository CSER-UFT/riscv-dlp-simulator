/** TPU: semântica das instruções, temporização calculada à mão e programas aleatórios. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runReference } from '../js/riscv/machine.js';
import { assemble } from '../js/riscv/parser.js';
import { simulate } from '../js/simulator.js';
import { DEFAULT_TPU } from '../js/riscv/tpu.js';
import { asm, TPU_CONFIGS, assertMatchesReference } from './helpers.js';

const DATA = `.data
A: .word 1, 2, 3, 4, 5, 6, 7, 8, -1, -2, -3, -4, 0, 1, 0, 1
B: .word 1, 0, 0, 0, 0, 2, 0, 0, 0, 0, 3, 0, 1, 1, 1, 1
C: .space 64
.text
la a0, A
la a1, B
la a2, C
`;
const num = (rows) => rows.map((r) => r.map(Number));

test('tpu.matmul, tpu.matmul.acc e tpu.act', () => {
    const r = runReference(asm(DATA + 'tpu.rdhost 0, (a0), 4\ntpu.rdw (a1)\ntpu.rdw (a1)\ntpu.matmul 0, 0, 4\ntpu.matmul.acc 0, 0, 4\ntpu.act 4, 0, 4, relu\ntpu.wrhost (a2), 4, 4'), {});
    assert.deepEqual(num(r.tpu.acc.slice(0, 4)), [[10, 16, 26, 8], [26, 40, 58, 16], [-10, -16, -26, -8], [2, 6, 2, 2]]);
    assert.deepEqual(num(r.tpu.ub.slice(4, 8)), [[10, 16, 26, 8], [26, 40, 58, 16], [0, 0, 0, 0], [2, 6, 2, 2]]);
});

test('erros: fila de pesos vazia, fila cheia e linha inexistente', () => {
    assert.equal(runReference(asm(DATA + 'tpu.matmul 0, 0, 1'), {}).error, true);
    assert.equal(runReference(asm(DATA + 'tpu.rdw (a1)\ntpu.rdw (a1)\ntpu.rdw (a1)'), {}).error, true);
    assert.equal(runReference(asm(DATA + 'tpu.rdhost 14, (a0), 4'), {}).error, true);
    const sim = simulate(asm(DATA + 'tpu.matmul 0, 0, 1'), { mode: 'tpu' });
    assert.ok(sim.finished && sim.warnings.length === 1);
});

test('montador: sintaxe da TPU e modelo errado', () => {
    const bad = assemble('tpu.act 0, 0, 4, tanh\ntpu.rdw 4(a0)\ntpu.matmul 0, 0, 0');
    assert.deepEqual(bad.errors.map((e) => e.line), [1, 2, 3]);
    assert.equal(simulate(asm('tpu.rdw (a0)'), { mode: 'vector' }).errors.length, 1);
    assert.equal(simulate(asm('vsetivli zero, 4, e32, m1, ta, ma'), { mode: 'tpu' }).errors.length, 1);
});

test('temporização: array sistólico com latência 2N menos 1 e ativação encadeada por linha', () => {
    const sim = simulate(asm(DATA + 'tpu.rdhost 0, (a0), 4\ntpu.rdw (a1)\ntpu.matmul 0, 0, 4\ntpu.act 4, 0, 4, relu\ntpu.wrhost (a2), 4, 4\nlw t0, 0(a2)'), { mode: 'tpu', trace: false });
    const ev = (i) => [sim.dyn[i].issue, sim.dyn[i].first, sim.dyn[i].commit];
    // rdhost em 7: linha r escrita no ciclo 7 + r + 5; rdw em 8: linha i dos pesos no ciclo 13 + i
    assert.deepEqual(ev(6), [7, 12, 15]);
    assert.deepEqual(ev(7), [8, 13, 16]);
    // os pesos entram no array de t0 menos 4 a t0 menos 1, depois de chegarem: t0 = 18; latência 2N menos 1 = 7
    assert.deepEqual(ev(8), [18, 24, 27]);
    // a ativação lê a linha 0 dos acumuladores no ciclo seguinte à escrita (24)
    assert.deepEqual(ev(9), [25, 26, 29]);
    assert.deepEqual(ev(10), [27, 32, 35]);
    assert.equal(sim.dyn[11].issue, 33);
    assert.equal(sim.stats.macs, 64);
});

test('buffer duplo de pesos: multiplicações seguidas separadas por max(linhas, N)', () => {
    const src = DATA + 'tpu.rdhost 0, (a0), 4\ntpu.rdw (a1)\ntpu.rdw (a1)\nli t0, 0\nli t0, 0\nli t0, 0\nli t0, 0\nli t0, 0\nli t0, 0\nli t0, 0\nli t0, 0\nli t0, 0\nli t0, 0\nli t0, 0\ntpu.matmul 0, 0, ROWS\ntpu.matmul 4, 0, ROWS';
    for (const [rows, gap] of [[1, 4], [2, 4], [4, 4]]) {
        const sim = simulate(asm(src.replace(/ROWS/g, rows)), { mode: 'tpu', trace: false });
        const mm = sim.dyn.filter((d) => d.text.startsWith('tpu.matmul'));
        assert.equal(mm[1].issue - mm[0].issue, gap, `${rows} linha(s)`);
    }
    const big = simulate(asm(src.replace(/ROWS/g, 4).replace('tpu.matmul 4, 0, 4', 'tpu.matmul 8, 0, 4').replace('tpu.matmul 0, 0, 4', 'tpu.matmul 0, 0, 4')), { mode: 'tpu', trace: false, tpu: { n: 2 } });
    const mm = big.dyn.filter((d) => d.text.startsWith('tpu.matmul'));
    assert.equal(mm[1].issue - mm[0].issue, 4);
});

test('lote maior aproveita melhor o array', () => {
    const one = simulate(asm(DATA + 'tpu.rdhost 0, (a0), 1\ntpu.rdw (a1)\ntpu.matmul 0, 0, 1'), { mode: 'tpu', trace: false });
    const many = simulate(asm(DATA + 'tpu.rdhost 0, (a0), 16\ntpu.rdw (a1)\ntpu.matmul 0, 0, 16'), { mode: 'tpu', trace: false });
    assert.ok(many.stats.macs / many.stats.cycles > 4 * (one.stats.macs / one.stats.cycles));
});

/** Gerador de programas aleatórios para a TPU (fila de pesos de até 2 blocos, linhas até 8). */
function prng(seed) {
    return () => {
        seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function generateTpu(seed) {
    const rnd = prng(seed);
    const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const words = Array.from({ length: 160 }, () => int(-9, 9));
    const lines = ['.data', `buf: .word ${words.join(', ')}`, 'out: .space 512', '.text', 'la s1, buf', 'la s2, out'];
    let fifo = 0;
    const n = int(10, 25);
    for (let k = 0; k < n; k++) {
        const x = rnd();
        const rows = int(1, 6);
        const r0 = () => int(0, 8 - rows);
        if (x < 0.15) lines.push(`addi a0, s1, ${int(0, 60) * 4}`, `tpu.rdhost ${r0()}, (a0), ${rows}`);
        else if (x < 0.30 && fifo < 2) { lines.push(`addi a1, s1, ${int(0, 60) * 4}`, 'tpu.rdw (a1)'); fifo++; }
        else if (x < 0.50 && fifo > 0) { lines.push(`tpu.matmul${rnd() < 0.4 ? '.acc' : ''} ${r0()}, ${r0()}, ${rows}`); fifo--; }
        else if (x < 0.65) lines.push(`tpu.act ${r0()}, ${r0()}, ${rows}, ${pick(['relu', 'none'])}`);
        else if (x < 0.78) lines.push(`addi a2, ${pick(['s1', 's2'])}, ${int(0, 60) * 4}`, `tpu.wrhost (a2), ${r0()}, ${rows}`);
        else if (x < 0.88) lines.push(`lw t0, ${int(0, 60) * 4}(${pick(['s1', 's2'])})`, `sw t0, ${int(0, 60) * 4}(${pick(['s1', 's2'])})`);
        else lines.push(`addi t1, t1, ${int(-5, 5)}`);
    }
    return lines.join('\n');
}

test('programas aleatórios: TPU = referência e regras de tempo em todas as configurações', () => {
    const N = Number(process.env.RANDOM_PROGRAMS ?? 80);
    for (let seed = 1; seed <= N; seed++) {
        const src = generateTpu(seed);
        const program = asm(src);
        for (const [name, config] of Object.entries(TPU_CONFIGS)) {
            try {
                assertMatchesReference(program, { ...config, trace: false }, `semente ${seed} / ${name}`);
            } catch (e) {
                e.message += `\n--- programa (semente ${seed}) ---\n${src}`;
                throw e;
            }
        }
    }
    assert.ok(DEFAULT_TPU.n >= 2);
});
