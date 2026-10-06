/**
 * Diagrama da TPU: emissão, unidade escalar, unidades DMA, WDMA e ACT, fila de pesos, array sistólico com o
 * fluxo das entradas (para a direita) e das somas parciais (para baixo), Unified Buffer, acumuladores,
 * registradores escalares, memória e estatísticas.
 */
import * as fmt from '../riscv/format.js';
import { t } from '../i18n/index.js';
import { esc, dynColor, COLORS, registersPanel, memoryPanel, statsPanel } from './panels.js';
import { issuePanel, scalarPanel } from './diagram-vector.js';

const rowColor = (r) => COLORS[(r + 3) % COLORS.length];
const num = (v) => (v === null || v === undefined ? '' : v.toString());

function unitPanel(ctx, snap, u, focus) {
    const c = snap.cycle;
    const lines = u.ops.map((op) => {
        const entering = c < op.t0 + op.G ? c - op.t0 : null;
        const state = entering !== null
            ? t('ui.tpu.entering', { r: entering, n: entering + 1, total: op.G })
            : t('ui.vec.draining', { c: op.done });
        return `<li style="--tag:${dynColor(op.dyn)}"><code class="tagged">${esc(ctx.sim.dyn[op.dyn].text)}</code> <span class="sub">${esc(state)}</span></li>`;
    }).join('');
    return `<section class="panel unit small ${u.ops.length ? 'busy' : ''} ${focus.has(`unit:${u.name}`) ? 'focus' : ''}">
        <h3>${esc(u.name)} <span class="sub">${esc(t(`ui.tpu.unit.${u.name}`))}</span></h3>
        ${lines ? `<ul class="ops">${lines}</ul>` : `<p class="dim">${t('ui.vec.free')}</p>`}</section>`;
}

function fifoPanel(ctx, snap, focus) {
    const cfg = ctx.sim.config.tpu;
    const items = snap.fifo.map((f) => `<li><b>${t('ui.tpu.tile', { k: f.k })}</b> <span class="sub">${esc(t(`ui.tpu.fifo.${f.state}`, { slot: f.slot }))}</span></li>`).join('');
    return `<section class="panel fifo ${focus.has('fifo') ? 'focus' : ''}">
        <h3>${t('ui.tpu.fifoTitle')} <span class="sub">${t('ui.tpu.fifoSub', { n: cfg.fifoDepth })}</span></h3>
        ${items ? `<ul class="ops">${items}</ul>` : `<p class="dim">${t('ui.tpu.fifoEmpty')}</p>`}
        <p class="note">${snap.array ? t('ui.tpu.inArray', { k: snap.array.k }) : t('ui.tpu.noArray')}</p></section>`;
}

/** Array sistólico no ciclo do instantâneo. */
function arrayPanel(ctx, snap, focus) {
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
    const body = cells.map((row, i) => {
        const queue = inputs[i].slice().reverse().map((q) => `<span class="q" style="--tag:${rowColor(q.r)}">${esc(num(q.x))}</span>`).join('');
        const pes = row.map((cell, j) => {
            const w = cell ? cell.w : (weights ? weights[i][j] : null);
            if (!cell) return `<td class="pe"><span class="w">${esc(num(w))}</span></td>`;
            return `<td class="pe on" style="--tag:${rowColor(cell.r)}" title="${esc(t('ui.tpu.peTitle', { r: cell.r, i, j }))}">
                <span class="w">${esc(num(w))}</span><span class="x">${esc(num(cell.x))} →</span><span class="ps">Σ ${esc(num(cell.psum))} ↓</span></td>`;
        }).join('');
        return `<tr><th class="inq">${queue}</th>${pes}</tr>`;
    }).join('');
    const out = outputs.map((o) => (o
        ? `<td class="out" style="--tag:${rowColor(o.r)}">${esc(num(o.v))}<span class="sub">${o.add ? '+' : ''}ACC[${o.acc}]</span></td>`
        : '<td class="out"></td>')).join('');
    const active = snap.mxu.length > 0;
    return `<section class="panel systolic ${active ? 'busy' : ''} ${focus.has('unit:MXU') ? 'focus' : ''}">
        <h3>MXU <span class="sub">${t('ui.tpu.arraySub', { n: N })}</span></h3>
        <table class="systolic"><tr><th class="inq">${t('ui.tpu.inputs')}</th>${Array.from({ length: N }, (_, j) => `<th>${t('ui.tpu.col', { j })}</th>`).join('')}</tr>
            ${body}<tr><th class="inq">${t('ui.tpu.outputs')}</th>${out}</tr></table>
        ${snap.mxu.map((op) => `<p class="note"><code class="tagged" style="--tag:${dynColor(op.dyn)}">${esc(ctx.sim.dyn[op.dyn].text)}</code> ${esc(t('ui.tpu.mxuOp', { k: op.tile, rows: op.rows }))}</p>`).join('')}
        <p class="note">${t('ui.tpu.arrayNote')}</p></section>`;
}

function bufferPanel(title, sub, rows, data, written, focused, part) {
    const w = new Set(written ?? []);
    const body = rows.map((r) => `<tr class="${w.has(r) ? 'new' : ''}"><th>${r}</th>${data[r].map((v) => `<td class="num">${esc(num(v))}</td>`).join('')}</tr>`).join('');
    return `<section class="panel buffer ${focused ? 'focus' : ''}" data-part="${part}"><h3>${title} <span class="sub">${sub}</span></h3>
        ${body ? `<table class="buf">${body}</table>` : `<p class="dim">${t('ui.tpu.unused')}</p>`}</section>`;
}

export function renderTpu(el, ctx, snap) {
    const focus = new Set(snap.focus ?? []);
    const cfg = ctx.sim.config.tpu;
    const ub = ctx.ubRows.filter((r) => r < cfg.ubRows);
    const acc = ctx.accRows.filter((r) => r < cfg.accRows);
    const others = snap.units.filter((u) => u.name !== 'MXU');
    el.innerHTML = `
        <div class="vec-wrap">
            <div class="pipe-head">
                <span class="pcbox ${focus.has('pc') ? 'focus' : ''}">PC = ${fmt.address(snap.pc)}</span>
                <span class="sub">${esc(t('ui.tpu.head', { n: cfg.n, ub: cfg.ubRows, acc: cfg.accRows, fifo: cfg.fifoDepth }))}</span>
            </div>
            <div class="vec-row">
                <div class="vec-side">${issuePanel(ctx, snap, focus)}${scalarPanel(ctx, snap)}${others.map((u) => unitPanel(ctx, snap, u, focus)).join('')}</div>
                <div class="tpu-core">${fifoPanel(ctx, snap, focus)}${arrayPanel(ctx, snap, focus)}</div>
                <div class="vec-side">
                    ${bufferPanel(t('ui.tpu.ub'), t('ui.tpu.ubSub', { n: cfg.ubRows }), ub, snap.ub, snap.written.ub, focus.has('ub'), 'ub')}
                    ${bufferPanel(t('ui.tpu.acc'), t('ui.tpu.accSub', { n: cfg.accRows }), acc, snap.acc, snap.written.acc, focus.has('acc'), 'acc')}
                </div>
            </div>
            <div class="pipe-bottom">
                ${registersPanel(ctx, snap, focus)}${memoryPanel(ctx, snap, focus)}${statsPanel(ctx)}
            </div>
        </div>`;
}
