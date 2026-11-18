// Environment: sky, sun, ground, Hell Creek-style floodplain vegetation, footprints and dust.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

const NOISE = /* glsl */`
float wh(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float wn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(wh(i), wh(i + vec2(1, 0)), f.x), mix(wh(i + vec2(0, 1)), wh(i + vec2(1, 1)), f.x), f.y); }
float wf(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * wn(p); p = p * 2.03 + 17.3; a *= 0.5; } return s; }
vec2 wv(vec2 p) { vec2 i = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0; for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) { vec2 g = vec2(x, y), o = vec2(wh(i + g), wh(i + g + 7.7)); float d = length(g + o - f); if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; } return vec2(d1, d2); }`;

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export class World {
  constructor(scene, renderer, opts) {
    this.scene = scene; this.renderer = renderer; this.R = opts.pathR; this.low = opts.low;
    this.sunDir = new THREE.Vector3(); this.uTime = { value: 0 };
    // ---- sky + sun ----
    this.sky = new Sky(); this.sky.scale.setScalar(4000); scene.add(this.sky);
    const su = this.sky.material.uniforms; su.turbidity.value = 2.4; su.rayleigh.value = 1.0; su.mieCoefficient.value = 0.006; su.mieDirectionalG.value = 0.84;
    this.sun = new THREE.DirectionalLight(0xffffff, 1); this.sun.castShadow = true;
    const sm = this.low ? 2048 : 4096; this.sun.shadow.mapSize.set(sm, sm);
    const sc = this.sun.shadow.camera; sc.left = -11; sc.right = 11; sc.top = 11; sc.bottom = -11; sc.near = 1; sc.far = 90;
    this.sun.shadow.bias = -0.0005; this.sun.shadow.normalBias = 0.025; this.sun.shadow.radius = 2.5;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbcd0ff, 0x5a4a36, 0.5); scene.add(this.hemi);
    scene.fog = new THREE.FogExp2(0xb8c4cc, 0.0062);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.#ground(); this.#plants(); this.#prints(); this.#dust();
    this.setSun(opts.sunElev ?? 24, opts.sunAz ?? 205);
  }

  setSun(elevDeg, azDeg) {
    this.elev = elevDeg; this.az = azDeg;
    const phi = THREE.MathUtils.degToRad(90 - elevDeg), th = THREE.MathUtils.degToRad(azDeg);
    this.sunDir.setFromSphericalCoords(1, phi, th);
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDir);
    const k = Math.min(1, Math.max(0, elevDeg / 35)), warm = new THREE.Color().setHSL(0.075 + 0.045 * k, 0.75 - 0.45 * k, 0.5 + 0.12 * k);
    this.sun.color.copy(warm); this.sun.intensity = 2.2 + 3.4 * Math.sqrt(k);
    this.hemi.intensity = 0.4 + 0.45 * k;
    const fog = new THREE.Color().setHSL(0.58 - 0.5 * (1 - k) * (1 - k), 0.16 + 0.3 * (1 - k), 0.52 + 0.2 * k); this.scene.fog.color.copy(fog);
    // image-based lighting from the sky itself
    const s2 = new THREE.Scene(); const sk = new Sky(); sk.scale.setScalar(1000); sk.material.uniforms = this.sky.material.uniforms; s2.add(sk);
    const gnd = new THREE.Mesh(new THREE.CircleGeometry(900, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.16, 0.13, 0.09).multiplyScalar(0.5 + k) })); gnd.rotation.x = -Math.PI / 2; gnd.position.y = -2; s2.add(gnd);
    if (this.env) this.env.dispose(); this.env = this.pmrem.fromScene(s2, 0, 1, 2000); this.scene.environment = this.env.texture; this.scene.environmentIntensity = 1.0;
  }

  follow(p) { // keep the shadow frustum centred on the animal
    this.sun.target.position.set(p.x, 1.5, p.z); this.sun.position.copy(this.sun.target.position).addScaledVector(this.sunDir, 45);
  }

  #ground() {
    const g = new THREE.PlaneGeometry(900, 900, 1, 1); g.rotateX(-Math.PI / 2);
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
    const R = this.R;
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vW;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvW = (modelMatrix * vec4(position, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vW;\n${NOISE}\nfloat gH; float gR;
        vec3 gPerturb(vec3 n, vec3 sp, float h) { vec2 dH = vec2(dFdx(h), dFdy(h)); vec3 sx = dFdx(sp), sy = dFdy(sp), R1 = cross(sy, n), R2 = cross(n, sx); float det = dot(sx, R1); return normalize(abs(det) * n - sign(det) * (dH.x * R1 + dH.y * R2)); }
        vec3 gCol() { vec2 p = vW.xz; float fw = length(fwidth(p)); float r = length(p);
          float trail = 1.0 - smoothstep(0.3, 4.2, abs(r - ${R.toFixed(1)}) + (wf(p * 0.35) - 0.5) * 2.5);        // worn path
          float big = wf(p * 0.045), mid = wf(p * 0.4 + 3.0), fine = wf(p * 4.0);
          float moss = smoothstep(0.56, 0.72, big + 0.22 * mid) * (1.0 - trail) * smoothstep(0.3, 0.6, wf(p * 1.7 + 30.0) + 0.25);
          float wet = smoothstep(0.55, 0.75, wf(p * 0.11 + 9.0));
          vec2 pv = wv(p * 7.0 + wn(p * 3.0) * 2.0); float peb = (1.0 - smoothstep(0.0, 0.2 + 0.2 * wh(floor(p * 7.0)), pv.x)) * smoothstep(0.62, 0.85, wn(p * 0.6 + 4.0) * 0.6 + wn(p * 2.7) * 0.4) * (1.0 - smoothstep(0.02, 0.09, fw));
          vec2 cr = wv(p * 1.6 + vec2(wf(p * 0.9), wf(p * 0.9 + 4.0)) * 2.2); float crack = (1.0 - smoothstep(0.0, 0.035, cr.y - cr.x)) * (1.0 - moss) * (1.0 - smoothstep(0.03, 0.12, fw)) * smoothstep(0.35, 0.7, wf(p * 0.23 + 2.0)) * (0.3 + 0.5 * trail);
          vec3 soil = mix(vec3(0.17, 0.125, 0.085), vec3(0.31, 0.25, 0.17), mid); soil = mix(soil, vec3(0.20, 0.13, 0.07), smoothstep(0.45, 0.7, wf(p * 0.8 + 50.0)) * 0.6); soil = mix(soil, vec3(0.36, 0.31, 0.235), trail * 0.45);
          soil = mix(soil, vec3(0.13, 0.085, 0.05), smoothstep(0.5, 0.8, wf(p * 6.0 + 70.0)) * 0.45 * (1.0 - trail));  // leaf litter
          soil *= 0.75 + 0.5 * fine; soil = mix(soil, soil * 0.55, wet * 0.6);
          vec3 green = mix(vec3(0.055, 0.08, 0.03), vec3(0.12, 0.145, 0.05), fine);
          vec3 c = mix(soil, green, moss * 0.8); c = mix(c, vec3(0.33, 0.31, 0.28) * (0.6 + 0.8 * wh(floor(p * 9.0))), peb * 0.8); c *= 1.0 - 0.45 * crack;
          gH = 0.03 * fine * (1.0 - smoothstep(0.02, 0.15, fw)) + 0.05 * mid + 0.025 * peb - 0.02 * crack + 0.02 * moss * wn(p * 30.0) * (1.0 - smoothstep(0.01, 0.05, fw));
          gR = mix(0.95, 0.55, wet * (1.0 - moss) * 0.7); return c; }`)
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = gCol();')
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = gR;')
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = gPerturb(normal, -vViewPosition, gH);');
    };
    const mesh = new THREE.Mesh(g, m); mesh.receiveShadow = true; this.scene.add(mesh); this.ground = mesh;
  }

  // ---- vegetation: ferns in the clearing, conifers (Metasequoia-like) around it ----
  #frondTexture(hue = 92, lum0 = 22, lumK = 26, sat = 48) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 512; const x = c.getContext('2d');
    x.clearRect(0, 0, 256, 512); x.lineCap = 'round';
    for (let i = 0; i < 64; i++) {
      const t = i / 63, y = 500 - t * 480, L = 118 * Math.sin(Math.PI * Math.pow(t, 0.75)) * (1 - 0.25 * t) + 6;
      for (const s of [-1, 1]) {
        const g = x.createLinearGradient(128, y, 128 + s * L, y - 14); const lum = lum0 + lumK * t + Math.random() * lumK * 0.3;
        g.addColorStop(0, `hsl(${hue + 10 * Math.random()},${sat}%,${lum}%)`); g.addColorStop(1, `hsl(${hue - 14 + 12 * Math.random()},${sat + 4}%,${lum + lumK * 0.45}%)`);
        x.strokeStyle = g; x.lineWidth = 9.5 - 4 * t; x.beginPath(); x.moveTo(128, y); x.quadraticCurveTo(128 + s * L * 0.5, y - 10 - 8 * t, 128 + s * L, y - 2 + 8 * t); x.stroke();
      }
    }
    x.strokeStyle = '#3a4220'; x.lineWidth = 5; x.beginPath(); x.moveTo(128, 512); x.lineTo(128, 16); x.stroke();
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; return tex;
  }
  #frond(len, wid, droop, yaw, tilt, out, base) {
    // a bent strip of quads: root at origin, arcing outward and down
    const seg = 5, P = out.pos, U = out.uv, N = out.nor, I = out.idx, o = P.length / 3, cy = Math.cos(yaw), sy = Math.sin(yaw);
    for (let i = 0; i <= seg; i++) {
      const t = i / seg, ang = tilt - droop * t * t, r = len * t, px = Math.cos(ang) * r * (1 - 0.15 * t), py = Math.sin(tilt) * r - droop * 0.5 * len * t * t;
      const nx = -Math.sin(ang), ny = Math.cos(ang);
      for (const s of [-1, 1]) { const lx = px, lz = s * wid * 0.5; P.push(base[0] + lx * cy - lz * sy, base[1] + py, base[2] + lx * sy + lz * cy); U.push(s * 0.5 + 0.5, t); N.push(nx * cy * 0.5, Math.abs(ny) * 0.8 + 0.4, nx * sy * 0.5); }
      if (i < seg) { const a = o + 2 * i; I.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
  }
  #plantMat(tex, sway) {
    const m = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.45, side: THREE.DoubleSide });
    const uT = this.uTime; m.customProgramCacheKey = () => 'plant' + sway;
    m.onBeforeCompile = (sh) => { sh.uniforms.uTime = uT; sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace('#include <begin_vertex>', `#include <begin_vertex>
      { vec4 wp = instanceMatrix * vec4(position, 1.0); float k = ${sway.toFixed(3)} * position.y; transformed.x += sin(uTime * 1.3 + wp.x * 0.7 + wp.z * 0.4) * k; transformed.z += cos(uTime * 1.1 + wp.z * 0.6) * k * 0.7; }`); };
    return m;
  }
  #plants() {
    const rnd = rng(7), tex = this.#frondTexture(96, 20, 24, 45), texT = this.#frondTexture(118, 5, 9, 30), R = this.R, low = this.low;
    const mk = (out) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(out.nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(out.uv, 2)); g.setIndex(out.idx); return g; };
    // fern
    const f = { pos: [], uv: [], nor: [], idx: [] };
    for (let i = 0; i < 11; i++) this.#frond(0.9 + rnd() * 0.5, 0.42, 1.0 + rnd() * 0.5, i / 11 * Math.PI * 2 + rnd() * 0.4, 0.9 + rnd() * 0.4, f, [0, 0, 0]);
    const nF = low ? 500 : 1500, ferns = new THREE.InstancedMesh(mk(f), this.#plantMat(tex, 0.035), nF), M = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    for (let i = 0; i < nF; i++) {
      let r, a; do { r = Math.sqrt(rnd()) * 110; a = rnd() * Math.PI * 2; } while (Math.abs(r - R) < 3.2 + rnd() * 2);
      const cl = 0.6 + 0.9 * rnd(); p.set(Math.cos(a) * r + (rnd() - 0.5) * 3, 0, Math.sin(a) * r + (rnd() - 0.5) * 3); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28); s.setScalar(cl);
      ferns.setMatrixAt(i, M.compose(p, q, s)); ferns.setColorAt(i, new THREE.Color().setHSL(0.16 + 0.12 * rnd(), 0.2, 0.8 + 0.2 * rnd()));
    }
    ferns.castShadow = !low; ferns.receiveShadow = true; this.scene.add(ferns);
    // conifer: trunk + drooping whorls of foliage cards
    const t = { pos: [], uv: [], nor: [], idx: [] }, H = 27;
    for (let w = 0; w < 30; w++) {
      const u = w / 29, y = 5.5 + (H - 5.5) * Math.pow(u, 0.9), rad = (1 - u) * 6.0 + 0.9, nb = u > 0.85 ? 3 : 4 + Math.floor(rnd() * 2);
      for (let b = 0; b < nb; b++) { const len = rad * (0.75 + 0.5 * rnd()); this.#frond(len, len * (0.34 + 0.12 * rnd()), 0.45 + 0.7 * (1 - u) * rnd(), (b + rnd() * 0.7) / nb * Math.PI * 2 + w * 1.7, -0.12 + 0.55 * u + (rnd() - 0.5) * 0.25, t, [0, y + (rnd() - 0.5) * 0.5, 0]); }
    }
    const nT = low ? 110 : 260, foliage = new THREE.InstancedMesh(mk(t), this.#plantMat(texT, 0.004), nT);
    const tg = new THREE.CylinderGeometry(0.22, 0.75, H, 9, 1); tg.translate(0, H / 2, 0);
    const bark = new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 0.95 });
    bark.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvP = position;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vP;\n${NOISE}`).replace('#include <color_fragment>', '#include <color_fragment>\n{ float a = atan(vP.z, vP.x); float b = wf(vec2(a * 5.0, vP.y * 0.6)); diffuseColor.rgb *= 0.45 + 1.1 * b * b + 0.3 * wn(vec2(a * 30.0, vP.y * 3.0)); }'); };
    const trunks = new THREE.InstancedMesh(tg, bark, nT);
    for (let i = 0; i < nT; i++) {
      let r, a; do { r = Math.sqrt(rnd()) * 210; a = rnd() * Math.PI * 2; } while (r < R + 34 && r > 7);
      const sc = 0.7 + 0.7 * rnd(); p.set(Math.cos(a) * r, 0, Math.sin(a) * r); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28); s.set(sc, sc * (0.85 + 0.4 * rnd()), sc);
      M.compose(p, q, s); foliage.setMatrixAt(i, M); trunks.setMatrixAt(i, M); 
    }
    foliage.castShadow = trunks.castShadow = !low; trunks.receiveShadow = true; this.scene.add(foliage, trunks);
    // rocks
    const rg = new THREE.IcosahedronGeometry(1, 2), rp = rg.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < rp.count; i++) { v.fromBufferAttribute(rp, i); const n = 1 + 0.25 * Math.sin(v.x * 3.1 + v.y * 2.3) + 0.2 * Math.sin(v.z * 4.7 + v.x * 1.7); v.multiplyScalar(n); v.y *= 0.6; rp.setXYZ(i, v.x, v.y, v.z); } rg.computeVertexNormals();
    const rocks = new THREE.InstancedMesh(rg, new THREE.MeshStandardMaterial({ color: 0x77726a, roughness: 0.9 }), 90);
    for (let i = 0; i < 90; i++) { let r, a; do { r = Math.sqrt(rnd()) * 100; a = rnd() * 6.28; } while (Math.abs(r - R) < 3); const sc = 0.15 + rnd() * rnd() * 1.1; p.set(Math.cos(a) * r, sc * 0.1, Math.sin(a) * r); q.setFromEuler(new THREE.Euler(rnd(), rnd() * 6, rnd())); s.set(sc, sc, sc); rocks.setMatrixAt(i, M.compose(p, q, s)); }
    rocks.castShadow = rocks.receiveShadow = true; this.scene.add(rocks);
  }

  // ---- footprints: three-toed impressions as normal-mapped decals ----
  #prints() {
    const S = 128, hgt = new Float32Array(S * S), c = document.createElement('canvas'); c.width = c.height = S; const x = c.getContext('2d');
    x.fillStyle = '#000'; x.fillRect(0, 0, S, S); x.filter = 'blur(3px)'; x.fillStyle = '#fff'; x.strokeStyle = '#fff'; x.lineCap = 'round';
    const toe = (ang, len, wd) => { x.lineWidth = wd; x.beginPath(); x.moveTo(64, 82); x.lineTo(64 + Math.sin(ang) * len, 82 - Math.cos(ang) * len); x.stroke(); };
    toe(0, 56, 17); toe(-0.5, 44, 15); toe(0.52, 46, 15); x.beginPath(); x.ellipse(64, 88, 17, 15, 0, 0, 6.3); x.fill();
    const d = x.getImageData(0, 0, S, S).data; for (let i = 0; i < S * S; i++) hgt[i] = d[4 * i] / 255;
    const px = new Uint8Array(S * S * 4);
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) { const o = j * S + i, h = hgt[o], dx = hgt[j * S + Math.min(S - 1, i + 1)] - hgt[j * S + Math.max(0, i - 1)], dy = hgt[Math.min(S - 1, j + 1) * S + i] - hgt[Math.max(0, j - 1) * S + i]; px[4 * o] = 128 + 127 * Math.max(-1, Math.min(1, dx * 3)); px[4 * o + 1] = 128 + 127 * Math.max(-1, Math.min(1, dy * 3)); px[4 * o + 2] = 255 * h; px[4 * o + 3] = 255; }
    const tex = new THREE.DataTexture(px, S, S, THREE.RGBAFormat); tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
    const N = this.nPrints = 44, g = new THREE.PlaneGeometry(1.45, 1.45); g.rotateX(-Math.PI / 2); g.rotateY(-Math.PI / 2); // canvas "up" -> +X (toe direction)
    g.setAttribute('aAge', new THREE.InstancedBufferAttribute(new Float32Array(N).fill(1e3), 1));
    const m = new THREE.MeshStandardMaterial({ transparent: true, depthWrite: false, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    m.onBeforeCompile = (sh) => { sh.uniforms.uPrint = { value: tex };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aAge; varying float vAge; varying vec2 vPU; varying vec3 vTx; varying vec3 vTz;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvAge = aAge; vPU = uv; vTx = normalize((viewMatrix * modelMatrix * instanceMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz); vTz = normalize((viewMatrix * modelMatrix * instanceMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uPrint; varying float vAge; varying vec2 vPU; varying vec3 vTx; varying vec3 vTz; vec4 pr;')
        .replace('#include <color_fragment>', '#include <color_fragment>\npr = texture2D(uPrint, vPU); { float life = 1.0 - smoothstep(60.0, 110.0, vAge); diffuseColor.rgb = mix(vec3(0.20, 0.16, 0.11), vec3(0.09, 0.07, 0.05), pr.b); diffuseColor.a = smoothstep(0.02, 0.5, pr.b + length(pr.rg - 0.5) * 1.5) * 0.92 * life; }')
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n{ vec2 gd = (pr.rg - 0.5) * 2.0; normal = normalize(normal + (vTx * gd.x - vTz * gd.y) * 1.3); }'); };
    this.prints = new THREE.InstancedMesh(g, m, N); this.prints.receiveShadow = true; this.prints.frustumCulled = false; this.prints.renderOrder = 1; this.printI = 0; this.scene.add(this.prints);
    const M = new THREE.Matrix4().makeScale(0, 0, 0); for (let i = 0; i < N; i++) this.prints.setMatrixAt(i, M);
  }
  addPrint(pos, yaw, mirror) {
    const i = this.printI++ % this.nPrints, M = new THREE.Matrix4();
    M.compose(new THREE.Vector3(pos.x, 0.012 + 0.0004 * (i % 7), pos.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, mirror));
    this.prints.setMatrixAt(i, M); this.prints.instanceMatrix.needsUpdate = true; this.prints.geometry.attributes.aAge.setX(i, 0);
  }

  // ---- dust kicked up at footfall ----
  #dust() {
    const N = this.nDust = 420, g = new THREE.BufferGeometry();
    this.dp = new Float32Array(N * 3); this.dv = new Float32Array(N * 3); this.dl = new Float32Array(N * 2).fill(0); // life, size
    g.setAttribute('position', new THREE.BufferAttribute(this.dp, 3)); g.setAttribute('aL', new THREE.BufferAttribute(this.dl, 2));
    const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uCol: { value: new THREE.Color(0.55, 0.47, 0.36) }, uScale: { value: 600 } },
      vertexShader: 'attribute vec2 aL; varying float vA; uniform float uScale; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; float t = aL.x; vA = t > 0.0 ? sin(min(1.0, (1.0 - t) * 6.0) * 1.5708) * t * 0.5 : 0.0; gl_PointSize = aL.y * (1.6 - t * 0.9) * uScale / max(0.1, -mv.z); }',
      fragmentShader: 'varying float vA; uniform vec3 uCol; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = (1.0 - smoothstep(0.2, 1.0, d)) * vA; if (a < 0.004) discard; gl_FragColor = vec4(uCol, a); }' });
    this.dust = new THREE.Points(g, m); this.dust.frustumCulled = false; this.dust.renderOrder = 3; this.scene.add(this.dust); this.dustI = 0; this.dustMat = m;
  }
  puff(pos, dir, strength) {
    const n = Math.round(10 + 34 * strength * strength);
    for (let k = 0; k < n; k++) {
      const i = this.dustI++ % this.nDust, a = Math.random() * 6.283, r = 0.15 + Math.random() * 0.45, sp = (0.4 + Math.random() * 1.3) * (0.5 + strength);
      this.dp[3 * i] = pos.x + Math.cos(a) * r; this.dp[3 * i + 1] = 0.05 + Math.random() * 0.15; this.dp[3 * i + 2] = pos.z + Math.sin(a) * r;
      this.dv[3 * i] = Math.cos(a) * sp + dir.x * 0.5; this.dv[3 * i + 1] = 0.3 + Math.random() * 0.9 * (0.4 + strength); this.dv[3 * i + 2] = Math.sin(a) * sp + dir.z * 0.5;
      this.dl[2 * i] = 0.45 + 0.55 * Math.min(1, strength); this.dl[2 * i + 1] = 0.35 + Math.random() * 0.7;
    }
  }

  update(dt, camH) {
    this.uTime.value += dt;
    const A = this.prints.geometry.attributes.aAge; for (let i = 0; i < this.nPrints; i++) A.array[i] += dt; A.needsUpdate = true;
    const { dp, dv, dl } = this;
    for (let i = 0; i < this.nDust; i++) { if (dl[2 * i] <= 0) continue; dl[2 * i] -= dt / 2.6; const k = Math.exp(-dt * 1.8); dv[3 * i] *= k; dv[3 * i + 2] *= k; dv[3 * i + 1] = dv[3 * i + 1] * k + 0.08 * dt; dp[3 * i] += dv[3 * i] * dt + 0.25 * dt; dp[3 * i + 1] += dv[3 * i + 1] * dt; dp[3 * i + 2] += dv[3 * i + 2] * dt; }
    this.dust.geometry.attributes.position.needsUpdate = true; this.dust.geometry.attributes.aL.needsUpdate = true;
    this.dustMat.uniforms.uScale.value = camH;
  }
}
