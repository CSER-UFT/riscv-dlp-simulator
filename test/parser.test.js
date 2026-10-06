import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assemble, DATA_BASE } from '../js/riscv/parser.js';
import { readRaw } from '../js/riscv/memory.js';
import { asm } from './helpers.js';

const texts = (p) => p.instructions.map((i) => i.text);

test('nomes de registradores da ABI e numéricos são equivalentes', () => {
    const p = asm('add a0, s0, t6\nadd x10, x8, x31\nadd x10, fp, x31');
    for (const i of p.instructions)
        assert.deepEqual([i.rd, i.rs1, i.rs2], ['x10', 'x8', 'x31']);
});

test('formatos de operandos', () => {
    const p = asm(`
        lw   t0, -16(sp)
        sw   t0, 8(sp)
        lw   t1, (a0)
        addi t2, t1, 0x7ff
        slli t2, t2, 31
        lui  t3, 0xfffff
        flw  ft0, 4(a1)
        fadd.s fa0, ft0, ft1
        fcvt.w.s a0, fa0, rtz
        jalr ra, 0(t0)
        jalr t0
        ecall`);
    assert.deepEqual(texts(p), [
        'lw t0, -16(sp)', 'sw t0, 8(sp)', 'lw t1, 0(a0)', 'addi t2, t1, 2047', 'slli t2, t2, 31',
        'lui t3, 0xfffff', 'flw ft0, 4(a1)', 'fadd.s fa0, ft0, ft1', 'fcvt.w.s a0, fa0, rtz',
        'jalr ra, 0(t0)', 'jalr ra, 0(t0)', 'ecall',
    ]);
    assert.equal(p.instructions[8].rm, 'rtz');
});

test('rótulos, desvios para frente e para trás', () => {
    const p = asm('inicio: addi t0, t0, 1\n beq t0, t1, fim\n j inicio\nfim:');
    assert.equal(p.labels.get('inicio'), 0n);
    assert.equal(p.labels.get('fim'), 12n);
    assert.equal(p.instructions[1].target, 12);
    assert.equal(p.instructions[2].target, 0);
    assert.equal(p.instructions[2].text, 'jal zero, inicio');
});

test('pseudoinstruções', () => {
    const p = asm(`
        nop
        mv a0, a1
        not a0, a1
        neg a0, a1
        seqz a0, a1
        snez a0, a1
        beqz a0, l
        bgt a0, a1, l
        ble a0, a1, l
        call l
        ret
        l: fmv.s fa0, fa1
        fneg.d fa0, fa1`);
    assert.deepEqual(texts(p), [
        'addi zero, zero, 0', 'addi a0, a1, 0', 'xori a0, a1, -1', 'sub a0, zero, a1', 'sltiu a0, a1, 1',
        'sltu a0, zero, a1', 'beq a0, zero, l', 'blt a1, a0, l', 'bge a1, a0, l', 'jal ra, l',
        'jalr zero, 0(ra)', 'fsgnj.s fa0, fa1, fa1', 'fsgnjn.d fa0, fa1, fa1',
    ]);
    assert.ok(p.instructions.slice(1).every((i) => i.pseudo !== null));
});

test('li escolhe a menor sequência', () => {
    assert.deepEqual(texts(asm('li a0, 5')), ['addi a0, zero, 5']);
    assert.deepEqual(texts(asm('li a0, 0x12345000')), ['lui a0, 0x12345']);
    assert.deepEqual(texts(asm('li a0, 0x12345678')), ['lui a0, 0x12345', 'addi a0, a0, 1656']);
    assert.deepEqual(texts(asm('li a0, -1')), ['addi a0, zero, -1']);
    assert.deepEqual(texts(asm('li a0, 0xffffffff')), ['addi a0, zero, -1']);
    assert.equal(asm('li a0, 0x123456789abcdef0', { xlen: 64 }).instructions.length > 2, true);
});

test('seção de dados e la', () => {
    const p = asm(`
        .data
        a: .byte 1, 2, 3
        b: .word 0x11223344, b
        c: .float 1.5
        s: .string "oi"
        .text
        la a0, b
        lw a1, c`);
    assert.equal(p.labels.get('a'), BigInt(DATA_BASE));
    assert.equal(p.labels.get('b'), BigInt(DATA_BASE + 4), '.word é alinhado em 4 bytes');
    assert.equal(readRaw(p.data, BigInt(DATA_BASE + 4), 4), 0x11223344n);
    assert.equal(readRaw(p.data, BigInt(DATA_BASE + 8), 4), BigInt(DATA_BASE + 4), '.word aceita rótulos');
    assert.equal(readRaw(p.data, BigInt(DATA_BASE + 12), 4), 0x3fc00000n);
    assert.equal(p.data.get(BigInt(DATA_BASE + 18)), 0, 'string terminada em zero');
    assert.deepEqual(texts(p).map((t) => t.split(' ')[0]), ['auipc', 'addi', 'auipc', 'lw']);
});

test('valores iniciais em comentários', () => {
    const p = asm('# a0 = 10\n# t1 = -0x10\n# fa0 = 2.5\nadd a1, a0, t1 # comentário comum');
    assert.equal(p.init.x.get('x10'), 10n);
    assert.equal(p.init.x.get('x6'), -16n);
    assert.equal(p.init.f.get('f10'), 2.5);
});

test('valor inicial de registrador não usado não quebra a montagem', () => {
    const p = asm('# x4 = 100\nadd x1, x2, x3');
    assert.equal(p.init.x.get('x4'), 100n);
});

test('erros são reportados por linha, sem interromper a montagem', () => {
    const p = assemble([
        'add x1, x2',          // 1
        'xor x3, x1, f2',      // 2
        'foo x1',              // 3
        'addi x1, x1, 5000',   // 4
        'beq x1, x2, nada',    // 5
        'ld x1, 0(x2)',        // 6
        '# x0 = 3',            // 7
        'lw x1, 0(x2',         // 8
        'add x1, x2, x3',      // 9 (válida)
        'l: nop',              // 10
        'l: nop',              // 11
        'slli x1, x1, 32',     // 12
    ].join('\n'));
    assert.deepEqual(p.errors.map((e) => e.line), [1, 2, 3, 4, 5, 6, 7, 8, 11, 12]);
    assert.match(p.errors[2].message, /desconhecida/);
    assert.match(p.errors[5].message, /RV64/);
});

test('instruções RV64 com XLEN = 64', () => {
    const p = asm('ld a0, 0(sp)\naddw a1, a0, a0\nsd a1, 8(sp)', { xlen: 64 });
    assert.equal(p.instructions.length, 3);
});

test('programa vazio é erro', () => {
    assert.equal(assemble('# só comentário').errors.length, 1);
});

test('comentários de código não são confundidos com valores iniciais', () => {
    const p = asm('# a0 = 5\nlw a1, 0(sp)    # a1 = n\n# t0 = F(i)\n# t1 = 0x10\nadd t2, t0, t1 # t2 = 3');
    assert.equal(p.init.x.get('x10'), 5n);
    assert.equal(p.init.x.get('x6'), 16n);
    assert.equal(p.init.x.has('x11'), false);
    assert.equal(p.init.x.has('x5'), false);
    assert.equal(p.init.x.has('x7'), false);
    assert.equal(assemble('# a0 = 1x2\nnop').errors.length, 1, 'número malformado em linha só de comentário ainda é erro');
});
