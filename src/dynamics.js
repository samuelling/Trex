// Everything that rides on the gait: axial skeleton, spring-suspended tail, head stabilisation,
// muscle activation from joint moments, and the wobbling-mass lattice for soft tissue.
import * as THREE from 'three';
import { sst, kf } from './gait.js';
import { Tail } from './tail.js';

const V3 = THREE.Vector3, Q4 = THREE.Quaternion, DEG = Math.PI / 180, G = 9.81;
const UP = new V3(0, 1, 0), AX = new V3(1, 0, 0), AZ = new V3(0, 0, 1);
const a1 = new V3(), a2 = new V3(), a3 = new V3(), a4 = new V3(), q1 = new Q4(), q2 = new Q4();

// second-order follower (critically/under-damped spring toward a target)
class Spring { constructor(w, z) { this.w = w; this.z = z; this.x = 0; this.v = 0; } step(target, dt) { const n = Math.max(1, Math.ceil(dt * this.w / 0.25)), h = dt / n; for (let i = 0; i < n; i++) { this.v += h * (this.w * this.w * (target - this.x) - 2 * this.z * this.w * this.v); this.x += h * this.v; } return this.x; } }

export class Body {
  constructor(rex, loco) {
    this.rex = rex; this.loco = loco; const B = n => rex.bone(n);
    this.spine = ['dors1', 'dors2', 'dors3', 'dors4'].map(B); this.neck = ['neck1', 'neck2', 'neck3', 'neck4'].map(B); this.head = B('head'); this.jaw = B('jaw');
    this.pelvis = B('pelvis');
    this.arms = ['R', 'L'].map(S => ({ s: S === 'R' ? 1 : -1, hu: B('humerus_' + S), fa: B('forearm_' + S), ha: B('hand_' + S), sp: new Spring(9, 0.35) }));
    // tail: joints 0..12 (0 = base, rigid with pelvis; 12 = tip)
    this.tailB = []; for (let i = 1; i <= 12; i++) this.tailB.push(B('tail' + i));
    this.tr = this.tailB.map(b => b.rest.clone()); this.tr.push(new V3(...rex.meta.landmarks.tailTip));
    this.tq = this.tr.map(() => new Q4()); this.tDir = [];
    for (let i = 0; i < 12; i++) this.tDir.push(this.tr[i + 1].clone().sub(this.tr[i]).normalize());
    const tR = rex.meta.landmarks.tailR; this.tail = new Tail(this.tr.map(v => v.toArray()), tR.rw, tR.rh); this.tailFv = this.tail.f;
    // gaze / head
    this.gYaw = new Spring(3.2, 1); this.gPitch = new Spring(3.2, 1); this.gazeT = 0; this.gazeYaw = 0; this.gazePitch = 0;
    this.neckBob = new Spring(7, 0.5); this.jawS = new Spring(14, 0.7); this.roarT = -1; this.breathT = 0; this.blinkT = 2; this.headLift = new Spring(5, 0.9);
    // muscles
    this.act = new Float32Array(32); this.exc = new Float32Array(32); this.len = new Float32Array(32).fill(1);
    this.musGain = 1.5; this.fleshGain = 1.5;
    const mp = rex.meta.landmarks.musclePaths; this.paths = [];
    for (const [name, [ba, pa, bb, pb]] of Object.entries(mp)) for (const [S, s] of [['R', 1], ['L', -1]]) {
      const bn = n => B(n.startsWith('pelvis') || n.startsWith('tail') ? n : n + '_' + S), A = bn(ba), C = bn(bb);
      const P = p => new V3(p[0], p[1], p[2] * s); this.paths.push({ i: rex.musIdx[name + '_' + S], A, C, pa: P(pa), pb: P(pb), l0: P(pa).distanceTo(P(pb)) });
    }
    this.mi = n => rex.musIdx[n];
    this.flesh = new Flesh(rex);
    this.camPos = null;
  }

  roar() { if (this.roarT < 0) this.roarT = 0; }

  update(dt) {
    const L = this.loco, rex = this.rex, d = L.dyn, w = L.walk, qp = L.quat, t = L.time;
    // ---------- dorsal column: counter-rotate so the chest and head stay on heading ----------
    let prev = this.pelvis; const cs = [0.22, 0.45, 0.68, 0.9];
    this.spine.forEach((b, i) => {
      b.obj.quaternion.copy(qp).multiply(q1.setFromAxisAngle(UP, -d.yaw * cs[i])).multiply(q1.setFromAxisAngle(AX, -(d.roll - Math.atan(L.speed * L.speed / (G * L.R))) * cs[i] * 0.8));
      b.obj.position.copy(b.rest).sub(prev.rest).applyQuaternion(prev.obj.quaternion).add(prev.obj.position); prev = b;
    });
    // ---------- head: stabilised gaze, neck interpolates from chest to head ----------
    this.gazeT -= dt;
    if (this.gazeT < 0) {
      this.gazeT = 2.5 + Math.random() * 5;
      if (this.camPos && Math.random() < 0.45) { a1.copy(this.camPos).sub(this.head.obj.position); const yw = Math.atan2(-a1.dot(L.right), a1.dot(L.heading)); this.gazeYaw = Math.max(-0.75, Math.min(0.75, yw)); this.gazePitch = Math.max(-0.2, Math.min(0.25, Math.atan2(a1.y, Math.hypot(a1.x, a1.z)))); }
      else { this.gazeYaw = (Math.random() - 0.5) * 0.7; this.gazePitch = (Math.random() - 0.6) * 0.22; }
    }
    // roar: head up and forward, jaws wide
    let roar = 0; if (this.roarT >= 0) { this.roarT += dt; roar = kf(this.roarT, [[0, 0], [0.45, 1], [2.3, 1], [3.1, 0]]); if (this.roarT > 3.1) this.roarT = -1; }
    const gy = this.gYaw.step(this.gazeYaw * (1 - roar), dt), gp = this.gPitch.step(this.gazePitch * (1 - roar) + roar * 0.42, dt);
    const bob = this.neckBob.step(-d.ay * 0.006, dt);
    const qHead = q2.copy(L.qPath).multiply(q1.setFromAxisAngle(UP, gy)).multiply(q1.setFromAxisAngle(AZ, gp + bob * 0.5 + d.pitch * 0.3)).multiply(q1.setFromAxisAngle(AX, Math.sin(t * 0.37) * 0.03)).clone();
    const chest = this.spine[3].obj.quaternion, ns = [0.22, 0.46, 0.7, 0.9]; prev = this.spine[3];
    this.neck.forEach((b, i) => {
      b.obj.quaternion.copy(chest).slerp(qHead, ns[i]).multiply(q1.setFromAxisAngle(AZ, bob * (1 - ns[i]) + roar * 0.07));
      b.obj.position.copy(b.rest).sub(prev.rest).applyQuaternion(prev.obj.quaternion).add(prev.obj.position); prev = b;
    });
    this.head.obj.quaternion.copy(qHead); this.head.obj.position.copy(this.head.rest).sub(prev.rest).applyQuaternion(prev.obj.quaternion).add(prev.obj.position);
    // ---------- jaw + breathing ----------
    this.breathT += dt * (0.22 + 0.25 * L.p.Fr * w + 0.1 * w) * 2 * Math.PI;
    const breath = Math.sin(this.breathT); rex.uniforms.uBreath.value = 0.022 * (0.5 + 0.5 * breath) * (1 + roar);
    const open = this.jawS.step((0.25 + (0.6 + 1.4 * w * Math.min(1, L.p.Fr * 2.5)) * Math.max(0, breath) + roar * (27 + 1.5 * Math.sin(t * 38))) * DEG, dt);
    this.jawOpen = open;
    this.jaw.obj.quaternion.copy(qHead).multiply(q1.setFromAxisAngle(AZ, -open));
    this.jaw.obj.position.copy(this.jaw.rest).sub(this.head.rest).applyQuaternion(qHead).add(this.head.obj.position);
    // blink
    this.blinkT -= dt; if (this.blinkT < -0.13) this.blinkT = 2 + Math.random() * 6;
    for (const e of rex.eyes) e.userData.lid.visible = this.blinkT < 0;
    // ---------- arms: small passive swing ----------
    for (const a of this.arms) {
      const sw = a.sp.step(-d.ay * 0.02 + Math.sin(t * 0.6 + a.s) * 0.04 + roar * 0.35, dt);
      const c = this.spine[3];
      a.hu.obj.quaternion.copy(c.obj.quaternion).multiply(q1.setFromAxisAngle(AZ, sw)); a.hu.obj.position.copy(a.hu.rest).sub(c.rest).applyQuaternion(c.obj.quaternion).add(c.obj.position);
      a.fa.obj.quaternion.copy(a.hu.obj.quaternion).multiply(q1.setFromAxisAngle(AZ, sw * 0.8 + roar * 0.3)); a.fa.obj.position.copy(a.fa.rest).sub(a.hu.rest).applyQuaternion(a.hu.obj.quaternion).add(a.hu.obj.position);
      a.ha.obj.quaternion.copy(a.fa.obj.quaternion).multiply(q1.setFromAxisAngle(AZ, sw * 0.6)); a.ha.obj.position.copy(a.ha.rest).sub(a.fa.rest).applyQuaternion(a.fa.obj.quaternion).add(a.fa.obj.position);
    }
    this.#tail(dt);
    this.#muscles(dt, roar);
    this.flesh.gain = this.fleshGain;
    this.flesh.update(dt, this.act);
    this.rex.skin.update(dt);
  }

  // Tail: elastic beam cantilevered from the pelvis (see tail.js); bones follow the simulated joints.
  #tail(dt) {
    const L = this.loco, T = this.tail, x = T.x, base = this.tailB[0];
    a4.copy(base.rest).sub(this.pelvis.rest).applyQuaternion(L.quat).add(L.pos);
    if (T.f !== this.tailFv) T.setFreq(this.tailFv);
    T.step(dt, [a4.x, a4.y, a4.z], [L.quat.x, L.quat.y, L.quat.z, L.quat.w]);
    let qs = q2.copy(L.quat);
    for (let j = 0; j < 12; j++) {
      a1.set(x[3 * j + 3] - x[3 * j], x[3 * j + 4] - x[3 * j + 1], x[3 * j + 5] - x[3 * j + 2]).normalize();
      a2.copy(this.tDir[j]).applyQuaternion(qs); q1.setFromUnitVectors(a2, a1); qs = this.tq[j].copy(q1).multiply(qs);
      this.tailB[j].obj.position.set(x[3 * j], x[3 * j + 1], x[3 * j + 2]); this.tailB[j].obj.quaternion.copy(qs);
    }
    this.tailLat = a1.set(x[24], x[25], x[26]).sub(L.pos).dot(L.right);
  }

  // Muscle excitation from quasi-static inverse dynamics: the external moment of the ground reaction
  // force about each joint is what the corresponding muscle group must resist.
  #muscles(dt, roar) {
    const L = this.loco, e = this.exc, mi = this.mi, rt = L.right, w = L.walk; e.fill(0.04);
    for (const ft of L.feet) {
      const S = ft.S, sp = Math.min(1.6, 0.5 + L.p.Fr * 1.3);
      if (ft.Fy > 0) {
        const mom = J => a1.copy(ft.cop).sub(J).cross(ft.F).dot(rt) / 1000;         // kN m, + = GRF ahead of joint
        const mh = mom(ft.Hw), mk = mom(ft.Kw), ma = mom(ft.Aw), mm = mom(ft.Mw);
        const n = (x, ref) => Math.pow(Math.min(1, Math.max(0, x) / ref), 0.8);
        e[mi('cfl_' + S)] += n(mh, 70) * 0.95 + 0.25 * ft.load; e[mi('hamstring_' + S)] += n(mh, 90) * 0.6 + n(mk, 60) * 0.5;
        e[mi('hipFlex_' + S)] += n(-mh, 60) * 0.7; e[mi('kneeExt_' + S)] += n(-mk, 55) + 0.2 * ft.load;
        e[mi('gastroc_' + S)] += n(ma, 60) + 0.15 * ft.load; e[mi('tibCran_' + S)] += n(-ma, 30) * 0.6; e[mi('digFlex_' + S)] += n(mm, 30);
        e[mi('adductor_' + S)] += 0.3 * ft.load; if (ft.s > 0.85) e[mi('hipFlex_' + S)] += sst(0.85, 1, ft.s) * 0.5 * w;
        ft.moments = [mh, mk, ma, mm];
      } else {
        const u = ft.u;
        e[mi('hipFlex_' + S)] += kf(u, [[0, 0.55], [0.3, 0.75], [0.6, 0.15], [1, 0]]) * sp * w;
        e[mi('hamstring_' + S)] += kf(u, [[0, 0.3], [0.2, 0.45], [0.5, 0.05], [0.75, 0.4], [1, 0.5]]) * sp * w;
        e[mi('tibCran_' + S)] += kf(u, [[0, 0.5], [0.5, 0.6], [0.85, 0.25], [1, 0.1]]) * w;
        e[mi('kneeExt_' + S)] += kf(u, [[0.45, 0], [0.8, 0.5], [1, 0.3]]) * sp * w; e[mi('cfl_' + S)] += kf(u, [[0.6, 0], [1, 0.35]]) * sp * w;
        ft.moments = null;
      }
    }
    // axial: epaxials resist trunk pitch/roll with each step; tail muscles follow tail swing
    const ph = L.phase, d = L.dyn;
    e[mi('epax_R')] += (0.25 + 0.35 * Math.max(0, Math.sin(2 * Math.PI * (ph + 0.1))) + Math.max(0, d.ay) * 0.05) * (0.3 + 0.7 * w);
    e[mi('epax_L')] += (0.25 + 0.35 * Math.max(0, -Math.sin(2 * Math.PI * (ph + 0.1))) + Math.max(0, d.ay) * 0.05) * (0.3 + 0.7 * w);
    const tl = Math.max(-1, Math.min(1, (this.tailLat || 0) * 2.5)); e[mi('tailLat_R')] += 0.15 + 0.5 * Math.max(0, -tl); e[mi('tailLat_L')] += 0.15 + 0.5 * Math.max(0, tl);
    e[mi('neckDors_R')] += 0.3 + 0.4 * Math.max(0, -this.gYaw.x) + roar * 0.5; e[mi('neckDors_L')] += 0.3 + 0.4 * Math.max(0, this.gYaw.x) + roar * 0.5; e[mi('neckVent')] += 0.1 + roar * 0.6;
    e[mi('jawAdd')] += 0.15 + roar * 0.7; for (const S of ['R', 'L']) { e[mi('pect_' + S)] += 0.1 + roar * 0.3; e[mi('arm_' + S)] += 0.1 + roar * 0.5; }
    // activation dynamics (faster on than off)
    for (let i = 0; i < 32; i++) { const x = Math.min(1, e[i]); this.act[i] += (x - this.act[i]) * Math.min(1, dt / (x > this.act[i] ? 0.07 : 0.14)); }
    // fibre length -> belly thickness (isovolumetric), plus stiffening bulge when active
    this.len.fill(1);
    for (const p of this.paths) { const l = this.rex.toWorld(p.A, p.pa, a1).distanceTo(this.rex.toWorld(p.C, p.pb, a2)) / p.l0; this.len[p.i] = l; }
    const g = this.musGain, U = this.rex.uMus, A = this.rex.uAct;
    for (let i = 0; i < 32; i++) { U[i] = g * ((1 / Math.sqrt(Math.max(0.6, Math.min(1.5, this.len[i]))) - 1) * 0.55 + this.act[i] * 0.075); A[i] = this.act[i]; }
  }
}

// Wobbling-mass lattice: soft tissue as damped point masses tethered to the skeleton and to each other.
// Driven only by the motion of their anchors, so foot impacts and limb accelerations ripple through.
export class Flesh {
  constructor(rex) {
    this.rex = rex; const N = this.N = rex.meta.nodes.length; this.nodes = rex.meta.nodes;
    this.x = new Float32Array(N * 3); this.v = new Float32Array(N * 3); this.t0 = new Float32Array(N * 3); this.t1 = new Float32Array(N * 3); this.u = new Float32Array(N * 3);
    this.init = false; this.gain = 1.5; this.fScale = 1.45; this.rest = this.nodes.map(n => new V3(n.p[0], n.p[1], n.p[2])); this.maxU = 0;
  }
  #targets(out) {
    const rex = this.rex;
    for (let i = 0; i < this.N; i++) {
      let x = 0, y = 0, z = 0, ws = 0;
      for (const [bi, bw] of this.nodes[i].bones) { rex.toWorld(rex.bones[bi], this.rest[i], a1); x += a1.x * bw; y += a1.y * bw; z += a1.z * bw; ws += bw; }
      out[3 * i] = x / ws; out[3 * i + 1] = y / ws; out[3 * i + 2] = z / ws;
    }
  }
  update(dt, act) {
    const { N, x, v, t0, t1, u, nodes } = this;
    if (!this.init) { this.#targets(t1); x.set(t1); t0.set(t1); this.init = true; }
    t0.set(t1); this.#targets(t1);
    if (!(dt > 1e-6)) return;
    const n = Math.max(1, Math.min(10, Math.ceil(dt * 240))), h = dt / n, inv = 1 / dt, zeta = 0.2, kc = 0.35;
    for (let s = 0; s < n; s++) {
      const al = (s + 1) / n;
      for (let i = 0; i < N; i++) for (let c = 0; c < 3; c++) u[3 * i + c] = x[3 * i + c] - (t0[3 * i + c] + (t1[3 * i + c] - t0[3 * i + c]) * al);
      for (let i = 0; i < N; i++) {
        const nd = nodes[i], w = 2 * Math.PI * nd.f * this.fScale * (1 + 1.3 * (nd.mus >= 0 ? act[nd.mus] : 0)), w2 = w * w, cd = 2 * zeta * w;
        for (let c = 0; c < 3; c++) {
          const o = 3 * i + c, tv = (t1[o] - t0[o]) * inv; let cp = 0; for (const j of nd.nb) cp += u[3 * j + c] - u[o];
          v[o] += h * (-w2 * u[o] - cd * (v[o] - tv) + kc * w2 * cp / Math.max(1, nd.nb.length)); x[o] += h * v[o];
        }
      }
    }
    const D = this.rex.nodeData, g = this.gain; let mx = 0;
    for (let i = 0; i < N; i++) {
      let ux = x[3 * i] - t1[3 * i], uy = x[3 * i + 1] - t1[3 * i + 1], uz = x[3 * i + 2] - t1[3 * i + 2]; const m = Math.hypot(ux, uy, uz), lim = 0.2;
      if (m > lim) { const k = lim / m; ux *= k; uy *= k; uz *= k; x[3 * i] = t1[3 * i] + ux; x[3 * i + 1] = t1[3 * i + 1] + uy; x[3 * i + 2] = t1[3 * i + 2] + uz; }
      const sat = g * 0.09 * Math.tanh(m / 0.09) / Math.max(m, 1e-6);       // tissue can only stretch so far
      D[4 * i] = ux * sat; D[4 * i + 1] = uy * sat; D[4 * i + 2] = uz * sat; if (m > mx) mx = m;
    }
    if (!Number.isFinite(mx)) { x.set(t1); v.fill(0); D.fill(0, 0, 4 * 256); for (let i = 0; i < N; i++) D[4 * i + 3] = nodes[i].soft; mx = 0; }   // never let a bad frame poison the lattice
    this.maxU = mx; this.rex.nodeTex.needsUpdate = true;
  }
}
