/**
 * Painéis comuns: registradores escalares, memória e estatísticas.
 */
import * as fmt from '../riscv/format.js';
import * as regs from '../riscv/registers.js';
import { words } from '../riscv/memory.js';
import { t } from '../i18n/index.js';

/**
 * Cores das instruções em andamento. A interface mistura cada cor com o fundo do tema (claro ou escuro) via
 * CSS, a partir da variável --tag.
 */
export const COLORS = ['#5b6ee1', '#2f9e6e', '#d1495b', '#1f8fb3', '#b38a00', '#9a5bc4', '#14a39a', '#d9792b', '#6b7a99', '#c2558f'];

/** Cores das lanes (faixas sobre os elementos dos registradores vetoriais). */
export const LANE_COLORS = ['#5b6ee1', '#2f9e6e', '#d9792b', '#9a5bc4', '#1f8fb3', '#c2558f', '#b38a00', '#14a39a'];

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c]);

export const dynColor = (id) => COLORS[id % COLORS.length];
export const laneColor = (lane) => LANE_COLORS[lane % LANE_COLORS.length];

/** Contexto de renderização calculado uma vez por simulação. */
export function createContext(sim) {
    const used = new Set(['x2']);
    const vused = new Set();
    const fpRegs = new Set(), maskRegs = new Set();
    // Com LMUL maior que 1, os operandos vetoriais são grupos de registradores: mostra o grupo inteiro.
    const maxLmul = Math.max(1, ...sim.program.instructions.map((i) => i.vtype?.lmul ?? 1));
    for (const inst of sim.program.instructions) {
        for (const r of [inst.rd, inst.rs1, inst.rs2, inst.rs3])
            if (r) used.add(r);
        for (const r of [inst.vd, inst.vs1, inst.vs2, inst.vs3]) {
            if (!r) continue;
            const i = regs.index(r);
            vused.add(i);
            const single = ['mlog', 'mscalar', 'toScalar', 'fromScalar'].includes(inst.def.kind) || (inst.def.kind === 'cmp' && r === inst.vd);
            if (maxLmul > 1 && !single && i % maxLmul === 0) for (let k = 1; k < maxLmul; k++) vused.add(i + k);
        }
        if (inst.vm || inst.def.kind === 'merge') vused.add(0);
        // Tipo de exibição antes da primeira escrita: ponto flutuante ou máscara, conforme o uso.
        const d = inst.def;
        if (d.vector && (d.type === 'f' || d.tin === 'f' || d.tout === 'f')) {
            for (const r of [inst.vs1, inst.vs2, inst.vs3, d.kind === 'cmp' ? null : inst.vd]) {
                if (!r) continue;
                const i = regs.index(r);
                const n = maxLmul > 1 && i % maxLmul === 0 && (d.kind !== 'red' || r === inst.vs2) ? maxLmul : 1;
                for (let k = 0; k < n; k++) fpRegs.add(i + k);
            }
        }
        if (d.kind === 'cmp' || d.kind === 'mlog') maskRegs.add(regs.index(inst.vd));
        if (inst.vm || d.kind === 'merge') maskRegs.add(0);
    }
    // Linhas do Unified Buffer e dos acumuladores usadas pelas instruções da TPU.
    const ubRows = new Set(), accRows = new Set();
    for (const inst of sim.program.instructions) {
        const k = inst.def.kind;
        if (!inst.def.tpu || !inst.rows) continue;
        const add = (set, first) => { for (let r = first; r < first + inst.rows; r++) set.add(r); };
        if (k === 'rdhost') add(ubRows, inst.dst);
        if (k === 'wrhost' || k === 'matmul') add(ubRows, inst.src);
        if (k === 'matmul') add(accRows, inst.dst);
        if (k === 'act') { add(accRows, inst.src); add(ubRows, inst.dst); }
    }
    for (const r of sim.program.init.x.keys()) used.add(r);
    for (const r of sim.program.init.f.keys()) used.add(r);
    const dataLabels = new Map(sim.program.dataLabels.map((l) => [l.addr.toString(), l.name]));
    const sorted = (set) => [...set].sort((a, b) => a - b);
    return { sim, registers: [...used].sort(regs.compare), vregs: sorted(vused), fpRegs, maskRegs, dataLabels, ubRows: sorted(ubRows), accRows: sorted(accRows) };
}

/** Banco de registradores escalares. */
export function registersPanel(ctx, snap, focus) {
    const rows = ctx.registers.map((r) => {
        const i = regs.index(r);
        const value = r[0] === 'x' ? snap.regs.x[i] : snap.regs.f[i];
        return `<tr class="${focus.has(`reg:${r}`) ? 'focus' : ''}"><th title="${esc(regs.label(r))}">${r}<span class="abi">${regs.abiName(r)}</span></th>
            <td class="num">${esc(fmt.value(value))}</td></tr>`;
    }).join('');
    return `<section class="panel" data-part="regs"><h3>${t('ui.registers')}</h3>
        <table class="regs"><tr><th></th><th>${t('ui.value')}</th></tr>${rows}</table></section>`;
}

export function memoryPanel(ctx, snap, focus) {
    const focusAddrs = [...focus].filter((f) => f.startsWith('mem:')).map((f) => BigInt(f.slice(4)));
    const ws = words(snap.mem, 4);
    const limit = 64;
    const view = new DataView(new ArrayBuffer(4));
    const rows = ws.slice(0, limit).map(({ addr, raw }) => {
        const hit = focusAddrs.some((a) => a >= addr && a < addr + 4n);
        const label = ctx.dataLabels.get(addr.toString()) ?? '';
        view.setUint32(0, Number(raw));
        const asFloat = view.getFloat32(0);
        return `<tr class="${hit ? 'focus' : ''}"><td class="num">${fmt.address(addr)}</td><td>${esc(label)}</td>
            <td class="num" title="0x${raw.toString(16).padStart(8, '0')}">${BigInt.asIntN(32, raw)}</td>
            <td class="num dim">${esc(fmt.value(asFloat))}</td></tr>`;
    }).join('');
    const more = ws.length > limit ? `<p class="note">${t('ui.moreWords', { n: ws.length - limit })}</p>` : '';
    const empty = ws.length === 0 ? `<p class="note">${t('ui.memoryEmpty')}</p>` : '';
    const isFocus = focusAddrs.length > 0;
    return `<section class="panel ${isFocus ? 'focus' : ''}" data-part="mem"><h3>${t('ui.memory')} <span class="sub">${t('ui.words32')}</span></h3>
        ${ws.length ? `<table class="mem"><tr><th>${t('ui.address')}</th><th>${t('ui.label')}</th><th>${t('ui.integer')}</th><th>Float</th></tr>${rows}</table>` : ''}${more}${empty}</section>`;
}

/** Linhas de estatística (pares [rótulo, valor]) de uma simulação. */
export function statsRows(sim) {
    const s = sim.stats;
    const cfg = sim.config;
    const pct = (a, b) => (b > 0 ? `${fmtNum((100 * a) / b, 1)}%` : '-');
    const per = (a) => fmtNum(s.cycles ? a / s.cycles : 0, 2);
    const rows = [
        [t('stats.cycles'), s.cycles],
        [t('stats.instructions'), s.instructions],
    ];
    if (sim.model === 'gpu') {
        const g = cfg.gpu;
        rows.push([t('stats.threadInstructions'), s.threadInstructions]);
        rows.push([t('stats.warpIpc'), fmtNum(s.ipc, 2)]);
        rows.push([t('stats.simdEff'), pct(s.threadInstructions, s.instructions * g.warpSize)]);
        rows.push([t('stats.memInstructions'), s.memInstructions]);
        rows.push([t('stats.transactions'), s.transactions]);
        rows.push([t('stats.txnPerAccess'), fmtNum(s.memInstructions ? s.transactions / s.memInstructions : 0, 2)]);
        rows.push([t('stats.divergent'), `${s.divergent} / ${s.branches}`]);
        if (g.blocks > 1) {
            rows.push([t('stats.blocks'), s.blocks]);
            rows.push([t('stats.maxResident'), s.maxResident]);
        }
        rows.push([t('stats.occupancy'), pct(s.occupancy * 100, 100)]);
        if (s.sharedAccesses > 0) {
            rows.push([t('stats.sharedAccesses'), s.sharedAccesses]);
            rows.push([t('stats.bankConflicts'), s.bankConflicts]);
            rows.push([t('stats.maxDegree'), s.maxDegree]);
        }
        if (g.l1) rows.push([t('stats.l1'), `${s.l1Hits} / ${s.l1Hits + s.l1Misses} (${pct(s.l1Hits, s.l1Hits + s.l1Misses)})`]);
        ['ALU', 'FPU', 'LSU'].forEach((u, i) => rows.push([t('stats.unitBusy', { unit: u }), pct(s.unitBusy[i], s.cycles)]));
        rows.push([t('stats.idle'), s.idle]);
        const stall2 = (key, v) => { if (v > 0) rows.push([t(key), v]); };
        stall2('stats.idleDep', s.waitDep);
        stall2('stats.idleUnit', s.waitUnit);
        stall2('stats.idleBranch', s.waitBranch);
        stall2('stats.idleBar', s.waitBar);
    } else if (sim.model === 'tpu') {
        const n = cfg.tpu.n;
        rows.push([t('stats.tpuInstructions'), s.tpuInstructions]);
        rows.push([t('stats.scalarInstructions'), s.scalarInstructions]);
        rows.push(['CPI', fmtNum(s.cpi, 2)]);
        rows.push([t('stats.macs'), s.macs]);
        rows.push([t('stats.macsPerCycle'), per(s.macs)]);
        rows.push([t('stats.mxuUse'), pct(s.macs, s.cycles * n * n)]);
        ['DMA', 'WDMA', 'MXU', 'ACT'].forEach((u, i) => rows.push([t('stats.unitBusy', { unit: u }), pct(s.unitBusy[i], s.cycles)]));
    } else {
        rows.push([t('stats.vectorInstructions'), s.vectorInstructions]);
        rows.push([t('stats.scalarInstructions'), s.scalarInstructions]);
        rows.push(['CPI', fmtNum(s.cpi, 2)]);
        rows.push([t('stats.elements'), s.elements]);
        rows.push([t('stats.elementsPerCycle'), per(s.elements)]);
        rows.push([t('stats.flops'), s.flops]);
        rows.push([t('stats.flopsPerCycle'), per(s.flops)]);
        cfg.vector.units.forEach((u, i) => rows.push([t('stats.unitUse', { unit: u.name }), pct(s.unitSlots[i], s.cycles * cfg.vector.lanes)]));
    }
    if (sim.timing) {
        rows.push([t('stats.frequency'), `${fmtNum(sim.timing.freqGHz, 3)} GHz`]);
        rows.push([t('stats.time'), `${fmtNum(sim.timing.timeNs, 2)} ns`]);
    }
    const stall = (key, v) => { if (v > 0) rows.push([t(key), v]); };
    stall('stats.stallRaw', s.stallRaw);
    stall('stats.stallWar', s.stallWar);
    stall('stats.stallWaw', s.stallWaw);
    stall('stats.stallStruct', s.stallStruct);
    stall('stats.stallWeights', s.stallWeights);
    stall('stats.stallScalar', s.stallScalar);
    stall('stats.stallMem', s.stallMem);
    stall('stats.bubbles', s.bubbles);
    return rows;
}

export function statsPanel(ctx) {
    const rows = statsRows(ctx.sim).map(([k, v]) => `<tr><th>${esc(k)}</th><td class="num">${esc(v)}</td></tr>`).join('');
    const warn = ctx.sim.warnings.map((w) => `<p class="note warn">${esc(w)}</p>`).join('');
    return `<section class="panel"><h3>${t('ui.stats')} <span class="sub">${t('ui.fullRun')}</span></h3><table class="stats">${rows}</table>${warn}</section>`;
}

/** Número com casas decimais, sem zeros finais desnecessários. */
export function fmtNum(v, digits) {
    return Number(v.toFixed(digits)).toString();
}
