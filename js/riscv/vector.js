/**
 * Extensão vetorial do RISC-V (RVV 1.0): subconjunto didático com LMUL = 1, 2, 4 ou 8.
 *
 * Este módulo descreve as instruções vetoriais (registradas na tabela de isa.js) e as executa sobre o estado
 * arquitetural. Cada execução devolve também a lista de acessos de cada elemento (bytes de registradores
 * vetoriais lidos e escritos, endereços de memória, registradores escalares), que o modelo temporal usa
 * para calcular dependências elemento a elemento, encadeamento (chaining) e conflitos.
 *
 * Simplificações em relação à especificação:
 *   LMUL inteiro (m1, m2, m4, m8; sem as frações mf2, mf4, mf8): um operando vetorial é um grupo de LMUL
 *   registradores consecutivos, começando em um registrador múltiplo de LMUL, e o elemento e fica no
 *   registrador vd + floor(e × SEW ÷ VLEN); máscaras (v0, destino das comparações) e os escalares das
 *   reduções (vd e vs1) ocupam um registrador só;
 *   a largura dos acessos à memória (EEW) deve ser igual ao SEW;
 *   elementos inativos (máscara) e da cauda (índices maiores ou iguais a vl) ficam sempre inalterados
 *   (undisturbed), o que a especificação permite também nas políticas agnostic;
 *   o vl escolhido por vsetvli é sempre min(AVL, VLMAX).
 */
import { signed, unsigned, f32ToBits, bitsToF32, f64ToBits, bitsToF64, floatToInt, fusedMulAdd } from './bits.js';
import { readRaw, writeRaw } from './memory.js';
import { index } from './registers.js';
import { t } from '../i18n/index.js';

/** Classes de operação vetoriais, na ordem de exibição. */
export const VECTOR_CLASSES = ['vload', 'vstore', 'valu', 'vmul', 'vdiv', 'vfadd', 'vfmul', 'vfdiv'];

/** Larguras de elemento aceitas (SEW, em bits). */
export const SEWS = [8, 16, 32, 64];

/** Erro de execução de uma instrução vetorial (por exemplo, vsetvli ausente ou SEW incompatível). */
export class VectorError extends Error { }

const fail = (key, params = {}) => { throw new VectorError(t(key, params)); };

// Acesso a elementos ------------------------------------------------------------------------------------------

/** Valor bruto (BigInt sem sinal) do elemento `e` de largura `sew` em um registrador vetorial (bytes). */
export function getRaw(vreg, e, sew) {
    const n = sew / 8;
    let v = 0n;
    for (let i = n - 1; i >= 0; i--)
        v = (v << 8n) | BigInt(vreg[e * n + i]);
    return v;
}

function rawBytes(raw, n) {
    const out = new Array(n);
    let v = unsigned(raw, n * 8);
    for (let i = 0; i < n; i++) {
        out[i] = Number(v & 0xffn);
        v >>= 8n;
    }
    return out;
}

export const maskBit = (vreg, e) => (vreg[e >> 3] >> (e & 7)) & 1;

/** Interpreta um valor bruto: 'i' inteiro com sinal, 'u' sem sinal, 'f' ponto flutuante. */
export function rawToValue(raw, type, sew) {
    if (type === 'f') return sew === 32 ? bitsToF32(raw) : bitsToF64(raw);
    return type === 'i' ? signed(raw, sew) : unsigned(raw, sew);
}

function valueToRaw(v, type, sew) {
    if (type === 'f') return sew === 32 ? f32ToBits(Math.fround(v)) : f64ToBits(v);
    return unsigned(v, sew);
}

// Operações elementares ------------------------------------------------------------------------------------------

const bool = (c) => c;
const sh = (b, sew) => unsigned(b, sew) & BigInt(sew - 1);

function divS(a, b, s) {
    if (b === 0n) return -1n;
    return signed(a / b, s);
}
function divU(a, b, s) {
    const ua = unsigned(a, s), ub = unsigned(b, s);
    return ub === 0n ? unsigned(-1n, s) : ua / ub;
}
function remS(a, b, s) {
    return b === 0n ? a : signed(a % b, s);
}
function remU(a, b, s) {
    const ua = unsigned(a, s), ub = unsigned(b, s);
    return ub === 0n ? ua : ua % ub;
}

function fpick(a, b, wantMin) {
    if (Number.isNaN(a)) return Number.isNaN(b) ? NaN : b;
    if (Number.isNaN(b)) return a;
    if (a === 0 && b === 0) {
        const aNeg = Object.is(a, -0), bNeg = Object.is(b, -0);
        return wantMin ? (aNeg || bNeg ? -0 : 0) : (aNeg && bNeg ? -0 : 0);
    }
    return wantMin ? Math.min(a, b) : Math.max(a, b);
}

function sgnj(a, b, mode, sew) {
    const toBits = sew === 32 ? f32ToBits : f64ToBits;
    const fromBits = sew === 32 ? bitsToF32 : bitsToF64;
    const signBit = sew === 32 ? 0x80000000n : 0x8000000000000000n;
    const mag = toBits(a) & ~signBit;
    const sa = toBits(a) & signBit, sb = toBits(b) & signBit;
    const s = mode === 'j' ? sb : (mode === 'n' ? (sb ^ signBit) : (sa ^ sb));
    return fromBits(mag | s);
}

const prec = (sew) => (sew === 32 ? 24 : 53);
const round = (v, sew) => (sew === 32 ? Math.fround(v) : v);

// Definições ---------------------------------------------------------------------------------------------------

/** Assinaturas de operandos por sufixo. */
const SIG = {
    vv: ['vd', 'vs2', 'vs1'],
    vx: ['vd', 'vs2', 'rs1'],
    vf: ['vd', 'vs2', 'frs1'],
    vi: ['vd', 'vs2', 'imm'],
    vui: ['vd', 'vs2', 'uimm'],
};

/**
 * Registra as instruções vetoriais na tabela de instruções.
 * @param {(name: string, props: object) => void} def função de registro de isa.js
 */
export function registerVector(def) {
    const V = (name, props) => def(name, { fmt: 'V', vector: true, masked: true, ...props });

    // Configuração
    def('vsetvli', { fmt: 'V', vector: true, cls: 'vset', kind: 'vset', vops: ['rd', 'rs1', 'vtype'], masked: false });
    def('vsetivli', { fmt: 'V', vector: true, cls: 'vset', kind: 'vset', vops: ['rd', 'uimm', 'vtype'], masked: false });

    // Loads e stores: unitários, com passo (strided) e indexados
    for (const eew of SEWS) {
        V(`vle${eew}.v`, { cls: 'vload', kind: 'load', mode: 'unit', eew, vops: ['vd', 'mem'] });
        V(`vse${eew}.v`, { cls: 'vstore', kind: 'store', mode: 'unit', eew, vops: ['vs3', 'mem'] });
        V(`vlse${eew}.v`, { cls: 'vload', kind: 'load', mode: 'strided', eew, vops: ['vd', 'mem', 'rs2'] });
        V(`vsse${eew}.v`, { cls: 'vstore', kind: 'store', mode: 'strided', eew, vops: ['vs3', 'mem', 'rs2'] });
        for (const o of ['u', 'o']) {
            V(`vl${o}xei${eew}.v`, { cls: 'vload', kind: 'load', mode: 'indexed', eew, vops: ['vd', 'mem', 'vs2'] });
            V(`vs${o}xei${eew}.v`, { cls: 'vstore', kind: 'store', mode: 'indexed', eew, vops: ['vs3', 'mem', 'vs2'] });
        }
    }

    // Aritmética inteira
    const bin = (name, cls, type, forms, fn) => {
        for (const f of forms) V(`${name}.${f === 'vui' ? 'vi' : f}`, { cls, kind: 'bin', type, src: f, vops: SIG[f], fn });
    };
    bin('vadd', 'valu', 'i', ['vv', 'vx', 'vi'], (a, b) => a + b);
    bin('vsub', 'valu', 'i', ['vv', 'vx'], (a, b) => a - b);
    bin('vrsub', 'valu', 'i', ['vx', 'vi'], (a, b) => b - a);
    bin('vand', 'valu', 'i', ['vv', 'vx', 'vi'], (a, b) => a & b);
    bin('vor', 'valu', 'i', ['vv', 'vx', 'vi'], (a, b) => a | b);
    bin('vxor', 'valu', 'i', ['vv', 'vx', 'vi'], (a, b) => a ^ b);
    bin('vsll', 'valu', 'u', ['vv', 'vx', 'vui'], (a, b, s) => a << sh(b, s));
    bin('vsrl', 'valu', 'u', ['vv', 'vx', 'vui'], (a, b, s) => a >> sh(b, s));
    bin('vsra', 'valu', 'i', ['vv', 'vx', 'vui'], (a, b, s) => a >> sh(b, s));
    bin('vmin', 'valu', 'i', ['vv', 'vx'], (a, b) => (a < b ? a : b));
    bin('vmax', 'valu', 'i', ['vv', 'vx'], (a, b) => (a > b ? a : b));
    bin('vminu', 'valu', 'u', ['vv', 'vx'], (a, b) => (a < b ? a : b));
    bin('vmaxu', 'valu', 'u', ['vv', 'vx'], (a, b) => (a > b ? a : b));
    bin('vmul', 'vmul', 'i', ['vv', 'vx'], (a, b) => a * b);
    bin('vmulh', 'vmul', 'i', ['vv', 'vx'], (a, b, s) => (a * b) >> BigInt(s));
    bin('vmulhu', 'vmul', 'u', ['vv', 'vx'], (a, b, s) => (a * b) >> BigInt(s));
    bin('vdiv', 'vdiv', 'i', ['vv', 'vx'], (a, b, s) => divS(a, b, s));
    bin('vdivu', 'vdiv', 'u', ['vv', 'vx'], (a, b, s) => divU(a, b, s));
    bin('vrem', 'vdiv', 'i', ['vv', 'vx'], (a, b, s) => remS(a, b, s));
    bin('vremu', 'vdiv', 'u', ['vv', 'vx'], (a, b, s) => remU(a, b, s));

    // Multiplicação e soma inteira: x = vs1 ou rs1, y = vs2, acc = vd
    const fma = (name, cls, type, forms, fn) => {
        const sig = { vv: ['vd', 'vs1', 'vs2'], vx: ['vd', 'rs1', 'vs2'], vf: ['vd', 'frs1', 'vs2'] };
        for (const f of forms) V(`${name}.${f}`, { cls, kind: 'fma', type, src: f, vops: sig[f], fn });
    };
    fma('vmacc', 'vmul', 'i', ['vv', 'vx'], (x, y, acc) => x * y + acc);
    fma('vnmsac', 'vmul', 'i', ['vv', 'vx'], (x, y, acc) => acc - x * y);
    fma('vmadd', 'vmul', 'i', ['vv', 'vx'], (x, y, acc) => x * acc + y);
    fma('vnmsub', 'vmul', 'i', ['vv', 'vx'], (x, y, acc) => y - x * acc);

    // Comparações inteiras (resultado em máscara)
    const cmp = (name, cls, type, forms, fn) => {
        for (const f of forms) V(`${name}.${f}`, { cls, kind: 'cmp', type, src: f, vops: SIG[f], fn });
    };
    cmp('vmseq', 'valu', 'i', ['vv', 'vx', 'vi'], (a, b) => bool(a === b));
    cmp('vmsne', 'valu', 'i', ['vv', 'vx', 'vi'], (a, b) => bool(a !== b));
    cmp('vmslt', 'valu', 'i', ['vv', 'vx'], (a, b) => bool(a < b));
    cmp('vmsltu', 'valu', 'u', ['vv', 'vx'], (a, b) => bool(a < b));
    cmp('vmsle', 'valu', 'i', ['vv', 'vx', 'vi'], (a, b) => bool(a <= b));
    cmp('vmsleu', 'valu', 'u', ['vv', 'vx', 'vi'], (a, b) => bool(a <= b));
    cmp('vmsgt', 'valu', 'i', ['vx', 'vi'], (a, b) => bool(a > b));
    cmp('vmsgtu', 'valu', 'u', ['vx', 'vi'], (a, b) => bool(a > b));

    // Seleção e movimentação
    V('vmerge.vvm', { cls: 'valu', kind: 'merge', type: 'i', src: 'vv', vops: ['vd', 'vs2', 'vs1', 'v0'], masked: false });
    V('vmerge.vxm', { cls: 'valu', kind: 'merge', type: 'i', src: 'vx', vops: ['vd', 'vs2', 'rs1', 'v0'], masked: false });
    V('vmerge.vim', { cls: 'valu', kind: 'merge', type: 'i', src: 'vi', vops: ['vd', 'vs2', 'imm', 'v0'], masked: false });
    V('vfmerge.vfm', { cls: 'vfadd', kind: 'merge', type: 'f', src: 'vf', vops: ['vd', 'vs2', 'frs1', 'v0'], masked: false });
    V('vmv.v.v', { cls: 'valu', kind: 'mv', type: 'i', src: 'vv', vops: ['vd', 'vs1'], masked: false });
    V('vmv.v.x', { cls: 'valu', kind: 'mv', type: 'i', src: 'vx', vops: ['vd', 'rs1'], masked: false });
    V('vmv.v.i', { cls: 'valu', kind: 'mv', type: 'i', src: 'vi', vops: ['vd', 'imm'], masked: false });
    V('vfmv.v.f', { cls: 'vfadd', kind: 'mv', type: 'f', src: 'vf', vops: ['vd', 'frs1'], masked: false });
    V('vmv.x.s', { cls: 'valu', kind: 'toScalar', type: 'i', vops: ['rd', 'vs2'], masked: false });
    V('vfmv.f.s', { cls: 'vfadd', kind: 'toScalar', type: 'f', vops: ['frd', 'vs2'], masked: false });
    V('vmv.s.x', { cls: 'valu', kind: 'fromScalar', type: 'i', src: 'vx', vops: ['vd', 'rs1'], masked: false });
    V('vfmv.s.f', { cls: 'vfadd', kind: 'fromScalar', type: 'f', src: 'vf', vops: ['vd', 'frs1'], masked: false });
    V('vid.v', { cls: 'valu', kind: 'vid', vops: ['vd'] });

    // Reduções: vd[0] = reduz(vs1[0], elementos ativos de vs2)
    const red = (name, cls, type, fn) => V(`${name}.vs`, { cls, kind: 'red', type, vops: ['vd', 'vs2', 'vs1'], fn });
    red('vredsum', 'valu', 'i', (acc, x) => acc + x);
    red('vredand', 'valu', 'i', (acc, x) => acc & x);
    red('vredor', 'valu', 'i', (acc, x) => acc | x);
    red('vredxor', 'valu', 'i', (acc, x) => acc ^ x);
    red('vredmin', 'valu', 'i', (acc, x) => (x < acc ? x : acc));
    red('vredmax', 'valu', 'i', (acc, x) => (x > acc ? x : acc));
    red('vredminu', 'valu', 'u', (acc, x) => (x < acc ? x : acc));
    red('vredmaxu', 'valu', 'u', (acc, x) => (x > acc ? x : acc));
    red('vfredusum', 'vfadd', 'f', (acc, x, s) => round(acc + x, s));
    red('vfredosum', 'vfadd', 'f', (acc, x, s) => round(acc + x, s));
    red('vfredmin', 'vfadd', 'f', (acc, x) => fpick(acc, x, true));
    red('vfredmax', 'vfadd', 'f', (acc, x) => fpick(acc, x, false));

    // Operações lógicas entre máscaras (sem máscara, sobre os bits 0 a vl-1)
    const mlog = (name, fn) => V(`${name}.mm`, { cls: 'valu', kind: 'mlog', vops: ['vd', 'vs2', 'vs1'], masked: false, fn });
    mlog('vmand', (a, b) => a & b);
    mlog('vmnand', (a, b) => 1 - (a & b));
    mlog('vmandn', (a, b) => a & (1 - b));
    mlog('vmor', (a, b) => a | b);
    mlog('vmnor', (a, b) => 1 - (a | b));
    mlog('vmorn', (a, b) => a | (1 - b));
    mlog('vmxor', (a, b) => a ^ b);
    mlog('vmxnor', (a, b) => 1 - (a ^ b));
    V('vcpop.m', { cls: 'valu', kind: 'mscalar', op: 'cpop', vops: ['rd', 'vs2'] });
    V('vfirst.m', { cls: 'valu', kind: 'mscalar', op: 'first', vops: ['rd', 'vs2'] });

    // Ponto flutuante
    const fbin = (name, cls, forms, fn) => {
        for (const f of forms) V(`${name}.${f}`, { cls, kind: 'bin', type: 'f', src: f, vops: SIG[f], fn, flops: 1 });
    };
    fbin('vfadd', 'vfadd', ['vv', 'vf'], (a, b, s) => round(a + b, s));
    fbin('vfsub', 'vfadd', ['vv', 'vf'], (a, b, s) => round(a - b, s));
    fbin('vfrsub', 'vfadd', ['vf'], (a, b, s) => round(b - a, s));
    fbin('vfmul', 'vfmul', ['vv', 'vf'], (a, b, s) => round(a * b, s));
    fbin('vfdiv', 'vfdiv', ['vv', 'vf'], (a, b, s) => round(a / b, s));
    fbin('vfrdiv', 'vfdiv', ['vf'], (a, b, s) => round(b / a, s));
    fbin('vfmin', 'vfadd', ['vv', 'vf'], (a, b) => fpick(a, b, true));
    fbin('vfmax', 'vfadd', ['vv', 'vf'], (a, b) => fpick(a, b, false));
    fbin('vfsgnj', 'vfadd', ['vv', 'vf'], (a, b, s) => sgnj(a, b, 'j', s));
    fbin('vfsgnjn', 'vfadd', ['vv', 'vf'], (a, b, s) => sgnj(a, b, 'n', s));
    fbin('vfsgnjx', 'vfadd', ['vv', 'vf'], (a, b, s) => sgnj(a, b, 'x', s));

    const ffma = (name, fn) => fma(name, 'vfmul', 'f', ['vv', 'vf'], fn);
    ffma('vfmacc', (x, y, acc, s) => round(fusedMulAdd(x, y, acc, prec(s)), s));
    ffma('vfnmacc', (x, y, acc, s) => round(fusedMulAdd(-x, y, -acc, prec(s)), s));
    ffma('vfmsac', (x, y, acc, s) => round(fusedMulAdd(x, y, -acc, prec(s)), s));
    ffma('vfnmsac', (x, y, acc, s) => round(fusedMulAdd(-x, y, acc, prec(s)), s));
    ffma('vfmadd', (x, y, acc, s) => round(fusedMulAdd(x, acc, y, prec(s)), s));
    ffma('vfmsub', (x, y, acc, s) => round(fusedMulAdd(x, acc, -y, prec(s)), s));

    const fcmp = (name, forms, fn) => cmp(name, 'vfadd', 'f', forms, fn);
    fcmp('vmfeq', ['vv', 'vf'], (a, b) => a === b);
    fcmp('vmfne', ['vv', 'vf'], (a, b) => a !== b);
    fcmp('vmflt', ['vv', 'vf'], (a, b) => a < b);
    fcmp('vmfle', ['vv', 'vf'], (a, b) => a <= b);
    fcmp('vmfgt', ['vf'], (a, b) => a > b);
    fcmp('vmfge', ['vf'], (a, b) => a >= b);

    const un = (name, cls, tin, tout, fn) => V(name, { cls, kind: 'unary', tin, tout, vops: ['vd', 'vs2'], fn });
    un('vfsqrt.v', 'vfdiv', 'f', 'f', (a, s) => round(Math.sqrt(a), s));
    un('vfcvt.x.f.v', 'vfadd', 'f', 'i', (a, s) => floatToInt(a, s, true, 'rne'));
    un('vfcvt.xu.f.v', 'vfadd', 'f', 'u', (a, s) => floatToInt(a, s, false, 'rne'));
    un('vfcvt.rtz.x.f.v', 'vfadd', 'f', 'i', (a, s) => floatToInt(a, s, true, 'rtz'));
    un('vfcvt.f.x.v', 'vfadd', 'i', 'f', (a, s) => round(Number(a), s));
    un('vfcvt.f.xu.v', 'vfadd', 'u', 'f', (a, s) => round(Number(a), s));
}

/** Pseudoinstruções vetoriais: mnemônico -> (operandos) => [mnemônico real, operandos]. */
export const VECTOR_PSEUDO = {
    'vneg.v': (o) => ['vrsub.vx', [o[0], o[1], 'zero', ...o.slice(2)]],
    'vnot.v': (o) => ['vxor.vi', [o[0], o[1], '-1', ...o.slice(2)]],
    'vfneg.v': (o) => ['vfsgnjn.vv', [o[0], o[1], o[1], ...o.slice(2)]],
    'vfabs.v': (o) => ['vfsgnjx.vv', [o[0], o[1], o[1], ...o.slice(2)]],
    'vmmv.m': (o) => ['vmand.mm', [o[0], o[1], o[1]]],
    'vmnot.m': (o) => ['vmnand.mm', [o[0], o[1], o[1]]],
    'vmclr.m': (o) => ['vmxor.mm', [o[0], o[0], o[0]]],
    'vmset.m': (o) => ['vmxnor.mm', [o[0], o[0], o[0]]],
    'vmsgt.vv': (o) => ['vmslt.vv', [o[0], o[2], o[1], ...o.slice(3)]],
    'vmsgtu.vv': (o) => ['vmsltu.vv', [o[0], o[2], o[1], ...o.slice(3)]],
    'vmsge.vv': (o) => ['vmsle.vv', [o[0], o[2], o[1], ...o.slice(3)]],
    'vmsgeu.vv': (o) => ['vmsleu.vv', [o[0], o[2], o[1], ...o.slice(3)]],
    'vmfgt.vv': (o) => ['vmflt.vv', [o[0], o[2], o[1], ...o.slice(3)]],
    'vmfge.vv': (o) => ['vmfle.vv', [o[0], o[2], o[1], ...o.slice(3)]],
};

/** Número de operandos esperado por cada pseudoinstrução vetorial (sem a máscara opcional). */
export const VECTOR_PSEUDO_ARITY = {
    'vneg.v': 2, 'vnot.v': 2, 'vfneg.v': 2, 'vfabs.v': 2, 'vmmv.m': 2, 'vmnot.m': 2, 'vmclr.m': 1, 'vmset.m': 1,
    'vmsgt.vv': 3, 'vmsgtu.vv': 3, 'vmsge.vv': 3, 'vmsgeu.vv': 3, 'vmfgt.vv': 3, 'vmfge.vv': 3,
};

// Estado ---------------------------------------------------------------------------------------------------------

/** Banco de registradores vetoriais zerado: 32 registradores de VLEN/8 bytes. */
export function createVectorRegs(vlen) {
    return Array.from({ length: 32 }, () => new Array(vlen / 8).fill(0));
}

/** VLMAX para um SEW e um LMUL. */
export const vlmax = (vlen, sew, lmul = 1) => (vlen * lmul) / sew;

/** Valores aceitos de LMUL. */
export const LMULS = [1, 2, 4, 8];

// Execução -------------------------------------------------------------------------------------------------------

/**
 * Executa uma instrução vetorial sobre o estado `st` ({x, f, v, mem, vl, vtype}), alterando-o.
 *
 * Retorna os acessos, por elemento (slot), usados pelo modelo temporal:
 *   slots      número de elementos processados (o tempo de ocupação da unidade depende dele);
 *   reads      [slot, registrador, bit inicial, bit final) lidos de registradores vetoriais (máscaras usam um
 *              bit por elemento, por isso a granularidade é o bit);
 *   writes     [slot, registrador, bit inicial, bit final, byte inicial, bytes] escritos (slot -1: no fim da
 *              instrução); os bytes são os valores a exibir a partir do byte inicial;
 *   mreads     [slot, endereço, tamanho] lidos da memória;
 *   mwrites    [slot, endereço, tamanho, valor bruto] escritos na memória;
 *   xreads     registradores escalares lidos; xwrite {reg, value} escrito no fim (ou null);
 *   active     elementos ativos; flops operações de ponto flutuante; strided acesso com passo ou indexado.
 *
 * @param {object} st estado arquitetural
 * @param {object} inst instrução montada
 * @param {number} xlen
 * @param {number} vlen
 */
export function execVector(st, inst, xlen, vlen) {
    const d = inst.def;
    const fx = { slots: 0, reads: [], writes: [], mreads: [], mwrites: [], xreads: [], xwrite: null, active: 0, flops: 0, strided: false, end: false };
    for (const r of [inst.rs1, inst.rs2]) if (r) fx.xreads.push(r);

    const xval = (r) => (r === 'x0' ? 0n : st.x[index(r)]);
    const fval = (r) => st.f[index(r)];

    if (d.kind === 'vset') {
        const sew = inst.vtype.sew;
        const max = vlmax(vlen, sew, inst.vtype.lmul ?? 1);
        let avl;
        if (d.name === 'vsetivli') avl = BigInt(inst.imm);
        else if (inst.rs1 !== 'x0') avl = unsigned(xval(inst.rs1), xlen);
        else if (inst.rd !== 'x0') avl = BigInt(max);
        else avl = BigInt(Math.min(st.vl, max));
        st.vl = Number(avl < BigInt(max) ? avl : BigInt(max));
        st.vtype = { ...inst.vtype };
        if (inst.rd !== 'x0') st.x[index(inst.rd)] = BigInt(st.vl);
        fx.xwrite = { reg: inst.rd, value: BigInt(st.vl) };
        return fx;
    }

    if (!st.vtype) fail('vec.noVtype', { inst: inst.text });
    const sew = st.vtype.sew;
    const lmul = st.vtype.lmul ?? 1;
    const nb = sew / 8;
    const vl = st.vl;
    const regBytes = vlen / 8;
    const perReg = regBytes / nb;
    // Operandos que são grupos de LMUL registradores; máscaras e os escalares das reduções ocupam um só.
    if (lmul > 1 && !['mlog', 'mscalar', 'toScalar', 'fromScalar'].includes(d.kind)) {
        const groups = [inst.vs2, inst.vs3];
        if (d.kind !== 'red') groups.push(inst.vs1);
        if (d.kind !== 'red' && d.kind !== 'cmp') groups.push(inst.vd);
        for (const r of groups)
            if (r && index(r) % lmul !== 0) fail('vec.align', { inst: inst.text, reg: r, lmul });
    }
    /** Registrador e posição dentro dele do elemento e de um operando (grupo de registradores ou não). */
    const loc = (r, e, group) => (group ? [index(r) + Math.floor(e / perReg), e % perReg] : [index(r), e]);
    const ri = (r) => index(r);
    const needFp = () => { if (sew !== 32 && sew !== 64) fail('vec.fpSew', { inst: inst.text, sew }); };
    const masked = inst.vm;
    const isActive = (e) => !masked || maskBit(st.v[0], e) === 1;

    const readElem = (slot, r, e, group = true) => {
        const [reg, k] = loc(r, e, group);
        fx.reads.push([slot, reg, k * sew, k * sew + sew]);
        return getRaw(st.v[reg], k, sew);
    };
    const readBit = (slot, r, e) => {
        fx.reads.push([slot, ri(r), e, e + 1]);
        return maskBit(st.v[index(r)], e);
    };
    const readMaskOf = (slot, e) => {
        if (masked) fx.reads.push([slot, 0, e, e + 1]);
        return isActive(e);
    };
    /** Escreve resultados [slot, e, raw] depois de todas as leituras. */
    const writeElems = (r, results, group = true) => {
        for (const [slot, e, raw] of results) {
            const [ix, k] = loc(r, e, group);
            const reg = st.v[ix];
            const bytes = rawBytes(raw, nb);
            for (let i = 0; i < nb; i++) reg[k * nb + i] = bytes[i];
            fx.writes.push([slot, ix, k * sew, k * sew + sew, k * nb, bytes]);
        }
    };
    const writeBits = (r, results) => {
        const reg = st.v[index(r)];
        for (const [slot, e, bit] of results) {
            const b = e >> 3;
            reg[b] = bit ? (reg[b] | (1 << (e & 7))) : (reg[b] & ~(1 << (e & 7)));
            fx.writes.push([slot, ri(r), e, e + 1, b, [reg[b]]]);
        }
    };
    /** Segundo operando de uma operação elemento a elemento, conforme a forma (vv, vx, vf, vi). */
    const operand2 = (slot, e, type) => {
        switch (d.src) {
            case 'vv': return rawToValue(readElem(slot, inst.vs1, e), type, sew);
            case 'vx': return type === 'u' ? unsigned(xval(inst.rs1), sew) : signed(xval(inst.rs1), sew);
            case 'vf': return round(fval(inst.rs1), sew);
            default: return type === 'u' ? unsigned(BigInt(inst.imm), sew) : signed(BigInt(inst.imm), sew);
        }
    };
    if (d.type === 'f' || d.tin === 'f' || d.tout === 'f') needFp();

    switch (d.kind) {
        case 'bin': case 'cmp': {
            fx.slots = vl;
            const res = [];
            for (let e = 0; e < vl; e++) {
                if (!readMaskOf(e, e)) continue;
                fx.active++;
                const a = rawToValue(readElem(e, inst.vs2, e), d.type, sew);
                const b = operand2(e, e, d.type);
                const r = d.fn(a, b, sew);
                res.push([e, e, d.kind === 'cmp' ? (r ? 1 : 0) : valueToRaw(r, d.type, sew)]);
            }
            if (d.kind === 'cmp') writeBits(inst.vd, res);
            else writeElems(inst.vd, res);
            if (d.type === 'f') fx.flops = fx.active;
            break;
        }
        case 'fma': {
            fx.slots = vl;
            const res = [];
            for (let e = 0; e < vl; e++) {
                if (!readMaskOf(e, e)) continue;
                fx.active++;
                const x = d.src === 'vv' ? rawToValue(readElem(e, inst.vs1, e), d.type, sew)
                    : (d.src === 'vf' ? round(fval(inst.rs1), sew) : signed(xval(inst.rs1), sew));
                const y = rawToValue(readElem(e, inst.vs2, e), d.type, sew);
                const acc = rawToValue(readElem(e, inst.vd, e), d.type, sew);
                res.push([e, e, valueToRaw(d.fn(x, y, acc, sew), d.type, sew)]);
            }
            writeElems(inst.vd, res);
            if (d.type === 'f') fx.flops = 2 * fx.active;
            break;
        }
        case 'merge': {
            fx.slots = vl;
            fx.active = vl;
            const res = [];
            for (let e = 0; e < vl; e++) {
                const sel = readBit(e, 'v0', e);
                const v = sel ? operand2(e, e, d.type) : rawToValue(readElem(e, inst.vs2, e), d.type, sew);
                res.push([e, e, valueToRaw(v, d.type, sew)]);
            }
            writeElems(inst.vd, res);
            break;
        }
        case 'mv': {
            fx.slots = vl;
            fx.active = vl;
            const res = [];
            for (let e = 0; e < vl; e++) res.push([e, e, valueToRaw(operand2(e, e, d.type), d.type, sew)]);
            writeElems(inst.vd, res);
            break;
        }
        case 'toScalar': {
            fx.slots = 1;
            fx.active = 1;
            const raw = readElem(0, inst.vs2, 0);
            const value = d.type === 'f' ? rawToValue(raw, 'f', sew) : signed(signed(raw, sew), xlen);
            if (d.type === 'f') st.f[index(inst.rd)] = value;
            else if (inst.rd !== 'x0') st.x[index(inst.rd)] = value;
            fx.xwrite = { reg: inst.rd, value };
            fx.end = true;
            break;
        }
        case 'fromScalar': {
            fx.slots = 1;
            if (vl > 0) {
                fx.active = 1;
                writeElems(inst.vd, [[0, 0, valueToRaw(operand2(0, 0, d.type), d.type, sew)]]);
            }
            break;
        }
        case 'vid': {
            fx.slots = vl;
            const res = [];
            for (let e = 0; e < vl; e++) {
                if (!readMaskOf(e, e)) continue;
                fx.active++;
                res.push([e, e, unsigned(BigInt(e), sew)]);
            }
            writeElems(inst.vd, res);
            break;
        }
        case 'red': {
            fx.slots = vl;
            fx.end = true;
            if (vl === 0) break;
            let acc = rawToValue(readElem(0, inst.vs1, 0, false), d.type, sew);
            for (let e = 0; e < vl; e++) {
                if (!readMaskOf(e, e)) continue;
                fx.active++;
                acc = d.fn(acc, rawToValue(readElem(e, inst.vs2, e), d.type, sew), sew);
            }
            writeElems(inst.vd, [[-1, 0, valueToRaw(acc, d.type, sew)]], false);
            if (d.type === 'f') fx.flops = fx.active;
            break;
        }
        case 'mlog': {
            fx.slots = vl;
            fx.active = vl;
            const res = [];
            for (let e = 0; e < vl; e++) res.push([e, e, d.fn(readBit(e, inst.vs2, e), readBit(e, inst.vs1, e))]);
            writeBits(inst.vd, res);
            break;
        }
        case 'mscalar': {
            fx.slots = vl;
            fx.end = true;
            let count = 0, first = -1;
            for (let e = 0; e < vl; e++) {
                if (!readMaskOf(e, e)) continue;
                fx.active++;
                if (readBit(e, inst.vs2, e)) {
                    count++;
                    if (first < 0) first = e;
                }
            }
            const value = signed(BigInt(d.op === 'cpop' ? count : first), xlen);
            if (inst.rd !== 'x0') st.x[index(inst.rd)] = value;
            fx.xwrite = { reg: inst.rd, value };
            break;
        }
        case 'unary': {
            fx.slots = vl;
            const res = [];
            for (let e = 0; e < vl; e++) {
                if (!readMaskOf(e, e)) continue;
                fx.active++;
                const a = rawToValue(readElem(e, inst.vs2, e), d.tin, sew);
                res.push([e, e, valueToRaw(d.fn(a, sew), d.tout, sew)]);
            }
            writeElems(inst.vd, res);
            if (d.tin === 'f' && d.tout === 'f') fx.flops = fx.active;
            break;
        }
        case 'load': case 'store': {
            if (d.eew !== sew) fail('vec.eew', { inst: inst.text, eew: d.eew, sew });
            fx.slots = vl;
            fx.strided = d.mode !== 'unit';
            const base = unsigned(xval(inst.rs1), xlen);
            const stride = d.mode === 'strided' ? signed(xval(inst.rs2), xlen) : 0n;
            const res = [];
            for (let e = 0; e < vl; e++) {
                if (!readMaskOf(e, e)) continue;
                fx.active++;
                let addr;
                if (d.mode === 'unit') addr = base + BigInt(e * nb);
                else if (d.mode === 'strided') addr = base + BigInt(e) * stride;
                else addr = base + unsigned(readElem(e, inst.vs2, e), sew);
                addr = unsigned(addr, xlen);
                if (d.kind === 'load') {
                    fx.mreads.push([e, addr, nb]);
                    res.push([e, e, readRaw(st.mem, addr, nb)]);
                } else {
                    const raw = readElem(e, inst.vs3, e);
                    writeRaw(st.mem, addr, nb, raw);
                    fx.mwrites.push([e, addr, nb, raw]);
                }
            }
            if (d.kind === 'load') writeElems(inst.vd, res);
            break;
        }
        default:
            fail('vec.unknown', { inst: inst.text });
    }
    return fx;
}
