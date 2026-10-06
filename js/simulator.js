/**
 * Ponto de entrada da simulação: escolhe o modelo conforme a configuração e acrescenta o tempo de execução.
 */
import { normalizeConfig } from './core/config.js';
import { simulateVector } from './models/vector.js';

/**
 * @param {object} program resultado de assemble()
 * @param {object} config configuração (parcial)
 */
export function simulate(program, config = {}) {
    normalizeConfig(config);
    const sim = simulateVector(program, config);
    if (sim.errors.length > 0) return sim;
    const periodPs = 1000 / sim.config.freqGHz;
    sim.timing = { periodPs, freqGHz: sim.config.freqGHz, timeNs: (sim.stats.cycles * periodPs) / 1000 };
    return sim;
}
