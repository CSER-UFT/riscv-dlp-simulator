/**
 * Diagrama de blocos do processador vetorial, no estilo das figuras do capítulo 6 do Patterson e Hennessy:
 * a emissão e a unidade escalar no alto, um barramento que leva a instrução vetorial a todas as lanes e,
 * em cada lane, a fatia do banco de registradores vetoriais (os elementos i com i mod lanes = lane) e o
 * trecho de cada unidade funcional, com os elementos avançando pelos estágios. As unidades de load e store
 * ficam na base das lanes, ligadas à memória.
 *
 * O desenho é gerado a cada passo a partir do instantâneo; os valores são os mesmos das tabelas usadas na
 * exportação (laneGrid e vregRows).
 */
import { t } from '../i18n/index.js';
import { className } from '../core/config.js';
import { esc, dynColor, laneColor } from './panels.js';
import { laneGrid, vregRows } from './diagram-vector.js';

const MAX_CELLS = 8; // elementos por lane em cada registrador
const LEFT = 104; // coluna dos nomes
const RIGHT = 410; // coluna do estado das unidades
const GAP = 10; // espaço entre lanes
const CHAR = 6.8; // largura média de um caractere de 11 px na fonte monoespaçada

const MEM_CLASSES = new Set(['vload', 'vstore']);

/** Texto com limite de caracteres (o restante vira reticências). */
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const tint = (color, pct) => `color-mix(in srgb, ${color} ${pct}%, var(--panel))`;

function text(x, y, s, cls = '', extra = '') {
    return `<text x="${x}" y="${y}" class="${cls}" ${extra}>${esc(s)}</text>`;
}

function box(x, y, w, h, cls = '', extra = '') {
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" class="${cls}" ${extra}/>`;
}

/** Seta vertical (para baixo se y2 > y1). */
function arrow(x, y1, y2, cls = '') {
    const d = y2 > y1 ? -5 : 5;
    return `<path class="wire ${cls}" d="M${x},${y1} L${x},${y2}"/><path class="head ${cls}" d="M${x - 4},${y2 + d} L${x},${y2} L${x + 4},${y2 + d} Z"/>`;
}

/** Estado de uma operação numa unidade, como no painel antigo. */
function opState(op, c, entering) {
    const entered = Math.min(op.slots, Math.max(0, (c - op.t0 + 1)) * op.rate);
    const lastWrite = op.t0 + op.G - 1 + op.S - 1;
    if (op.slots === 0) return t('ui.vec.noElems');
    if (entering) return t('ui.vec.entering', { list: `${entering[0]}..${entering[entering.length - 1]}`, n: entered, total: op.slots });
    if (op.end && c > lastWrite) return t('ui.vec.reducing', { c: op.done });
    return t('ui.vec.draining', { c: op.done });
}

export function vectorSvg(ctx, snap, focus) {
    const cfg = ctx.sim.config;
    const L = cfg.vector.lanes;
    const shown = L; // a configuração limita a 8 lanes
    const c = snap.cycle;
    const out = [];

    // Registradores: as células de cada linha agrupadas por lane.
    const rows = vregRows(ctx, snap).map((row) => {
        const byLane = Array.from({ length: shown }, () => []);
        for (const cl of row.cells) if (cl.lane < shown) byLane[cl.lane].push(cl);
        return { ...row, byLane };
    });
    const perLane = Math.min(MAX_CELLS, Math.max(1, ...rows.flatMap((r) => r.byLane.map((l) => l.length))));
    // Com LMUL > 1 ou visões diferentes, as linhas guardam elementos diferentes: o índice vai em cada célula.
    const key = (r) => r.byLane.map((l) => l.map((cl) => cl.e).join(',')).join('|');
    const sameIdx = rows.every((r) => key(r) === key(rows[0]));
    const maxIdx = Math.max(1, ...rows.flatMap((r) => r.cells.map((cl) => String(cl.e).length)));
    const idxW = sameIdx ? 0 : maxIdx * 5.6 + 4;
    const maxChars = Math.max(3, ...rows.flatMap((r) => r.cells.map((cl) => cl.text.length)));
    const cellW = Math.min(90, Math.max(30, Math.ceil(maxChars * CHAR) + 8 + idxW));

    // Unidades: aritméticas no meio da lane, as de memória na base.
    const units = snap.units.map((u, i) => {
        const uc = cfg.vector.units[i];
        const g = laneGrid(ctx, snap, i);
        return { u, i, uc, ...g, mem: uc.classes.some((k) => MEM_CLASSES.has(k)) };
    });
    const order = [...units.filter((x) => !x.mem), ...units.filter((x) => x.mem)];
    const maxDepth = Math.max(1, ...units.map((x) => x.depth));
    const laneW = Math.max(perLane * cellW + 12, Math.min(maxDepth, 12) * 14 + 12, 96);
    const lanesW = shown * laneW + (shown - 1) * GAP;
    const laneX = (l) => LEFT + l * (laneW + GAP);

    // Alto: emissão e unidade escalar.
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
        const key = `ui.vec.why.${is.reason}`;
        issueLine = stalled ? t(key, { reg: is.reg ?? '', unit: is.unit ?? '', t: is.until }) : t('ui.vec.issued');
        issueCls = stalled ? 'warn' : 'ok';
    }
    let ni = Math.max(0, (snap.pc - prog[0].pc) / 4);
    if (is && is.kind === 'stall') ni = ctx.sim.dyn[is.dyn].index + 1;
    const next = [];
    for (let k = 0; k < 3 && ni + k < prog.length && !snap.halted; k++) next.push(prog[ni + k].text);

    const issueW = 330, scalarW = 250;
    const topH = 74 + next.length * 14;
    const top = 0;
    const issueX = LEFT;
    out.push(`<g class="blk ${focus.has('issue') ? 'focus' : ''}">${box(issueX, top, issueW, topH, 'unitbox')}`);
    out.push(text(issueX + 10, top + 18, t('ui.vec.issue'), 'title'));
    if (issueDyn !== null) {
        const col = dynColor(issueDyn);
        out.push(box(issueX + 10, top + 26, issueW - 20, 20, 'inst', `style="fill:${tint(col, 22)};stroke:${col}${is.kind === 'stall' ? ';stroke-dasharray:4 3' : ''}"`));
        out.push(text(issueX + 16, top + 40, clip(ctx.sim.dyn[issueDyn].text, 46), 'mono'));
    }
    out.push(text(issueX + 10, top + 62, clip(issueLine, 56), `small ${issueCls}`));
    next.forEach((s, k) => out.push(text(issueX + 16, top + 80 + k * 14, clip(s, 46), 'mono small dim')));
    out.push('</g>');

    const scX = issueX + issueW + 16;
    const ops = snap.scalar ?? [];
    out.push(`<g class="blk">${box(scX, top, scalarW, topH, 'unitbox')}`);
    out.push(text(scX + 10, top + 18, t('ui.vec.scalarUnit'), 'title'));
    out.push(text(scX + 10, top + 32, t('ui.vec.scalarSub'), 'small dim'));
    if (!ops.length) out.push(text(scX + 10, top + 52, t('ui.vec.free'), 'small dim'));
    ops.slice(0, 3).forEach((o, k) => {
        const col = dynColor(o.dyn);
        out.push(box(scX + 10, top + 42 + k * 18, 4, 14, '', `style="fill:${col};stroke:none"`));
        out.push(text(scX + 18, top + 53 + k * 18, `${clip(ctx.sim.dyn[o.dyn].text, 22)}  ${t('ui.vec.readyAt', { c: o.done })}`, 'mono small'));
    });
    out.push('</g>');

    // Barramento da instrução vetorial até as lanes.
    const busY = topH + 22;
    const busOn = issueDyn !== null && is.kind !== 'stall' && ctx.sim.dyn[issueDyn].vector;
    out.push(arrow(issueX + issueW / 2, topH, busY, busOn ? 'on' : ''));
    out.push(`<path class="wire bus ${busOn ? 'on' : ''}" d="M${LEFT},${busY} L${LEFT + lanesW},${busY}"/>`);
    out.push(text(LEFT + lanesW + 8, busY + 4, t('ui.vec.svg.bus'), 'small dim'));

    // Lanes.
    const laneTop = busY + 16;
    const headH = 22, idxH = 16, rowH = 24;
    const regTop = laneTop + headH;
    const regH = idxH + rows.length * rowH + 6;
    const unitH = (x) => Math.max(34, 12 + x.u.ops.length * 14);
    let y = regTop + regH + 22;
    const unitY = new Map();
    for (const x of order) {
        if (x.mem && !unitY.size) y += 0;
        unitY.set(x.i, y);
        y += unitH(x) + 10;
    }
    const laneBottom = y - 4;
    for (let l = 0; l < shown; l++) {
        const x0 = laneX(l);
        out.push(arrow(x0 + laneW / 2, busY, laneTop, busOn ? 'on' : ''));
        out.push(box(x0, laneTop, laneW, laneBottom - laneTop, 'lane'));
        out.push(`<rect x="${x0}" y="${laneTop}" width="${laneW}" height="4" rx="2" style="fill:${laneColor(l)}"/>`);
        out.push(text(x0 + laneW / 2, laneTop + 16, `${t('ui.vec.lane')} ${l}`, 'small center strong'));
    }

    // Banco de registradores vetoriais repartido entre as lanes.
    out.push(text(8, laneTop + 14, t('ui.vec.svg.regfile'), 'small strong'));
    out.push(text(8, laneTop + 27, t('ui.vec.svg.regfileSub', { vlen: cfg.vector.vlen }), 'tiny dim'));
    if (rows.length && sameIdx) {
        for (let l = 0; l < shown; l++) {
            const first = rows[0].byLane[l].slice(0, perLane);
            first.forEach((cl, k) => out.push(text(laneX(l) + 6 + k * cellW + cellW / 2, regTop + 10, `${cl.e}`, 'tiny center dim')));
        }
    } else if (!rows.length) {
        out.push(text(LEFT + 6, regTop + 26, t('ui.vec.noVregs'), 'small dim'));
    }
    rows.forEach((row, r) => {
        const ry = regTop + idxH + r * rowH;
        const rowFocus = focus.has(`vreg:${row.name}`);
        out.push(`<g class="${rowFocus ? 'focus' : ''}">`);
        out.push(text(LEFT - 8, ry + 16, row.name, `mono strong end ${rowFocus ? 'hl' : ''}`));
        out.push(text(LEFT - 34, ry + 16, row.kind.split(' ')[0], 'tiny dim end'));
        for (let l = 0; l < shown; l++) {
            const cells = row.byLane[l];
            const vis = cells.length > perLane ? cells.slice(0, perLane - 1) : cells;
            vis.forEach((cl, k) => {
                const cx = laneX(l) + 6 + k * cellW;
                const cls = `cell ${cl.tail ? 'tail' : ''} ${cl.isNew ? 'new' : ''}`;
                out.push(`<g><title>${esc(`${row.name}[${cl.e}] = ${cl.text}`)}</title>${box(cx, ry + 2, cellW - 2, rowH - 4, cls)}`);
                if (idxW) out.push(text(cx + 3, ry + 11, `${cl.e}`, 'idx dim'));
                out.push(text(cx + idxW + (cellW - 2 - idxW) / 2, ry + 16, clip(cl.text, Math.floor((cellW - 6 - idxW) / CHAR)), `mono val center ${cl.tail ? 'dim' : ''}`) + '</g>');
            });
            if (cells.length > perLane) out.push(text(laneX(l) + 6 + (perLane - 1) * cellW + cellW / 2, ry + 15, '…', 'center dim'));
        }
        out.push('</g>');
    });

    // Ligação dos registradores com as unidades: leitura descendo, escrita subindo.
    const anyBusy = snap.units.some((u) => u.ops.length);
    for (let l = 0; l < shown; l++) {
        const x0 = laneX(l);
        out.push(arrow(x0 + laneW * 0.35, regTop + regH, regTop + regH + 18, anyBusy ? 'on' : ''));
        out.push(arrow(x0 + laneW * 0.65, regTop + regH + 18, regTop + regH, anyBusy ? 'on' : ''));
    }

    // Unidades funcionais: um trecho em cada lane, com um quadro por estágio.
    for (const x of order) {
        const uy = unitY.get(x.i);
        const h = unitH(x);
        const busy = x.u.ops.length > 0;
        const uf = focus.has(`unit:${x.u.name}`);
        const classes = x.uc.classes.map((k) => t('ui.vec.classLat', { cls: t(`classShort.${k}`), n: cfg.latency[k] })).join(', ');
        out.push(`<g class="unit ${busy ? 'busy' : ''} ${uf ? 'focus' : ''}"><title>${esc(`${x.u.name}: ${classes} (${x.uc.classes.map((k) => className(k)).join(', ')})`)}</title>`);
        out.push(text(8, uy + 14, x.u.name, 'title'));
        out.push(text(8, uy + 27, t(x.uc.pipelined ? 'ui.vec.pipelined' : 'ui.vec.notPipelined'), 'tiny dim'));
        const stageW = (laneW - 12) / x.depth;
        for (let l = 0; l < shown; l++) {
            const x0 = laneX(l) + 6;
            out.push(box(x0 - 2, uy - 2, laneW - 8, h - 6, `pipe ${uf ? 'focus' : ''}`));
            for (let s = 0; s < x.depth; s++) {
                const cell = x.grid[l][s];
                const sx = x0 + s * stageW;
                const col = cell ? dynColor(cell.dyn) : null;
                out.push(`<rect x="${sx + 1}" y="${uy + 4}" width="${Math.max(2, stageW - 2)}" height="18" rx="2" class="stage ${cell ? 'on' : ''}" ${col ? `style="fill:${tint(col, 30)};stroke:${col}"` : ''}/>`);
                if (cell && stageW >= 14) out.push(text(sx + stageW / 2, uy + 17, `${cell.e}`, 'tiny center strong'));
            }
            if (x.mem) out.push(arrow(laneX(l) + laneW / 2, uy + h - 8, laneBottom + 24, busy ? 'on' : ''));
        }
        // Estado de cada operação, à direita.
        const rx = LEFT + lanesW + 14;
        if (!busy) out.push(text(rx, uy + 16, t('ui.vec.free'), 'small dim'));
        x.u.ops.forEach((op, k) => {
            const col = dynColor(op.dyn);
            out.push(box(rx, uy + 4 + k * 14, 4, 11, '', `style="fill:${col};stroke:none"`));
            out.push(text(rx + 8, uy + 13 + k * 14, `${clip(ctx.sim.dyn[op.dyn].text, 24)}: ${clip(opState(op, c, x.entering[k]), 44)}`, 'small'));
        });
        out.push('</g>');
    }

    // Memória, abaixo das lanes.
    const memY = laneBottom + 24;
    const memBusy = order.some((x) => x.mem && x.u.ops.length);
    out.push(box(LEFT, memY, lanesW, 26, `membox ${memBusy ? 'on' : ''}`));
    out.push(text(LEFT + lanesW / 2, memY + 17, t('ui.vec.svg.memory'), 'small center strong'));

    const width = LEFT + lanesW + RIGHT;
    const height = memY + 34;
    return `<svg class="vec-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(t('ui.vec.svg.aria'))}">${out.join('')}</svg>`;
}
