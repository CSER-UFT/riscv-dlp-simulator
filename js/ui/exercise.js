/**
 * Modo exercício: o aluno preenche, para cada instrução, o ciclo de cada evento (emissão, execução,
 * escrita, commit, ou os estágios do pipeline) e o simulador corrige.
 */
import { t } from '../i18n/index.js';
import { eventColumns, eventRows } from './events.js';
import { configSummary } from './summary.js';
import { eventsLatex, questionsLatex, download } from './export.js';
import { buildQuestions, checkAnswer, answerText } from './questions.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c]);

/**
 * Renderiza o exercício no elemento indicado. `state` guarda as respostas do aluno entre renderizações.
 */
export function renderExercise(el, sim, code, state) {
    const cols = eventColumns(sim);
    const rows = eventRows(sim);
    state.answers ??= {};
    state.qanswers ??= {};
    const questions = buildQuestions(sim);
    const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');
    const qbody = questions.map((q, i) => `<li><span>${inline(q.text)}</span>
        <input type="text" class="qans ${q.kind}" data-q="${i}" value="${esc(state.qanswers[i] ?? '')}" aria-label="${esc(q.text)}" /></li>`).join('');
    const summary = configSummary(sim.config).map((s) => `<li>${esc(s)}</li>`).join('');
    const body = rows.map((r, i) => `<tr><td class="inst"><code>${esc(r.text)}</code></td>${cols.map((c) =>
        `<td><input type="number" min="1" data-row="${i}" data-col="${c.key}" value="${esc(state.answers[`${i}.${c.key}`] ?? '')}" aria-label="${esc(`${r.text}: ${c.label}`)}" /></td>`).join('')}</tr>`).join('');

    el.innerHTML = `
        <div class="sheet-inner">
            <h2>${t('ex.title')}</h2>
            <p>${t('ex.instructions')}</p>
            <div class="ex-grid">
                <section class="panel"><h3>${t('ex.program')}</h3><pre class="code">${esc(code.trim())}</pre></section>
                <section class="panel"><h3>${t('ex.processor')}</h3><ul class="summary">${summary}</ul>
                    <p class="note">${t('ex.convention')}</p></section>
            </div>
            <section class="panel">
                <table class="exercise"><tr><th>${t('ui.instruction')}</th>${cols.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr>${body}</table>
            </section>
            <section class="panel">
                <h3>${t('q.title')}</h3>
                <p class="note">${t(`q.intro.${sim.model}`)}</p>
                <ol class="questions">${qbody}</ol>
                <div class="ex-actions">
                    <button type="button" class="btn primary" data-act="check">${t('ex.check')}</button>
                    <button type="button" class="btn" data-act="reveal">${t('ex.reveal')}</button>
                    <button type="button" class="btn" data-act="clear">${t('ex.clear')}</button>
                    <button type="button" class="btn" data-act="blank">${t('ex.exportBlank')}</button>
                    <button type="button" class="btn" data-act="key">${t('ex.exportKey')}</button>
                    <span class="score" aria-live="polite"></span>
                </div>
            </section>
        </div>`;

    const inputs = [...el.querySelectorAll('table.exercise input')];
    const qinputs = [...el.querySelectorAll('input.qans')];
    const score = el.querySelector('.score');
    for (const inp of inputs) {
        inp.addEventListener('input', () => {
            state.answers[`${inp.dataset.row}.${inp.dataset.col}`] = inp.value;
            inp.classList.remove('right', 'wrong');
        });
    }
    for (const inp of qinputs) {
        inp.addEventListener('input', () => {
            state.qanswers[inp.dataset.q] = inp.value;
            inp.classList.remove('right', 'wrong');
        });
    }
    const check = () => {
        let right = 0;
        for (const inp of qinputs) {
            const ok = checkAnswer(questions[inp.dataset.q], inp.value);
            inp.classList.toggle('right', ok);
            inp.classList.toggle('wrong', !ok);
            if (ok) right++;
        }
        for (const inp of inputs) {
            const expected = rows[inp.dataset.row].values[inp.dataset.col];
            const ok = inp.value !== '' && Number(inp.value) === expected;
            inp.classList.toggle('right', ok);
            inp.classList.toggle('wrong', !ok);
            inp.title = ok ? '' : t('ex.expectedHint');
            if (ok) right++;
        }
        score.textContent = t('ex.score', { right, total: inputs.length + qinputs.length });
    };
    el.querySelector('[data-act="check"]').addEventListener('click', check);
    el.querySelector('[data-act="reveal"]').addEventListener('click', () => {
        for (const inp of inputs) {
            const v = rows[inp.dataset.row].values[inp.dataset.col];
            if (Number(inp.value) !== v) {
                inp.value = v ?? '';
                inp.classList.remove('right');
                inp.classList.add('revealed');
            }
        }
        for (const inp of qinputs) {
            const q = questions[inp.dataset.q];
            if (!checkAnswer(q, inp.value)) {
                inp.value = answerText(q);
                inp.classList.remove('right', 'wrong');
                inp.classList.add('revealed');
            }
        }
        score.textContent = t('ex.revealed');
    });
    el.querySelector('[data-act="clear"]').addEventListener('click', () => {
        state.answers = {};
        state.qanswers = {};
        for (const inp of [...inputs, ...qinputs]) {
            inp.value = '';
            inp.classList.remove('right', 'wrong', 'revealed');
        }
        score.textContent = '';
    });
    el.querySelector('[data-act="blank"]').addEventListener('click', () => download('exercicio.tex', eventsLatex(sim, true) + questionsLatex(questions, true), 'application/x-tex'));
    el.querySelector('[data-act="key"]').addEventListener('click', () => download('gabarito.tex', eventsLatex(sim, false) + questionsLatex(questions, false), 'application/x-tex'));
}
