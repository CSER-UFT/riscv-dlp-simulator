/**
 * Linha do tempo: uma linha por instrução e uma coluna por ciclo.
 */
import * as fmt from '../riscv/format.js';
import { t } from '../i18n/index.js';

const CLASS_OF = { Issue: 'issue', Exec: 'exec', Lat: 'lat', Stall: 'stall' };
const FULL_LIMIT = 160;
const WINDOW_BEFORE = 100;
const WINDOW_AFTER = 40;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c]);

export class Timeline {

    /** @param {string} tableId */
    constructor(tableId) {
        this.table = document.getElementById(tableId);
        this.container = this.table.parentElement;

        // Arrastar para rolar
        this.pos = null;
        this.container.addEventListener('mousedown', (e) => {
            this.container.style.cursor = 'grabbing';
            this.pos = { left: this.container.scrollLeft, top: this.container.scrollTop, x: e.clientX, y: e.clientY };
        });
        this.container.addEventListener('mousemove', (e) => {
            if (!this.pos) return;
            this.container.scrollTop = this.pos.top - (e.clientY - this.pos.y);
            this.container.scrollLeft = this.pos.left - (e.clientX - this.pos.x);
        });
        const stop = () => { this.container.style.cursor = 'default'; this.pos = null; };
        this.container.addEventListener('mouseup', stop);
        this.container.addEventListener('mouseleave', stop);
    }

    clear() {
        this.table.textContent = '';
    }

    show(visible) {
        this.container.classList.toggle('hidden', !visible);
    }

    /**
     * @param {object} sim resultado da simulação
     * @param {number} cycle ciclo visualizado
     * @param {number} seq número do passo visualizado (marcas posteriores ficam ocultas)
     */
    update(sim, cycle, seq) {
        this.table.innerHTML = timelineHtml(sim, cycle, seq);
        const target = this.table.querySelector('th.cur');
        if (target) {
            const left = target.offsetLeft - this.container.clientWidth / 2;
            this.container.scrollLeft = Math.max(0, left);
        }
        const lastRow = this.table.querySelector('tr:last-child');
        if (lastRow && lastRow.offsetTop > this.container.scrollTop + this.container.clientHeight)
            lastRow.scrollIntoView({ block: 'nearest' });
    }
}

/**
 * HTML das linhas da tabela da linha do tempo (também usado na comparação lado a lado).
 * @param {number} cycle ciclo destacado (ou Infinity para a execução completa)
 * @param {number} seq passo visualizado (Infinity mostra tudo)
 */
export function timelineHtml(sim, cycle = Infinity, seq = Infinity) {
    const total = sim.states.length - 1;
    let first = 1, last = total;
    if (total > FULL_LIMIT && Number.isFinite(cycle)) {
        first = Math.max(1, cycle - WINDOW_BEFORE);
        last = Math.min(total, Math.max(cycle + WINDOW_AFTER, first + FULL_LIMIT - 1));
    }

    const head = [`<tr><th class="inst">${t('ui.instruction')}</th>`];
    for (let c = first; c <= last; c++)
        head.push(`<th class="${c === cycle ? 'cur' : ''}">${c}</th>`);
    head.push('</tr>');

    const rows = [];
    for (const d of sim.dyn) {
        const visible = d.marks.filter((m) => m[2] !== null && m[2] <= seq);
        if (visible.length === 0) continue;
        const lastCycle = visible[visible.length - 1][0];
        if (lastCycle < first && total > FULL_LIMIT) continue;
        const byCycle = new Map();
        for (const [c, label] of visible) byCycle.set(c, label);
        const squashed = d.squashed !== null && byCycle.has(d.squashed);
        const cls = [squashed ? 'squashed' : '', d.mispredicted && (d.commit ?? Infinity) <= cycle ? 'mispredicted' : ''].join(' ');
        const cells = [`<tr class="${cls}"><td class="inst"><span class="pc">${fmt.address(d.pc)}</span>${esc(d.text)}</td>`];
        for (let c = first; c <= last; c++) {
            const label = byCycle.get(c);
            const cur = c === cycle ? ' cur' : '';
            cells.push(label ? `<td class="${CLASS_OF[label] ?? ''}${cur}">${esc(t(`tl.${label}`))}</td>` : `<td class="${cur}"></td>`);
        }
        cells.push('</tr>');
        rows.push(cells.join(''));
    }
    return head.join('') + rows.join('');
}
