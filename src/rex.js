// The animal: loads the built surface, sets up the skeleton, skin material, eyes and teeth.
import * as THREE from 'three';
import { VERT_PARS, VERT_MAIN, FRAG_PARS } from './skinShader.js';
import { SkinLayer } from './skin.js';

const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);

export class Rex {
  static async load(lod, onProgress) {
    const meta = await (await fetch(`assets/rex-${lod}.json`)).json();
    const res = await fetch(`assets/rex-${lod}.bin.gz`);
    if (!res.ok) throw new Error('could not load mesh: ' + res.status);
    const total = meta.gzBytes || 0; let got = 0;
    const counted = res.body.pipeThrough(new TransformStream({ transform(chunk, ctl) { got += chunk.length; if (onProgress && total) onProgress(Math.min(1, got / total)); ctl.enqueue(chunk); } }));
    const buf = await new Response(counted.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    { const L = meta.layout.index, ix = new Uint32Array(buf, L.offset, L.length); for (let i = 1; i < ix.length; i++) ix[i] = (ix[i] + ix[i - 1]) >>> 0; }
    if (onProgress) onProgress(1);
    const tl = new THREE.TextureLoader(), aniso = 8;
    const T = async (file, srgb, repeat) => { const t = await tl.loadAsync('assets/' + file); t.flipY = false; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = aniso; t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping; return t; };
    const [albedo, normal, orm, detail] = await Promise.all([T(`rex-${lod}-albedo.webp`, true), T(`rex-${lod}-normal.webp`), T(`rex-${lod}-orm.webp`), T('skin-detail.webp', false, true)]);
    return new Rex(meta, buf, { albedo, normal, orm, detail });
  }

  constructor(meta, buf, tex) {
    this.meta = meta; this.group = new THREE.Group();
    const L = meta.layout, arr = (k, T) => new T(buf, L[k].offset, L[k].length);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(arr('position', Float32Array), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(arr('normal', Int8Array), 4, true));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(arr('skinIndex', Uint8Array), 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(arr('skinWeight', Uint16Array), 4, true));
    g.setAttribute('aUv', new THREE.BufferAttribute(arr('uv', Uint16Array), 2, true));
    g.setAttribute('aMusIndex', new THREE.BufferAttribute(arr('musIndex', Uint8Array), 4));
    g.setAttribute('aMusWeight', new THREE.BufferAttribute(arr('musWeight', Uint8Array), 4, true));
    g.setAttribute('aMusGradA', new THREE.BufferAttribute(arr('musGradA', Int8Array), 4, true));
    g.setAttribute('aMusGradB', new THREE.BufferAttribute(arr('musGradB', Int8Array), 4, true));
    g.setAttribute('aNodeIndex', new THREE.BufferAttribute(arr('nodeIndex', Uint8Array), 4));
    g.setAttribute('aMisc', new THREE.BufferAttribute(arr('misc', Uint8Array), 4, true));
    g.setAttribute('aMisc2', new THREE.BufferAttribute(arr('misc2', Uint8Array), 4, true));
    g.setAttribute('aBindIndex', new THREE.BufferAttribute(arr('bindIndex', Uint16Array), 4));
    g.setAttribute('aBindWeight', new THREE.BufferAttribute(arr('bindWeight', Uint8Array), 4, true));
    g.setIndex(new THREE.BufferAttribute(arr('index', Uint32Array), 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 2.5, 0), 9);

    // ---- skeleton: flat list, every bone driven directly in world space ----
    this.bones = meta.bones.map((b, i) => ({ name: b.name, idx: i, rest: V(b.p), obj: new THREE.Bone(), parent: -1 }));
    this.byName = Object.fromEntries(this.bones.map(b => [b.name, b]));
    meta.bones.forEach((b, i) => { this.bones[i].parent = b.parent ? this.byName[b.parent].idx : -1; });
    const inv = this.bones.map(b => new THREE.Matrix4().makeTranslation(-b.rest.x, -b.rest.y, -b.rest.z));
    for (const b of this.bones) { b.obj.position.copy(b.rest); this.group.add(b.obj); }
    this.skeleton = new THREE.Skeleton(this.bones.map(b => b.obj), inv);

    // ---- uniforms shared with the simulation ----
    this.nMus = meta.muscles.length; this.musIdx = Object.fromEntries(meta.muscles.map((m, i) => [m, i]));
    this.uMus = new Float32Array(32); this.uAct = new Float32Array(32);
    this.nodeData = new Float32Array(256 * 2 * 4);
    meta.nodes.forEach((n, j) => { this.nodeData.set([0, 0, 0, n.soft], j * 4); this.nodeData.set([n.p[0], n.p[1], n.p[2], n.R], (256 + j) * 4); });
    this.nodeTex = new THREE.DataTexture(this.nodeData, 256, 2, THREE.RGBAFormat, THREE.FloatType);
    this.nodeTex.magFilter = this.nodeTex.minFilter = THREE.NearestFilter; this.nodeTex.needsUpdate = true;
    this.skin = new SkinLayer(this, buf);
    this.uniforms = { uMus: { value: this.uMus }, uAct: { value: this.uAct }, uNodeTex: { value: this.nodeTex }, uSkinTex: { value: this.skin.tex }, uSkinRest: { value: this.skin.restTex }, uBreath: { value: 0 }, uView: { value: 0 }, uDetail: { value: 1 }, uWrinkle: { value: 1 },
      tAlbedo: { value: tex.albedo }, tNormal: { value: tex.normal }, tORM: { value: tex.orm }, tDetail: { value: tex.detail } };

    const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0, sheen: 0.1, sheenRoughness: 0.75, sheenColor: new THREE.Color(0.35, 0.3, 0.22) });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <skinbase_vertex>', '')
        .replace('#include <common>', '#include <common>\n' + VERT_PARS)
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n#include <skinbase_vertex>\n' + VERT_MAIN)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += rexDisp;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = rexSkin();')
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = rexRough;')
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize((viewMatrix * vec4(rexN, 0.0)).xyz); normal = rexPerturb(normal, -vViewPosition, (rexFold - 0.5) * 0.03 * rexComp);')
        .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= rexAO; reflectedLight.indirectSpecular *= rexAO * rexAO; reflectedLight.directDiffuse *= mix(1.0, rexAO, 0.35);');
    };
    this.material = mat;
    const mesh = new THREE.SkinnedMesh(g, mat);
    mesh.bind(this.skeleton, new THREE.Matrix4()); mesh.frustumCulled = false; mesh.castShadow = mesh.receiveShadow = true;
    this.mesh = mesh; this.group.add(mesh);

    this.#buildEyes(); this.#buildTeeth(); this.#buildGullet();
  }

  bone(n) { return this.byName[n]; }
  // world position of a rest-space point rigidly attached to bone b
  toWorld(b, restPoint, out) { return out.copy(restPoint).sub(b.rest).applyQuaternion(b.obj.quaternion).add(b.obj.position); }
  attach(obj, boneName) { const b = this.byName[boneName]; obj.position.sub(b.rest); b.obj.add(obj); }

  #buildEyes() {
    const lm = this.meta.landmarks, r = lm.eyeR, geo = new THREE.SphereGeometry(r, 40, 28);
    const mat = new THREE.MeshPhysicalMaterial({ roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.4 });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vEye;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvEye = normalize(position);');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vEye;
        float eh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float en(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(eh(i), eh(i+vec2(1,0)), f.x), mix(eh(i+vec2(0,1)), eh(i+vec2(1,1)), f.x), f.y); }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
        { vec3 q = normalize(vEye); float rr = length(q.xy), an = atan(q.y, q.x);
          float fib = en(vec2(an * 9.0, rr * 14.0)) * 0.6 + en(vec2(an * 31.0, rr * 5.0)) * 0.4;
          vec3 iris = mix(vec3(0.34, 0.17, 0.03), vec3(0.12, 0.055, 0.012), fib); iris = mix(iris, vec3(0.46, 0.30, 0.07), smoothstep(0.42, 0.30, rr) * 0.55);
          vec3 c = mix(vec3(0.0), iris, smoothstep(0.27, 0.31, rr)); c = mix(c, vec3(0.03, 0.02, 0.015), smoothstep(0.56, 0.66, rr));
          if (q.z < 0.0) c = vec3(0.03, 0.02, 0.015); diffuseColor.rgb = c; }`);
    };
    this.eyes = [];
    lm.eyes.forEach((p, i) => {
      const s = i === 0 ? 1 : -1, m = new THREE.Mesh(geo, mat); m.position.set(p[0], p[1], p[2]);
      const dir = new THREE.Vector3(0.42, 0.02, 0.9 * s).normalize().applyAxisAngle(new THREE.Vector3(0, 0, 1), lm.HL.pitch);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir); m.userData.q0 = m.quaternion.clone();
      this.attach(m, 'head'); this.eyes.push(m);
      // nictitating/eyelid shell for blinking
      const lid = new THREE.Mesh(new THREE.SphereGeometry(r * 1.06, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), new THREE.MeshStandardMaterial({ color: 0x1a1612, roughness: 0.8 }));
      lid.quaternion.copy(m.userData.q0).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI * 0.5)); lid.position.copy(m.position); m.parent.add(lid); lid.visible = false; m.userData.lid = lid;
    });
  }

  #buildTeeth() {
    const lm = this.meta.landmarks, per = { head: [], jaw: [] };
    for (const t of lm.teeth) per[t.b].push(t);
    const mat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.32, clearcoat: 0.4, clearcoatRoughness: 0.3 });
    for (const bn of ['head', 'jaw']) {
      const pos = [], nor = [], col = [], idx = []; const up = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion(), v = new THREE.Vector3(), nrm = new THREE.Vector3();
      for (const t of per[bn]) {
        const r = V(t.r), tip = V(t.t), ax = tip.clone().sub(r), len = ax.length(); q.setFromUnitVectors(up, ax.clone().normalize());
        const cg = new THREE.ConeGeometry(t.rad, len, 8, 4, true); const P = cg.attributes.position, N = cg.attributes.normal, base = pos.length / 3;
        for (let i = 0; i < P.count; i++) {
          v.fromBufferAttribute(P, i); const h = v.y / len + 0.5; v.z *= 0.72; v.y += len * 0.5; v.x -= 0.25 * len * h * h * (bn === 'head' ? 1 : 0.6); // lateral compression, recurved
          v.applyQuaternion(q).add(r); pos.push(v.x, v.y, v.z); nrm.fromBufferAttribute(N, i).applyQuaternion(q); nor.push(nrm.x, nrm.y, nrm.z);
          const c = 0.35 + 0.65 * Math.min(1, h * 1.6); col.push(0.80 * c, 0.74 * c, 0.58 * c);
        }
        const I = cg.index; for (let i = 0; i < I.count; i++) idx.push(I.getX(i) + base);
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx);
      const m = new THREE.Mesh(g, mat); m.castShadow = true; m.frustumCulled = false; this.attach(m, bn);
    }
  }

  #buildGullet() {
    const lm = this.meta.landmarks, o = lm.HL.origin, c = Math.cos(lm.HL.pitch), s = Math.sin(lm.HL.pitch), k = lm.HL.scale;
    const HL = (x, y) => new THREE.Vector3(o[0] + (x * c - y * s) * k, o[1] + (x * s + y * c) * k, 0);
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshStandardMaterial({ color: 0x120405, roughness: 0.6, side: THREE.DoubleSide }));
    m.scale.set(0.30, 0.16, 0.30); m.position.copy(HL(0.22, -0.36)); m.rotation.z = lm.HL.pitch; this.attach(m, 'head');
  }

  setQuality(detail) { this.uniforms.uDetail.value = detail; }
}
