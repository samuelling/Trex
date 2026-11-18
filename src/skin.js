// The skin as its own layer: an elastic sheet lying on the muscles.
// A coarse copy of the body surface is simulated with position-based dynamics. Each point is tethered
// to its place on the underlying body by fascia that is stiff where skin is tight (skull, shins, feet)
// and slack where it is loose (throat, belly, flanks, tail base). The sheet resists stretching but not
// compression, cannot sink into the muscle, has weight, and has inertia. So it slides when a joint
// stretches one side, sags and swings where it is loose, and reports where it is compressed so the
// shader can deepen the wrinkles there.
import * as THREE from 'three';

const TW = 128;

export class SkinLayer {
  constructor(rex, buf) {
    const L = rex.meta.layout, arr = (k, T) => new T(buf, L[k].offset, L[k].length);
    this.rex = rex; const N = this.N = rex.meta.skin.vertices;
    this.p0 = arr('s_position', Float32Array); this.n0 = arr('s_normal', Float32Array); this.si = arr('s_skinIndex', Uint8Array); this.sw = arr('s_skinWeight', Float32Array);
    this.mi = arr('s_musIndex', Uint8Array); this.mw = arr('s_musWeight', Float32Array); this.ni = arr('s_nodeIndex', Uint8Array); this.g5 = arr('s_g5', Float32Array);
    this.loose = arr('s_loose', Float32Array); this.soft = arr('s_soft', Float32Array); this.edge = arr('s_edge', Uint16Array);
    const E = this.E = this.edge.length / 2; this.L0 = new Float32Array(E); this.deg = new Float32Array(N);
    for (let e = 0; e < E; e++) { const a = 3 * this.edge[2 * e], b = 3 * this.edge[2 * e + 1]; this.L0[e] = Math.hypot(this.p0[a] - this.p0[b], this.p0[a + 1] - this.p0[b + 1], this.p0[a + 2] - this.p0[b + 2]); this.deg[this.edge[2 * e]]++; this.deg[this.edge[2 * e + 1]]++; }
    this.t = new Float32Array(N * 3); this.tp = new Float32Array(N * 3); this.tn = new Float32Array(N * 3); this.x = new Float32Array(N * 3); this.v = new Float32Array(N * 3); this.xp = new Float32Array(N * 3);
    this.strain = new Float32Array(N); this.sAcc = new Float32Array(N);
    const H = this.H = Math.ceil(N / TW); this.data = new Float32Array(TW * H * 4);
    const rest = new Float32Array(TW * H * 4); for (let i = 0; i < N; i++) { rest[4 * i] = this.p0[3 * i]; rest[4 * i + 1] = this.p0[3 * i + 1]; rest[4 * i + 2] = this.p0[3 * i + 2]; rest[4 * i + 3] = this.loose[i]; }
    const mk = (d) => { const t = new THREE.DataTexture(d, TW, H, THREE.RGBAFormat, THREE.FloatType); t.magFilter = t.minFilter = THREE.NearestFilter; t.needsUpdate = true; return t; };
    this.tex = mk(this.data); this.restTex = mk(rest);
    this.bm = new Float32Array(rex.bones.length * 12); this.init = false;
    this.looseGain = 1; this.enabled = true; this.maxSlide = 0; this.maxSag = 0;
    // per-vertex fascia stiffness (rad/s) and weight, from looseness
    this.wT = new Float32Array(N); this.wN = new Float32Array(N); this.grav = new Float32Array(N); this.#tune();
  }
  #tune() {
    for (let i = 0; i < this.N; i++) { const l = Math.min(1, this.loose[i] * 1.25 * this.looseGain); this.wT[i] = Math.exp(Math.log(110) * (1 - l) + Math.log(17) * l); this.wN[i] = Math.exp(Math.log(140) * (1 - l) + Math.log(14) * l); this.grav[i] = 9.81 * Math.min(1, l * 1.4); }
  }
  setLooseness(g) { this.looseGain = g; this.#tune(); }

  // where the underlying body surface is right now: skeletal skinning + muscle bulge + soft-tissue lattice
  #targets() {
    const rex = this.rex, bm = this.bm, { N, p0, n0, si, sw, mi, mw, ni, g5, soft, t, tn } = this, m = new THREE.Matrix4(), e = m.elements;
    rex.bones.forEach((b, k) => { m.makeRotationFromQuaternion(b.obj.quaternion); const o = 12 * k, r = b.rest, p = b.obj.position;
      bm[o] = e[0]; bm[o + 1] = e[4]; bm[o + 2] = e[8]; bm[o + 3] = e[1]; bm[o + 4] = e[5]; bm[o + 5] = e[9]; bm[o + 6] = e[2]; bm[o + 7] = e[6]; bm[o + 8] = e[10];
      bm[o + 9] = p.x - (e[0] * r.x + e[4] * r.y + e[8] * r.z); bm[o + 10] = p.y - (e[1] * r.x + e[5] * r.y + e[9] * r.z); bm[o + 11] = p.z - (e[2] * r.x + e[6] * r.y + e[10] * r.z); });
    const U = rex.uMus, ND = rex.nodeData;
    for (let i = 0; i < N; i++) {
      const px = p0[3 * i], py = p0[3 * i + 1], pz = p0[3 * i + 2], qx = n0[3 * i], qy = n0[3 * i + 1], qz = n0[3 * i + 2]; let x = 0, y = 0, z = 0, nx = 0, ny = 0, nz = 0;
      for (let c = 0; c < 4; c++) { const w = sw[4 * i + c]; if (w <= 0) continue; const o = 12 * si[4 * i + c];
        x += w * (bm[o] * px + bm[o + 1] * py + bm[o + 2] * pz + bm[o + 9]); y += w * (bm[o + 3] * px + bm[o + 4] * py + bm[o + 5] * pz + bm[o + 10]); z += w * (bm[o + 6] * px + bm[o + 7] * py + bm[o + 8] * pz + bm[o + 11]);
        nx += w * (bm[o] * qx + bm[o + 1] * qy + bm[o + 2] * qz); ny += w * (bm[o + 3] * qx + bm[o + 4] * qy + bm[o + 5] * qz); nz += w * (bm[o + 6] * qx + bm[o + 7] * qy + bm[o + 8] * qz); }
      const nl = 1 / (Math.hypot(nx, ny, nz) || 1); nx *= nl; ny *= nl; nz *= nl;
      let b = 0; for (let c = 0; c < 4; c++) b += mw[4 * i + c] * U[mi[4 * i + c]]; b *= 0.3; x += nx * b; y += ny * b; z += nz * b;
      const s = soft[i];
      if (s > 0.01) { let ax = 0, ay = 0, az = 0, G = 0; for (let c = 0; c < 4; c++) { const j = ni[4 * i + c]; if (j === 255) continue; const q = 4 * (256 + j), d = Math.hypot(px - ND[q], py - ND[q + 1], pz - ND[q + 2]); let g = Math.max(0, 1 - d / ND[q + 3]); g = Math.max(0, g * g * ND[4 * j + 3] - g5[i]); ax += g * ND[4 * j]; ay += g * ND[4 * j + 1]; az += g * ND[4 * j + 2]; G += g; }
        if (G > 1e-5) { const k = s * Math.min(1, G / 0.2) / G; x += ax * k; y += ay * k; z += az * k; } }
      t[3 * i] = x; t[3 * i + 1] = y; t[3 * i + 2] = z; tn[3 * i] = nx; tn[3 * i + 1] = ny; tn[3 * i + 2] = nz;
    }
  }

  update(dt) {
    const { N, E, t, tp, tn, x, v, xp, edge, L0, loose, wT, wN, grav, strain, sAcc, deg, data } = this;
    tp.set(t); this.#targets();
    if (!this.init) { x.set(t); tp.set(t); v.fill(0); this.init = true; }
    if (!(dt > 1e-6)) return;
    if (!this.enabled) { x.set(t); v.fill(0); data.fill(0); this.tex.needsUpdate = true; return; }
    const ns = Math.max(2, Math.min(8, Math.round(dt * 360))), h = dt / ns, inv = 1 / dt, damp = Math.exp(-h * 5.5), slack = 0.035;
    for (let s = 0; s < ns; s++) {
      const al = (s + 1) / ns;
      for (let i = 0; i < N; i++) {
        const o = 3 * i, tx = tp[o] + (t[o] - tp[o]) * al, ty = tp[o + 1] + (t[o + 1] - tp[o + 1]) * al, tz = tp[o + 2] + (t[o + 2] - tp[o + 2]) * al;
        const vx = (t[o] - tp[o]) * inv, vy = (t[o + 1] - tp[o + 1]) * inv, vz = (t[o + 2] - tp[o + 2]) * inv;
        v[o] = vx + (v[o] - vx) * damp; v[o + 1] = vy + (v[o + 1] - vy) * damp - grav[i] * h; v[o + 2] = vz + (v[o + 2] - vz) * damp;
        xp[o] = x[o]; xp[o + 1] = x[o + 1]; xp[o + 2] = x[o + 2];
        let ox = x[o] + v[o] * h - tx, oy = x[o + 1] + v[o + 1] * h - ty, oz = x[o + 2] + v[o + 2] * h - tz;
        // fascia: stiff along the normal (and one-sided: skin cannot enter the muscle), softer in the tangent plane
        const nx = tn[o], ny = tn[o + 1], nz = tn[o + 2], on = ox * nx + oy * ny + oz * nz, kt = h * h * wT[i] * wT[i], kn = h * h * wN[i] * wN[i], sT = 1 / (1 + kt), on2 = on < 0 ? 0 : on / (1 + kn);
        ox = (ox - on * nx) * sT + on2 * nx; oy = (oy - on * ny) * sT + on2 * ny; oz = (oz - on * nz) * sT + on2 * nz;
        x[o] = tx + ox; x[o + 1] = ty + oy; x[o + 2] = tz + oz;
      }
      // the sheet itself: resists stretch beyond its slack, offers nothing against compression
      for (let e = 0; e < E; e++) {
        const ia = edge[2 * e], ib = edge[2 * e + 1], a = 3 * ia, b = 3 * ib, dx = x[b] - x[a], dy = x[b + 1] - x[a + 1], dz = x[b + 2] - x[a + 2], l = Math.sqrt(dx * dx + dy * dy + dz * dz), lm = L0[e] * (1 + slack * (loose[ia] + loose[ib]));
        if (l <= lm) continue; const wa = loose[ia] + 0.03, wb = loose[ib] + 0.03, k = 0.5 * (l - lm) / (l * (wa + wb));
        x[a] += wa * k * dx; x[a + 1] += wa * k * dy; x[a + 2] += wa * k * dz; x[b] -= wb * k * dx; x[b + 1] -= wb * k * dy; x[b + 2] -= wb * k * dz;
      }
      // skin can only travel so far from where it is anchored
      for (let i = 0; i < N; i++) { const o = 3 * i, tx = tp[o] + (t[o] - tp[o]) * al, ty = tp[o + 1] + (t[o + 1] - tp[o + 1]) * al, tz = tp[o + 2] + (t[o + 2] - tp[o + 2]) * al, dx = x[o] - tx, dy = x[o + 1] - ty, dz = x[o + 2] - tz, d = Math.sqrt(dx * dx + dy * dy + dz * dz), lim = 0.012 + 0.085 * Math.min(1, loose[i] * this.looseGain);
        if (d > lim) { const k = (lim + (d - lim) * 0.15) / d; x[o] = tx + dx * k; x[o + 1] = ty + dy * k; x[o + 2] = tz + dz * k; } }
      const ih = 1 / h; for (let o = 0; o < 3 * N; o++) v[o] = (x[o] - xp[o]) * ih;
    }
    // strain per point (mean edge strain: negative = compressed) and output
    sAcc.fill(0);
    for (let e = 0; e < E; e++) { const ia = edge[2 * e], ib = edge[2 * e + 1], a = 3 * ia, b = 3 * ib, l = Math.hypot(x[b] - x[a], x[b + 1] - x[a + 1], x[b + 2] - x[a + 2]), st = l / L0[e] - 1; sAcc[ia] += st; sAcc[ib] += st; }
    let ms = 0, mg = 0; const kf = Math.min(1, dt * 14);
    for (let i = 0; i < N; i++) {
      const o = 3 * i, dx = x[o] - t[o], dy = x[o + 1] - t[o + 1], dz = x[o + 2] - t[o + 2];
      if (!(dx * dx + dy * dy + dz * dz < 0.09)) { x[o] = t[o]; x[o + 1] = t[o + 1]; x[o + 2] = t[o + 2]; v[o] = v[o + 1] = v[o + 2] = 0; data[4 * i] = data[4 * i + 1] = data[4 * i + 2] = 0; continue; }   // guard
      strain[i] += (sAcc[i] / Math.max(1, deg[i]) - strain[i]) * kf;
      data[4 * i] = dx; data[4 * i + 1] = dy; data[4 * i + 2] = dz; data[4 * i + 3] = strain[i];
      const on = dx * tn[o] + dy * tn[o + 1] + dz * tn[o + 2], sl = Math.sqrt(Math.max(0, dx * dx + dy * dy + dz * dz - on * on)); if (sl > ms) ms = sl; if (on > mg) mg = on;
    }
    this.maxSlide = ms; this.maxSag = mg; this.tex.needsUpdate = true;
  }
}
