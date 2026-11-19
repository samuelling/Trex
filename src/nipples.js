// The weird option: the whole hide studded with hairy nipples.
// Sites are scattered evenly over the skin (a Poisson-disc pick of body vertices). Each body vertex stores the vector from its
// nearest site, so the skin shader can raise a nub and paint an areola there with no lookups, and the result stretches, sags and
// wobbles with the simulated skin. The hairs are real strands: each is rooted on a body vertex and carries that vertex's
// deformation data, so it rides the same muscle bulge, soft-tissue wobble and skin slide as the patch of hide it grows from.
import * as THREE from 'three';
import { VERT_PARS, VERT_MAIN } from './skinShader.js';

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// Uneven on purpose: a smooth random density field over the body decides where they crowd, where they thin out and where there
// are none. Spacing shrinks where the field is high (clusters of small ones) and grows where it is low (big loners), and below a
// threshold the hide is bare. Size follows crowding: each site's random number is drawn from a band set by the local density.
const fr = (x) => x - Math.floor(x), h3 = (i, j, k, s) => fr(Math.sin(i * 127.1 + j * 311.7 + k * 74.7 + s * 19.3) * 43758.5453);
function vnoise(x, y, z, s) { const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z), u = x - i, v = y - j, w = z - k, a = u * u * (3 - 2 * u), b = v * v * (3 - 2 * v), c = w * w * (3 - 2 * w), L = (p, q, t) => p + (q - p) * t;
  return L(L(L(h3(i, j, k, s), h3(i + 1, j, k, s), a), L(h3(i, j + 1, k, s), h3(i + 1, j + 1, k, s), a), b), L(L(h3(i, j, k + 1, s), h3(i + 1, j, k + 1, s), a), L(h3(i, j + 1, k + 1, s), h3(i + 1, j + 1, k + 1, s), a), b), c); }
const density = (x, y, z, seed) => 0.68 * vnoise(x * 0.75, y * 0.75, z * 0.75, seed) + 0.32 * vnoise(x * 2.1 + 5, y * 2.1, z * 2.1, seed + 1);
const sst = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const nipSize = (w) => 0.6 + 0.9 * w;   // must match the shader

export function buildNipples(rex, { strands = 11, seed = 7 } = {}) {
  const g = rex.mesh.geometry, A = g.attributes, P = A.position.array, N8 = A.normal.array, MS = A.aMisc.array, nV = A.position.count, rnd = rng(1234);
  const RMIN = 0.1, RMAX = 0.62, spacing = RMAX;
  // a handful of colonies: tight swarms around random spots of plain skin, on top of the general patchiness
  const colonies = []; for (let t = 0; t < 400 && colonies.length < 9; t++) { const i = Math.floor(rnd() * nV); if (MS[4 * i] !== 0) continue; colonies.push([P[3 * i], P[3 * i + 1], P[3 * i + 2], 0.28 + 0.3 * rnd()]); }
  const dens = (x, y, z) => { let d = sst(0.36, 0.78, density(x, y, z, seed)); for (const c of colonies) d = Math.max(d, 1 - sst(c[3] * 0.55, c[3], Math.hypot(x - c[0], y - c[1], z - c[2]))); return d; };
  const nrm = (i, o) => { const x = N8[4 * i], y = N8[4 * i + 1], z = N8[4 * i + 2], l = 1 / (Math.hypot(x, y, z) || 1); o[0] = x * l; o[1] = y * l; o[2] = z * l; return o; };
  // ---- sites: vertices of plain skin, no two closer than `spacing` ----
  const key = (x, y, z, h) => (Math.floor(x / h) + 512) + (Math.floor(y / h) + 512) * 1024 + (Math.floor(z / h) + 512) * 1048576;
  const order = new Uint32Array(nV); for (let i = 0; i < nV; i++) order[i] = i; for (let i = nV - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)), t = order[i]; order[i] = order[j]; order[j] = t; }
  const cells = new Map(), sites = [];
  for (let q = 0; q < nV; q++) { const i = order[q]; if (MS[4 * i] !== 0) continue; const x = P[3 * i], y = P[3 * i + 1], z = P[3 * i + 2], d = dens(x, y, z); if (d <= 0) continue;          // bare skin
    const r = RMAX + (RMIN - RMAX) * Math.pow(d, 0.55); let ok = true;
    for (let a = -1; a <= 1 && ok; a++) for (let b = -1; b <= 1 && ok; b++) for (let c = -1; c <= 1 && ok; c++) { const L = cells.get(key(x + a * spacing, y + b * spacing, z + c * spacing, spacing)); if (L) for (const s of L) { const S = sites[s], m = Math.max(r, S.r); if ((S.x - x) ** 2 + (S.y - y) ** 2 + (S.z - z) ** 2 < m * m) { ok = false; break; } } }
    if (!ok) continue; const k = key(x, y, z, spacing); if (!cells.has(k)) cells.set(k, []); cells.get(k).push(sites.length); const n = nrm(i, [0, 0, 0]);
    const lo = 0.55 * (1 - d), w = Math.min(0.999, lo + (0.45 + 0.1 * (1 - d)) * rnd());                                              // crowded -> small, isolated -> big
    sites.push({ x, y, z, n, v: i, r, rand: w }); }
  // ---- per vertex: offset from the nearest site that faces the same way, and that site's random number ----
  const nip = new Float32Array(nV * 4), tn = [0, 0, 0];
  for (let i = 0; i < nV; i++) { const x = P[3 * i], y = P[3 * i + 1], z = P[3 * i + 2]; nrm(i, tn); let best = 1e9, bs = null;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) { const L = cells.get(key(x + a * spacing, y + b * spacing, z + c * spacing, spacing)); if (!L) continue;
      for (const s of L) { const S = sites[s]; if (S.n[0] * tn[0] + S.n[1] * tn[1] + S.n[2] * tn[2] < 0.25) continue; const dd = (S.x - x) ** 2 + (S.y - y) ** 2 + (S.z - z) ** 2; if (dd < best) { best = dd; bs = S; } } }
    if (bs) { nip[4 * i] = x - bs.x; nip[4 * i + 1] = y - bs.y; nip[4 * i + 2] = z - bs.z; nip[4 * i + 3] = bs.rand; } else { nip[4 * i] = nip[4 * i + 1] = nip[4 * i + 2] = 1; } }
  g.setAttribute('aNip', new THREE.BufferAttribute(nip, 4));

  // ---- hair: strands rooted on body vertices around each areola ----
  const vh = 0.03, vcell = new Map(); for (let i = 0; i < nV; i++) { if (MS[4 * i] !== 0) continue; const k = key(P[3 * i], P[3 * i + 1], P[3 * i + 2], vh); let L = vcell.get(k); if (!L) vcell.set(k, L = []); L.push(i); }
  const nearestVert = (x, y, z) => { let best = 1e9, bi = -1; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) { const L = vcell.get(key(x + a * vh, y + b * vh, z + c * vh, vh)); if (L) for (const i of L) { const dd = (P[3 * i] - x) ** 2 + (P[3 * i + 1] - y) ** 2 + (P[3 * i + 2] - z) ** 2; if (dd < best) { best = dd; bi = i; } } } return bi; };
  const SEG = 5, SIDES = 3, perStrand = (SEG + 1) * SIDES, maxS = sites.length * strands, anchor = new Uint32Array(maxS * perStrand), off = new Float32Array(maxS * perStrand * 4), hn = new Float32Array(maxS * perStrand * 4), idx = [];
  const t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), n = new THREE.Vector3(), rad = new THREE.Vector3(), tanv = new THREE.Vector3(), p = new THREE.Vector3(), prev = new THREE.Vector3(), dir = new THREE.Vector3(), s1 = new THREE.Vector3(), s2 = new THREE.Vector3(), o = new THREE.Vector3(); let ns = 0;
  for (const S of sites) { const sz = nipSize(S.rand); n.fromArray(S.n); t1.crossVectors(n, Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize(); t2.crossVectors(n, t1);
    const count = Math.round(strands * (0.5 + 0.8 * rnd()) * sz);
    for (let k = 0; k < count && ns < maxS; k++) { const ph = rnd() * Math.PI * 2, rr = (0.036 + 0.03 * rnd()) * sz; rad.copy(t1).multiplyScalar(Math.cos(ph)).addScaledVector(t2, Math.sin(ph));
      const vi = nearestVert(S.x + rad.x * rr, S.y + rad.y * rr, S.z + rad.z * rr); if (vi < 0) continue; nrm(vi, tn); n.fromArray(tn);
      // each hair leaves the skin at an angle, arcs outward, and curls to one side: wiry, not groomed
      const L = (0.045 + 0.075 * rnd() * rnd()) * sz, lift = 0.5 + 0.9 * rnd(), curl = (rnd() - 0.5) * 2.4, sag = 0.5 + 0.9 * rnd(), r0 = 0.0021 + 0.0009 * rnd(), shade = rnd(); tanv.crossVectors(n, rad).normalize(); rad.crossVectors(tanv, n).normalize();
      const base = ns * perStrand; prev.set(0, 0, 0);
      for (let j = 0; j <= SEG; j++) { const u = j / SEG, a = curl * u * 1.3; p.copy(rad).multiplyScalar(L * u * Math.cos(a) * (1 - 0.25 * u)).addScaledVector(tanv, L * u * Math.sin(a) * 0.8).addScaledVector(n, L * (lift * u - sag * u * u) - 0.004);
        if (j === 0) dir.copy(rad).multiplyScalar(0.5).addScaledVector(n, lift).normalize(); else dir.copy(p).sub(prev).normalize(); prev.copy(p);
        s1.crossVectors(dir, Math.abs(dir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize(); s2.crossVectors(dir, s1); const r = r0 * (1 - 0.82 * u * u);
        for (let c = 0; c < SIDES; c++) { const an = c / SIDES * Math.PI * 2, q = base + j * SIDES + c; o.copy(s1).multiplyScalar(Math.cos(an)).addScaledVector(s2, Math.sin(an)); anchor[q] = vi;
          off[4 * q] = p.x + o.x * r; off[4 * q + 1] = p.y + o.y * r; off[4 * q + 2] = p.z + o.z * r; off[4 * q + 3] = u; hn[4 * q] = o.x; hn[4 * q + 1] = o.y; hn[4 * q + 2] = o.z; hn[4 * q + 3] = shade; }
        if (j < SEG) for (let c = 0; c < SIDES; c++) { const a0 = base + j * SIDES + c, a1 = base + j * SIDES + (c + 1) % SIDES, b0 = a0 + SIDES, b1 = a1 + SIDES; idx.push(a0, b0, a1, a1, b0, b1); } }
      ns++; } }
  const nH = ns * perStrand, hg = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'skinIndex', 'skinWeight', 'aMusIndex', 'aMusWeight', 'aNodeIndex', 'aMisc', 'aMisc2', 'aBindIndex', 'aBindWeight', 'aNip']) {
    const src = g.attributes[name], sz = src.itemSize, dst = new src.array.constructor(nH * sz); for (let q = 0; q < nH; q++) { const a = anchor[q] * sz; for (let c = 0; c < sz; c++) dst[q * sz + c] = src.array[a + c]; }
    hg.setAttribute(name, new THREE.BufferAttribute(dst, sz, src.normalized)); }
  hg.setAttribute('aHair', new THREE.BufferAttribute(off.subarray(0, nH * 4), 4)); hg.setAttribute('aHairN', new THREE.BufferAttribute(hn.subarray(0, nH * 4), 4));   // xyz + position along the strand / xyz + shade
  hg.setIndex(idx); hg.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 2.5, 0), 9);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.42, metalness: 0 }); mat.defines = { REX_HAIR: '' };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, rex.uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <skinbase_vertex>', '')
      .replace('#include <common>', '#include <common>\n' + VERT_PARS + '\nattribute vec4 aHair; attribute vec4 aHairN; varying vec2 vHairU;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n#include <skinbase_vertex>\n' + VERT_MAIN + '\nobjectNormal = aHairN.xyz; vHairU = vec2(aHair.w, aHairN.w);')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += rexDisp + aHair.xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vHairU;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n{ vec3 dark = mix(vec3(0.022, 0.015, 0.011), vec3(0.075, 0.045, 0.028), vHairU.y); if (vHairU.y > 0.93) dark = vec3(0.42, 0.40, 0.37); diffuseColor.rgb = dark * (0.7 + 0.5 * vHairU.x); }');
  };
  const hair = new THREE.SkinnedMesh(hg, mat); hair.bind(rex.skeleton, new THREE.Matrix4()); hair.frustumCulled = false; hair.castShadow = false; hair.receiveShadow = true; hair.visible = false; rex.group.add(hair);
  return { hair, sites: sites.length, strands: ns };
}
