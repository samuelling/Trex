// deterministic integer-hash noise used by the texture bake
export function hash3(ix, iy, iz) { let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(iz, 1440662683); h = Math.imul(h ^ (h >>> 13), 1274126177); return (h ^ (h >>> 16)) >>> 0; }
export const h01 = (ix, iy, iz) => hash3(ix, iy, iz) / 4294967296;
export function vnoise(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z); let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const a = h01(ix, iy, iz), b = h01(ix + 1, iy, iz), c = h01(ix, iy + 1, iz), d = h01(ix + 1, iy + 1, iz), e = h01(ix, iy, iz + 1), f = h01(ix + 1, iy, iz + 1), g = h01(ix, iy + 1, iz + 1), h = h01(ix + 1, iy + 1, iz + 1);
  const x0 = a + (b - a) * fx, x1 = c + (d - c) * fx, x2 = e + (f - e) * fx, x3 = g + (h - g) * fx, y0 = x0 + (x1 - x0) * fy, y1 = x2 + (x3 - x2) * fy; return y0 + (y1 - y0) * fz;
}
export function fbm(x, y, z, oct = 4) { let a = 0.5, s = 0; for (let i = 0; i < oct; i++) { s += a * vnoise(x, y, z); x = x * 2.03 + 7.1; y = y * 2.03 + 3.3; z = z * 2.03 + 5.7; a *= 0.5; } return s; }
// worley noise: returns F1, F2 and the nearest cell's hash in V
export const V = { f1: 0, f2: 0, id: 0, cx: 0, cy: 0, cz: 0 };
export function voro(x, y, z, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz; let d1 = 9, d2 = 9, id = 0, cx = 0, cy = 0, cz = 0;
  for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const h = hash3(ix + i + seed, iy + j, iz + k), rx = i + (h & 1023) / 1023 - fx, ry = j + ((h >>> 10) & 1023) / 1023 - fy, rz = k + ((h >>> 20) & 1023) / 1023 - fz, d = rx * rx + ry * ry + rz * rz;
    if (d < d1) { d2 = d1; d1 = d; id = h; cx = rx; cy = ry; cz = rz; } else if (d < d2) d2 = d;
  }
  V.f1 = Math.sqrt(d1); V.f2 = Math.sqrt(d2); V.id = (Math.imul(id, 2654435761) >>> 0) / 4294967296; V.cx = cx; V.cy = cy; V.cz = cz; return V;
}
export const sst = (a, b, x) => { let t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
export const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
