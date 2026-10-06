/**
 * Destaque de sintaxe para o editor de assembly RISC-V (com a extensão vetorial).
 */
import { lookup, PSEUDO_INSTRUCTIONS } from '../riscv/isa.js';
import { canonical } from '../riscv/registers.js';

const PSEUDO = new Set(PSEUDO_INSTRUCTIONS);
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

function commentStart(line) {
    let quote = null;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (quote) {
            if (c === '\\') i++;
            else if (c === quote) quote = null;
        } else if (c === '"' || c === '\'') {
            quote = c;
        } else if (c === '#') {
            return i;
        }
    }
    return -1;
}

function highlightCode(code) {
    let out = '';
    let first = true;
    const re = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)')|([A-Za-z_.$%][\w.$]*:?)|([+-]?(?:0x[0-9a-fA-F_]+|0b[01_]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?))|(\s+)|(.)/g;
    let m;
    while ((m = re.exec(code)) !== null) {
        const [tok, str, word, num, space] = m;
        if (str) out += `<span class="hl-str">${esc(tok)}</span>`;
        else if (space) out += tok;
        else if (num) out += `<span class="hl-num">${esc(tok)}</span>`;
        else if (word) {
            if (word.endsWith(':')) out += `<span class="hl-label">${esc(tok)}</span>`;
            else if (word.startsWith('.') && first) { out += `<span class="hl-dir">${esc(tok)}</span>`; first = false; }
            else if (first && (lookup(word) || PSEUDO.has(word.toLowerCase()))) { out += `<span class="hl-op">${esc(tok)}</span>`; first = false; }
            else if (canonical(word) !== null || /^v0\.t$/i.test(word)) out += `<span class="hl-reg">${esc(tok)}</span>`;
            else if (/^(e(8|16|32|64)|mf?\d+|t[au]|m[au])$/i.test(word)) out += `<span class="hl-dir">${esc(tok)}</span>`;
            else if (word.startsWith('%')) out += `<span class="hl-dir">${esc(tok)}</span>`;
            else { out += first ? `<span class="hl-bad">${esc(tok)}</span>` : esc(tok); first = false; }
        } else out += esc(tok);
    }
    return out;
}

/**
 * Converte o código em HTML destacado.
 * @param {string} source
 * @param {Set<number>} errorLines linhas (a partir de 1) com erro
 */
export function highlight(source, errorLines = new Set()) {
    return source.split('\n').map((line, i) => {
        const c = commentStart(line);
        const code = c >= 0 ? line.slice(0, c) : line;
        const comment = c >= 0 ? `<span class="hl-com">${esc(line.slice(c))}</span>` : '';
        const html = highlightCode(code) + comment;
        return errorLines.has(i + 1) ? `<span class="hl-err">${html || ' '}</span>` : html;
    }).join('\n') + '\n';
}
