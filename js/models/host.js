/**
 * Partes comuns aos modelos com um núcleo escalar em ordem (vetorial e TPU): execução funcional das
 * instruções escalares, com a lista de acessos usada pelo modelo temporal, e utilitários de texto.
 */
import * as memory from '../riscv/memory.js';
import { f32ToBits, f64ToBits } from '../riscv/bits.js';
import { readReg, writeReg, effectiveAddress, resolveControl } from '../riscv/machine.js';

/** Classe de latência escalar de cada classe de instrução. */
export const SCALAR_LAT = {
    alu: 'alu', branch: 'alu', jump: 'alu', vset: 'alu', system: 'alu',
    mul: 'mul', div: 'div', load: 'load', store: 'store', fadd: 'fadd', fmul: 'fmul', fdiv: 'fdiv',
};

/**
 * Executa uma instrução escalar sobre o estado funcional e devolve os acessos: registradores lidos
 * (xreads), escrito no fim (xwrite), memória lida e escrita, e, para desvios, o próximo PC.
 */
export function execScalar(fun, inst, xlen) {
    const d = inst.def;
    const fx = { slots: 1, reads: [], writes: [], mreads: [], mwrites: [], xreads: [], xwrite: null, active: 1, flops: 0, strided: false, end: false };
    for (const r of [inst.rs1, inst.rs2, inst.rs3]) if (r) fx.xreads.push(r);
    const a = readReg(fun, inst.rs1), b = readReg(fun, inst.rs2), c = readReg(fun, inst.rs3);
    switch (d.cls) {
        case 'system':
            fx.system = true;
            break;
        case 'load': {
            const addr = effectiveAddress(inst, a, xlen);
            const value = memory.load(fun.mem, addr, d.mem, xlen);
            writeReg(fun, inst.rd, value);
            fx.mreads.push([0, addr, d.mem.size]);
            fx.xwrite = { reg: inst.rd, value };
            break;
        }
        case 'store': {
            const addr = effectiveAddress(inst, a, xlen);
            memory.store(fun.mem, addr, d.mem, b);
            const raw = d.mem.fp === 's' ? f32ToBits(b) : (d.mem.fp === 'd' ? f64ToBits(b) : BigInt(b));
            fx.mwrites.push([0, addr, d.mem.size, raw]);
            break;
        }
        case 'branch': case 'jump': {
            const r = resolveControl(inst, a, b, xlen);
            if (r.value !== null) {
                writeReg(fun, inst.rd, r.value);
                fx.xwrite = { reg: inst.rd, value: r.value };
            }
            fx.next = r.next;
            fx.taken = r.taken;
            break;
        }
        default: {
            const value = d.exec(a, b, inst, xlen, c);
            writeReg(fun, inst.rd, value);
            fx.xwrite = { reg: inst.rd, value };
        }
    }
    return fx;
}

/** Lista de índices como intervalos: [0, 1, 2, 5] vira "0..2, 5". */
export function rangeText(list) {
    const out = [];
    let i = 0;
    while (i < list.length) {
        let j = i;
        while (j + 1 < list.length && list[j + 1] === list[j] + 1) j++;
        out.push(i === j ? `${list[i]}` : `${list[i]}..${list[j]}`);
        i = j + 1;
    }
    return out.join(', ');
}
