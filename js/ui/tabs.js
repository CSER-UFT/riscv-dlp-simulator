/**
 * Gerencia a criação e remoção de abas de visualização.
 */
export class TabManager extends EventTarget {

    /**
     * @param {string} containerId Id do elemento container de abas.
     * @param {string} fillerId Id do elemento de preenchimento.
     */
    constructor(containerId, fillerId) {
        super();
        this.container = document.getElementById(containerId);
        this.filler = document.getElementById(fillerId);
        this.active = null;
        this.tabContents = {};
        this.tabElements = {};

        // Define eventos
        this.tabSet = new Event('tab-set');
        this.tabUnset = new Event('tab-unset');
    }

    /**
     * Retorna verdadeiro caso a aba indicada exista.
     * @param {string} name Nome identificador da aba.
     */
    contains(name) {
        return (name in this.tabElements);
    }

    /**
     * Adiciona uma nova aba à visualização.
     * @param {string} name Nome identificador da aba.
     * @param {object} contents Conteudo associado a aba.
     */
    add(name, contents) {
        // Cria título
        const title = document.createElement('span');
        title.innerText = name;
        title.addEventListener('click', this.setActive.bind(this, name));

        // Cria botão de fechamento
        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.className = 'close-tab';
        closeButton.setAttribute('aria-label', '×');
        closeButton.innerHTML = '<span class="icon i-close" aria-hidden="true"></span>';
        closeButton.addEventListener('click', this.remove.bind(this, name));

        // Agrupa elementos de aba
        const tab = document.createElement('div');
        tab.className = 'tab';
        tab.appendChild(title);
        tab.appendChild(closeButton);
        this.container.insertBefore(tab, this.filler);

        // Adiciona aba e seu conteudo, e a coloca como ativa
        this.tabContents[name] = contents;
        this.tabElements[name] = tab;
        this.setActive(name);
    }

    /**
     * Remove uma aba.
     * @param {string} name Nome identificador da aba.
     */
    remove(name) {
        if (!this.contains(name))
            return;

        // Remove elementos de aba
        this.tabElements[name].remove();
        delete this.tabElements[name];
        delete this.tabContents[name];

        // Limpa e atualiza a visualização
        // this.clearFn();
        this.dispatchEvent(this.tabUnset);
        const tabNames = Object.keys(this.tabElements);
        if (tabNames.length > 0)
            this.setActive(tabNames[0]);
    }

    /**
     * Define uma aba como ativa, ocultando todas as outras.
     * @param {string} name Nome identificador da aba.
     */
    setActive(name) {
        if (!this.contains(name))
            return;

        // Limpa a visualização
        this.dispatchEvent(this.tabUnset);

        // Ativa uma aba e oculta as demais
        this.active = name;
        for (let n in this.tabElements) {
            const tab = this.tabElements[n];
            if (n === name && tab.className.split(' ').indexOf('active') === -1)
                tab.className += ' active';
            else if (n !== name)
                tab.className = tab.className.replace(/\bactive\b/g, '');
        }

        // Atualiza a visualização
        this.dispatchEvent(this.tabSet);
    }

    /**
     * Atualiza os conteudos associados a aba ativa.
     * @param {object} props Propriedades a serem atualizadas.
     */
    updateContents(props) {
        const name = this.active;
        if (!this.contains(name))
            return;

        for (let prop in props)
            this.tabContents[name][prop] = props[prop];

        // Limpa e atualiza a visualização
        this.dispatchEvent(this.tabUnset);
        this.dispatchEvent(this.tabSet);
    }

    /**
     * Retorna os conteudos associados a aba ativa, caso alguma exista.
     */
    currentContents() {
        if (this.active === null || !this.contains(this.active))
            return null;
        return this.tabContents[this.active];
    }

}
