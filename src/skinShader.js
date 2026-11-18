// Procedural tyrannosaur integument + muscle/soft-tissue deformation, injected into
// three.js' physically based material so lighting, shadows and IBL stay standard.

export const VERT_PARS = /* glsl */`
attribute vec4 aMusIndex; attribute vec4 aMusWeight; attribute vec4 aMusGradA; attribute vec4 aMusGradB;
attribute vec4 aNodeIndex; attribute vec4 aMisc;
uniform float uMus[32]; uniform float uAct[32]; uniform sampler2D uNodeTex; uniform float uBreath;
varying vec3 vRest; varying vec3 vRestN; varying vec4 vMisc; varying vec4 vMat; varying float vAct; varying float vStrain;
vec3 rexDisp;
// displacement of the soft-tissue lattice at rest-space point x (world-space vector)
vec3 nodeField(vec3 x, float s) {
  vec3 acc = vec3(0.0); float G = 0.0;
  for (int i = 0; i < 4; i++) {
    float id = aNodeIndex[i]; if (id > 254.5) continue; int j = int(id + 0.5);
    vec4 pr = texelFetch(uNodeTex, ivec2(j, 1), 0), u = texelFetch(uNodeTex, ivec2(j, 0), 0);
    float g = max(0.0, 1.0 - distance(x, pr.xyz) / pr.w); g = g * g * u.w; acc += g * u.xyz; G += g;
  }
  return G > 1e-5 ? acc * (s * min(1.0, G / 0.2) / G) : vec3(0.0);
}`;

export const VERT_MAIN = /* glsl */`
vRest = position; vRestN = normal; vMisc = aMisc; vStrain = 0.0;
{
  float mid = aMisc.x * 255.0;
  vMat = vec4(float(abs(mid - 1.0) < 0.5), float(abs(mid - 2.0) < 0.5) + float(abs(mid - 5.0) < 0.5), float(abs(mid - 3.0) < 0.5), float(abs(mid - 4.0) < 0.5));
  vec3 t1 = normalize(cross(normal, abs(normal.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0))), t2 = cross(normal, t1);
  float b = 0.0, g1 = 0.0, g2 = 0.0, act = 0.0;
  for (int i = 0; i < 4; i++) { int m = int(aMusIndex[i] + 0.5); float B = uMus[m]; b += aMusWeight[i] * B; g1 += aMusGradA[i] * B; g2 += aMusGradB[i] * B; act += aMusWeight[i] * uAct[m]; }
  float br = uBreath * aMisc.w * smoothstep(0.2, 1.0, position.x) * (1.0 - smoothstep(2.2, 3.0, position.x));
  rexDisp = normal * (0.3 * b + br);
  vec3 nn = normal - (t1 * g1 + t2 * g2) * 5.0;
  #ifdef USE_SKINNING
  float s = aMisc.w;
  if (s > 0.01) {
    mat3 r = mat3(bindMatrixInverse * (skinWeight.x * boneMatX + skinWeight.y * boneMatY + skinWeight.z * boneMatZ + skinWeight.w * boneMatW) * bindMatrix);
    vec3 d0 = nodeField(position, s), l0 = d0 * r, l1 = nodeField(position + t1 * 0.04, s) * r, l2 = nodeField(position + t2 * 0.04, s) * r;
    rexDisp += l0; nn += normalize(cross(t1 * 0.04 + l1 - l0, t2 * 0.04 + l2 - l0)) - normal; vStrain = length(d0);
  }
  #endif
  objectNormal = normalize(nn); vAct = act;
}`;

export const FRAG_PARS = /* glsl */`
varying vec3 vRest; varying vec3 vRestN; varying vec4 vMisc; varying vec4 vMat; varying float vAct; varying float vStrain;
uniform int uView; uniform float uDetail; uniform float uWet;
float rexRough, rexH, rexAO;
float h13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
vec3 h33(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
float vnoise(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h13(i), h13(i + vec3(1, 0, 0)), f.x), mix(h13(i + vec3(0, 1, 0)), h13(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h13(i + vec3(0, 0, 1)), h13(i + vec3(1, 0, 1)), f.x), mix(h13(i + vec3(0, 1, 1)), h13(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + vec3(7.1, 3.3, 5.7); a *= 0.5; } return s; }
vec3 voro(vec3 p) { vec3 i = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0, id = 0.0;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) { vec3 g = vec3(x, y, z), r = g + h33(i + g) - f; float d = dot(r, r); if (d < d1) { d2 = d1; d1 = d; id = h13(i + g + 17.0); } else if (d < d2) d2 = d; }
  return vec3(sqrt(d1), sqrt(d2), id); }
float groove(float n, float w) { return 1.0 - smoothstep(0.0, w, abs(n - 0.5)); }
vec3 rexPerturb(vec3 n, vec3 sp, float h) { vec2 dH = vec2(dFdx(h), dFdy(h)); vec3 sx = dFdx(sp), sy = dFdy(sp), R1 = cross(sy, n), R2 = cross(n, sx);
  float det = dot(sx, R1); return normalize(abs(det) * n - sign(det) * (dH.x * R1 + dH.y * R2)); }
vec3 rexSkin() {
  vec3 p = vRest, n0 = normalize(vRestN);
  float ao = vMisc.y, cav = vMisc.z, soft = vMisc.w, fw = length(fwidth(p));
  float lowMask = smoothstep(1.25, 0.75, p.y);                         // distal limbs / feet
  // basement scales
  float f1 = 58.0, fade1 = (1.0 - smoothstep(0.10, 0.36, fw * f1)) * uDetail;
  vec3 v1 = fade1 > 0.01 ? voro(p * f1 + (fbm(p * 2.5) - 0.5) * 2.0) : vec3(0.3, 0.6, 0.5);
  float s1 = smoothstep(0.02, 0.30, v1.y - v1.x);
  // larger feature scales and scutes (feet, shins, sparse clusters on flank and face)
  float f2 = mix(15.0, 21.0, lowMask), fade2 = 1.0 - smoothstep(0.12, 0.4, fw * f2);
  #ifdef REX_LOW
  vec3 v2 = vec3(0.3, 0.6, 0.5); float s2 = 0.0, m2 = 0.0;
  #else
  vec3 v2 = voro(p * f2 + 3.7); float s2 = smoothstep(0.03, 0.28, v2.y - v2.x);
  float m2 = max(lowMask, smoothstep(0.52, 0.66, fbm(p * 1.7 + 11.0))) * fade2;
  #endif
  // skin folds: dorsoventral creases plus a finer cross-hatched network, deeper where flesh is loose
  #ifdef REX_LOW
  vec3 wq = p + (vec3(vnoise(p * 2.5), vnoise(p * 2.5 + 5.0), vnoise(p * 2.5 + 9.0)) - 0.5) * 0.3;
  #else
  vec3 wq = p + (vec3(fbm(p * 1.9), fbm(p * 1.9 + 5.0), fbm(p * 1.9 + 9.0)) - 0.5) * 0.35;
  #endif
  float fold = groove(vnoise(wq * vec3(6.0, 1.3, 2.6)), 0.075) * (0.3 + 0.7 * soft) * (1.0 - smoothstep(0.02, 0.07, fw));
  float crack = (groove(vnoise(wq * vec3(11.0, 15.0, 13.0)), 0.04) * 0.6 + groove(vnoise(wq * vec3(23.0, 19.0, 27.0) + 4.0), 0.045) * 0.35) * (1.0 - smoothstep(0.006, 0.022, fw));
  float wr = clamp(fold + crack * (0.4 + 0.6 * cav), 0.0, 1.0);
  float lump = (fbm(p * 5.5 + 2.0) - 0.5) * 0.03 * (1.0 - smoothstep(0.03, 0.09, fw)) + (vnoise(p * 1.7 + 8.0) - 0.5) * 0.035 * (0.4 + 0.6 * soft);
  rexH = 0.0022 * (s1 - 0.6) * fade1 + 0.005 * s2 * m2 - 0.010 * fold - 0.005 * crack + lump;
  // colour: countershaded, darker dorsum with broken banding
  float dv = clamp(n0.y * 0.5 + 0.5, 0.0, 1.0);
  float dors = smoothstep(0.22, 0.85, dv * 0.6 + smoothstep(1.6, 3.6, p.y) * 0.45 + (1.0 - smoothstep(1.7, 2.0, p.y)) * 0.34 + (fbm(p * 1.3) - 0.5) * 0.3);
  vec3 cBelly = vec3(0.56, 0.48, 0.35), cFlank = vec3(0.33, 0.265, 0.17), cBack = vec3(0.125, 0.105, 0.075);
  vec3 col = mix(cBelly, cFlank, smoothstep(0.0, 0.45, dors)); col = mix(col, cBack, smoothstep(0.4, 1.0, dors));
  float st = sin(p.x * 4.6 + (fbm(p * vec3(0.7, 1.4, 1.4)) - 0.5) * 8.0 + p.y * 1.3);
  col = mix(col, vec3(0.045, 0.04, 0.03), smoothstep(0.1, 0.7, st) * smoothstep(0.18, 0.6, dors) * 0.75);
  col = mix(col, col * vec3(0.82, 0.95, 0.88), smoothstep(0.4, 0.75, fbm(p * 0.9 + 20.0)) * 0.5);
  col *= 0.8 + 0.4 * fbm(p * 4.3);
  float face = smoothstep(3.75, 4.1, p.x);
  col = mix(col, col * vec3(1.25, 0.92, 0.78), face * smoothstep(0.35, 0.8, fbm(p * 5.0 + 2.0)) * 0.7);
  col *= 0.92 + 0.16 * v1.z * fade1; col *= mix(1.0, 0.78, (1.0 - s1) * fade1); col *= mix(1.0, 1.12, s2 * m2);
  col *= 1.0 - 0.4 * wr;
  rexRough = 0.74 - 0.10 * s1 * fade1 - 0.08 * s2 * m2 + 0.12 * wr;
  // dust and dried mud on the feet and shins
  float dust = smoothstep(1.0, 0.05, p.y) * (0.3 + 0.6 * fbm(p * 5.0 + 1.0));
  col = mix(col, vec3(0.25, 0.21, 0.155), dust * 0.6); rexRough = mix(rexRough, 0.92, dust * 0.7);
  // keratin (claws), foot pads, oral tissue, orbit / naris
  float tipg = fbm(p * vec3(30.0, 30.0, 30.0));
  col = mix(col, mix(vec3(0.035, 0.03, 0.025), vec3(0.22, 0.19, 0.15), tipg * 0.5 + 0.5 * smoothstep(0.1, 0.0, p.y) * 0.3), vMat.x);
  rexRough = mix(rexRough, 0.42, vMat.x); rexH *= 1.0 - vMat.x * 0.8;
  col = mix(col, vec3(0.16, 0.14, 0.12) * (0.7 + 0.6 * v2.z), vMat.z * 0.8);
  vec3 oral = mix(vec3(0.42, 0.12, 0.11), vec3(0.55, 0.22, 0.20), fbm(p * 14.0));
  col = mix(col, oral, clamp(vMat.y, 0.0, 1.0)); rexRough = mix(rexRough, 0.42, clamp(vMat.y, 0.0, 1.0)); rexH *= 1.0 - clamp(vMat.y, 0.0, 1.0) * 0.7;
  col = mix(col, vec3(0.018, 0.014, 0.012), vMat.w); rexRough = mix(rexRough, 0.5, vMat.w);
  rexRough = max(rexRough, 0.58 * (1.0 - clamp(vMat.x + vMat.y, 0.0, 1.0)));
  rexRough = mix(rexRough, 0.3, uWet * (1.0 - dust));
  rexAO = ao * (1.0 - 0.3 * cav);
  if (uView == 1) { float a = clamp(vAct, 0.0, 1.0); vec3 heat = mix(vec3(0.16, 0.2, 0.3), vec3(0.95, 0.12, 0.04), smoothstep(0.02, 0.75, a)); heat = mix(heat, vec3(1.0, 0.85, 0.3), smoothstep(0.7, 1.0, a)); col = heat * (0.75 + 0.25 * s1); rexRough = 0.6; }
  if (uView == 2) { float a = clamp(vStrain / 0.06, 0.0, 1.0); col = mix(vec3(0.14, 0.17, 0.2), vec3(0.1, 0.75, 0.95), smoothstep(0.0, 0.5, a)); col = mix(col, vec3(1.0, 0.3, 0.75), smoothstep(0.5, 1.0, a)); rexRough = 0.6; }
  return col;
}`;
