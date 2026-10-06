/**
 * Resumo textual da configuração de uma simulação (usado no modo exercício e na comparação).
 */
import { t } from '../i18n/index.js';
import { className, SCALAR_LATENCY_IDS } from '../core/config.js';

export function configSummary(cfg) {
    if (cfg.mode === 'tpu') {
        const tc = cfg.tpu;
        return [
            t('mode.tpu'), `RV${cfg.xlen}`,
            t('summary.tpuArray', { n: tc.n }),
            t('summary.tpuBuffers', { ub: tc.ubRows, acc: tc.accRows, fifo: tc.fifoDepth }),
            t('summary.tpuLat', { mem: tc.memLatency, act: tc.actLatency, mxu: 2 * tc.n - 1 }),
            `${t('summary.scalarLat')}: ${SCALAR_LATENCY_IDS.map((k) => `${className(k)} ${cfg.latency[k]}`).join(', ')}`,
            t('summary.branch', { n: cfg.branchPenalty }),
            t('summary.clock', { f: cfg.freqGHz }),
        ];
    }
    const v = cfg.vector;
    const items = [
        t(`mode.${cfg.mode}`),
        `RV${cfg.xlen}V`,
        t('summary.vector', { vlen: v.vlen, lanes: v.lanes }),
        t(v.chaining ? 'summary.chainOn' : 'summary.chainOff'),
        t('summary.strided', { n: v.stridedRate }),
    ];
    for (const u of v.units) {
        const classes = u.classes.map((c) => `${className(c)} ${cfg.latency[c]}`).join(', ');
        items.push(t(u.pipelined ? 'summary.unit' : 'summary.unitBlocking', { name: u.name, classes }));
    }
    items.push(`${t('summary.scalarLat')}: ${SCALAR_LATENCY_IDS.map((k) => `${className(k)} ${cfg.latency[k]}`).join(', ')}`);
    items.push(t('summary.branch', { n: cfg.branchPenalty }));
    items.push(t('summary.clock', { f: cfg.freqGHz }));
    return items;
}

/** Diferenças entre duas configurações, como lista de {key, a, b}. */
export function configDiff(a, b) {
    const flat = (o, prefix = '', out = {}) => {
        for (const [k, v] of Object.entries(o)) {
            const key = prefix ? `${prefix}.${k}` : k;
            if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, key, out);
            else out[key] = typeof v === 'string' ? v : JSON.stringify(v);
        }
        return out;
    };
    const fa = flat(a), fb = flat(b);
    const keys = [...new Set([...Object.keys(fa), ...Object.keys(fb)])].filter((k) => k !== 'maxCycles');
    return keys.filter((k) => fa[k] !== fb[k]).map((k) => ({ key: k, a: fa[k], b: fb[k] }));
}
