// Builds the T. rex surface from the anatomical primitive set:
//   implicit union of muscle/bone volumes -> surface nets -> skin weights,
//   per-vertex muscle-bulge weights, soft-tissue lattice binding, AO.
// usage: node tools/build-rex.mjs [hi|lo]
import fs from 'fs';
import zlib from 'zlib';
import { add, sub, mul, dot, cross, len, norm, lerp, sstep } from './vec.mjs';
import { bones, prims, landmarks, jawMat } from './anatomy.mjs';

const LOD = process.argv[2] || 'hi';
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
function axis(lo, hi, fineRanges) {
  const xs = []; let x = lo;
  while (x < hi) { xs.push(x); const mid = x + FINE * 0.5; x += fineRanges.some(r => mid >= r[0] && mid <= r[1]) ? FINE : COARSE; }
  xs.push(x); return Float64Array.from(xs);
}
function symAxis(hi, fineHi) {
  const h = []; let z = 0; while (z < hi) { z += z < fineHi ? FINE : COARSE; h.push(z); }
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
const GB = new Grid(axis(blo[0], bhi[0], [[3.85, 5.7], [0.15, 1.3]]), axis(Math.max(blo[1], -0.08), bhi[1], [[3.3, 4.8], [-0.1, 0.42]]), symAxis(Math.max(-blo[2], bhi[2]), 0.86));
log('body grid', GB.nx, GB.ny, GB.nz, (GB.n / 1e6).toFixed(1) + 'M');
let DC = GB.field();
for (const p of body) if (p.grp === 'C' && !p.carve) GB.splat(DC, p);
const DR = DC.slice(), DL = DC; // DL reuses DC
for (const p of body) if (p.grp === 'R') GB.splat(DR, p);
for (const p of body) if (p.grp === 'L') GB.splat(DL, p);
for (let i = 0; i < GB.n; i++) if (DR[i] < DL[i]) DL[i] = DR[i];
const DB = DL;
for (const p of body) if (p.carve) GB.splat(DB, p, true);
log('body field done');
const [jlo, jhi] = bounds(jawP, 0.1);
const GJ = new Grid(axis(jlo[0], jhi[0], [[-99, 99]]), axis(jlo[1], jhi[1], [[-99, 99]]), symAxis(Math.max(-jlo[2], jhi[2]), 99));
const DJ = GJ.field(); for (const p of jawP) GJ.splat(DJ, p);
log('jaw grid', GJ.nx, GJ.ny, GJ.nz);

function finish(G, D, h) {
  const m = surfaceNets(G, D), nV = m.pos.length / 3, nrm = new Float32Array(nV * 3);
  for (let i = 0; i < nV; i++) {
    let x = m.pos[3 * i], y = m.pos[3 * i + 1], z = m.pos[3 * i + 2], g;
    for (let it = 0; it < 2; it++) { g = norm(G.grad(D, x, y, z, h * 0.5)); const d = G.sample(D, x, y, z); x -= g[0] * d; y -= g[1] * d; z -= g[2] * d; }
    g = norm(G.grad(D, x, y, z, h));
    m.pos[3 * i] = x; m.pos[3 * i + 1] = y; m.pos[3 * i + 2] = z; nrm.set(g, 3 * i);
  }
  // orientation check
  let agree = 0;
  for (let t = 0; t < Math.min(3000, m.tri.length / 3); t++) { const a = m.tri[3 * t], b = m.tri[3 * t + 1], c = m.tri[3 * t + 2]; const pa = m.pos.subarray(3 * a, 3 * a + 3), pb = m.pos.subarray(3 * b, 3 * b + 3), pc = m.pos.subarray(3 * c, 3 * c + 3); const n = cross(sub(pb, pa), sub(pc, pa)); agree += Math.sign(dot(n, nrm.subarray(3 * a, 3 * a + 3))); }
  if (agree < 0) for (let t = 0; t < m.tri.length; t += 3) { const q = m.tri[t + 1]; m.tri[t + 1] = m.tri[t + 2]; m.tri[t + 2] = q; }
  return { ...m, nrm, nV };
}
const MB = finish(GB, DB, FINE), MJ = finish(GJ, DJ, FINE);
{ let vol = 0; const q = MB.pos, t = MB.tri; for (let i = 0; i < t.length; i += 3) { const a = 3 * t[i], b = 3 * t[i + 1], c = 3 * t[i + 2]; vol += q[a] * (q[b + 1] * q[c + 2] - q[b + 2] * q[c + 1]) - q[a + 1] * (q[b] * q[c + 2] - q[b + 2] * q[c]) + q[a + 2] * (q[b] * q[c + 1] - q[b + 1] * q[c]); } log('body volume m^3', (vol / 6).toFixed(2), '-> mass at 950 kg/m^3:', Math.round(vol / 6 * 950), 'kg'); }
log('verts', MB.nV, MJ.nV, 'tris', MB.tri.length / 3, MJ.tri.length / 3);

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
for (const n of nodes) { n.nb = []; }
for (let i = 0; i < nodes.length; i++) {
  const c = []; for (let j = 0; j < nodes.length; j++) if (i !== j) { const d = len(sub(nodes[i].p, nodes[j].p)); if (d < 0.75) c.push([d, j]); }
  c.sort((a, b) => a[0] - b[0]); nodes[i].nb = c.slice(0, 5).map(v => v[1]);
}
log('nodes', nodes.length);

// ---------------- vertex attributes ----------------
const musNames = [...new Set(P.map(p => p.mus).filter(Boolean))];
const musIdx = Object.fromEntries(musNames.map((m, i) => [m, i]));
const nB = bones.length, nM = musNames.length;
log('muscle groups', nM);
function attributes(M, G, D, list, isJaw) {
  const nV = M.nV, W = new Float32Array(nV * nB), mus = new Float32Array(nV * nM);
  const soft = new Float32Array(nV), mat = new Uint8Array(nV), ao = new Uint8Array(nV), cav = new Uint8Array(nV);
  const KW = 0.05, KM = 0.07;
  for (let i = 0; i < nV; i++) {
    const x = M.pos[3 * i], y = M.pos[3 * i + 1], z = M.pos[3 * i + 2];
    let dmin = 1e9, mm = 0, ws = 0, ss = 0, carved = -1;
    for (const p of list) {
      if (x < p.lo[0] - 0.3 || x > p.hi[0] + 0.3 || y < p.lo[1] - 0.3 || y > p.hi[1] + 0.3 || z < p.lo[2] - 0.3 || z > p.hi[2] + 0.3) continue;
      const d = p.ev(x, y, z), t = OUT_T;
      if (p.carve) { if (d < 0.012 && p.mat) carved = p.mat; continue; }
      const w = Math.exp(-Math.max(d, 0) / KW);
      if (w > 1e-4) { for (const [b, bw] of primBones(p, t)) W[i * nB + b] += w * bw; ws += w; ss += w * p.soft; }
      if (d < dmin) { dmin = d; mm = p.mat; }
      if (p.mus) { const v = Math.exp(-Math.max(d, 0) / KM) * Math.min(1, Math.min(p.rwf(t), p.rhf(t)) / 0.3); const o = i * nM + musIdx[p.mus]; if (v > mus[o]) mus[o] = v; }
    }
    soft[i] = ws > 0 ? ss / ws : 0;
    mat[i] = carved >= 0 ? carved : mm;
    const n = M.nrm.subarray(3 * i, 3 * i + 3);
    if (isJaw && mat[i] === 0) mat[i] = jawMat(x, y, z);
    // ambient occlusion from the distance field
    let occ = 0, occS = 0;
    for (const [h, wgt] of [[0.03, 1], [0.08, 0.8], [0.18, 0.6], [0.36, 0.45]]) { const d = G.sample(D, x + n[0] * h, y + n[1] * h, z + n[2] * h); if (d < 50) { const o = Math.max(0, h - d) / h; occ += o * wgt; if (h < 0.1) occS += o; } }
    ao[i] = Math.round(255 * Math.max(0, 1 - occ * 0.55));
    cav[i] = Math.round(255 * Math.min(1, occS * 0.6));
  }
  // smooth skin weights + softness over the mesh
  const nbStart = new Uint32Array(nV + 1), deg = new Uint32Array(nV);
  for (let t = 0; t < M.tri.length; t += 3) for (let e = 0; e < 3; e++) deg[M.tri[t + e]] += 2;
  for (let i = 0; i < nV; i++) nbStart[i + 1] = nbStart[i] + deg[i];
  const nb = new Uint32Array(nbStart[nV]), fill = new Uint32Array(nV);
  for (let t = 0; t < M.tri.length; t += 3) for (let e = 0; e < 3; e++) { const a = M.tri[t + e]; nb[nbStart[a] + fill[a]++] = M.tri[t + (e + 1) % 3]; nb[nbStart[a] + fill[a]++] = M.tri[t + (e + 2) % 3]; }
  const smooth = (A, stride, iters) => { const T = new Float32Array(A.length); for (let it = 0; it < iters; it++) { for (let i = 0; i < nV; i++) { const s0 = nbStart[i], s1 = nbStart[i + 1], inv = 0.5 / Math.max(1, s1 - s0); for (let c = 0; c < stride; c++) { let acc = 0; for (let q = s0; q < s1; q++) acc += A[nb[q] * stride + c]; T[i * stride + c] = 0.5 * A[i * stride + c] + acc * inv; } } A.set(T); } };
  smooth(W, nB, isJaw ? 0 : 5); smooth(soft, 1, 4); smooth(mus, nM, 2);
  const top4 = (A, off, n) => { const r = []; for (let c = 0; c < n; c++) { const v = A[off + c]; if (v > 1e-4) r.push([v, c]); } r.sort((a, b) => b[0] - a[0]); return r.slice(0, 4); };
  const si = new Uint8Array(nV * 4), sw = new Uint8Array(nV * 4), mi = new Uint8Array(nV * 4), mw = new Uint8Array(nV * 4), ni = new Uint8Array(nV * 4).fill(255), misc = new Uint8Array(nV * 4), mga = new Int8Array(nV * 4), mgb = new Int8Array(nV * 4);
  for (let i = 0; i < nV; i++) {
    const t = top4(W, i * nB, nB); let s = 0; for (const v of t) s += v[0];
    let acc = 0; t.forEach((v, c) => { si[4 * i + c] = v[1]; const q = c === t.length - 1 ? 255 - acc : Math.round(255 * v[0] / s); sw[4 * i + c] = Math.max(0, q); acc += sw[4 * i + c]; });
    top4(mus, i * nM, nM).forEach((v, c) => { mi[4 * i + c] = v[1]; mw[4 * i + c] = Math.round(255 * Math.min(1, v[0])); });
    const x = M.pos[3 * i], y = M.pos[3 * i + 1], z = M.pos[3 * i + 2], cand = [];
    for (let j = 0; j < nodes.length; j++) { const nd = nodes[j]; if (isJaw !== (nd.grp === 'J')) continue; if ((nd.grp === 'R' && z < -0.02) || (nd.grp === 'L' && z > 0.02)) continue; const d = Math.hypot(x - nd.p[0], y - nd.p[1], z - nd.p[2]); if (d < nd.R) { const g = 1 - d / nd.R; cand.push([g * g * nd.soft, j]); } }
    cand.sort((a, b) => b[0] - a[0]); cand.slice(0, 4).forEach((v, c) => { ni[4 * i + c] = v[1]; });
    // surface gradient of each muscle weight (for shading the bulge)
    const n = M.nrm.subarray(3 * i, 3 * i + 3), ax = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], t1 = norm(cross(n, ax)), t2 = cross(n, t1);
    for (let c = 0; c < 4; c++) {
      if (!mw[4 * i + c]) continue; const m = mi[4 * i + c], w0 = Math.min(1, mus[i * nM + m]); let saa = 1e-9, sab = 0, sbb = 1e-9, sa = 0, sb = 0;
      for (let q = nbStart[i]; q < nbStart[i + 1]; q++) { const j = nb[q], dx = M.pos[3 * j] - x, dy = M.pos[3 * j + 1] - y, dz = M.pos[3 * j + 2] - z, a = dx * t1[0] + dy * t1[1] + dz * t1[2], b = dx * t2[0] + dy * t2[1] + dz * t2[2], dw = Math.min(1, mus[j * nM + m]) - w0; saa += a * a; sab += a * b; sbb += b * b; sa += a * dw; sb += b * dw; }
      const det = saa * sbb - sab * sab; if (Math.abs(det) < 1e-12) continue;
      const q8 = v => Math.max(-127, Math.min(127, Math.round(v * 0.06 * 127)));
      mga[4 * i + c] = q8((sa * sbb - sb * sab) / det); mgb[4 * i + c] = q8((sb * saa - sa * sab) / det);
    }
    misc[4 * i] = mat[i]; misc[4 * i + 1] = ao[i]; misc[4 * i + 2] = cav[i]; misc[4 * i + 3] = Math.round(255 * Math.min(1, soft[i]));
  }
  return { si, sw, mi, mw, ni, misc, mga, mgb };
}
const AB = attributes(MB, GB, DB, body, false); log('body attrs');
const AJ = attributes(MJ, GJ, DJ, jawP, true); log('jaw attrs');

// ---------------- merge + export ----------------
const nV = MB.nV + MJ.nV, cat = (a, b, T) => { const r = new T(a.length + b.length); r.set(a); r.set(b, a.length); return r; };
const pos = cat(MB.pos, MJ.pos, Float32Array);
const nrm8 = new Int8Array(nV * 4); { const n = cat(MB.nrm, MJ.nrm, Float32Array); for (let i = 0; i < nV; i++) for (let c = 0; c < 3; c++) nrm8[4 * i + c] = Math.round(127 * n[3 * i + c]); }
const tri = new Uint32Array(MB.tri.length + MJ.tri.length); tri.set(MB.tri); for (let i = 0; i < MJ.tri.length; i++) tri[MB.tri.length + i] = MJ.tri[i] + MB.nV;
const nTri = tri.length / 3; for (let i = tri.length - 1; i > 0; i--) tri[i] = (tri[i] - tri[i - 1]) >>> 0;   // delta-code for compression
const parts = { position: pos, normal: nrm8, skinIndex: cat(AB.si, AJ.si, Uint8Array), skinWeight: cat(AB.sw, AJ.sw, Uint8Array), musIndex: cat(AB.mi, AJ.mi, Uint8Array), musWeight: cat(AB.mw, AJ.mw, Uint8Array), nodeIndex: cat(AB.ni, AJ.ni, Uint8Array), musGradA: cat(AB.mga, AJ.mga, Int8Array), musGradB: cat(AB.mgb, AJ.mgb, Int8Array), misc: cat(AB.misc, AJ.misc, Uint8Array), index: tri };
let off = 0; const layout = {}, bufs = [];
for (const [k, a] of Object.entries(parts)) { const b = Buffer.from(a.buffer, a.byteOffset, a.byteLength); layout[k] = { offset: off, length: a.length, type: a.constructor.name }; bufs.push(b); off += b.length; const pad = (4 - off % 4) % 4; if (pad) { bufs.push(Buffer.alloc(pad)); off += pad; } }
fs.mkdirSync('assets', { recursive: true });
const gz = zlib.gzipSync(Buffer.concat(bufs), { level: 9 }); fs.writeFileSync(`assets/rex-${LOD}.bin.gz`, gz);
const r4 = v => Array.isArray(v) ? v.map(r4) : typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v;
const meta = { vertices: nV, triangles: nTri, gzBytes: gz.length, indexDelta: true, layout, bones: bones.map(b => ({ name: b.name, parent: b.parent, p: r4(b.p) })), muscles: musNames,
  nodes: nodes.map(n => ({ p: r4(n.p), R: r4(n.R), f: n.f, soft: n.soft, bones: n.bones.map(b => [b[0], r4(b[1])]), mus: n.mus ? musIdx[n.mus] : -1, nb: n.nb })), landmarks: r4(landmarks) };
fs.writeFileSync(`assets/rex-${LOD}.json`, JSON.stringify(meta));
log('wrote', `assets/rex-${LOD}.bin.gz`, (off / 1e6).toFixed(1) + 'MB raw,', (gz.length / 1e6).toFixed(1) + 'MB gz, verts', nV, 'tris', nTri);
