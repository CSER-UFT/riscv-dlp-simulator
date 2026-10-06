/** GPU: semântica SIMT, pós dominadores, temporização calculada à mão e programas aleatórios. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate } from '../js/simulator.js';
import { runGpuReference, immediatePostDominators, DEFAULT_GPU } from '../js/riscv/gpu.js';
import { asm, GPU_CONFIGS, assertMatchesReference } from './helpers.js';

const gpu = (src, cfg = {}) => {
    const sim = simulate(asm(src), { mode: 'gpu', trace: false, ...cfg });
    assert.deepEqual(sim.errors, []);
    return sim;
};

test('identificadores das threads', () => {
    const r = runGpuReference(asm('gpu.tid a0\ngpu.ntid a1\ngpu.wid a2\ngpu.lane a3'), { ...DEFAULT_GPU, warps: 2, warpSize: 4 });
    assert.deepEqual(r.threads.map((th) => [th.x[10], th.x[11], th.x[12], th.x[13]].map(Number)), [
        [0, 8, 0, 0], [1, 8, 0, 1], [2, 8, 0, 2], [3, 8, 0, 3], [4, 8, 1, 0], [5, 8, 1, 1], [6, 8, 1, 2], [7, 8, 1, 3],
    ]);
});

test('pós dominadores imediatos: if, if/else e laço', () => {
    const p = asm('beqz a0, f\naddi a1, a1, 1\nf: addi a2, a2, 1\nbnez a2, e\naddi a3, a3, 1\nj g\ne: addi a4, a4, 1\ng: addi a5, a5, -1\nbnez a5, g\necall');
    assert.deepEqual(immediatePostDominators(p), [2, 2, 3, 7, 5, 7, 7, 8, 9, -1]);
});

test('divergência: os dois caminhos em sequência e reconvergência', () => {
    const sim = gpu('gpu.lane t0\nandi t1, t0, 1\nbeqz t1, par\naddi t2, zero, 7\nj fim\npar: addi t2, zero, 9\nfim: addi t3, t2, 0', { gpu: { warps: 1, warpSize: 4 } });
    const masks = sim.dyn.map((d) => [d.text.split(': ')[1].split(' ')[0], d.mask]);
    assert.deepEqual(masks, [['gpu.lane', '1111'], ['andi', '1111'], ['beq', '1111'], ['addi', '1010'], ['addi', '0101'], ['jal', '0101'], ['addi', '1111']]);
    assert.deepEqual(sim.final.threads.map((th) => Number(th.x[28])), [9, 7, 9, 7]);
    assert.equal(sim.stats.divergent, 1);
});

test('laço com número de voltas diferente por thread', () => {
    const src = 'gpu.lane t0\nli t1, 0\nl: addi t1, t1, 2\naddi t0, t0, -1\nbgez t0, l\naddi t2, t1, 0';
    assert.deepEqual(gpu(src, { gpu: { warps: 1, warpSize: 4 } }).final.threads.map((th) => Number(th.x[7])), [2, 4, 6, 8]);
});

test('salto indireto divergente é rejeitado', () => {
    const sim = gpu('gpu.lane t0\nslli t0, t0, 2\nla t1, a\nadd t1, t1, t0\njalr t1\na: nop\nnop\nnop\nnop', { gpu: { warps: 1, warpSize: 4 } });
    assert.equal(sim.warnings.length, 1);
});

test('temporização: uma emissão por ciclo, rodízio entre warps e unidades com menos vias', () => {
    const src = 'gpu.tid t0\naddi t1, t0, 1\necall';
    const a = gpu(src, { gpu: { warps: 2, warpSize: 8 } });
    assert.deepEqual(a.dyn.map((d) => [d.text.slice(0, 2), d.issue]), [['w0', 1], ['w1', 2], ['w0', 3], ['w1', 4], ['w0', 5], ['w1', 6]]);
    // Com 4 vias, cada instrução ocupa a ALU por 2 ciclos.
    const b = gpu(src, { gpu: { warps: 2, warpSize: 8, lanes: 4 } });
    assert.deepEqual(b.dyn.map((d) => d.issue), [1, 3, 5, 7, 9, 11]);
    assert.equal(b.stats.cycles, 12);
});

test('latência da memória e coalescência', () => {
    const data = '.data\n.align 5\nv: .word 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16\n.text\n';
    const unit = gpu(data + 'gpu.lane t0\nslli t0, t0, 2\nla t1, v\nadd t1, t1, t0\nlw t2, 0(t1)\naddi t3, t2, 0', { gpu: { warps: 1, warpSize: 8, memLatency: 10 } });
    const ld = unit.dyn[5];
    assert.equal(unit.stats.transactions, 1);
    assert.equal(ld.commit, ld.issue + 10 - 1);
    assert.equal(unit.dyn[6].issue, ld.commit + 1);
    const strided = gpu(data + 'gpu.lane t0\nslli t0, t0, 3\nla t1, v\nadd t1, t1, t0\nlw t2, 0(t1)', { gpu: { warps: 1, warpSize: 8, memLatency: 10, lineBytes: 16 } });
    assert.equal(strided.stats.transactions, 4);
    assert.equal(strided.dyn[5].commit, strided.dyn[5].issue + 4 - 1 + 10 - 1);
});

test('mais warps escondem a latência da memória', () => {
    const src = '.data\nx: .space 512\n.text\ngpu.tid t0\ngpu.ntid t1\nla t2, x\nli t3, 64\nl: bge t0, t3, f\nslli t4, t0, 2\nadd t4, t2, t4\nlw t5, 0(t4)\naddi t5, t5, 1\nsw t5, 0(t4)\nadd t0, t0, t1\nj l\nf: ecall';
    const one = gpu(src, { gpu: { warps: 1 } }).stats.cycles;
    const four = gpu(src, { gpu: { warps: 4 } }).stats.cycles;
    assert.ok(four < one * 0.6, `${four} contra ${one}`);
});

test('GTO repete o mesmo warp enquanto ele estiver pronto', () => {
    const src = 'addi t0, zero, 1\naddi t1, zero, 2\naddi t2, zero, 3';
    const g = gpu(src, { gpu: { warps: 2, warpSize: 4, scheduler: 'gto' } });
    assert.deepEqual(g.dyn.map((d) => d.warp), [0, 0, 0, 1, 1, 1]);
    const r = gpu(src, { gpu: { warps: 2, warpSize: 4, scheduler: 'rr' } });
    assert.deepEqual(r.dyn.map((d) => d.warp), [0, 1, 0, 1, 0, 1]);
});

test('barreira: nenhum warp passa antes de todos chegarem', () => {
    const sim = gpu('gpu.wid t0\nbeqz t0, b\nli t1, 30\nl: addi t1, t1, -1\nbnez t1, l\nb: gpu.bar\naddi t2, zero, 1', { gpu: { warps: 3, warpSize: 2 } });
    const bars = sim.dyn.filter((d) => d.text.includes('gpu.bar')).map((d) => d.issue);
    const after = sim.dyn.filter((d) => d.text.includes('addi t2')).map((d) => d.issue);
    assert.ok(Math.min(...after) > Math.max(...bars));
});

/** Gerador de kernels sem condição de corrida: cada thread escreve só na sua área de 8 palavras. */
function prng(seed) {
    return () => {
        seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function generateGpu(seed) {
    const rnd = prng(seed);
    const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const R = ['t0', 't1', 't2', 't3', 'a0', 'a1'];
    let label = 0;
    const lines = ['.data', `inp: .word ${Array.from({ length: 64 }, () => int(-50, 50)).join(', ')}`, `finp: .float ${Array.from({ length: 8 }, () => (int(-40, 40) / 4).toFixed(2)).join(', ')}`,
        'out: .space 2048', '.text', 'gpu.tid s0', 'gpu.ntid s1', 'la s2, inp', 'la s3, out', 'slli s4, s0, 5', 'add s4, s3, s4', 'la s5, finp', 'flw fa0, 0(s5)'];
    const op = () => {
        const k = rnd();
        const rd = pick(R), a = pick([...R, 's0']), b = pick([...R, 's0']);
        if (k < 0.35) return [`${pick(['add', 'sub', 'xor', 'and', 'mul', 'slt'])} ${rd}, ${a}, ${b}`];
        if (k < 0.5) return [`addi ${rd}, ${a}, ${int(-9, 9)}`];
        if (k < 0.6) return [`lw ${rd}, ${int(0, 63) * 4}(s2)`];
        if (k < 0.7) return [`andi ${rd}, ${a}, 63`, `slli ${rd}, ${rd}, 2`, `add ${rd}, s2, ${rd}`, `lw ${rd}, 0(${rd})`];
        if (k < 0.8) return [`sw ${a}, ${int(0, 7) * 4}(s4)`];
        if (k < 0.87) return [`lw ${rd}, ${int(0, 7) * 4}(s4)`];
        if (k < 0.93) return [`fcvt.s.w ft0, ${a}`, `fmadd.s fa0, ft0, fa0, fa0`, `fsw fa0, ${int(0, 7) * 4}(s4)`];
        return [`div ${rd}, ${a}, ${b}`];
    };
    const block = (depth) => {
        const out = [];
        const n = int(2, 6);
        for (let i = 0; i < n; i++) {
            const k = rnd();
            if (k < 0.15 && depth < 2) {
                const l = `L${label++}`;
                out.push(`andi t4, ${pick(['s0', ...R])}, ${pick([1, 2, 3, 4, 7])}`, `beqz t4, ${l}`, ...block(depth + 1), `${l}:`);
            } else if (k < 0.25 && depth < 2) {
                const e = `E${label++}`, j = `J${label++}`;
                out.push(`andi t4, ${pick(['s0', ...R])}, ${pick([1, 3, 5])}`, `bnez t4, ${e}`, ...block(depth + 1), `j ${j}`, `${e}:`, ...block(depth + 1), `${j}:`);
            } else if (k < 0.32 && depth < 2) {
                const l = `L${label++}`;
                const cnt = depth === 0 ? 't5' : 't6';
                out.push(`andi ${cnt}, ${pick(['s0', ...R])}, 3`, `addi ${cnt}, ${cnt}, 1`, `${l}:`, ...block(depth + 1), `addi ${cnt}, ${cnt}, -1`, `bnez ${cnt}, ${l}`);
            } else if (k < 0.36 && depth === 0) {
                out.push('gpu.bar');
            } else if (k < 0.38 && depth === 1) {
                out.push(`sw s0, 0(s4)`, 'ecall');
            } else {
                out.push(...op());
            }
        }
        return out;
    };
    lines.push(...block(0), 'ecall');
    return lines.join('\n');
}

test('programas aleatórios: GPU = referência (threads em sequência) e regras de tempo', () => {
    const N = Number(process.env.RANDOM_PROGRAMS ?? 80);
    for (let seed = 1; seed <= N; seed++) {
        const src = generateGpu(seed);
        const program = asm(src);
        for (const [name, config] of Object.entries(GPU_CONFIGS)) {
            try {
                assertMatchesReference(program, { ...config, trace: false }, `semente ${seed} / ${name}`);
            } catch (e) {
                e.message += `\n--- programa (semente ${seed}) ---\n${src}`;
                throw e;
            }
        }
    }
});
