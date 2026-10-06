import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runReference } from '../js/riscv/machine.js';
import { asm } from './helpers.js';

/** Executa no simulador de referência e retorna um leitor de registradores por nome canônico. */
function run(src, xlen = 32) {
    const r = runReference(asm(src, { xlen }), { exampleValues: false });
    return (reg) => (reg[0] === 'x' ? r.x[parseInt(reg.slice(1))] : r.f[parseInt(reg.slice(1))]);
}

test('aritmética inteira com estouro em 32 bits', () => {
    const r = run(`
        li x1, 0x7fffffff
        addi x2, x1, 1
        li x3, -1
        srli x4, x3, 28
        srai x5, x3, 28
        sltu x6, x0, x3
        slt x7, x3, x0
        sll x8, x3, x3`);
    assert.equal(r('x2'), -2147483648n);
    assert.equal(r('x4'), 15n);
    assert.equal(r('x5'), -1n);
    assert.equal(r('x6'), 1n);
    assert.equal(r('x7'), 1n);
    assert.equal(r('x8'), -2147483648n, 'deslocamento usa apenas os 5 bits menos significativos');
});

test('divisão inteira segue a especificação RISC-V', () => {
    const r = run(`
        li x1, 7
        li x2, 2
        li x3, -7
        li x9, 0x80000000
        li x10, -1
        div  x4, x1, x2
        div  x5, x3, x2
        rem  x6, x3, x2
        div  x7, x1, x0
        divu x8, x1, x0
        rem  x11, x1, x0
        div  x12, x9, x10
        rem  x13, x9, x10`);
    assert.equal(r('x4'), 3n, '7 / 2 = 3 (inteiro)');
    assert.equal(r('x5'), -3n, 'trunca em direção a zero');
    assert.equal(r('x6'), -1n);
    assert.equal(r('x7'), -1n, 'divisão por zero resulta em todos os bits 1');
    assert.equal(r('x8'), -1n);
    assert.equal(r('x11'), 7n, 'resto da divisão por zero é o dividendo');
    assert.equal(r('x12'), -2147483648n, 'estouro da divisão com sinal');
    assert.equal(r('x13'), 0n);
});

test('multiplicação alta', () => {
    const r = run(`
        li x1, -2
        li x2, 3
        mulh x3, x1, x2
        mulhu x4, x1, x2
        mulhsu x5, x1, x2`);
    assert.equal(r('x3'), -1n);
    assert.equal(r('x4'), 2n);
    assert.equal(r('x5'), -1n);
});

test('x0 é sempre zero', () => {
    const r = run('addi x0, x0, 5\nadd x1, x0, x0');
    assert.equal(r('x0'), 0n);
    assert.equal(r('x1'), 0n);
});

test('loads com e sem extensão de sinal', () => {
    const r = run(`
        .data
        d: .word 0x8000ff80
        .text
        la x1, d
        lb x2, 0(x1)
        lbu x3, 0(x1)
        lh x4, 2(x1)
        lhu x5, 2(x1)
        lw x6, 0(x1)`);
    assert.equal(r('x2'), -128n);
    assert.equal(r('x3'), 128n);
    assert.equal(r('x4'), -32768n);
    assert.equal(r('x5'), 32768n);
    assert.equal(r('x6'), BigInt.asIntN(32, 0x8000ff80n));
});

test('ponto flutuante de precisão simples arredonda o resultado', () => {
    const r = run(`
        .data
        a: .float 0.1
        b: .float 0.2
        .text
        la x1, a
        flw f1, 0(x1)
        flw f2, 4(x1)
        fadd.s f3, f1, f2
        fdiv.s f4, f1, f0
        fsqrt.s f5, f1
        flt.s x2, f1, f2
        fcvt.w.s x3, f3
        fcvt.s.w f6, x2
        fmv.x.w x4, f6
        fsgnjn.s f7, f1, f1`);
    assert.equal(r('f3'), Math.fround(Math.fround(0.1) + Math.fround(0.2)));
    assert.equal(r('f4'), Infinity);
    assert.equal(r('f5'), Math.fround(Math.sqrt(Math.fround(0.1))));
    assert.equal(r('x2'), 1n);
    assert.equal(r('x3'), 0n);
    assert.equal(r('f6'), 1);
    assert.equal(r('x4'), 0x3f800000n);
    assert.equal(r('f7'), -Math.fround(0.1));
});

test('conversão para inteiro satura e respeita o arredondamento', () => {
    const r = run(`
        .data
        v: .double 2.5, -2.5, 1e20, nan
        .text
        la x1, v
        fld f1, 0(x1)
        fld f2, 8(x1)
        fld f3, 16(x1)
        fld f4, 24(x1)
        fcvt.w.d x2, f1
        fcvt.w.d x3, f2
        fcvt.w.d x4, f1, rtz
        fcvt.w.d x5, f3
        fcvt.w.d x6, f4
        fcvt.wu.d x7, f2`);
    assert.equal(r('x2'), 2n, 'RNE: 2.5 -> 2');
    assert.equal(r('x3'), -2n);
    assert.equal(r('x4'), 2n);
    assert.equal(r('x5'), 2147483647n);
    assert.equal(r('x6'), 2147483647n);
    assert.equal(r('x7'), 0n);
});

test('RV64: operações de 64 bits e variantes W', () => {
    const r = run(`
        li x1, 0x123456789
        li x2, 0x7fffffff
        addw x3, x2, x2
        add x4, x2, x2
        slli x5, x1, 4
        sraiw x6, x3, 1
        sd x1, -8(sp)
        lw x7, -8(sp)
        lwu x8, -4(sp)
        divw x9, x3, x0`, 64);
    assert.equal(r('x1'), 0x123456789n);
    assert.equal(r('x3'), -2n);
    assert.equal(r('x4'), 0xfffffffen);
    assert.equal(r('x5'), 0x1234567890n);
    assert.equal(r('x6'), -1n);
    assert.equal(r('x7'), 0x23456789n);
    assert.equal(r('x8'), 1n);
    assert.equal(r('x9'), -1n);
});

test('chamada e retorno de função', () => {
    const r = run(`
        li a0, 6
        call quadrado
        mv s0, a0
        j fim
        quadrado:
            mul a0, a0, a0
            ret
        fim:`);
    assert.equal(r('x8'), 36n);
});

test('fmadd arredonda uma única vez', () => {
    const r = run(`
        .data
        a: .float 1.000244140625      # 1 + 2^-12
        c: .float -1.00048828125      # -(1 + 2^-11)
        .text
        la x1, a
        flw f1, 0(x1)
        flw f3, 4(x1)
        fmadd.s f4, f1, f1, f3
        fmul.s f5, f1, f1
        fadd.s f6, f5, f3
        fnmsub.s f7, f1, f1, f3
        fmsub.d f8, f1, f1, f3`);
    assert.equal(r('f4'), 2 ** -24, 'resultado fundido exato');
    assert.equal(r('f6'), 0, 'com dois arredondamentos o resultado se perde');
    assert.equal(r('f7'), -2 - 2 ** -10, 'fnmsub = -(a*b) + c, arredondado para precisão simples');
    assert.equal(r('f8'), 1.000244140625 ** 2 + 1.00048828125);
});
