/**
 * Comparação lado a lado de duas simulações do mesmo programa com configurações diferentes.
 */
import { t } from '../i18n/index.js';
import { statsRows, fmtNum } from './panels.js';
import { timelineHtml } from './timeline.js';
import { configSummary, configDiff } from './summary.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c]);

export function renderCompare(el, simA, simB) {
    const diff = configDiff(simA.config, simB.config);
    const ra = statsRows(simA), rb = statsRows(simB);
    const labels = [...new Set([...ra.map((r) => r[0]), ...rb.map((r) => r[0])])];
    const get = (rows, k) => rows.find((r) => r[0] === k)?.[1] ?? '';
    const statRows = labels.map((k) => `<tr><th>${esc(k)}</th><td class="num">${esc(get(ra, k))}</td><td class="num">${esc(get(rb, k))}</td></tr>`).join('');
    const ta = simA.timing, tb = simB.timing;
    const speedup = tb.timeNs > 0 ? ta.timeNs / tb.timeNs : 0;
    const ratio = (x) => fmtNum(x, 2);
    const cyc = simB.stats.cycles > 0 ? simA.stats.cycles / simB.stats.cycles : 0;
    const perf = `
        <table class="stats perf">
            <tr><th></th><th>A</th><th>B</th><th>${t('cmp.ratio')}</th></tr>
            <tr><th>${t('stats.cycles')}</th><td class="num">${simA.stats.cycles}</td><td class="num">${simB.stats.cycles}</td><td class="num">${ratio(cyc)}</td></tr>
            <tr><th>${t('stats.frequency')}</th><td class="num">${fmtNum(ta.freqGHz, 3)} GHz</td><td class="num">${fmtNum(tb.freqGHz, 3)} GHz</td><td class="num">${ratio(tb.freqGHz / ta.freqGHz)}</td></tr>
            <tr class="total"><th>${t('stats.time')}</th><td class="num">${fmtNum(ta.timeNs, 2)} ns</td><td class="num">${fmtNum(tb.timeNs, 2)} ns</td><td class="num"><b>${ratio(speedup)}</b></td></tr>
        </table>
        <p class="note">${t('cmp.timeNote')}</p>`;
    const side = (sim, name) => `
        <section class="panel compare-side">
            <h3>${name} <span class="sub">${esc(t(`mode.${sim.model}`))}</span></h3>
            <ul class="summary">${configSummary(sim.config).map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
            <div class="compare-timeline"><table class="timeline">${timelineHtml(sim)}</table></div>
        </section>`;
    el.innerHTML = `
        <div class="sheet-inner">
            <h2>${t('cmp.title')}</h2>
            <div class="ex-grid">
                <section class="panel">
                    <h3>${t('cmp.performance')}</h3>
                    <p class="big">${t(speedup >= 1 ? 'cmp.faster' : 'cmp.slower', { x: ratio(speedup >= 1 ? speedup : 1 / speedup) })}</p>
                    ${perf}
                </section>
                <section class="panel">
                    <h3>${t('cmp.results')}</h3>
                    <table class="stats"><tr><th></th><th>A</th><th>B</th></tr>${statRows}</table>
                </section>
                <section class="panel">
                    <h3>${t('cmp.differences')}</h3>
                    ${diff.length ? `<table class="stats"><tr><th></th><th>A</th><th>B</th></tr>${diff.map((d) => `<tr><th>${esc(d.key)}</th><td>${esc(d.a ?? '')}</td><td>${esc(d.b ?? '')}</td></tr>`).join('')}</table>` : `<p class="note">${t('cmp.same')}</p>`}
                </section>
            </div>
            <div class="compare-grid">${side(simA, 'A')}${side(simB, 'B')}</div>
        </div>`;
}
