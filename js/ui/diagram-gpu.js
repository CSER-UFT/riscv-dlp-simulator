/**
 * Diagrama da GPU: o desenho de blocos (gpu-svg.js) com o escalonador de warps, as lanes SIMD, a unidade de
 * load e store com a coalescência e as memórias, seguido dos registradores de cada thread, da memória global
 * e das estatísticas.
 */
import * as fmt from '../riscv/format.js';
import * as regs from '../riscv/registers.js';
import { indexAt } from '../riscv/machine.js';
import { t } from '../i18n/index.js';
import { esc, COLORS, memoryPanel, statsPanel } from './panels.js';
import { gpuSvg, residentNote } from './gpu-svg.js';

export const warpColor = (w) => COLORS[(w * 3 + 1) % COLORS.length];

export function instAt(ctx, pc) {
    const i = indexAt(ctx.sim.program, pc);
    return i < 0 ? null : ctx.sim.program.instructions[i];
}

/** Colunas mostradas na tabela de threads; acima disso, mostra só os primeiros warps residentes. */
const MAX_THREAD_COLUMNS = 128;

function threadsPanel(ctx, snap, focus) {
    const cfg = ctx.sim.config.gpu;
    const WS = cfg.warpSize;
    const regsUsed = ctx.registers.filter((r) => r !== 'x2' && r !== 'x0');
    // Só os warps residentes (dos blocos que estão no SM).
    const all = snap.warps.map((w) => w.id);
    const shown = all.slice(0, Math.max(1, Math.floor(MAX_THREAD_COLUMNS / WS)));
    const cols = shown.flatMap((w) => Array.from({ length: WS }, (_, lane) => [w, lane]));
    const head = cols.map(([w, lane]) => `<th style="--tag:${warpColor(w)}" class="${lane === 0 ? 'wstart' : ''}">${w * WS + lane}</th>`).join('');
    const rows = regsUsed.map((r) => {
        const i = regs.index(r);
        const cells = cols.map(([w, lane]) => {
            const th = snap.tw[w][lane];
            const v = r[0] === 'x' ? th.x[i] : th.f[i];
            const neu = (snap.written[w * WS + lane] ?? []).includes(r);
            return `<td class="${neu ? 'new' : ''} ${lane === 0 ? 'wstart' : ''}">${esc(fmt.value(v))}</td>`;
        }).join('');
        return `<tr><th>${r}<span class="abi">${regs.abiName(r)}</span></th>${cells}</tr>`;
    }).join('');
    const more = shown.length < all.length ? `<p class="note">${t('ui.gpu.moreThreads', { n: shown.length * WS, total: all.length * WS })}</p>` : '';
    const body = cols.length ? `<table class="tregs"><tr><th>${t('ui.gpu.tid')}</th>${head}</tr>${rows}</table>${more}` : `<p class="dim">${t('ui.gpu.noResident')}</p>`;
    return `<section class="panel threads ${focus.has('threads') ? 'focus' : ''}"><h3>${t('ui.gpu.threads')} <span class="sub">${t('ui.gpu.threadsSub')}</span></h3>${body}</section>`;
}

export function renderGpu(el, ctx, snap) {
    const focus = new Set(snap.focus ?? []);
    const cfg = ctx.sim.config.gpu;
    el.innerHTML = `
        <div class="vec-wrap">
            <div class="pipe-head">
                <span class="sub">${esc(t('ui.gpu.head', { w: cfg.warps, s: cfg.warpSize, n: cfg.warps * cfg.warpSize, lanes: cfg.lanes, lat: cfg.memLatency, b: cfg.lineBytes }))}${cfg.blocks > 1 ? esc(' · ' + t('ui.gpu.headBlocks', { n: cfg.blocks })) : ''}${cfg.l1 ? esc(' · ' + t('ui.gpu.headL1', { b: cfg.l1Bytes, w: cfg.l1Ways, lat: cfg.l1Latency })) : ''}</span>
            </div>
            <section class="panel vec-diagram">${gpuSvg(ctx, snap, focus)}
                <p class="note">${t('ui.gpu.svg.note')}${residentNote(ctx) ? ` ${esc(residentNote(ctx))}` : ''}</p></section>
            ${threadsPanel(ctx, snap, focus)}
            <div class="pipe-bottom">${memoryPanel(ctx, snap, focus)}${statsPanel(ctx)}</div>
        </div>`;
}
