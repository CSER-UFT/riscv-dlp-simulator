/** Gerador de programas RISC-V aleatórios, com instruções escalares e vetoriais, para testes. */
function prng(seed) {
    return () => {
        seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const XR = ['t0', 't1', 't2', 't3', 'a2', 'a3'];
const VR = ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7'];

export function generate(seed) {
    const rnd = prng(seed);
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
    let labelId = 0;
    let sew = 32;
    let lmul = 1;
    // Registradores alinhados ao LMUL atual (grupos de LMUL registradores).
    const vr = () => (lmul === 1 ? pick(VR) : `v${lmul * int(1, Math.floor(15 / lmul))}`);

    const words = Array.from({ length: 64 }, () => int(-1000, 1000));
    const floats = Array.from({ length: 16 }, () => (int(-400, 400) / 8).toFixed(3));
    const lines = ['.data', `buf: .word ${words.join(', ')}`, `fbuf: .float ${floats.join(', ')}`, '.text', 'la s1, buf', 'la s2, fbuf'];
    for (const r of XR) lines.push(`li ${r}, ${int(-50, 50)}`);
    lines.push('fcvt.s.w fa0, t0', 'fcvt.s.w fa1, t1', 'vsetivli zero, 8, e32, m1, ta, ma');
    for (const v of VR) lines.push(`vle32.v ${v}, (${pick(['s1', 's2'])})`);

    const mask = () => (rnd() < 0.25 ? ', v0.t' : '');
    const fp = () => sew === 32 || sew === 64;
    const base = () => {
        const off = int(0, 128 / (sew / 8)) * (sew / 8);
        return [`addi a4, ${pick(['s1', 's2'])}, ${off}`, 'a4'];
    };

    const vectorOp = (inLoop = false) => {
        const k = inLoop ? 0.08 + rnd() * 0.92 : rnd();
        const vd = vr(), a = vr(), b = vr();
        if (k < 0.08) {
            sew = pick([8, 16, 32, 64]);
            lmul = pick([1, 1, 1, 2, 4, 8]);
            if (rnd() < 0.5) return [`li t5, ${int(0, 80)}`, `vsetvli t6, t5, e${sew}, m${lmul}, ${pick(['ta', 'tu'])}, ${pick(['ma', 'mu'])}`];
            return [`vsetivli t6, ${int(0, 31)}, e${sew}, m${lmul}, ta, ma`];
        }
        if (k < 0.30) {
            const op = pick(['vadd', 'vsub', 'vand', 'vor', 'vxor', 'vsll', 'vsrl', 'vsra', 'vmin', 'vmaxu', 'vmul', 'vmulh', 'vdiv', 'vremu']);
            const form = pick(['vv', 'vx', 'vi']);
            if (form === 'vi' && ['vsub', 'vmin', 'vmaxu', 'vmul', 'vmulh', 'vdiv', 'vremu'].includes(op)) return [`${op}.vv ${vd}, ${a}, ${b}${mask()}`];
            const src = form === 'vv' ? b : form === 'vx' ? pick(XR) : int(op.startsWith('vs') ? 0 : -16, 15);
            return [`${op}.${form} ${vd}, ${a}, ${src}${mask()}`];
        }
        if (k < 0.36) return [`${pick(['vmacc', 'vnmsac', 'vmadd'])}.vv ${vd}, ${a}, ${b}${mask()}`];
        if (k < 0.44) {
            const op = pick(['vmseq', 'vmsne', 'vmslt', 'vmsltu', 'vmsle']);
            const vx = rnd() < 0.5;
            return [`${op}.${vx ? 'vx' : 'vv'} ${rnd() < 0.6 ? 'v0' : vd}, ${a}, ${vx ? pick(XR) : b}`];
        }
        if (k < 0.48) return [`vmerge.vvm ${vd}, ${a}, ${b}, v0`];
        if (k < 0.52) return [pick([`vmv.v.x ${vd}, ${pick(XR)}`, `vmv.v.i ${vd}, ${int(-16, 15)}`, `vmv.v.v ${vd}, ${a}`, `vid.v ${vd}${mask()}`, `vmv.s.x ${vd}, ${pick(XR)}`])];
        if (k < 0.58) return [`${pick(['vredsum', 'vredmax', 'vredminu', 'vredxor'])}.vs ${vd}, ${a}, ${b}${mask()}`, `vmv.x.s ${pick(XR)}, ${vd}`];
        if (k < 0.62) return [pick([`vmand.mm v0, ${a}, ${b}`, `vmxor.mm ${vd}, ${a}, v0`, `vcpop.m ${pick(XR)}, ${a}${mask()}`, `vfirst.m ${pick(XR)}, v0`])];
        if (k < 0.72) {
            const [addi, reg] = base();
            if (rnd() < 0.5) return [addi, `vle${sew}.v ${vd}, (${reg})${mask()}`];
            return [addi, `vse${sew}.v ${a}, (${reg})${mask()}`];
        }
        if (k < 0.77) {
            const [addi, reg] = base();
            const stride = pick([0, sew / 8, 2 * sew / 8, 3 * sew / 8, -sew / 8]);
            return [addi, `li a5, ${stride}`, `${rnd() < 0.5 ? `vlse${sew}.v ${vd}` : `vsse${sew}.v ${a}`}, (${reg}), a5${mask()}`];
        }
        if (k < 0.81) {
            const [addi, reg] = base();
            const shift = Math.log2(sew / 8);
            return [addi, 'vid.v v16', `vsll.vi v16, v16, ${shift + int(0, 1)}`, `${rnd() < 0.5 ? `vluxei${sew}.v ${vd}` : `vsuxei${sew}.v ${a}`}, (${reg}), v16${mask()}`];
        }
        if (!fp()) return [`vadd.vv ${vd}, ${a}, ${b}`];
        if (k < 0.88) return [`${pick(['vfadd', 'vfsub', 'vfmul', 'vfdiv', 'vfmin', 'vfsgnjn'])}.${pick(['vv', 'vf'])} ${vd}, ${a}, ${rnd() < 0.5 ? b : pick(['fa0', 'fa1'])}${mask()}`.replace(/\.vf (v\d+), (v\d+), (v\d+)/, '.vv $1, $2, $3').replace(/\.vv (v\d+), (v\d+), (fa\d)/, '.vf $1, $2, $3')];
        if (k < 0.92) return [`${pick(['vfmacc', 'vfnmsac', 'vfmadd'])}.vf ${vd}, ${pick(['fa0', 'fa1'])}, ${a}${mask()}`];
        if (k < 0.95) return [`${pick(['vmflt', 'vmfle', 'vmfeq'])}.vf v0, ${a}, fa0`];
        if (k < 0.98) return [`${pick(['vfredusum', 'vfredosum', 'vfredmax'])}.vs ${vd}, ${a}, ${b}`, `vfmv.f.s fa1, ${vd}`];
        return [`vfsqrt.v ${vd}, ${a}${mask()}`];
    };

    const scalarOp = () => {
        const rd = pick(XR), a = pick(XR), b = pick(XR);
        const k = rnd();
        if (k < 0.4) return `${pick(['add', 'sub', 'xor', 'slt', 'mul'])} ${rd}, ${a}, ${b}`;
        if (k < 0.6) return `addi ${rd}, ${a}, ${int(-20, 20)}`;
        if (k < 0.8) return `lw ${rd}, ${int(0, 63) * 4}(s1)`;
        return `sw ${a}, ${int(0, 63) * 4}(s1)`;
    };

    const body = [];
    const n = int(15, 35);
    for (let i = 0; i < n; i++) {
        const k = rnd();
        if (k < 0.08) {
            const name = `l${labelId++}`;
            body.push(`li s3, ${int(1, 3)}`, `${name}:`);
            for (let j = int(1, 3); j > 0; j--) body.push(...vectorOp(true));
            body.push('addi s3, s3, -1', `bnez s3, ${name}`);
        } else if (k < 0.12) {
            const name = `f${labelId++}`;
            body.push(`${pick(['beq', 'bne', 'blt'])} ${pick(XR)}, ${pick(XR)}, ${name}`, scalarOp(), `${name}:`);
        } else if (k < 0.3) {
            body.push(scalarOp());
        } else {
            body.push(...vectorOp());
        }
    }
    lines.push(...body);
    return lines.join('\n');
}
