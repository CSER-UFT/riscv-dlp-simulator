/**
 * Diagrama da GPU: escalonador, unidades (ALU, FPU, LSU com a coalescência do último acesso), warps com a
 * máscara de threads ativas e a pilha SIMT, registradores de cada thread, memória e estatísticas.
 */
import * as fmt from '../riscv/format.js';
import * as regs from '../riscv/registers.js';
import { indexAt } from '../riscv/machine.js';
import { t } from '../i18n/index.js';
import { esc, COLORS, memoryPanel, statsPanel } from './panels.js';
import { words } from '../riscv/memory.js';
import { residentBlocks } from '../models/gpu.js';

const warpColor = (w) => COLORS[(w * 3 + 1) % COLORS.length];

function instAt(ctx, pc) {
    const i = indexAt(ctx.sim.program, pc);
    return i < 0 ? null : ctx.sim.program.instructions[i];
}

function schedPanel(ctx, snap, focus) {
    const cfg = ctx.sim.config.gpu;
    let body;
    if (snap.halted) body = `<p class="note warn">${esc(ctx.sim.warnings.join(' '))}</p>`;
    else if (snap.issued) {
        const d = ctx.sim.dyn[snap.issued.dyn];
        body = `<div class="pinst" style="--tag:${warpColor(snap.issued.warp)}"><code>${esc(d.text)}</code></div>
            <p class="note ok">${t('ui.gpu.issued', { w: d.text.split(':')[0], mask: d.mask })}</p>`;
    } else if (snap.warps.every((w) => w.done)) body = `<p class="dim">${t('ui.gpu.allDone')}</p>`;
    else body = `<p class="note warn">${t('ui.gpu.idle')}</p>`;
    return `<section class="panel issue ${focus.has('sched') ? 'focus' : ''}"><h3>${t('ui.gpu.sched')} <span class="sub">${esc(t(`ui.gpu.policy.${cfg.scheduler}`))}</span></h3>${body}</section>`;
}

function unitsPanel(ctx, snap, focus) {
    const c = snap.cycle;
    const items = snap.units.map((u) => {
        const ops = u.ops.map((op) => {
            const d = ctx.sim.dyn[op.dyn];
            const state = c < op.t0 + op.occ ? t('ui.gpu.occupied', { n: c - op.t0 + 1, total: op.occ }) : t('ui.vec.draining', { c: op.done });
            return `<li style="--tag:${warpColor(d.warp)}"><code class="tagged">${esc(d.text)}</code> <span class="sub">${esc(state)}</span></li>`;
        }).join('');
        return `<div class="gunit ${focus.has(`unit:${u.name}`) ? 'focus' : ''}"><b>${u.name}</b> <span class="sub">${esc(t(`ui.gpu.unit.${u.name}`))}</span>
            ${ops ? `<ul class="ops">${ops}</ul>` : `<p class="dim">${t('ui.vec.free')}</p>`}</div>`;
    }).join('');
    return `<section class="panel gunits"><h3>${t('ui.gpu.units')}</h3><p class="note">${t('ui.gpu.unitsSub', { lanes: ctx.sim.config.gpu.lanes, g: Math.ceil(ctx.sim.config.gpu.warpSize / ctx.sim.config.gpu.lanes) })}</p>${items}</section>`;
}

function memAccessPanel(ctx, snap, focus) {
    const m = snap.lastMem;
    if (!m) return `<section class="panel coalesce"><h3>${t('ui.gpu.coalesce')}</h3><p class="dim">${t('ui.gpu.noMem')}</p></section>`;
    const d = ctx.sim.dyn[m.dyn];
    if (m.kind === 'shared') {
        const cells = m.addrs.map((a, lane) => {
            if (a === null) return `<td class="off">·</td>`;
            return `<td style="--tag:${COLORS[m.banks[lane] % COLORS.length]}" title="${esc(fmt.address(a))}">${esc(fmt.address(a))}<span class="sub">${t('ui.gpu.bankN', { n: m.banks[lane] })}</span></td>`;
        }).join('');
        return `<section class="panel coalesce ${focus.has('lsu') ? 'focus' : ''}"><h3>${t('ui.gpu.banksTitle')} <span class="sub">${esc(d.text)}</span></h3>
            <table class="coal"><tr>${m.addrs.map((_, l) => `<th>${t('ui.gpu.laneN', { n: l })}</th>`).join('')}</tr><tr>${cells}</tr></table>
            <p class="note ${m.degree > 1 ? 'warn' : ''}">${t(m.degree > 1 ? 'ui.gpu.conflict' : 'ui.gpu.noConflict', { k: m.degree, banks: ctx.sim.config.gpu.smemBanks })}</p></section>`;
    }
    const lineBytes = BigInt(ctx.sim.config.gpu.lineBytes);
    const lineIndex = new Map(m.lines.map((l, i) => [l.toString(), i]));
    const cells = m.addrs.map((a, lane) => {
        if (a === null) return `<td class="off">·</td>`;
        const li = lineIndex.get(((a / lineBytes) * lineBytes).toString()) ?? 0;
        return `<td style="--tag:${COLORS[li % COLORS.length]}" title="${esc(fmt.address(a))}">${esc(fmt.address(a))}<span class="sub">${t('ui.gpu.lineN', { n: li })}</span></td>`;
    }).join('');
    return `<section class="panel coalesce ${focus.has('lsu') ? 'focus' : ''}"><h3>${t('ui.gpu.coalesce')} <span class="sub">${esc(d.text)}</span></h3>
        <table class="coal"><tr>${m.addrs.map((_, l) => `<th>${t('ui.gpu.laneN', { n: l })}</th>`).join('')}</tr><tr>${cells}</tr></table>
        <p class="note">${t('ui.gpu.txn', { k: m.k, lines: m.lines.map((l, i) => fmt.address(l) + (m.hits ? ` (${t(m.hits[i] ? 'ui.gpu.hit' : 'ui.gpu.miss')})` : '')).join(', '), b: ctx.sim.config.gpu.lineBytes })}</p></section>`;
}

function warpsPanel(ctx, snap, focus) {
    const rows = snap.warps.map((w) => {
        const inst = w.pc !== null && w.pc >= 0 ? instAt(ctx, w.pc) : null;
        const mask = w.mask.map((on) => `<td class="${on ? 'on' : 'off'}">${on ? '1' : '0'}</td>`).join('');
        const stack = w.stack.slice().reverse().map((e, k) => `<div class="${k === 0 ? 'stop' : ''}">${esc(fmt.address(e.pc))} · ${e.rpc === -1 ? t('ui.gpu.exitShort') : esc(fmt.address(e.rpc))} · <code>${e.mask}</code></div>`).join('');
        const state = t(`ui.gpu.state.${w.state}`, { reg: w.reg ? regs.abiName(w.reg) : '', unit: w.unit ?? '', c: w.until ?? '' });
        return `<tr class="${focus.has(`warp:${w.id}`) ? 'focus' : ''} ${w.done ? 'done' : ''}" style="--tag:${warpColor(w.id)}">
            <th class="wid">${esc(w.name)}</th><td class="winst">${inst && !w.done ? `<code>${esc(inst.text)}</code>` : '<span class="dim">·</span>'}</td>
            <td><table class="mask"><tr>${mask}</tr></table></td><td class="wstate ${w.state}">${esc(state)}</td><td class="wstack">${stack}</td></tr>`;
    }).join('');
    return `<section class="panel warps"><h3>${t('ui.gpu.warps')} <span class="sub">${t('ui.gpu.warpsSub')}</span></h3>
        <table class="warps"><tr><th></th><th>${t('ui.gpu.next')}</th><th>${t('ui.gpu.mask')}</th><th>${t('ui.gpu.status')}</th><th>${t('ui.gpu.stack')}</th></tr>${rows}</table>
        <p class="note">${t('ui.gpu.stackNote')}</p></section>`;
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

/** Blocos da grade: pendentes, no SM ou terminados. */
function blocksPanel(ctx, snap, focus) {
    const g = ctx.sim.config.gpu;
    const sh = ctx.sim.program.shared?.size ?? 0;
    const r = residentBlocks(g, sh);
    const byW = Math.floor(g.maxWarps / g.warps);
    const byS = sh > 0 ? Math.floor(g.smemBytes / sh) : null;
    const cells = snap.blocks.map((st, b) => `<span class="gblock ${st}" title="${esc(t(`ui.gpu.block.${st}`))}">b${b}</span>`).join('');
    const why = t('ui.gpu.residentWhy', { r, w: byW, mw: g.maxWarps, bw: g.warps }) + (byS !== null ? ' ' + t('ui.gpu.residentSmem', { s: byS, sh, smem: g.smemBytes }) : '');
    return `<section class="panel gblocks ${focus.has('blocks') ? 'focus' : ''}"><h3>${t('ui.gpu.blocks')} <span class="sub">${t('ui.gpu.blocksSub', { n: g.blocks, tpb: g.warps * g.warpSize })}</span></h3>
        <div class="gblock-row">${cells}</div><p class="note">${esc(why)}</p></section>`;
}

/**
 * Memória compartilhada de cada bloco residente, desenhada como os bancos: cada coluna é um banco e cada
 * linha, o próximo grupo de palavras (a palavra k fica no banco k mod bancos).
 */
function sharedPanel(ctx, snap, focus) {
    const sh = ctx.sim.program.shared;
    if (!sh || sh.size === 0) return '';
    const banks = ctx.sim.config.gpu.smemBanks;
    const labels = new Map(sh.labels.map((l) => [l.addr.toString(), l.name]));
    const resident = [...new Set(snap.warps.map((w) => w.block))];
    const nWords = Math.min(Math.ceil(sh.size / 4), 16 * banks);
    const nRows = Math.ceil(nWords / banks);
    const head = `<tr><th></th>${Array.from({ length: banks }, (_, b) => `<th>${t('ui.gpu.bankN', { n: b })}</th>`).join('')}</tr>`;
    const tables = resident.slice(0, 4).map((b) => {
        const map = snap.sm[b] ?? new Map();
        const byAddr = new Map(words(map, 4).map((w) => [w.addr.toString(), w.raw]));
        const rows = Array.from({ length: nRows }, (_, r) => {
            const cells = Array.from({ length: banks }, (_, c) => {
                const k = r * banks + c;
                if (k >= nWords) return '<td class="off"></td>';
                const addr = sh.base + BigInt(4 * k);
                const raw = byAddr.get(addr.toString());
                const label = labels.get(addr.toString());
                return `<td class="num ${label ? 'lab' : ''}" title="${esc(fmt.address(addr) + (label ? ` (${label})` : ''))}">${raw === undefined ? '<span class="dim">0</span>' : BigInt.asIntN(32, raw)}</td>`;
            }).join('');
            return `<tr><th class="num">${fmt.address(sh.base + BigInt(4 * r * banks))}</th>${cells}</tr>`;
        }).join('');
        return `<div><b>b${b}</b><table class="mem sbanks">${head}${rows}</table></div>`;
    }).join('');
    const lab = sh.labels.map((l) => `${l.name} = ${fmt.address(l.addr)}`).join(' · ');
    const more = Math.ceil(sh.size / 4) > nWords ? ' ' + t('ui.moreWords', { n: Math.ceil(sh.size / 4) - nWords }) : '';
    return `<section class="panel smem ${focus.has('smem') ? 'focus' : ''}"><h3>${t('ui.gpu.smem')} <span class="sub">${t('ui.gpu.smemSub', { size: sh.size, banks })}</span></h3>
        <div class="smem-row">${tables || `<p class="dim">${t('ui.gpu.noResident')}</p>`}</div><p class="note">${esc(lab)}${more}</p></section>`;
}

export function renderGpu(el, ctx, snap) {
    const focus = new Set(snap.focus ?? []);
    const cfg = ctx.sim.config.gpu;
    el.innerHTML = `
        <div class="vec-wrap">
            <div class="pipe-head">
                <span class="sub">${esc(t('ui.gpu.head', { w: cfg.warps, s: cfg.warpSize, n: cfg.warps * cfg.warpSize, lanes: cfg.lanes, lat: cfg.memLatency, b: cfg.lineBytes }))}${cfg.blocks > 1 ? esc(' · ' + t('ui.gpu.headBlocks', { n: cfg.blocks })) : ''}${cfg.l1 ? esc(' · ' + t('ui.gpu.headL1', { b: cfg.l1Bytes, w: cfg.l1Ways, lat: cfg.l1Latency })) : ''}</span>
            </div>
            <div class="vec-row">
                <div class="vec-side">${schedPanel(ctx, snap, focus)}${unitsPanel(ctx, snap, focus)}${cfg.blocks > 1 ? blocksPanel(ctx, snap, focus) : ''}</div>
                <div class="tpu-core">${warpsPanel(ctx, snap, focus)}${memAccessPanel(ctx, snap, focus)}${sharedPanel(ctx, snap, focus)}</div>
            </div>
            ${threadsPanel(ctx, snap, focus)}
            <div class="pipe-bottom">${memoryPanel(ctx, snap, focus)}${statsPanel(ctx)}</div>
        </div>`;
}
