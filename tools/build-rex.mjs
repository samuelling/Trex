// Builds the T. rex from the anatomical primitive set:
//   implicit union of muscle/bone volumes -> surface -> skin weights, muscle-bulge weights,
//   soft-tissue lattice binding -> relief displaced into the geometry -> UV atlas ->
//   baked albedo / object-space normal / occlusion-roughness maps -> coarse skin-simulation mesh.
// usage: node tools/build-rex.mjs [hi|lo] [textureSize]
import fs from 'fs';
import zlib from 'zlib';
import { add, sub, mul, dot, cross, len, norm, lerp, sstep } from './vec.mjs';
import { bones, prims, landmarks, jawMat, skelPrims } from './anatomy.mjs';
import { macro } from './skinfield.mjs';
import { unwrap } from './unwrap.mjs';
import { bake, bakeDetail } from './bake.mjs';

const LOD = process.argv[2] || 'hi', TEX = +(process.argv[3] || (LOD === 'hi' ? 4096 : 2048));
const COARSE = LOD === 'hi' ? 0.026 : 0.038, FINE = LOD === 'hi' ? 0.015 : 0.022;
const t0 = Date.now(), log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(1) + 's', ...a);

// ---------------- primitive compilation ----------------
let OUT_T = 0;
function frame(a, b, up, axis) {
  const ax = sub(b, a), L = len(ax), e1 = L > 1e-6 ? mul(ax, 1 / L) : norm(axis || [1, 0, 0]);
  let e2 = sub(up, mul(e1, dot(up, e1))); if (len(e2) < 1e-3) e2 = sub([0, 0, 1], mul(e1, e1[2]));
  e2 = norm(e2); return { L, e1, e2, e3: cross(e1, e2) };
}
function ellD(qa, qu, qs, ra, h, w, n) {
  if (n === 2) {
    const a = qa / ra, b = qu / h, c = qs / w, k0 = Math.sqrt(a * a + b * b + c * c), k1 = Math.sqrt(a * a / (ra * ra) + b * b / (h * h) + c * c / (w * w));
    return k1 < 1e-6 ? -Math.min(w, h) : k0 * (k0 - 1) / k1;
  }
  const s = Math.pow(Math.pow(Math.abs(qa / ra), n) + Math.pow(Math.abs(qu / h), n) + Math.pow(Math.abs(qs / w), n), 1 / n);
  return (s - 1) * Math.min(w, h, qa !== 0 ? ra : 1e9);
}
function compile(p) {
  if (p.type === 'custom') {
    const c = lerp(p.lo, p.hi, 0.5);
    return { ...p, ev: (x, y, z) => { OUT_T = 0; return p.fn(x, y, z); }, L: 0, tmax: 0, at: () => c, rwf: () => 0.2, rhf: () => 0.2 };
  }
  if (p.type === 'chain') {
    const st = p.st, N = st.length, seg = [];
    for (let i = 0; i < N - 1; i++) seg.push({ a: st[i].p, ...frame(st[i].p, st[i + 1].p, p.up) });
    const herm = (c) => (u) => { let i = Math.min(N - 2, Math.max(0, Math.floor(u))); const t = Math.min(1, Math.max(0, u - i)), y0 = st[i].r[c], y1 = st[i + 1].r[c];
      const m0 = i > 0 ? (y1 - st[i - 1].r[c]) / 2 : y1 - y0, m1 = i < N - 2 ? (st[i + 2].r[c] - y0) / 2 : y1 - y0, t2 = t * t, t3 = t2 * t;
      return Math.max(0.004, (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * m1); };
    const rw = herm(0), rh = herm(1); let rmax = 0, L = 0; for (const q of st) rmax = Math.max(rmax, q.r[0], q.r[1]); for (const g of seg) L += g.L;
    const lo = [0, 1, 2].map(i => Math.min(...st.map(q => q.p[i])) - rmax * 1.1), hi = [0, 1, 2].map(i => Math.max(...st.map(q => q.p[i])) + rmax * 1.1);
    const n = p.n;
    function ev(x, y, z) {
      let best = 1e18, bi = 0, bt = 0, bqa = 0, bqu = 0, bqs = 0;
      for (let i = 0; i < N - 1; i++) {
        const g = seg[i], qx = x - g.a[0], qy = y - g.a[1], qz = z - g.a[2], s1 = qx * g.e1[0] + qy * g.e1[1] + qz * g.e1[2];
        let t = s1 / g.L; t = t < 0 ? 0 : t > 1 ? 1 : t; const qa = s1 - t * g.L, qu = qx * g.e2[0] + qy * g.e2[1] + qz * g.e2[2], qs = qx * g.e3[0] + qy * g.e3[1] + qz * g.e3[2];
        const d2 = qa * qa + qu * qu + qs * qs; if (d2 < best) { best = d2; bi = i; bt = t; bqa = qa; bqu = qu; bqs = qs; }
      }
      const u = bi + bt, w = rw(u), h = rh(u); OUT_T = u;
      return ellD(bqa, bqu, bqs, Math.min(w, h), h, w, n);
    }
    const at = u => { const i = Math.min(N - 2, Math.max(0, Math.floor(u))); return lerp(st[i].p, st[i + 1].p, Math.min(1, Math.max(0, u - i))); };
    return { ...p, ev, lo, hi, L, tmax: N - 1, at, rwf: rw, rhf: rh };
  }
  const { L, e1, e2, e3 } = frame(p.a, p.b, p.up, p.axis);
  const [aw, ah] = p.ra, [bw, bh] = p.rb, m = p.rm;
  const capA = p.capA ?? Math.min(aw, ah), capB = p.capB ?? Math.min(bw, bh);
  const rmax = Math.max(aw, ah, bw, bh, capA, capB, m ? m[0] : 0, m ? m[1] : 0);
  const n = p.n, ax0 = p.a[0], ay0 = p.a[1], az0 = p.a[2];
  const lo = [0, 1, 2].map(i => Math.min(p.a[i], p.b[i]) - rmax), hi = [0, 1, 2].map(i => Math.max(p.a[i], p.b[i]) + rmax);
  const rw = t => m ? aw * (1 - t) * (1 - 2 * t) + 4 * m[0] * t * (1 - t) + bw * t * (2 * t - 1) : aw + (bw - aw) * t;
  const rh = t => m ? ah * (1 - t) * (1 - 2 * t) + 4 * m[1] * t * (1 - t) + bh * t * (2 * t - 1) : ah + (bh - ah) * t;
  function ev(x, y, z) {
    const qx = x - ax0, qy = y - ay0, qz = z - az0, s1 = qx * e1[0] + qy * e1[1] + qz * e1[2];
    let t = L > 1e-6 ? s1 / L : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qa = s1 - t * L; OUT_T = t;
    return ellD(qa, qx * e2[0] + qy * e2[1] + qz * e2[2], qx * e3[0] + qy * e3[1] + qz * e3[2], qa < 0 ? capA : capB, rh(t), rw(t), n);
  }
  return { ...p, ev, lo, hi, L, tmax: 1, at: t => lerp(p.a, p.b, t), rwf: rw, rhf: rh };
}
const P = prims.map(compile);
const boneIdx = Object.fromEntries(bones.map((b, i) => [b.name, i]));
for (const p of P) for (const b of p.bones) if (!(b in boneIdx)) throw new Error('unknown bone ' + b);
// bone weights of a primitive at its native parameter t
function primBones(p, t) {
  const b = p.bones;
  if (p.type === 'chain') { const i = Math.min(b.length - 2, Math.max(0, Math.floor(t))), f = Math.min(1, Math.max(0, t - i)); return [[boneIdx[b[i]], 1 - f], [boneIdx[b[i + 1]], f]]; }
  if (p.tfix != null) t = p.tfix;
  if (b.length === 1) return [[boneIdx[b[0]], 1]];
  if (b.length === 2) { const w = p.wt ? sstep(p.wt[0], p.wt[1], t) : t; return [[boneIdx[b[0]], 1 - w], [boneIdx[b[1]], w]]; }
  const wt = p.wt || [0.5, 0.75], wa = 1 - sstep(0, wt[0], t), wb = sstep(wt[1], 1, t);
  return [[boneIdx[b[0]], wa], [boneIdx[b[1]], 1 - wa - wb], [boneIdx[b[2]], wb]];
}
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };

// ---------------- rectilinear grid ----------------
function axis(lo, hi, fineRanges, coarse = COARSE, fine = FINE) {
  const xs = []; let x = lo;
  while (x < hi) { xs.push(x); const mid = x + fine * 0.5; x += fineRanges.some(r => mid >= r[0] && mid <= r[1]) ? fine : coarse; }
  xs.push(x); return Float64Array.from(xs);
}
function symAxis(hi, fineHi, coarse = COARSE, fine = FINE) {
  const h = []; let z = 0; while (z < hi) { z += z < fineHi ? fine : coarse; h.push(z); }
  return Float64Array.from([...h.slice().reverse().map(v => -v), 0, ...h]);
}
class Grid {
  constructor(xs, ys, zs) {
    this.xs = xs; this.ys = ys; this.zs = zs; this.nx = xs.length; this.ny = ys.length; this.nz = zs.length;
    this.n = this.nx * this.ny * this.nz;
    this.lut = [xs, ys, zs].map(a => { const res = 0.002, n = Math.ceil((a[a.length - 1] - a[0]) / res) + 2, l = new Int32Array(n); let i = 0; for (let q = 0; q < n; q++) { const v = a[0] + q * res; while (i < a.length - 2 && a[i + 1] <= v) i++; l[q] = i; } return { l, res, a0: a[0], n }; });
  }
  field() { return new Float32Array(this.n).fill(1e3); }
  range(a, lo, hi) { let i0 = 0, i1 = a.length - 1; while (i0 < a.length - 1 && a[i0 + 1] < lo) i0++; while (i1 > 0 && a[i1 - 1] > hi) i1--; return [i0, i1]; }
  splat(D, p, op) {
    const M = 0.42 + p.k;
    const [i0, i1] = this.range(this.xs, p.lo[0] - M, p.hi[0] + M), [j0, j1] = this.range(this.ys, p.lo[1] - M, p.hi[1] + M), [k0, k1] = this.range(this.zs, p.lo[2] - M, p.hi[2] + M);
    const { xs, ys, zs, nx, ny } = this, ev = p.ev, kk = p.k;
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) { let o = i0 + nx * (j + ny * k); for (let i = i0; i <= i1; i++, o++) { const d = ev(xs[i], ys[j], zs[k]); D[o] = op ? -smin(-D[o], d, kk) : smin(D[o], d, kk); } }
  }
  cell(ax, v) { const L = this.lut[ax]; let q = ((v - L.a0) / L.res) | 0; q = q < 0 ? 0 : q >= L.n ? L.n - 1 : q; return L.l[q]; }
  sample(D, x, y, z) {
    const { xs, ys, zs, nx, ny } = this; const i = this.cell(0, x), j = this.cell(1, y), k = this.cell(2, z);
    let fx = (x - xs[i]) / (xs[i + 1] - xs[i]), fy = (y - ys[j]) / (ys[j + 1] - ys[j]), fz = (z - zs[k]) / (zs[k + 1] - zs[k]);
    fx = fx < 0 ? 0 : fx > 1 ? 1 : fx; fy = fy < 0 ? 0 : fy > 1 ? 1 : fy; fz = fz < 0 ? 0 : fz > 1 ? 1 : fz;
    const o = i + nx * (j + ny * k), s = nx * ny;
    const c00 = D[o] + (D[o + 1] - D[o]) * fx, c10 = D[o + nx] + (D[o + nx + 1] - D[o + nx]) * fx;
    const c01 = D[o + s] + (D[o + s + 1] - D[o + s]) * fx, c11 = D[o + s + nx] + (D[o + s + nx + 1] - D[o + s + nx]) * fx;
    const c0 = c00 + (c10 - c00) * fy, c1 = c01 + (c11 - c01) * fy; return c0 + (c1 - c0) * fz;
  }
  grad(D, x, y, z, h) {
    return [this.sample(D, x + h, y, z) - this.sample(D, x - h, y, z), this.sample(D, x, y + h, z) - this.sample(D, x, y - h, z), this.sample(D, x, y, z + h) - this.sample(D, x, y, z - h)];
  }
}

// ---------------- surface nets ----------------
function surfaceNets(G, D) {
  const { xs, ys, zs, nx, ny, nz } = G, s = nx * ny;
  const idx = new Int32Array(G.n).fill(-1), pos = [], tri = [];
  const co = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const ed = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const v = new Float64Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const o = i + nx * (j + ny * k);
    v[0] = D[o]; v[1] = D[o + 1]; v[2] = D[o + nx]; v[3] = D[o + nx + 1]; v[4] = D[o + s]; v[5] = D[o + s + 1]; v[6] = D[o + s + nx]; v[7] = D[o + s + nx + 1];
    let m = 0; for (let c = 0; c < 8; c++) if (v[c] < 0) m |= 1 << c;
    if (m === 0 || m === 255) continue;
    let px = 0, py = 0, pz = 0, cnt = 0;
    for (const [a, b] of ed) { if ((v[a] < 0) === (v[b] < 0)) continue; const t = v[a] / (v[a] - v[b]); px += co[a][0] + (co[b][0] - co[a][0]) * t; py += co[a][1] + (co[b][1] - co[a][1]) * t; pz += co[a][2] + (co[b][2] - co[a][2]) * t; cnt++; }
    px /= cnt; py /= cnt; pz /= cnt;
    idx[o] = pos.length / 3;
    pos.push(xs[i] + (xs[i + 1] - xs[i]) * px, ys[j] + (ys[j + 1] - ys[j]) * py, zs[k] + (zs[k + 1] - zs[k]) * pz);
  }
  const quad = (a, b, c, d, flip) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; if (flip) tri.push(a, c, b, a, d, c); else tri.push(a, b, c, a, c, d); };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const o = i + nx * (j + ny * k), d0 = D[o] < 0;
    if (d0 !== (D[o + 1] < 0)) quad(idx[o], idx[o - nx], idx[o - nx - s], idx[o - s], d0);
    if (d0 !== (D[o + nx] < 0)) quad(idx[o], idx[o - s], idx[o - s - 1], idx[o - 1], d0);
    if (d0 !== (D[o + s] < 0)) quad(idx[o], idx[o - 1], idx[o - 1 - nx], idx[o - nx], d0);
  }
  return { pos: Float32Array.from(pos), tri: Uint32Array.from(tri) };
}

// ---------------- build fields ----------------
function bounds(list, m) { const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; for (const p of list) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p.lo[i] - p.k); hi[i] = Math.max(hi[i], p.hi[i] + p.k); } return [lo.map(v => v - m), hi.map(v => v + m)]; }
const body = P.filter(p => p.grp !== 'J'), jawP = P.filter(p => p.grp === 'J');
const [blo, bhi] = bounds(body, 0.1);
// left and right limbs are each blended with the trunk but never with each other
function bodyField(G) {
  const DC = G.field(); for (const p of body) if (p.grp === 'C' && !p.carve) G.splat(DC, p);
  const DR = DC.slice(), DL = DC, DC0 = DC.slice();
  for (const p of body) if (p.grp === 'R') G.splat(DR, p);
  for (const p of body) if (p.grp === 'L') G.splat(DL, p);
  for (let i = 0; i < G.n; i++) if (DR[i] < DL[i]) DL[i] = DR[i];
  // Close crevices between a limb and the trunk that are narrower than the mesher can resolve: wherever the two surfaces come within
  // GAP of each other the space between is filled, leaving a small fillet (a web of skin) instead of a slit bridged by sawtooth triangles.
  { const GAP = 0.055, Dl = G.field(); for (const p of body) if ((p.grp === 'R' || p.grp === 'L') && !p.carve) G.splat(Dl, p);
    for (let i = 0; i < G.n; i++) { const dc = DC0[i], dl = Dl[i]; if (dc > 0 && dl > 0 && dc + dl < GAP + 0.05) { const f = 0.5 * (dc + dl - GAP); if (f < DL[i]) DL[i] = f; } } }
  for (const p of body) if (p.carve) G.splat(DL, p, true);
  return DL;
}
const GB = new Grid(axis(blo[0], bhi[0], [[3.6, 5.5], [0.15, 1.3]]), axis(Math.max(blo[1], -0.08), bhi[1], [[3.2, 4.5], [-0.1, 0.42]]), symAxis(Math.max(-blo[2], bhi[2]), 0.86));
log('body grid', GB.nx, GB.ny, GB.nz, (GB.n / 1e6).toFixed(1) + 'M');
const DB = bodyField(GB); log('body field done');
const [jlo, jhi] = bounds(jawP, 0.1);
const GJ = new Grid(axis(jlo[0], jhi[0], [[-99, 99]]), axis(jlo[1], jhi[1], [[-99, 99]]), symAxis(Math.max(-jlo[2], jhi[2]), 99));
const DJ = GJ.field(); for (const p of jawP) GJ.splat(DJ, p);

function finish(G, D, h) {
  const m = surfaceNets(G, D), nV = m.pos.length / 3, nrm = new Float32Array(nV * 3);
  for (let i = 0; i < nV; i++) {
    let x = m.pos[3 * i], y = m.pos[3 * i + 1], z = m.pos[3 * i + 2], g;
    for (let it = 0; it < 2; it++) { g = norm(G.grad(D, x, y, z, h * 0.5)); const d = G.sample(D, x, y, z); x -= g[0] * d; y -= g[1] * d; z -= g[2] * d; }
    g = norm(G.grad(D, x, y, z, h));
    m.pos[3 * i] = x; m.pos[3 * i + 1] = y; m.pos[3 * i + 2] = z; nrm.set(g, 3 * i);
  }
  let agree = 0;
  for (let t = 0; t < Math.min(3000, m.tri.length / 3); t++) { const a = m.tri[3 * t], b = m.tri[3 * t + 1], c = m.tri[3 * t + 2]; const pa = m.pos.subarray(3 * a, 3 * a + 3), pb = m.pos.subarray(3 * b, 3 * b + 3), pc = m.pos.subarray(3 * c, 3 * c + 3); agree += Math.sign(dot(cross(sub(pb, pa), sub(pc, pa)), nrm.subarray(3 * a, 3 * a + 3))); }
  if (agree < 0) for (let t = 0; t < m.tri.length; t += 3) { const q = m.tri[t + 1]; m.tri[t + 1] = m.tri[t + 2]; m.tri[t + 2] = q; }
  return { ...m, nrm, nV };
}
const MB = finish(GB, DB, FINE), MJ = finish(GJ, DJ, FINE);
{ let vol = 0; const q = MB.pos, t = MB.tri; for (let i = 0; i < t.length; i += 3) { const a = 3 * t[i], b = 3 * t[i + 1], c = 3 * t[i + 2]; vol += q[a] * (q[b + 1] * q[c + 2] - q[b + 2] * q[c + 1]) - q[a + 1] * (q[b] * q[c + 2] - q[b + 2] * q[c]) + q[a + 2] * (q[b] * q[c + 1] - q[b + 1] * q[c]); } log('body volume m^3', (vol / 6).toFixed(2)); }
log('verts', MB.nV, MJ.nV, 'tris', MB.tri.length / 3, MJ.tri.length / 3);
// coarse copy of the body surface: the simulated skin sheet
const CS = 0.075, GS = new Grid(axis(blo[0], bhi[0], [], CS, CS), axis(Math.max(blo[1], -0.08), bhi[1], [], CS, CS), symAxis(Math.max(-blo[2], bhi[2]), 0, CS, CS));
const DS = bodyField(GS), MS = finish(GS, DS, CS * 0.5); log('skin sheet verts', MS.nV);

// ---------------- soft-tissue lattice nodes ----------------
const nodes = [];
for (const p of P) {
  if (p.soft < 0.25) continue;
  const c = Math.max(1, Math.min(p.type === 'chain' ? 7 : 3, Math.round(p.L / 0.5)));
  for (let j = 0; j < c; j++) {
    const t = (j + 0.5) / c * p.tmax; let q = p.at(t); if (p.nodeOff) q = add(q, p.nodeOff);
    nodes.push({ p: q, R: Math.max(p.rwf(t), p.rhf(t)) * 1.5 + 0.14, soft: p.soft, f: p.f, bones: primBones(p, t).filter(b => b[1] > 0.02), mus: p.mus, grp: p.grp });
  }
}
if (nodes.length > 254) throw new Error('too many nodes ' + nodes.length);
for (let i = 0; i < nodes.length; i++) {
  const c = []; for (let j = 0; j < nodes.length; j++) if (i !== j) { const d = len(sub(nodes[i].p, nodes[j].p)); if (d < 0.75) c.push([d, j]); }
  c.sort((a, b) => a[0] - b[0]); nodes[i].nb = c.slice(0, 5).map(v => v[1]);
}

// ---------------- vertex attributes ----------------
const musNames = [...new Set(P.map(p => p.mus).filter(Boolean))], musIdx = Object.fromEntries(musNames.map((m, i) => [m, i]));
const nB = bones.length, nM = musNames.length;
// Every vertex may follow only four bones / muscles / nodes. Cutting the fifth abruptly makes neighbours
// disagree and tears the surface at strong bends, so the fifth-largest weight is subtracted from the
// top four instead: a weight then reaches zero exactly where it drops out of the set.
function top4(A, off, n) {
  const r = []; for (let c = 0; c < n; c++) { const v = A[off + c]; if (v > 1e-5) r.push([v, c]); }
  r.sort((a, b) => b[0] - a[0]); const w5 = r.length > 4 ? r[4][0] : 0; return r.slice(0, 4).map(v => [v[0] - w5, v[1]]);
}
function attributes(M, G, D, list, isJaw) {
  const nV = M.nV, W = new Float32Array(nV * nB), mus = new Float32Array(nV * nM);
  const soft = new Float32Array(nV), loose = new Float32Array(nV), mat = new Uint8Array(nV), ao = new Float32Array(nV), cav = new Float32Array(nV);
  const KW = 0.05, KM = 0.07;
  for (let i = 0; i < nV; i++) {
    const x = M.pos[3 * i], y = M.pos[3 * i + 1], z = M.pos[3 * i + 2];
    let dmin = 1e9, mm = 0, ws = 0, ss = 0, ls = 0, carved = -1;
    for (const p of list) {
      if (x < p.lo[0] - 0.3 || x > p.hi[0] + 0.3 || y < p.lo[1] - 0.3 || y > p.hi[1] + 0.3 || z < p.lo[2] - 0.3 || z > p.hi[2] + 0.3) continue;
      const d = p.ev(x, y, z), t = OUT_T;
      if (p.carve) { if (d < 0.012 && p.mat) carved = p.mat; continue; }
      const w = Math.exp(-Math.max(d, 0) / KW);
      if (w > 1e-4) { for (const [b, bw] of primBones(p, t)) W[i * nB + b] += w * bw; ws += w; ss += w * p.soft; ls += w * p.loose; }
      if (d < dmin) { dmin = d; mm = p.mat; }
      if (p.mus) { const v = Math.exp(-Math.max(d, 0) / KM) * Math.min(1, Math.min(p.rwf(t), p.rhf(t)) / 0.3); const o = i * nM + musIdx[p.mus]; if (v > mus[o]) mus[o] = v; }
    }
    soft[i] = ws > 0 ? ss / ws : 0; loose[i] = ws > 0 ? ls / ws : 0;
    mat[i] = carved >= 0 ? carved : mm;
    if (isJaw && mat[i] === 0) mat[i] = jawMat(x, y, z);
    const n = M.nrm.subarray(3 * i, 3 * i + 3); let occ = 0, occS = 0;
    for (const [h, wgt] of [[0.03, 1], [0.08, 0.8], [0.18, 0.6], [0.36, 0.45]]) { const d = G.sample(D, x + n[0] * h, y + n[1] * h, z + n[2] * h); if (d < 50) { const o = Math.max(0, h - d) / h; occ += o * wgt; if (h < 0.1) occS += o; } }
    ao[i] = Math.max(0, 1 - occ * 0.55); cav[i] = Math.min(1, occS * 0.6);
  }
  const nbStart = new Uint32Array(nV + 1), deg = new Uint32Array(nV);
  for (let t = 0; t < M.tri.length; t += 3) for (let e = 0; e < 3; e++) deg[M.tri[t + e]] += 2;
  for (let i = 0; i < nV; i++) nbStart[i + 1] = nbStart[i] + deg[i];
  const nb = new Uint32Array(nbStart[nV]), fill = new Uint32Array(nV);
  for (let t = 0; t < M.tri.length; t += 3) for (let e = 0; e < 3; e++) { const a = M.tri[t + e]; nb[nbStart[a] + fill[a]++] = M.tri[t + (e + 1) % 3]; nb[nbStart[a] + fill[a]++] = M.tri[t + (e + 2) % 3]; }
  const smooth = (A, stride, iters) => { const T = new Float32Array(A.length); for (let it = 0; it < iters; it++) { for (let i = 0; i < nV; i++) { const s0 = nbStart[i], s1 = nbStart[i + 1], inv = 0.5 / Math.max(1, s1 - s0); for (let c = 0; c < stride; c++) { let acc = 0; for (let q = s0; q < s1; q++) acc += A[nb[q] * stride + c]; T[i * stride + c] = 0.5 * A[i * stride + c] + acc * inv; } } A.set(T); } };
  smooth(W, nB, isJaw ? 0 : 5);
  if (!isJaw) { // limb-trunk creases: blend the weights over a hand's width so the fold opens as a web of skin instead of a ledge
    let c = new Float32Array(nV), c2 = new Float32Array(nV);
    for (let i = 0; i < nV; i++) { let L = 0, s = 0; for (let b = 0; b < nB; b++) { const w = W[i * nB + b]; s += w; if (b >= 23) L += w; } L /= s || 1; c[i] = Math.min(1, 6 * L * (1 - L)) * Math.min(1, Math.max(0, (0.92 - ao[i]) / 0.3)); }
    for (let it = 0; it < 9; it++) { for (let i = 0; i < nV; i++) { let m = 0; for (let q = nbStart[i]; q < nbStart[i + 1]; q++) if (c[nb[q]] > m) m = c[nb[q]]; c2[i] = Math.max(c[i], 0.86 * m); } [c, c2] = [c2, c]; }
    const act = []; for (let i = 0; i < nV; i++) if (c[i] > 0.03) act.push(i); const T = new Float32Array(act.length * nB);
    for (let it = 0; it < 45; it++) { act.forEach((i, a) => { const s0 = nbStart[i], s1 = nbStart[i + 1], inv = 1 / Math.max(1, s1 - s0), k = 0.7 * c[i]; for (let b = 0; b < nB; b++) { let acc = 0; for (let q = s0; q < s1; q++) acc += W[nb[q] * nB + b]; T[a * nB + b] = W[i * nB + b] + k * (acc * inv - W[i * nB + b]); } }); act.forEach((i, a) => { for (let b = 0; b < nB; b++) W[i * nB + b] = T[a * nB + b]; }); }
  }
  smooth(soft, 1, 4); smooth(loose, 1, 6); smooth(mus, nM, 2); smooth(ao, 1, 1);
  const si = new Uint8Array(nV * 4), sw = new Float32Array(nV * 4), mi = new Uint8Array(nV * 4), mw = new Float32Array(nV * 4), ni = new Uint8Array(nV * 4).fill(255), g5 = new Float32Array(nV), mga = new Int8Array(nV * 4), mgb = new Int8Array(nV * 4);
  for (let i = 0; i < nV; i++) {
    const t = top4(W, i * nB, nB); let s = 0; for (const v of t) s += v[0];
    t.forEach((v, c) => { si[4 * i + c] = v[1]; sw[4 * i + c] = v[0] / s; });
    top4(mus, i * nM, nM).forEach((v, c) => { mi[4 * i + c] = v[1]; mw[4 * i + c] = Math.min(1, v[0]); });
    const x = M.pos[3 * i], y = M.pos[3 * i + 1], z = M.pos[3 * i + 2], cand = [];
    for (let j = 0; j < nodes.length; j++) { const nd = nodes[j]; if (isJaw !== (nd.grp === 'J')) continue; if ((nd.grp === 'R' && z < -0.02) || (nd.grp === 'L' && z > 0.02)) continue; const d = Math.hypot(x - nd.p[0], y - nd.p[1], z - nd.p[2]); if (d < nd.R) { const g = 1 - d / nd.R; cand.push([g * g * nd.soft, j]); } }
    cand.sort((a, b) => b[0] - a[0]); cand.slice(0, 4).forEach((v, c) => { ni[4 * i + c] = v[1]; }); g5[i] = cand.length > 4 ? cand[4][0] : 0;
    // surface gradient of each muscle weight (for shading the bulge)
    const n = M.nrm.subarray(3 * i, 3 * i + 3), ax = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], t1 = norm(cross(n, ax)), t2 = cross(n, t1);
    for (let c = 0; c < 4; c++) {
      if (!(mw[4 * i + c] > 0.004)) continue; const m = mi[4 * i + c], w0 = Math.min(1, mus[i * nM + m]); let saa = 1e-9, sab = 0, sbb = 1e-9, sa = 0, sb = 0;
      for (let q = nbStart[i]; q < nbStart[i + 1]; q++) { const j = nb[q], dx = M.pos[3 * j] - x, dy = M.pos[3 * j + 1] - y, dz = M.pos[3 * j + 2] - z, a = dx * t1[0] + dy * t1[1] + dz * t1[2], b = dx * t2[0] + dy * t2[1] + dz * t2[2], dw = Math.min(1, mus[j * nM + m]) - w0; saa += a * a; sab += a * b; sbb += b * b; sa += a * dw; sb += b * dw; }
      const det = saa * sbb - sab * sab; if (Math.abs(det) < 1e-12) continue;
      const q8 = v => Math.max(-127, Math.min(127, Math.round(v * 0.06 * 127)));
      mga[4 * i + c] = q8((sa * sbb - sb * sab) / det); mgb[4 * i + c] = q8((sb * saa - sa * sab) / det);
    }
  }
  return { nV, pos: M.pos, nrm: M.nrm, tri: M.tri, si, sw, mi, mw, ni, g5, soft, loose, mat, ao, cav, mga, mgb };
}
// ---------------- skeleton (node tools/build-rex.mjs skel) ----------------
// The bones as their own surface, rigidly carried by the same joints as the flesh. Each vertex follows the bone volume it belongs to.
if (LOD === 'skel') {
  const SP = skelPrims.map(compile), h = 0.0135, [lo, hi] = bounds(SP, 0.06);
  const G = new Grid(axis(lo[0], hi[0], [], h, h), axis(Math.max(lo[1], 0), hi[1], [], h, h), symAxis(Math.max(-lo[2], hi[2]), 0, h, h));
  const D = G.field(); for (const p of SP) if (!p.carve) G.splat(D, p); for (const p of SP) if (p.carve) G.splat(D, p, true); log('skeleton field', G.nx, G.ny, G.nz);
  const M = finish(G, D, h), nV = M.nV, solid = SP.filter(p => !p.carve), si = new Uint8Array(nV * 4), sw = new Uint8Array(nV * 4), n8 = new Int8Array(nV * 4);
  for (let i = 0; i < nV; i++) {
    const x = M.pos[3 * i], y = M.pos[3 * i + 1], z = M.pos[3 * i + 2]; let best = 1e9, bp = null, bt = 0;
    for (const p of solid) { if (x < p.lo[0] - 0.05 || x > p.hi[0] + 0.05 || y < p.lo[1] - 0.05 || y > p.hi[1] + 0.05 || z < p.lo[2] - 0.05 || z > p.hi[2] + 0.05) continue; const d = p.ev(x, y, z); if (d < best) { best = d; bp = p; bt = OUT_T; } }
    const w = primBones(bp, bp.tmax ? bt : (bp.L > 1e-6 ? bt : 0)).filter(q => q[1] > 0.004), tot = w.reduce((a, q) => a + q[1], 0); let acc = 0;
    w.forEach((q, c) => { si[4 * i + c] = q[0]; const v = c === w.length - 1 ? 255 - acc : Math.round(255 * q[1] / tot); sw[4 * i + c] = v; acc += v; });
    for (let c = 0; c < 3; c++) n8[4 * i + c] = Math.round(127 * M.nrm[3 * i + c]);
  }
  const tri = Uint32Array.from(M.tri); for (let i = tri.length - 1; i > 0; i--) tri[i] = (tri[i] - tri[i - 1]) >>> 0;
  const parts = { position: Float32Array.from(M.pos), normal: n8, skinIndex: si, skinWeight: sw, index: tri }; let off = 0; const layout = {}, bufs = [];
  for (const [k, a] of Object.entries(parts)) { const pad = (4 - off % 4) % 4; if (pad) { bufs.push(Buffer.alloc(pad)); off += pad; } layout[k] = { offset: off, length: a.length }; bufs.push(Buffer.from(a.buffer, a.byteOffset, a.byteLength)); off += a.byteLength; }
  const gz = zlib.gzipSync(Buffer.concat(bufs), { level: 9 }); fs.writeFileSync('assets/skeleton.bin.gz', gz);
  fs.writeFileSync('assets/skeleton.json', JSON.stringify({ vertices: nV, triangles: tri.length / 3, gzBytes: gz.length, indexDelta: true, layout }));
  log('skeleton', nV, 'verts', tri.length / 3, 'tris', (gz.length / 1e6).toFixed(1) + 'MB gz'); process.exit(0);
}

const AB = attributes(MB, GB, DB, body, false), AJ = attributes(MJ, GJ, DJ, jawP, true), AS = attributes(MS, GS, DS, body, false); log('attributes');

// ---------------- pin the skin sheet down where a limb meets the trunk ----------------
// The coarse sheet bridges the groin and armpit, so loose skin there gets dragged by the limb and the fine mesh inherits a sawtooth.
// Skin is tightly bound to the fascia in those folds anyway: take the looseness to zero where limb and trunk weights mix.
{ const nV = AS.nV, T = AS.tri; let c = new Float32Array(nV), c2 = new Float32Array(nV);
  for (let i = 0; i < nV; i++) { let L = 0; for (let e = 0; e < 4; e++) if (AS.si[4 * i + e] >= 23) L += AS.sw[4 * i + e]; c[i] = Math.min(1, 8 * L * (1 - L)); }
  for (let it = 0; it < 2; it++) { c2.set(c); for (let t = 0; t < T.length; t += 3) for (let e = 0; e < 3; e++) { const a = T[t + e], b = T[t + (e + 1) % 3]; if (0.7 * c[b] > c2[a]) c2[a] = 0.7 * c[b]; if (0.7 * c[a] > c2[b]) c2[b] = 0.7 * c[a]; } [c, c2] = [c2, c]; }
  for (let i = 0; i < nV; i++) AS.loose[i] *= 1 - c[i]; }

// ---------------- relax the limb-trunk creases ----------------
// Where a limb meets the trunk the implicit surface folds into a crevice a few cells wide, and the mesher leaves a sawtooth along its floor
// that shows as a ragged flap once the limb swings away. Relaxing just those vertices turns the crevice into a continuous web of skin.
{ const nV = AB.nV, T = AB.tri, P = AB.pos, deg = new Uint32Array(nV), st = new Uint32Array(nV + 1); for (let t = 0; t < T.length; t++) deg[T[t]] += 2;
  for (let i = 0; i < nV; i++) st[i + 1] = st[i] + deg[i]; const nb = new Uint32Array(st[nV]), fl = new Uint32Array(nV);
  for (let t = 0; t < T.length; t += 3) for (let e = 0; e < 3; e++) { const a = T[t + e]; nb[st[a] + fl[a]++] = T[t + (e + 1) % 3]; nb[st[a] + fl[a]++] = T[t + (e + 2) % 3]; }
  let c = new Float32Array(nV), c2 = new Float32Array(nV), n = 0;
  for (let i = 0; i < nV; i++) { let L = 0; for (let e = 0; e < 4; e++) if (AB.si[4 * i + e] >= 23) L += AB.sw[4 * i + e]; c[i] = Math.min(1, 6 * L * (1 - L)) * Math.min(1, Math.max(0, (0.92 - AB.ao[i]) / 0.32)); }
  for (let it = 0; it < 3; it++) { for (let i = 0; i < nV; i++) { let a = 0; for (let q = st[i]; q < st[i + 1]; q++) a += c[nb[q]]; c2[i] = Math.max(c[i], 0.5 * c[i] + 0.5 * a / Math.max(1, deg[i])); } [c, c2] = [c2, c]; }
  const Q = new Float32Array(P.length);
  for (let it = 0; it < 14; it++) { for (let i = 0; i < nV; i++) { if (c[i] < 0.02) { Q[3 * i] = P[3 * i]; Q[3 * i + 1] = P[3 * i + 1]; Q[3 * i + 2] = P[3 * i + 2]; continue; } let x = 0, y = 0, z = 0; for (let q = st[i]; q < st[i + 1]; q++) { const j = nb[q]; x += P[3 * j]; y += P[3 * j + 1]; z += P[3 * j + 2]; } const k = 0.65 * c[i], d = 1 / deg[i]; Q[3 * i] = P[3 * i] + k * (x * d - P[3 * i]); Q[3 * i + 1] = P[3 * i + 1] + k * (y * d - P[3 * i + 1]); Q[3 * i + 2] = P[3 * i + 2] + k * (z * d - P[3 * i + 2]); } P.set(Q); }
  for (let i = 0; i < nV; i++) if (c[i] > 0.02) n++; log('crease relaxation on', n, 'vertices'); }

// ---------------- merge body + jaw ----------------
const cat = (a, b, T) => { const r = new T(a.length + b.length); r.set(a); r.set(b, a.length); return r; };
const A = { nV: AB.nV + AJ.nV }; for (const k of ['pos', 'nrm', 'sw', 'mw', 'g5', 'soft', 'loose', 'ao', 'cav']) A[k] = cat(AB[k], AJ[k], Float32Array);
for (const k of ['si', 'mi', 'ni', 'mat']) A[k] = cat(AB[k], AJ[k], Uint8Array); for (const k of ['mga', 'mgb']) A[k] = cat(AB[k], AJ[k], Int8Array);
A.tri = new Uint32Array(AB.tri.length + AJ.tri.length); A.tri.set(AB.tri); for (let i = 0; i < AJ.tri.length; i++) A.tri[AB.tri.length + i] = AJ.tri[i] + AB.nV;
const nV0 = A.nV, pos0 = A.pos.slice(), nrm0 = A.nrm;

// ---------------- look-development inputs per vertex ----------------
// axial coordinate along the underlying bone chain, bone axis, body-region weights, joint proximity, material masks
const bix = n => bones.findIndex(b => b.name === n), bp = n => bones[bix(n)].p;
const axisTab = bones.map(() => null);
const chain = (pts, names, s0) => { let s = s0; for (let k = 0; k < names.length; k++) { const d = norm(sub(pts[k + 1], pts[k])); if (names[k]) axisTab[bix(names[k])] = { o: pts[k], d, s }; s += len(sub(pts[k + 1], pts[k])); } };
{ const sp = landmarks.chains.spine, pts = [landmarks.tailTip, ...sp.map(n => n === 'pelvis' ? [0, 3.31, 0] : bp(n)), landmarks.snout];
  chain(pts.slice(1), sp, len(sub(pts[1], pts[0]))); axisTab[bix('jaw')] = { o: bp('jaw'), d: axisTab[bix('head')].d, s: 20 };
  for (const [S, s] of [['R', 1], ['L', -1]]) { const L = landmarks.leg, Pz = p => [p[0], p[1], p[2] * s], D = landmarks.digits;
    chain([Pz(L.H), Pz(L.K), Pz(L.A), Pz(L.M), Pz(D.d3[1])], ['femur_' + S, 'tibia_' + S, 'mt_' + S], s > 0 ? 30 : 40);
    for (const [j, d] of ['d2', 'd3', 'd4'].entries()) chain([Pz(D[d][0]), Pz(D[d][1]), Pz(D[d][3])], [d + 'a_' + S, d + 'b_' + S], (s > 0 ? 50 : 60) + j * 3);
    const hu = bp('humerus_' + S), fa = bp('forearm_' + S), ha = bp('hand_' + S); chain([hu, fa, ha, add(ha, mul(norm(sub(ha, fa)), 0.3))], ['humerus_' + S, 'forearm_' + S, 'hand_' + S], s > 0 ? 70 : 80); } }
const REG = ['rHead', 'rNeck', 'rTorso', 'rTail', 'rThigh', 'rShank', 'rMt', 'rFoot', 'rArm'];
const regOf = bones.map(b => /^(head|jaw)$/.test(b.name) ? 0 : /^neck/.test(b.name) ? 1 : /^(pelvis|dors)/.test(b.name) ? 2 : /^tail/.test(b.name) ? 3 : /^femur/.test(b.name) ? 4 : /^tibia/.test(b.name) ? 5 : /^mt/.test(b.name) ? 6 : /^d\d/.test(b.name) ? 7 : 8);
const limbRank = bones.map(b => /^pelvis/.test(b.name) ? 0 : /^femur/.test(b.name) ? 1 : /^tibia/.test(b.name) ? 2 : /^mt/.test(b.name) ? 3 : /^d\da/.test(b.name) ? 4 : /^d\db/.test(b.name) ? 5 : -1);
const FIELDS = ['a', 'dx', 'dy', 'dz', 'loose', 'soft', 'joint', ...REG, 'mKer', 'mMouth', 'mPad', 'mDark', 'mTongue', 'ao'], K = FIELDS.length, FI = Object.fromEntries(FIELDS.map((f, i) => [f, i]));
function lookAttrs(X) {
  const n = X.nV, L = new Float32Array(n * K);
  for (let i = 0; i < n; i++) {
    const o = i * K, x = X.pos[3 * i], y = X.pos[3 * i + 1], z = X.pos[3 * i + 2]; let a = 0, dx = 0, dy = 0, dz = 0, joint = 0;
    for (let c = 0; c < 4; c++) { const w = X.sw[4 * i + c]; if (w <= 0) continue; const b = X.si[4 * i + c], t = axisTab[b]; a += w * (t.s + (x - t.o[0]) * t.d[0] + (y - t.o[1]) * t.d[1] + (z - t.o[2]) * t.d[2]); dx += w * t.d[0]; dy += w * t.d[1]; dz += w * t.d[2]; L[o + FI.rHead + regOf[b]] += w;
      for (let e = c + 1; e < 4; e++) { const w2 = X.sw[4 * i + e], b2 = X.si[4 * i + e]; if (w2 > 0 && limbRank[b] >= 0 && limbRank[b2] >= 0 && Math.abs(limbRank[b] - limbRank[b2]) === 1) joint += 4 * w * w2 * (limbRank[b] + limbRank[b2] === 1 ? 0.5 : 1); } }
    const dl = Math.hypot(dx, dy, dz) || 1; L[o] = a; L[o + 1] = dx / dl; L[o + 2] = dy / dl; L[o + 3] = dz / dl; L[o + FI.loose] = X.loose[i]; L[o + FI.soft] = X.soft[i]; L[o + FI.joint] = Math.min(1, joint); L[o + FI.ao] = X.ao[i];
    const m = X.mat[i]; if (m === 1) L[o + FI.mKer] = 1; else if (m === 2) L[o + FI.mMouth] = 1; else if (m === 3) L[o + FI.mPad] = 1; else if (m === 4) L[o + FI.mDark] = 1; else if (m === 5) L[o + FI.mTongue] = 1;
  }
  return L;
}
const LK = lookAttrs(A);
{ // soften material masks and joint proximity across the mesh so textures have no hard steps
  const nbr = Array.from({ length: nV0 }, () => []); for (let t = 0; t < A.tri.length; t += 3) for (let e = 0; e < 3; e++) nbr[A.tri[t + e]].push(A.tri[t + (e + 1) % 3]);
  for (const f of ['mKer', 'mMouth', 'mPad', 'mDark', 'mTongue', 'joint']) for (let it = 0; it < (f === 'joint' ? 3 : 1); it++) { const c = FI[f], T = new Float32Array(nV0); for (let i = 0; i < nV0; i++) { let s = LK[i * K + c]; for (const j of nbr[i]) s += LK[j * K + c]; T[i] = s / (nbr[i].length + 1); } for (let i = 0; i < nV0; i++) LK[i * K + c] = T[i]; }
}
const sampleOf = (L, o, S) => { for (let c = 0; c < K; c++) S[FIELDS[c]] = L[o + c]; return S; };

// ---------------- relief into the geometry ----------------
{ const S = {}; let mx = 0;
  for (let i = 0; i < nV0; i++) { sampleOf(LK, i * K, S); S.x = pos0[3 * i]; S.y = pos0[3 * i + 1]; S.z = pos0[3 * i + 2]; S.nx = nrm0[3 * i]; S.ny = nrm0[3 * i + 1]; S.nz = nrm0[3 * i + 2];
    const h = macro(S); mx = Math.max(mx, Math.abs(h)); A.pos[3 * i] += S.nx * h; A.pos[3 * i + 1] += S.ny * h; A.pos[3 * i + 2] += S.nz * h; }
  log('geometry relief, max', (mx * 1000).toFixed(1), 'mm'); }
const gN = new Float32Array(nV0 * 3);
for (let t = 0; t < A.tri.length; t += 3) { const a = 3 * A.tri[t], b = 3 * A.tri[t + 1], c = 3 * A.tri[t + 2], P_ = A.pos; const ux = P_[b] - P_[a], uy = P_[b + 1] - P_[a + 1], uz = P_[b + 2] - P_[a + 2], vx = P_[c] - P_[a], vy = P_[c + 1] - P_[a + 1], vz = P_[c + 2] - P_[a + 2], nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; for (const q of [a, b, c]) { gN[q] += nx; gN[q + 1] += ny; gN[q + 2] += nz; } }
for (let i = 0; i < nV0; i++) { const l = Math.hypot(gN[3 * i], gN[3 * i + 1], gN[3 * i + 2]) || 1; gN[3 * i] /= l; gN[3 * i + 1] /= l; gN[3 * i + 2] /= l; }

// ---------------- bind every fine vertex to the skin sheet ----------------
const sk = { n: AS.nV, pos: AS.pos, tri: AS.tri };
const bindI = new Uint16Array(nV0 * 4), bindW = new Uint8Array(nV0 * 4);
{ const cell = 0.16, key = (i, j, k) => (i + 512) + 1024 * ((j + 512) + 1024 * (k + 512)), hash = new Map(), P_ = sk.pos;
  for (let t = 0; t < sk.tri.length; t += 3) { const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; for (let e = 0; e < 3; e++) for (let c = 0; c < 3; c++) { const v = P_[3 * sk.tri[t + e] + c]; if (v < lo[c]) lo[c] = v; if (v > hi[c]) hi[c] = v; }
    for (let i = Math.floor(lo[0] / cell); i <= Math.floor(hi[0] / cell); i++) for (let j = Math.floor(lo[1] / cell); j <= Math.floor(hi[1] / cell); j++) for (let k = Math.floor(lo[2] / cell); k <= Math.floor(hi[2] / cell); k++) { const q = key(i, j, k); let l = hash.get(q); if (!l) hash.set(q, l = []); l.push(t); } }
  const cp = (p, a, b, c) => { // closest point on triangle -> barycentrics (Ericson)
    const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a), d1 = dot(ab, ap), d2 = dot(ac, ap); if (d1 <= 0 && d2 <= 0) return [1, 0, 0];
    const bq = sub(p, b), d3 = dot(ab, bq), d4 = dot(ac, bq); if (d3 >= 0 && d4 <= d3) return [0, 1, 0];
    const vc = d1 * d4 - d3 * d2; if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return [1 - v, v, 0]; }
    const cq = sub(p, c), d5 = dot(ab, cq), d6 = dot(ac, cq); if (d6 >= 0 && d5 <= d6) return [0, 0, 1];
    const vb = d5 * d2 - d1 * d6; if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return [1 - w, 0, w]; }
    const va = d3 * d6 - d5 * d4; if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + d5 - d6); return [0, 1 - w, w]; }
    const dn = 1 / (va + vb + vc), v = vb * dn, w = vc * dn; return [1 - v - w, v, w]; };
  // a crease (thigh against belly) puts two different sheets within reach of one vertex: prefer the triangle that faces the same way and is carried by the same bones
  const tN = new Float32Array(sk.tri.length), tW = new Map();
  for (let t = 0; t < sk.tri.length; t += 3) { const a = sk.tri[t], b = sk.tri[t + 1], c = sk.tri[t + 2], e1 = [P_[3 * b] - P_[3 * a], P_[3 * b + 1] - P_[3 * a + 1], P_[3 * b + 2] - P_[3 * a + 2]], e2 = [P_[3 * c] - P_[3 * a], P_[3 * c + 1] - P_[3 * a + 1], P_[3 * c + 2] - P_[3 * a + 2]];
    let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0]; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    if (nx * (AS.nrm[3 * a] + AS.nrm[3 * b] + AS.nrm[3 * c]) + ny * (AS.nrm[3 * a + 1] + AS.nrm[3 * b + 1] + AS.nrm[3 * c + 1]) + nz * (AS.nrm[3 * a + 2] + AS.nrm[3 * b + 2] + AS.nrm[3 * c + 2]) < 0) { nx = -nx; ny = -ny; nz = -nz; }
    tN[t] = nx; tN[t + 1] = ny; tN[t + 2] = nz;
    const m = new Map(); for (const v of [a, b, c]) for (let e = 0; e < 4; e++) m.set(AS.si[4 * v + e], (m.get(AS.si[4 * v + e]) || 0) + AS.sw[4 * v + e] / 3); tW.set(t, m); }
  let bound = 0;
  for (let i = 0; i < AB.nV; i++) { const p = [pos0[3 * i], pos0[3 * i + 1], pos0[3 * i + 2]], ci = Math.floor(p[0] / cell), cj = Math.floor(p[1] / cell), ck = Math.floor(p[2] / cell); let best = 1e9, bt = -1, bb = null;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) { const l = hash.get(key(ci + a, cj + b, ck + c)); if (!l) continue; for (const t of l) { const A_ = P_.subarray(3 * sk.tri[t], 3 * sk.tri[t] + 3), B_ = P_.subarray(3 * sk.tri[t + 1], 3 * sk.tri[t + 1] + 3), C_ = P_.subarray(3 * sk.tri[t + 2], 3 * sk.tri[t + 2] + 3), w = cp(p, A_, B_, C_);
      const dx = w[0] * A_[0] + w[1] * B_[0] + w[2] * C_[0] - p[0], dy = w[0] * A_[1] + w[1] * B_[1] + w[2] * C_[1] - p[1], dz = w[0] * A_[2] + w[1] * B_[2] + w[2] * C_[2] - p[2], d = dx * dx + dy * dy + dz * dz; if (d > 0.11 * 0.11) continue;
      const nd = AB.nrm[3 * i] * tN[t] + AB.nrm[3 * i + 1] * tN[t + 1] + AB.nrm[3 * i + 2] * tN[t + 2]; if (nd < 0.15) continue;
      let ov = 0; const m = tW.get(t); for (let e = 0; e < 4; e++) ov += Math.min(AB.sw[4 * i + e], m.get(AB.si[4 * i + e]) || 0);
      const cost = (d + 4e-4) * (1 + 3 * (1 - nd)) * (1 + 6 * (1 - Math.min(1, ov))); if (cost < best) { best = cost; bt = t; bb = w; } } }
    if (bt >= 0) { bound++; for (let e = 0; e < 3; e++) bindI[4 * i + e] = sk.tri[bt + e]; const q0 = Math.round(255 * bb[0]), q1 = Math.round(255 * bb[1]); bindW[4 * i] = q0; bindW[4 * i + 1] = q1; bindW[4 * i + 2] = 255 - q0 - q1; bindW[4 * i + 3] = 255; } }
  log('bound to skin sheet', bound, 'of', AB.nV); }
// skin sheet edges
const skEdges = []; { const seen = new Set(); for (let t = 0; t < sk.tri.length; t += 3) for (let e = 0; e < 3; e++) { const a = sk.tri[t + e], b = sk.tri[t + (e + 1) % 3], k = a < b ? a * 65536 + b : b * 65536 + a; if (!seen.has(k)) { seen.add(k); skEdges.push(Math.min(a, b), Math.max(a, b)); } } }

// ---------------- UV atlas ----------------
const dens = new Float32Array(nV0); for (let i = 0; i < nV0; i++) dens[i] = 1 + 0.75 * LK[i * K + FI.rHead] + 0.25 * (LK[i * K + FI.rFoot] + LK[i * K + FI.rMt]);
const U = unwrap(A.pos, A.tri, dens, TEX, TEX >= 4096 ? 4 : 3, log), nV = U.xref.length, X = U.xref;
const re = (src, stride, T) => { const r = new T(nV * stride); for (let i = 0; i < nV; i++) for (let c = 0; c < stride; c++) r[i * stride + c] = src[X[i] * stride + c]; return r; };

// ---------------- export mesh ----------------
const q16 = new Uint16Array(nV * 4), swR = re(A.sw, 4, Float32Array);
for (let i = 0; i < nV; i++) { let acc = 0, last = 0; for (let c = 0; c < 4; c++) { const v = Math.round(65535 * swR[4 * i + c]); q16[4 * i + c] = v; acc += v; if (v > 0) last = c; } q16[4 * i + last] += 65535 - acc; }
const nrm8 = new Int8Array(nV * 4); for (let i = 0; i < nV; i++) for (let c = 0; c < 3; c++) nrm8[4 * i + c] = Math.round(127 * gN[3 * X[i] + c]);
const uv16 = new Uint16Array(nV * 2); for (let i = 0; i < nV * 2; i++) uv16[i] = Math.round(65535 * U.uv[i]);
const mw8 = new Uint8Array(nV * 4), misc = new Uint8Array(nV * 4), misc2 = new Uint8Array(nV * 4);
for (let i = 0; i < nV; i++) { const o = X[i]; for (let c = 0; c < 4; c++) mw8[4 * i + c] = Math.round(255 * A.mw[4 * o + c]); misc[4 * i] = A.mat[o]; misc[4 * i + 1] = Math.round(255 * A.ao[o]); misc[4 * i + 2] = Math.round(255 * A.cav[o]); misc[4 * i + 3] = Math.round(255 * Math.min(1, A.soft[o])); misc2[4 * i] = Math.round(255 * Math.min(1, A.g5[o])); misc2[4 * i + 1] = Math.round(255 * Math.min(1, A.loose[o])); }
const tri = U.tri.slice(), nTri = tri.length / 3; for (let i = tri.length - 1; i > 0; i--) tri[i] = (tri[i] - tri[i - 1]) >>> 0;   // delta-code for compression
const c8 = (a) => { const r = new Uint8Array(a.length); for (let i = 0; i < a.length; i++) r[i] = Math.round(255 * Math.min(1, a[i])); return r; };
const parts = { position: re(A.pos, 3, Float32Array), normal: nrm8, uv: uv16, skinIndex: re(A.si, 4, Uint8Array), skinWeight: q16, musIndex: re(A.mi, 4, Uint8Array), musWeight: mw8, musGradA: re(A.mga, 4, Int8Array), musGradB: re(A.mgb, 4, Int8Array),
  nodeIndex: re(A.ni, 4, Uint8Array), misc, misc2, bindIndex: re(bindI, 4, Uint16Array), bindWeight: re(bindW, 4, Uint8Array), index: tri,
  // simulated skin sheet
  s_position: AS.pos, s_normal: AS.nrm, s_skinIndex: AS.si, s_skinWeight: AS.sw, s_musIndex: AS.mi, s_musWeight: AS.mw, s_nodeIndex: AS.ni, s_g5: AS.g5, s_loose: AS.loose, s_soft: AS.soft, s_edge: Uint16Array.from(skEdges), s_tri: Uint16Array.from(AS.tri) };
let off = 0; const layout = {}, bufs = [];
for (const [k, a] of Object.entries(parts)) { const b = Buffer.from(a.buffer, a.byteOffset, a.byteLength); layout[k] = { offset: off, length: a.length, type: a.constructor.name }; bufs.push(b); off += b.length; const pad = (4 - off % 4) % 4; if (pad) { bufs.push(Buffer.alloc(pad)); off += pad; } }
fs.mkdirSync('assets', { recursive: true });
const gz = zlib.gzipSync(Buffer.concat(bufs), { level: 9 }); fs.writeFileSync(`assets/rex-${LOD}.bin.gz`, gz);
const r4 = v => Array.isArray(v) ? v.map(r4) : typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v;
const meta = { vertices: nV, triangles: nTri, gzBytes: gz.length, indexDelta: true, layout, texture: { size: TEX, texelsPerMeter: Math.round(U.texelsPerMeter) }, skin: { vertices: AS.nV, edges: skEdges.length / 2 },
  bones: bones.map(b => ({ name: b.name, parent: b.parent, p: r4(b.p) })), muscles: musNames,
  nodes: nodes.map(n => ({ p: r4(n.p), R: r4(n.R), f: n.f, soft: n.soft, bones: n.bones.map(b => [b[0], r4(b[1])]), mus: n.mus ? musIdx[n.mus] : -1, nb: n.nb })), landmarks: r4(landmarks) };
fs.writeFileSync(`assets/rex-${LOD}.json`, JSON.stringify(meta));
log('wrote mesh', (off / 1e6).toFixed(1) + 'MB raw,', (gz.length / 1e6).toFixed(1) + 'MB gz, verts', nV, 'tris', nTri);

// ---------------- bake textures ----------------
if (process.argv[4] !== 'nobake') {
  await bake({ prefix: `assets/rex-${LOD}`, res: TEX, pos0, nrm0, look: LK, K, FIELDS, xref: X, uv: U.uv, tri: U.tri, eps: Math.min(0.004, Math.max(0.0012, 1 / U.texelsPerMeter)), log });
  await bakeDetail('assets/skin-detail', 1024, log);
}
log('done');
