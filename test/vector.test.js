/** Semântica das instruções vetoriais no simulador funcional de referência. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runReference } from '../js/riscv/machine.js';
import { assemble } from '../js/riscv/parser.js';
import { getRaw, rawToValue, maskBit } from '../js/riscv/vector.js';
import { asm, CONFIGS, assertMatchesReference } from './helpers.js';
import { simulate } from '../js/simulator.js';

function run(src, { vlen = 256, xlen = 32 } = {}) {
    const r = runReference(asm(src, { xlen }), { exampleValues: false, vlen });
    const elems = (reg, sew, type = 'i', n = vlen / sew) => Array.from({ length: n }, (_, e) => {
        const v = rawToValue(getRaw(r.v[+reg.slice(1)], e, sew), type, sew);
        return type === 'f' ? v : Number(v);
    });
    const bits = (reg, n) => Array.from({ length: n }, (_, e) => maskBit(r.v[+reg.slice(1)], e));
    return { r, elems, bits, x: (i) => r.x[i], f: (i) => r.f[i] };
}

const DATA = `.data
a: .word 1, -2, 3, -4, 5, -6, 7, -8
b: .word 10, 20, 30, 40, 50, 60, 70, 80
f: .float 1.5, 2.5, -3.0, 4.0
.text
la s1, a
la s2, b
la s3, f
`;

test('vsetvli: vl = min(AVL, VLMAX), rs1 = zero escolhe VLMAX', () => {
    const t = run(`li a0, 20\nvsetvli t0, a0, e32, m1, ta, ma\nvsetvli t1, zero, e8, m1, ta, ma\nli a1, 5\nvsetvli t2, a1, e64, m1, ta, ma\nvsetivli t3, 3, e16, m1, ta, ma`);
    assert.deepEqual([t.x(5), t.x(6), t.x(7), t.x(28)], [8n, 32n, 4n, 3n]);
    assert.equal(t.r.vl, 3);
});

test('aritmética inteira .vv, .vx e .vi, com cauda preservada', () => {
    const t = run(DATA + `vsetivli zero, 8, e32, m1, ta, ma
vle32.v v1, (s1)
vle32.v v2, (s2)
vadd.vv v3, v1, v2
li t0, 3
vmul.vx v4, v1, t0
vsub.vi v5, v1, 1
vrsub.vx v6, v1, t0
vsra.vi v7, v2, 2
vsetivli zero, 4, e32, m1, ta, ma
vmv.v.i v3, 0`.replace('vsub.vi v5, v1, 1', 'vadd.vi v5, v1, -1'));
    assert.deepEqual(t.elems('v3', 32), [0, 0, 0, 0, 55, 54, 77, 72]);
    assert.deepEqual(t.elems('v4', 32), [3, -6, 9, -12, 15, -18, 21, -24]);
    assert.deepEqual(t.elems('v5', 32), [0, -3, 2, -5, 4, -7, 6, -9]);
    assert.deepEqual(t.elems('v6', 32), [2, 5, 0, 7, -2, 9, -4, 11]);
    assert.deepEqual(t.elems('v7', 32), [2, 5, 7, 10, 12, 15, 17, 20]);
});

test('largura dos elementos: e8 com estouro e e16', () => {
    const t = run(`li t0, 200\nvsetivli zero, 4, e8, m1, ta, ma\nvmv.v.x v1, t0\nvadd.vv v2, v1, v1\nvsetivli zero, 4, e16, m1, ta, ma\nvmv.v.x v3, t0\nvadd.vv v4, v3, v3`);
    assert.deepEqual(t.elems('v2', 8, 'i', 4), [-112, -112, -112, -112]);
    assert.deepEqual(t.elems('v4', 16, 'i', 4), [400, 400, 400, 400]);
});

test('divisão vetorial segue a especificação para divisão por zero', () => {
    const t = run(`vsetivli zero, 2, e32, m1, ta, ma\nli t0, 7\nvmv.v.x v1, t0\nvmv.v.i v2, 0\nvdiv.vv v3, v1, v2\nvremu.vv v4, v1, v2\nvdivu.vv v5, v1, v2`);
    assert.deepEqual(t.elems('v3', 32, 'i', 2), [-1, -1]);
    assert.deepEqual(t.elems('v4', 32, 'i', 2), [7, 7]);
    assert.deepEqual(t.elems('v5', 32, 'i', 2), [-1, -1]);
});

test('comparação, máscara e operações mascaradas', () => {
    const t = run(DATA + `vsetivli zero, 8, e32, m1, ta, mu
vle32.v v1, (s1)
vmslt.vx v0, v1, zero
vmv.v.i v2, 9
vadd.vi v2, v1, 0, v0.t
vcpop.m a0, v0
vfirst.m a1, v0
vmnot.m v3, v0
vmerge.vim v4, v1, 0, v0`);
    assert.deepEqual(t.bits('v0', 8), [0, 1, 0, 1, 0, 1, 0, 1]);
    assert.deepEqual(t.elems('v2', 32), [9, -2, 9, -4, 9, -6, 9, -8]);
    assert.deepEqual([t.x(10), t.x(11)], [4n, 1n]);
    assert.deepEqual(t.bits('v3', 8), [1, 0, 1, 0, 1, 0, 1, 0]);
    assert.deepEqual(t.elems('v4', 32), [1, 0, 3, 0, 5, 0, 7, 0]);
});

test('reduções e movimentação para escalares', () => {
    const t = run(DATA + `vsetivli zero, 8, e32, m1, ta, ma
vle32.v v1, (s1)
vmv.s.x v2, zero
vredsum.vs v3, v1, v2
vmv.x.s a0, v3
vredmax.vs v4, v1, v1
vmv.x.s a1, v4
vredminu.vs v5, v1, v1
vmv.x.s a2, v5`);
    assert.deepEqual([t.x(10), t.x(11), t.x(12)], [-4n, 7n, 1n]);
});

test('ponto flutuante: vfmacc com arredondamento único, vf e redução', () => {
    const t = run(DATA + `vsetivli zero, 4, e32, m1, ta, ma
vle32.v v1, (s3)
li t0, 2
fcvt.s.w fa0, t0
vfmv.v.f v2, fa0
vfmacc.vf v2, fa0, v1
vfmul.vv v3, v1, v1
vfsqrt.v v4, v3
vmv.s.x v5, zero
vfredosum.vs v6, v1, v5
vfmv.f.s fa1, v6
vmflt.vf v0, v1, fa0
vfcvt.x.f.v v7, v1`);
    assert.deepEqual(t.elems('v2', 32, 'f', 4), [5, 7, -4, 10]);
    assert.deepEqual(t.elems('v4', 32, 'f', 4), [1.5, 2.5, 3, 4]);
    assert.equal(t.f(11), 5);
    assert.deepEqual(t.bits('v0', 4), [1, 0, 1, 0]);
    assert.deepEqual(t.elems('v7', 32, 'i', 4), [2, 2, -3, 4]);
});

test('loads e stores com passo e indexados', () => {
    const t = run(DATA + `vsetivli zero, 4, e32, m1, ta, ma
li t0, 8
vlse32.v v1, (s1), t0
vid.v v2
vsll.vi v2, v2, 3
vluxei32.v v3, (s2), v2
la s4, b
vsse32.v v1, (s4), t0
vle32.v v4, (s4)`);
    assert.deepEqual(t.elems('v1', 32, 'i', 4), [1, 3, 5, 7]);
    assert.deepEqual(t.elems('v3', 32, 'i', 4), [10, 30, 50, 70]);
    assert.deepEqual(t.elems('v4', 32, 'i', 4), [1, 20, 3, 40]);
});

test('erros de execução: falta de vsetvli e SEW incompatível', () => {
    const a = runReference(asm('vadd.vv v1, v2, v3'), {});
    assert.equal(a.error, true);
    assert.match(a.reason, /vsetvli/);
    const b = runReference(asm('vsetivli zero, 4, e8, m1, ta, ma\nvfadd.vv v1, v2, v3'), {});
    assert.equal(b.error, true);
    const c = runReference(asm('vsetivli zero, 4, e8, m1, ta, ma\nvle32.v v1, (a0)'), {});
    assert.equal(c.error, true);
});

test('montador: sintaxe vetorial e erros', () => {
    const p = asm('vsetvli t0, a0, e32, m1, ta, ma\nvadd.vv v3, v1, v2, v0.t\nvfmacc.vf v2, fa0, v1\nvle32.v v1, (a1)\nvlse32.v v2, 0(a1), t1');
    assert.deepEqual(p.instructions.map((i) => i.text), [
        'vsetvli t0, a0, e32, m1, ta, ma', 'vadd.vv v3, v1, v2, v0.t', 'vfmacc.vf v2, fa0, v1', 'vle32.v v1, (a1)', 'vlse32.v v2, (a1), t1',
    ]);
    assert.equal(p.instructions[1].vm, true);
    assert.deepEqual([p.instructions[1].vs2, p.instructions[1].vs1], ['v1', 'v2']);
    const bad = assemble('vsetvli t0, a0, e32, mf2\nvadd.vv v0, v1, v2, v0.t\nvle32.v v1, 4(a0)\nvadd.vx v1, v2, v3\nvsetvli t0, a0, m1\nvmand.mm v1, v2, v3, v0.t\n# v1 = 3');
    assert.deepEqual(bad.errors.map((e) => e.line), [1, 2, 3, 4, 5, 6, 7]);
});

test('pseudoinstruções vetoriais', () => {
    const p = asm('vneg.v v1, v2\nvnot.v v1, v2, v0.t\nvmsgt.vv v0, v1, v2\nvfneg.v v3, v4\nvmclr.m v5');
    assert.deepEqual(p.instructions.map((i) => i.text), [
        'vrsub.vx v1, v2, zero', 'vxor.vi v1, v2, -1, v0.t', 'vmslt.vv v0, v2, v1', 'vfsgnjn.vv v3, v4, v4', 'vmxor.mm v5, v5, v5',
    ]);
});

test('LMUL maior que 1: grupos de registradores', () => {
    // VLEN 128, e32, m4: VLMAX = 16 elementos em v4..v7.
    const src = '.data\nx: .word 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18\n.text\nli a0, 18\nla a1, x\nvsetvli t0, a0, e32, m4, ta, ma\nvle32.v v4, (a1)\nvadd.vi v8, v4, 1\nvmv.v.i v12, 0\nvredsum.vs v1, v8, v12\nvmv.x.s a2, v1\nvmslt.vx v0, v4, a0';
    const r = runReference(asm(src), { vlen: 128 });
    assert.equal(r.x[5], 16n);
    assert.equal(r.x[12], BigInt((2 + 17) * 16 / 2));
    // O elemento 5 (o segundo de v5) vale 6 + 1.
    assert.equal(r.v[9][4], 7);
    assert.match(simulate(asm('vsetvli t0, a0, e32, m2\nvadd.vv v1, v2, v4'), { trace: false }).warnings.join(' '), /v1/);
    for (const [name, config] of Object.entries(CONFIGS)) assertMatchesReference(asm(src), { ...config, trace: false }, name);
});
