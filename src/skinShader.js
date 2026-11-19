// Skin shading and deformation, injected into three.js' physically based material.
// Vertex stage: muscle bulge, soft-tissue lattice and the simulated skin sheet displace the surface
// before skeletal skinning, and the deformed normal is rebuilt from the derivative of that displacement.
// Fragment stage: baked albedo / object-space normal / occlusion-roughness maps, tiling micro-scales
// projected triplanar in rest space, and wrinkles that deepen where the skin sheet is compressed.

export const VERT_PARS = /* glsl */`
// REX_HAIR: the same deformation for strands rooted in the skin (src/nipples.js), minus the inputs only shading needs (16-attribute limit)
#ifndef REX_HAIR
attribute vec2 aUv; attribute vec4 aMusGradA; attribute vec4 aMusGradB;
#endif
attribute vec4 aMusIndex; attribute vec4 aMusWeight;
attribute vec4 aNip; uniform float uNip; varying vec4 vNip; varying float vNipQ;
attribute vec4 aNodeIndex; attribute vec4 aMisc; attribute vec4 aMisc2; attribute vec4 aBindIndex; attribute vec4 aBindWeight;
uniform float uMus[32]; uniform float uAct[32]; uniform sampler2D uNodeTex; uniform sampler2D uSkinTex; uniform sampler2D uSkinRest; uniform float uBreath;
varying vec3 vRest; varying vec3 vRestN; varying vec2 vTex; varying vec3 vRot0; varying vec3 vRot1; varying vec3 vRot2; varying vec3 vDef; varying float vAct; varying float vStrain; varying float vSlide;
vec3 rexDisp;
// soft-tissue lattice displacement at rest-space point x (world-space vector)
vec3 nodeField(vec3 x, float s) {
  vec3 acc = vec3(0.0); float G = 0.0;
  for (int i = 0; i < 4; i++) {
    float id = aNodeIndex[i]; if (id > 254.5) continue; int j = int(id + 0.5);
    vec4 pr = texelFetch(uNodeTex, ivec2(j, 1), 0), u = texelFetch(uNodeTex, ivec2(j, 0), 0);
    float g = max(0.0, 1.0 - distance(x, pr.xyz) / pr.w); g = max(0.0, g * g * u.w - aMisc2.x); acc += g * u.xyz; G += g;
  }
  return G > 1e-5 ? acc * (s * min(1.0, G / 0.2) / G) : vec3(0.0);
}
ivec2 skinTc(float idx) { int i = int(idx + 0.5); return ivec2(i & 127, i >> 7); }`;

export const VERT_MAIN = /* glsl */`
vRest = position; vRestN = normal; vStrain = 0.0; vSlide = 0.0;
#ifndef REX_HAIR
vTex = aUv;
#endif
{
  vec3 t1 = normalize(cross(normal, abs(normal.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0))), t2 = cross(normal, t1);
  float b = 0.0, g1 = 0.0, g2 = 0.0, act = 0.0;
  for (int i = 0; i < 4; i++) { int m = int(aMusIndex[i] + 0.5); float B = uMus[m]; b += aMusWeight[i] * B; act += aMusWeight[i] * uAct[m];
  #ifndef REX_HAIR
    g1 += aMusGradA[i] * B; g2 += aMusGradB[i] * B;
  #endif
  }
  float br = uBreath * aMisc.w * smoothstep(0.2, 1.0, position.x) * (1.0 - smoothstep(2.2, 3.0, position.x));
  rexDisp = normal * (0.3 * b + br);
  vNip = aNip; vNipQ = aNip.w * aNip.w;
  if (uNip > 0.5) { float sz = 0.8 + 0.45 * aNip.w, rn = length(aNip.xyz) / sz; rexDisp += normal * sz * (0.017 * (1.0 - smoothstep(0.0, 0.03, rn)) + 0.005 * (1.0 - smoothstep(0.04, 0.062, rn))); }   // nub on a slightly puffed areola
  vec3 dT1 = normal * (g1 * 5.0), dT2 = normal * (g2 * 5.0);          // derivative of the displacement along each tangent
  mat3 r = mat3(1.0);
  #ifdef USE_SKINNING
  r = mat3(bindMatrixInverse * (skinWeight.x * boneMatX + skinWeight.y * boneMatY + skinWeight.z * boneMatZ + skinWeight.w * boneMatW) * bindMatrix);
  float s = aMisc.w;
  if (s > 0.01) {
    vec3 l0 = nodeField(position, s) * r, l1 = nodeField(position + t1 * 0.04, s) * r, l2 = nodeField(position + t2 * 0.04, s) * r;
    rexDisp += l0; dT1 += (l1 - l0) * 25.0; dT2 += (l2 - l0) * 25.0;
  }
  if (aBindWeight.w > 0.5) {   // simulated skin sheet: slide, sag, sway
    ivec2 c0 = skinTc(aBindIndex.x), c1 = skinTc(aBindIndex.y), c2 = skinTc(aBindIndex.z);
    vec4 d0 = texelFetch(uSkinTex, c0, 0), d1 = texelFetch(uSkinTex, c1, 0), d2 = texelFetch(uSkinTex, c2, 0);
    vec3 P0 = texelFetch(uSkinRest, c0, 0).xyz, e1 = texelFetch(uSkinRest, c1, 0).xyz - P0, e2 = texelFetch(uSkinRest, c2, 0).xyz - P0, N = cross(e1, e2);
    float inv = 1.0 / max(dot(N, N), 1e-12); vec3 gb1 = cross(e2, N) * inv, gb2 = cross(N, e1) * inv;
    vec3 l0 = d0.xyz * r, l1 = d1.xyz * r - l0, l2 = d2.xyz * r - l0, D = l0 + l1 * aBindWeight.y + l2 * aBindWeight.z;
    rexDisp += D; dT1 += l1 * dot(gb1, t1) + l2 * dot(gb2, t1); dT2 += l1 * dot(gb1, t2) + l2 * dot(gb2, t2);
    vStrain = d0.w * aBindWeight.x + d1.w * aBindWeight.y + d2.w * aBindWeight.z; vSlide = length(D);
  }
  #endif
  vec3 nd = normalize(cross(t1 + dT1, t2 + dT2));
  vDef = nd - normal; objectNormal = nd; vAct = act; vRot0 = r[0]; vRot1 = r[1]; vRot2 = r[2];
}`;

export const FRAG_PARS = /* glsl */`
varying vec3 vRest; varying vec3 vRestN; varying vec2 vTex; varying vec3 vRot0; varying vec3 vRot1; varying vec3 vRot2; varying vec3 vDef; varying float vAct; varying float vStrain; varying float vSlide; varying vec4 vNip; varying float vNipQ; uniform float uNip; float rexNipH;
uniform sampler2D tAlbedo; uniform sampler2D tNormal; uniform sampler2D tORM; uniform sampler2D tDetail;
uniform int uView; uniform float uDetail; uniform float uWrinkle;
float rexRough, rexAO, rexFold, rexComp; vec3 rexN;
vec3 rexPerturb(vec3 n, vec3 sp, float h) { vec2 dH = vec2(dFdx(h), dFdy(h)); vec3 sx = dFdx(sp), sy = dFdy(sp), R1 = cross(sy, n), R2 = cross(n, sx);
  float det = dot(sx, R1); return normalize(abs(det) * n - sign(det) * (dH.x * R1 + dH.y * R2)); }
vec3 rexSkin() {
  vec3 alb = texture2D(tAlbedo, vTex).rgb, orm = texture2D(tORM, vTex).rgb, n0 = normalize(vRestN);
  vec3 nr = texture2D(tNormal, vTex).xyz * 2.0 - 1.0;
  // micro-scales: one tiling tile, projected along the three axes of the resting body
  vec3 bw = pow(abs(n0), vec3(4.0)); bw /= bw.x + bw.y + bw.z;
  float head = smoothstep(3.55, 3.9, vRest.x), f = mix(8.0, 5.0, head);
  vec3 ax = texture2D(tDetail, vRest.zy * f).xyz, ay = texture2D(tDetail, vRest.xz * f).xyz, az = texture2D(tDetail, vRest.xy * f).xyz;
  vec3 pert = bw.x * vec3(0.0, ax.y * 2.0 - 1.0, ax.x * 2.0 - 1.0) + bw.y * vec3(ay.x * 2.0 - 1.0, 0.0, ay.y * 2.0 - 1.0) + bw.z * vec3(az.x * 2.0 - 1.0, az.y * 2.0 - 1.0, 0.0);
  float dh = bw.x * ax.z + bw.y * ay.z + bw.z * az.z;
  float skin = smoothstep(0.2, 0.34, orm.g);                         // wet / keratin surfaces carry no scales
  // tension: stretched skin goes taut and smooth, compressed skin buckles
  float stretch = clamp(vStrain * 9.0, 0.0, 1.0); rexComp = clamp(-vStrain * 9.0, 0.0, 1.0) * uWrinkle;
  nr = normalize(mix(nr, n0, stretch * 0.45) + pert * (0.55 * uDetail * skin * (1.0 - 0.5 * stretch)));
  rexN = normalize(mat3(vRot0, vRot1, vRot2) * (nr + vDef));
  rexFold = orm.b;
  alb *= mix(1.0, 0.72 + 0.4 * dh, 0.7 * skin * uDetail);
  rexRough = clamp(orm.g + (0.5 - dh) * 0.16 * skin + 0.1 * rexComp, 0.05, 1.0);
  rexAO = orm.r * (1.0 - 0.3 * rexComp * (1.0 - orm.b));
  rexNipH = 0.0;
  if (uNip > 0.5) {   // areola, nub, tubercles and the hairs lying against the skin, in the frame of the nearest site
    float sz = 0.8 + 0.45 * vNip.w, r = length(vNip.xyz) / sz;
    if (r < 0.11 && vNipQ - vNip.w * vNip.w < 2e-5) {   // (corners belonging to different sites would blend their offsets through zero: the variance of the site number exposes that)
      vec3 a1 = normalize(cross(n0, abs(n0.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0))), a2 = cross(n0, a1); float th = atan(dot(vNip.xyz, a2), dot(vNip.xyz, a1)), seed = vNip.w * 57.0;
      float wob = 1.0 + 0.10 * sin(th * 3.0 + seed) + 0.05 * sin(th * 7.0 + seed * 2.3);
      float are = (1.0 - smoothstep(0.049 * wob, 0.058 * wob, r)) * skin, nub = 1.0 - smoothstep(0.011, 0.026, r), tip = 1.0 - smoothstep(0.0, 0.013, r);
      float ka = floor(th * 9.0 / 6.2832 + 0.5), ta = ka * 6.2832 / 9.0, tr = 0.034 + 0.01 * fract(sin(ka * 12.9 + seed) * 43758.5);
      float tub = (1.0 - smoothstep(0.0, 0.0065, length(vec2(r * cos(th - ta) - tr, r * sin(th - ta))))) * are;
      vec3 areC = mix(vec3(0.30, 0.145, 0.115), vec3(0.19, 0.095, 0.08), fract(seed * 0.37)) * (0.82 + 0.36 * dh);
      alb = mix(alb, alb * vec3(1.16, 0.9, 0.88), (1.0 - smoothstep(0.055, 0.09, r)) * 0.5 * skin);          // flushed skin around it
      alb = mix(alb, areC, are * 0.93); alb = mix(alb, areC * vec3(1.22, 0.95, 0.98), nub * are * 0.85); alb = mix(alb, areC * 1.25, tub * 0.5);
      alb *= 1.0 - 0.35 * (smoothstep(0.02, 0.027, r) - smoothstep(0.027, 0.034, r)) * are;               // crease at the base of the nub
      rexRough = mix(rexRough, 0.46, are * 0.7); rexNipH = sz * (0.011 * nub * are + 0.004 * tip * are + 0.003 * are + 0.0022 * tub);
      float slot = th * 24.0 / 6.2832, hk = floor(slot), h1 = fract(sin(hk * 91.7 + seed) * 43758.5), h2 = fract(sin(hk * 37.3 + seed * 1.7) * 24634.6);
      float lenH = 0.015 + 0.035 * h2, start = 0.042 + 0.012 * h1, across = (fract(slot) - 0.5 - (h1 - 0.5) * 9.0 * (r - start)) * 6.2832 * r / 24.0;
      float hairM = (1.0 - smoothstep(0.0009, 0.0021, abs(across) * sz)) * step(start, r) * (1.0 - smoothstep(start + lenH * 0.7, start + lenH, r)) * step(0.35, h1) * skin * (1.0 - smoothstep(0.09, 0.105, r));
      alb = mix(alb, vec3(0.03, 0.02, 0.015), hairM * 0.85);
    }
  }
  if (uView == 1) { float a = clamp(vAct, 0.0, 1.0); vec3 heat = mix(vec3(0.16, 0.2, 0.3), vec3(0.95, 0.12, 0.04), smoothstep(0.02, 0.75, a)); alb = mix(heat, vec3(1.0, 0.85, 0.3), smoothstep(0.7, 1.0, a)) * (0.6 + 0.5 * dh); rexRough = 0.6; }
  if (uView == 2) { float t = clamp(vStrain * 12.0, -1.0, 1.0); alb = mix(vec3(0.2, 0.22, 0.24), t > 0.0 ? vec3(0.95, 0.25, 0.1) : vec3(0.1, 0.5, 1.0), abs(t)) * (0.6 + 0.5 * dh) + vec3(0.0, 0.5, 0.2) * clamp(vSlide * 25.0, 0.0, 1.0); rexRough = 0.6; }
  return alb;
}`;
