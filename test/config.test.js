import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, checkProgram, DEFAULT_CONFIG } from '../js/core/config.js';
import { simulate } from '../js/simulator.js';
import { asm } from './helpers.js';

test('configuração padrão é válida', () => {
    const { config, errors } = normalizeConfig({});
    assert.deepEqual(errors, []);
    assert.equal(config.vector.lanes, DEFAULT_CONFIG.vector.lanes);
    assert.equal(config.vector.units.length, 4);
});

test('valores fora do intervalo voltam ao padrão e erros são apontados', () => {
    const { config } = normalizeConfig({ vector: { lanes: 0, vlen: 9999 }, freqGHz: -1 });
    assert.equal(config.vector.lanes, DEFAULT_CONFIG.vector.lanes);
    assert.equal(config.vector.vlen, DEFAULT_CONFIG.vector.vlen);
    assert.equal(config.freqGHz, DEFAULT_CONFIG.freqGHz);
    assert.equal(normalizeConfig({ vector: { vlen: 384 } }).errors.length, 1);
    assert.equal(normalizeConfig({ vector: { units: [] } }).errors.length, 1);
    assert.equal(normalizeConfig({ vector: { units: [{ name: 'A', classes: ['valu'] }, { name: 'A', classes: ['vload'] }] } }).errors.length, 1);
    assert.equal(normalizeConfig({ vector: { units: [{ name: 'A', classes: [] }] } }).errors.length, 1);
});

test('classes sem unidade são apontadas com a linha', () => {
    const program = asm('vsetivli zero, 4, e32, m1, ta, ma\nvdiv.vv v1, v2, v3');
    const config = normalizeConfig({ vector: { units: [{ name: 'A', classes: ['valu'] }] } }).config;
    const errors = checkProgram(program, config);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /linha 2/);
    assert.equal(simulate(program, { vector: { units: [{ name: 'A', classes: ['valu'] }] } }).errors.length, 1);
});

test('tempo de execução = ciclos ÷ frequência', () => {
    const sim = simulate(asm('addi a0, a0, 1\naddi a0, a0, 1'), { freqGHz: 2, trace: false });
    assert.equal(sim.timing.timeNs, sim.stats.cycles / 2);
});

test('processador vetorial: no máximo 8 lanes', () => {
    assert.equal(normalizeConfig({ vector: { lanes: 8 } }).config.vector.lanes, 8);
    assert.equal(normalizeConfig({ vector: { lanes: 16 } }).config.vector.lanes, 8);
    assert.equal(normalizeConfig({ vector: { lanes: 3 } }).config.vector.lanes, 3);
});
