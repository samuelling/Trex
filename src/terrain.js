// Ground relief shared by the renderer and the gait (feet land on it, the body rides over it).
const R = 38;
const hsh = (x, y) => { let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const vn = (x, y) => { const ix = Math.floor(x), iy = Math.floor(y); let fx = x - ix, fy = y - iy; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); const a = hsh(ix, iy), b = hsh(ix + 1, iy), c = hsh(ix, iy + 1), d = hsh(ix + 1, iy + 1); return a + (b - a) * fx + (c - a + (a - b - c + d) * fx) * fy; };
const fbm = (x, y) => vn(x, y) * 0.5 + vn(x * 2.03 + 11.3, y * 2.03 + 4.1) * 0.25 + vn(x * 4.1 + 3.7, y * 4.1 + 9.2) * 0.125 + vn(x * 8.3 + 1.1, y * 8.3 + 6.6) * 0.0625;
const sst = (a, b, x) => { let t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
export const WATER_Y = -0.05, PATH_R = R;
export function groundHeight(x, z) {
  const d = Math.abs(Math.hypot(x, z) - R), edge = sst(17, 11, d); if (edge <= 0) return 0;
  const off = 0.18 + 0.82 * sst(1.5, 6, d);                                   // the trail itself is worn nearly flat
  let h = (fbm(x * 0.105, z * 0.105) - 0.47) * 0.36 * off + (fbm(x * 0.62 + 7, z * 0.62) - 0.47) * 0.055 * off;
  h -= 0.105 * sst(0.6, 0.74, vn(x * 0.115 + 40, z * 0.115)) * sst(2.4, 4.8, d) * sst(13, 8.5, d);   // hollows that hold water, beside the trail
  h -= 0.018 * sst(2.6, 0.4, d);
  return h * edge;
}
