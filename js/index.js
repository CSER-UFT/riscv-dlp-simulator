import { assemble } from './riscv/parser.js';
import { simulate } from './simulator.js';
import { normalizeConfig } from './core/config.js';
import { t, getLanguage, setLanguage, LANGUAGES } from './i18n/index.js';
import * as diagram from './ui/diagram.js';
import { Controller } from './ui/controller.js';
import { Editor } from './ui/editor.js';
import { TabManager } from './ui/tabs.js';
import { Timeline } from './ui/timeline.js';
import { Viewport } from './ui/viewport.js';
import { renderExercise } from './ui/exercise.js';
import { renderCompare } from './ui/compare.js';
import { timelineCsv, timelineLatex, eventsCsv, eventsLatex, download } from './ui/export.js';
import { Help, MODEL_SECTION } from './ui/help.js';
import { configDiff } from './ui/summary.js';

const timeline = new Timeline('timeline');
timeline.show(false);
const controller = new Controller('control', 'control-counter', 'control-msg', ['control-skip-back', 'control-skip-fwd'], ['control-step-back', 'control-step-fwd']);
const tabManager = new TabManager('tab-names', 'tab-filler');
const viewport = new Viewport('viewport', 'diagram');
const readme = document.getElementById('readme');
const help = new Help(readme);
const diagramEl = document.getElementById('diagram');
const sheet = document.getElementById('sheet');
const buttons = {
    edit: document.getElementById('open-editar'),
    compare: document.getElementById('open-comparar'),
    exercise: document.getElementById('open-exercicio'),
    export: document.getElementById('export-menu'),
    link: document.getElementById('copy-link'),
};

// Tema claro ou escuro ------------------------------------------------------------------------------------

const themeButton = document.getElementById('theme-toggle');
function updateThemeIcon() {
    const dark = document.documentElement.dataset.theme === 'dark';
    themeButton.querySelector('.icon').className = `icon ${dark ? 'i-sun' : 'i-moon'}`;
    themeButton.setAttribute('aria-pressed', String(dark));
}
themeButton.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
        localStorage.setItem('dlp.theme', next);
    } catch {
        // sem armazenamento: o tema vale só nesta visita
    }
    updateThemeIcon();
});
updateThemeIcon();

// Idioma -------------------------------------------------------------------------------------------------

const langSelect = document.getElementById('lang-select');
langSelect.innerHTML = Object.entries(LANGUAGES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
langSelect.value = getLanguage();

function applyDomTranslations() {
    document.documentElement.lang = getLanguage() === 'en' ? 'en' : 'pt-BR';
    document.title = t('ui.docTitle');
    for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
    for (const el of document.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
    for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
    help.render();
}
applyDomTranslations();

langSelect.addEventListener('change', () => {
    setLanguage(langSelect.value);
    applyDomTranslations();
    editor.translate();
    // As mensagens das simulações são geradas no idioma atual: simula de novo as abas abertas.
    for (const name of Object.keys(tabManager.tabContents)) {
        const c = tabManager.tabContents[name];
        if (c.kind === 'compare') {
            c.simA = runSilently(c.code, c.config);
            c.simB = runSilently(c.code, c.configB);
        } else {
            c.sim = runSilently(c.code, c.config);
            if (c.kind === 'sim') {
                c.ctx = diagram.createContext(c.sim);
                c.numInterStates = c.sim.interStates.map((s) => s.length);
            }
        }
    }
    if (tabManager.currentContents()) tabManager.updateContents({});
});

// Simulação ------------------------------------------------------------------------------------------------

/** Monta e simula; retorna {sim} ou {errors}. */
function build(code, config) {
    const { config: cfg, errors: cfgErrors } = normalizeConfig(config);
    const program = assemble(code, { xlen: cfg.xlen });
    if (program.errors.length > 0 || cfgErrors.length > 0)
        return { errors: [...program.errors, ...cfgErrors] };
    const sim = simulate(program, cfg);
    if (sim.errors.length > 0) return { errors: sim.errors };
    return { sim };
}

function runSilently(code, config) {
    return build(code, config).sim;
}

function uniqueName(base) {
    let name = base;
    for (let i = 2; tabManager.contains(name); i++)
        name = `${base} (${i})`;
    return name;
}

/** Nome curto do modelo e da configuração principal, para os títulos das abas. */
function shortName(sim) {
    if (sim.model === 'tpu') return t('ui.shortNameTpu', { model: t('mode.short.tpu'), n: sim.config.tpu.n });
    return t('ui.shortName', { model: t(`mode.short.${sim.model}`), lanes: sim.config.vector.lanes });
}

function openSim(code, config, name, sim) {
    help.close();
    const base = `${name ?? sim.program.instructions[0].text} · ${shortName(sim)}`;
    tabManager.add(uniqueName(base), {
        kind: 'sim', sim, ctx: diagram.createContext(sim), code, config, name,
        curState: 0, curInterState: 0, numStates: sim.states.length,
        numInterStates: sim.interStates.map((s) => s.length), fitted: false,
    });
}

function openExercise(code, config, sim, name) {
    help.close();
    tabManager.add(uniqueName(`${t('ui.exercise')}: ${name ?? sim.program.instructions[0].text}`), {
        kind: 'exercise', sim, code, config, state: { answers: {} },
    });
}

function openCompare(code, config, configB, simA, simB) {
    help.close();
    const keys = configDiff(simA.config, simB.config).map((d) => d.key.split('.').pop());
    tabManager.add(uniqueName(keys.length ? `${t('ui.compare')}: ${keys.slice(0, 3).join(', ')}${keys.length > 3 ? '…' : ''}` : t('ui.compare')), {
        kind: 'compare', code, config, configB, simA, simB,
    });
}

const editor = new Editor((code, config, name, purpose) => {
    const r = build(code, config);
    if (r.errors) return r.errors;
    if (purpose === 'compare') {
        const cur = tabManager.currentContents();
        openCompare(cur.code, cur.config, config, cur.sim, r.sim);
    } else {
        openSim(code, config, name, r.sim);
    }
    return [];
});

document.getElementById('open-novo').addEventListener('click', () => editor.show(null, null, 'new'));
buttons.edit.addEventListener('click', () => {
    const c = tabManager.currentContents();
    if (c) editor.show(c.code, c.kind === 'compare' ? c.configB : c.config, 'edit');
});
buttons.compare.addEventListener('click', () => {
    const c = tabManager.currentContents();
    if (c?.kind === 'sim') editor.show(c.code, c.config, 'compare');
});
buttons.exercise.addEventListener('click', () => {
    const c = tabManager.currentContents();
    if (c?.kind === 'sim') openExercise(c.code, c.config, c.sim, c.name);
});
document.getElementById('open-ajuda').addEventListener('click', () => {
    if (help.isOverlay()) return help.close();
    const c = tabManager.currentContents();
    if (!c) return help.show(null);
    const model = c.sim?.model ?? c.simA?.model;
    help.open(c.kind === 'exercise' ? 'classroom' : (c.kind === 'compare' ? 'classroom' : MODEL_SECTION[model]));
});

for (const item of buttons.export.querySelectorAll('[data-export]')) {
    item.addEventListener('click', (e) => {
        e.stopPropagation();
        buttons.export.classList.remove('open');
        const c = tabManager.currentContents();
        const sim = c?.sim ?? c?.simA;
        if (!sim) return;
        switch (item.dataset.export) {
            case 'timeline-csv': return download('linha-do-tempo.csv', timelineCsv(sim), 'text/csv');
            case 'timeline-tex': return download('linha-do-tempo.tex', timelineLatex(sim), 'application/x-tex');
            case 'events-csv': return download('eventos.csv', eventsCsv(sim), 'text/csv');
            case 'events-tex': return download('eventos.tex', eventsLatex(sim, false), 'application/x-tex');
            case 'events-blank': return download('eventos-em-branco.tex', eventsLatex(sim, true), 'application/x-tex');
        }
    });
}
buttons.export.addEventListener('click', () => {
    const open = buttons.export.classList.toggle('open');
    if (open) {
        // O menu usa posição fixa para não ser cortado pela barra de ações, que tem rolagem horizontal.
        const r = buttons.export.getBoundingClientRect();
        const items = buttons.export.querySelector('.menu-items');
        items.style.top = `${r.bottom}px`;
        items.style.left = `${r.left}px`;
    }
});
document.addEventListener('click', (e) => { if (!buttons.export.contains(e.target)) buttons.export.classList.remove('open'); });

buttons.link.addEventListener('click', async () => {
    const c = tabManager.currentContents();
    if (!c) return;
    const payload = { code: c.code, config: c.config, view: c.kind };
    if (c.kind === 'compare') payload.configB = c.configB;
    const url = `${location.origin}${location.pathname}#s=${encodeShare(payload)}`;
    try {
        await navigator.clipboard.writeText(url);
        flash(buttons.link, t('ui.linkCopied'));
    } catch {
        window.prompt(t('ui.copyThisLink'), url);
    }
});

// Exibição das abas ----------------------------------------------------------------------------------------

function setButtons(kind) {
    buttons.edit.classList.toggle('hidden', !kind);
    buttons.compare.classList.toggle('hidden', kind !== 'sim');
    buttons.exercise.classList.toggle('hidden', kind !== 'sim');
    buttons.export.classList.toggle('hidden', !kind);
    buttons.link.classList.toggle('hidden', !kind);
}

tabManager.addEventListener('tab-unset', () => {
    timeline.clear();
    timeline.show(false);
    controller.hide();
    viewport.hide();
    sheet.classList.add('hidden');
    sheet.innerHTML = '';
    diagramEl.innerHTML = '';
    readme.style.display = 'block';
    setButtons(null);
});

tabManager.addEventListener('tab-set', () => {
    const c = tabManager.currentContents();
    if (c === null) return;
    if (!help.isOverlay()) readme.style.display = 'none';
    setButtons(c.kind);

    if (c.kind === 'exercise' || c.kind === 'compare') {
        viewport.hide();
        controller.hide();
        timeline.show(false);
        sheet.classList.remove('hidden');
        if (c.kind === 'exercise') renderExercise(sheet, c.sim, c.code, c.state);
        else renderCompare(sheet, c.simA, c.simB);
        return;
    }

    sheet.classList.add('hidden');
    timeline.show(true);
    const { sim, ctx, curState, curInterState, numInterStates } = c;
    let snap = sim.states[curState];
    let message;
    if (numInterStates[curState] > 0 && curInterState < numInterStates[curState]) {
        [message, snap] = sim.interStates[curState][curInterState];
    } else if (curState === 0) {
        message = t('ui.initialState');
    } else if (curState === sim.states.length - 1) {
        message = sim.finished
            ? t('ui.finished', { n: sim.stats.instructions, cycles: sim.stats.cycles, ipc: sim.stats.ipc.toFixed(2) })
            : sim.warnings.join(' ');
    } else {
        message = t('ui.endOfCycle', { n: curState });
    }

    viewport.show();
    diagram.render(diagramEl, ctx, snap);
    if (!c.fitted) {
        viewport.fit();
        c.fitted = true;
    }
    timeline.update(sim, curState, snap.seq);
    controller.show();
    controller.updateInfo(curState, curInterState, c.numStates, numInterStates, message);
});

controller.addEventListener('update', () => {
    tabManager.updateContents({ curState: controller.curState, curInterState: controller.curInterState });
});

window.addEventListener('resize', () => {
    const c = tabManager.currentContents();
    if (c?.kind === 'sim') tabManager.updateContents({});
});

// Compartilhamento por link -------------------------------------------------------------------------------

function encodeShare(obj) {
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeShare(s) {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
}

function flash(el, text) {
    const old = el.textContent;
    el.textContent = text;
    setTimeout(() => { el.textContent = old; }, 1500);
}

if (location.hash.startsWith('#s=')) {
    try {
        const { code, config, configB, view } = decodeShare(location.hash.slice(3));
        const r = build(code, config);
        if (r.errors) {
            editor.show(code, config, 'new');
            editor.showErrors(r.errors);
        } else if (view === 'exercise') {
            openExercise(code, config, r.sim, null);
        } else if (view === 'compare' && configB) {
            const b = build(code, configB);
            if (b.sim) openCompare(code, config, configB, r.sim, b.sim);
        } else {
            openSim(code, config, t('ui.shared'), r.sim);
        }
    } catch {
        // link inválido: ignora
    }
}
