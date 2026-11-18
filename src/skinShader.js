// Skin shading and deformation, injected into three.js' physically based material.
// Vertex stage: muscle bulge, soft-tissue lattice and the simulated skin sheet displace the surface
// before skeletal skinning, and the deformed normal is rebuilt from the derivative of that displacement.
// Fragment stage: baked albedo / object-space normal / occlusion-roughness maps, tiling micro-scales
// projected triplanar in rest space, and wrinkles that deepen where the skin sheet is compressed.

export const VERT_PARS = /* glsl */`
attribute vec2 aUv;
attribute vec4 aMusIndex; attribute vec4 aMusWeight; attribute vec4 aMusGradA; attribute vec4 aMusGradB;
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
vRest = position; vRestN = normal; vTex = aUv; vStrain = 0.0; vSlide = 0.0;
{
  vec3 t1 = normalize(cross(normal, abs(normal.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0))), t2 = cross(normal, t1);
  float b = 0.0, g1 = 0.0, g2 = 0.0, act = 0.0;
  for (int i = 0; i < 4; i++) { int m = int(aMusIndex[i] + 0.5); float B = uMus[m]; b += aMusWeight[i] * B; g1 += aMusGradA[i] * B; g2 += aMusGradB[i] * B; act += aMusWeight[i] * uAct[m]; }
  float br = uBreath * aMisc.w * smoothstep(0.2, 1.0, position.x) * (1.0 - smoothstep(2.2, 3.0, position.x));
  rexDisp = normal * (0.3 * b + br);
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
varying vec3 vRest; varying vec3 vRestN; varying vec2 vTex; varying vec3 vRot0; varying vec3 vRot1; varying vec3 vRot2; varying vec3 vDef; varying float vAct; varying float vStrain; varying float vSlide;
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
  if (uView == 1) { float a = clamp(vAct, 0.0, 1.0); vec3 heat = mix(vec3(0.16, 0.2, 0.3), vec3(0.95, 0.12, 0.04), smoothstep(0.02, 0.75, a)); alb = mix(heat, vec3(1.0, 0.85, 0.3), smoothstep(0.7, 1.0, a)) * (0.6 + 0.5 * dh); rexRough = 0.6; }
  if (uView == 2) { float t = clamp(vStrain * 12.0, -1.0, 1.0); alb = mix(vec3(0.2, 0.22, 0.24), t > 0.0 ? vec3(0.95, 0.25, 0.1) : vec3(0.1, 0.5, 1.0), abs(t)) * (0.6 + 0.5 * dh) + vec3(0.0, 0.5, 0.2) * clamp(vSlide * 25.0, 0.0, 1.0); rexRough = 0.6; }
  return alb;
}`;
