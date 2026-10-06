/**
 * Renderização do estado: escolhe o diagrama conforme o modelo simulado.
 */
import { renderVector } from './diagram-vector.js';
import { renderTpu } from './diagram-tpu.js';

export { createContext } from './panels.js';

export function render(el, ctx, snap) {
    el.dataset.model = ctx.sim.model;
    if (ctx.sim.model === 'tpu') return renderTpu(el, ctx, snap);
    return renderVector(el, ctx, snap);
}
