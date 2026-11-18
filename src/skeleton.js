// The skeleton on its own: a second surface carried by the same joints as the flesh, loaded the first time it is asked for.
// Shaded as fossil bone: mineral-stained brown, paler where it is worn on the convex side, dark in the pits, with fine cracks.
import * as THREE from 'three';

export async function loadSkeleton(rex, name = 'skeleton') {
  const meta = await (await fetch(`assets/${name}.json`)).json();
  const res = await fetch(`assets/${name}.bin.gz`); if (!res.ok) throw new Error('could not load skeleton: ' + res.status);
  const buf = await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  const L = meta.layout, arr = (k, T) => new T(buf, L[k].offset, L[k].length);
  const ix = arr('index', Uint32Array); for (let i = 1; i < ix.length; i++) ix[i] = (ix[i] + ix[i - 1]) >>> 0;
  const g = new THREE.BufferGeometry(), n8 = arr('normal', Int8Array), ao = new Uint8Array(n8.length / 4); for (let i = 0; i < ao.length; i++) ao[i] = Math.max(0, n8[4 * i + 3]) * 2;
  g.setAttribute('position', new THREE.BufferAttribute(arr('position', Float32Array), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(n8, 4, true));
  g.setAttribute('aOpen', new THREE.BufferAttribute(ao, 1, true));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(arr('skinIndex', Uint8Array), 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(arr('skinWeight', Uint8Array), 4, true));
  g.setIndex(new THREE.BufferAttribute(ix, 1)); g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 2.5, 0), 9);
  const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.45 });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aOpen; varying vec3 vB; varying float vOpen;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvB = position; vOpen = aOpen;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vB; varying float vOpen; float bRough, bH;
      float bh(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float bn(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(mix(bh(i), bh(i + vec3(1, 0, 0)), f.x), mix(bh(i + vec3(0, 1, 0)), bh(i + vec3(1, 1, 0)), f.x), f.y), mix(mix(bh(i + vec3(0, 0, 1)), bh(i + vec3(1, 0, 1)), f.x), mix(bh(i + vec3(0, 1, 1)), bh(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
      float bf(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * bn(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
      vec3 bPerturb(vec3 n, vec3 sp, float h) { vec2 dH = vec2(dFdx(h), dFdy(h)); vec3 sx = dFdx(sp), sy = dFdy(sp), R1 = cross(sy, n), R2 = cross(n, sx); float det = dot(sx, R1); return normalize(abs(det) * n - sign(det) * (dH.x * R1 + dH.y * R2)); }
      vec3 bone() { float big = bf(vB * 2.2), mid = bf(vB * 11.0 + 3.0), fine = bf(vB * 70.0), pit = bn(vB * 260.0);
        float crack = 1.0 - smoothstep(0.0, 0.035, abs(bf(vB * 6.0 + 20.0) - 0.5)) ; crack *= smoothstep(0.45, 0.6, bf(vB * 1.3 + 9.0));
        float open = smoothstep(0.15, 0.85, vOpen);
        vec3 c = mix(vec3(0.115, 0.075, 0.05), vec3(0.30, 0.215, 0.145), smoothstep(0.25, 0.75, mid * 0.6 + big * 0.4));
        c = mix(c, vec3(0.055, 0.045, 0.04), smoothstep(0.58, 0.8, big) * 0.6);                 // manganese staining
        c = mix(c, vec3(0.44, 0.35, 0.25), open * open * 0.35 * smoothstep(0.35, 0.7, fine)); // wear on exposed surfaces
        c *= (0.55 + 0.45 * open) * (0.82 + 0.36 * fine) * (1.0 - 0.6 * crack);
        bH = 0.0016 * fine + 0.0006 * pit - 0.002 * crack; bRough = clamp(0.5 + 0.3 * fine - 0.15 * open + 0.2 * crack, 0.25, 0.95); return c; }`)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = bone();')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = bRough;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = bPerturb(normal, -vViewPosition, bH);')
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n{ float o = 0.35 + 0.65 * smoothstep(0.0, 0.8, vOpen); reflectedLight.indirectDiffuse *= o; reflectedLight.indirectSpecular *= o * o; }');
  };
  const mesh = new THREE.SkinnedMesh(g, mat); mesh.bind(rex.skeleton, new THREE.Matrix4()); mesh.frustumCulled = false; mesh.castShadow = mesh.receiveShadow = true;
  rex.group.add(mesh); return mesh;
}
