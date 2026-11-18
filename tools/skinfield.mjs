// Look development for the integument, as functions of position on the resting body.
// Everything here is evaluated in 3D (never in UV space), so texture seams cannot show.
//   height():  surface relief in metres (folds, wrinkle network, feature scales, scutes, scars)
//   macro():   the part of the relief coarse enough to be put into the geometry itself
//   shade():   albedo, roughness, cavity
// Sample fields: x y z (rest position), nx ny nz (rest normal), a (axial coordinate along the
// underlying bone chain, m), dx dy dz (bone axis), loose, soft, joint, region weights r*, material masks m*.
import { vnoise, fbm, voro, V, h01, sst, clamp01 } from './noise.mjs';

// healed scars: [x, y, z,  x, y, z,  width]  (rest space; a few on the face and flanks)
const SCARS = [
  [5.02, 3.80, 0.215, 4.62, 3.93, 0.262, 0.012], [5.00, 3.745, 0.22, 4.66, 3.86, 0.27, 0.010], [4.93, 3.70, 0.225, 4.70, 3.78, 0.262, 0.008],
  [4.35, 4.20, -0.30, 4.62, 4.14, -0.18, 0.012], [1.9, 3.25, 0.66, 1.45, 3.0, 0.72, 0.016], [1.35, 3.3, 0.6, 1.1, 3.02, 0.68, 0.013],
  [-1.6, 3.35, -0.3, -2.3, 3.2, -0.25, 0.014], [0.4, 2.9, -0.62, 0.15, 2.5, -0.6, 0.015], [3.2, 3.75, 0.36, 3.45, 3.5, 0.37, 0.012],
];
function scar(S) {
  let m = 0;
  for (const s of SCARS) {
    if (Math.abs(S.x - (s[0] + s[3]) * 0.5) > 0.5 || Math.abs(S.z - (s[2] + s[5]) * 0.5) > 0.35) continue;
    const ax = s[3] - s[0], ay = s[4] - s[1], az = s[5] - s[2], px = S.x - s[0], py = S.y - s[1], pz = S.z - s[2];
    let t = (px * ax + py * ay + pz * az) / (ax * ax + ay * ay + az * az); t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(px - ax * t, py - ay * t, pz - az * t), w = s[6] * (0.4 + 2.4 * t * (1 - t)) * (0.8 + 0.5 * vnoise(S.x * 40, S.y * 40, S.z * 40));
    const v = 1 - sst(w * 0.5, w * 1.6, d); if (v > m) m = v;
  }
  return m;
}
// transverse skin folds: creases at intervals along the bone axis, each broken and of varying depth
function rings(S, spacing, seed, warpAmt) {
  const x = S.a / spacing + warpAmt * (fbm(S.x * 1.5 + seed, S.y * 1.5, S.z * 1.5, 3) - 0.5) * 4, i = Math.floor(x), t = x - i;
  let h = 0;
  for (let k = 0; k <= 1; k++) {
    const u = Math.abs(t - k), id = i + k, amp = 0.25 + 0.75 * h01(id, seed | 0, 17);
    const brk = sst(0.32, 0.55, vnoise(S.x * 2.3 + id * 3.7, S.y * 2.3 + seed, S.z * 2.3 - id * 1.9));
    h -= Math.exp(-(u * u) / 0.011) * amp * brk;
  }
  return h + 0.45 * 4 * t * (1 - t);   // crease (negative) plus the pillow of skin between creases
}
const looseness = S => clamp01(S.loose * 1.5);

export function macro(S) {
  const L = looseness(S), skin = 1 - clamp01(S.mKer + S.mMouth + S.mTongue + S.mDark);
  let h = 0;
  h += 0.0085 * rings(S, 0.125, 3, 0.5) * S.rNeck * (0.35 + 0.65 * L);
  h += 0.0050 * rings({ ...S, a: S.a + 0.32 * S.y }, 0.21, 11, 0.6) * S.rTorso * (0.25 + 0.75 * L);
  h += 0.0032 * rings(S, 0.14, 23, 0.35) * S.rTail * (0.4 + 0.6 * L);
  h += 0.0034 * rings(S, 0.17, 31, 0.5) * (S.rThigh + S.rShank) * (0.3 + 0.7 * L);
  h += 0.0050 * rings(S, 0.058, 41, 0.25) * S.joint;
  h += 0.0022 * rings(S, 0.05, 47, 0.3) * S.rArm;
  // ribs showing faintly through the flank
  const flank = S.rTorso * sst(0.55, 0.9, Math.abs(S.nz)) * sst(2.5, 2.9, S.y) * (1 - sst(3.3, 3.55, S.y)) * sst(0.75, 1.1, S.x) * (1 - sst(2.3, 2.6, S.x));
  h += 0.0016 * flank * Math.cos(6.2832 * (S.x + 0.33 * (S.y - 2.9)) / 0.19);
  h += (fbm(S.x * 1.6 + 8, S.y * 1.6, S.z * 1.6, 3) - 0.5) * 0.022 * (0.25 + S.soft) + (fbm(S.x * 5.2 + 2, S.y * 5.2, S.z * 5.2, 3) - 0.5) * 0.007;
  // rugose nasal and brow ornamentation
  h += S.rHead * sst(0.2, 0.75, S.ny) * (fbm(S.x * 19, S.y * 19, S.z * 19, 3) - 0.42) * 0.011;
  return h * skin;
}

// scratch object for results of the last height() call (reused by shade)
export const R = { fold: 0, groove: 0, scaleId: 0, scaleTop: 0, scar: 0, fine: 0 };
export function height(S) {
  const L = looseness(S), skin = 1 - clamp01(S.mKer + S.mMouth + S.mTongue + S.mDark + S.mPad);
  const hm = macro(S); let h = hm;
  // wrinkle network: polygonal cells stretched around the limb/trunk (shorter along the axis)
  const ad = S.x * S.dx + S.y * S.dy + S.z * S.dz, k1 = 1.1, f1 = 15, qx = (S.x + S.dx * ad * k1) * f1, qy = (S.y + S.dy * ad * k1) * f1, qz = (S.z + S.dz * ad * k1) * f1;
  const wz = (fbm(S.x * 3 + 5, S.y * 3, S.z * 3, 2) - 0.5) * 1.2;
  voro(qx + wz, qy - wz, qz + wz, 3); const g1 = 1 - sst(0.0, 0.14, V.f2 - V.f1), id1 = V.id;
  const f2 = 70; voro((S.x + S.dx * ad * 0.6) * f2, (S.y + S.dy * ad * 0.6) * f2, (S.z + S.dz * ad * 0.6) * f2, 9); const g2 = 1 - sst(0.0, 0.16, V.f2 - V.f1);
  const bodyW = skin * (1 - 0.6 * S.rHead) * (1 - S.rFoot) * (1 - 0.7 * S.rMt);
  h -= (0.0019 * g1 * (0.45 + 0.55 * L) + 0.0006 * g2) * bodyW;
  // feature scales on the face and lips, scutes down the shin and across the toes
  const scut = clamp01(S.rMt + S.rFoot + 0.6 * S.rShank * sst(1.3, 0.9, S.y)) * skin, face = S.rHead * skin;
  let top = 0, sid = id1;
  if (face > 0.02) { voro(S.x * 62, S.y * 62, S.z * 62, 21); const e = V.f2 - V.f1; top = sst(0.03, 0.26, e); sid = V.id; h += 0.0015 * (top - 0.6) * face; }
  if (scut > 0.02) { const ks = 0.9; voro((S.x + S.dx * ad * ks) * 34, (S.y + S.dy * ad * ks) * 34, (S.z + S.dz * ad * ks) * 34, 31); const e = V.f2 - V.f1, tp = sst(0.03, 0.22, e); h += 0.0024 * (tp - 0.6) * scut; if (scut > face) { top = tp; sid = V.id; } }
  // medium body scales (the finest relief lives in the tiling detail map applied in the shader)
  voro(S.x * 150, S.y * 150, S.z * 150, 41); const ms = sst(0.03, 0.3, V.f2 - V.f1); h += 0.00035 * (ms - 0.6) * bodyW;
  const sc = scar(S) * skin; h += 0.0022 * sc;
  // keratin striations, pad pebbles, palate ridges, tongue papillae
  if (S.mKer > 0.01) h += S.mKer * (vnoise(S.x * 260 * (1 - Math.abs(S.dx)) + ad * 9, S.y * 260 * (1 - Math.abs(S.dy)), S.z * 260 * (1 - Math.abs(S.dz))) - 0.5) * 0.0011;
  if (S.mPad > 0.01) { voro(S.x * 55, S.y * 55, S.z * 55, 51); h += S.mPad * 0.0022 * (sst(0.02, 0.3, V.f2 - V.f1) - 0.5); }
  if (S.mMouth > 0.01) h += S.mMouth * (0.0022 * Math.cos(6.2832 * S.a / 0.034) * sst(-0.2, 0.3, S.ny * -1) + (fbm(S.x * 60, S.y * 60, S.z * 60, 2) - 0.5) * 0.0012);
  if (S.mTongue > 0.01) { voro(S.x * 140, S.y * 140, S.z * 140, 61); h += S.mTongue * 0.0009 * (1 - V.f1); }
  R.fold = hm; R.groove = clamp01(g1 * (0.45 + 0.55 * L) + 0.25 * g2) * bodyW; R.scaleId = sid; R.scaleTop = top; R.scar = sc; R.fine = ms;
  return h;
}

const mix = (a, b, t) => a + (b - a) * t;
// albedo (linear RGB), roughness and cavity for the sample; call height(S) first (uses R)
export function shade(S, out) {
  const p3 = fbm(S.x * 1.25, S.y * 1.25, S.z * 1.25, 4), p8 = fbm(S.x * 4.1 + 3, S.y * 4.1, S.z * 4.1, 4), p30 = fbm(S.x * 17 + 9, S.y * 17, S.z * 17, 3);
  const leg = clamp01(S.rThigh + S.rShank + S.rMt + S.rFoot);
  // countershading with an irregular edge; limbs take the flank tone
  const dv = S.ny * 0.5 + 0.5;
  let dors = sst(0.2, 0.85, dv * 0.5 + sst(1.6, 3.6, S.y) * 0.62 + leg * 0.3 * (1 - sst(2.6, 3.2, S.y)) + (p3 - 0.5) * 0.36 + (p8 - 0.5) * 0.1);
  dors = Math.max(dors, 0.55 * S.rHead + 0.25 * S.rArm);
  let r = mix(0.40, 0.19, sst(0, 0.5, dors)), g = mix(0.34, 0.155, sst(0, 0.5, dors)), b = mix(0.25, 0.108, sst(0, 0.5, dors));
  const dk = sst(0.45, 1.0, dors); r = mix(r, 0.078, dk); g = mix(g, 0.066, dk); b = mix(b, 0.052, dk);
  // broad, broken saddle bands over the back and tail; darker face and crests
  const band = sst(0.1, 0.75, Math.sin(S.a * 3.9 + (fbm(S.x * 0.7, S.y * 1.3, S.z * 1.3, 3) - 0.5) * 7 + S.y * 1.1)) * sst(0.2, 0.62, dors) * (1 - S.rHead);
  r = mix(r, 0.034, band * 0.75); g = mix(g, 0.03, band * 0.75); b = mix(b, 0.025, band * 0.75);
  const crest = S.rHead * sst(0.5, 0.78, fbm(S.x * 4.6 + 2, S.y * 4.6, S.z * 4.6, 3)) * sst(-0.1, 0.5, S.ny);
  r *= 1 + 0.5 * crest; g *= 1 - 0.05 * crest; b *= 1 - 0.22 * crest;
  // mottling at three scales, per-scale tint, speckles
  const mot = 0.74 + 0.52 * p8; r *= mot; g *= mot; b *= mot * (0.97 + 0.06 * p3);
  const tint = 0.86 + 0.28 * R.scaleId; r *= tint; g *= tint * (0.985 + 0.03 * R.scaleId); b *= tint;
  const spk = sst(0.66, 0.74, p30) * (1 - dk) * 0.35; r *= 1 - spk; g *= 1 - spk; b *= 1 - spk;
  // grooves hold dirt; scars heal pale and pink
  const gr = R.groove; r *= 1 - 0.24 * gr; g *= 1 - 0.26 * gr; b *= 1 - 0.28 * gr;
  const fold = clamp01(-R.fold / 0.006); r *= 1 - 0.25 * fold; g *= 1 - 0.27 * fold; b *= 1 - 0.3 * fold;
  r = mix(r, 0.30, R.scar * 0.5); g = mix(g, 0.215, R.scar * 0.5); b = mix(b, 0.185, R.scar * 0.5);
  let rough = 0.66 - 0.12 * R.scaleTop + 0.16 * gr + 0.08 * fold + 0.06 * (p30 - 0.5);
  // dried mud and dust low on the limbs and belly, splashed upward
  const mud = clamp01(sst(1.55, 0.1, S.y) * (0.25 + 0.9 * fbm(S.x * 3.3 + 1, S.y * 2.2, S.z * 3.3, 3)) + sst(0.62, 0.8, fbm(S.x * 9, S.y * 5, S.z * 9, 3)) * sst(2.3, 1.2, S.y) * 0.5) * (1 - S.mKer * 0.5);
  const mc = 0.75 + 0.5 * p30; r = mix(r, 0.27 * mc, mud * 0.72); g = mix(g, 0.225 * mc, mud * 0.72); b = mix(b, 0.165 * mc, mud * 0.72); rough = mix(rough, 0.93, mud * 0.8);
  // keratin: dark horn with pale longitudinal streaks, worn at the tip
  if (S.mKer > 0.01) { const st = vnoise(S.x * 220 * (1 - Math.abs(S.dx)), S.y * 220 * (1 - Math.abs(S.dy)), S.z * 220 * (1 - Math.abs(S.dz))), k = 0.03 + 0.09 * st + 0.05 * p30;
    r = mix(r, k * 1.15, S.mKer); g = mix(g, k, S.mKer); b = mix(b, k * 0.82, S.mKer); rough = mix(rough, 0.34 + 0.2 * st, S.mKer); }
  if (S.mPad > 0.01) { const k = 0.085 + 0.05 * p30; r = mix(r, k * 1.1, S.mPad * 0.85); g = mix(g, k, S.mPad * 0.85); b = mix(b, k * 0.9, S.mPad * 0.85); rough = mix(rough, 0.9, S.mPad); }
  if (S.mMouth > 0.01) { const v = 0.75 + 0.5 * p30; r = mix(r, 0.47 * v, S.mMouth); g = mix(g, 0.165 * v, S.mMouth); b = mix(b, 0.16 * v, S.mMouth); rough = mix(rough, 0.3, S.mMouth); }
  if (S.mTongue > 0.01) { const v = 0.8 + 0.4 * p30; r = mix(r, 0.40 * v, S.mTongue); g = mix(g, 0.15 * v, S.mTongue); b = mix(b, 0.17 * v, S.mTongue); rough = mix(rough, 0.36, S.mTongue); }
  if (S.mDark > 0.01) { r = mix(r, 0.014, S.mDark); g = mix(g, 0.011, S.mDark); b = mix(b, 0.01, S.mDark); rough = mix(rough, 0.45, S.mDark); }
  out.r = r; out.g = g; out.b = b; out.rough = clamp01(rough);
  out.cav = clamp01(1 - 0.55 * gr - 0.45 * fold - 0.25 * (1 - R.fine) * 0.5);
  out.fold = clamp01(0.5 + (R.fold - 0.6 * 0.004 * gr) / 0.02);
}
