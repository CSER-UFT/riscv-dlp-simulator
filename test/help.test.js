import { test } from 'node:test';
import assert from 'node:assert/strict';
import pt from '../js/help/pt.js';
import en from '../js/help/en.js';

test('a ajuda tem as mesmas seções nos dois idiomas', () => {
    assert.deepEqual(en.sections.map((s) => s.id), pt.sections.map((s) => s.id));
});

test('as ligações internas da ajuda apontam para seções existentes', () => {
    for (const help of [pt, en]) {
        const ids = new Set(help.sections.map((s) => s.id));
        for (const s of help.sections)
            for (const [, target] of s.html.matchAll(/href="#h-([\w]+)"/g))
                assert.ok(ids.has(target), `${s.id} aponta para #h-${target}`);
    }
});

test('a ajuda não usa travessões', () => {
    for (const help of [pt, en])
        for (const s of help.sections)
            assert.doesNotMatch(s.html, /[–—]/, `travessão na seção ${s.id}`);
});
