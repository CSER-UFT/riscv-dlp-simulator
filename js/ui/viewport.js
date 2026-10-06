/**
 * Área do diagrama com arrastar para mover, roda do mouse para ampliar e duplo clique para restaurar.
 */
export class Viewport {

    constructor(viewportId, contentId) {
        this.el = document.getElementById(viewportId);
        this.content = document.getElementById(contentId);
        this.scale = 1;
        this.x = 12;
        this.y = 12;
        this.drag = null;

        this.el.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            this.drag = { x: e.clientX - this.x, y: e.clientY - this.y };
            this.el.classList.add('dragging');
        });
        window.addEventListener('mousemove', (e) => {
            if (!this.drag) return;
            this.x = e.clientX - this.drag.x;
            this.y = e.clientY - this.drag.y;
            this.apply();
        });
        window.addEventListener('mouseup', () => {
            this.drag = null;
            this.el.classList.remove('dragging');
        });
        this.el.addEventListener('wheel', (e) => {
            e.preventDefault();
            const rect = this.el.getBoundingClientRect();
            const px = e.clientX - rect.left, py = e.clientY - rect.top;
            const next = Math.min(2.5, Math.max(0.3, this.scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
            this.x = px - ((px - this.x) * next) / this.scale;
            this.y = py - ((py - this.y) * next) / this.scale;
            this.scale = next;
            this.apply();
        }, { passive: false });
        this.el.addEventListener('dblclick', () => this.fit());

        // Toque: arrastar com um dedo
        this.el.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 1) return;
            const t = e.touches[0];
            this.drag = { x: t.clientX - this.x, y: t.clientY - this.y };
        }, { passive: true });
        this.el.addEventListener('touchmove', (e) => {
            if (!this.drag || e.touches.length !== 1) return;
            const t = e.touches[0];
            this.x = t.clientX - this.drag.x;
            this.y = t.clientY - this.drag.y;
            this.apply();
        }, { passive: true });
        this.el.addEventListener('touchend', () => { this.drag = null; });
    }

    apply() {
        this.content.style.transform = `translate(${this.x}px, ${this.y}px) scale(${this.scale})`;
    }

    /** Ajusta a escala para o diagrama caber na largura disponível. */
    fit() {
        const w = this.content.scrollWidth, h = this.content.scrollHeight;
        const W = this.el.clientWidth - 24, H = this.el.clientHeight - 80;
        if (w === 0 || h === 0) return;
        // Prioriza a legibilidade: reduz no máximo até 85%; o restante é acessível arrastando o diagrama.
        this.scale = Math.max(0.85, Math.min(1, W / w, H / h));
        this.x = 12;
        this.y = 12;
        this.apply();
    }

    show() { this.el.classList.add('visible'); }
    hide() { this.el.classList.remove('visible'); }
}
