// UV atlas for an arbitrary closed mesh, without tangent-space assumptions.
// Faces are grouped by which of 14 directions their normal is closest to, connected groups become
// charts, each chart is projected orthographically along its direction and the charts are packed.
// Texel density can be weighted per vertex. Because all texture content is evaluated in 3D and the
// normal map is object-space, chart seams cannot show; the atlas only needs to be injective.
const DIRS = [];
for (const a of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) DIRS.push(a);
for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) DIRS.push([x / Math.sqrt(3), y / Math.sqrt(3), z / Math.sqrt(3)]);

export function unwrap(pos, tri, dens, res, pad = 4, log = () => {}) {
  const nT = tri.length / 3, nV = pos.length / 3, fn = new Float32Array(nT * 3), dir = new Int8Array(nT);
  for (let t = 0; t < nT; t++) {
    const a = 3 * tri[3 * t], b = 3 * tri[3 * t + 1], c = 3 * tri[3 * t + 2];
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l; fn.set([nx, ny, nz], 3 * t);
    let best = -2, bi = 0; for (let d = 0; d < 14; d++) { const s = nx * DIRS[d][0] + ny * DIRS[d][1] + nz * DIRS[d][2]; if (s > best) { best = s; bi = d; } } dir[t] = bi;
  }
  // face adjacency through shared edges
  const adj = new Int32Array(nT * 3).fill(-1), em = new Map();
  for (let t = 0; t < nT; t++) for (let e = 0; e < 3; e++) {
    const a = tri[3 * t + e], b = tri[3 * t + (e + 1) % 3], k = a < b ? a * 4294967296 + b : b * 4294967296 + a, o = em.get(k);
    if (o === undefined) em.set(k, t * 3 + e); else { adj[t * 3 + e] = Math.floor(o / 3); adj[o] = t; }
  }
  // relax the labelling so charts are larger and cleaner
  for (let it = 0; it < 6; it++) for (let t = 0; t < nT; t++) {
    let best = -9, bi = dir[t];
    for (let e = 0; e < 3; e++) { const n = adj[3 * t + e]; if (n < 0) continue; const d = dir[n]; let cnt = 0; for (let q = 0; q < 3; q++) { const m = adj[3 * t + q]; if (m >= 0 && dir[m] === d) cnt++; }
      const s = fn[3 * t] * DIRS[d][0] + fn[3 * t + 1] * DIRS[d][1] + fn[3 * t + 2] * DIRS[d][2]; if (s < 0.45) continue; const sc = s + 0.16 * cnt; if (sc > best) { best = sc; bi = d; } }
    const s0 = fn[3 * t] * DIRS[dir[t]][0] + fn[3 * t + 1] * DIRS[dir[t]][1] + fn[3 * t + 2] * DIRS[dir[t]][2]; let c0 = 0; for (let q = 0; q < 3; q++) { const m = adj[3 * t + q]; if (m >= 0 && dir[m] === dir[t]) c0++; }
    if (best > s0 + 0.16 * c0) dir[t] = bi;
  }
  const components = () => {
    const comp = new Int32Array(nT).fill(-1), sizes = []; let nc = 0; const st = [];
    for (let t = 0; t < nT; t++) { if (comp[t] >= 0) continue; comp[t] = nc; st.push(t); let n = 0; while (st.length) { const f = st.pop(); n++; for (let e = 0; e < 3; e++) { const m = adj[3 * f + e]; if (m >= 0 && comp[m] < 0 && dir[m] === dir[f]) { comp[m] = nc; st.push(m); } } } sizes.push(n); nc++; }
    return { comp, sizes };
  };
  // dissolve tiny islands into a front-facing neighbour
  for (let pass = 0; pass < 3; pass++) {
    const { comp, sizes } = components();
    for (let t = 0; t < nT; t++) { if (sizes[comp[t]] >= 24) continue; let bs = 0.3, bd = -1, bsz = 0;
      for (let e = 0; e < 3; e++) { const m = adj[3 * t + e]; if (m < 0 || comp[m] === comp[t]) continue; const d = dir[m], s = fn[3 * t] * DIRS[d][0] + fn[3 * t + 1] * DIRS[d][1] + fn[3 * t + 2] * DIRS[d][2]; if (s > 0.3 && sizes[comp[m]] > bsz) { bsz = sizes[comp[m]]; bs = s; bd = d; } }
      if (bd >= 0) dir[t] = bd; }
  }
  const { comp, sizes } = components(), nC = sizes.length;
  // per-chart projection, rotated to its tightest bounding box
  const faces = Array.from({ length: nC }, () => []); for (let t = 0; t < nT; t++) faces[comp[t]].push(t);
  const charts = [], xref = [], uvw = [], outTri = new Uint32Array(tri.length), pieces = [], LMAX = 1.5;
  for (let c = 0; c < nC; c++) {
    const d = DIRS[dir[faces[c][0]]], h = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let ux = h[1] * d[2] - h[2] * d[1], uy = h[2] * d[0] - h[0] * d[2], uz = h[0] * d[1] - h[1] * d[0]; const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
    const vx = d[1] * uz - d[2] * uy, vy = d[2] * ux - d[0] * uz, vz = d[0] * uy - d[1] * ux;
    const map = new Map(), loc = []; let ds = 0;
    for (const t of faces[c]) for (let e = 0; e < 3; e++) { const v = tri[3 * t + e]; if (!map.has(v)) { map.set(v, loc.length / 2); loc.push(pos[3 * v] * ux + pos[3 * v + 1] * uy + pos[3 * v + 2] * uz, pos[3 * v] * vx + pos[3 * v + 1] * vy + pos[3 * v + 2] * vz); ds += dens[v]; } }
    const n = loc.length / 2, sc = ds / n; let bestA = 1e30, ba = 0;
    for (let a = 0; a < 180; a += 6) { const ca = Math.cos(a * Math.PI / 180), sa = Math.sin(a * Math.PI / 180); let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (let i = 0; i < n; i++) { const x = loc[2 * i] * ca - loc[2 * i + 1] * sa, y = loc[2 * i] * sa + loc[2 * i + 1] * ca; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } const A = (x1 - x0) * (y1 - y0) * (x1 - x0 >= y1 - y0 ? 1 : 1.0001); if (A < bestA && x1 - x0 >= y1 - y0) { bestA = A; ba = a; } }
    const ca = Math.cos(ba * Math.PI / 180), sa = Math.sin(ba * Math.PI / 180), rx = new Float64Array(n), ry = new Float64Array(n); let x0 = 1e9, x1 = -1e9;
    for (let i = 0; i < n; i++) { rx[i] = (loc[2 * i] * ca - loc[2 * i + 1] * sa) * sc; ry[i] = (loc[2 * i] * sa + loc[2 * i + 1] * ca) * sc; if (rx[i] < x0) x0 = rx[i]; if (rx[i] > x1) x1 = rx[i]; }
    // long charts (a whole flank, the tail) are cut into lengths so no single chart limits the texel density
    const nb = Math.max(1, Math.ceil((x1 - x0) / LMAX)), bw = (x1 - x0) / nb + 1e-9, bins = Array.from({ length: nb }, () => []);
    for (const t of faces[c]) { const m = (rx[map.get(tri[3 * t])] + rx[map.get(tri[3 * t + 1])] + rx[map.get(tri[3 * t + 2])]) / 3; bins[Math.min(nb - 1, Math.floor((m - x0) / bw))].push(t); }
    for (const fl of bins) { if (!fl.length) continue; const vm = new Map(), base = xref.length; let mx0 = 1e9, mx1 = -1e9, my0 = 1e9, my1 = -1e9;
      for (const t of fl) for (let e = 0; e < 3; e++) { const v = tri[3 * t + e], li = map.get(v); if (!vm.has(v)) { vm.set(v, xref.length); xref.push(v); uvw.push(rx[li], ry[li]); if (rx[li] < mx0) mx0 = rx[li]; if (rx[li] > mx1) mx1 = rx[li]; if (ry[li] < my0) my0 = ry[li]; if (ry[li] > my1) my1 = ry[li]; } outTri[3 * t + e] = vm.get(v); }
      for (let i = base; i < xref.length; i++) { uvw[2 * i] -= mx0; uvw[2 * i + 1] -= my0; }
      charts.push({ base, n: xref.length - base, w: mx1 - mx0, h: my1 - my0 }); pieces.push(fl); }
  }
  const nP = charts.length; faces.length = 0; for (const f of pieces) faces.push(f);
  // bitmap packing: rasterise each chart's footprint on a coarse grid and drop it into the first free spot
  let area = 0; const tA = new Float64Array(nP);
  for (let c = 0; c < nP; c++) for (const t of faces[c]) { const a = outTri[3 * t], b = outTri[3 * t + 1], d = outTri[3 * t + 2]; const A = Math.abs((uvw[2 * b] - uvw[2 * a]) * (uvw[2 * d + 1] - uvw[2 * a + 1]) - (uvw[2 * d] - uvw[2 * a]) * (uvw[2 * b + 1] - uvw[2 * a + 1])) * 0.5; area += A; tA[c] += A; }
  const Gn = 512, Bc = res / Gn; let lo = Math.sqrt(0.80 * res * res / area), ok = false, tries = 0;
  const order = charts.map((_, i) => i).sort((a, b) => tA[b] - tA[a]);
  while (!ok && tries++ < 40) {
    const grid = new Uint8Array(Gn * Gn); ok = true; let rowHint = 0;
    for (const ci of order) {
      const c = charts[ci], w = Math.ceil((c.w * lo + 2 * pad) / Bc) + 1, h = Math.ceil((c.h * lo + 2 * pad) / Bc) + 1;
      if (w > Gn || h > Gn) { ok = false; break; }
      const m = new Uint8Array(w * h);
      for (const t of faces[ci]) { let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (let e = 0; e < 3; e++) { const v = outTri[3 * t + e], x = uvw[2 * v] * lo + pad, y = uvw[2 * v + 1] * lo + pad; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        const i0 = Math.max(0, Math.floor((x0 - pad) / Bc)), i1 = Math.min(w - 1, Math.floor((x1 + pad) / Bc)), j0 = Math.max(0, Math.floor((y0 - pad) / Bc)), j1 = Math.min(h - 1, Math.floor((y1 + pad) / Bc)); for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) m[j * w + i] = 1; }
      const cells = []; for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (m[j * w + i]) cells.push(j * Gn + i);
      let placed = false;
      for (let y = 0; y <= Gn - h && !placed; y++) for (let x = 0; x <= Gn - w; x++) { const o = y * Gn + x; let hit = false; for (let k = 0; k < cells.length; k++) if (grid[o + cells[k]]) { hit = true; break; } if (!hit) { for (let k = 0; k < cells.length; k++) grid[o + cells[k]] = 1; c.x = x * Bc + pad; c.y = y * Bc + pad; placed = true; break; } }
      if (!placed) { ok = false; break; }
    }
    if (!ok) lo *= 0.965;
  }
  if (!ok) throw new Error('atlas packing failed');
  const uv = new Float32Array(xref.length * 2);
  for (const c of charts) for (let i = 0; i < c.n; i++) { uv[2 * (c.base + i)] = (c.x + uvw[2 * (c.base + i)] * lo) / res; uv[2 * (c.base + i) + 1] = (c.y + uvw[2 * (c.base + i) + 1] * lo) / res; }
  log(`atlas: ${nP} charts, ${lo.toFixed(0)} texels/m (weighted), ${(100 * area * lo * lo / (res * res)).toFixed(0)}% of ${res}² used, verts ${nV} -> ${xref.length}`);
  return { xref: Uint32Array.from(xref), uv, tri: outTri, texelsPerMeter: lo };
}
