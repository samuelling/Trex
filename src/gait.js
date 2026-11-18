// Locomotion model.
//   * Gait parameters from dynamic similarity (Froude number): stride length follows
//     Alexander's relation, duty factor follows the avian trend, both capped by leg reach.
//   * Ground reaction force from the Alexander-Jayes two-term model, with the shape factor
//     chosen so that mid-stance force matches inverted-pendulum vaulting at walking speeds
//     and blends to a single-humped compliant "grounded run" at higher Froude numbers.
//   * Centre-of-mass motion is obtained by integrating those forces (harmonic solution),
//     horizontal forces come from a virtual-pivot-point model, and foot placement is
//     whatever makes braking and propulsive impulses cancel.
//   * Legs are solved by inverse kinematics for a three-segment digitigrade limb with
//     toe roll-off; the pelvis drops when a leg would otherwise over-extend.
import * as THREE from 'three';
import { groundHeight } from './terrain.js';

const G = 9.81, DEG = Math.PI / 180;
const V3 = THREE.Vector3, Q4 = THREE.Quaternion;
const UP = new V3(0, 1, 0), AX = new V3(1, 0, 0), AZ = new V3(0, 0, 1);
export const sst = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const kf = (u, k) => { if (u <= k[0][0]) return k[0][1]; for (let i = 0; i < k.length - 1; i++) if (u <= k[i + 1][0]) { const t = (u - k[i][0]) / (k[i + 1][0] - k[i][0]); return k[i][1] + (k[i + 1][1] - k[i][1]) * t * t * (3 - 2 * t); } return k[k.length - 1][1]; };
const frac = x => x - Math.floor(x);
const NH = 6, NT = 96;
const COS = [], SIN = [];
for (let n = 1; n <= NH; n++) { COS[n] = new Float32Array(NT); SIN[n] = new Float32Array(NT); for (let k = 0; k < NT; k++) { COS[n][k] = Math.cos(2 * Math.PI * n * k / NT); SIN[n][k] = Math.sin(2 * Math.PI * n * k / NT); } }

const m3 = new THREE.Matrix4(), t1 = new V3(), t2 = new V3(), t3 = new V3();
// rotation taking the orthonormal frame built on (dir, hint) at rest to the one built now
function frameQuat(dir, hint, out) {
  t1.copy(dir).normalize(); t3.crossVectors(t1, hint).normalize(); t2.crossVectors(t3, t1);
  m3.makeBasis(t1, t2, t3); return out.setFromRotationMatrix(m3);
}

export class Locomotion {
  constructor(rex) {
    this.rex = rex; const lm = rex.meta.landmarks;
    this.mass = 9500; this.R = 38; this.S = 0; this.phase = 0.12; this.speed = 0; this.target = 1.3; this.time = 0;
    this.comOff = new V3(0.55, -0.18, 0);          // whole-body COM relative to the hip centre (rest frame)
    this.dvpp = 0.9; this.kg2 = 5.8;                // virtual pivot height above COM (m); pitch radius of gyration^2
    this.legLen = 3.06;
    this.pelvis = rex.bone('pelvis');
    this.pos = new V3(); this.quat = new Q4(); this.heading = new V3(1, 0, 0); this.right = new V3(0, 0, 1); this.qPath = new Q4();
    this.com = new V3(); this.dyn = { dx: 0, dy: 0, dz: 0, pitch: 0, yaw: 0, roll: 0, ay: 0 };
    this.onFootfall = null; this.walk = 0; this.drop = 0; this.gY = 0;
    // steering: the animal follows the circle in direction dirS; heading changes are limited in rate and acceleration (see #steer)
    this.O = new V3(0, 0, -this.R); this.psi = 0; this.dirS = 1; this.omega = 0; this.kappa = 1 / this.R; this.turnMax = 0.5; this.turnAcc = 1.2; this.turnErr = 0; this.turnSign = 1;
    this.aerial = false; this.hold = false; this.posePitch = 0; this.poseDrop = 0;      // hold: stand still (feeding); pose*: extra trunk pitch and crouch
    this.feet = [-1, 1].map((s, i) => this.#mkFoot(s, i ? 'R' : 'L', i * 0.5, lm));
    this.coef = {}; for (const k of ['y', 'x', 'z', 'p']) this.coef[k] = { a: new Float32Array(NH + 1), b: new Float32Array(NH + 1) };
    this.tab = { ay: new Float32Array(NT), ax: new Float32Array(NT), zc: new Float32Array(NT) };
    this.p = this.gaitParams(0.3);
    this.#pose(); this.#initFeet();
  }

  #mkFoot(s, S, off, lm) {
    const P = p => new V3(p[0], p[1], p[2] * s), L = lm.leg, D = lm.digits, rex = this.rex;
    const f = { s, S, off, H: P(L.H), K: P(L.K), A: P(L.A), M: P(L.M), T0: P(D.d3[1]) };
    f.lf = f.K.distanceTo(f.H); f.lt = f.A.distanceTo(f.K); f.lm = f.M.distanceTo(f.A);
    f.hipLocal = f.H.clone().sub(this.pelvis.rest);
    f.bFemur = rex.bone('femur_' + S); f.bTibia = rex.bone('tibia_' + S); f.bMt = rex.bone('mt_' + S);
    const hinge = new V3().crossVectors(f.K.clone().sub(f.H), f.A.clone().sub(f.K)).normalize();
    f.qF0 = frameQuat(f.K.clone().sub(f.H), hinge, new Q4()).invert();
    f.qT0 = frameQuat(f.A.clone().sub(f.K), hinge, new Q4()).invert();
    f.qM0 = frameQuat(f.M.clone().sub(f.A), AZ, new Q4()).invert();
    f.dig = ['d2', 'd3', 'd4'].map(d => { const a = P(D[d][0]), b = P(D[d][1]); return { a, b, ba: rex.bone(d + 'a_' + S), bb: rex.bone(d + 'b_' + S), ang: Math.atan2(b.z - a.z, b.x - a.x) }; });
    f.plant = { T: new V3(), yaw: 0 }; f.lift = new V3(); f.liftYaw = 0; f.tgt = new V3(); f.tgtYaw = 0;
    f.stance = true; f.s = 0; f.u = 0; f.Tw = new V3(); f.Mw = new V3(); f.Aw = new V3(); f.Kw = new V3(); f.Hw = new V3(); f.cop = new V3(); f.F = new V3(); f.Fy = 0; f.yaw = 0; f.thD = 0; f.psi = 0; f.fwd = new V3(); f.rt = new V3(); f.vel = new V3(); f.prevT = new V3(); f.load = 0;
    return f;
  }

  // ---------- gait parameters from speed ----------
  gaitParams(v) {
    const h = this.legLen, ve = Math.max(v, 0.3), Fr = ve * ve / (G * h);
    // duty factor: avian trend, continuing downward past Fr = 1 the way running birds do. By default it is held at 0.5 so there is no
    // aerial phase (bone-stress limits, Sellers et al. 2017); 'aerial' lifts that limit to show what a true run would cost.
    const beta = Math.max(this.aerial ? 0.3 : 0.5, 0.47 + 0.25 * Math.exp(-Fr / 0.5) - 0.087 * Math.log(Math.max(1, Fr)));
    let lambda = 2.6 * h * Math.pow(Fr, 0.3);
    const Ls = Math.min(beta * lambda, 2.45); lambda = Ls / beta;
    const T = lambda / ve, run = sst(0.45, 0.95, Fr);
    const Rm = Math.max(0.05, (1 - Math.min(Fr, 0.9)) * 4 * beta / Math.PI);
    const q = (1 - run) * Math.min(0.8, Math.max(0, (1 - Rm) / (1 + Rm / 3))) + run * -0.06;
    const A = Math.PI / (4 * beta * (1 + q / 3));
    return { v: ve, Fr, beta, lambda, Ls, T, q, A, run, hip: 2.985 - 0.13 * sst(0.15, 1.0, Fr), w: 0.21 - 0.08 * sst(0.1, 1.0, Fr), clear: 0.30 + 0.28 * sst(0, 1.0, Fr), omega: 2 * Math.PI / T };
  }
  // vertical GRF of one leg in body weights, s = stance progress
  Fy(s, p = this.p) { const t = Math.PI * (s - 0.5); return Math.max(0, p.A * (Math.cos(t) - p.q * Math.cos(3 * t))); }
  cop(s) { return 0.08 + 0.50 * sst(0.25, 1, s); }   // centre of pressure ahead of the metatarsophalangeal joint

  #tables() {
    const p = this.p, { ay, ax, zc } = this.tab, yv = p.hip + this.comOff.y + this.dvpp;
    let num = 0, den = 0; for (let i = 0; i <= 40; i++) { const s = i / 40, f = this.Fy(s); num += f * (p.Ls * s - this.cop(s)); den += f; }
    p.atd = num / den;                                       // MTP lands this far ahead of the COM
    let my = 0, mx = 0;
    for (let k = 0; k < NT; k++) {
      let fy = 0, fx = 0, fz = 0;
      for (const ft of this.feet) { const pf = frac(k / NT - ft.off); if (pf >= p.beta) continue; const s = pf / p.beta, f = this.Fy(s); fy += f; fx += f * (p.Ls * s - p.atd - this.cop(s)) / yv; fz += f * ft.s * p.w; }
      ay[k] = fy - 1; ax[k] = fx; zc[k] = fy > 0.02 ? fz / fy : 0; my += ay[k]; mx += ax[k];
    }
    my /= NT; mx /= NT;
    const W = p.omega, w0 = G / yv, wp = 2 * Math.PI * 0.6, zt = 0.9, c = this.coef;
    for (let n = 1; n <= NH; n++) {
      let ya = 0, yb = 0, xa = 0, xb = 0, za = 0, zb = 0;
      for (let k = 0; k < NT; k++) { const cs = COS[n][k], sn = SIN[n][k]; ya += (ay[k] - my) * cs; yb += (ay[k] - my) * sn; xa += (ax[k] - mx) * cs; xb += (ax[k] - mx) * sn; za += zc[k] * cs; zb += zc[k] * sn; }
      const k2 = 2 / NT, nw2 = n * n * W * W;
      c.y.a[n] = -ya * k2 * G / nw2; c.y.b[n] = -yb * k2 * G / nw2;
      c.x.a[n] = -xa * k2 * G / nw2; c.x.b[n] = -xb * k2 * G / nw2;
      c.z.a[n] = za * k2 * w0 / (nw2 + w0); c.z.b[n] = zb * k2 * w0 / (nw2 + w0);
      // trunk pitch: torque = -dvpp * Fx, second-order postural response
      const ta = -this.dvpp * xa * k2 * G / this.kg2, tb = -this.dvpp * xb * k2 * G / this.kg2, re = wp * wp - nw2, im = 2 * zt * wp * n * W, d = re * re + im * im;
      c.p.a[n] = (ta * re - tb * im) / d; c.p.b[n] = (tb * re + ta * im) / d;
    }
  }
  #eval(c, ph) { let v = 0; for (let n = 1; n <= NH; n++) { const a = 2 * Math.PI * n * ph; v += c.a[n] * Math.cos(a) + c.b[n] * Math.sin(a); } return v; }
  #acc(tab, ph) { const x = frac(ph) * NT, i = Math.floor(x), f = x - i; return tab[i] * (1 - f) + tab[(i + 1) % NT] * f; }

  // ---------- path ----------
  // Heading psi (about the vertical) and position O are integrated; by default the animal tracks a circle of radius R with its
  // right side toward the centre (dirS = +1) or, after turning round, its left (dirS = -1).
  #pose() { const a = this.psi; this.heading.set(Math.cos(a), 0, Math.sin(a)); this.right.set(-Math.sin(a), 0, Math.cos(a)); return -a; }
  // where the body frame will be after travelling ds along the current arc (constant curvature)
  #ahead(ds, O, T, Rt) {
    const k = this.kappa, a0 = this.psi, a = a0 + k * ds;
    if (Math.abs(k) < 1e-4) O.set(this.O.x + Math.cos(a0) * ds, 0, this.O.z + Math.sin(a0) * ds);
    else O.set(this.O.x + (Math.sin(a) - Math.sin(a0)) / k, 0, this.O.z - (Math.cos(a) - Math.cos(a0)) / k);
    T.set(Math.cos(a), 0, Math.sin(a)); Rt.set(-Math.sin(a), 0, Math.cos(a)); return -a;
  }
  // Turning. Yaw inertia of a ~9 t tyrannosaur is of order 3e4 kg m^2 and the hip muscles can put a few tens of kN m about the
  // vertical through a planted leg, so angular acceleration is of order 1 rad/s^2; the rate is further held to what a planted foot
  // can absorb as twist during one stance. A reversal is therefore a pivot of several seconds at a slow walk, not a spin.
  turnAround() { this.dirS = -this.dirS; this.turnSign = -this.dirS; }
  #steer(dt) {
    const a = Math.atan2(this.O.x, -this.O.z), e = Math.hypot(this.O.x, this.O.z) - this.R;
    const des = a + (this.dirS > 0 ? 0 : Math.PI) + this.dirS * Math.atan(e / 5);
    let err = Math.atan2(Math.sin(des - this.psi), Math.cos(des - this.psi)); if (Math.abs(err) > 2.6) err = Math.abs(err) * this.turnSign;   // a reversal pivots away from the centre
    this.turnErr = err;
    const cmd = Math.max(-this.turnMax, Math.min(this.turnMax, 2.2 * err)), dw = this.turnAcc * dt;
    this.omega += Math.max(-dw, Math.min(dw, cmd - this.omega));
  }
  #touchdown(ft, ds, out) {
    const O = t1, T = t2, Rt = t3, yaw = this.#ahead(ds, O, T, Rt), p = this.p;
    out.copy(O).addScaledVector(T, p.atd + 0.337).addScaledVector(Rt, ft.s * p.w); out.y = groundHeight(out.x, out.z) + 0.085;
    return yaw + ft.s * -2 * DEG;
  }
  #initFeet() {
    this.#tables();
    for (const ft of this.feet) {
      const pf = frac(this.phase - ft.off), p = this.p;
      const Std = -(pf < p.beta ? pf : pf - 1) * p.lambda;              // arc distance to the COM position at this foot's (last or next) touchdown
      ft.plant.yaw = this.#touchdown(ft, Std, ft.plant.T); ft.stance = pf < p.beta;
      if (!ft.stance) { ft.liftYaw = this.#touchdown(ft, Std - p.lambda, ft.lift); }
      ft.prevT.copy(ft.plant.T);
    }
    this.#pose();
  }

  // ---------- main update ----------
  update(dt) {
    if (!(dt > 0)) return;
    this.time += dt;
    // speed control; when asked to stop, finish the step into double support first
    const p0 = this.p, pfL = frac(this.phase), inDS = (pfL > 0.03 && pfL < p0.beta - 0.5 - 0.03) || (pfL > 0.53 && pfL < p0.beta - 0.03);
    this.#steer(dt); const pivot = Math.abs(this.turnErr) > 0.5;
    let tgt = this.hold ? 0 : this.target; if (pivot && !this.hold) tgt = Math.min(Math.max(tgt, 0.55), 0.6);                      // slow to a shuffle to pivot, even from a stand
    if (tgt < 0.05 && this.speed > 0 && !(inDS && this.speed <= 0.36)) tgt = 0.35;
    const acc = (tgt < 0.05 ? 1.2 : 0.55) * dt; this.speed += Math.min(acc, Math.max(-acc * 1.6, tgt - this.speed));
    if (this.speed < 0.004) this.speed = 0;
    const v = this.speed, p = this.p = this.gaitParams(v); this.walk = sst(0.02, 0.32, v);
    this.#tables();
    this.phase = frac(this.phase + (v > 0 ? dt / p.T * (v / p.v) : 0)); this.S += v * dt;
    if (v > 0) { const am = this.psi + 0.5 * this.omega * dt; this.O.x += Math.cos(am) * v * dt; this.O.z += Math.sin(am) * v * dt; this.psi += this.omega * dt; }
    this.kappa = v > 0.05 ? Math.max(-2.5, Math.min(2.5, this.omega / v)) : 0;
    const ph = this.phase, w = this.walk, d = this.dyn;
    d.dy = this.#eval(this.coef.y, ph) * w; d.dx = this.#eval(this.coef.x, ph) * w; d.dz = this.#eval(this.coef.z, ph) * w; d.pitch = this.#eval(this.coef.p, ph) * w;
    d.ay = this.#acc(this.tab.ay, ph) * G * w;
    d.yaw = -(5.5 - 2 * p.run) * DEG * Math.cos(2 * Math.PI * ph) * w;          // pelvic rotation: swing-side hip forward
    d.roll = 1.6 * DEG * Math.sin(2 * Math.PI * (ph - 0.08)) * w + Math.atan(v * this.omega / G);
    const yaw = this.#pose();
    this.qPath.setFromAxisAngle(UP, yaw);
    this.com.copy(this.O).addScaledVector(this.heading, d.dx).addScaledVector(this.right, d.dz); this.gY += (groundHeight(this.com.x, this.com.z) - this.gY) * Math.min(1, dt * 2.5); this.com.y = p.hip + this.comOff.y + d.dy + this.gY - this.poseDrop;
    const q = this.quat.copy(this.qPath);
    q.multiply(t1q.setFromAxisAngle(UP, d.yaw)).multiply(t1q.setFromAxisAngle(AZ, d.pitch + this.posePitch)).multiply(t1q.setFromAxisAngle(AX, d.roll));
    this.pos.copy(this.comOff).applyQuaternion(q).negate().add(this.com);

    // ---- feet: state machine and kinematic targets ----
    for (const ft of this.feet) {
      const pf = frac(ph - ft.off), wasStance = ft.stance; ft.stance = pf < p.beta || v === 0 && wasStance;
      if (ft.stance) {
        if (!wasStance) { ft.plant.T.copy(ft.Tw); ft.plant.T.y = groundHeight(ft.Tw.x, ft.Tw.z) + 0.085; ft.plant.yaw = ft.yaw; if (this.onFootfall) this.onFootfall(ft, p); }
        ft.s = Math.min(1, pf / p.beta); ft.u = 0;
        ft.Tw.copy(ft.plant.T); ft.yaw = ft.plant.yaw;
        ft.thD = (58 * Math.pow(sst(0.6, 1, ft.s), 1.15) - 5 * (1 - sst(0, 0.07, ft.s))) * DEG * w;
        ft.psi = kf(ft.s, [[0, -31], [0.55, 4], [1, 46]]) * DEG * w + (1 - w) * -15 * DEG;
        ft.curl = 0; ft.splay = 1 + 0.12 * Math.sin(Math.PI * ft.s);
        ft.Fy = this.Fy(ft.s) * this.mass * G * (w + (1 - w) * 0.5 / Math.max(0.05, this.Fy(ft.s))); if (v === 0) ft.Fy = 0.5 * this.mass * G;
      } else {
        if (wasStance) { ft.lift.copy(ft.Tw); ft.liftYaw = ft.yaw; }
        ft.u = (pf - p.beta) / (1 - p.beta); ft.s = 1; ft.Fy = 0;
        const tRem = (1 - ft.u) * (1 - p.beta) * p.T; ft.tgtYaw = this.#touchdown(ft, v * tRem, ft.tgt);
        const e = ft.u * ft.u * ft.u * (ft.u * (ft.u * 6 - 15) + 10);
        ft.Tw.lerpVectors(ft.lift, ft.tgt, e); ft.Tw.y += p.clear * Math.pow(Math.sin(Math.PI * Math.pow(ft.u, 0.85)), 1.3) * w;
        ft.yaw = ft.liftYaw + (ft.tgtYaw - ft.liftYaw) * e;
        ft.thD = kf(ft.u, [[0, 58], [0.16, 72], [0.7, 4], [0.9, -9], [1, -5]]) * DEG;
        ft.psi = kf(ft.u, [[0, 46], [0.2, 64], [0.82, -31], [1, -31]]) * DEG;
        ft.curl = kf(ft.u, [[0, 0], [0.3, 42], [0.8, 0]]) * DEG; ft.splay = kf(ft.u, [[0, 1], [0.35, 0.4], [0.88, 1.05], [1, 1]]);
      }
      if (dt > 0) ft.vel.copy(ft.Tw).sub(ft.prevT).divideScalar(dt); ft.prevT.copy(ft.Tw);
      // foot frame, MTP joint, ankle
      ft.qYaw = (ft.qYaw || new Q4()).setFromAxisAngle(UP, ft.yaw);
      ft.qFoot = (ft.qFoot || new Q4()).copy(ft.qYaw).multiply(t1q.setFromAxisAngle(AZ, -ft.thD));
      ft.fwd.set(1, 0, 0).applyQuaternion(ft.qYaw); ft.rt.set(0, 0, 1).applyQuaternion(ft.qYaw);
      ft.Mw.copy(ft.M).sub(ft.T0).applyQuaternion(ft.qFoot).add(ft.Tw);
    }
    // ---- pelvis height: drop if a leg would over-extend (smoothed) ----
    let need = 0;
    for (const ft of this.feet) {
      ft.Hw.copy(ft.hipLocal).applyQuaternion(q).add(this.pos);
      const lat = Math.max(-0.3, Math.min(0.3, t1.copy(ft.Hw).sub(ft.Mw).dot(ft.rt) * 0.22));
      ft.mtDir = (ft.mtDir || new V3()).copy(UP).multiplyScalar(Math.cos(ft.psi)).addScaledVector(ft.fwd, Math.sin(ft.psi)).addScaledVector(ft.rt, lat).normalize();
      ft.Aw.copy(ft.Mw).addScaledVector(ft.mtDir, ft.lm);
      const reach = (ft.lf + ft.lt) * 0.993, dx = ft.Hw.x - ft.Aw.x, dz = ft.Hw.z - ft.Aw.z, hmax = Math.sqrt(Math.max(0.04, reach * reach - dx * dx - dz * dz));
      if (ft.stance) need = Math.max(need, ft.Hw.y - ft.Aw.y - hmax);
    }
    this.drop += (need - this.drop) * Math.min(1, dt * (need > this.drop ? 40 : 9));
    if (need > this.drop) this.drop = need; // never allow over-extension
    this.pos.y -= this.drop;
    this.pelvis.obj.position.copy(this.pos); this.pelvis.obj.quaternion.copy(q);

    // ---- leg IK ----
    for (const ft of this.feet) {
      ft.Hw.copy(ft.hipLocal).applyQuaternion(q).add(this.pos);
      const hx = t1.copy(ft.Aw).sub(ft.Hw), full = hx.length(), dist = Math.min(full, (ft.lf + ft.lt) * 0.9995), n = hx.normalize();
      if (full > dist) { ft.Aw.addScaledVector(n, dist - full); ft.Mw.addScaledVector(n, dist - full); }
      const a = (ft.lf * ft.lf - ft.lt * ft.lt + dist * dist) / (2 * dist), hgt = Math.sqrt(Math.max(0, ft.lf * ft.lf - a * a));
      const pole = t2.copy(this.heading).addScaledVector(this.right, ft.s * 0.34).addScaledVector(UP, 0.15); pole.addScaledVector(n, -pole.dot(n)).normalize();
      ft.Kw.copy(ft.Hw).addScaledVector(n, a).addScaledVector(pole, hgt);
      const hinge = t3.crossVectors(t1.copy(ft.Kw).sub(ft.Hw), t2.copy(ft.Aw).sub(ft.Kw)).normalize().clone();
      ft.bFemur.obj.position.copy(ft.Hw); frameQuat(t4.copy(ft.Kw).sub(ft.Hw), hinge, ft.bFemur.obj.quaternion).multiply(ft.qF0);
      ft.bTibia.obj.position.copy(ft.Kw); frameQuat(t4.copy(ft.Aw).sub(ft.Kw), hinge, ft.bTibia.obj.quaternion).multiply(ft.qT0);
      ft.bMt.obj.position.copy(ft.Aw); frameQuat(t4.copy(ft.Mw).sub(ft.Aw), ft.rt, ft.bMt.obj.quaternion).multiply(ft.qM0);
      for (const dg of ft.dig) {
        dg.ba.obj.position.copy(dg.a).sub(ft.M).applyQuaternion(ft.qFoot).add(ft.Mw);
        const qa = dg.ba.obj.quaternion.copy(ft.qFoot).multiply(t1q.setFromAxisAngle(UP, dg.ang * (1 - ft.splay) * 0.8)).multiply(t1q.setFromAxisAngle(AZ, -ft.curl));
        dg.bb.obj.position.copy(dg.b).sub(dg.a).applyQuaternion(qa).add(dg.ba.obj.position);
        dg.bb.obj.quaternion.copy(qa).multiply(t1q.setFromAxisAngle(AZ, (ft.stance ? ft.thD * 0.92 : ft.thD * 0.25) - ft.curl * 0.8));
      }
      // ground reaction force vector and centre of pressure
      const yv = this.com.y + this.dvpp;
      ft.cop.copy(ft.Mw).addScaledVector(ft.fwd, this.cop(ft.s)); ft.cop.y = ft.plant.T.y - 0.085;
      if (ft.Fy > 0) { ft.F.copy(this.com).sub(ft.cop); ft.F.y = 0; ft.F.multiplyScalar(ft.Fy / yv * w); ft.F.y = ft.Fy; } else ft.F.set(0, 0, 0);
      ft.load = ft.Fy / (this.mass * G);
    }
  }
}
const t1q = new Q4(), t4 = new V3();
