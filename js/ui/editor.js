/**
 * Janela de simulação: editor de código com destaque de sintaxe, numeração de linhas e lista de erros, e o
 * formulário de configuração do processador.
 */
import { EXAMPLES, exampleName } from '../examples.js';
import { t } from '../i18n/index.js';
import { DEFAULT_CONFIG, MODE_IDS, SCALAR_LATENCY_IDS, VECTOR_LATENCY_IDS, className, normalizeConfig } from '../core/config.js';
import { highlight } from './highlight.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c]);
const clone = (o) => JSON.parse(JSON.stringify(o));

export class Editor {

    /**
     * @param {(code: string, config: object, name: string|null, purpose: string) => Array} onSubmit executa a
     *        simulação e retorna a lista de erros (vazia em caso de sucesso)
     */
    constructor(onSubmit) {
        this.onSubmit = onSubmit;
        this.purpose = 'new';
        this.modal = document.getElementById('md-novo');
        this.title = this.modal.querySelector('h1');
        this.template = document.getElementById('novo-template');
        this.code = document.getElementById('novo-code');
        this.gutter = document.getElementById('novo-gutter');
        this.hl = document.getElementById('novo-highlight');
        this.errors = document.getElementById('novo-errors');
        this.configEl = document.getElementById('novo-config');
        this.submitButton = document.getElementById('novo-submit');
        this.exampleId = null;
        this.errorLines = new Set();

        this.modal.addEventListener('mousedown', (e) => { if (e.target === this.modal) this.hide(); });
        document.getElementById('close-novo').addEventListener('click', () => this.hide());
        this.submitButton.addEventListener('click', () => this.submit());
        document.getElementById('novo-reset').addEventListener('click', () => this.setConfig(DEFAULT_CONFIG));
        this.code.addEventListener('input', () => {
            this.template.value = '';
            this.exampleId = null;
            this.errorLines = new Set();
            this.refresh();
        });
        this.code.addEventListener('scroll', () => this.syncScroll());
        this.code.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') {
                e.preventDefault();
                const { selectionStart: a, selectionEnd: b, value } = this.code;
                this.code.value = value.slice(0, a) + '    ' + value.slice(b);
                this.code.selectionStart = this.code.selectionEnd = a + 4;
                this.refresh();
            } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                this.submit();
            }
        });
        this.template.addEventListener('change', () => {
            const ex = EXAMPLES.find((x) => x.id === this.template.value);
            if (ex) this.loadExample(ex);
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.visible()) this.hide();
        });

        this.translate();
        this.setConfig(loadStored('dlp.config') ?? DEFAULT_CONFIG);
        const storedCode = loadStored('dlp.code');
        if (storedCode) {
            this.code.value = storedCode;
            this.refresh();
        } else {
            this.loadExample(EXAMPLES[0]);
        }
    }

    /** Atualiza os textos que dependem do idioma. */
    translate() {
        const current = this.template.value;
        this.template.innerHTML = `<option value="">${t('ed.ownProgram')}</option>` +
            EXAMPLES.map((e) => `<option value="${e.id}">${esc(exampleName(e))}</option>`).join('');
        this.template.value = current;
        if (this.configEl.firstChild) this.setConfig(this.readConfig());
    }

    visible() {
        return this.modal.classList.contains('visible');
    }

    /**
     * Abre a janela.
     * @param {string|null} code código inicial (null mantém o atual)
     * @param {object|null} config configuração inicial (null mantém a atual)
     * @param {'new'|'edit'|'compare'} purpose
     */
    show(code = null, config = null, purpose = 'new') {
        this.purpose = purpose;
        this.title.textContent = t(`ed.title.${purpose}`);
        this.submitButton.textContent = t(purpose === 'compare' ? 'ed.compareRun' : 'ed.run');
        if (code !== null) {
            this.code.value = code;
            this.template.value = '';
            this.exampleId = null;
        }
        if (config !== null) this.setConfig(config);
        this.code.readOnly = purpose === 'compare';
        this.template.disabled = purpose === 'compare';
        this.showErrors([]);
        this.modal.classList.add('visible');
        (purpose === 'compare' ? this.configEl.querySelector('input, select') : this.code).focus();
    }

    hide() {
        this.modal.classList.remove('visible');
    }

    loadExample(ex) {
        this.template.value = ex.id;
        this.exampleId = ex.id;
        this.code.value = ex.code;
        if (ex.config) {
            const cur = this.readConfig();
            const merged = { ...cur, ...ex.config };
            // A seção do modelo do exemplo volta ao padrão antes dos ajustes do exemplo, para que ajustes de
            // outro exemplo (por exemplo, o número de blocos) não fiquem para trás.
            for (const k of ['vector', 'tpu', 'gpu']) {
                if (k === ex.config.mode) merged[k] = { ...clone(DEFAULT_CONFIG[k]), ...(ex.config[k] ?? {}) };
                else if (ex.config[k]) merged[k] = { ...cur[k], ...ex.config[k] };
            }
            this.setConfig(merged);
        }
        this.showErrors([]);
    }

    refresh() {
        const n = this.code.value.split('\n').length;
        let out = '';
        for (let i = 1; i <= n; i++)
            out += this.errorLines.has(i) ? `<span class="err">${i}</span>\n` : `${i}\n`;
        this.gutter.innerHTML = out;
        this.hl.innerHTML = highlight(this.code.value, this.errorLines);
        this.syncScroll();
    }

    syncScroll() {
        this.gutter.scrollTop = this.code.scrollTop;
        this.hl.scrollTop = this.code.scrollTop;
        this.hl.scrollLeft = this.code.scrollLeft;
    }

    /** Exibe erros; cada erro é uma string ou um objeto {line, message}. */
    showErrors(errors) {
        this.errorLines = new Set(errors.filter((e) => typeof e === 'object').map((e) => e.line));
        this.refresh();
        this.errors.innerHTML = errors.map((e) => typeof e === 'object'
            ? `<li data-line="${e.line}"><strong>${t('ed.line', { n: e.line })}:</strong> ${esc(e.message)}</li>`
            : `<li><strong>${t('ed.configuration')}:</strong> ${formatInline(e)}</li>`).join('');
        for (const li of this.errors.querySelectorAll('li[data-line]'))
            li.addEventListener('click', () => this.goToLine(Number(li.dataset.line)));
    }

    goToLine(line) {
        const lines = this.code.value.split('\n');
        const start = lines.slice(0, line - 1).reduce((acc, l) => acc + l.length + 1, 0);
        this.code.focus();
        this.code.setSelectionRange(start, start + (lines[line - 1]?.length ?? 0));
        const lh = parseFloat(getComputedStyle(this.code).lineHeight) || 20;
        this.code.scrollTop = Math.max(0, (line - 4) * lh);
        this.syncScroll();
    }

    submit() {
        const config = this.readConfig();
        const code = this.code.value;
        const ex = EXAMPLES.find((x) => x.id === this.exampleId);
        const errors = this.onSubmit(code, config, ex ? exampleName(ex) : null, this.purpose);
        if (errors.length > 0) {
            this.showErrors(errors);
            return;
        }
        if (this.purpose !== 'compare') {
            store('dlp.config', config);
            store('dlp.code', code);
        }
        this.hide();
    }

    // Formulário de configuração ---------------------------------------------------------------------------

    setConfig(config) {
        const c = normalizeConfig(config).config;
        // Mantém o que foi digitado mesmo se inválido (por exemplo, unidades sem nome), para o aluno corrigir.
        if (Array.isArray(config.vector?.units)) c.vector.units = clone(config.vector.units);
        const opt = (pairs, cur) => pairs.map(([k, v]) => `<option value="${k}" ${String(k) === String(cur) ? 'selected' : ''}>${esc(v)}</option>`).join('');
        const num = (name, value, min, max, label, cls = '') =>
            `<label class="field ${cls}">${label}<input type="number" name="${name}" value="${value}" min="${min}" max="${max}" step="any" /></label>`;
        const check = (name, value, label, cls = '') =>
            `<label class="field check ${cls}"><input type="checkbox" name="${name}" ${value ? 'checked' : ''} />${label}</label>`;
        const lat = (ids) => ids.map((k) => `<label class="field small"><span>${esc(className(k))}</span><input type="number" name="lat-${k}" value="${c.latency[k]}" min="1" max="100" /></label>`).join('');
        const units = c.vector.units.map((u) => this.unitRow(u)).join('');

        this.configEl.innerHTML = `
            <fieldset><legend>${t('ed.processor')}</legend>
                <label class="field">${t('ed.model')}<select name="mode">${opt(MODE_IDS.map((m) => [m, t(`mode.${m}`)]), c.mode)}</select></label>
                <label class="field">XLEN<select name="xlen">${opt([[32, 'RV32 (32 bits)'], [64, 'RV64 (64 bits)']], c.xlen)}</select></label>
                <label class="field vec-only">VLEN<select name="vlen">${opt([64, 128, 256, 512, 1024].map((v) => [v, t('ed.vlenOption', { v, n: v / 32 })]), c.vector.vlen)}</select></label>
                ${num('lanes', c.vector.lanes, 1, 64, t('ed.lanes'), 'vec-only')}
                ${check('chaining', c.vector.chaining, t('ed.chaining'), 'vec-only')}
                ${num('stridedRate', c.vector.stridedRate, 1, 64, t('ed.stridedRate'), 'vec-only')}
                ${num('gpuWarps', c.gpu.warps, 1, 16, t('ed.gpuWarpsBlock'), 'gpu-only')}
                ${num('gpuWarpSize', c.gpu.warpSize, 1, 32, t('ed.gpuWarpSize'), 'gpu-only')}
                ${num('gpuLanes', c.gpu.lanes, 1, 32, t('ed.gpuLanes'), 'gpu-only')}
                <label class="field gpu-only">${t('ed.gpuScheduler')}<select name="gpuScheduler">${opt([['rr', t('ui.gpu.policy.rr')], ['gto', t('ui.gpu.policy.gto')]], c.gpu.scheduler)}</select></label>
                ${num('gpuMem', c.gpu.memLatency, 1, 400, t('ed.gpuMem'), 'gpu-only')}
                <label class="field gpu-only">${t('ed.gpuLine')}<select name="gpuLine">${opt([4, 8, 16, 32, 64, 128].map((b) => [b, `${b} B`]), c.gpu.lineBytes)}</select></label>
                ${num('tpuN', c.tpu.n, 2, 16, t('ed.tpuN'), 'tpu-only')}
                ${num('tpuUb', c.tpu.ubRows, 1, 256, t('ed.tpuUb'), 'tpu-only')}
                ${num('tpuAcc', c.tpu.accRows, 1, 256, t('ed.tpuAcc'), 'tpu-only')}
                ${num('tpuFifo', c.tpu.fifoDepth, 1, 8, t('ed.tpuFifo'), 'tpu-only')}
                ${num('tpuMem', c.tpu.memLatency, 1, 100, t('ed.tpuMem'), 'tpu-only')}
                ${num('tpuAct', c.tpu.actLatency, 1, 20, t('ed.tpuAct'), 'tpu-only')}
                ${num('branchPenalty', c.branchPenalty, 0, 20, t('ed.branchPenalty'), 'not-gpu')}
            </fieldset>
            <fieldset class="gpu-only"><legend>${t('ed.gpuGrid')}</legend>
                ${num('gpuBlocks', c.gpu.blocks, 1, 256, t('ed.gpuBlocks'))}
                ${num('gpuMaxWarps', c.gpu.maxWarps, 1, 64, t('ed.gpuMaxWarps'))}
                ${num('gpuSmem', c.gpu.smemBytes, 0, 65536, t('ed.gpuSmem'))}
                <label class="field">${t('ed.gpuBanks')}<select name="gpuBanks">${opt([1, 2, 4, 8, 16, 32].map((b) => [b, b]), c.gpu.smemBanks)}</select></label>
                ${num('gpuSmemLat', c.gpu.smemLatency, 1, 100, t('ed.gpuSmemLat'))}
                ${check('gpuL1', c.gpu.l1, t('ed.gpuL1'))}
                <label class="field">${t('ed.gpuL1Bytes')}<select name="gpuL1Bytes">${opt([64, 128, 256, 512, 1024, 2048, 4096].map((b) => [b, `${b} B`]), c.gpu.l1Bytes)}</select></label>
                <label class="field">${t('ed.gpuL1Ways')}<select name="gpuL1Ways">${opt([1, 2, 4, 8].map((b) => [b, b]), c.gpu.l1Ways)}</select></label>
                ${num('gpuL1Lat', c.gpu.l1Latency, 1, 100, t('ed.gpuL1Lat'))}
                <p class="note">${t('ed.gpuGridHelp')}</p>
            </fieldset>
            <fieldset class="vec-only"><legend>${t('ed.units')}</legend>
                <table class="groups"><tr><th>${t('ed.unit')}</th><th>${t('ed.classes')}</th><th>${t('ed.pipelined')}</th><th></th></tr>${units}</table>
                <button type="button" class="btn small" data-action="add-unit">${t('ed.addUnit')}</button>
                <p class="note">${t('ed.unitsHelp')}</p>
            </fieldset>
            <fieldset class="vec-only"><legend>${t('ed.vectorLatencies')}</legend><div class="latencies">${lat(VECTOR_LATENCY_IDS)}</div>
                <p class="note">${t('ed.vectorLatHelp')}</p></fieldset>
            <fieldset><legend>${t('ed.scalarLatencies')}</legend><div class="latencies">${lat(SCALAR_LATENCY_IDS)}</div></fieldset>
            <fieldset><legend>${t('ed.simulation')}</legend>
                ${num('freqGHz', c.freqGHz, 0.001, 100, t('ed.freqGHz'))}
                ${num('maxCycles', c.maxCycles, 1, 100000, t('ed.maxCycles'))}
                ${check('exampleValues', c.exampleValues, t('ed.exampleValues'))}
            </fieldset>`;

        this.configEl.querySelector('[data-action="add-unit"]').addEventListener('click', () => {
            const table = this.configEl.querySelector('table.groups');
            table.insertAdjacentHTML('beforeend', this.unitRow({ name: `U${table.rows.length}`, classes: [], pipelined: true }));
            this.bindUnitRows();
        });
        this.bindUnitRows();
        this.configEl.querySelector('select[name="mode"]').addEventListener('change', () => this.updateModeFields());
        this.updateModeFields();
    }

    /** Mostra só os campos do modelo escolhido. */
    updateModeFields() {
        const mode = this.configEl.querySelector('select[name="mode"]').value;
        for (const el of this.configEl.querySelectorAll('.vec-only')) el.classList.toggle('hidden', mode !== 'vector');
        for (const el of this.configEl.querySelectorAll('.tpu-only')) el.classList.toggle('hidden', mode !== 'tpu');
        for (const el of this.configEl.querySelectorAll('.gpu-only')) el.classList.toggle('hidden', mode !== 'gpu');
        for (const el of this.configEl.querySelectorAll('.not-gpu')) el.classList.toggle('hidden', mode === 'gpu');
    }

    unitRow(u) {
        const checks = VECTOR_LATENCY_IDS.map((cls) =>
            `<label title="${esc(className(cls))}"><input type="checkbox" value="${cls}" ${u.classes.includes(cls) ? 'checked' : ''} />${esc(t(`classShort.${cls}`))}</label>`).join('');
        return `<tr class="group"><td><input type="text" name="u-name" value="${esc(u.name)}" size="6" /></td>
            <td class="classes">${checks}</td>
            <td><input type="checkbox" name="u-pipelined" ${u.pipelined !== false ? 'checked' : ''} title="${esc(t('ed.pipelinedHelp'))}" /></td>
            <td><button type="button" class="btn small" data-action="remove" title="${esc(t('ed.removeUnit'))}">${t('ed.remove')}</button></td></tr>`;
    }

    bindUnitRows() {
        for (const btn of this.configEl.querySelectorAll('[data-action="remove"]'))
            btn.onclick = () => btn.closest('tr').remove();
    }

    readConfig() {
        const get = (name) => this.configEl.querySelector(`[name="${name}"]`);
        if (!get('mode')) return clone(DEFAULT_CONFIG);
        const n = (name) => Number(get(name).value);
        const c = {
            mode: get('mode').value,
            xlen: n('xlen'),
            maxCycles: n('maxCycles'),
            exampleValues: get('exampleValues').checked,
            freqGHz: n('freqGHz'),
            branchPenalty: n('branchPenalty'),
            vector: {
                vlen: n('vlen'),
                lanes: n('lanes'),
                chaining: get('chaining').checked,
                stridedRate: n('stridedRate'),
                units: [...this.configEl.querySelectorAll('tr.group')].map((row) => ({
                    name: row.querySelector('[name="u-name"]').value,
                    pipelined: row.querySelector('[name="u-pipelined"]').checked,
                    classes: [...row.querySelectorAll('.classes input:checked')].map((i) => i.value),
                })),
            },
            gpu: {
                warps: n('gpuWarps'), warpSize: n('gpuWarpSize'), lanes: n('gpuLanes'), scheduler: get('gpuScheduler').value,
                memLatency: n('gpuMem'), lineBytes: n('gpuLine'), blocks: n('gpuBlocks'), maxWarps: n('gpuMaxWarps'),
                smemBytes: n('gpuSmem'), smemBanks: n('gpuBanks'), smemLatency: n('gpuSmemLat'), l1: get('gpuL1').checked,
                l1Bytes: n('gpuL1Bytes'), l1Ways: n('gpuL1Ways'), l1Latency: n('gpuL1Lat'),
            },
            tpu: {
                n: n('tpuN'), ubRows: n('tpuUb'), accRows: n('tpuAcc'), fifoDepth: n('tpuFifo'),
                memLatency: n('tpuMem'), actLatency: n('tpuAct'),
            },
            latency: {},
        };
        for (const k of [...SCALAR_LATENCY_IDS, ...VECTOR_LATENCY_IDS])
            c.latency[k] = n(`lat-${k}`);
        return c;
    }
}

function formatInline(s) {
    return esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');
}

export function loadStored(key) {
    try {
        const v = localStorage.getItem(key);
        return v === null ? null : JSON.parse(v);
    } catch {
        return null;
    }
}

export function store(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // armazenamento indisponível (modo privado): apenas não persiste
    }
}
