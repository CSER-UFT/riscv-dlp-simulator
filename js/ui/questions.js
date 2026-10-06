/**
 * Perguntas do modo exercício próprias de cada modelo (transações e máscaras na GPU, MACs e entrada dos
 * pesos na TPU, elementos e ocupação no processador vetorial), geradas a partir da simulação.
 *
 * Cada pergunta tem um texto (com `código` entre crases), a resposta e o tipo da resposta:
 *   num    número inteiro (aceita também hexadecimal com 0x)
 *   addr   endereço (aceita decimal ou hexadecimal com 0x)
 *   mask   máscara de threads como sequência de 0 e 1 (a thread 0 primeiro)
 */
import { t } from '../i18n/index.js';
import { immediatePostDominators } from '../riscv/gpu.js';
import * as fmt from '../riscv/format.js';

const MAX_QUESTIONS = 8;

/** Confere uma resposta do aluno. */
export function checkAnswer(q, value) {
    const v = String(value ?? '').trim();
    if (v === '') return false;
    if (q.kind === 'mask') return v.replace(/\s+/g, '') === q.answer;
    const n = Number(v.replace(',', '.'));
    return Number.isFinite(n) && n === q.answer;
}

/** Texto da resposta esperada. */
export const answerText = (q) => (q.kind === 'addr' ? fmt.address(q.answer) : String(q.answer));

function gpuQuestions(sim) {
    const qs = [];
    const g = sim.config.gpu;
    const inst = (d) => sim.program.instructions[d.index];
    const code = (d) => `\`${d.text}\``;
    const mem = sim.dyn.filter((d) => d.timing.txn !== null && d.timing.txn !== undefined);
    if (mem.length) {
        const first = mem[0];
        qs.push({ text: t('q.gpu.txn', { inst: code(first), c: first.issue, b: g.lineBytes }), answer: first.timing.txn, kind: 'num' });
        const most = mem.reduce((a, b) => (b.timing.txn > a.timing.txn ? b : a));
        if (most !== first && most.timing.txn !== first.timing.txn)
            qs.push({ text: t('q.gpu.txn', { inst: code(most), c: most.issue, b: g.lineBytes }), answer: most.timing.txn, kind: 'num' });
    }
    const sh = sim.dyn.filter((d) => d.timing.degree !== null && d.timing.degree !== undefined);
    if (sh.length) {
        const worst = sh.reduce((a, b) => (b.timing.degree > a.timing.degree ? b : a));
        qs.push({ text: t('q.gpu.degree', { inst: code(worst), c: worst.issue, banks: g.smemBanks }), answer: worst.timing.degree, kind: 'num' });
        qs.push({ text: t('q.gpu.occ', { inst: code(worst), lanes: g.lanes }), answer: worst.timing.occ, kind: 'num' });
    }
    // Primeiro desvio divergente: máscara do caminho seguinte e ponto de reconvergência.
    const ipdom = immediatePostDominators(sim.program);
    for (let k = 0; k < sim.dyn.length; k++) {
        const d = sim.dyn[k];
        if (inst(d).def.cls !== 'branch') continue;
        const next = sim.dyn.slice(k + 1).find((x) => x.warp === d.warp);
        if (!next || next.mask === d.mask) continue;
        const r = ipdom[d.index];
        qs.push({ text: t('q.gpu.mask', { inst: code(d), c: d.issue }), answer: next.mask, kind: 'mask' });
        if (r >= 0) qs.push({ text: t('q.gpu.reconv', { inst: code(d) }), answer: sim.program.instructions[r].pc, kind: 'addr' });
        break;
    }
    if (g.blocks > 1) {
        qs.push({ text: t('q.gpu.resident', { b: g.blocks, w: g.warps, mw: g.maxWarps, smem: g.smemBytes, sh: sim.program.shared?.size ?? 0 }), answer: sim.stats.maxResident, kind: 'num' });
        const late = sim.blocks.find((b) => b.start > 0);
        if (late) qs.push({ text: t('q.gpu.launch', { b: late.id }), answer: late.start, kind: 'num' });
    }
    return qs;
}

function tpuQuestions(sim) {
    const qs = [];
    const N = sim.config.tpu.n;
    const code = (d) => `\`${d.text}\``;
    const mm = sim.dyn.filter((d) => d.timing?.mxuStart !== null && d.timing?.mxuStart !== undefined);
    if (mm.length) {
        const d = mm[0];
        qs.push({ text: t('q.tpu.macs', { inst: code(d), n: N }), answer: d.timing.slots * N * N, kind: 'num' });
        if (d.timing.mxuStart - N >= 1) qs.push({ text: t('q.tpu.weights', { inst: code(d) }), answer: d.timing.mxuStart - N, kind: 'num' });
        qs.push({ text: t('q.tpu.lastRow', { inst: code(d) }), answer: d.commit, kind: 'num' });
        if (mm.length > 1) {
            const e = mm[1];
            qs.push({ text: t('q.tpu.next', { inst: code(e), prev: code(d) }), answer: e.issue, kind: 'num' });
        }
    }
    qs.push(...stallQuestion(sim));
    qs.push({ text: t('q.tpu.use', { n: N }), answer: Math.round((100 * sim.stats.macs) / (sim.stats.cycles * N * N)), kind: 'num' });
    return qs;
}

function vectorQuestions(sim) {
    const qs = [];
    const lanes = sim.config.vector.lanes;
    const code = (d) => `\`${d.text}\``;
    const vec = sim.dyn.filter((d) => d.timing?.vector && d.timing.slots);
    if (vec.length) {
        const d = vec[0];
        qs.push({ text: t('q.vec.vl', { inst: code(d) }), answer: d.timing.slots, kind: 'num' });
        const big = vec.find((x) => x.timing.slots > lanes) ?? d;
        qs.push({ text: t('q.vec.groups', { inst: code(big), lanes }), answer: Math.ceil(big.timing.slots / lanes), kind: 'num' });
    }
    qs.push(...stallQuestion(sim));
    return qs;
}

/** Instrução que mais esperou para ser emitida. */
function stallQuestion(sim) {
    const st = sim.dyn.filter((d) => d.stalls > 0);
    if (!st.length) return [];
    const d = st.reduce((a, b) => (b.stalls > a.stalls ? b : a));
    return [{ text: t('q.stalls', { inst: `\`${d.text}\``, c: d.issue }), answer: d.stalls, kind: 'num' }];
}

/** Perguntas da simulação, sempre terminando com o total de ciclos. */
export function buildQuestions(sim) {
    const qs = sim.model === 'gpu' ? gpuQuestions(sim) : sim.model === 'tpu' ? tpuQuestions(sim) : vectorQuestions(sim);
    return [...qs.slice(0, MAX_QUESTIONS - 1), { text: t('q.cycles'), answer: sim.stats.cycles, kind: 'num' }];
}
