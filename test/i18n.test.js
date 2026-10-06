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
    const missing = [...keys].filter((k) => !(k in pt) && !/^(class|classShort)\.$/.test(k));
    assert.deepEqual(missing, []);
});
