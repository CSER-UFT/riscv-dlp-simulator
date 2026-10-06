/**
 * Exportação da linha do tempo e da tabela de eventos em CSV e em LaTeX.
 * As tabelas LaTeX seguem o padrão: cabeçalho com fundo tabAzul e texto branco, linhas com \hline,
 * sem booktabs. Requerem o pacote xcolor com a opção table.
 */
import { t } from '../i18n/index.js';
import { eventColumns, eventRows } from './events.js';
import { answerText } from './questions.js';

const csvCell = (s) => {
    const v = String(s ?? '');
    return /[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};

const tex = (s) => String(s ?? '')
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([#$%&_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');

/** Matriz instrução x ciclo da linha do tempo completa. */
function timelineMatrix(sim) {
    const cycles = sim.states.length - 1;
    const rows = [];
    for (const d of sim.dyn) {
        const cells = new Array(cycles).fill('');
        for (const [c, label] of d.marks) if (c >= 1 && c <= cycles) cells[c - 1] = t(`tl.${label}`);
        rows.push({ text: d.text, cells });
    }
    return { cycles, rows };
}

export function timelineCsv(sim) {
    const { cycles, rows } = timelineMatrix(sim);
    const head = [t('ui.instruction'), ...Array.from({ length: cycles }, (_, i) => i + 1)];
    const lines = [head.map(csvCell).join(',')];
    for (const r of rows) lines.push([r.text, ...r.cells].map(csvCell).join(','));
    return lines.join('\n') + '\n';
}

export function eventsCsv(sim) {
    const cols = eventColumns(sim);
    const lines = [[t('ui.instruction'), ...cols.map((c) => c.label)].map(csvCell).join(',')];
    for (const r of eventRows(sim)) lines.push([r.text, ...cols.map((c) => r.values[c.key] ?? '')].map(csvCell).join(','));
    return lines.join('\n') + '\n';
}

const PREAMBLE = (title) => [
    `% ${title}`,
    `% ${t('export.requires')}`,
    '\\providecolor{tabAzul}{HTML}{1F4E79}',
];

function header(cells) {
    return `\\rowcolor{tabAzul}${cells.map((c) => `\\color{white}${c}`).join(' & ')} \\\\ \\hline`;
}

export function timelineLatex(sim) {
    const { cycles, rows } = timelineMatrix(sim);
    const out = [...PREAMBLE(t('export.timelineTitle'))];
    out.push('\\begin{table}[htbp]', '\\centering', '\\resizebox{\\textwidth}{!}{%');
    out.push(`\\begin{tabular}{|l|${'c|'.repeat(cycles)}}`, '\\hline');
    out.push(header([`\\textbf{${tex(t('ui.instruction'))}}`, ...Array.from({ length: cycles }, (_, i) => `\\textbf{${i + 1}}`)]));
    for (const r of rows) {
        out.push(`\\texttt{${tex(r.text)}} & ${r.cells.map(tex).join(' & ')} \\\\ \\hline`);
    }
    out.push('\\end{tabular}}', `\\caption{${tex(t('export.timelineCaption', { model: t(`mode.${sim.model}`) }))}}`, '\\end{table}');
    return out.join('\n') + '\n';
}

/**
 * Tabela de eventos em LaTeX.
 * @param {boolean} blank deixa as células de ciclo em branco (para provas e listas)
 */
export function eventsLatex(sim, blank = false) {
    const cols = eventColumns(sim);
    const out = [...PREAMBLE(t('export.eventsTitle'))];
    out.push('\\begin{table}[htbp]', '\\centering');
    out.push(`\\begin{tabular}{|l|${'c|'.repeat(cols.length)}}`, '\\hline');
    out.push(header([`\\textbf{${tex(t('ui.instruction'))}}`, ...cols.map((c) => `\\textbf{${tex(c.label)}}`)]));
    for (const r of eventRows(sim))
        out.push(`\\texttt{${tex(r.text)}} & ${cols.map((c) => (blank ? '' : tex(r.values[c.key] ?? ''))).join(' & ')} \\\\ \\hline`);
    out.push('\\end{tabular}', `\\caption{${tex(t(blank ? 'export.eventsBlankCaption' : 'export.eventsCaption', { model: t(`mode.${sim.model}`) }))}}`, '\\end{table}');
    return out.join('\n') + '\n';
}

/**
 * Perguntas do exercício em LaTeX (lista numerada), com as respostas ou com espaço para responder.
 * @param {{text: string, answer: *}[]} questions
 */
export function questionsLatex(questions, blank = false) {
    const item = (q) => {
        const text = tex(q.text).replace(/`([^`]+)`/g, '\\texttt{$1}');
        return `  \\item ${text}${blank ? ' \\hfill \\underline{\\hspace{3cm}}' : ` \\textbf{${tex(answerText(q))}}`}`;
    };
    return ['', `% ${t('q.title')}`, '\\begin{enumerate}', ...questions.map(item), '\\end{enumerate}', ''].join('\n');
}

/** Oferece um texto para download. */
export function download(filename, text, type = 'text/plain') {
    const blob = new Blob([text], { type: `${type};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
