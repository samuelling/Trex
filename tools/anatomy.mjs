// Tyrannosaurus rex anatomical definition (adult, FMNH PR 2081 "Sue"-scale).
// Units: metres. X = cranial (forward), Y = dorsal (up), Z = animal's right.
// The body is defined the way it is built in life: a skeleton, with muscle
// bellies and soft-tissue volumes laid over it. Each volume is an implicit
// primitive attached to one or more bones; the skin is the smooth union.
import { add, sub, mul, norm, lerp, sstep } from './vec.mjs';

export const bones = [];
export const prims = [];
export const landmarks = {};
const B = (name, parent, p) => { bones.push({ name, parent, p }); return p; };

// ---------- primitive helpers ----------
const R2 = r => (typeof r === 'number' ? [r, r] : r);
const base = o => ({ up: o.up || [0, 1, 0], n: o.n || 2, k: o.k ?? 0.07, bones: o.bones, wt: o.wt || null, tfix: o.tfix ?? null,
  grp: o.grp || 'C', mus: o.mus || null, soft: o.soft || 0, loose: o.loose ?? (o.soft || 0) * 0.6, f: o.f || 3, mat: o.mat || 0, carve: !!o.carve, nodeOff: o.nodeOff || null });
// tapered elliptic capsule a->b; radii [rw (across), rh (along 'up')]
function cap(a, b, ra, rb, o = {}) {
  prims.push({ type: 'cap', a, b, ra: R2(ra), rb: R2(rb), rm: o.rm ? R2(o.rm) : null, capA: o.capA ?? null, capB: o.capB ?? null, axis: o.axis || null, ...base(o) });
}
// ellipsoid at c with radii [axial, rh, rw] in the frame (axis, up)
function ell(c, r, o = {}) { cap(c, c, [r[2], r[1]], [r[2], r[1]], { ...o, capA: r[0], capB: r[0], axis: o.axis || [1, 0, 0] }); }
// smooth chain through stations {p, r:[rw,rh], b}: one continuous tube (no bulges at joints)
function chain(st, o = {}) { prims.push({ type: 'chain', st: st.map(q => ({ p: q.p, r: R2(q.r), b: q.b })), ...base({ ...o, bones: st.map(q => q.b) }) }); }
// arbitrary implicit volume
function custom(fn, lo, hi, o = {}) { prims.push({ type: 'custom', fn, lo, hi, ...base(o) }); }
const sides = f => { f(1, 'R'); f(-1, 'L'); };
const Z = (p, s) => [p[0], p[1], p[2] * s];
// smooth curve through control points [[x, y], ...] (Catmull-Rom, clamped ends)
export function curve(pts) {
  const n = pts.length;
  return x => {
    if (x <= pts[0][0]) return pts[0][1]; if (x >= pts[n - 1][0]) return pts[n - 1][1];
    let i = 0; while (x > pts[i + 1][0]) i++;
    const x0 = pts[i][0], x1 = pts[i + 1][0], y0 = pts[i][1], y1 = pts[i + 1][1], h = x1 - x0, t = (x - x0) / h;
    const m0 = i > 0 ? (y1 - pts[i - 1][1]) / (x1 - pts[i - 1][0]) : (y1 - y0) / h, m1 = i < n - 2 ? (pts[i + 2][1] - y0) / (pts[i + 2][0] - x0) : (y1 - y0) / h;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * h * m0 + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * h * m1;
  };
}

// ================= AXIAL SKELETON =================
B('pelvis', null, [0, 3.06, 0]);
B('dors1', 'pelvis', [0.45, 3.32, 0]);
B('dors2', 'dors1', [1.05, 3.38, 0]);
B('dors3', 'dors2', [1.65, 3.40, 0]);
B('dors4', 'dors3', [2.25, 3.37, 0]);
B('neck1', 'dors4', [2.78, 3.38, 0]);
B('neck2', 'neck1', [3.06, 3.52, 0]);
B('neck3', 'neck2', [3.31, 3.69, 0]);
B('neck4', 'neck3', [3.56, 3.84, 0]);
const HEAD = B('head', 'neck4', [3.82, 3.96, 0]);
const HP = -9 * Math.PI / 180, hc = Math.cos(HP), hs = Math.sin(HP);
const HSC = 1.05; // skull length ~1.52 m
// head-local (origin at occipital condyle, x along skull) -> world rest
const HL = (x, y, z) => { x *= HSC; y *= HSC; z *= HSC; return [HEAD[0] + x * hc - y * hs, HEAD[1] + x * hs + y * hc, z]; };
const HLd = (x, y, z) => [x * hc - y * hs, x * hs + y * hc, z];
const toHL = (x, y, z) => { const dx = x - HEAD[0], dy = y - HEAD[1]; return [(dx * hc + dy * hs) / HSC, (-dx * hs + dy * hc) / HSC, z / HSC]; };
B('jaw', 'head', HL(0.05, -0.33, 0));
landmarks.headPitch = HP;

const tailX = [-0.55, -1.1, -1.65, -2.2, -2.75, -3.3, -3.85, -4.4, -4.95, -5.5, -6.05, -6.5, -6.92];
const tailY = [3.30, 3.26, 3.21, 3.16, 3.12, 3.09, 3.07, 3.06, 3.06, 3.07, 3.09, 3.11, 3.13];
for (let i = 0; i < 12; i++) B('tail' + (i + 1), i ? 'tail' + i : 'pelvis', [tailX[i], tailY[i], 0]);
landmarks.tailTip = [tailX[12], tailY[12], 0];

// ================= TORSO =================
// rib cage + gastral basket; widest and deepest just ahead of the knees
chain([
  { p: [-0.75, 3.00, 0], r: [0.42, 0.64], b: 'tail1' },
  { p: [-0.30, 2.96, 0], r: [0.47, 0.68], b: 'pelvis' },
  { p: [0.15, 2.88, 0], r: [0.53, 0.75], b: 'pelvis' },
  { p: [0.70, 2.78, 0], r: [0.63, 0.83], b: 'dors1' },
  { p: [1.30, 2.76, 0], r: [0.75, 0.85], b: 'dors2' },
  { p: [1.90, 2.82, 0], r: [0.73, 0.80], b: 'dors3' },
  { p: [2.45, 2.94, 0], r: [0.63, 0.72], b: 'dors4' },
  { p: [2.86, 3.10, 0], r: [0.55, 0.64], b: 'neck1' },
], { k: 0.12, soft: 0.8, loose: 0.6, f: 1.9, nodeOff: [0, -0.34, 0] });
// neural spines / ilium crest
chain([{ p: [-0.9, 3.48, 0], r: [0.13, 0.14], b: 'tail1' }, { p: [0, 3.55, 0], r: [0.14, 0.14], b: 'pelvis' }, { p: [0.75, 3.57, 0], r: [0.14, 0.13], b: 'dors1' },
  { p: [1.6, 3.57, 0], r: [0.14, 0.13], b: 'dors3' }, { p: [2.7, 3.52, 0], r: [0.15, 0.13], b: 'neck1' }], { k: 0.1 });
sides((s, S) => {
  // epaxial muscles (longissimus / iliocostalis)
  chain([{ p: [-0.7, 3.40, 0.20 * s], r: 0.19, b: 'tail1' }, { p: [-0.1, 3.44, 0.24 * s], r: 0.21, b: 'pelvis' }, { p: [0.4, 3.44, 0.24 * s], r: 0.215, b: 'dors1' }, { p: [1.1, 3.46, 0.27 * s], r: 0.225, b: 'dors2' }, { p: [1.9, 3.46, 0.27 * s], r: 0.225, b: 'dors3' }, { p: [2.75, 3.42, 0.23 * s], r: 0.215, b: 'neck1' }],
    { mus: 'epax_' + S, k: 0.09, soft: 0.3, f: 3.2 });
  // pectoral / coracoid mass and shoulder
  ell([2.50, 2.60, 0.30 * s], [0.30, 0.24, 0.20], { bones: ['dors4'], mus: 'pect_' + S, k: 0.1, soft: 0.5, f: 2.8 });
  ell([2.62, 2.86, 0.44 * s], [0.24, 0.26, 0.12], { bones: ['dors4'], mus: 'pect_' + S, k: 0.09, soft: 0.35, f: 3 });
});
// pubis + boot, ischium
cap([0.12, 2.6, 0], [0.40, 2.02, 0], [0.11, 0.15], [0.10, 0.13], { bones: ['pelvis'], up: [1, 0, 0], k: 0.1 });
ell([0.40, 1.985, 0], [0.26, 0.085, 0.085], { bones: ['pelvis'], k: 0.07 });
cap([-0.2, 2.7, 0], [-0.86, 2.36, 0], [0.11, 0.13], [0.07, 0.08], { bones: ['pelvis'], k: 0.1 });

// ================= NECK =================
const neck = [
  { p: [2.86, 3.12, 0], r: [0.55, 0.64], b: 'neck1' },
  { p: [3.10, 3.38, 0], r: [0.51, 0.60], b: 'neck2' },
  { p: [3.34, 3.60, 0], r: [0.455, 0.54], b: 'neck3' },
  { p: [3.58, 3.76, 0], r: [0.415, 0.485], b: 'neck4' },
  { p: [3.84, 3.84, 0], r: [0.385, 0.44], b: 'head' },
  { p: [4.02, 3.86, 0], r: [0.365, 0.41], b: 'head' },
];
chain(neck, { k: 0.1, soft: 0.25, loose: 0.4, f: 3.4 });
sides((s, S) => {
  chain(neck.slice(0, 5).map((q, i) => ({ p: [q.p[0] - 0.10, q.p[1] + 0.26 - 0.01 * i, 0.17 * s], r: 0.245 - 0.02 * i, b: q.b })), { k: 0.085, mus: 'neckDors_' + S, soft: 0.2, f: 3.6 });
});
// throat / ventral neck (longus colli, trachea, loose skin)
chain([{ p: [2.70, 2.56, 0], r: [0.34, 0.25], b: 'dors4' }, { p: [3.16, 2.90, 0], r: [0.32, 0.23], b: 'neck2' }, { p: [3.55, 3.20, 0], r: [0.28, 0.19], b: 'neck3' }, { p: [3.90, 3.39, 0], r: [0.25, 0.15], b: 'head' }],
  { k: 0.1, mus: 'neckVent', soft: 0.7, loose: 1.0, f: 2.4 });

// ================= TAIL =================
const tcy = [3.02, 3.03, 3.04, 3.04, 3.04, 3.04, 3.04, 3.04, 3.045, 3.055, 3.075, 3.10, 3.125];
const trw = [0.545, 0.50, 0.44, 0.375, 0.31, 0.25, 0.20, 0.155, 0.12, 0.09, 0.065, 0.042, 0.014];
const trh = [0.70, 0.655, 0.59, 0.51, 0.43, 0.35, 0.28, 0.22, 0.17, 0.13, 0.09, 0.055, 0.018];
const tb = i => (i < 12 ? 'tail' + (i + 1) : 'tail12');
landmarks.tailR = { rw: trw, rh: trh };
const tst = (f) => tailX.map((x, i) => f(x, i)).filter(Boolean);
chain(tst((x, i) => ({ p: [x, tcy[i], 0], r: [trw[i] * 0.66, trh[i]], b: tb(i) })), { k: 0.08, soft: 0.25, f: 3.2 });
sides((s, S) => {
  // epaxial (m. longissimus caudae) high
  chain(tst((x, i) => ({ p: [x, tcy[i] + 0.42 * trh[i], 0.42 * trw[i] * s], r: 0.5 * trw[i], b: tb(i) })), { k: 0.06, mus: 'tailLat_' + S, soft: 0.25, f: 3.4 });
  // caudofemoralis longus low on the proximal tail, ilio-ischiocaudalis beyond
  chain(tst((x, i) => i <= 5 && ({ p: [x, tcy[i] - 0.40 * trh[i], 0.47 * trw[i] * s], r: 0.72 * trw[i], b: tb(i) })), { k: 0.07, mus: 'cfl_' + S, soft: 0.55, loose: 0.5, f: 2.7 });
  chain(tst((x, i) => i >= 5 && ({ p: [x, tcy[i] - 0.36 * trh[i], 0.46 * trw[i] * s], r: 0.64 * trw[i], b: tb(i) })), { k: 0.04, mus: 'tailLat_' + S, soft: 0.15, f: 3.4 });
});

// ================= HIND LIMB =================
const LEG = { H: [0, 3.06, 0.30], K: [0.66, 1.917, 0.50], A: [0.25, 0.789, 0.47], M: [0.423, 0.142, 0.45] };
landmarks.leg = LEG;
const DIG = {
  d2: [[0.47, 0.10, 0.39], [0.664, 0.085, 0.287], [0.841, 0.068, 0.193], [0.97, 0.028, 0.125]],
  d3: [[0.50, 0.10, 0.45], [0.76, 0.085, 0.45], [0.99, 0.068, 0.45], [1.16, 0.028, 0.45]],
  d4: [[0.47, 0.10, 0.51], [0.661, 0.085, 0.62], [0.851, 0.068, 0.73], [0.965, 0.028, 0.795]],
};
landmarks.digits = DIG;
sides((s, S) => {
  const g = S, P = p => Z(p, s);
  const { H, K, A, M } = LEG;
  const fe = 'femur_' + S, ti = 'tibia_' + S, mt = 'mt_' + S;
  B(fe, 'pelvis', P(H)); B(ti, fe, P(K)); B(mt, ti, P(A));
  for (const d of ['d2', 'd3', 'd4']) { B(d + 'a_' + S, mt, P(DIG[d][0])); B(d + 'b_' + S, d + 'a_' + S, P(DIG[d][1])); }
  const sag = [1, 0, 0];
  // --- thigh ---
  cap(P(H), P(K), 0.20, 0.17, { grp: g, bones: [fe], k: 0.08 });
  ell(P([0.0, 3.08, 0.47]), [0.44, 0.34, 0.21], { grp: g, bones: ['pelvis', fe], tfix: 0.4, k: 0.1, soft: 0.4, f: 3.2, mus: 'hipFlex_' + S });
  // triceps femoris: iliotibialis 1-3 + femorotibialis -> knee extensors
  cap(P([0.52, 3.40, 0.40]), P([0.74, 1.99, 0.53]), [0.25, 0.37], [0.14, 0.17], { grp: g, up: sag, bones: ['pelvis', fe, ti], wt: [0.4, 0.86], mus: 'kneeExt_' + S, k: 0.07, soft: 0.5, f: 3.1 });
  cap(P([0.04, 3.44, 0.42]), P([0.69, 2.01, 0.55]), [0.24, 0.41], [0.135, 0.16], { grp: g, up: sag, bones: ['pelvis', fe, ti], wt: [0.4, 0.86], mus: 'kneeExt_' + S, k: 0.07, soft: 0.55, f: 3.0 });
  cap(P([0.14, 2.84, 0.41]), P([0.70, 2.03, 0.52]), 0.27, 0.16, { grp: g, bones: [fe], mus: 'kneeExt_' + S, k: 0.08, soft: 0.45, f: 3.3 });
  // iliofibularis + flexor tibialis: hip extensors / knee flexors
  cap(P([-0.55, 3.34, 0.38]), P([0.50, 1.80, 0.54]), [0.23, 0.37], [0.11, 0.13], { grp: g, up: sag, bones: ['pelvis', fe, ti], wt: [0.4, 0.86], mus: 'hamstring_' + S, k: 0.07, soft: 0.55, f: 3.0 });
  cap(P([-0.72, 2.78, 0.22]), P([0.42, 1.77, 0.46]), 0.21, 0.10, { grp: g, bones: ['pelvis', fe, ti], wt: [0.35, 0.86], mus: 'hamstring_' + S, k: 0.08, soft: 0.5, f: 3.0 });
  // iliotrochantericus / puboischiofemoralis internus: hip flexors
  cap(P([0.62, 3.38, 0.36]), P([0.22, 2.74, 0.46]), 0.22, 0.16, { grp: g, bones: ['pelvis', fe], mus: 'hipFlex_' + S, k: 0.08, soft: 0.4, f: 3.3 });
  // adductors
  cap(P([-0.45, 2.6, 0.14]), P([0.5, 2.1, 0.41]), 0.17, 0.10, { grp: g, bones: ['pelvis', fe], mus: 'adductor_' + S, k: 0.08, soft: 0.5, f: 3.0 });
  // caudofemoralis longus: tail base -> 4th trochanter (the main femoral retractor)
  cap(P([-0.62, 2.84, 0.27]), P([0.20, 2.66, 0.41]), 0.35, 0.21, { grp: g, bones: ['tail1', 'pelvis', fe], wt: [0.3, 0.6], mus: 'cfl_' + S, k: 0.1, soft: 0.55, f: 2.7 });
  // --- knee, shank ---
  ell(P(K), [0.17, 0.18, 0.175], { grp: g, bones: [fe, ti], tfix: 0.5, k: 0.06 });
  cap(P(K), P(A), 0.21, 0.14, { grp: g, bones: [ti], k: 0.06 });
  for (const dz of [0.095, -0.095])
    cap(P([0.52, 2.0, 0.50 + dz]), P([0.25, 1.16, 0.475 + dz * 0.4]), 0.14, 0.085, { rm: 0.285, grp: g, bones: [fe, ti], wt: [0.0, 0.22], mus: 'gastroc_' + S, k: 0.05, soft: 0.4, f: 4.2 });
  cap(P([0.25, 1.16, 0.475]), P([0.16, 0.80, 0.47]), 0.08, 0.065, { grp: g, bones: [ti, mt], wt: [0.75, 1], mus: 'gastroc_' + S, k: 0.05 });
  cap(P([0.73, 1.81, 0.50]), P([0.33, 0.92, 0.47]), 0.08, 0.05, { rm: 0.12, grp: g, bones: [ti], mus: 'tibCran_' + S, k: 0.05, soft: 0.2, f: 4.5 });
  // --- ankle, metatarsus ---
  ell(P(A), [0.165, 0.165, 0.15], { grp: g, bones: [ti, mt], tfix: 0.5, k: 0.05 });
  cap(P(A), P(M), [0.14, 0.14], [0.16, 0.145], { grp: g, up: sag, bones: [mt], k: 0.05 });
  cap(P([0.20, 0.76, 0.47]), P([0.37, 0.22, 0.45]), 0.06, 0.06, { grp: g, bones: [mt], mus: 'digFlex_' + S, k: 0.04 });
  // --- foot: metatarsal pad, three weight-bearing digits, hallux ---
  ell(P([0.45, 0.112, 0.45]), [0.21, 0.105, 0.22], { grp: g, bones: [mt, 'd3a_' + S], tfix: 0.5, k: 0.05, mat: 3 });
  for (const d of ['d2', 'd3', 'd4']) {
    const q = DIG[d].map(P), ba = d + 'a_' + S, bb = d + 'b_' + S, sc = d === 'd3' ? 1.25 : 1.12;
    cap(q[0], q[1], [0.088 * sc, 0.072 * sc], [0.078 * sc, 0.064 * sc], { grp: g, bones: [ba], k: 0.03 });
    cap(q[1], q[2], [0.078 * sc, 0.064 * sc], [0.062 * sc, 0.052 * sc], { grp: g, bones: [bb], k: 0.03 });
    ell([q[1][0], 0.052, q[1][2]], [0.10 * sc, 0.046, 0.085 * sc], { grp: g, bones: [ba, bb], tfix: 0.5, k: 0.025, mat: 3, axis: norm(sub(q[2], q[0])) });
    ell([lerp(q[1], q[2], 0.8)[0], 0.044, lerp(q[1], q[2], 0.8)[2]], [0.085 * sc, 0.04, 0.07 * sc], { grp: g, bones: [bb], k: 0.025, mat: 3, axis: norm(sub(q[2], q[0])) });
    const mid = add(lerp(q[2], q[3], 0.5), [0, 0.022, 0]);
    cap(q[2], mid, [0.05 * sc, 0.05 * sc], [0.034 * sc, 0.04 * sc], { grp: g, bones: [bb], k: 0.012, mat: 1 });
    cap(mid, q[3], [0.034 * sc, 0.04 * sc], [0.008, 0.012], { grp: g, bones: [bb], k: 0.01, mat: 1 });
  }
  cap(P([0.34, 0.35, 0.385]), P([0.30, 0.20, 0.31]), 0.042, 0.036, { grp: g, bones: [mt], k: 0.03 });
  cap(P([0.30, 0.20, 0.31]), P([0.315, 0.10, 0.275]), 0.032, 0.008, { grp: g, bones: [mt], k: 0.01, mat: 1 });

  // ================= FORELIMB =================
  const SH = [2.62, 2.72, 0.50], EL = [2.50, 2.38, 0.58], WR = [2.70, 2.27, 0.53], FI = [2.85, 2.17, 0.50];
  const hu = 'humerus_' + S, fa = 'forearm_' + S, ha = 'hand_' + S;
  B(hu, 'dors4', P(SH)); B(fa, hu, P(EL)); B(ha, fa, P(WR));
  cap(P(SH), P(EL), 0.095, 0.07, { grp: g, bones: [hu], mus: 'arm_' + S, k: 0.05, soft: 0.2, f: 5 });
  cap(P(EL), P(WR), 0.066, 0.05, { grp: g, bones: [fa], k: 0.04 });
  cap(P(WR), P(FI), 0.05, 0.04, { grp: g, bones: [ha], k: 0.03 });
  for (const [o, e, c] of [[[2.85, 2.17, 0.52], [2.95, 2.09, 0.525], [3.01, 2.0, 0.52]], [[2.84, 2.175, 0.455], [2.94, 2.105, 0.445], [2.995, 2.02, 0.435]]]) {
    cap(P(o), P(e), 0.032, 0.03, { grp: g, bones: [ha], k: 0.02 });
    cap(P(e), P(c), 0.028, 0.006, { grp: g, bones: [ha], k: 0.008, mat: 1 });
  }
});

// ================= HEAD (cranium + upper jaw) =================
// Defined by profile curves in skull coordinates: dorsal outline, lip line, and plan-view width.
const hup = HLd(0, 1, 0), hax = HLd(1, 0, 0);
const H = { bones: ['head'], up: hup, axis: hax };
const smax = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25; };
const zU = curve([[0.36, 0.365], [0.70, 0.288], [1.0, 0.238], [1.28, 0.185], [1.40, 0.11], [1.455, 0.03]]);        // lip line half-width
const yTop = curve([[-0.06, 0.10], [0.0, 0.205], [0.14, 0.255], [0.30, 0.268], [0.46, 0.268], [0.60, 0.252], [0.8, 0.205], [1.05, 0.138], [1.25, 0.068], [1.38, 0.0], [1.445, -0.09], [1.47, -0.19]]);
const yBot = curve([[-0.06, -0.40], [0.12, -0.50], [0.30, -0.44], [0.40, -0.375], [1.0, -0.365], [1.35, -0.362], [1.445, -0.36], [1.47, -0.335]]);
const wMax = curve([[-0.06, 0.34], [0.08, 0.455], [0.30, 0.46], [0.45, 0.41], [0.60, 0.325], [0.80, 0.272], [1.05, 0.24], [1.25, 0.208], [1.38, 0.168], [1.47, 0.08]]);
const topFrac = curve([[0, 0.66], [0.4, 0.60], [0.62, 0.50], [0.8, 0.44], [1.1, 0.44], [1.4, 0.60]]);                 // skull-roof width / max width
const bevel = curve([[0, 0.35], [0.45, 0.45], [0.7, 0.66], [1.2, 0.68], [1.45, 0.5]]);                               // height fraction where the flat side turns in to the roof
const edgeK = curve([[0, 0.07], [0.5, 0.06], [0.75, 0.034], [1.3, 0.034], [1.47, 0.05]]);                            // how sharp the roof/side edge is
function skullSDF(x, y, z) {
  const q = toHL(x, y, z), X = q[0], Y = q[1], Zc = Math.abs(q[2]);
  const xc = Math.min(1.47, Math.max(-0.06, X)), t = yTop(xc), b = yBot(xc), v = Math.min(1, Math.max(0, (Y - b) / (t - b))), tf = topFrac(xc), bv = bevel(xc);
  // flat-sided below the bevel, then leaning in to the narrower roof; lips tuck in slightly
  const w = wMax(xc) * (1 - (1 - tf) * sstep(bv, 1.0, v) ** 1.25) * (0.93 + 0.07 * Math.min(1, v * 6));
  let d = smax(smax(Zc - w, Y - t, edgeK(xc)), b - Y, 0.045);
  d = smax(d, X - 1.465, 0.045); d = smax(d, -0.05 - X, 0.12);
  return d * HSC * 0.8;
}
custom(skullSDF, HL(-0.25, -0.75, -0.6).map((v, i) => i === 2 ? -0.62 : v - 0.2), [HL(1.6, 0.4, 0)[0] + 0.1, HL(0, 0.45, 0)[1] + 0.2, 0.62], { ...H, k: 0.06 });
sides((s, S) => {
  // cranial ornament: nasal-lacrimal ridge running back into the lacrimal horn, brow, postorbital boss
  chain([{ p: HL(1.24, 0.05, 0.098 * s), r: 0.024, b: 'head' }, { p: HL(0.97, 0.143, 0.112 * s), r: 0.032, b: 'head' }, { p: HL(0.74, 0.22, 0.148 * s), r: 0.04, b: 'head' }, { p: HL(0.58, 0.272, 0.195 * s), r: 0.047, b: 'head' }], { up: hup, k: 0.06 });
  ell(HL(0.555, 0.276, 0.205 * s), [0.115, 0.034, 0.04], { ...H, k: 0.05 });                             // lacrimal horn
  cap(HL(0.53, 0.238, 0.25 * s), HL(0.33, 0.215, 0.335 * s), 0.04, 0.044, { ...H, k: 0.055 });              // brow over the orbit
  ell(HL(0.285, 0.236, 0.30 * s), [0.125, 0.042, 0.055], { ...H, k: 0.06 });                             // postorbital boss
  chain([{ p: HL(0.56, -0.085, 0.36 * s), r: 0.03, b: 'head' }, { p: HL(0.40, -0.135, 0.40 * s), r: 0.038, b: 'head' }, { p: HL(0.22, -0.185, 0.425 * s), r: 0.042, b: 'head' }, { p: HL(0.08, -0.2, 0.425 * s), r: 0.04, b: 'head' }], { up: hup, k: 0.065 });   // jugal flange
  ell(HL(0.17, 0.0, 0.40 * s), [0.16, 0.16, 0.058], { ...H, k: 0.085, mus: 'jawAdd' });
  ell(HL(0.20, -0.30, 0.40 * s), [0.17, 0.14, 0.05], { ...H, k: 0.08 });                                  // cheek: adductors and skin spanning skull to jaw
  // lip roll along the tooth row
  chain([0.40, 0.62, 0.85, 1.08, 1.28, 1.40].map(x => ({ p: HL(x, -0.342, (zU(x) + 0.004) * s), r: 0.024, b: 'head' })), { up: hup, k: 0.022 });
  // palpebral fissure: an almond (vesica) cut through the lids to the globe
  custom((x, y, z) => { const q = toHL(x, y, z), X = q[0] - 0.42, Y = q[1] - 0.072, Zs = q[2] * s, ca = Math.cos(-0.2), sa = Math.sin(-0.2), u = X * ca + Y * sa, v = -X * sa + Y * ca;
    const hh = 0.034, hw = 0.062, R = (hw * hw + hh * hh) / (2 * hh), d2 = Math.max(Math.hypot(u, v + (R - hh)) - R, Math.hypot(u, v - (R - hh)) - R);
    return smax(d2, Math.max(0.295 - Zs, Zs - 0.6), 0.01) * HSC; },
    [HL(0.3, 0, 0)[0] - 0.1, HL(0.42, -0.1, 0)[1] - 0.15, s > 0 ? 0.2 : -0.7], [HL(0.55, 0, 0)[0] + 0.1, HL(0.42, 0.2, 0)[1] + 0.1, s > 0 ? 0.7 : -0.2], { ...H, carve: true, k: 0.01, mat: 4 });
  cap(HL(0.335, 0.108, 0.368 * s), HL(0.50, 0.12, 0.328 * s), 0.028, 0.024, { ...H, k: 0.03 });             // upper lid fold
  cap(HL(0.35, 0.026, 0.378 * s), HL(0.49, 0.028, 0.338 * s), 0.02, 0.018, { ...H, k: 0.028 });             // lower lid
  ell(HL(1.27, -0.055, 0.196 * s), [0.05, 0.026, 0.035], { ...H, carve: true, k: 0.018, mat: 4 });          // naris
  ell(HL(1.205, -0.022, 0.19 * s), [0.055, 0.03, 0.028], { ...H, k: 0.04 });                                  // narial rim
  ell(HL(0.06, -0.02, 0.455 * s), [0.022, 0.032, 0.03], { ...H, carve: true, k: 0.02, mat: 4 });            // ear
});
cap(HL(0.74, 0.208, 0), HL(1.22, 0.062, 0), [0.07, 0.03], [0.06, 0.028], { ...H, k: 0.05 });                // nasal rugosity
// oral cavity (palate vault between the lips)
custom((x, y, z) => { const q = toHL(x, y, z), xc = Math.min(1.455, Math.max(0.36, q[0]));
  let d = smax(Math.abs(q[2]) - (zU(xc) - 0.075), q[1] + 0.24, 0.03); d = smax(d, 0.42 - q[0], 0.03); d = smax(d, q[0] - 1.385, 0.03); return d * HSC; },
  [HL(0.3, 0, 0)[0], HL(1.4, -0.5, 0)[1], -0.4], [HL(1.5, 0, 0)[0], HL(0.3, -0.2, 0)[1], 0.4], { ...H, carve: true, k: 0.02, mat: 2 });

// ================= LOWER JAW (separate surface so the mouth can open) =================
const J = { grp: 'J', bones: ['jaw'], up: hup, axis: hax };
const jTop = curve([[-0.04, -0.30], [0.36, -0.352], [1.0, -0.354], [1.40, -0.352]]);
const jBot = curve([[-0.04, -0.47], [0.10, -0.635], [0.5, -0.655], [1.0, -0.585], [1.3, -0.505], [1.42, -0.43]]);
const jW = curve([[-0.04, 0.38], [0.2, 0.425], [0.40, 0.336], [0.70, 0.259], [1.0, 0.209], [1.28, 0.155], [1.42, 0.07]]);
function jawSDF(x, y, z) {
  const q = toHL(x, y, z), X = q[0], Y = q[1], Zc = Math.abs(q[2]);
  const xc = Math.min(1.42, Math.max(-0.04, X)), W = jW(xc), b = jBot(xc);
  const t = jTop(xc) + 0.035 * Math.max(0, 1 - Math.pow(Zc / (0.45 * W), 2)) * sstep(0.4, 0.6, xc) * (1 - sstep(1.15, 1.3, xc)); // tongue
  const v = Math.min(1, Math.max(0, (Y - b) / (t - b)));
  const w = W * (0.6 + 0.4 * Math.pow(v, 0.5));
  let d = smax(smax(Zc - w, Y - t, 0.035), b - Y, 0.08);
  d = smax(d, X - 1.415, 0.07); d = smax(d, -0.03 - X, 0.1);
  return d * HSC * 0.8;
}
custom(jawSDF, [HL(-0.2, -0.3, 0)[0] - 0.1, HL(1.4, -0.75, 0)[1] - 0.1, -0.56], [HL(1.55, -0.3, 0)[0], HL(0, -0.2, 0)[1] + 0.1, 0.56], { ...J, k: 0.05, soft: 0.3, f: 3 });
sides((s) => { ell(HL(0.10, -0.50, 0.35 * s), [0.16, 0.10, 0.04], { ...J, k: 0.1, mus: 'jawAdd' });      // pterygoideus
  chain([0.42, 0.65, 0.9, 1.12, 1.3].map(x => ({ p: HL(x, -0.378, jW(x) * s), r: 0.02, b: 'jaw' })), { grp: 'J', up: hup, k: 0.02 }); });   // lower lip
landmarks.jawTop = [[-0.04, -0.30], [0.36, -0.37], [1.0, -0.372], [1.40, -0.368]];
export const jawMat = (x, y, z) => { const q = toHL(x, y, z), xc = Math.min(1.42, Math.max(-0.04, q[0])); if (q[0] < 0.36 || q[1] < jTop(xc) - 0.03) return 0; const W = jW(xc); return q[0] > 1.34 ? 0 : Math.abs(q[2]) < 0.45 * W && q[0] > 0.42 && q[0] < 1.28 ? 5 : Math.abs(q[2]) < W - 0.085 ? 2 : 0; };

// ---------- runtime landmarks ----------
landmarks.HL = { origin: HEAD, pitch: HP, scale: HSC };
landmarks.snout = HL(1.47, -0.1, 0);
landmarks.chains = {
  spine: [...Array.from({ length: 12 }, (_, i) => 'tail' + (12 - i)), 'pelvis', 'dors1', 'dors2', 'dors3', 'dors4', 'neck1', 'neck2', 'neck3', 'neck4', 'head'],
};
landmarks.eyes = [HL(0.42, 0.072, 0.334), HL(0.42, 0.072, -0.334)];
landmarks.eyeR = 0.05 * HSC;
// teeth: [root, tip, radius, bone]
const teeth = [];
sides((s) => {
  for (let i = 0; i < 13; i++) {
    const t = i / 12, x = 0.52 + 0.88 * t;
    const zl = zU(x);
    const z = (zl - 0.04) * s, L = 0.055 + 0.065 * Math.sin(Math.PI * Math.min(1, t * 1.15)) ** 1.2 + (i % 2) * 0.012;
    teeth.push({ r: HL(x, -0.235, z), t: HL(x - 0.02, -0.235 - L, z * 0.985), rad: 0.016 + 0.2 * L * 0.5, b: 'head' });
  }
  for (let i = 0; i < 12; i++) {
    const t = i / 11, x = 0.58 + 0.74 * t;
    const zl = x < 0.95 ? 0.27 + (x - 0.42) / 0.53 * (0.14 - 0.27) : 0.14 + (x - 0.95) / 0.35 * (0.07 - 0.14);
    const z = (zl - 0.012) * s, L = 0.04 + 0.045 * Math.sin(Math.PI * Math.min(1, t * 1.1)) + (i % 2) * 0.008;
    teeth.push({ r: HL(x, -0.345, z), t: HL(x - 0.015, -0.345 + L, z), rad: 0.013 + 0.2 * L * 0.5, b: 'jaw' });
  }
});
for (let i = 0; i < 4; i++) { // premaxillary teeth across the front
  const z = (i - 1.5) * 0.05; teeth.push({ r: HL(1.40 - Math.abs(z) * 0.5, -0.235, z), t: HL(1.39 - Math.abs(z) * 0.5, -0.31, z), rad: 0.016, b: 'head' });
}
landmarks.teeth = teeth;

// muscle paths for length estimation: [boneA, pointA, boneB, pointB] (right side; mirrored at runtime)
landmarks.musclePaths = {
  kneeExt: ['pelvis', [0.3, 3.5, 0.4], 'tibia', [0.76, 1.84, 0.5]],
  hamstring: ['pelvis', [-0.6, 3.1, 0.3], 'tibia', [0.5, 1.78, 0.5]],
  cfl: ['tail2', [-1.4, 2.85, 0.2], 'femur', [0.2, 2.66, 0.4]],
  hipFlex: ['pelvis', [0.62, 3.38, 0.36], 'femur', [0.22, 2.74, 0.46]],
  adductor: ['pelvis', [-0.45, 2.6, 0.14], 'femur', [0.5, 2.1, 0.41]],
  gastroc: ['femur', [0.53, 1.99, 0.5], 'mt', [0.165, 0.80, 0.47]],
  tibCran: ['tibia', [0.73, 1.81, 0.5], 'mt', [0.30, 0.74, 0.47]],
  digFlex: ['mt', [0.20, 0.76, 0.47], 'd3a', [0.62, 0.05, 0.45]],
};

// ================= SKELETON (for the stripped-down view) =================
// The bones themselves, as their own set of volumes on the same joints: built by `node tools/build-rex.mjs skel`.
// Counts and proportions follow the mounted skeleton (FMNH PR 2081): atlas-axis + 8 cervicals with long backswept ribs, 13 dorsals
// with double-headed ribs, 5 fused sacrals under the ilia, 40 caudals with chevrons, gastralia, furcula, an arctometatarsalian foot
// with a 2-3-4-5 phalangeal formula, a two-fingered hand, and a skull whose openings are cut to their real outlines.
const nBody = prims.length;
{
  const K = 0.012, KB = 0.022, rigid = (bn, o = {}) => ({ bones: [bn], k: K, ...o });
  // vertebral axis: the joint chain, dropped to the level of the centra
  const ax = [];
  for (let i = 12; i >= 0; i--) ax.push({ p: [tailX[i], tailY[i], 0], b: 'tail' + Math.min(12, i + 1) });
  ax.push({ p: [0.0, 3.21, 0], b: 'pelvis' }, { p: [0.45, 3.22, 0], b: 'dors1' }, { p: [1.05, 3.27, 0], b: 'dors2' }, { p: [1.65, 3.29, 0], b: 'dors3' }, { p: [2.25, 3.27, 0], b: 'dors4' },
    { p: [2.78, 3.31, 0], b: 'neck1' }, { p: [3.06, 3.47, 0], b: 'neck2' }, { p: [3.31, 3.64, 0], b: 'neck3' }, { p: [3.56, 3.79, 0], b: 'neck4' }, { p: HEAD, b: 'head' });
  const cum = [0]; for (let i = 1; i < ax.length; i++) cum.push(cum[i - 1] + Math.hypot(ax[i].p[0] - ax[i - 1].p[0], ax[i].p[1] - ax[i - 1].p[1]));
  const at = (s) => { let i = 1; while (i < ax.length - 1 && cum[i] < s) i++; const f = Math.min(1, Math.max(0, (s - cum[i - 1]) / (cum[i] - cum[i - 1]))), a = ax[i - 1], b = ax[i];
    const t = [b.p[0] - a.p[0], b.p[1] - a.p[1], 0], tl = Math.hypot(t[0], t[1]); return { p: [a.p[0] + t[0] * f, a.p[1] + t[1] * f, 0], t: [t[0] / tl, t[1] / tl, 0], n: [-t[1] / tl, t[0] / tl, 0], bone: f < 0.5 ? a.b : b.b }; };
  const sOf = (x) => { for (let i = 1; i < ax.length; i++) if (ax[i].p[0] >= x) return cum[i - 1] + (cum[i] - cum[i - 1]) * (x - ax[i - 1].p[0]) / (ax[i].p[0] - ax[i - 1].p[0]); return cum[cum.length - 1]; };
  // point in a vertebra's own frame: a along the column, u toward dorsal, z lateral
  const V = (q, a, u, z = 0) => [q.p[0] + q.t[0] * a + q.n[0] * u, q.p[1] + q.t[1] * a + q.n[1] * u, z];
  // torso cross-section (centre height, half-width, half-height) for hanging the ribs
  const TOR = [[-0.30, 2.96, 0.47, 0.68], [0.15, 2.88, 0.53, 0.75], [0.70, 2.78, 0.63, 0.83], [1.30, 2.76, 0.75, 0.85], [1.90, 2.82, 0.73, 0.80], [2.45, 2.94, 0.63, 0.72], [2.86, 3.10, 0.55, 0.64]];
  const tor = (x) => { let i = 1; while (i < TOR.length - 1 && TOR[i][0] < x) i++; const a = TOR[i - 1], b = TOR[i], f = Math.min(1, Math.max(0, (x - a[0]) / (b[0] - a[0]))); return [1, 2, 3].map(c => a[c] + (b[c] - a[c]) * f); };
  // one vertebra: spool-shaped centrum, neural arch, spine with a thickened table, zygapophyses, transverse processes, chevron
  const vert = (s, len, o) => {
    const q = at(s), B1 = rigid(q.bone), rc = o.rc, hl = len * 0.43;
    cap(V(q, -hl, 0), V(q, hl, 0), [rc * (o.wide || 1), rc], [rc * (o.wide || 1), rc], { ...B1, rm: [rc * 0.8 * (o.wide || 1), rc * 0.78], capA: rc * 0.22, capB: rc * 0.22 });
    if (o.spine > 0.02) {
      ell(V(q, 0, rc * 0.95), [len * 0.34, rc * 0.42, rc * 0.5], { ...B1, k: KB, axis: q.t, up: q.n });                                   // neural arch
      cap(V(q, -o.lean * 0.3, rc * 1.1), V(q, -o.lean, rc + o.spine), [0.016, len * 0.30], [0.024, len * (o.table || 0.33)], { ...B1, up: q.t, k: KB });
      if (len > 0.09) sides(sd => { cap(V(q, len * 0.1, rc * 1.15, 0.03 * sd), V(q, len * 0.52, rc * 1.32, 0.055 * sd), 0.02, 0.016, { ...B1, k: KB }); cap(V(q, -len * 0.1, rc * 1.2, 0.03 * sd), V(q, -len * 0.5, rc * 1.4, 0.045 * sd), 0.02, 0.015, { ...B1, k: KB }); });
    }
    if (o.tp > 0.03) sides(sd => cap(V(q, 0, rc * 0.75, 0.035 * sd), V(q, -o.tp * (o.tpBack || 0.15), rc * 0.75 + o.tpUp, o.tp * sd), [0.03, 0.02], [0.022, 0.014], { ...B1, up: q.t, k: KB }));
    if (o.chev > 0.03) sides(sd => chain([{ p: V(q, -hl, -rc * 0.7, 0.03 * sd), r: 0.013, b: q.bone }, { p: V(q, -hl - o.chev * 0.12, -rc * 0.7 - o.chev * 0.3, 0.012 * sd), r: 0.014, b: q.bone }, { p: V(q, -hl - o.chev * 0.5, -rc * 0.7 - o.chev, 0), r: [0.011, 0.02], b: q.bone }], { k: K, up: q.t }));
    return q;
  };
  // caudals: long and stout at the base, dwindling to rods at the tip
  { const s0 = 0, s1 = sOf(-0.52), N = 40; let acc = 0; const wts = Array.from({ length: N }, (_, i) => 0.42 + 0.58 * (i / (N - 1))), tot = wts.reduce((a, b) => a + b, 0);
    for (let i = 0; i < N; i++) { const len = (s1 - s0) * wts[i] / tot, u = i / (N - 1), s = s0 + acc + len / 2; acc += len;
      vert(s, len, { rc: 0.014 + 0.082 * Math.pow(u, 1.15), spine: 0.30 * Math.pow(u, 1.5), lean: 0.06 * u, tp: u > 0.6 ? 0.24 * (u - 0.6) / 0.4 + 0.03 : 0, tpUp: 0.0, tpBack: 0.35, chev: i > 2 && i < N - 2 ? 0.05 + 0.28 * Math.pow(u, 1.3) : 0 }); } }
  // sacrals: five centra fused, their spines joined into one plate between the ilia
  { const a = sOf(-0.52), b = sOf(0.38); for (let i = 0; i < 5; i++) { const q = vert(a + (b - a) * (i + 0.5) / 5, (b - a) / 5, { rc: 0.105, spine: 0.31, lean: 0.02, table: 0.5, tp: 0, chev: 0 });
      sides(sd => cap(V(q, 0, 0.04, 0.05 * sd), V(q, 0, 0.1, 0.17 * sd), [0.05, 0.035], [0.06, 0.045], rigid('pelvis', { up: q.t, k: KB }))); } }
  // dorsals with double-headed ribs
  { const a = sOf(0.38), b = sOf(2.80), N = 13;
    for (let i = 0; i < N; i++) { const len = (b - a) / N, q = vert(a + len * (i + 0.5), len, { rc: 0.10 - 0.008 * (i / N), spine: 0.29 - 0.05 * (i / N), lean: 0.035, table: 0.36, tp: 0.17, tpUp: 0.06, chev: 0 });
      if (i === 0) continue;                                                    // the last dorsal before the hips carries only a stub
      const x = q.p[0], [cy, w, h] = tor(x), ends = i < 2 ? -0.15 : i > N - 3 ? -0.6 : -1.15, y0 = q.p[1];
      sides(sd => { const st = [{ p: [x + 0.01, y0 + 0.02, 0.085 * sd], r: [0.028, 0.03], b: q.bone }, { p: [x - 0.01, y0 + 0.085, 0.17 * sd], r: [0.026, 0.034], b: q.bone }, { p: [x - 0.03, y0 + 0.07, 0.27 * sd], r: [0.02, 0.036], b: q.bone }];
        for (let j = 1; j <= 7; j++) { const th = 0.55 + (ends - 0.55) * j / 7, yy = cy + 0.9 * h * Math.sin(th), zz = 0.92 * w * Math.cos(th); if (zz < 0.33 && yy > y0) continue; st.push({ p: [x - 0.04 - 0.28 * (j / 7) ** 1.5, Math.min(yy, y0 + 0.05), zz * sd], r: [0.017 - 0.0006 * j, 0.034 - 0.0022 * j], b: q.bone }); }
        chain(st, { k: K, up: [1, 0, 0] });
        cap([x + 0.005, y0 - 0.01, 0.07 * sd], [x - 0.005, y0 + 0.06, 0.15 * sd], 0.022, 0.02, rigid(q.bone)); }); } }                                // capitulum reaching down to the centrum
  // cervicals: atlas-axis at the condyle, then eight with ribs swept back along the neck
  { const a = sOf(2.80), b = cum[cum.length - 1] - 0.03, N = 10;
    for (let i = 0; i < N; i++) { const len = (b - a) / N, last = i >= N - 1, q = vert(a + len * (i + 0.5), len, { rc: 0.09 - 0.022 * (i / N), wide: 1.15, spine: last ? 0.04 : 0.18 - 0.07 * (i / N), lean: -0.015, table: 0.3, tp: 0.10, tpUp: -0.05, chev: 0 });
      if (!last) sides(sd => chain([{ p: V(q, 0.01, -0.03, 0.105 * sd), r: 0.022, b: q.bone }, { p: V(q, -0.08, -0.085, 0.125 * sd), r: 0.016, b: q.bone }, { p: V(q, -0.20 - 0.1 * (1 - i / N), -0.11, 0.12 * sd), r: 0.011, b: q.bone }], { k: K })); } }
  // gastralia: belly ribs in a herringbone
  for (let i = 0; i < 15; i++) { const x = 0.70 + 0.105 * i, [cy, w, h] = tor(x), bn = x < 0.75 ? 'dors1' : x < 1.35 ? 'dors2' : x < 1.95 ? 'dors3' : 'dors4';
    sides(sd => chain([{ p: [x + 0.08, cy - 0.94 * h, 0.0], r: 0.016, b: bn }, { p: [x + 0.02, cy - 0.915 * h, 0.2 * w * sd], r: 0.015, b: bn }, { p: [x - 0.07, cy - 0.83 * h, 0.44 * w * sd], r: 0.013, b: bn }, { p: [x - 0.13, cy - 0.72 * h, 0.58 * w * sd], r: 0.011, b: bn }], { k: K })); }
  // pelvis: long low ilium blades, pubis ending in its boot, rod-like ischium
  sides(sd => {
    ell([-0.03, 3.385, 0.185 * sd], [0.80, 0.19, 0.03], rigid('pelvis', { k: KB }));
    ell([0.52, 3.30, 0.185 * sd], [0.26, 0.16, 0.028], rigid('pelvis', { k: 0.05 })); ell([-0.6, 3.34, 0.18 * sd], [0.25, 0.13, 0.028], rigid('pelvis', { k: 0.05 }));   // pre- and postacetabular blades
    cap([0.12, 3.24, 0.19 * sd], [0.15, 3.03, 0.16 * sd], [0.05, 0.075], [0.045, 0.06], rigid('pelvis', { up: [1, 0, 0], k: KB }));                                     // pubic peduncle
    cap([-0.14, 3.24, 0.19 * sd], [-0.17, 3.02, 0.16 * sd], [0.045, 0.065], [0.04, 0.05], rigid('pelvis', { up: [1, 0, 0], k: KB }));                                   // ischial peduncle
    cap([0.15, 3.03, 0.15 * sd], [0.37, 2.10, 0.035 * sd], [0.042, 0.07], [0.036, 0.055], rigid('pelvis', { up: [1, 0, 0], k: KB }));
    cap([-0.17, 3.02, 0.15 * sd], [-0.86, 2.37, 0.03 * sd], [0.04, 0.065], [0.026, 0.036], rigid('pelvis', { up: [1, 0, 0], k: KB }));
    cap([-0.36, 2.86, 0.11 * sd], [-0.33, 2.70, 0.08 * sd], [0.02, 0.05], [0.015, 0.03], rigid('pelvis', { up: [1, 0, 0], k: KB }));                                    // obturator process
  });
  cap([0.20, 2.02, 0], [0.70, 1.99, 0], [0.05, 0.065], [0.035, 0.04], rigid('pelvis', { k: KB })); ell([0.30, 2.0, 0], [0.16, 0.075, 0.06], rigid('pelvis', { k: KB }));    // pubic boot
  ell([-0.87, 2.36, 0], [0.06, 0.045, 0.04], rigid('pelvis', { k: KB }));
  sides((sd, S) => {
    const Pz = p => Z(p, sd), fe = 'femur_' + S, ti = 'tibia_' + S, mt = 'mt_' + S, { H: Hp, K: Kn, A: An } = LEG, mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    // femur: inturned head, trochanters, fourth trochanter for the caudofemoralis, paired condyles
    const fT = [Hp[0] + 0.02, Hp[1] + 0.0, Hp[2] + 0.03];
    chain([{ p: Pz(fT), r: 0.098, b: fe }, { p: Pz(mix(fT, Kn, 0.3)), r: [0.078, 0.082], b: fe }, { p: Pz([mix(fT, Kn, 0.6)[0] + 0.035, mix(fT, Kn, 0.6)[1], mix(fT, Kn, 0.6)[2]]), r: [0.074, 0.078], b: fe }, { p: Pz([Kn[0], Kn[1] + 0.04, Kn[2]]), r: [0.105, 0.10], b: fe }], { k: KB });
    ell(Pz([Hp[0] - 0.005, Hp[1] + 0.035, Hp[2] - 0.095]), [0.088, 0.088, 0.088], rigid(fe, { k: 0.035 }));
    ell(Pz([Hp[0] + 0.06, Hp[1] + 0.04, Hp[2] + 0.07]), [0.06, 0.10, 0.045], rigid(fe, { k: 0.03 })); cap(Pz([Hp[0] + 0.11, Hp[1] - 0.02, Hp[2] + 0.02]), Pz([Hp[0] + 0.13, Hp[1] - 0.2, Hp[2] + 0.03]), [0.02, 0.04], [0.015, 0.02], rigid(fe, { up: [1, 0, 0], k: 0.03 }));
    ell(Pz([mix(fT, Kn, 0.36)[0] - 0.06, mix(fT, Kn, 0.36)[1], mix(fT, Kn, 0.36)[2] - 0.04]), [0.03, 0.10, 0.03], rigid(fe, { k: 0.04 }));
    for (const dz of [-0.062, 0.062]) ell(Pz([Kn[0] - 0.035, Kn[1] + 0.005, Kn[2] + dz]), [0.085, 0.08, 0.052], rigid(fe, { k: 0.03 }));
    // tibia with cnemial crest, fibula, astragalus with its ascending process
    chain([{ p: Pz([Kn[0] - 0.02, Kn[1] - 0.05, Kn[2]]), r: [0.12, 0.10], b: ti }, { p: Pz(mix(Kn, An, 0.3)), r: [0.066, 0.07], b: ti }, { p: Pz(mix(Kn, An, 0.7)), r: [0.058, 0.055], b: ti }, { p: Pz([An[0], An[1] + 0.06, An[2]]), r: [0.105, 0.06], b: ti }], { k: KB, up: [1, 0, 0] });
    cap(Pz([Kn[0] + 0.085, Kn[1] - 0.06, Kn[2] - 0.01]), Pz([Kn[0] + 0.03, Kn[1] - 0.42, Kn[2]]), [0.028, 0.07], [0.02, 0.025], rigid(ti, { up: [1, 0, 0], k: 0.035 }));
    chain([{ p: Pz([Kn[0] - 0.05, Kn[1] - 0.07, Kn[2] + 0.115]), r: [0.035, 0.055], b: ti }, { p: Pz([mix(Kn, An, 0.35)[0] - 0.03, mix(Kn, An, 0.35)[1], mix(Kn, An, 0.35)[2] + 0.085]), r: 0.026, b: ti }, { p: Pz([An[0] - 0.02, An[1] + 0.07, An[2] + 0.085]), r: 0.017, b: ti }], { k: K, up: [1, 0, 0] });
    ell(Pz([An[0] + 0.01, An[1], An[2]]), [0.065, 0.062, 0.115], rigid(ti, { k: 0.02 })); cap(Pz([An[0] + 0.05, An[1] + 0.03, An[2] - 0.01]), Pz([An[0] + 0.07, An[1] + 0.24, An[2]]), [0.055, 0.014], [0.02, 0.01], rigid(ti, { up: [1, 0, 0], k: 0.02 }));
    // arctometatarsus: the middle metatarsal pinched to a splint between its neighbours at the top
    const mtTop = [An[0] + 0.015, An[1] - 0.075, An[2]];
    for (const [d, dz, r0, r1] of [['d2', -0.055, 0.05, 0.05], ['d3', 0, 0.02, 0.058], ['d4', 0.055, 0.05, 0.05]]) { const base = DIG[d][0], end = [base[0] - 0.035, base[1] + 0.04, base[2]];
      chain([{ p: Pz([mtTop[0], mtTop[1], mtTop[2] + dz]), r: r0, b: mt }, { p: Pz(mix([mtTop[0], mtTop[1], mtTop[2] + dz * 0.9], end, 0.5)), r: (r0 + r1) * 0.42, b: mt }, { p: Pz(end), r: r1, b: mt }], { k: K }); }
    cap(Pz([An[0] - 0.04, An[1] - 0.09, An[2] + 0.09]), Pz([An[0] - 0.01, An[1] - 0.3, An[2] + 0.1]), 0.02, 0.008, rigid(mt));                                             // fifth metatarsal splint
    chain([{ p: Pz([An[0] + 0.05, An[1] - 0.42, An[2] - 0.08]), r: 0.022, b: mt }, { p: Pz([An[0] - 0.01, An[1] - 0.5, An[2] - 0.13]), r: 0.02, b: mt }, { p: Pz([An[0] - 0.07, An[1] - 0.575, An[2] - 0.16]), r: [0.007, 0.012], b: mt }], { k: K });   // hallux
    // toes: 3, 4 and 5 phalanges, each waisted between its joints, ending in a hooked ungual
    const ph = (a, b, n, bn, r) => { for (let j = 0; j < n; j++) { const p0 = mix(a, b, j / n), p1 = mix(a, b, (j + 1) / n); cap(Pz([p0[0], p0[1] + 0.012, p0[2]]), Pz([p1[0], p1[1] + 0.012, p1[2]]), [r * 1.06, r], [r * 0.98, r * 0.9], rigid(bn, { rm: [r * 0.72, r * 0.66], k: 0.006 })); } };
    for (const [d, n1, n2] of [['d2', 1, 1], ['d3', 1, 2], ['d4', 2, 2]]) { const D = DIG[d], tip = D[3], dir = [tip[0] - D[2][0], 0, tip[2] - D[2][2]];
      ph(D[0], D[1], n1, d + 'a_' + S, 0.043); ph(D[1], D[2], n2, d + 'b_' + S, 0.037);
      chain([{ p: Pz([D[2][0], D[2][1] + 0.018, D[2][2]]), r: [0.022, 0.036], b: d + 'b_' + S }, { p: Pz([D[2][0] + dir[0] * 0.5, D[2][1] + 0.022, D[2][2] + dir[2] * 0.5]), r: [0.015, 0.026], b: d + 'b_' + S }, { p: Pz([tip[0], tip[1] - 0.012, tip[2]]), r: [0.004, 0.007], b: d + 'b_' + S }], { k: 0.006 }); }
    // shoulder girdle and arm
    const SH = [2.62, 2.72, 0.50], EL = [2.50, 2.38, 0.58], WR = [2.70, 2.27, 0.53];
    chain([{ p: Pz([2.67, 2.71, 0.49]), r: [0.03, 0.095], b: 'dors4' }, { p: Pz([2.42, 2.86, 0.585]), r: [0.017, 0.05], b: 'dors4' }, { p: Pz([2.05, 3.03, 0.66]), r: [0.015, 0.055], b: 'dors3' }, { p: Pz([1.66, 3.17, 0.65]), r: [0.014, 0.08], b: 'dors3' }], { k: K });       // scapula
    ell(Pz([2.74, 2.58, 0.41]), [0.10, 0.105, 0.022], rigid('dors4', { k: KB }));                                                                                    // coracoid
    chain([{ p: Pz([2.76, 2.70, 0.36]), r: 0.02, b: 'dors4' }, { p: Pz([2.84, 2.52, 0.2]), r: 0.02, b: 'dors4' }, { p: [2.87, 2.43, 0], r: 0.022, b: 'dors4' }], { k: K });                                                         // furcula
    chain([{ p: Pz(SH), r: 0.05, b: 'humerus_' + S }, { p: Pz(mix(SH, EL, 0.5)), r: 0.029, b: 'humerus_' + S }, { p: Pz(EL), r: 0.045, b: 'humerus_' + S }], { k: K }); ell(Pz([mix(SH, EL, 0.3)[0] + 0.03, mix(SH, EL, 0.3)[1], mix(SH, EL, 0.3)[2]]), [0.02, 0.06, 0.02], rigid('humerus_' + S, { k: 0.02 }));
    cap(Pz([EL[0], EL[1], EL[2] + 0.02]), Pz([WR[0], WR[1], WR[2] + 0.02]), 0.026, 0.022, rigid('forearm_' + S, { rm: 0.017 })); cap(Pz([EL[0] - 0.03, EL[1] + 0.03, EL[2] - 0.02]), Pz([WR[0], WR[1], WR[2] - 0.02]), 0.032, 0.022, rigid('forearm_' + S, { rm: 0.019 }));
    for (const [o, e, c] of [[[2.72, 2.26, 0.545], [2.95, 2.09, 0.525], [3.01, 2.0, 0.52]], [[2.72, 2.265, 0.505], [2.94, 2.105, 0.445], [2.995, 2.02, 0.435]]]) {
      ph(o, e, 2, 'hand_' + S, 0.02); chain([{ p: Pz(e), r: [0.013, 0.022], b: 'hand_' + S }, { p: Pz([mix(e, c, 0.55)[0] + 0.012, mix(e, c, 0.55)[1] + 0.01, mix(e, c, 0.55)[2]]), r: [0.009, 0.016], b: 'hand_' + S }, { p: Pz(c), r: [0.003, 0.005], b: 'hand_' + S }], { k: 0.005 }); }
  });
  // ---- skull: a shell of bone on the living head's outline, its openings cut to their real shapes ----
  const T = 0.046, shell = (x, y, z) => { const d = skullSDF(x, y, z); return Math.max(d, -(d + T)); };
  const HB = [HL(-0.25, -0.75, -0.6).map((v, i) => i === 2 ? -0.62 : v - 0.2), [HL(1.6, 0.4, 0)[0] + 0.1, HL(0, 0.45, 0)[1] + 0.2, 0.62]];
  custom(shell, HB[0], HB[1], { ...H, k: K });
  // window through one side wall (or the roof) with a rounded-polygon outline given in skull coordinates
  const sdPoly = (px, py, v) => { let d = 1e9, s = 1; for (let i = 0, j = v.length - 1; i < v.length; j = i, i++) { const ex = v[j][0] - v[i][0], ey = v[j][1] - v[i][1], wx = px - v[i][0], wy = py - v[i][1], t = Math.min(1, Math.max(0, (wx * ex + wy * ey) / (ex * ex + ey * ey))), bx = wx - ex * t, by = wy - ey * t; d = Math.min(d, bx * bx + by * by);
      const c1 = py >= v[i][1], c2 = py < v[j][1], c3 = ex * wy > ey * wx; if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s; } return s * Math.sqrt(d); };
  const win = (pts, round, z0, z1, top) => custom((x, y, z) => { const q = toHL(x, y, z), a = top ? Math.abs(q[2]) : q[1], zz = top ? q[1] : Math.abs(q[2]); return Math.max(sdPoly(q[0], a, pts) - round, Math.abs(zz - (z0 + z1) / 2) - (z1 - z0) / 2) * HSC; }, HB[0], HB[1], { ...H, carve: true, k: 0.016 });
  win([[0.37, 0.15], [0.40, 0.035], [0.385, -0.17], [0.435, -0.17], [0.455, 0.02], [0.51, 0.13]], 0.035, 0.2, 0.6);                                  // orbit: a keyhole, round above and a slot below
  win([[0.58, 0.115], [0.575, -0.135], [0.80, -0.14], [1.0, -0.085], [0.99, -0.03], [0.74, 0.07]], 0.035, 0.14, 0.6);                            // antorbital fenestra
  win([[1.075, -0.03], [1.09, -0.075], [1.135, -0.06], [1.12, -0.015]], 0.028, 0.14, 0.6);                                                        // maxillary fenestra
  win([[1.21, 0.0], [1.24, -0.075], [1.36, -0.105], [1.37, -0.07], [1.29, -0.01]], 0.022, 0.08, 0.6);                                              // bony naris
  win([[0.10, 0.12], [0.115, 0.0], [0.175, -0.035], [0.13, -0.12], [0.15, -0.25], [0.25, -0.25], [0.27, -0.10], [0.225, -0.03], [0.24, 0.10]], 0.03, 0.22, 0.6);   // lateral temporal fenestra, pinched at the waist
  win([[0.05, 0.075], [0.07, 0.19], [0.2, 0.2], [0.23, 0.085], [0.14, 0.055]], 0.025, 0.1, 0.6, true);                                             // supratemporal fenestra (in the roof)
  custom((x, y, z) => { const q = toHL(x, y, z); return Math.max(q[1] + 0.25, 0.37 - q[0]) * HSC; }, HB[0], HB[1], { ...H, carve: true, k: 0.02 });   // the bone ends at the tooth sockets; below that was gum and lip
  ell(HL(0.74, -0.24, 0), [0.60, 0.07, 0.19], { ...H, carve: true, k: 0.02 });                              // palate open between the tooth rows
  ell(HL(0.03, -0.06, 0), [0.075, 0.075, 0.075], { ...H, k: K }); ell(HL(0.11, 0.03, 0), [0.15, 0.14, 0.12], { ...H, k: 0.03 });            // occipital condyle, braincase
  sides(s => {
    chain([{ p: HL(1.24, 0.05, 0.098 * s), r: 0.024, b: 'head' }, { p: HL(0.97, 0.143, 0.112 * s), r: 0.032, b: 'head' }, { p: HL(0.74, 0.22, 0.148 * s), r: 0.04, b: 'head' }, { p: HL(0.58, 0.272, 0.195 * s), r: 0.047, b: 'head' }], { up: hup, k: 0.03 });   // rugose nasals
    cap(HL(0.53, 0.238, 0.25 * s), HL(0.33, 0.215, 0.335 * s), 0.04, 0.044, { ...H, k: 0.03 }); ell(HL(0.285, 0.236, 0.30 * s), [0.125, 0.042, 0.055], { ...H, k: 0.03 });               // lacrimal and postorbital bosses
    cap(HL(0.20, -0.2, 0.07 * s), HL(1.05, -0.215, 0.035 * s), 0.026, 0.02, { ...H, k: K }); cap(HL(0.14, -0.24, 0.09 * s), HL(0.07, -0.36, 0.36 * s), [0.02, 0.05], [0.03, 0.06], { ...H, k: KB });     // palate bars, quadrate
    // lower jaw: two deep, thin rami meeting at the chin
    chain([-0.02, 0.18, 0.42, 0.72, 1.02, 1.28, 1.405].map(x => { const t = jTop(x), bt = jBot(x); const cut = 0.05 * Math.min(1, Math.max(0, (x - 0.3) / 0.25)); return { p: HL(x, (t + bt) / 2 - 0.01 - cut / 2, Math.max(0.03, jW(x) * 0.93 - 0.035 - 0.5 * cut) * s), r: [0.03, Math.max(0.035, (t - bt) / 2 * 0.92 - cut / 2)], b: 'jaw' }; }), { up: hup, k: K });
    ell(HL(0.02, -0.40, 0.39 * s), [0.065, 0.07, 0.065], { bones: ['jaw'], up: hup, axis: hax, k: KB }); cap(HL(0.0, -0.42, 0.39 * s), HL(-0.1, -0.45, 0.38 * s), 0.045, 0.03, { bones: ['jaw'], up: hup, k: KB });   // joint and retroarticular process
    custom((x, y, z) => { const q = toHL(x, y, z); return Math.max(sdPoly(q[0], q[1], [[0.27, -0.50], [0.30, -0.545], [0.44, -0.55], [0.47, -0.505]]) - 0.02, Math.abs(q[2] * s - 0.33) - 0.12) * HSC; }, HB[0], HB[1], { bones: ['jaw'], up: hup, axis: hax, carve: true, k: 0.014 });   // surangular window
  });
}
export const skelPrims = prims.splice(nBody);
