/**
 * Primitivas dos diagramas de blocos em SVG (processador vetorial e GPU).
 */
import { esc } from './panels.js';

/** Texto com limite de caracteres (o restante vira reticências). */
export const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
export const tint = (color, pct) => `color-mix(in srgb, ${color} ${pct}%, var(--panel))`;

export function text(x, y, s, cls = '', extra = '') {
    return `<text x="${x}" y="${y}" class="${cls}" ${extra}>${esc(s)}</text>`;
}

export function box(x, y, w, h, cls = '', extra = '') {
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" class="${cls}" ${extra}/>`;
}

/** Seta vertical (para baixo se y2 > y1). */
export function arrow(x, y1, y2, cls = '') {
    const d = y2 > y1 ? -5 : 5;
    return `<path class="wire ${cls}" d="M${x},${y1} L${x},${y2}"/><path class="head ${cls}" d="M${x - 4},${y2 + d} L${x},${y2} L${x + 4},${y2 + d} Z"/>`;
}

