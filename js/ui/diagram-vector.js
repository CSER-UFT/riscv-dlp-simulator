/**
 * Diagrama do processador vetorial: emissão, unidade escalar, unidades funcionais vetoriais com as lanes e
 * os estágios de pipeline, banco de registradores vetoriais, registradores escalares, memória e estatísticas.
 */
import * as fmt from '../riscv/format.js';
import { getRaw, rawToValue, maskBit } from '../riscv/vector.js';
import { t } from '../i18n/index.js';
import { className } from '../core/config.js';
import { esc, dynColor, laneColor, registersPanel, memoryPanel, statsPanel } from './panels.js';

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

function unitPanel(ctx, snap, u, i, focus) {
    const cfg = ctx.sim.config;
    const L = cfg.vector.lanes;
    const unitCfg = cfg.vector.units[i];
    const depth = Math.max(...unitCfg.classes.map((c) => cfg.latency[c]));
    const grid = Array.from({ length: L }, () => new Array(depth).fill(null));
    const c = snap.cycle;
    const lines = [];
    for (const op of u.ops) {
        let entering = null;
        for (let g = 0; g < op.G; g++) {
            const stage = c - (op.t0 + g);
            if (stage < 0 || stage >= op.S) continue;
            const elems = groupElems(op, g);
            if (stage === 0) entering = elems;
            for (const e of elems) grid[e % L][stage] = { e, dyn: op.dyn };
        }
        const entered = Math.min(op.slots, Math.max(0, (c - op.t0 + 1)) * op.rate);
        const lastWrite = op.t0 + op.G - 1 + op.S - 1;
        let state;
        if (op.slots === 0) state = t('ui.vec.noElems');
        else if (entering) state = t('ui.vec.entering', { list: `${entering[0]}..${entering[entering.length - 1]}`, n: entered, total: op.slots });
        else if (op.end && c > lastWrite) state = t('ui.vec.reducing', { c: op.done });
        else state = t('ui.vec.draining', { c: op.done });
        lines.push(`<li style="--tag:${dynColor(op.dyn)}"><code class="tagged">${instText(ctx, op.dyn)}</code> <span class="sub">${esc(state)}</span></li>`);
    }
    const head = `<tr><th>${t('ui.vec.lane')}</th>${Array.from({ length: depth }, (_, k) => `<th>${k + 1}</th>`).join('')}</tr>`;
    const body = grid.map((row, lane) => `<tr><th class="lane" style="--lane:${laneColor(lane)}">${lane}</th>${row.map((cell) => (cell
        ? `<td class="el" style="--tag:${dynColor(cell.dyn)}">${cell.e}</td>`
        : '<td></td>')).join('')}</tr>`).join('');
    const classes = unitCfg.classes.map((k) => t('ui.vec.classLat', { cls: t(`classShort.${k}`), n: cfg.latency[k] })).join(', ');
    return `<section class="panel unit ${u.ops.length ? 'busy' : ''} ${focus.has(`unit:${u.name}`) ? 'focus' : ''}" data-unit="${esc(u.name)}">
        <h3>${esc(u.name)} <span class="sub">${esc(t(unitCfg.pipelined ? 'ui.vec.pipelined' : 'ui.vec.notPipelined'))}</span></h3>
        <p class="note" title="${esc(unitCfg.classes.map((k) => className(k)).join(', '))}">${esc(classes)}</p>
        <table class="lanes"><tr><th></th><th colspan="${depth}">${t('ui.vec.stages')}</th></tr>${head}${body}</table>
        ${lines.length ? `<ul class="ops">${lines.join('')}</ul>` : `<p class="dim">${t('ui.vec.free')}</p>`}</section>`;
}

/** Valor de um elemento para exibição. */
function elemText(bytes, e, sew, type) {
    const raw = getRaw(bytes, e, sew);
    if (type === 'f' && (sew === 32 || sew === 64)) return fmt.value(rawToValue(raw, 'f', sew));
    return rawToValue(raw, 'i', sew).toString();
}

function vregPanel(ctx, snap, focus) {
    const cfg = ctx.sim.config;
    const vlen = cfg.vector.vlen;
    const L = cfg.vector.lanes;
    const curSew = snap.vtype?.sew ?? 32;
    const vl = snap.vl;
    const rows = ctx.vregs.map((i) => {
        const view = snap.view[i] ?? { sew: curSew, type: ctx.maskRegs.has(i) ? 'm' : (ctx.fpRegs.has(i) ? 'f' : 'i') };
        const bytes = snap.v[i];
        const written = new Set(snap.written[`v${i}`] ?? []);
        let cells;
        if (view.type === 'm') {
            const n = vlen / curSew;
            cells = Array.from({ length: n }, (_, e) => `<td class="${e >= vl ? 'tail' : ''} ${written.has(e) ? 'new' : ''}" style="--lane:${laneColor(e % L)}">${maskBit(bytes, e)}</td>`).join('');
        } else {
            const n = vlen / view.sew;
            cells = Array.from({ length: n }, (_, e) => `<td class="${e >= vl ? 'tail' : ''} ${written.has(e) ? 'new' : ''}" style="--lane:${laneColor(e % L)}">${esc(elemText(bytes, e, view.sew, view.type))}</td>`).join('');
        }
        const kind = view.type === 'm' ? t('ui.vec.mask') : `e${view.sew}${view.type === 'f' ? ' float' : ''}`;
        return `<tr class="${focus.has(`vreg:v${i}`) ? 'focus' : ''}"><th>v${i}<span class="abi">${esc(kind)}</span></th>${cells}</tr>`;
    }).join('');
    return `<section class="panel vregs ${[...focus].some((f) => f.startsWith('vreg:')) ? 'focus' : ''}" data-part="vregs">
        <h3>${t('ui.vec.vregs')} <span class="sub">${t('ui.vec.vregsSub', { vlen, lanes: L })}</span></h3>
        ${rows ? `<table class="vregs">${rows}</table>` : `<p class="dim">${t('ui.vec.noVregs')}</p>`}
        <p class="note">${t('ui.vec.vregsNote')}</p></section>`;
}

export function renderVector(el, ctx, snap) {
    const focus = new Set(snap.focus ?? []);
    const cfg = ctx.sim.config;
    el.dataset.model = ctx.sim.model;
    const vt = snap.vtype;
    const vlText = vt ? t('ui.vec.vlBox', { vl: snap.vl, sew: vt.sew, max: cfg.vector.vlen / vt.sew }) : t('ui.vec.noVtype');
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
            <div class="vec-row">
                <div class="vec-side">${issuePanel(ctx, snap, focus)}${scalarPanel(ctx, snap)}</div>
                <div class="vec-units">${snap.units.map((u, i) => unitPanel(ctx, snap, u, i, focus)).join('')}</div>
            </div>
            <div class="pipe-bottom">
                ${vregPanel(ctx, snap, focus)}${registersPanel(ctx, snap, focus)}${memoryPanel(ctx, snap, focus)}${statsPanel(ctx)}
            </div>
        </div>`;
}
