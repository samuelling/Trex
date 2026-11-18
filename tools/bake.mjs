// Texture bake. Each atlas texel is mapped back to its point on the resting body, and the skin
// look-development functions are evaluated there in 3D. Outputs:
//   <prefix>-albedo.webp   base colour (sRGB)
//   <prefix>-normal.webp   object-space normal of the resting body, with all relief folded in
//   <prefix>-orm.webp      R occlusion x cavity, G roughness, B fold height (drives tension wrinkles)
import { createRequire } from 'module';
import { height, shade, macro, R as HR } from './skinfield.mjs';
import { hash3 } from './noise.mjs';

async function loadSharp() { try { return (await import('sharp')).default; } catch { return createRequire('/opt/npm-tools/node_modules/')('sharp'); } }
const lin2srgb = v => { v = v < 0 ? 0 : v > 1 ? 1 : v; return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; };

export async function bake({ prefix, res, pos0, nrm0, look, K, FIELDS, xref, uv, tri, eps, log }) {
  const sharp = await loadSharp(), N = res * res, owner = new Int32Array(N).fill(-1);
  // rasterise the atlas: which triangle owns each texel
  for (let t = 0; t < tri.length; t += 3) {
    const a = tri[t], b = tri[t + 1], c = tri[t + 2], ax = uv[2 * a] * res, ay = uv[2 * a + 1] * res, bx = uv[2 * b] * res, by = uv[2 * b + 1] * res, cx = uv[2 * c] * res, cy = uv[2 * c + 1] * res;
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy); if (Math.abs(den) < 1e-9) continue;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx) - 1)), x1 = Math.min(res - 1, Math.ceil(Math.max(ax, bx, cx) + 1)), y0 = Math.max(0, Math.floor(Math.min(ay, by, cy) - 1)), y1 = Math.min(res - 1, Math.ceil(Math.max(ay, by, cy) + 1));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5, w0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / den, w1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / den, w2 = 1 - w0 - w1, m = Math.min(w0, w1, w2);
      if (m >= 0) owner[y * res + x] = t; else if (m > -0.35 && owner[y * res + x] < 0) owner[y * res + x] = -2 - t;   // near miss: provisional, keeps seams watertight
    }
  }
  const alb = new Uint8Array(N * 3), nor = new Uint8Array(N * 3), orm = new Uint8Array(N * 3), mask = new Uint8Array(N); const hgt = process.env.HEIGHT_OUT ? new Float32Array(N) : null;
  const S = {}, S1 = {}, out = {}; let cnt = 0; const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    let t = owner[i]; if (t === -1) continue; if (t < -1) t = -2 - t;
    const a = tri[t], b = tri[t + 1], c = tri[t + 2], x = (i % res) + 0.5, y = Math.floor(i / res) + 0.5;
    const ax = uv[2 * a] * res, ay = uv[2 * a + 1] * res, bx = uv[2 * b] * res, by = uv[2 * b + 1] * res, cx = uv[2 * c] * res, cy = uv[2 * c + 1] * res, den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    let w0 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / den, w1 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / den; let w2 = 1 - w0 - w1;
    if (w0 < 0 || w1 < 0 || w2 < 0) { w0 = Math.max(0, w0); w1 = Math.max(0, w1); w2 = Math.max(0, w2); const s = w0 + w1 + w2; w0 /= s; w1 /= s; w2 /= s; }
    const A = xref[a], B = xref[b], C = xref[c];
    for (let k = 0; k < K; k++) S[FIELDS[k]] = w0 * look[A * K + k] + w1 * look[B * K + k] + w2 * look[C * K + k];
    S.x = w0 * pos0[3 * A] + w1 * pos0[3 * B] + w2 * pos0[3 * C]; S.y = w0 * pos0[3 * A + 1] + w1 * pos0[3 * B + 1] + w2 * pos0[3 * C + 1]; S.z = w0 * pos0[3 * A + 2] + w1 * pos0[3 * B + 2] + w2 * pos0[3 * C + 2];
    let nx = w0 * nrm0[3 * A] + w1 * nrm0[3 * B] + w2 * nrm0[3 * C], ny = w0 * nrm0[3 * A + 1] + w1 * nrm0[3 * B + 1] + w2 * nrm0[3 * C + 1], nz = w0 * nrm0[3 * A + 2] + w1 * nrm0[3 * B + 2] + w2 * nrm0[3 * C + 2];
    let l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l; S.nx = nx; S.ny = ny; S.nz = nz;
    l = Math.hypot(S.dx, S.dy, S.dz) || 1; S.dx /= l; S.dy /= l; S.dz /= l;
    // two tangents; relief gradient by finite differences in 3D
    let t1x, t1y, t1z; if (Math.abs(ny) < 0.9) { t1x = -nz; t1y = 0; t1z = nx; } else { t1x = 0; t1y = nz; t1z = -ny; } l = Math.hypot(t1x, t1y, t1z); t1x /= l; t1y /= l; t1z /= l;
    const t2x = ny * t1z - nz * t1y, t2y = nz * t1x - nx * t1z, t2z = nx * t1y - ny * t1x;
    Object.assign(S1, S); S1.x = S.x + eps * t1x; S1.y = S.y + eps * t1y; S1.z = S.z + eps * t1z; S1.a = S.a + eps * (t1x * S.dx + t1y * S.dy + t1z * S.dz); const h1 = height(S1);
    S1.x = S.x + eps * t2x; S1.y = S.y + eps * t2y; S1.z = S.z + eps * t2z; S1.a = S.a + eps * (t2x * S.dx + t2y * S.dy + t2z * S.dz); const h2 = height(S1);
    const h0 = height(S); shade(S, out);
    const g1 = (h1 - h0) / eps, g2 = (h2 - h0) / eps; let mx = nx - t1x * g1 - t2x * g2, my = ny - t1y * g1 - t2y * g2, mz = nz - t1z * g1 - t2z * g2; l = Math.hypot(mx, my, mz) || 1;
    const o = 3 * i; nor[o] = Math.round(127.5 + 127.5 * mx / l); nor[o + 1] = Math.round(127.5 + 127.5 * my / l); nor[o + 2] = Math.round(127.5 + 127.5 * mz / l);
    alb[o] = Math.round(255 * lin2srgb(out.r)); alb[o + 1] = Math.round(255 * lin2srgb(out.g)); alb[o + 2] = Math.round(255 * lin2srgb(out.b));
    orm[o] = Math.round(255 * Math.min(1, S.ao * (0.35 + 0.65 * out.cav))); orm[o + 1] = Math.round(255 * out.rough); orm[o + 2] = Math.round(255 * out.fold);
    if (hgt) hgt[i] = h0 - macro(S);
    mask[i] = 1; cnt++;
  }
  log(`baked ${cnt} texels (${(100 * cnt / N).toFixed(0)}% of atlas) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  // dilate chart borders so filtering and mip-mapping never pull in empty texels
  let front = mask.slice();
  if (hgt) { let f2 = mask.slice(); for (let pass = 0; pass < 12; pass++) { const nx = f2.slice(); for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) { const i = y * res + x; if (f2[i]) continue; let n = 0, a = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= res || yy >= res) continue; const j = yy * res + xx; if (f2[j]) { n++; a += hgt[j]; } } if (n) { hgt[i] = a / n; nx[i] = 1; } } f2 = nx; }
    // fine relief only (what is not already in the geometry), metres: 16-bit, 0.5 = zero, full scale = 40 mm. For offline rendering.
    const u16 = new Uint16Array(N); let lo = 1e9, hi = -1e9; for (let i = 0; i < N; i++) { const h = hgt[i]; if (mask[i]) { if (h < lo) lo = h; if (h > hi) hi = h; } u16[i] = Math.round(65535 * Math.min(1, Math.max(0, 0.5 + h / 0.04))); }
    await sharp(Buffer.from(u16.buffer), { raw: { width: res, height: res, channels: 1, depth: 'ushort' } }).toColourspace('grey16').png({ compressionLevel: 6 }).toFile(process.env.HEIGHT_OUT); log('height map', (lo * 1000).toFixed(2), 'to', (hi * 1000).toFixed(2), 'mm'); }
  for (let pass = 0; pass < 12; pass++) {
    const next = front.slice();
    for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) { const i = y * res + x; if (front[i]) continue; let n = 0, r = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= res || yy >= res) continue; const j = yy * res + xx; if (!front[j]) continue; n++; for (let c = 0; c < 3; c++) { r[c] += alb[3 * j + c]; r[3 + c] += nor[3 * j + c]; r[6 + c] += orm[3 * j + c]; } }
      if (n) { for (let c = 0; c < 3; c++) { alb[3 * i + c] = r[c] / n; nor[3 * i + c] = r[3 + c] / n; orm[3 * i + c] = r[6 + c] / n; } next[i] = 1; } }
    front = next;
  }
  let m = [0, 0, 0], k = 0; for (let i = 0; i < N; i += 97) if (mask[i]) { m[0] += alb[3 * i]; m[1] += alb[3 * i + 1]; m[2] += alb[3 * i + 2]; k++; }
  for (let i = 0; i < N; i++) if (!front[i]) { alb[3 * i] = m[0] / k; alb[3 * i + 1] = m[1] / k; alb[3 * i + 2] = m[2] / k; nor[3 * i] = 128; nor[3 * i + 1] = 255; nor[3 * i + 2] = 128; orm[3 * i] = 255; orm[3 * i + 1] = 180; orm[3 * i + 2] = 128; }
  const raw = { raw: { width: res, height: res, channels: 3 } }, sizes = {};
  for (const [name, buf, q] of [['albedo', alb, 88], ['normal', nor, 93], ['orm', orm, 86]]) { const f = `${prefix}-${name}.webp`, info = await sharp(Buffer.from(buf.buffer), raw).webp({ quality: q, effort: 5, smartSubsample: false }).toFile(f); sizes[name] = info.size; }
  log('textures', Object.entries(sizes).map(([k, v]) => `${k} ${(v / 1e6).toFixed(1)}MB`).join(', '));
}

// Tiling micro-detail: pebbly basement scales. RG = tangent-space slope, B = height. One tile spans 0.24 m.
export async function bakeDetail(prefix, size, log) {
  const sharp = await loadSharp(), Nc = 34, H = new Float32Array(size * size), wrap = (i, n) => ((i % n) + n) % n;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let h = 0;
    for (const [n, amp, seed] of [[Nc, 1, 0], [Nc * 3, 0.28, 77]]) {
      const u = x / size * n, v = y / size * n, iu = Math.floor(u), iv = Math.floor(v); let d1 = 9, d2 = 9, id = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const hh = hash3(wrap(iu + i, n) + seed, wrap(iv + j, n), 5), rx = i + (hh & 1023) / 1023 - (u - iu), ry = j + ((hh >>> 10) & 1023) / 1023 - (v - iv), d = rx * rx + ry * ry; if (d < d1) { d2 = d1; d1 = d; id = hh; } else if (d < d2) d2 = d; }
      const e = Math.sqrt(d2) - Math.sqrt(d1), t = Math.min(1, e / 0.34), dome = t * t * (3 - 2 * t); h += amp * dome * (0.6 + 0.4 * ((id >>> 20) & 255) / 255);
    }
    H[y * size + x] = h;
  }
  const px = new Uint8Array(size * size * 3), k = 0.9;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const i = y * size + x, dx = H[y * size + wrap(x + 1, size)] - H[y * size + wrap(x - 1, size)], dy = H[wrap(y + 1, size) * size + x] - H[wrap(y - 1, size) * size + x];
    px[3 * i] = Math.max(0, Math.min(255, 127.5 - 127.5 * k * dx * 4)); px[3 * i + 1] = Math.max(0, Math.min(255, 127.5 - 127.5 * k * dy * 4)); px[3 * i + 2] = Math.min(255, 255 * H[i] / 1.28); }
  const info = await sharp(Buffer.from(px.buffer), { raw: { width: size, height: size, channels: 3 } }).webp({ quality: 90 }).toFile(prefix + '.webp'); log('detail tile', (info.size / 1e6).toFixed(2) + 'MB');
}
