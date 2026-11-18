// Export one simulated instant for offline rendering: node tools/export.mjs <outDir> [simSeconds] [gazeYaw] [speed]
// Writes the animal exactly as the app would draw it (skeletal skinning + muscle bulge + soft-tissue lattice + simulated skin
// sheet, evaluated on the CPU here instead of in the vertex shader), plus teeth, eyes, terrain and plants, to raw binary files
// and scene.json. tools/render_cycles.py turns that into a path-traced image.
import { createRequire } from 'module'; import fs from 'fs'; import path from 'path';
const require = createRequire('/opt/npm-tools/node_modules/'); const { chromium } = require('playwright');
const [outDir, simT = 9, gaze = -0.3, speed = 1.3] = process.argv.slice(2);
const SKEL = process.env.SKEL || '';   // SKEL=<asset name> also exports the skeleton (e.g. SKEL=skeleton-hi)
fs.mkdirSync(outDir, { recursive: true });
const root = path.resolve(new URL('..', import.meta.url).pathname);
const types = { html: 'text/html', js: 'text/javascript', mjs: 'text/javascript', json: 'application/json', bin: 'application/octet-stream', png: 'image/png', css: 'text/css' };
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 640, height: 360 } });
p.on('console', m => { const t = m.text(); if (!/GPU stall|GL Driver Message/.test(t)) console.log('[console]', m.type(), t.slice(0, 600)); });
p.on('pageerror', e => console.log('[pageerror]', e.message, (e.stack || '').split('\n').slice(0, 4).join(' | ')));
await p.route('**/*', r => { const u = new URL(r.request().url()); const f = path.join(root, decodeURIComponent(u.pathname)); if (fs.existsSync(f) && fs.statSync(f).isFile()) r.fulfill({ body: fs.readFileSync(f), contentType: types[f.split('.').pop()] || 'application/octet-stream' }); else r.fulfill({ status: 404, body: 'nf' }); });
await p.goto(`http://rex.local/index.html?shot=1&q=high&ui=0&t=0&speed=${speed}` + (SKEL ? `&view=3&skel=${SKEL}` : ''));
await p.waitForFunction('window.__ready===true', null, { timeout: 240000 });

const scene = await p.evaluate(([simT, gaze]) => {
  const { rex, world, loco, body } = window.__api;
  body.gazeT = 1e9; body.gazeYaw = gaze; body.gazePitch = 0.03;
  window.__sim(simT); window.__api.frame();
  const files = {}, b64 = (ta) => { const u = new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const put = (name, ta) => { files[name] = { type: ta.constructor.name, data: b64(ta) }; return name; };
  const sst = (a, c, x) => { const t = Math.min(1, Math.max(0, (x - a) / (c - a))); return t * t * (3 - 2 * t); };
  rex.group.updateMatrixWorld(true);

  // ---- body: the same deformation chain as src/skinShader.js ----
  const g = rex.mesh.geometry, A = g.attributes, nV = A.position.count, P = A.position.array, N8 = A.normal.array, SI = A.skinIndex.array, SW = A.skinWeight.array;
  const MI = A.aMusIndex.array, MW = A.aMusWeight.array, NI = A.aNodeIndex.array, MS = A.aMisc.array, M2 = A.aMisc2.array, BI = A.aBindIndex.array, BW = A.aBindWeight.array, UV = A.aUv.array;
  const bm = new Float32Array(rex.bones.length * 12);
  rex.bones.forEach((bn, k) => { const e = bn.obj.matrixWorld.elements, r = bn.rest, o = 12 * k;
    bm[o] = e[0]; bm[o + 1] = e[4]; bm[o + 2] = e[8]; bm[o + 3] = e[1]; bm[o + 4] = e[5]; bm[o + 5] = e[9]; bm[o + 6] = e[2]; bm[o + 7] = e[6]; bm[o + 8] = e[10];
    bm[o + 9] = e[12] - (e[0] * r.x + e[4] * r.y + e[8] * r.z); bm[o + 10] = e[13] - (e[1] * r.x + e[5] * r.y + e[9] * r.z); bm[o + 11] = e[14] - (e[2] * r.x + e[6] * r.y + e[10] * r.z); });
  const U = rex.uMus, ND = rex.nodeData, SD = rex.skin.data, breath = rex.uniforms.uBreath.value;
  const pos = new Float32Array(nV * 3), strain = new Float32Array(nV), uv = new Float32Array(nV * 2), misc = new Uint8Array(nV * 4);
  let maxD = 0;
  for (let i = 0; i < nV; i++) {
    let px = P[3 * i], py = P[3 * i + 1], pz = P[3 * i + 2]; const rx = px, ry = py, rz = pz;
    let nx = N8[4 * i] / 127, ny = N8[4 * i + 1] / 127, nz = N8[4 * i + 2] / 127; const nl = 1 / (Math.hypot(nx, ny, nz) || 1); nx *= nl; ny *= nl; nz *= nl;
    const soft = MS[4 * i + 3] / 255;
    let bulge = 0; for (let c = 0; c < 4; c++) bulge += MW[4 * i + c] / 255 * U[MI[4 * i + c]];
    const d0 = 0.3 * bulge + breath * soft * sst(0.2, 1.0, rx) * (1 - sst(2.2, 3.0, rx)); px += nx * d0; py += ny * d0; pz += nz * d0;
    let x = 0, y = 0, z = 0;
    for (let c = 0; c < 4; c++) { const w = SW[4 * i + c] / 65535; if (w <= 0) continue; const o = 12 * SI[4 * i + c];
      x += w * (bm[o] * px + bm[o + 1] * py + bm[o + 2] * pz + bm[o + 9]); y += w * (bm[o + 3] * px + bm[o + 4] * py + bm[o + 5] * pz + bm[o + 10]); z += w * (bm[o + 6] * px + bm[o + 7] * py + bm[o + 8] * pz + bm[o + 11]); }
    if (soft > 0.01) { let ax = 0, ay = 0, az = 0, G = 0; const g5 = M2[4 * i] / 255;
      for (let c = 0; c < 4; c++) { const j = NI[4 * i + c]; if (j === 255) continue; const q = 4 * (256 + j), d = Math.hypot(rx - ND[q], ry - ND[q + 1], rz - ND[q + 2]); let gg = Math.max(0, 1 - d / ND[q + 3]); gg = Math.max(0, gg * gg * ND[4 * j + 3] - g5); ax += gg * ND[4 * j]; ay += gg * ND[4 * j + 1]; az += gg * ND[4 * j + 2]; G += gg; }
      if (G > 1e-5) { const k = soft * Math.min(1, G / 0.2) / G; x += ax * k; y += ay * k; z += az * k; } }
    if (BW[4 * i + 3] > 127) { const a = 4 * BI[4 * i], bb = 4 * BI[4 * i + 1], c = 4 * BI[4 * i + 2], wa = BW[4 * i] / 255, wb = BW[4 * i + 1] / 255, wc = BW[4 * i + 2] / 255, ws = 1 / (wa + wb + wc || 1);
      const dx = (SD[a] * wa + SD[bb] * wb + SD[c] * wc) * ws, dy = (SD[a + 1] * wa + SD[bb + 1] * wb + SD[c + 1] * wc) * ws, dz = (SD[a + 2] * wa + SD[bb + 2] * wb + SD[c + 2] * wc) * ws;
      x += dx; y += dy; z += dz; strain[i] = (SD[a + 3] * wa + SD[bb + 3] * wb + SD[c + 3] * wc) * ws; const dl = Math.hypot(dx, dy, dz); if (dl > maxD) maxD = dl; }
    pos[3 * i] = x; pos[3 * i + 1] = y; pos[3 * i + 2] = z; uv[2 * i] = UV[2 * i] / 65535; uv[2 * i + 1] = UV[2 * i + 1] / 65535;
    misc[4 * i] = MS[4 * i]; misc[4 * i + 1] = MS[4 * i + 1]; misc[4 * i + 2] = MS[4 * i + 2]; misc[4 * i + 3] = M2[4 * i + 1];
  }
  const out = { units: 'metres, three.js axes (x, y up, z)', maxSkinTravel: maxD, body: { n: nV, pos: put('body_pos', pos), rest: put('body_rest', new Float32Array(P)), uv: put('body_uv', uv), strain: put('body_strain', strain), misc: put('body_misc', misc), index: put('body_index', new Uint32Array(g.index.array)) } };

  // ---- skeleton (when loaded): each vertex rigidly follows its bones ----
  if (rex.bonesMesh) { const sg = rex.bonesMesh.geometry, sp = sg.attributes.position.array, si = sg.attributes.skinIndex.array, sw = sg.attributes.skinWeight.array, n = sp.length / 3, wp = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const px = sp[3 * i], py = sp[3 * i + 1], pz = sp[3 * i + 2]; let x = 0, y = 0, z = 0;
      for (let c = 0; c < 4; c++) { const w = sw[4 * i + c] / 255; if (w <= 0) continue; const o = 12 * si[4 * i + c]; x += w * (bm[o] * px + bm[o + 1] * py + bm[o + 2] * pz + bm[o + 9]); y += w * (bm[o + 3] * px + bm[o + 4] * py + bm[o + 5] * pz + bm[o + 10]); z += w * (bm[o + 6] * px + bm[o + 7] * py + bm[o + 8] * pz + bm[o + 11]); }
      wp[3 * i] = x; wp[3 * i + 1] = y; wp[3 * i + 2] = z; }
    out.skeleton = { n, pos: put('skel_pos', wp), rest: put('skel_rest', new Float32Array(sp)), open: put('skel_open', new Uint8Array(sg.attributes.aOpen.array)), index: put('skel_index', new Uint32Array(sg.index.array)) }; }

  // ---- rigid parts: teeth, gullet; eyes as centre + axes ----
  const v = new rex.mesh.position.constructor(); out.rigid = [];
  rex.group.traverse(o => { if (!o.isMesh || o === rex.mesh || o === rex.bonesMesh || !o.geometry.index || rex.eyes.includes(o) || rex.eyes.some(e => e.userData.lid === o)) return; const ga = o.geometry, pa = ga.attributes.position, n = pa.count, wp = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { v.fromBufferAttribute(pa, i).applyMatrix4(o.matrixWorld); wp[3 * i] = v.x; wp[3 * i + 1] = v.y; wp[3 * i + 2] = v.z; }
    const k = out.rigid.length, kind = ga.attributes.color ? 'teeth' : 'gullet', e = { kind, n, pos: put(`rigid${k}_pos`, wp), index: put(`rigid${k}_index`, new Uint32Array(ga.index.array)) };
    if (ga.attributes.color) e.color = put(`rigid${k}_color`, new Float32Array(ga.attributes.color.array)); out.rigid.push(e); });
  out.eyes = rex.eyes.map(m => { const e = m.matrixWorld.elements; return { r: rex.meta.landmarks.eyeR, c: [e[12], e[13], e[14]], x: [e[0], e[1], e[2]], y: [e[4], e[5], e[6]], z: [e[8], e[9], e[10]] }; });

  // ---- world ----
  out.ground = { n: world.ground.geometry.attributes.position.count, pos: put('ground_pos', new Float32Array(world.ground.geometry.attributes.position.array)), index: put('ground_index', new Uint32Array(world.ground.geometry.index.array)) };
  const inst = []; world.scene.traverse(o => { if (o.isInstancedMesh) inst.push(o); }); const names = ['fern', 'foliage', 'trunk', 'rock'];
  out.instanced = inst.slice(0, 4).map((o, k) => { const ga = o.geometry, e = { name: names[k], count: o.count, n: ga.attributes.position.count, pos: put(names[k] + '_pos', new Float32Array(ga.attributes.position.array)), index: put(names[k] + '_index', new Uint32Array(ga.index.array)), matrix: put(names[k] + '_matrix', new Float32Array(o.instanceMatrix.array)) };
    if (ga.attributes.uv) e.uv = put(names[k] + '_uv', new Float32Array(ga.attributes.uv.array)); if (o.instanceColor) e.color = put(names[k] + '_color', new Float32Array(o.instanceColor.array));
    if (o.material.map && o.material.map.image && o.material.map.image.toDataURL) e.map = o.material.map.image.toDataURL('image/png'); return e; });
  const cam = window.__api.camera;
  Object.assign(out, { sunDir: world.sunDir.toArray(), sunElev: world.elev, sunAz: world.az, waterY: -0.05, pathR: world.R, origin: loco.O.toArray(), heading: loco.heading.toArray(), right: loco.right.toArray(), com: loco.com.toArray(), speed: loco.speed ?? null, simTime: simT, texelsPerMeter: rex.meta.texture.texelsPerMeter,
    appCamera: { pos: cam.position.toArray(), fov: cam.fov } });
  return { out, files };
}, [+simT, +gaze]).catch(async e => { console.log('export failed:', e.message); await b.close(); process.exit(1); });

for (const [name, f] of Object.entries(scene.files)) fs.writeFileSync(path.join(outDir, name + '.bin'), Buffer.from(f.data, 'base64'));
for (const e of scene.out.instanced) if (e.map) { fs.writeFileSync(path.join(outDir, e.name + '_map.png'), Buffer.from(e.map.split(',')[1], 'base64')); e.map = e.name + '_map.png'; }
scene.out.types = Object.fromEntries(Object.entries(scene.files).map(([k, f]) => [k, f.type]));
fs.writeFileSync(path.join(outDir, 'scene.json'), JSON.stringify(scene.out, null, 1));
console.log('exported', Object.keys(scene.files).length, 'buffers;', scene.out.body.n, 'body vertices; max skin travel', (scene.out.maxSkinTravel * 1000).toFixed(0), 'mm');
await b.close();
