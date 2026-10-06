/**
 * Exportação do estado de um ciclo em LaTeX, para slides e provas: figuras TikZ (unidades vetoriais com as
 * lanes, array sistólico da TPU) e tabelas no padrão do curso (cabeçalho tabAzul com texto branco, \hline,
 * sem booktabs) para registradores vetoriais, Unified Buffer, acumuladores, warps com a pilha SIMT e o último
 * acesso à memória da GPU.
 */
import * as fmt from '../riscv/format.js';
import * as regs from '../riscv/registers.js';
import { t } from '../i18n/index.js';
import { COLORS } from './panels.js';
import { tex, header } from './export.js';
import { laneGrid, vregRows } from './diagram-vector.js';
import { systolicState, rowColor, num } from './diagram-tpu.js';
import { warpColor, instAt } from './diagram-gpu.js';

/** Nome da cor LaTeX equivalente a uma cor da paleta da interface. */
const colorName = (hex) => `dlpc${COLORS.indexOf(hex)}`;

const PALETTE = COLORS.map((c, i) => `\\providecolor{dlpc${i}}{HTML}{${c.slice(1).toUpperCase()}}`);

function preamble(sim, snap) {
    return [
        `% ${t('export.stateTitle', { model: t(`mode.${sim.model}`), c: snap.cycle })}`,
        `% ${t('export.stateRequires')}`,
        '\\providecolor{tabAzul}{HTML}{1F4E79}',
        ...PALETTE,
        '',
    ];
}

const code = (s) => `\\texttt{${tex(s)}}`;

/** Tabela com cabeçalho tabAzul; `rows` são listas de células já em LaTeX. */
function table(head, rows, caption, { resize = false, align = null } = {}) {
    const cols = align ?? `|l|${'c|'.repeat(head.length - 1)}`;
    const out = ['\\begin{table}[htbp]', '\\centering'];
    if (resize) out.push('\\resizebox{\\textwidth}{!}{%');
    out.push(`\\begin{tabular}{${cols}}`, '\\hline', header(head.map((h) => `\\textbf{${h}}`)));
    for (const r of rows) out.push(`${r.join(' & ')} \\\\ \\hline`);
    out.push(resize ? '\\end{tabular}}' : '\\end{tabular}', `\\caption{${caption}}`, '\\end{table}', '');
    return out;
}

// Processador vetorial ---------------------------------------------------------------------------------------

function vectorState(ctx, snap) {
    const out = [];
    const rows = vregRows(ctx, snap);
    if (rows.length) {
        const n = Math.max(...rows.map((r) => r.cells.length));
        const head = [tex(t('export.reg')), ...Array.from({ length: n }, (_, k) => String(rows[0].off + k))];
        const body = rows.map((r) => [
            `${r.name} {\\scriptsize (${tex(r.kind)})}`,
            ...r.cells.map((c) => `${c.tail ? '\\cellcolor{gray!20}' : ''}${c.isNew ? `\\textbf{${tex(c.text)}}` : tex(c.text)}`),
            ...new Array(n - r.cells.length).fill(''),
        ]);
        out.push(...table(head, body, tex(t('export.vregsCaption', { c: snap.cycle, vl: snap.vl })), { resize: n > 8 }));
    }
    // Unidades: grade lanes x estágios com o número do elemento em cada posição, na cor da instrução.
    const cfg = ctx.sim.config.vector;
    const W = 0.75, H = 0.6;
    const pic = ['\\begin{figure}[htbp]', '\\centering', '\\resizebox{\\textwidth}{!}{%',
        `\\begin{tikzpicture}[cell/.style={draw, minimum width=${W}cm, minimum height=${H}cm, inner sep=0pt, font=\\footnotesize}]`];
    let x0 = 0;
    const legend = new Map();
    cfg.units.forEach((u, i) => {
        const { L, depth, grid } = laneGrid(ctx, snap, i);
        pic.push(`\\node[font=\\bfseries] at (${(x0 + ((depth - 1) * W) / 2).toFixed(2)}, ${H * 1.4}) {${tex(u.name)}};`);
        for (let s = 0; s < depth; s++) pic.push(`\\node[font=\\scriptsize] at (${(x0 + s * W).toFixed(2)}, ${H * 0.75}) {${s + 1}};`);
        for (let lane = 0; lane < L; lane++) {
            pic.push(`\\node[font=\\scriptsize, anchor=east] at (${(x0 - W / 2).toFixed(2)}, ${(-lane * H).toFixed(2)}) {${lane}};`);
            for (let s = 0; s < depth; s++) {
                const cell = grid[lane][s];
                const xy = `(${(x0 + s * W).toFixed(2)}, ${(-lane * H).toFixed(2)})`;
                if (cell) {
                    const col = colorName(COLORS[cell.dyn % COLORS.length]);
                    legend.set(cell.dyn, col);
                    pic.push(`\\node[cell, fill=${col}!35] at ${xy} {${cell.e}};`);
                } else pic.push(`\\node[cell] at ${xy} {};`);
            }
        }
        x0 += (depth + 1.5) * W;
    });
    pic.push('\\end{tikzpicture}}');
    const leg = [...legend.entries()].map(([dyn, col]) => `\\colorbox{${col}!35}{${code(ctx.sim.dyn[dyn].text)}}`).join(' \\quad ');
    pic.push(`\\caption{${tex(t('export.unitsCaption', { c: snap.cycle }))}${leg ? ` ${leg}` : ''}}`, '\\end{figure}', '');
    return [...out, ...pic];
}

// TPU --------------------------------------------------------------------------------------------------------

function tpuState(ctx, snap) {
    const { N, cells, outputs, inputs, weights } = systolicState(ctx, snap);
    const DX = 2.7, DY = 1.9;
    const pic = ['\\begin{figure}[htbp]', '\\centering', '\\resizebox{\\textwidth}{!}{%',
        '\\begin{tikzpicture}[pe/.style={draw, rounded corners=2pt, minimum width=2.3cm, minimum height=1.5cm, align=center, font=\\small}, flow/.style={-latex, thick}]'];
    for (let j = 0; j < N; j++) pic.push(`\\node[font=\\bfseries\\small] at (${(j * DX).toFixed(2)}, ${(DY * 0.65).toFixed(2)}) {${tex(t('ui.tpu.col', { j }))}};`);
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const cell = cells[i][j];
            const w = cell ? cell.w : (weights ? weights[i][j] : null);
            const lines = [`$w = ${num(w) || '\\cdot'}$`];
            if (cell) lines.push(`$x = ${num(cell.x)}$ $\\rightarrow$`, `$\\Sigma = ${num(cell.psum)}$ $\\downarrow$`);
            const fill = cell ? `, fill=${colorName(rowColor(cell.r))}!25` : '';
            pic.push(`\\node[pe${fill}] (p${i}x${j}) at (${(j * DX).toFixed(2)}, ${(-i * DY).toFixed(2)}) {${lines.join(' \\\\ ')}};`);
        }
        const q = inputs[i].slice().reverse().map((e) => num(e.x)).join('\\;');
        pic.push(`\\node[align=right, anchor=east, font=\\small] (in${i}) at (${(-DX * 0.75).toFixed(2)}, ${(-i * DY).toFixed(2)}) {${q ? `$${q}$` : ''}};`);
        pic.push(`\\draw[flow] (${(-DX * 0.72).toFixed(2)}, ${(-i * DY).toFixed(2)}) -- (p${i}x0.west);`);
        for (let j = 0; j + 1 < N; j++) pic.push(`\\draw[flow] (p${i}x${j}.east) -- (p${i}x${j + 1}.west);`);
    }
    for (let j = 0; j < N; j++) {
        for (let i = 0; i + 1 < N; i++) pic.push(`\\draw[flow] (p${i}x${j}.south) -- (p${i + 1}x${j}.north);`);
        const o = outputs[j];
        const text = o ? `$${num(o.v)}$ \\\\ {\\scriptsize ${o.add ? '+' : ''}ACC[${o.acc}]}` : '';
        const fill = o ? `, fill=${colorName(rowColor(o.r))}!25` : '';
        pic.push(`\\node[draw, dashed, minimum width=2.3cm, minimum height=0.9cm, align=center, font=\\small${fill}] (o${j}) at (${(j * DX).toFixed(2)}, ${(-N * DY + 0.3).toFixed(2)}) {${text}};`);
        pic.push(`\\draw[flow] (p${N - 1}x${j}.south) -- (o${j}.north);`);
    }
    pic.push(`\\node[font=\\small\\bfseries, anchor=east] at (${(-DX * 0.75).toFixed(2)}, ${(DY * 0.65).toFixed(2)}) {${tex(t('ui.tpu.inputs'))}};`);
    pic.push('\\end{tikzpicture}}');
    const ops = snap.mxu.map((op) => code(ctx.sim.dyn[op.dyn].text)).join(', ');
    pic.push(`\\caption{${tex(t('export.arrayCaption', { c: snap.cycle, n: N }))}${ops ? ` ${ops}.` : ''}}`, '\\end{figure}', '');

    const cfg = ctx.sim.config.tpu;
    const buf = (title, rowsUsed, data, written, size) => {
        const used = rowsUsed.filter((r) => r < size);
        if (!used.length) return [];
        const w = new Set(written ?? []);
        const body = used.map((r) => [String(r), ...data[r].map((v) => (w.has(r) ? `\\textbf{${num(v)}}` : num(v)))]);
        return table([tex(t('export.row')), ...Array.from({ length: N }, (_, j) => String(j))], body, tex(t('export.bufCaption', { buf: title, c: snap.cycle })));
    };
    return [...pic,
        ...buf(t('ui.tpu.ub'), ctx.ubRows, snap.ub, snap.written.ub, cfg.ubRows),
        ...buf(t('ui.tpu.acc'), ctx.accRows, snap.acc, snap.written.acc, cfg.accRows)];
}

// GPU --------------------------------------------------------------------------------------------------------

function gpuState(ctx, snap) {
    const nested = (lines) => (lines.length ? `\\begin{tabular}[t]{@{}l@{}}${lines.join(' \\\\ ')}\\end{tabular}` : '');
    const rows = snap.warps.map((w) => {
        const inst = w.pc !== null && w.pc >= 0 && !w.done ? instAt(ctx, w.pc) : null;
        const mask = w.mask.map((on) => (on ? '1' : '0')).join('');
        const stack = w.stack.slice().reverse().map((e) => `${fmt.address(e.pc)} / ${e.rpc === -1 ? t('ui.gpu.exitShort') : fmt.address(e.rpc)} / ${e.mask}`);
        const state = t(`ui.gpu.state.${w.state}`, { reg: w.reg ? regs.abiName(w.reg) : '', unit: w.unit ?? '', c: w.until ?? '' });
        return [
            `\\cellcolor{${colorName(warpColor(w.id))}!25}${tex(w.name)}`,
            inst ? code(inst.text) : '',
            `\\texttt{${mask}}`,
            tex(state),
            nested(stack.map((s) => `\\texttt{${tex(s)}}`)),
        ];
    });
    const out = table(
        [tex(t('export.warp')), tex(t('ui.gpu.next')), tex(t('ui.gpu.mask')), tex(t('ui.gpu.status')), tex(t('export.stackCols'))],
        rows, tex(t('export.warpsCaption', { c: snap.cycle })), { resize: true, align: '|l|l|c|l|l|' });

    const m = snap.lastMem;
    if (m) {
        const shared = m.kind === 'shared';
        const lineBytes = BigInt(ctx.sim.config.gpu.lineBytes);
        const lineIndex = shared ? null : new Map(m.lines.map((l, i) => [l.toString(), i]));
        const group = (a, lane) => (shared ? m.banks[lane] : lineIndex.get(((a / lineBytes) * lineBytes).toString()) ?? 0);
        const lanes = m.addrs.map((_, l) => String(l));
        const addr = m.addrs.map((a) => (a === null ? '$\\cdot$' : `\\texttt{${fmt.address(a)}}`));
        const grp = m.addrs.map((a, l) => (a === null ? '' : `\\cellcolor{${colorName(COLORS[group(a, l) % COLORS.length])}!30}${group(a, l)}`));
        const label = tex(t(shared ? 'export.bank' : 'export.line'));
        const caption = shared
            ? t('export.banksCaption', { inst: ctx.sim.dyn[m.dyn].text, k: m.degree })
            : t('export.coalCaption', { inst: ctx.sim.dyn[m.dyn].text, k: m.k, b: ctx.sim.config.gpu.lineBytes });
        out.push(...table([tex(t('export.lane')), ...lanes], [[tex(t('ui.address')), ...addr], [label, ...grp]], tex(caption), { resize: true }));
    }
    return out;
}

/** Estado do instantâneo `snap` da simulação do contexto `ctx`, em LaTeX. */
export function stateLatex(ctx, snap) {
    const body = { tpu: tpuState, gpu: gpuState }[ctx.sim.model] ?? vectorState;
    return [...preamble(ctx.sim, snap), ...body(ctx, snap)].join('\n') + '\n';
}
