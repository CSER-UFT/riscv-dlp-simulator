/**
 * Testes com programas aleatórios: para cada programa gerado, o estado final do modelo vetorial deve ser
 * idêntico ao do simulador funcional de referência, em todas as configurações de hardware, e as regras de
 * tempo (RAW com e sem encadeamento, WAR, WAW, ordem da memória e ocupação das unidades) devem valer.
 */
import { test } from 'node:test';
import { asm, CONFIGS, assertMatchesReference } from './helpers.js';
import { generate } from './generator.js';

test('programas aleatórios: modelo = referência em todas as configurações', () => {
    const N = Number(process.env.RANDOM_PROGRAMS ?? 80);
    for (let seed = 1; seed <= N; seed++) {
        const src = generate(seed);
        const program = asm(src);
        for (const [cname, config] of Object.entries(CONFIGS)) {
            try {
                assertMatchesReference(program, { ...config, trace: false }, `semente ${seed} / ${cname}`);
            } catch (e) {
                e.message += `\n--- programa (semente ${seed}) ---\n${src}`;
                throw e;
            }
        }
    }
});
