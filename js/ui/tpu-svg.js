/**
 * Diagrama de blocos da TPU, no estilo do diagrama da TPU v1 (Jouppi et al., reproduzido pelo Hennessy e
 * Patterson): a emissão e a unidade escalar no alto, a memória externa, o Unified Buffer com a preparação
 * dos dados (as entradas defasadas de cada linha), a fila de pesos sobre o array sistólico (MXU), os
 * acumuladores embaixo do array e a unidade de ativação devolvendo os resultados ao Unified Buffer. As
 * unidades DMA, WDMA, MXU e ACT aparecem nas ligações que elas fazem, com o estado à direita.
 *
 * Reúne o que antes ficava nos painéis de emissão, da unidade escalar, das unidades, da fila de pesos, do
 * array, do Unified Buffer e dos acumuladores.
 */
import { t } from '../i18n/index.js';
import { esc, dynColor } from './panels.js';
import { systolicState, rowColor, num } from './diagram-tpu.js';
import { clip, tint, text, box, arrow } from './svg.js';

const CHAR = 6.8;
const L = 20;
const RIGHT = 380;

/** Seta horizontal (para a direita se x2 > x1). */
function harrow(x1, x2, y, cls = '') {
    const d = x2 > x1 ? -6 : 6;
    return `<path class="wire ${cls}" d="M${x1},${y} L${x2},${y}"/><path class="head ${cls}" d="M${x2 + d},${y - 4} L${x2},${y} L${x2 + d},${y + 4} Z"/>`;
}

/** Caminho com seta no fim (pontos [x, y]). */
function path(points, cls = '') {
    const [x1, y1] = points[points.length - 2], [x2, y2] = points[points.length - 1];
    const a = Math.atan2(y2 - y1, x2 - x1), s = 7, w = 4;
    const bx = x2 - s * Math.cos(a), by = y2 - s * Math.sin(a);
    const px = -Math.sin(a) * w, py = Math.cos(a) * w;
    return `<polyline class="wire ${cls}" points="${points.map((p) => p.join(',')).join(' ')}"/>`
        + `<path class="head ${cls}" d="M${x2},${y2} L${(bx + px).toFixed(1)},${(by + py).toFixed(1)} L${(bx - px).toFixed(1)},${(by - py).toFixed(1)} Z"/>`;
}

/** Tabela de linhas numeradas (Unified Buffer ou acumuladores). */
function bufferTable(out, x, y, title, sub, rows, data, written, cellW, focus) {
    const w = new Set(written ?? []);
    const cols = Math.max(1, ...rows.map((r) => data[r].length));
    const width = 40 + cols * cellW + 10;
    const h = 30 + Math.max(1, rows.length) * 20 + 6;
    out.push(`<g class="blk ${focus ? 'focus' : ''}">${box(x, y, width, h, 'unitbox')}`);
    out.push(text(x + 8, y + 17, title, 'title'));
    out.push(text(x + 14 + title.length * 8, y + 17, sub, 'tiny dim'));
    if (!rows.length) out.push(text(x + 10, y + 44, t('ui.tpu.unused'), 'small dim'));
    rows.forEach((r, i) => {
        const ry = y + 28 + i * 20;
        out.push(text(x + 30, ry + 14, String(r), 'mono small end dim'));
        data[r].forEach((v, k) => {
            const cx = x + 40 + k * cellW;
            out.push(box(cx, ry + 1, cellW - 2, 18, `cell ${w.has(r) ? 'new' : ''}`));
            out.push(text(cx + (cellW - 2) / 2, ry + 14, clip(num(v), Math.floor((cellW - 6) / CHAR)), 'mono center'));
        });
    });
    out.push('</g>');
    return { w: width, h };
}

export function tpuSvg(ctx, snap, focus) {
    const cfg = ctx.sim.config.tpu;
    const c = snap.cycle;
    const out = [];
    const { N, cells, outputs, inputs, weights } = systolicState(ctx, snap);
    const unit = (name) => snap.units.find((u) => u.name === name) ?? { name, ops: [] };
    const busy = (name) => unit(name).ops.length > 0;

    // Emissão e unidade escalar -------------------------------------------------------------------------------
    const is = snap.issue;
    const prog = ctx.sim.program.instructions;
    let issueLine = '', issueCls = 'dim', issueDyn = null;
    if (!is) issueLine = t('ui.vec.issueIdle');
    else if (is.kind === 'bubble') issueLine = t('ui.vec.bubble');
    else if (is.kind === 'halted') issueLine = t('ui.vec.halted');
    else if (is.kind === 'end') issueLine = t('ui.vec.end');
    else {
        issueDyn = is.dyn;
        const stalled = is.kind === 'stall';
        const key = is.reason === 'raw' ? 'ui.tpu.whyRaw' : `ui.vec.why.${is.reason}`;
        issueLine = stalled ? t(key, { reg: is.reg ?? '', unit: is.unit ?? '', t: is.until }) : t('ui.vec.issued');
        issueCls = stalled ? 'warn' : 'ok';
    }
    let ni = Math.max(0, (snap.pc - prog[0].pc) / 4);
    if (is && is.kind === 'stall') ni = ctx.sim.dyn[is.dyn].index + 1;
    const next = [];
    for (let k = 0; k < 3 && ni + k < prog.length && !snap.halted; k++) next.push(prog[ni + k].text);
    const topH = 74 + next.length * 14;
    out.push(`<g class="blk ${focus.has('issue') ? 'focus' : ''}">${box(L, 0, 330, topH, 'unitbox')}`);
    out.push(text(L + 10, 18, t('ui.vec.issue'), 'title'));
    if (issueDyn !== null) {
        const col = dynColor(issueDyn);
        out.push(box(L + 10, 26, 310, 20, 'inst', `style="fill:${tint(col, 22)};stroke:${col}${is.kind === 'stall' ? ';stroke-dasharray:4 3' : ''}"`));
        out.push(text(L + 16, 40, clip(ctx.sim.dyn[issueDyn].text, 44), 'mono'));
    }
    out.push(text(L + 10, 62, clip(issueLine, 54), `small ${issueCls}`));
    next.forEach((s, k) => out.push(text(L + 16, 80 + k * 14, clip(s, 44), 'mono small dim')));
    out.push('</g>');
    const scX = L + 346;
    const ops = snap.scalar ?? [];
    out.push(`<g class="blk">${box(scX, 0, 250, topH, 'unitbox')}`);
    out.push(text(scX + 10, 18, t('ui.vec.scalarUnit'), 'title'));
    out.push(text(scX + 10, 32, t('ui.vec.scalarSub'), 'small dim'));
    if (!ops.length) out.push(text(scX + 10, 52, t('ui.vec.free'), 'small dim'));
    ops.slice(0, 3).forEach((o, k) => {
        out.push(box(scX + 10, 42 + k * 18, 4, 14, '', `style="fill:${dynColor(o.dyn)};stroke:none"`));
        out.push(text(scX + 18, 53 + k * 18, `${clip(ctx.sim.dyn[o.dyn].text, 22)}  ${t('ui.vec.readyAt', { c: o.done })}`, 'mono small'));
    });
    out.push('</g>');

    // Memória externa ---------------------------------------------------------------------------------------
    const memX = scX + 266, memW = 230;
    out.push(`<g class="blk ${focus.has('dmem') ? 'focus' : ''}">${box(memX, 10, memW, 46, `membox ${busy('DMA') || busy('WDMA') ? 'on' : ''}`)}`);
    out.push(text(memX + memW / 2, 30, t('ui.tpu.svg.memory'), 'small center strong'));
    out.push(text(memX + memW / 2, 46, t('ui.tpu.svg.memorySub'), 'tiny center dim') + '</g>');

    // Unified Buffer -------------------------------------------------------------------------------------------
    const y0 = topH + 60;
    const ubRows = ctx.ubRows.filter((r) => r < cfg.ubRows);
    const accRows = ctx.accRows.filter((r) => r < cfg.accRows);
    const maxChars = Math.max(3, ...[...ubRows.flatMap((r) => snap.ub[r]), ...accRows.flatMap((r) => snap.acc[r])].map((v) => num(v).length));
    const cellW = Math.min(80, Math.ceil(maxChars * CHAR) + 10);
    const ub = bufferTable(out, L, y0, t('ui.tpu.ub'), t('ui.tpu.ubSub', { n: cfg.ubRows }), ubRows, snap.ub, snap.written.ub, cellW, focus.has('ub'));

    // Array sistólico com a fila de pesos em cima e as entradas defasadas à esquerda.
    const pe = Math.max(68, Math.ceil(Math.max(3, ...cells.flat().filter(Boolean).map((cl) => num(cl.psum).length + 2)) * CHAR) + 10);
    const setupW = 3 * 30 + 20;
    const ax = L + ub.w + 50 + setupW;
    const fifoY = y0;
    const fifoH = 30 + Math.max(1, snap.fifo.length) * 16;
    const arrayY = fifoY + fifoH + 40;
    const arrW = N * pe;
    out.push(`<g class="blk ${focus.has('fifo') ? 'focus' : ''}">${box(ax, fifoY, arrW, fifoH, 'unitbox')}`);
    out.push(text(ax + 8, fifoY + 17, t('ui.tpu.fifoTitle'), 'title'));
    out.push(text(ax + 14 + t('ui.tpu.fifoTitle').length * 8, fifoY + 17, t('ui.tpu.fifoSub', { n: cfg.fifoDepth }), 'tiny dim'));
    if (!snap.fifo.length) out.push(text(ax + 10, fifoY + 38, t('ui.tpu.fifoEmpty'), 'small dim'));
    snap.fifo.forEach((f, k) => out.push(text(ax + 10, fifoY + 38 + k * 16, `${t('ui.tpu.tile', { k: f.k })}: ${t(`ui.tpu.fifo.${f.state}`, { slot: f.slot })}`, 'small')));
    out.push('</g>');
    out.push(arrow(ax + arrW / 2, fifoY + fifoH, arrayY - 2, snap.fifo.some((f) => f.state === 'shifting') ? 'on' : ''));
    out.push(text(ax + arrW / 2 + 8, fifoY + fifoH + 22, snap.array ? t('ui.tpu.inArray', { k: snap.array.k }) : t('ui.tpu.noArray'), 'tiny dim'));
    // WDMA: memória para a fila de pesos.
    out.push(path([[memX + 40, 56], [memX + 40, fifoY - 20], [ax + arrW - 30, fifoY - 20], [ax + arrW - 30, fifoY]], busy('WDMA') ? 'on' : ''));
    out.push(text(memX + 46, fifoY - 26, 'WDMA', `tiny strong ${busy('WDMA') ? '' : 'dim'}`));
    // DMA: memória e Unified Buffer.
    out.push(path([[memX + 20, 56], [memX + 20, y0 - 34], [L + 60, y0 - 34], [L + 60, y0]], busy('DMA') ? 'on' : ''));
    out.push(text(L + 66, y0 - 40, 'DMA', `tiny strong ${busy('DMA') ? '' : 'dim'}`));

    const mxuOn = snap.mxu.length > 0;
    const mxuF = focus.has('unit:MXU');
    out.push(`<g class="blk ${mxuF ? 'focus' : ''}">${box(ax - 6, arrayY - 24, arrW + 12, N * pe + 30, `lane ${mxuOn ? 'on' : ''}`)}`);
    out.push(text(ax, arrayY - 9, `MXU · ${t('ui.tpu.arraySub', { n: N })}`, 'small strong') + '</g>');
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const cell = cells[i][j];
            const x = ax + j * pe, y = arrayY + i * pe;
            const w = cell ? cell.w : (weights ? weights[i][j] : null);
            if (cell) {
                const col = rowColor(cell.r);
                out.push(`<g><title>${esc(t('ui.tpu.peTitle', { r: cell.r, i, j }))}</title>${box(x + 2, y + 2, pe - 4, pe - 4, 'pe on', `style="fill:${tint(col, 24)};stroke:${col}"`)}`);
                out.push(text(x + 7, y + 15, `w ${num(w)}`, 'tiny dim'));
                out.push(text(x + 7, y + 31, `${num(cell.x)} →`, 'mono small'));
                out.push(text(x + 7, y + 47, `Σ ${num(cell.psum)} ↓`, 'mono small strong') + '</g>');
            } else {
                out.push(box(x + 2, y + 2, pe - 4, pe - 4, 'pe'));
                if (w !== null && w !== undefined) out.push(text(x + 7, y + 15, `w ${num(w)}`, 'tiny dim'));
            }
        }
        // Preparação dos dados: os próximos valores de cada linha, defasados.
        const q = inputs[i];
        q.slice().reverse().forEach((v, k) => {
            const qx = ax - 18 - (q.length - k) * 30;
            out.push(box(qx, arrayY + i * pe + pe / 2 - 10, 28, 20, 'cell', `style="fill:${tint(rowColor(v.r), 24)};stroke:${rowColor(v.r)}"`));
            out.push(text(qx + 14, arrayY + i * pe + pe / 2 + 4, clip(num(v.x), 4), 'mono tiny center'));
        });
        out.push(harrow(ax - 16, ax, arrayY + i * pe + pe / 2, q.length || cells[i].some(Boolean) ? 'on' : ''));
    }
    out.push(text(ax - 18 - setupW / 2, arrayY - 9, t('ui.tpu.svg.setup'), 'tiny center dim'));
    // Unified Buffer para a preparação dos dados.
    out.push(path([[L + ub.w, y0 + 40], [L + ub.w + 24, y0 + 40], [L + ub.w + 24, arrayY + pe / 2], [ax - 18 - setupW + 6, arrayY + pe / 2]], mxuOn ? 'on' : ''));

    // Saídas do array e acumuladores.
    const outY = arrayY + N * pe + 14;
    outputs.forEach((o, j) => {
        const x = ax + j * pe;
        if (!o) { out.push(arrow(x + pe / 2, outY - 8, outY + 22, '')); return; }
        out.push(arrow(x + pe / 2, outY - 8, outY + 22, 'on'));
        out.push(text(x + pe / 2 + 6, outY + 12, `${num(o.v)} → ${o.add ? '+' : ''}ACC[${o.acc}]`, 'mono tiny strong'));
    });
    const accY = outY + 26;
    const acc = bufferTable(out, ax, accY, t('ui.tpu.acc'), t('ui.tpu.accSub', { n: cfg.accRows }), accRows, snap.acc, snap.written.acc, cellW, focus.has('acc'));

    // Ativação: dos acumuladores de volta ao Unified Buffer.
    const actOn = busy('ACT');
    const actX = L + ub.w + 30, actY = accY + 10;
    const actW = Math.max(110, ax - actX - 30);
    out.push(`<g class="blk ${focus.has('unit:ACT') ? 'focus' : ''}">${box(actX, actY, actW, 40, `unitbox ${actOn ? 'on' : ''}`)}`);
    out.push(text(actX + actW / 2, actY + 17, t('ui.tpu.svg.act'), 'small center strong'));
    out.push(text(actX + actW / 2, actY + 31, 'ACT', 'tiny center dim') + '</g>');
    out.push(harrow(ax, actX + actW, actY + 20, actOn ? 'on' : ''));
    out.push(path([[actX, actY + 20], [L + ub.w / 2, actY + 20], [L + ub.w / 2, y0 + ub.h]], actOn ? 'on' : ''));

    // Estado das unidades, à direita.
    const rx = Math.max(ax + Math.max(arrW, acc.w) + 30, memX + memW + 20);
    let ry = y0;
    out.push(text(rx, ry, t('ui.tpu.svg.units'), 'small strong'));
    ry += 18;
    for (const u of snap.units) {
        out.push(text(rx, ry, `${u.name} · ${t(`ui.tpu.unit.${u.name}`)}`, `small ${u.ops.length ? 'strong' : 'dim'}`));
        ry += 15;
        if (!u.ops.length) { out.push(text(rx + 10, ry, t('ui.vec.free'), 'tiny dim')); ry += 18; continue; }
        for (const op of u.ops.slice(0, 3)) {
            const entering = c < op.t0 + op.G ? c - op.t0 : null;
            const state = entering !== null ? t('ui.tpu.entering', { r: entering, n: entering + 1, total: op.G }) : t('ui.vec.draining', { c: op.done });
            out.push(box(rx + 2, ry - 9, 4, 11, '', `style="fill:${dynColor(op.dyn)};stroke:none"`));
            out.push(text(rx + 10, ry, `${clip(ctx.sim.dyn[op.dyn].text, 24)}: ${clip(state, 36)}`, 'tiny'));
            ry += 14;
        }
        ry += 6;
    }

    const width = rx + RIGHT;
    const height = Math.max(accY + acc.h, actY + 50, ry) + 10;
    return `<svg class="vec-svg tpu-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(t('ui.tpu.svg.aria'))}">${out.join('')}</svg>`;
}
