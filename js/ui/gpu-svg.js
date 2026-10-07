/**
 * Diagrama de blocos da GPU, no estilo da figura do processador SIMD multithreaded do capítulo 6 do
 * Patterson e Hennessy: o escalonador de warps com o placar (um warp por linha), o registrador de instrução,
 * as lanes SIMD com os registradores das suas threads e as unidades ALU e FPU, a unidade de load e store
 * com a coalescência de endereços, a rede de interconexão e as memórias compartilhada (local) e global.
 *
 * O desenho é gerado a cada passo a partir do instantâneo; reúne o que antes ficava nos painéis do
 * escalonador, das unidades, dos warps, da coalescência, dos blocos e da memória compartilhada.
 */
import * as fmt from '../riscv/format.js';
import * as regs from '../riscv/registers.js';
import { t } from '../i18n/index.js';
import { esc, COLORS } from './panels.js';
import { words } from '../riscv/memory.js';
import { residentBlocks } from '../models/gpu.js';
import { clip, tint, text, box, arrow } from './svg.js';
import { warpColor, instAt } from './diagram-gpu.js';

const LEFT = 124; // coluna dos nomes
const RIGHT = 430; // coluna do estado das unidades
const GAP = 6; // espaço entre lanes
const CHAR = 6.8;

/** Lanes ativas de uma operação de ALU ou FPU no ciclo c: thread de cada lane, ou null (inativa ou livre). */
function laneThreads(op, d, c, lanes, ws) {
    const g = c - op.t0;
    if (g < 0 || g >= Math.ceil(ws / lanes)) return null;
    return Array.from({ length: lanes }, (_, l) => {
        const th = g * lanes + l;
        if (th >= ws) return null;
        return { th, on: d.mask[th] === '1' };
    });
}

function opState(op, c) {
    return c < op.t0 + op.occ ? t('ui.gpu.occupied', { n: c - op.t0 + 1, total: op.occ }) : t('ui.vec.draining', { c: op.done });
}

export function gpuSvg(ctx, snap, focus) {
    const g = ctx.sim.config.gpu;
    const L = g.lanes, WS = g.warpSize;
    const c = snap.cycle;
    const out = [];
    const laneW = 80;
    const lanesW = L * laneW + (L - 1) * GAP;
    const laneX = (l) => LEFT + l * (laneW + GAP);

    // Escalonador de warps com o placar.
    const warps = snap.warps;
    const issuedId = snap.issued ? snap.issued.warp : null;
    const maskW = Math.max(60, WS * 9 + 4);
    const cols = [
        ['', 34], [t('ui.gpu.svg.pc'), 64], [t('ui.gpu.next'), 200], [t('ui.gpu.mask'), maskW], [t('ui.gpu.status'), 200], [t('ui.gpu.stack'), 230],
    ];
    const tableW = cols.reduce((a, [, w]) => a + w, 0);
    const rowH = 18;
    const sched = { x: LEFT, y: 0 };
    const blocksH = g.blocks > 1 ? 30 : 0;
    const schedH = 44 + rowH * warps.length + blocksH + 8;
    const schedW = Math.max(tableW + 20, 420);
    out.push(`<g class="blk ${focus.has('sched') ? 'focus' : ''}">${box(sched.x, sched.y, schedW, schedH, 'unitbox')}`);
    out.push(text(sched.x + 10, 18, t('ui.gpu.sched'), 'title'));
    out.push(text(sched.x + 10 + t('ui.gpu.sched').length * 8 + 8, 18, t(`ui.gpu.policy.${g.scheduler}`), 'small dim'));
    let cx = sched.x + 10;
    for (const [h, w] of cols) { out.push(text(cx, 36, h, 'tiny dim')); cx += w; }
    warps.forEach((w, k) => {
        const y = 42 + k * rowH;
        const col = warpColor(w.id);
        const sel = w.id === issuedId;
        const wf = focus.has(`warp:${w.id}`);
        if (sel || wf) out.push(box(sched.x + 6, y, schedW - 12, rowH, `rowsel ${wf ? 'focus' : ''}`, `style="fill:${tint(col, 18)}"`));
        out.push(`<rect x="${sched.x + 8}" y="${y + 3}" width="4" height="${rowH - 6}" style="fill:${col};stroke:none"/>`);
        let x = sched.x + 16;
        out.push(text(x, y + 13, w.name, `mono strong ${w.done ? 'dim' : ''}`));
        x += cols[0][1] - 6;
        out.push(text(x, y + 13, w.pc !== null && w.pc >= 0 && !w.done ? fmt.address(w.pc) : '·', 'mono small dim'));
        x += cols[1][1];
        const inst = w.pc !== null && w.pc >= 0 && !w.done ? instAt(ctx, w.pc) : null;
        out.push(text(x, y + 13, inst ? clip(inst.text, 28) : '·', `mono small ${inst ? '' : 'dim'}`));
        x += cols[2][1];
        w.mask.forEach((on, i) => out.push(`<rect x="${x + i * 9}" y="${y + 4}" width="7" height="10" rx="1" class="mbit ${on ? 'on' : ''}" ${on ? `style="fill:${col};stroke:${col}"` : ''}/>`));
        x += cols[3][1];
        const state = t(`ui.gpu.state.${w.state}`, { reg: w.reg ? regs.abiName(w.reg) : '', unit: w.unit ?? '', c: w.until ?? '' });
        out.push(text(x, y + 13, clip(state, 30), `small ${w.state === 'issued' ? 'ok' : w.done ? 'dim' : ''}`));
        x += cols[4][1];
        const top = w.stack[w.stack.length - 1];
        if (top) {
            const extra = w.stack.length > 1 ? `  (+${w.stack.length - 1})` : '';
            const rpc = top.rpc === -1 ? t('ui.gpu.exitShort') : fmt.address(top.rpc);
            out.push(`<g><title>${esc(w.stack.slice().reverse().map((e) => `${fmt.address(e.pc)} · ${e.rpc === -1 ? t('ui.gpu.exitShort') : fmt.address(e.rpc)} · ${e.mask}`).join('\n'))}</title>`
                + text(x, y + 13, `${fmt.address(top.pc)} · ${rpc}${extra}`, 'mono small') + '</g>');
        }
    });
    if (g.blocks > 1) {
        const by = 42 + rowH * warps.length + 6;
        out.push(text(sched.x + 10, by + 14, t('ui.gpu.blocks'), 'small strong'));
        snap.blocks.forEach((st, b) => {
            const bx = sched.x + 80 + b * 34;
            out.push(`<g><title>${esc(t(`ui.gpu.block.${st}`))}</title>${box(bx, by + 2, 30, 18, `gblk ${st}`)}${text(bx + 15, by + 15, `b${b}`, 'tiny center')}</g>`);
        });
    }
    out.push('</g>');

    // Registrador de instrução e barramento até as lanes.
    const irY = schedH + 18;
    const irW = 380, irH = 46;
    out.push(arrow(LEFT + 60, schedH, irY, issuedId !== null ? 'on' : ''));
    out.push(`<g class="blk">${box(LEFT, irY, irW, irH, 'unitbox')}`);
    out.push(text(LEFT + 10, irY + 16, t('ui.gpu.svg.ir'), 'small strong'));
    if (snap.issued) {
        const d = ctx.sim.dyn[snap.issued.dyn];
        const col = warpColor(snap.issued.warp);
        out.push(box(LEFT + 10, irY + 22, irW - 20, 18, 'inst', `style="fill:${tint(col, 22)};stroke:${col}"`));
        out.push(text(LEFT + 16, irY + 35, `${clip(d.text, 36)}   ${t('ui.gpu.svg.maskIs', { mask: d.mask })}`, 'mono small'));
    } else {
        const msg = snap.halted ? ctx.sim.warnings.join(' ') : warps.every((w) => w.done) ? t('ui.gpu.allDone') : t('ui.gpu.idle');
        out.push(text(LEFT + 10, irY + 35, clip(msg, 60), `small ${snap.halted || !warps.every((w) => w.done) ? 'warn' : 'dim'}`));
    }
    out.push('</g>');
    const busY = irY + irH + 18;
    const busOn = Boolean(snap.issued);
    out.push(arrow(LEFT + irW / 2, irY + irH, busY, busOn ? 'on' : ''));
    out.push(`<path class="wire bus ${busOn ? 'on' : ''}" d="M${LEFT},${busY} L${LEFT + lanesW},${busY}"/>`);
    out.push(text(LEFT + lanesW + 8, busY + 4, t('ui.gpu.svg.bus'), 'small dim'));

    // Lanes SIMD: registradores das threads e as unidades ALU e FPU.
    const laneTop = busY + 16;
    const regY = laneTop + 22, regH = 34;
    const unitNames = ['ALU', 'FPU'];
    const unitY = (k) => regY + regH + 22 + k * 40;
    const laneBottom = unitY(unitNames.length) - 6;
    const groups = Math.ceil(WS / L);
    const issuedD = snap.issued ? ctx.sim.dyn[snap.issued.dyn] : null;
    for (let l = 0; l < L; l++) {
        const x0 = laneX(l);
        out.push(arrow(x0 + laneW / 2, busY, laneTop, busOn ? 'on' : ''));
        out.push(box(x0, laneTop, laneW, laneBottom - laneTop, 'lane'));
        out.push(text(x0 + laneW / 2, laneTop + 15, `${t('ui.vec.lane')} ${l}`, 'small center strong'));
        // Registradores: as threads que esta lane executa (l, l + lanes, ...).
        const ths = Array.from({ length: groups }, (_, k) => k * L + l).filter((x) => x < WS);
        out.push(`<g><title>${esc(t('ui.gpu.svg.regsTitle', { list: ths.map((x) => `t${x}`).join(', ') }))}</title>${box(x0 + 5, regY, laneW - 10, regH, 'regs')}`);
        out.push(text(x0 + laneW / 2, regY + 14, t('ui.gpu.svg.regs'), 'tiny center strong'));
        out.push(text(x0 + laneW / 2, regY + 27, clip(ths.map((x) => `t${x}`).join(' '), 11), 'tiny center dim') + '</g>');
        out.push(arrow(x0 + laneW * 0.35, regY + regH, regY + regH + 16, issuedD ? 'on' : ''));
        out.push(arrow(x0 + laneW * 0.65, regY + regH + 16, regY + regH, issuedD ? 'on' : ''));
    }
    out.push(text(8, regY + 14, t('ui.gpu.svg.regsLeft'), 'small strong'));
    out.push(text(8, regY + 27, clip(t('ui.gpu.svg.regsLeftSub', { n: groups }), 20), 'tiny dim'));

    const rx = LEFT + lanesW + 14;
    unitNames.forEach((name, k) => {
        const u = snap.units.find((x) => x.name === name);
        const y = unitY(k);
        const uf = focus.has(`unit:${name}`);
        out.push(`<g class="unit ${u.ops.length ? 'busy' : ''} ${uf ? 'focus' : ''}">`);
        out.push(text(8, y + 14, name, 'title'));
        out.push(`<g><title>${esc(t(`ui.gpu.unit.${name}`))}</title>${text(8, y + 27, clip(t(`ui.gpu.unit.${name}`), 20), 'tiny dim')}</g>`);
        // Ocupação das lanes neste ciclo: a operação no seu grupo de threads (no máximo uma por unidade).
        let occ = null, occD = null;
        for (const op of u.ops) {
            const d = ctx.sim.dyn[op.dyn];
            const lt = laneThreads(op, d, c, L, WS);
            if (lt) { occ = lt; occD = d; }
        }
        for (let l = 0; l < L; l++) {
            const x0 = laneX(l) + 5;
            const cell = occ?.[l];
            const col = occD ? warpColor(occD.warp) : null;
            if (cell && cell.on) {
                out.push(box(x0, y, laneW - 10, 28, `alu on ${uf ? 'focus' : ''}`, `style="fill:${tint(col, 30)};stroke:${col}"`));
                out.push(text(x0 + (laneW - 10) / 2, y + 18, `t${cell.th}`, 'small center strong'));
            } else if (cell) {
                out.push(`<g><title>${esc(t('ui.gpu.svg.inactive', { th: cell.th }))}</title>${box(x0, y, laneW - 10, 28, 'alu off')}${text(x0 + (laneW - 10) / 2, y + 18, `t${cell.th} ×`, 'small center dim')}</g>`);
            } else {
                out.push(box(x0, y, laneW - 10, 28, `alu ${uf ? 'focus' : ''}`));
                out.push(text(x0 + (laneW - 10) / 2, y + 18, name, 'tiny center dim'));
            }
        }
        if (!u.ops.length) out.push(text(rx, y + 16, t('ui.vec.free'), 'small dim'));
        u.ops.slice(0, 3).forEach((op, j) => {
            const d = ctx.sim.dyn[op.dyn];
            out.push(box(rx, y + 2 + j * 13, 4, 10, '', `style="fill:${warpColor(d.warp)};stroke:none"`));
            out.push(text(rx + 8, y + 11 + j * 13, `${clip(d.text, 26)}: ${clip(opState(op, c), 42)}`, 'small'));
        });
        if (u.ops.length > 3) out.push(text(rx + 8, y + 11 + 3 * 13, t('ui.gpu.svg.moreOps', { n: u.ops.length - 3 }), 'tiny dim'));
        out.push('</g>');
    });

    // Unidade de load e store.
    const lsu = snap.units.find((x) => x.name === 'LSU');
    const lsuY = laneBottom + 22;
    const lsuH = 30;
    const lsuOn = lsu.ops.length > 0;
    const lsuF = focus.has('unit:LSU') || focus.has('lsu');
    for (let l = 0; l < L; l++) out.push(arrow(laneX(l) + laneW / 2, laneBottom, lsuY, lsuOn ? 'on' : ''));
    out.push(`<g class="unit ${lsuOn ? 'busy' : ''}">${box(LEFT, lsuY, lanesW, lsuH, `lsubox ${lsuOn ? 'on' : ''} ${lsuF ? 'focus' : ''}`)}`);
    out.push(text(LEFT + lanesW / 2, lsuY + 19, t('ui.gpu.svg.lsu'), 'small center strong'));
    out.push(text(8, lsuY + 14, 'LSU', 'title'));
    out.push(text(8, lsuY + 27, clip(t('ui.gpu.unit.LSU'), 20), 'tiny dim'));
    if (!lsu.ops.length) out.push(text(rx, lsuY + 16, t('ui.vec.free'), 'small dim'));
    lsu.ops.slice(0, 4).forEach((op, j) => {
        const d = ctx.sim.dyn[op.dyn];
        out.push(box(rx, lsuY + 2 + j * 13, 4, 10, '', `style="fill:${warpColor(d.warp)};stroke:none"`));
        out.push(text(rx + 8, lsuY + 11 + j * 13, `${clip(d.text, 26)}: ${clip(opState(op, c), 42)}`, 'small'));
    });
    if (lsu.ops.length > 4) out.push(text(rx + 8, lsuY + 11 + 4 * 13, t('ui.gpu.svg.moreOps', { n: lsu.ops.length - 4 }), 'tiny dim'));
    out.push('</g>');

    // Coalescência (ou bancos da memória compartilhada) do último acesso: uma célula por thread, alinhada
    // sob a lane que a executa.
    const coY = lsuY + lsuH + 18;
    const m = snap.lastMem;
    const coRows = m ? Math.ceil(m.addrs.length / L) : 0;
    const coH = 24 + Math.max(1, coRows) * 30 + 22;
    out.push(arrow(LEFT + lanesW / 2, lsuY + lsuH, coY, lsuOn ? 'on' : ''));
    out.push(`<g class="blk ${focus.has('lsu') ? 'focus' : ''}">${box(LEFT, coY, lanesW, coH, 'unitbox')}`);
    out.push(text(8, coY + 14, t('ui.gpu.svg.coalesceLeft'), 'small strong'));
    if (!m) {
        out.push(text(LEFT + 10, coY + 16, t('ui.gpu.coalesce'), 'small strong'));
        out.push(text(LEFT + 10, coY + 38, t('ui.gpu.noMem'), 'small dim'));
    } else {
        const d = ctx.sim.dyn[m.dyn];
        const shared = m.kind === 'shared';
        out.push(text(LEFT + 10, coY + 16, `${t(shared ? 'ui.gpu.banksTitle' : 'ui.gpu.coalesce')}: ${clip(d.text, 34)}`, 'small strong'));
        const lineBytes = BigInt(g.lineBytes);
        const lineIndex = shared ? null : new Map(m.lines.map((ln, i) => [ln.toString(), i]));
        m.addrs.forEach((a, th) => {
            const l = th % L, r = Math.floor(th / L);
            const x0 = laneX(l) + 3, y0 = coY + 24 + r * 30;
            if (a === null) {
                out.push(box(x0, y0, laneW - 6, 26, 'cell tail'));
                out.push(text(x0 + (laneW - 6) / 2, y0 + 16, `t${th} ·`, 'tiny center dim'));
                return;
            }
            const k = shared ? m.banks[th] : (lineIndex.get(((a / lineBytes) * lineBytes).toString()) ?? 0);
            const col = COLORS[k % COLORS.length];
            out.push(`<g><title>${esc(`t${th}: ${fmt.address(a)}`)}</title>${box(x0, y0, laneW - 6, 26, 'cell', `style="fill:${tint(col, 22)};stroke:${col}"`)}`);
            out.push(text(x0 + (laneW - 6) / 2, y0 + 11, clip(fmt.address(a), 10), 'mono tiny center'));
            out.push(text(x0 + (laneW - 6) / 2, y0 + 22, shared ? t('ui.gpu.bankN', { n: k }) : t('ui.gpu.lineN', { n: k }), 'idx center dim') + '</g>');
        });
        const summary = shared
            ? t(m.degree > 1 ? 'ui.gpu.conflict' : 'ui.gpu.noConflict', { k: m.degree, banks: g.smemBanks })
            : t('ui.gpu.txn', { k: m.k, lines: m.lines.map((ln, i) => fmt.address(ln) + (m.hits ? ` (${t(m.hits[i] ? 'ui.gpu.hit' : 'ui.gpu.miss')})` : '')).join(', '), b: g.lineBytes });
        out.push(text(LEFT + 10, coY + coH - 8, clip(summary.replace(/\*\*|`/g, ''), Math.floor((lanesW + RIGHT - 30) / 6.2)), `small ${shared && m.degree > 1 ? 'warn' : ''}`));
    }
    out.push('</g>');

    // Rede de interconexão e memórias.
    const netY = coY + coH + 16;
    out.push(arrow(LEFT + lanesW / 2, coY + coH, netY, lsuOn ? 'on' : ''));
    out.push(box(LEFT, netY, lanesW, 22, 'netbox'));
    out.push(text(LEFT + lanesW / 2, netY + 15, t('ui.gpu.svg.net'), 'small center strong'));
    const memY = netY + 40;
    const sh = ctx.sim.program.shared;
    const hasShared = sh && sh.size > 0;
    let sharedW = 0, sharedH = 0;
    if (hasShared) {
        const r = drawShared(ctx, snap, focus, LEFT, memY, out);
        sharedW = r.w; sharedH = r.h;
        out.push(arrow(LEFT + sharedW / 2, netY + 22, memY, ''));
    }
    const gx = LEFT + (hasShared ? sharedW + 16 : 0);
    const gw = Math.max(260, lanesW - (hasShared ? sharedW + 16 : 0));
    const gh = 58;
    out.push(arrow(gx + gw / 2, netY + 22, memY, lsuOn ? 'on' : ''));
    out.push(`<g class="blk">${box(gx, memY, gw, gh, 'membox')}`);
    out.push(text(gx + 10, memY + 18, t('ui.gpu.svg.global'), 'small strong'));
    out.push(text(gx + 10, memY + 34, t('ui.gpu.svg.globalInfo', { lat: g.memLatency, b: g.lineBytes }), 'tiny'));
    if (g.l1) out.push(text(gx + 10, memY + 48, t('ui.gpu.headL1', { b: g.l1Bytes, w: g.l1Ways, lat: g.l1Latency }), 'tiny'));
    out.push('</g>');

    const width = Math.max(LEFT + lanesW + RIGHT, LEFT + schedW + 20, gx + gw + 20);
    const height = memY + Math.max(gh, sharedH) + 10;
    return `<svg class="vec-svg gpu-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(t('ui.gpu.svg.aria'))}">${out.join('')}</svg>`;
}

/**
 * Memória compartilhada (local) de cada bloco residente, desenhada como os bancos: cada coluna é um banco e
 * cada linha, o próximo grupo de palavras (a palavra k fica no banco k mod bancos).
 */
function drawShared(ctx, snap, focus, x, y, out) {
    const sh = ctx.sim.program.shared;
    const g = ctx.sim.config.gpu;
    const banks = g.smemBanks;
    const labels = new Map(sh.labels.map((l) => [l.addr.toString(), l.name]));
    const resident = [...new Set(snap.warps.map((w) => w.block))].slice(0, 2);
    const nWords = Math.min(Math.ceil(sh.size / 4), 8 * banks);
    const nRows = Math.ceil(nWords / banks);
    const cw = 46, ch = 18;
    const tw = banks * cw;
    const w = Math.max(220, 20 + resident.length * (tw + 14));
    const h = 40 + 14 + nRows * ch + 18;
    out.push(`<g class="blk ${focus.has('smem') ? 'focus' : ''}">${box(x, y, w, h, 'membox shared')}`);
    out.push(text(x + 10, y + 18, t('ui.gpu.svg.shared', { size: sh.size, banks }), 'small strong'));
    resident.forEach((b, k) => {
        const bx = x + 10 + k * (tw + 14);
        const by = y + 30;
        out.push(text(bx, by + 8, `b${b}`, 'tiny strong'));
        for (let c = 0; c < banks; c++) out.push(text(bx + c * cw + cw / 2, by + 20, t('ui.gpu.bankN', { n: c }), 'idx center dim'));
        const map = snap.sm[b] ?? new Map();
        const byAddr = new Map(words(map, 4).map((wd) => [wd.addr.toString(), wd.raw]));
        for (let r = 0; r < nRows; r++) {
            for (let c = 0; c < banks; c++) {
                const kk = r * banks + c;
                if (kk >= nWords) continue;
                const addr = sh.base + BigInt(4 * kk);
                const raw = byAddr.get(addr.toString());
                const label = labels.get(addr.toString());
                const cx = bx + c * cw, cy = by + 24 + r * ch;
                out.push(`<g><title>${esc(fmt.address(addr) + (label ? ` (${label})` : ''))}</title>${box(cx, cy, cw - 2, ch - 2, `cell ${label ? 'lab' : ''}`)}`);
                out.push(text(cx + (cw - 2) / 2, cy + 12, raw === undefined ? '0' : clip(String(BigInt.asIntN(32, raw)), 6), `mono tiny center ${raw === undefined ? 'dim' : ''}`) + '</g>');
            }
        }
    });
    const more = Math.ceil(sh.size / 4) > nWords ? t('ui.moreWords', { n: Math.ceil(sh.size / 4) - nWords }) : '';
    out.push(text(x + 10, y + h - 6, clip(`${sh.labels.map((l) => `${l.name} = ${fmt.address(l.addr)}`).join(' · ')} ${more}`, Math.floor((w - 20) / 6)), 'tiny dim'));
    out.push('</g>');
    return { w, h };
}

/** Ocupação do SM: quantos blocos cabem e por quê (para a nota abaixo do desenho). */
export function residentNote(ctx) {
    const g = ctx.sim.config.gpu;
    if (g.blocks <= 1) return '';
    const sh = ctx.sim.program.shared?.size ?? 0;
    const r = residentBlocks(g, sh);
    const byW = Math.floor(g.maxWarps / g.warps);
    const byS = sh > 0 ? Math.floor(g.smemBytes / sh) : null;
    return t('ui.gpu.residentWhy', { r, w: byW, mw: g.maxWarps, bw: g.warps }) + (byS !== null ? ' ' + t('ui.gpu.residentSmem', { s: byS, sh, smem: g.smemBytes }) : '');
}
