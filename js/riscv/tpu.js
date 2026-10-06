/**
 * Instruções da TPU didática, inspirada na TPU v1 do Google (Jouppi et al., ISCA 2017), comandada por um
 * núcleo RISC-V. Os dados são inteiros de 32 bits (a TPU v1 usa 8 bits nas entradas; aqui 32 bits deixam os
 * valores legíveis na memória).
 *
 *   tpu.rdhost  ub, (rs1), linhas     lê linhas de N elementos da memória do host para o Unified Buffer
 *   tpu.wrhost  (rs1), ub, linhas     escreve linhas do Unified Buffer na memória do host
 *   tpu.rdw     (rs1)                 lê um bloco de pesos N x N da memória para a fila de pesos
 *   tpu.matmul  acc, ub, linhas       multiplica linhas do Unified Buffer pelo bloco de pesos seguinte da fila
 *                                     no array sistólico e escreve nos acumuladores
 *   tpu.matmul.acc acc, ub, linhas    o mesmo, somando ao valor dos acumuladores
 *   tpu.act     ub, acc, linhas, f    aplica a função f (relu ou none) aos acumuladores e escreve no buffer
 *
 * A execução devolve os acessos de cada linha (slot), usados pelo modelo temporal: recursos lidos e escritos
 * ('ub3', 'acc0', 'wf1r2': linha 2 da posição 1 da fila de pesos), com um deslocamento opcional do ciclo
 * de leitura, e os endereços de memória.
 */
import { signed, unsigned } from './bits.js';
import { readRaw, writeRaw } from './memory.js';
import { index } from './registers.js';
import { t } from '../i18n/index.js';

/** Classes de operação da TPU: DMA do host, carga de pesos, unidade de multiplicação e ativação. */
export const TPU_CLASSES = ['tdma', 'twload', 'tmxu', 'tact'];

export const ACT_FUNCS = ['none', 'relu'];

/** Configuração padrão da TPU (dimensão do array, linhas do buffer e dos acumuladores, fila de pesos). */
export const DEFAULT_TPU = { n: 4, ubRows: 16, accRows: 16, fifoDepth: 2, memLatency: 6, actLatency: 2 };

export class TpuError extends Error { }

const fail = (key, params = {}) => { throw new TpuError(t(key, params)); };

export function registerTpu(def) {
    const T = (name, props) => def(name, { fmt: 'V', tpu: true, masked: false, ...props });
    T('tpu.rdhost', { cls: 'tdma', kind: 'rdhost', vops: ['dst', 'mem', 'rows'] });
    T('tpu.wrhost', { cls: 'tdma', kind: 'wrhost', vops: ['mem', 'src', 'rows'] });
    T('tpu.rdw', { cls: 'twload', kind: 'rdw', vops: ['mem'] });
    T('tpu.matmul', { cls: 'tmxu', kind: 'matmul', vops: ['dst', 'src', 'rows'] });
    T('tpu.matmul.acc', { cls: 'tmxu', kind: 'matmul', accumulate: true, vops: ['dst', 'src', 'rows'] });
    T('tpu.act', { cls: 'tact', kind: 'act', vops: ['dst', 'src', 'rows', 'func'] });
}

/** Estado inicial da TPU: buffer, acumuladores e fila de pesos zerados. */
export function createTpuState(tc) {
    return {
        ub: Array.from({ length: tc.ubRows }, () => new Array(tc.n).fill(0n)),
        acc: Array.from({ length: tc.accRows }, () => new Array(tc.n).fill(0n)),
        fifo: [],
        pushed: 0,
        popped: 0,
        weights: null,
    };
}

const w32 = (v) => signed(v, 32);

/**
 * Executa uma instrução da TPU sobre o estado `st` ({x, mem, tpu}), alterando-o.
 * @returns {object} acessos: slots, reads [slot, recurso, deslocamento opcional], writes [slot, recurso,
 *          valores, deslocamento opcional], mreads, mwrites, xreads, macs, tile
 */
export function execTpu(st, inst, xlen, tc) {
    const d = inst.def;
    const tp = st.tpu;
    const n = tc.n;
    const fx = { slots: 0, reads: [], writes: [], mreads: [], mwrites: [], xreads: [], xwrite: null, macs: 0, tile: null };
    if (inst.rs1) fx.xreads.push(inst.rs1);
    const base = inst.rs1 ? unsigned(inst.rs1 === 'x0' ? 0n : st.x[index(inst.rs1)], xlen) : 0n;
    const rows = inst.rows ?? 0;
    const checkRows = (buf, first, count, size, name) => {
        if (first + count > size) fail('tpu.rowRange', { inst: inst.text, buf: name, last: first + count - 1, size });
    };
    switch (d.kind) {
        case 'rdhost': {
            checkRows(tp.ub, inst.dst, rows, tc.ubRows, 'UB');
            fx.slots = rows;
            for (let r = 0; r < rows; r++) {
                const row = [];
                for (let j = 0; j < n; j++) {
                    const addr = unsigned(base + BigInt(4 * (r * n + j)), xlen);
                    row.push(signed(readRaw(st.mem, addr, 4), 32));
                }
                fx.mreads.push([r, unsigned(base + BigInt(4 * r * n), xlen), 4 * n]);
                tp.ub[inst.dst + r] = row;
                fx.writes.push([r, `ub${inst.dst + r}`, [...row]]);
            }
            break;
        }
        case 'wrhost': {
            checkRows(tp.ub, inst.src, rows, tc.ubRows, 'UB');
            fx.slots = rows;
            for (let r = 0; r < rows; r++) {
                fx.reads.push([r, `ub${inst.src + r}`]);
                const row = tp.ub[inst.src + r];
                const addr = unsigned(base + BigInt(4 * r * n), xlen);
                let raw = 0n;
                for (let j = n - 1; j >= 0; j--) raw = (raw << 32n) | unsigned(row[j], 32);
                writeRaw(st.mem, addr, 4 * n, raw);
                fx.mwrites.push([r, addr, 4 * n, raw]);
            }
            break;
        }
        case 'rdw': {
            if (tp.pushed - tp.popped >= tc.fifoDepth) fail('tpu.fifoFull', { inst: inst.text, n: tc.fifoDepth });
            const slot = tp.pushed % tc.fifoDepth;
            const tile = [];
            fx.slots = n;
            for (let i = 0; i < n; i++) {
                const row = [];
                for (let j = 0; j < n; j++) row.push(signed(readRaw(st.mem, unsigned(base + BigInt(4 * (i * n + j)), xlen), 4), 32));
                fx.mreads.push([i, unsigned(base + BigInt(4 * i * n), xlen), 4 * n]);
                fx.writes.push([i, `wf${slot}r${i}`, [...row]]);
                tile.push(row);
            }
            tp.fifo.push(tile);
            fx.tile = tp.pushed;
            tp.pushed++;
            break;
        }
        case 'matmul': {
            if (tp.fifo.length === 0) fail('tpu.noWeights', { inst: inst.text });
            checkRows(tp.ub, inst.src, rows, tc.ubRows, 'UB');
            checkRows(tp.acc, inst.dst, rows, tc.accRows, 'ACC');
            const slot = tp.popped % tc.fifoDepth;
            const W = tp.fifo.shift();
            fx.tile = tp.popped;
            tp.popped++;
            tp.weights = W;
            fx.slots = rows;
            // Os pesos entram no array uma linha por ciclo, nos N ciclos anteriores ao início.
            for (let i = 0; i < n; i++) fx.reads.push([0, `wf${slot}r${i}`, -n + i]);
            const results = [];
            for (let r = 0; r < rows; r++) {
                fx.reads.push([r, `ub${inst.src + r}`]);
                const x = tp.ub[inst.src + r];
                const out = [];
                for (let j = 0; j < n; j++) {
                    let s = 0n;
                    for (let i = 0; i < n; i++) s += x[i] * W[i][j];
                    out.push(s);
                }
                results.push(out);
            }
            fx.macs = rows * n * n;
            for (let r = 0; r < rows; r++) {
                const a = inst.dst + r;
                if (d.accumulate) fx.reads.push([r, `acc${a}`, 'write']);
                const row = results[r].map((v, j) => w32(d.accumulate ? tp.acc[a][j] + v : v));
                tp.acc[a] = row;
                fx.writes.push([r, `acc${a}`, [...row]]);
            }
            fx.inputs = Array.from({ length: rows }, (_, r) => [...tp.ub[inst.src + r]]);
            fx.W = W.map((row) => [...row]);
            break;
        }
        case 'act': {
            checkRows(tp.acc, inst.src, rows, tc.accRows, 'ACC');
            checkRows(tp.ub, inst.dst, rows, tc.ubRows, 'UB');
            fx.slots = rows;
            const results = [];
            for (let r = 0; r < rows; r++) {
                fx.reads.push([r, `acc${inst.src + r}`]);
                results.push(tp.acc[inst.src + r].map((v) => (inst.func === 'relu' && v < 0n ? 0n : v)));
            }
            for (let r = 0; r < rows; r++) {
                tp.ub[inst.dst + r] = results[r];
                fx.writes.push([r, `ub${inst.dst + r}`, [...results[r]]]);
            }
            break;
        }
        default:
            fail('tpu.unknown', { inst: inst.text });
    }
    return fx;
}
