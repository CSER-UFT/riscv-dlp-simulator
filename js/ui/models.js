/**
 * Comparação entre modelos: a mesma carga de trabalho no processador vetorial, na GPU e na TPU.
 */
import { t } from '../i18n/index.js';
import { WORKLOADS, runWorkload } from '../core/workloads.js';
import { exampleName } from '../examples.js';
import { configSummary } from './summary.js';
import { esc, fmtNum } from './panels.js';

/**
 * @param {HTMLElement} el
 * @param {{workload: string, rows?: object}} state estado da aba (carga escolhida e resultados já calculados)
 * @param {(ex: object, config: object) => void} onOpen abre uma versão como simulação
 */
export function renderModels(el, state, onOpen) {
    const w = WORKLOADS.find((x) => x.id === state.workload) ?? WORKLOADS[0];
    state.rows ??= {};
    const rows = (state.rows[w.id] ??= runWorkload(w));
    const ok = rows.filter((r) => r.sim);
    const maxCycles = Math.max(1, ...ok.map((r) => r.cycles));
    const best = Math.min(...ok.map((r) => r.timeNs));
    const name = (r) => t(`mode.${r.model}`) + (r.variant ? ` (${t(`models.variant.${r.variant}`)})` : '');

    const tabs = WORKLOADS.map((x) => `<button type="button" class="btn ${x.id === w.id ? 'primary' : ''}" data-workload="${x.id}">${esc(t(`models.w.${x.id}`))}</button>`).join(' ');
    const body = rows.map((r, i) => {
        if (r.na) return `<tr class="na"><th>${esc(name(r))}</th><td colspan="7" class="dim">${esc(t(`models.na.${w.id}.${r.model}`))}</td></tr>`;
        if (r.error) return `<tr><th>${esc(name(r))}</th><td colspan="7" class="warn">${esc(r.error)}</td></tr>`;
        const pct = (100 * r.cycles) / maxCycles;
        return `<tr class="${r.timeNs === best ? 'best' : ''}">
            <th>${esc(name(r))}<span class="sub">${esc(exampleName(r.ex))}</span></th>
            <td class="num">${r.cycles}</td>
            <td class="bar-cell"><span class="mbar mbar-${r.model}" style="width:${pct.toFixed(1)}%"></span></td>
            <td class="num">${fmtNum(r.timeNs, 1)} ns</td>
            <td class="num">${r.instructions}</td>
            <td class="num">${fmtNum(r.opsPerCycle, 2)}</td>
            <td class="metric">${esc(t(r.metric.key))}: <b>${fmtNum(100 * r.metric.value, 1)}%</b></td>
            <td><button type="button" class="btn small" data-open="${i}">${t('models.open')}</button></td></tr>`;
    }).join('');
    const configs = ok.map((r) => `<li><b>${esc(name(r))}</b>: ${esc(configSummary(r.config).slice(1, 5).join(' · '))}</li>`).join('');

    el.innerHTML = `
        <div class="sheet-inner">
            <h2>${t('models.title')}</h2>
            <p>${t('models.intro')}</p>
            <div class="models-tabs">${tabs}</div>
            <section class="panel">
                <h3>${esc(t(`models.w.${w.id}`))} <span class="sub">${t('models.ops', { n: w.ops })}</span></h3>
                <p class="note">${t(`models.desc.${w.id}`)}</p>
                <table class="stats models">
                    <tr><th>${t('models.col.model')}</th><th>${t('stats.cycles')}</th><th></th><th>${t('stats.time')}</th>
                        <th>${t('models.col.instructions')}</th><th>${t('models.col.opsPerCycle')}</th><th>${t('models.col.metric')}</th><th></th></tr>
                    ${body}
                </table>
                <p class="note">${t('models.instNote')}</p>
            </section>
            <section class="panel">
                <h3>${t('models.reading')}</h3>
                <p>${t(`models.lesson.${w.id}`)}</p>
            </section>
            <section class="panel">
                <h3>${t('models.configs')}</h3>
                <ul class="summary">${configs}</ul>
                <p class="note">${t('models.configsNote')}</p>
            </section>
        </div>`;
    for (const b of el.querySelectorAll('[data-workload]')) b.addEventListener('click', () => {
        state.workload = b.dataset.workload;
        renderModels(el, state, onOpen);
    });
    for (const b of el.querySelectorAll('[data-open]')) b.addEventListener('click', () => {
        const r = rows[Number(b.dataset.open)];
        onOpen(r.ex, r.config);
    });
}
