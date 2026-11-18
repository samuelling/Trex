// The skeleton on its own: a second surface carried by the same joints as the flesh, loaded the first time it is asked for.
import * as THREE from 'three';

export async function loadSkeleton(rex) {
  const meta = await (await fetch('assets/skeleton.json')).json();
  const res = await fetch('assets/skeleton.bin.gz'); if (!res.ok) throw new Error('could not load skeleton: ' + res.status);
  const buf = await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  const L = meta.layout, arr = (k, T) => new T(buf, L[k].offset, L[k].length);
  const ix = arr('index', Uint32Array); for (let i = 1; i < ix.length; i++) ix[i] = (ix[i] + ix[i - 1]) >>> 0;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(arr('position', Float32Array), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(arr('normal', Int8Array), 4, true));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(arr('skinIndex', Uint8Array), 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(arr('skinWeight', Uint8Array), 4, true));
  g.setIndex(new THREE.BufferAttribute(ix, 1)); g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 2.5, 0), 9);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0 });
  mat.onBeforeCompile = (sh) => {   // weathered bone: mottled ivory, darker in the pits
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vB;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvB = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vB;
      float bh(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float bn(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(mix(bh(i), bh(i + vec3(1, 0, 0)), f.x), mix(bh(i + vec3(0, 1, 0)), bh(i + vec3(1, 1, 0)), f.x), f.y), mix(mix(bh(i + vec3(0, 0, 1)), bh(i + vec3(1, 0, 1)), f.x), mix(bh(i + vec3(0, 1, 1)), bh(i + vec3(1, 1, 1)), f.x), f.y), f.z); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      { float a = bn(vB * 9.0) * 0.6 + bn(vB * 31.0) * 0.4, b = bn(vB * 120.0); vec3 c = mix(vec3(0.25, 0.205, 0.14), vec3(0.45, 0.40, 0.31), a); diffuseColor.rgb = c * (0.86 + 0.2 * b); }`);
  };
  const mesh = new THREE.SkinnedMesh(g, mat); mesh.bind(rex.skeleton, new THREE.Matrix4()); mesh.frustumCulled = false; mesh.castShadow = mesh.receiveShadow = true;
  rex.group.add(mesh); return mesh;
}
