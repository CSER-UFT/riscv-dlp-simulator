/**
 * Diagrama do processador vetorial: o desenho de blocos (vector-svg.js) com a emissão, a unidade escalar e
 * as lanes, seguido dos registradores escalares, da memória e das estatísticas. Os painéis de emissão e da
 * unidade escalar continuam aqui porque a TPU os usa; laneGrid e vregRows servem ao desenho e à exportação.
 */
import * as fmt from '../riscv/format.js';
import { getRaw, rawToValue, maskBit } from '../riscv/vector.js';
import { t } from '../i18n/index.js';
import { className } from '../core/config.js';
import { esc, dynColor, laneColor, registersPanel, memoryPanel, statsPanel } from './panels.js';
import { vectorSvg } from './vector-svg.js';

const instText = (ctx, id) => esc(ctx.sim.dyn[id].text);

export function issuePanel(ctx, snap, focus) {
    const is = snap.issue;
    let body;
    if (!is) body = `<p class="dim">${t('ui.vec.issueIdle')}</p>`;
    else if (is.kind === 'bubble') body = `<p class="bubble">${t('ui.vec.bubble')}</p>`;
    else if (is.kind === 'halted') body = `<p class="dim">${t('ui.vec.halted')}</p>`;
    else if (is.kind === 'end') body = `<p class="dim">${t('ui.vec.end')}</p>`;
    else {
        const stalled = is.kind === 'stall';
        const key = ctx.sim.model === 'tpu' && is.reason === 'raw' ? 'ui.tpu.whyRaw' : `ui.vec.why.${is.reason}`;
        const why = stalled ? `<p class="note warn">${esc(t(key, { reg: is.reg ?? '', unit: is.unit ?? '', t: is.until }))}</p>` : `<p class="note ok">${t('ui.vec.issued')}</p>`;
        body = `<div class="pinst ${stalled ? 'stalled' : ''}" style="--tag:${dynColor(is.dyn)}"><code>${instText(ctx, is.dyn)}</code></div>${why}`;
    }
    const next = [];
    const prog = ctx.sim.program.instructions;
    let i = Math.max(0, (snap.pc - prog[0].pc) / 4);
    if (is && (is.kind === 'stall')) i = ctx.sim.dyn[is.dyn].index + 1;
    for (let k = 0; k < 3 && i + k < prog.length && !snap.halted; k++) next.push(`<li><code>${esc(prog[i + k].text)}</code></li>`);
    return `<section class="panel issue ${focus.has('issue') ? 'focus' : ''}" data-part="issue">
        <h3>${t('ui.vec.issue')}</h3>${body}
        ${next.length ? `<p class="note">${t('ui.vec.next')}</p><ol class="queue">${next.join('')}</ol>` : ''}</section>`;
}

export function scalarPanel(ctx, snap) {
    const ops = snap.scalar ?? [];
    const rows = ops.map((o) => `<li style="--tag:${dynColor(o.dyn)}"><code class="tagged">${instText(ctx, o.dyn)}</code>
        <span class="sub">${t('ui.vec.readyAt', { c: o.done })}</span></li>`).join('');
    return `<section class="panel scalar"><h3>${t('ui.vec.scalarUnit')} <span class="sub">${t('ui.vec.scalarSub')}</span></h3>
        ${rows ? `<ul class="ops">${rows}</ul>` : `<p class="dim">${t('ui.vec.free')}</p>`}</section>`;
}

/** Elementos de um grupo de uma operação. */
function groupElems(op, g) {
    const out = [];
    for (let e = g * op.rate; e < Math.min(op.slots, (g + 1) * op.rate); e++) out.push(e);
    return out;
}

/**
 * Ocupação de uma unidade no ciclo do instantâneo: grade lanes x estágios com o elemento em cada posição e,
 * para cada operação, os elementos que entram neste ciclo. Usada pelo diagrama e pela exportação em TikZ.
 */
export function laneGrid(ctx, snap, i) {
    const cfg = ctx.sim.config;
    const L = cfg.vector.lanes;
    const unitCfg = cfg.vector.units[i];
    const depth = Math.max(...unitCfg.classes.map((k) => cfg.latency[k]));
    const grid = Array.from({ length: L }, () => new Array(depth).fill(null));
    const c = snap.cycle;
    const entering = [];
    for (const op of snap.units[i].ops) {
        let ent = null;
        for (let g = 0; g < op.G; g++) {
            const stage = c - (op.t0 + g);
            if (stage < 0 || stage >= op.S) continue;
            const elems = groupElems(op, g);
            if (stage === 0) ent = elems;
            for (const e of elems) grid[e % L][stage] = { e, dyn: op.dyn };
        }
        entering.push(ent);
    }
    return { L, depth, grid, entering };
}

/** Valor de um elemento para exibição. */
function elemText(bytes, e, sew, type) {
    const raw = getRaw(bytes, e, sew);
    if (type === 'f' && (sew === 32 || sew === 64)) return fmt.value(rawToValue(raw, 'f', sew));
    return rawToValue(raw, 'i', sew).toString();
}

/**
 * Linhas dos registradores vetoriais usados pelo programa: nome, tipo de exibição e células (texto, cauda,
 * escrita no passo, lane). Usadas pelo diagrama e pela exportação em LaTeX.
 */
export function vregRows(ctx, snap) {
    const cfg = ctx.sim.config;
    const vlen = cfg.vector.vlen;
    const L = cfg.vector.lanes;
    const curSew = snap.vtype?.sew ?? 32;
    const curLmul = snap.vtype?.lmul ?? 1;
    const vl = snap.vl;
    return ctx.vregs.map((i) => {
        const isMask = ctx.maskRegs.has(i);
        const view = snap.view[i] ?? { sew: curSew, type: isMask ? 'm' : (ctx.fpRegs.has(i) ? 'f' : 'i'), off: isMask ? 0 : (i % curLmul) * (vlen / curSew) };
        const off = view.off ?? 0;
        const bytes = snap.v[i];
        const written = new Set(snap.written[`v${i}`] ?? []);
        let cells;
        if (view.type === 'm') {
            const n = vlen / curSew;
            cells = Array.from({ length: n }, (_, e) => ({ e, text: String(maskBit(bytes, e)), tail: e >= vl, isNew: written.has(e), lane: e % L }));
        } else {
            const n = vlen / view.sew;
            cells = Array.from({ length: n }, (_, k) => {
                const e = off + k;
                return { e, text: elemText(bytes, k, view.sew, view.type), tail: e >= vl, isNew: written.has(e), lane: e % L };
            });
        }
        const kind = view.type === 'm' ? t('ui.vec.mask') : `e${view.sew}${view.type === 'f' ? ' float' : ''}${off ? ` · ${t('ui.vec.fromElem', { e: off })}` : ''}`;
        return { i, name: `v${i}`, kind, off, cells };
    });
}

export function renderVector(el, ctx, snap) {
    const focus = new Set(snap.focus ?? []);
    const cfg = ctx.sim.config;
    el.dataset.model = ctx.sim.model;
    const vt = snap.vtype;
    const vlText = vt ? t('ui.vec.vlBox', { vl: snap.vl, sew: vt.sew, lmul: vt.lmul ?? 1, max: (cfg.vector.vlen * (vt.lmul ?? 1)) / vt.sew }) : t('ui.vec.noVtype');
    const options = [
        `VLEN ${cfg.vector.vlen}`,
        t('ui.vec.lanesN', { n: cfg.vector.lanes }),
        t(cfg.vector.chaining ? 'ui.vec.chainOn' : 'ui.vec.chainOff'),
    ].join(' · ');
    el.innerHTML = `
        <div class="vec-wrap">
            <div class="pipe-head">
                <span class="pcbox ${focus.has('pc') ? 'focus' : ''}">PC = ${fmt.address(snap.pc)}</span>
                <span class="pcbox ${focus.has('vl') ? 'focus' : ''}">${esc(vlText)}</span>
                <span class="sub">${esc(options)}</span>
            </div>
            <section class="panel vec-diagram">${vectorSvg(ctx, snap, focus)}
                <p class="note">${t('ui.vec.svg.note')}</p></section>
            <div class="pipe-bottom">
                ${registersPanel(ctx, snap, focus)}${memoryPanel(ctx, snap, focus)}${statsPanel(ctx)}
            </div>
        </div>`;
}
