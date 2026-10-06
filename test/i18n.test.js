import { test } from 'node:test';
import assert from 'node:assert/strict';
import pt from '../js/i18n/pt.js';
import en from '../js/i18n/en.js';

const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('dicionários de português e inglês têm as mesmas chaves e os mesmos parâmetros', () => {
    assert.deepEqual(Object.keys(en).sort(), Object.keys(pt).sort());
    for (const k of Object.keys(pt))
        assert.equal(placeholders(en[k]), placeholders(pt[k]), `parâmetros diferentes em ${k}`);
});

test('toda chave usada no código existe no dicionário', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const files = [];
    const walk = (dir) => {
        for (const f of fs.readdirSync(dir)) {
            const p = path.join(dir, f);
            if (fs.statSync(p).isDirectory()) walk(p);
            else if (p.endsWith('.js') && !p.includes(`${path.sep}i18n${path.sep}`) && !p.includes(`${path.sep}help${path.sep}`)) files.push(p);
        }
    };
    walk('js');
    const keys = new Set();
    for (const f of files) {
        const src = fs.readFileSync(f, 'utf8');
        for (const m of src.matchAll(/\bt\(\s*'([\w.]+)'/g)) keys.add(m[1]);
        for (const m of src.matchAll(/'((?:vec|ui|ed|cmp|stats|summary|config|asm|ex|ev|tl|mode|class|classShort|export|common)\.[\w.]+)'/g)) keys.add(m[1]);
    }
    for (const html of [fs.readFileSync('index.html', 'utf8')])
        for (const m of html.matchAll(/data-i18n(?:-html|-title)?="([\w.]+)"/g)) keys.add(m[1]);
    for (const cls of ['alu', 'mul', 'div', 'branch', 'jump', 'load', 'store', 'fadd', 'fmul', 'fdiv', 'system', 'vset', 'vload', 'vstore', 'valu', 'vmul', 'vdiv', 'vfadd', 'vfmul', 'vfdiv']) keys.add(`class.${cls}`);
    for (const r of ['raw', 'war', 'waw', 'struct', 'scalar', 'mem', 'front']) keys.add(`ui.vec.why.${r}`);
    for (const l of ['Issue', 'Exec', 'Lat', 'Stall']) keys.add(`tl.${l}`);
    for (const st of ['done', 'bar', 'branch', 'busy', 'dep', 'unit', 'ready', 'issued']) keys.add(`ui.gpu.state.${st}`);
    for (const p of ['rr', 'gto']) keys.add(`ui.gpu.policy.${p}`);
    for (const u of ['ALU', 'FPU', 'LSU']) keys.add(`ui.gpu.unit.${u}`);
    for (const u of ['DMA', 'WDMA', 'MXU', 'ACT']) keys.add(`ui.tpu.unit.${u}`);
    for (const f of ['reading', 'ready', 'shifting']) keys.add(`ui.tpu.fifo.${f}`);
    for (const m of ['vector', 'tpu', 'gpu']) { keys.add(`mode.${m}`); keys.add(`mode.short.${m}`); }
    const missing = [...keys].filter((k) => !(k in pt) && !/^(class|classShort)\.$/.test(k));
    assert.deepEqual(missing, []);
});
