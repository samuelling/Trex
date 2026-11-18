// headless screenshot harness: node tools/shot.mjs <out.png> <path?query> [w h] [waitMs]
import { createRequire } from 'module'; import fs from 'fs'; import path from 'path';
const require = createRequire('/opt/npm-tools/node_modules/'); const { chromium } = require('playwright');
const [out, url, w = 1280, h = 720, wait = 0] = process.argv.slice(2);
const root = path.resolve(new URL('..', import.meta.url).pathname);
const types = { html: 'text/html', js: 'text/javascript', mjs: 'text/javascript', json: 'application/json', bin: 'application/octet-stream', png: 'image/png', css: 'text/css' };
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: +w, height: +h } });
p.on('console', m => { const t = m.text(); if (!/GPU stall|GL Driver Message/.test(t)) console.log('[console]', m.type(), t.slice(0, 600)); });
p.on('pageerror', e => console.log('[pageerror]', e.message, (e.stack || '').split('\n').slice(0, 4).join(' | ')));
await p.route('**/*', r => { const u = new URL(r.request().url()); const f = path.join(root, decodeURIComponent(u.pathname)); if (fs.existsSync(f) && fs.statSync(f).isFile()) r.fulfill({ body: fs.readFileSync(f), contentType: types[f.split('.').pop()] || 'application/octet-stream' }); else r.fulfill({ status: 404, body: 'nf' }); });
await p.goto('http://rex.local/' + url);
await p.waitForFunction('window.__ready===true', null, { timeout: 180000 });
if (+wait) await p.waitForTimeout(+wait);
if (process.env.EVAL) console.log(JSON.stringify(await p.evaluate(process.env.EVAL)));
const outs = out.split(',');
if (outs.length === 1) await p.screenshot({ path: out });
else { // multiple named steps: window.__step(i) must exist
  for (let i = 0; i < outs.length; i++) { await p.evaluate(i => window.__step && window.__step(i), i); await p.screenshot({ path: outs[i] }); }
}
await b.close();
