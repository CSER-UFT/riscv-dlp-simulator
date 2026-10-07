/**
 * Diagrama da TPU: o desenho de blocos (tpu-svg.js) com a emissão, a unidade escalar, o Unified Buffer, a
 * fila de pesos, o array sistólico, os acumuladores e a ativação, seguido dos registradores escalares, da
 * memória e das estatísticas. systolicState também serve à exportação em TikZ.
 */
import * as fmt from '../riscv/format.js';
import { t } from '../i18n/index.js';
import { esc, COLORS, registersPanel, memoryPanel, statsPanel } from './panels.js';
import { tpuSvg } from './tpu-svg.js';

export const rowColor = (r) => COLORS[(r + 3) % COLORS.length];
export const num = (v) => (v === null || v === undefined ? '' : v.toString());

/**
 * Estado do array sistólico no ciclo do instantâneo: célula de cada elemento de processamento (linha de entrada
 * r, entrada x, peso w e soma parcial), os resultados que saem embaixo e os próximos valores de cada linha.
 * Usado pelo diagrama e pela exportação em TikZ.
 */
export function systolicState(ctx, snap) {
    const N = ctx.sim.config.tpu.n;
    const c = snap.cycle;
    const cells = Array.from({ length: N }, () => new Array(N).fill(null));
    const outputs = new Array(N).fill(null);
    const inputs = Array.from({ length: N }, () => []);
    let weights = snap.array?.W ?? null;
    for (const op of snap.mxu) {
        if (!weights && c >= op.t0) weights = op.W;
        for (let i = 0; i < N; i++) {
            for (let j = 0; j < N; j++) {
                const r = c - op.t0 - i - j;
                if (r < 0 || r >= op.rows) continue;
                let psum = 0n;
                for (let k = 0; k <= i; k++) psum += op.X[r][k] * op.W[k][j];
                cells[i][j] = { r, x: op.X[r][i], w: op.W[i][j], psum, dyn: op.dyn };
                if (i === N - 1) outputs[j] = { r, v: BigInt.asIntN(32, psum), acc: op.acc + r, add: op.accumulate };
            }
            // Próximos valores que vão entrar na linha i do array (a entrada é defasada: a linha i atrasa i ciclos).
            for (let r = c - op.t0 - i + 1; r < op.rows && inputs[i].length < 3; r++)
                if (r >= 0) inputs[i].push({ r, x: op.X[r][i] });
        }
    }
    return { N, cells, outputs, inputs, weights };
}

export function renderTpu(el, ctx, snap) {
    const focus = new Set(snap.focus ?? []);
    const cfg = ctx.sim.config.tpu;
    el.innerHTML = `
        <div class="vec-wrap">
            <div class="pipe-head">
                <span class="pcbox ${focus.has('pc') ? 'focus' : ''}">PC = ${fmt.address(snap.pc)}</span>
                <span class="sub">${esc(t('ui.tpu.head', { n: cfg.n, ub: cfg.ubRows, acc: cfg.accRows, fifo: cfg.fifoDepth }))}${cfg.dtype === 'int8' ? ` · ${esc(t('ui.tpu.int8Head', { s: cfg.shift }))}` : ''}</span>
            </div>
            <section class="panel vec-diagram">${tpuSvg(ctx, snap, focus)}
                <p class="note">${t('ui.tpu.arrayNote')} ${t('ui.tpu.svg.note')}</p></section>
            <div class="pipe-bottom">
                ${registersPanel(ctx, snap, focus)}${memoryPanel(ctx, snap, focus, { bytes: cfg.dtype === 'int8' })}${statsPanel(ctx)}
            </div>
        </div>`;
}
