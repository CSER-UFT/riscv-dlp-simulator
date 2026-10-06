/**
 * Tabela de eventos por instrução (o formato clássico de exercícios: em que ciclo cada instrução começou,
 * produziu o primeiro resultado e terminou), usada pelo modo exercício e pelas exportações.
 */
import { t } from '../i18n/index.js';

/** Colunas da tabela de eventos. */
export function eventColumns() {
    return [
        { key: 'issue', label: t('ev.issue') },
        { key: 'first', label: t('ev.first') },
        { key: 'done', label: t('ev.done') },
    ];
}

/**
 * Linhas da tabela de eventos: uma por instrução vetorial executada, em ordem de programa (ou uma por
 * instrução, se o programa não tiver instruções vetoriais).
 */
export function eventRows(sim) {
    const done = sim.dyn.filter((d) => d.issue !== null);
    const vector = done.filter((d) => d.vector);
    return (vector.length > 0 ? vector : done).map((d) => ({
        dyn: d.id, text: d.text, pc: d.pc,
        values: { issue: d.issue, first: d.first, done: d.commit },
    }));
}
