// Tail as a tapered elastic beam cantilevered from the pelvis: point masses joined by rigid
// links, with bending stiffness at every caudal joint (ligament/muscle suspension) scaled by the
// local cross-section (EI ~ w h^3 dorsoventrally, h w^3 laterally). Two-way coupled, so it has real
// vibration modes; stiffness is calibrated at start-up so the first dorsoventral mode sits at the
// requested natural frequency (default 0.66 Hz, the estimate of van Bijlert et al. 2021).
const rot = (q, v, o) => { const [x, y, z, w] = q, ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
  o[0] = ix * w + iw * -x + iy * -z - iz * -y; o[1] = iy * w + iw * -y + iz * -x - ix * -z; o[2] = iz * w + iw * -z + ix * -y - iy * -x; return o; };

export class Tail {
  constructor(rest, rw, rh) {
    const N = this.N = rest.length - 1; this.r = rest.map(p => p.slice());
    this.x = new Float64Array((N + 1) * 3); this.v = new Float64Array((N + 1) * 3); this.px = new Float64Array((N + 1) * 3); this.F = new Float64Array((N + 1) * 3);
    this.L = []; this.d0 = []; this.m = [0]; this.kv = []; this.kl = [];
    for (let i = 0; i < N; i++) { const d = [0, 1, 2].map(c => rest[i + 1][c] - rest[i][c]), l = Math.hypot(...d); this.L.push(l); this.d0.push(d.map(c => c / l)); }
    for (let j = 1; j <= N; j++) this.m.push(Math.max(2e-4, rw[j] * rh[j]) * 0.5 * (this.L[j - 1] + (this.L[j] || this.L[j - 1])));
    for (let j = 0; j < N; j++) { const w = Math.max(rw[j], 0.02), h = Math.max(rh[j], 0.025); const st = 1 + 4 * (j / N) ** 2; /* distal caudals are stiffened by their interlocking zygapophyses */ this.kv.push(st * w * h * h * h / this.L[j]); this.kl.push(st * h * w * w * w / this.L[j]); }
    this.c0 = this.d0.map((d, j) => j ? d.map((c, k) => c - this.d0[j - 1][k]) : [0, 0, 0]);
    this.kappa = 1; this.zeta = 0.25; this.beta = 0.1; this.f = 0.66; this.hmax = 1 / 1500; this.started = false; this.bp = [0, 0, 0];
    this.#calibrate();
  }
  // measure the first dorsoventral mode by plucking the tail, then scale stiffness to the target
  #calibrate() {
    const z = this.zeta, df = this.beta, KT = 4000; this.zeta = 0; this.beta = 0; this.kappa = KT;
    const q = [0, 0, 0, 1], b = this.r[0]; this.reset(b, q);
    for (let j = 1; j <= this.N; j++) this.x[3 * j + 1] += 0.02 * (j / this.N) ** 2;
    let prev = 0, cross = 0, t = 0, first = -1, last = 0; const tipRest = this.r[this.N][1];
    for (let i = 0; i < 40000; i++) { this.#sub(1 / 2000, b, q, [0, 0, 0]); t += 1 / 2000; const y = this.x[3 * this.N + 1] - tipRest; if (i > 0 && prev < 0 && y >= 0) { if (first < 0) first = t; last = t; cross++; } prev = y; }
    this.f1 = (cross > 1 ? (cross - 1) / (last - first) : 1) / Math.sqrt(KT);      // Hz at kappa = 1
    this.zeta = z; this.beta = df; this.setFreq(this.f); this.started = false;
  }
  setFreq(f) { this.f = f; this.kappa = (f / this.f1) ** 2; }
  reset(base, q) { const t = [0, 0, 0]; for (let j = 0; j <= this.N; j++) { rot(q, [0, 1, 2].map(c => this.r[j][c] - this.r[0][c]), t); for (let c = 0; c < 3; c++) { this.x[3 * j + c] = base[c] + t[c]; this.v[3 * j + c] = 0; } } this.bp = base.slice(); this.started = true; }
  step(dt, base, q) {
    if (!this.started) this.reset(base, q);
    if (!(dt > 1e-6)) return;
    if (!Number.isFinite(this.x[3 * this.N])) this.reset(base, q);
    const n = Math.max(1, Math.min(60, Math.ceil(dt / this.hmax))), h = dt / n, bv = [0, 1, 2].map(c => (base[c] - this.bp[c]) / Math.max(dt, 1e-5)), b = [0, 0, 0];
    for (let s = 0; s < n; s++) { for (let c = 0; c < 3; c++) b[c] = this.bp[c] + (base[c] - this.bp[c]) * (s + 1) / n; this.#sub(h, b, q, bv); }
    this.bp = base.slice();
  }
  #sub(h, base, q, bv) {
    const { N, x, v, F, L, m, px } = this, ub = rot(q, [0, 1, 0], []), lb = rot(q, [0, 0, 1], []), dc = rot(q, this.d0[0], []), c0 = [0, 0, 0];
    const beta = 0.002, alpha = 2 * this.zeta * 2 * Math.PI * this.f, K = this.kappa;
    F.fill(0); for (let c = 0; c < 3; c++) { x[c] = base[c]; v[c] = bv[c]; }
    for (let j = 0; j < N; j++) {
      const a = 3 * j, b = a + 3, p = a - 3, iL = 1 / L[j], iP = j ? 1 / L[j - 1] : 0; let cv = 0, cl = 0, rv = 0, rl = 0;
      rot(q, this.c0[j], c0);
      for (let c = 0; c < 3; c++) {
        const d = (x[b + c] - x[a + c]) * iL, dp = j ? (x[a + c] - x[p + c]) * iP : dc[c], cc = d - dp - c0[c];
        const rr = (v[b + c] - v[a + c]) * iL - (j ? (v[a + c] - v[p + c]) * iP : 0);
        cv += cc * ub[c]; cl += cc * lb[c]; rv += rr * ub[c]; rl += rr * lb[c];
      }
      const gv = -K * this.kv[j] * (cv + beta * rv), gl = -K * this.kl[j] * (cl + beta * rl);
      for (let c = 0; c < 3; c++) { const g = gv * ub[c] + gl * lb[c]; F[b + c] += g * iL; F[a + c] -= g * (iL + iP); if (j) F[p + c] += g * iP; }
    }
    px.set(x);
    for (let j = 1; j <= N; j++) for (let c = 0; c < 3; c++) { const o = 3 * j + c; v[o] += h * (F[o] / m[j] - alpha * (v[o] - bv[c])); x[o] += h * v[o]; }
    for (let it = 0; it < 3; it++) for (let j = 0; j < N; j++) {
      const a = 3 * j, b = a + 3, dx = x[b] - x[a], dy = x[b + 1] - x[a + 1], dz = x[b + 2] - x[a + 2], l = Math.hypot(dx, dy, dz), wa = j ? 1 / m[j] : 0, wb = 1 / m[j + 1], k = (l - L[j]) / (l * (wa + wb));
      x[a] += wa * k * dx; x[a + 1] += wa * k * dy; x[a + 2] += wa * k * dz; x[b] -= wb * k * dx; x[b + 1] -= wb * k * dy; x[b + 2] -= wb * k * dz;
    }
    for (let o = 3; o < (N + 1) * 3; o++) v[o] = (x[o] - px[o]) / h;
    // internal (tissue) damping, stiffness-proportional and solved implicitly per joint: the bend rate
    // of each joint decays, which damps the whip-like higher modes far more than the fundamental
    const bd = this.beta;
    if (bd > 0) for (let j = 0; j < N; j++) {
      const a = 3 * j, b = a + 3, p = a - 3, iL = 1 / L[j], iP = j ? 1 / L[j - 1] : 0, wb = 1 / m[j + 1], wa = j ? 1 / m[j] : 0, wp = j > 1 ? 1 / m[j - 1] : 0;
      const W = iL * iL * wb + (iL + iP) * (iL + iP) * wa + iP * iP * wp, g = 1 - 1 / (1 + h * bd * K * this.kv[j] * W);
      for (let c = 0; c < 3; c++) { const rr = (v[b + c] - v[a + c]) * iL - (j ? (v[a + c] - v[p + c]) * iP : 0), lam = -g * rr / W; v[b + c] += lam * iL * wb; v[a + c] -= lam * (iL + iP) * wa; if (j) v[p + c] += lam * iP * wp; }
    }
  }
}
