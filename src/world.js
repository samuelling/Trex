// Environment: sky and cloud, sun, relief ground with standing water, floodplain vegetation, footprints, dust.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { groundHeight, WATER_Y } from './terrain.js';

const NOISE = /* glsl */`
float wh(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float wn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(wh(i), wh(i + vec2(1, 0)), f.x), mix(wh(i + vec2(0, 1)), wh(i + vec2(1, 1)), f.x), f.y); }
float wf(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * wn(p); p = p * 2.03 + 17.3; a *= 0.5; } return s; }
vec2 wv(vec2 p) { vec2 i = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0; for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) { vec2 g = vec2(x, y), o = vec2(wh(i + g), wh(i + g + 7.7)); float d = length(g + o - f); if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; } return vec2(d1, d2); }`;
const PERTURB = 'vec3 gPerturb(vec3 n, vec3 sp, float h) { vec2 dH = vec2(dFdx(h), dFdy(h)); vec3 sx = dFdx(sp), sy = dFdy(sp), R1 = cross(sy, n), R2 = cross(n, sx); float det = dot(sx, R1); return normalize(abs(det) * n - sign(det) * (dH.x * R1 + dH.y * R2)); }';

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export class World {
  constructor(scene, renderer, opts) {
    this.scene = scene; this.renderer = renderer; this.R = opts.pathR; this.low = opts.low;
    this.sunDir = new THREE.Vector3(); this.uTime = { value: 0 }; this.uSun = { value: new THREE.Vector3() }; this.uSunCol = { value: new THREE.Color() };
    this.sky = new Sky(); this.sky.scale.setScalar(4000); scene.add(this.sky);
    const su = this.sky.material.uniforms; su.turbidity.value = 2.6; su.rayleigh.value = 1.05; su.mieCoefficient.value = 0.006; su.mieDirectionalG.value = 0.84;
    this.clouds = this.#cloudDome(1900); scene.add(this.clouds);
    this.sun = new THREE.DirectionalLight(0xffffff, 1); this.sun.castShadow = true;
    const sm = this.low ? 2048 : 4096; this.sun.shadow.mapSize.set(sm, sm);
    const sc = this.sun.shadow.camera; sc.left = -10; sc.right = 10; sc.top = 10; sc.bottom = -10; sc.near = 1; sc.far = 90;
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.02; this.sun.shadow.radius = 2.2;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbcd0ff, 0x5a4a36, 0.5); scene.add(this.hemi);
    scene.fog = new THREE.FogExp2(0xb8c4cc, 0.0042);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.#ground(); this.#water(); this.#plants(); this.#prints(); this.#dust();
    this.setSun(opts.sunElev ?? 19, opts.sunAz ?? 20);
  }

  #cloudDome(radius) {
    const m = new THREE.ShaderMaterial({ side: THREE.BackSide, transparent: true, depthWrite: false, fog: false, uniforms: { uSun: this.uSun, uSunCol: this.uSunCol, uTime: this.uTime },
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); vec4 p = projectionMatrix * mat4(mat3(modelViewMatrix)) * vec4(position, 1.0); gl_Position = p.xyww; }',
      fragmentShader: `varying vec3 vD; uniform vec3 uSun; uniform vec3 uSunCol; uniform float uTime; ${NOISE}
        void main(){ vec3 d = normalize(vD); if (d.y < 0.015) discard; vec2 p = d.xz / (d.y + 0.12) * 1.3 + vec2(uTime * 0.004, 0.0);
          float n = wf(p * 0.9 + wf(p * 2.1) * 0.6), wisp = wf(p * 3.3 + 7.0);
          float c = smoothstep(0.50, 0.78, n) * 0.85 + smoothstep(0.55, 0.9, wisp) * 0.25 * smoothstep(0.35, 0.6, n);
          float lit = 0.5 + 0.5 * dot(d, uSun), thick = smoothstep(0.55, 0.9, n);
          vec3 col = mix(vec3(1.0, 0.97, 0.93), vec3(0.50, 0.53, 0.60), thick * 0.75) * (0.75 + 0.5 * lit) + uSunCol * pow(max(dot(d, uSun), 0.0), 6.0) * 0.5 * (1.0 - thick);
          float a = c * smoothstep(0.015, 0.2, d.y); gl_FragColor = vec4(col * 1.25, a); }` });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), m); mesh.renderOrder = -1; mesh.frustumCulled = false; return mesh;
  }

  setSun(elevDeg, azDeg) {
    this.elev = elevDeg; this.az = azDeg;
    this.sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - elevDeg), THREE.MathUtils.degToRad(azDeg)); this.uSun.value.copy(this.sunDir);
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDir);
    const k = Math.min(1, Math.max(0, elevDeg / 35)), warm = new THREE.Color().setHSL(0.07 + 0.05 * k, 0.8 - 0.5 * k, 0.5 + 0.12 * k);
    this.sun.color.copy(warm); this.uSunCol.value.copy(warm); this.sun.intensity = 5.5 + 8.5 * Math.sqrt(k);
    this.hemi.intensity = 0.1 + 0.15 * k;
    this.scene.fog.color.setHSL(0.58 - 0.5 * (1 - k) * (1 - k), 0.14 + 0.22 * (1 - k), 0.5 + 0.2 * k);
    // image-based lighting from the sky and clouds themselves
    const s2 = new THREE.Scene(), sk = new Sky(); sk.scale.setScalar(1000); sk.material.uniforms = this.sky.material.uniforms; s2.add(sk, this.#envClouds || (this.#envClouds = this.#cloudDome(900)));
    const gnd = new THREE.Mesh(new THREE.CircleGeometry(900, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.16, 0.13, 0.09).multiplyScalar(0.5 + k) })); gnd.rotation.x = -Math.PI / 2; gnd.position.y = -2; s2.add(gnd);
    if (this.env) this.env.dispose(); this.env = this.pmrem.fromScene(s2, 0, 1, 2000); this.scene.environment = this.env.texture; this.scene.environmentIntensity = 0.42 + 0.2 * k;
  }
  #envClouds = null;

  follow(p) { this.sun.target.position.set(p.x, 1.5, p.z); this.sun.position.copy(this.sun.target.position).addScaledVector(this.sunDir, 45); }

  // ---- ground: one polar mesh, finely tessellated around the trail where the relief is ----
  #ground() {
    const R = this.R, radii = [0.001, 6, 12, 17, 20.5]; for (let r = 21; r <= 55.01; r += this.low ? 0.5 : 0.25) radii.push(r); radii.push(56.5, 59, 64, 72, 85, 110, 160, 260, 500);
    const NA = this.low ? 512 : 1024, nr = radii.length, pos = new Float32Array(nr * (NA + 1) * 3), nor = new Float32Array(nr * (NA + 1) * 3), idx = [];
    for (let j = 0; j < nr; j++) for (let i = 0; i <= NA; i++) { const a = i / NA * Math.PI * 2, x = Math.cos(a) * radii[j], z = Math.sin(a) * radii[j], o = 3 * (j * (NA + 1) + i), e = 0.12;
      pos[o] = x; pos[o + 1] = groundHeight(x, z); pos[o + 2] = z;
      const nx = groundHeight(x - e, z) - groundHeight(x + e, z), nz = groundHeight(x, z - e) - groundHeight(x, z + e), l = Math.hypot(nx, 2 * e, nz); nor[o] = nx / l; nor[o + 1] = 2 * e / l; nor[o + 2] = nz / l; }
    for (let j = 0; j < nr - 1; j++) for (let i = 0; i < NA; i++) { const a = j * (NA + 1) + i, b = a + NA + 1; idx.push(a, a + 1, b, a + 1, b + 1, b); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setIndex(idx);
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vW;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvW = (modelMatrix * vec4(position, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vW;\n${NOISE}\n${PERTURB}\nfloat gH; float gR;
        vec3 gCol() { vec2 p = vW.xz; float fw = length(fwidth(p)); float r = length(p);
          float trail = 1.0 - smoothstep(0.3, 4.2, abs(r - ${R.toFixed(1)}) + (wf(p * 0.35) - 0.5) * 2.5);
          float big = wf(p * 0.045), mid = wf(p * 0.4 + 3.0), fine = wf(p * 4.0), grit = wn(p * 38.0);
          float wet = 1.0 - smoothstep(${(WATER_Y + 0.004).toFixed(3)}, ${(WATER_Y + 0.075).toFixed(3)}, vW.y + (mid - 0.5) * 0.02);     // damp margin around standing water
          float moss = smoothstep(0.56, 0.72, big + 0.22 * mid) * (1.0 - trail) * smoothstep(0.3, 0.6, wf(p * 1.7 + 30.0) + 0.25) * (1.0 - wet);
          vec2 pv = wv(p * 7.0 + wn(p * 3.0) * 2.0); float peb = (1.0 - smoothstep(0.0, 0.2 + 0.2 * wh(floor(p * 7.0)), pv.x)) * smoothstep(0.62, 0.85, wn(p * 0.6 + 4.0) * 0.6 + wn(p * 2.7) * 0.4) * (1.0 - smoothstep(0.02, 0.09, fw));
          vec2 cr = wv(p * 1.6 + vec2(wf(p * 0.9), wf(p * 0.9 + 4.0)) * 2.2); float crack = (1.0 - smoothstep(0.0, 0.035, cr.y - cr.x)) * (1.0 - moss) * (1.0 - smoothstep(0.03, 0.12, fw)) * smoothstep(0.35, 0.7, wf(p * 0.23 + 2.0)) * (0.3 + 0.5 * trail) * (1.0 - wet);
          vec3 soil = mix(vec3(0.15, 0.11, 0.075), vec3(0.29, 0.235, 0.16), mid); soil = mix(soil, vec3(0.34, 0.29, 0.215), trail * 0.45);
          soil = mix(soil, vec3(0.115, 0.075, 0.045), smoothstep(0.5, 0.8, wf(p * 6.0 + 70.0)) * 0.5 * (1.0 - trail));
          soil *= (0.72 + 0.56 * fine) * (0.9 + 0.2 * grit); soil = mix(soil, soil * vec3(0.42, 0.40, 0.38), wet);
          vec3 green = mix(vec3(0.05, 0.072, 0.028), vec3(0.11, 0.13, 0.045), fine);
          vec3 c = mix(soil, green, moss * 0.8); c = mix(c, vec3(0.31, 0.29, 0.26) * (0.6 + 0.8 * wh(floor(p * 7.0))), peb * 0.8 * (1.0 - wet * 0.5)); c *= 1.0 - 0.45 * crack;
          float near = 1.0 - smoothstep(0.004, 0.03, fw);
          gH = 0.03 * fine * (1.0 - smoothstep(0.02, 0.15, fw)) + 0.006 * grit * near + 0.025 * peb - 0.02 * crack + 0.02 * moss * wn(p * 30.0) * near;
          gR = mix(mix(0.95, 0.78, peb), 0.16, wet * (1.0 - moss)); return c; }`)
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = gCol();')
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = gR;')
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = gPerturb(normal, -vViewPosition, gH);');
    };
    const mesh = new THREE.Mesh(g, m); mesh.receiveShadow = true; this.scene.add(mesh); this.ground = mesh;
  }
  // ---- standing water in the hollows: a level sheet the terrain dips below ----
  #water() {
    const g = new THREE.RingGeometry(this.R - 15, this.R + 15, 128, 1); g.rotateX(-Math.PI / 2);
    const m = new THREE.MeshPhysicalMaterial({ color: 0x15100a, roughness: 0.03, metalness: 0, envMapIntensity: 1.25, transparent: true, opacity: 0.93 });
    const uT = this.uTime;
    m.onBeforeCompile = (sh) => { sh.uniforms.uTime = uT;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vW;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvW = (modelMatrix * vec4(position, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vW; uniform float uTime;\n${NOISE}\n${PERTURB}`)
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = gPerturb(normal, -vViewPosition, 0.0016 * (wn(vW.xz * 9.0 + uTime * 0.35) + wn(vW.zx * 14.0 - uTime * 0.5)));'); };
    const mesh = new THREE.Mesh(g, m); mesh.position.y = WATER_Y; mesh.receiveShadow = true; mesh.renderOrder = 0; this.scene.add(mesh);
  }

  // ---- vegetation: ferns in the clearing, conifers (Metasequoia-like) beyond ----
  #frondTexture(hue, lum0, lumK, sat) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 1024; const x = c.getContext('2d'); x.clearRect(0, 0, 256, 1024);
    const N = 54;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1), y = 1000 - t * 960, L = (112 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.62)), 0.8) + 5) * (0.92 + 0.16 * Math.random()), wd = 8.5 * (1 - 0.5 * t);
      for (const s of [-1, 1]) {
        const lum = lum0 + lumK * (0.3 + 0.7 * t) * (0.75 + 0.5 * Math.random()), up = 10 + 16 * t;
        const g = x.createLinearGradient(128, y, 128 + s * L, y - up); g.addColorStop(0, `hsl(${hue + 8 * Math.random()},${sat}%,${lum * 0.8}%)`); g.addColorStop(1, `hsl(${hue - 16 + 10 * Math.random()},${sat + 6}%,${lum * 1.25}%)`);
        x.fillStyle = g; x.beginPath(); x.moveTo(128, y + wd); x.quadraticCurveTo(128 + s * L * 0.55, y + wd * 0.9 - up * 0.3, 128 + s * L, y - up); x.quadraticCurveTo(128 + s * L * 0.5, y - wd * 1.1 - up * 0.5, 128, y - wd); x.closePath(); x.fill();
      }
    }
    x.strokeStyle = `hsl(${hue - 30},30%,${lum0 * 0.9}%)`; x.lineWidth = 4; x.beginPath(); x.moveTo(128, 1024); x.lineTo(128, 30); x.stroke();
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; return tex;
  }
  #frond(len, wid, droop, yaw, tilt, out, base, seg = 7) {
    const P = out.pos, U = out.uv, N = out.nor, I = out.idx, o = P.length / 3, cy = Math.cos(yaw), sy = Math.sin(yaw);
    for (let i = 0; i <= seg; i++) {
      const t = i / seg, ang = tilt - droop * t * t, r = len * t, px = Math.cos(ang) * r * (1 - 0.15 * t), py = Math.sin(tilt) * r - droop * 0.5 * len * t * t, nx = -Math.sin(ang), ny = Math.cos(ang);
      for (const s of [-1, 1]) { const lz = s * wid * 0.5, cup = 0.12 * wid * Math.abs(s); P.push(base[0] + px * cy - lz * sy, base[1] + py + cup, base[2] + px * sy + lz * cy); U.push(s * 0.5 + 0.5, t); N.push(nx * cy * 0.5, Math.abs(ny) * 0.8 + 0.4, nx * sy * 0.5); }
      if (i < seg) { const a = o + 2 * i; I.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
  }
  #plantMat(tex, sway) {
    const m = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.4, side: THREE.DoubleSide }); const uT = this.uTime, uS = this.uSun; m.customProgramCacheKey = () => 'plant' + sway;
    m.onBeforeCompile = (sh) => { sh.uniforms.uTime = uT; sh.uniforms.uSunV = uS;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace('#include <begin_vertex>', `#include <begin_vertex>
      { vec4 wp = instanceMatrix * vec4(position, 1.0); float k = ${sway.toFixed(3)} * position.y; transformed.x += sin(uTime * 1.3 + wp.x * 0.7 + wp.z * 0.4) * k; transformed.z += cos(uTime * 1.1 + wp.z * 0.6) * k * 0.7; }`);
      // light coming through the leaf from behind
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uSunV;').replace('#include <opaque_fragment>', `{ vec3 sv = normalize((viewMatrix * vec4(uSunV, 0.0)).xyz); float back = pow(clamp(dot(normalize(vViewPosition), -sv), 0.0, 1.0), 2.0); outgoingLight += diffuseColor.rgb * vec3(1.0, 0.95, 0.55) * back * 0.9; }\n#include <opaque_fragment>`); };
    return m;
  }
  #plants() {
    const rnd = rng(7), tex = this.#frondTexture(100, 15, 22, 46), texT = this.#frondTexture(120, 5, 8, 30), R = this.R, low = this.low;
    const mk = (out) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(out.nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(out.uv, 2)); g.setIndex(out.idx); return g; };
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), UPV = new THREE.Vector3(0, 1, 0);
    // fern: two tiers of arching fronds
    const f = { pos: [], uv: [], nor: [], idx: [] };
    for (let i = 0; i < 9; i++) this.#frond(1.0 + rnd() * 0.5, 0.36, 1.1 + rnd() * 0.5, i / 9 * Math.PI * 2 + rnd() * 0.4, 1.05 + rnd() * 0.3, f, [0, 0, 0]);
    for (let i = 0; i < 9; i++) this.#frond(0.9 + rnd() * 0.5, 0.34, 1.3 + rnd() * 0.5, (i + 0.5) / 9 * Math.PI * 2 + rnd() * 0.4, 0.55 + rnd() * 0.3, f, [0, 0, 0]);
    const nF = low ? 500 : 1700, ferns = new THREE.InstancedMesh(mk(f), this.#plantMat(tex, 0.035), nF);
    for (let i = 0; i < nF; i++) {
      let r, a, tries = 0; do { r = Math.sqrt(rnd()) * 105; a = rnd() * Math.PI * 2; p.set(Math.cos(a) * r, 0, Math.sin(a) * r); if (i % 3) { p.x += (rnd() - 0.5) * 1.2; const c = rng(Math.floor(i / 9) + 99); const cr = Math.sqrt(c()) * 100, ca = c() * 6.283; p.set(Math.cos(ca) * cr + (rnd() - 0.5) * 5, 0, Math.sin(ca) * cr + (rnd() - 0.5) * 5); r = Math.hypot(p.x, p.z); } p.y = groundHeight(p.x, p.z); }
      while ((Math.abs(r - R) < 3.3 + rnd() * 1.5 || p.y < WATER_Y + 0.03) && tries++ < 20);
      p.y -= 0.03; q.setFromAxisAngle(UPV, rnd() * 6.28); s.setScalar(0.55 + 1.0 * rnd() * rnd() + 0.2);
      ferns.setMatrixAt(i, M.compose(p, q, s)); ferns.setColorAt(i, new THREE.Color().setHSL(0.17 + 0.1 * rnd(), 0.18, 0.7 + 0.3 * rnd()));
    }
    ferns.castShadow = !low; ferns.receiveShadow = true; this.scene.add(ferns);
    // conifer: trunk + drooping whorls of foliage
    const t = { pos: [], uv: [], nor: [], idx: [] }, H = 27;
    for (let w = 0; w < 30; w++) { const u = w / 29, y = 5.5 + (H - 5.5) * Math.pow(u, 0.9), rad = (1 - u) * 6.0 + 0.9, nb = u > 0.85 ? 3 : 4 + Math.floor(rnd() * 2);
      for (let b = 0; b < nb; b++) { const len = rad * (0.75 + 0.5 * rnd()); this.#frond(len, len * (0.34 + 0.12 * rnd()), 0.45 + 0.7 * (1 - u) * rnd(), (b + rnd() * 0.7) / nb * Math.PI * 2 + w * 1.7, -0.12 + 0.55 * u + (rnd() - 0.5) * 0.25, t, [0, y + (rnd() - 0.5) * 0.5, 0], 4); } }
    const nT = low ? 110 : 280, foliage = new THREE.InstancedMesh(mk(t), this.#plantMat(texT, 0.004), nT);
    const tg = new THREE.CylinderGeometry(0.22, 0.75, H, 9, 1); tg.translate(0, H / 2, 0);
    const bark = new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 0.95 });
    bark.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvP = position;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vP;\n${NOISE}`).replace('#include <color_fragment>', '#include <color_fragment>\n{ float a = atan(vP.z, vP.x); float b = wf(vec2(a * 5.0, vP.y * 0.6)); diffuseColor.rgb *= 0.45 + 1.1 * b * b + 0.3 * wn(vec2(a * 30.0, vP.y * 3.0)); }'); };
    const trunks = new THREE.InstancedMesh(tg, bark, nT);
    for (let i = 0; i < nT; i++) { let r, a; do { r = Math.sqrt(rnd()) * 240; a = rnd() * Math.PI * 2; } while (r < R + 50 && r > 6);
      const sc = 0.7 + 0.7 * rnd(); p.set(Math.cos(a) * r, 0, Math.sin(a) * r); q.setFromAxisAngle(UPV, rnd() * 6.28); s.set(sc, sc * (0.85 + 0.4 * rnd()), sc); M.compose(p, q, s); foliage.setMatrixAt(i, M); trunks.setMatrixAt(i, M); }
    foliage.castShadow = trunks.castShadow = !low; trunks.receiveShadow = true; this.scene.add(foliage, trunks);
    // stones, large and small
    const rg = new THREE.SphereGeometry(1, 28, 18), rp = rg.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < rp.count; i++) { v.fromBufferAttribute(rp, i); const n = 1 + 0.22 * Math.sin(v.x * 3.1 + v.y * 2.3) + 0.18 * Math.sin(v.z * 4.7 + v.x * 1.7) + 0.06 * Math.sin(v.y * 9.0 + v.z * 7.0) + 0.05 * Math.sin(v.x * 13.0 + v.z * 11.0 + v.y * 5.0); v.multiplyScalar(n); v.y *= 0.55; rp.setXYZ(i, v.x, v.y, v.z); } rg.computeVertexNormals();
    const stone = new THREE.MeshStandardMaterial({ color: 0x6b665e, roughness: 0.92 });
    stone.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvP = position * 3.0 + instanceMatrix[3].xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vP;\n${NOISE}`).replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= 0.55 + 0.9 * wf(vP.xz * 2.0 + vP.y * 3.0);'); };
    const nS = low ? 200 : 900, rocks = new THREE.InstancedMesh(rg, stone, nS);
    for (let i = 0; i < nS; i++) { let r, a; do { r = 8 + Math.sqrt(rnd()) * 90; a = rnd() * 6.28; } while (Math.abs(r - R) < 1.6); const big = i < 70, sc = big ? 0.2 + rnd() * rnd() * 1.0 : 0.02 + rnd() * 0.07; p.set(Math.cos(a) * r, 0, Math.sin(a) * r); p.y = groundHeight(p.x, p.z) + sc * 0.12; q.setFromEuler(new THREE.Euler(rnd(), rnd() * 6, rnd())); s.set(sc, sc, sc); rocks.setMatrixAt(i, M.compose(p, q, s)); }
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
    const N = this.nPrints = 44, g = new THREE.PlaneGeometry(1.45, 1.45); g.rotateX(-Math.PI / 2); g.rotateY(-Math.PI / 2);
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
    M.compose(new THREE.Vector3(pos.x, groundHeight(pos.x, pos.z) + 0.014 + 0.0004 * (i % 7), pos.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, mirror));
    this.prints.setMatrixAt(i, M); this.prints.instanceMatrix.needsUpdate = true; this.prints.geometry.attributes.aAge.setX(i, 0);
  }

  // ---- carcass and the piece torn from it (feeding) ----
  showCarcass(pos, yaw) {
    if (!this.carcass) {
      const g = new THREE.Group(), hide = new THREE.MeshStandardMaterial({ color: 0x3a3226, roughness: 0.9 }), meat = new THREE.MeshStandardMaterial({ color: 0x5a1210, roughness: 0.35 }), bone = new THREE.MeshStandardMaterial({ color: 0xb9ad92, roughness: 0.6 });
      const lump = (r, sx, sy, sz, m, seed) => { const ge = new THREE.SphereGeometry(r, 28, 18), p = ge.attributes.position, v = new THREE.Vector3(); for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const n = 1 + 0.16 * Math.sin(v.x * 5 + seed) * Math.sin(v.z * 4.3 + seed * 2) + 0.1 * Math.sin(v.y * 9 + v.x * 6 + seed); p.setXYZ(i, v.x * n * sx, Math.max(-0.05, v.y * n * sy), v.z * n * sz); } ge.computeVertexNormals(); const me = new THREE.Mesh(ge, m); me.castShadow = me.receiveShadow = true; return me; };
      const body = lump(1, 1.9, 0.62, 1.0, hide, 1); body.position.set(0.9, 0.05, 0); g.add(body);
      const hind = lump(0.6, 1.3, 0.7, 0.9, hide, 4); hind.position.set(2.4, 0.05, 0.25); g.add(hind);
      const open = lump(0.55, 1.2, 0.55, 0.9, meat, 7); open.position.set(0.05, 0.16, 0.05); g.add(open);
      for (let i = 0; i < 6; i++) { const rib = new THREE.Mesh(new THREE.TorusGeometry(0.42 - 0.02 * i, 0.03, 6, 14, Math.PI * 0.9), bone); rib.position.set(-0.25 + 0.2 * i, 0.12, 0.05); rib.rotation.set(0, Math.PI / 2 + 0.12 * (i - 2.5), 0.25); rib.castShadow = true; g.add(rib); }
      this.carcass = g; this.scene.add(g);
      this.chunk = lump(0.2, 1.25, 0.8, 0.9, meat, 11); this.chunk.visible = false; this.scene.add(this.chunk);
    }
    this.carcass.position.set(pos.x, groundHeight(pos.x, pos.z), pos.z); this.carcass.rotation.y = -yaw; this.carcass.visible = true;
  }

  // ---- dust kicked up at footfall ----
  #dust() {
    const N = this.nDust = 420, g = new THREE.BufferGeometry();
    this.dp = new Float32Array(N * 3); this.dv = new Float32Array(N * 3); this.dl = new Float32Array(N * 2).fill(0);
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
      this.dp[3 * i] = pos.x + Math.cos(a) * r; this.dp[3 * i + 1] = pos.y + Math.random() * 0.15; this.dp[3 * i + 2] = pos.z + Math.sin(a) * r;
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
