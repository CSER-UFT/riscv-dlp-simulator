/**
 * Memória endereçável por byte, esparsa e little-endian: um Map<bigint, number> (endereço -> byte) ou uma
 * PagedMemory com a mesma interface. Posições nunca escritas valem zero.
 */
import { signed, unsigned, f32ToBits, bitsToF32, f64ToBits, bitsToF64 } from './bits.js';

const PAGE_BITS = 7n;
let nextOwner = 1;

/**
 * Memória paginada com cópia na escrita, usada pelos modelos temporais. fork() devolve uma cópia que
 * compartilha as páginas com a original; uma página só é duplicada quando uma das cópias escreve nela.
 * Assim cada instantâneo da simulação guarda só as páginas que mudaram, e copiar a memória custa o número
 * de páginas, não o de bytes. A interface de leitura é a de um Map (get, has, keys, entries, size e
 * iteração), em ordem de página e de escrita.
 */
export class PagedMemory {
    constructor(source = null) {
        this.owner = nextOwner++;
        this.pages = new Map();
        this.size = 0;
        if (source) for (const [a, v] of source) this.set(a, v);
    }

    static from(mem) {
        return mem instanceof PagedMemory ? mem.fork() : new PagedMemory(mem);
    }

    fork() {
        const m = new PagedMemory();
        m.pages = new Map(this.pages);
        m.size = this.size;
        // As páginas atuais passam a ser compartilhadas: a próxima escrita em qualquer das duas cópias duplica.
        this.owner = nextOwner++;
        return m;
    }

    get(addr) {
        return this.pages.get(addr >> PAGE_BITS)?.bytes.get(addr);
    }

    has(addr) {
        return this.pages.get(addr >> PAGE_BITS)?.bytes.has(addr) ?? false;
    }

    set(addr, value) {
        const k = addr >> PAGE_BITS;
        let p = this.pages.get(k);
        if (!p) {
            p = { owner: this.owner, bytes: new Map() };
            this.pages.set(k, p);
        } else if (p.owner !== this.owner) {
            p = { owner: this.owner, bytes: new Map(p.bytes) };
            this.pages.set(k, p);
        }
        if (!p.bytes.has(addr)) this.size++;
        p.bytes.set(addr, value);
        return this;
    }

    *keys() {
        for (const p of this.pages.values()) yield* p.bytes.keys();
    }

    *entries() {
        for (const p of this.pages.values()) yield* p.bytes.entries();
    }

    [Symbol.iterator]() {
        return this.entries();
    }

    forEach(fn) {
        for (const [k, v] of this.entries()) fn(v, k, this);
    }
}

/** Cópia de uma memória para escrita: barata para PagedMemory, completa para um Map. */
export const forkMem = (mem) => (mem instanceof PagedMemory ? mem.fork() : new Map(mem));

/** Lê `size` bytes a partir de `addr` como inteiro sem sinal. */
export function readRaw(mem, addr, size) {
    let v = 0n;
    for (let i = size - 1; i >= 0; i--)
        v = (v << 8n) | BigInt(mem.get(addr + BigInt(i)) ?? 0);
    return v;
}

/** Escreve os `size` bytes menos significativos de `value` a partir de `addr`. */
export function writeRaw(mem, addr, size, value) {
    let v = unsigned(value, size * 8);
    for (let i = 0; i < size; i++) {
        mem.set(addr + BigInt(i), Number(v & 0xffn));
        v >>= 8n;
    }
}

/**
 * Lê um valor conforme a especificação de acesso de uma instrução de load.
 * @param {Map<bigint, number>} mem
 * @param {bigint} addr
 * @param {{size:number, signed:boolean, fp:string|null}} spec
 * @param {number} xlen
 */
export function load(mem, addr, spec, xlen) {
    const raw = readRaw(mem, addr, spec.size);
    if (spec.fp === 's')
        return bitsToF32(raw);
    if (spec.fp === 'd')
        return bitsToF64(raw);
    const v = spec.signed ? signed(raw, spec.size * 8) : raw;
    return signed(v, xlen);
}

/**
 * Escreve um valor conforme a especificação de acesso de uma instrução de store.
 */
export function store(mem, addr, spec, value) {
    let raw;
    if (spec.fp === 's')
        raw = f32ToBits(value);
    else if (spec.fp === 'd')
        raw = f64ToBits(value);
    else
        raw = BigInt(value);
    writeRaw(mem, addr, spec.size, raw);
}

/** Verdadeiro se os intervalos [a, a+sa) e [b, b+sb) se sobrepõem. */
export function overlaps(a, sa, b, sb) {
    return a < b + BigInt(sb) && b < a + BigInt(sa);
}

/**
 * Agrupa os bytes escritos em palavras alinhadas, para exibição.
 * @returns {{addr: bigint, raw: bigint}[]}
 */
export function words(mem, wordSize = 4) {
    const bases = new Set();
    const ws = BigInt(wordSize);
    for (const addr of mem.keys())
        bases.add(addr - (addr % ws));
    return [...bases]
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
        .map((addr) => ({ addr, raw: readRaw(mem, addr, wordSize) }));
}
