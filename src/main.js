import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Rex } from './rex.js';
import { Locomotion } from './gait.js';
import { Body } from './dynamics.js';
import { World } from './world.js';
import { Sound } from './sound.js';
import { DofPass } from './dof.js';

const $ = id => document.getElementById(id), Q = new URLSearchParams(location.search);
const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && Math.min(innerWidth, innerHeight) < 820);
const quality = Q.get('q') || localStorage.getItem('rexQ') || (mobile ? 'low' : 'high');
const lod = Q.get('lod') || (quality === 'high' ? 'hi' : 'lo');
$('aQ').value = quality;

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: Q.has('shot') });
const DPR = Math.min(devicePixelRatio || 1, quality === 'high' ? 2 : quality === 'med' ? 1.75 : 1.5);
renderer.setPixelRatio(DPR); renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.5;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(36, innerWidth / innerHeight, 0.15, 1500);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.08; controls.minDistance = 1.6; controls.maxDistance = 60; controls.maxPolarAngle = Math.PI * 0.497; controls.enablePan = false; controls.zoomSpeed = 0.8;

let rex; try { rex = await Rex.load(lod, f => { $('lp').style.width = (f * 90).toFixed(0) + '%'; }); } catch (e) { $('lt').textContent = 'Could not load: ' + e.message + ' (needs a current browser with WebGL 2)'; throw e; }
$('lt').textContent = 'compiling shaders…';
rex.setQuality(1);
scene.add(rex.group);
const loco = new Locomotion(rex), body = new Body(rex, loco), world = new World(scene, renderer, { pathR: loco.R, low: quality === 'low', sunElev: +(Q.get('sun') || 19), sunAz: +(Q.get('az') || 20) });
const sound = new Sound();
loco.target = Q.has('speed') ? +Q.get('speed') : 1.3;

// ---- post ----
const size = new THREE.Vector2(); renderer.getDrawingBufferSize(size);
const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: quality === 'high' ? 4 : quality === 'med' ? 2 : 0 });
if (quality !== 'low') { rt.depthTexture = new THREE.DepthTexture(size.x, size.y); rt.depthTexture.type = THREE.UnsignedIntType; }
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const dof = quality !== 'low' ? new DofPass(camera) : null; if (dof) { dof.aperture = Q.has('dof') ? +Q.get('dof') : 1; composer.addPass(dof); }
if (quality !== 'low') composer.addPass(new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.16, 0.7, 0.9));
const grade = new ShaderPass({ uniforms: { tDiffuse: { value: null }, uT: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uT; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + uT) * 43758.5453); }
    void main(){ vec4 c = texture2D(tDiffuse, vUv); vec2 d = vUv - 0.5; float v = 1.0 - dot(d, d) * 0.85; c.rgb *= v * v;
      c.rgb = mix(c.rgb, c.rgb * vec3(1.04, 1.0, 0.94), 0.6); c.rgb *= 1.0 + (h(gl_FragCoord.xy) - 0.5) * 0.06; gl_FragColor = c; }` });
composer.addPass(grade); composer.addPass(new OutputPass());

// ---- force vectors ----
const forces = new THREE.Group(); forces.visible = Q.has('forces'); scene.add(forces);
const arrows = loco.feet.map(() => { const a = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 1, 0xffc04d, 0.35, 0.2); a.line.material.depthTest = a.cone.material.depthTest = false; a.renderOrder = a.line.renderOrder = a.cone.renderOrder = 10; forces.add(a); return a; });
const comDot = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), new THREE.MeshBasicMaterial({ color: 0x66e0ff, depthTest: false })); comDot.renderOrder = 10; forces.add(comDot);
const trailN = 240, trailPos = new Float32Array(trailN * 3), trail = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(trailPos, 3)), new THREE.LineBasicMaterial({ color: 0x66e0ff, depthTest: false, transparent: true, opacity: 0.8 })); trail.frustumCulled = false; trail.renderOrder = 10; forces.add(trail); let trailInit = false;

// ---- events from the gait ----
loco.onFootfall = (ft, p) => {
  const mir = ft.s; world.addPrint(ft.Mw.clone().addScaledVector(ft.fwd, 0.22), ft.yaw, mir);
  const k = Math.min(1.5, 0.35 + p.Fr * 1.2); world.puff(ft.Mw, ft.fwd, k);
  sound.thump(Math.min(1, 0.45 + p.Fr), camera.position.distanceTo(ft.Mw));
  shake = Math.min(1, shake + 0.25 + 0.5 * k) * Math.min(1, 9 / camera.position.distanceTo(ft.Mw));
};
let shake = 0;

// ---- cameras ----
const CAMS = [
  { name: 'Three-quarter', off: [9.5, 1.5, 6.5], tgt: [1.4, 2.5, 0] },
  { name: 'Side', off: [0.6, 2.0, 14.5], tgt: [-0.4, 2.3, 0] },
  { name: 'Low front', off: [8.2, 0.45, 2.6], tgt: [2.4, 2.9, 0] },
  { name: 'Legs', off: [2.2, 1.0, 6.2], tgt: [0.3, 1.5, 0] },
  { name: 'Head', off: [6.6, 3.6, 2.6], tgt: [4.3, 3.75, 0] },
  { name: 'Rear', off: [-10, 2.6, 4.2], tgt: [-1.5, 2.4, 0] },
  { name: 'Tripod', tripod: true },
];
let camI = Math.max(0, CAMS.findIndex(c => c.name.toLowerCase().startsWith((Q.get('cam') || 'three').toLowerCase())));
const tgtW = new THREE.Vector3(), tmp = new THREE.Vector3(), prevTgt = new THREE.Vector3(); let camInit = false;
const local = (v, out) => out.copy(loco.O).addScaledVector(loco.heading, v[0]).addScaledVector(loco.right, v[2]).setY(v[1]);
function setCam(i) {
  camI = (i + CAMS.length) % CAMS.length; const c = CAMS[camI]; $('bCam').textContent = 'Camera: ' + c.name;
  if (c.tripod) { placeTripod(); return; }
  // pull back on narrow (portrait) screens so the animal still fits
  const k = Math.max(1, Math.min(2.3, 1.25 / camera.aspect)), o = [c.tgt[0] + (c.off[0] - c.tgt[0]) * k, c.tgt[1] + (c.off[1] - c.tgt[1]) * (0.6 + 0.4 * k), c.tgt[2] + (c.off[2] - c.tgt[2]) * k];
  local(c.tgt, tgtW); controls.target.copy(tgtW); local(o, camera.position); prevTgt.copy(tgtW); controls.enabled = true; controls.update();
}
function placeTripod() { // fixed camera beside the path, a little ahead of the animal
  const a = (loco.S + 13) / loco.R, r = loco.R - 9.5; camera.position.set(r * Math.sin(a), 1.15, -r * Math.cos(a)); controls.enabled = false;
}

// ---- UI ----
const state = { timeScale: 1, view: 0 };
const VIEWS = ['Skin', 'Muscle activation', 'Skin strain'];
const spd = $('spd'); spd.value = loco.target;
const showSpd = () => { $('spdO').textContent = (+spd.value).toFixed(2) + ' m/s'; };
spd.oninput = () => { loco.target = +spd.value; showSpd(); }; showSpd();
$('bCam').onclick = () => setCam(camI + 1);
$('bView').onclick = () => { state.view = (state.view + 1) % 3; rex.uniforms.uView.value = state.view; $('bView').textContent = 'View: ' + VIEWS[state.view]; $('bView').classList.toggle('on', state.view > 0); };
$('bForce').onclick = () => { forces.visible = !forces.visible; $('bForce').classList.toggle('on', forces.visible); };
$('bSlow').onclick = () => { state.timeScale = state.timeScale === 1 ? 0.25 : 1; $('bSlow').classList.toggle('on', state.timeScale !== 1); };
$('bRoar').onclick = () => { body.roar(); sound.roar(); };
$('bSound').onclick = () => { const on = sound.toggle(); $('bSound').classList.toggle('on', on); };
$('bAdv').onclick = () => { $('adv').classList.toggle('open'); $('bAdv').classList.toggle('on'); };
$('hudToggle').onclick = () => { const m = $('hud').classList.toggle('min'); $('hudToggle').textContent = m ? '+' : '–'; };
if (innerHeight < 620 || innerWidth < 560) $('hudToggle').onclick();
const bind = (id, fmt, fn) => { const e = $(id), o = $(id + 'O'); const f = () => { o.textContent = fmt(+e.value); fn(+e.value); }; e.oninput = f; };
bind('aMus', v => v.toFixed(1) + '×', v => { body.musGain = v; });
bind('aFlesh', v => v.toFixed(1) + '×', v => { body.fleshGain = v; });
bind('aLoose', v => v.toFixed(1) + '×', v => { rex.skin.setLooseness(v); });
bind('aTail', v => v.toFixed(2) + ' Hz', v => { body.tailFv = v; });
let sunT = 0; const sun = () => { clearTimeout(sunT); sunT = setTimeout(() => world.setSun(+$('aSun').value, +$('aAz').value), 60); };
bind('aSun', v => v + '°', sun); bind('aAz', v => v + '°', sun);
bind('aDof', v => v.toFixed(1), v => { if (dof) dof.aperture = v; });
$('aSun').value = world.elev; $('aSunO').textContent = world.elev + '°'; $('aAz').value = world.az; $('aAzO').textContent = world.az + '°';
$('aQ').onchange = e => { localStorage.setItem('rexQ', e.target.value); const u = new URL(location.href); u.searchParams.delete('q'); location.href = u; };
if (forces.visible) $('bForce').classList.add('on');
if (Q.has('view')) { state.view = +Q.get('view'); rex.uniforms.uView.value = state.view; $('bView').textContent = 'View: ' + VIEWS[state.view]; }
if (Q.get('ui') === '0') { $('hud').style.display = $('ctl').style.display = $('load').style.display = 'none'; }
if (Q.has('mus')) body.musGain = +Q.get('mus'); if (Q.has('flesh')) body.fleshGain = +Q.get('flesh');
addEventListener('keydown', e => { if (e.key === 'c') setCam(camI + 1); if (e.key === 'r') $('bRoar').click(); if (e.key === ' ') $('bSlow').click(); if (e.key === 'ArrowUp') { spd.value = +spd.value + 0.25; spd.oninput(); } if (e.key === 'ArrowDown') { spd.value = +spd.value - 0.25; spd.oninput(); } });

const BAR = [['caudofemoralis', 'cfl'], ['knee extensors', 'kneeExt'], ['hamstrings', 'hamstring'], ['hip flexors', 'hipFlex'], ['gastrocnemius', 'gastroc'], ['tibialis cran.', 'tibCran']];
$('bars').innerHTML = '<span></span><span style="text-align:center">L</span><span style="text-align:center">R</span>' + BAR.map(([n, k]) => `<span>${n}</span><div class="bar"><i id="m_${k}_L"></i></div><div class="bar"><i id="m_${k}_R"></i></div>`).join('');
const barEl = BAR.flatMap(([, k]) => ['L', 'R'].map(S => ({ el: $(`m_${k}_${S}`), i: rex.musIdx[k + '_' + S] })));
let hudT = 0;
function hud(dt) {
  hudT -= dt; for (const b of barEl) b.el.style.width = (100 * Math.min(1, body.act[b.i])).toFixed(0) + '%';
  if (hudT > 0) return; hudT = 0.12;
  const p = loco.p, v = loco.speed, moving = v > 0.05;
  $('hSpeed').textContent = `${v.toFixed(2)} m/s · ${(v * 3.6).toFixed(1)} km/h`;
  $('hFr').textContent = moving ? (v * v / (9.81 * loco.legLen)).toFixed(3) : '0';
  $('hGait').textContent = !moving ? 'standing' : p.run > 0.5 ? 'grounded run' : p.Fr > 0.25 ? 'fast walk' : 'walk';
  $('hStride').textContent = moving ? `${p.lambda.toFixed(2)} m · ${(1 / p.T).toFixed(2)} Hz` : '–';
  $('hStep').textContent = moving ? `${(2 / p.T).toFixed(2)} / ${body.tailFv.toFixed(2)} Hz` : '–';
  $('hDuty').textContent = moving ? p.beta.toFixed(2) : '–';
  let pk = 0; for (let i = 0; i <= 20; i++) pk = Math.max(pk, loco.Fy(i / 20)); $('hGrf').textContent = moving ? `${pk.toFixed(2)} BW · ${(pk * loco.mass * 9.81 / 1000).toFixed(0)} kN` : '0.50 BW · 41 kN';
  $('hHip').textContent = loco.pos.y.toFixed(2) + ' m';
}

// ---- simulation step ----
function step(dt) {
  loco.update(dt); body.camPos = camera.position; body.update(dt); world.update(dt, renderer.domElement.height * 0.5 / Math.tan(camera.fov * Math.PI / 360) * 0.6);
  // force vectors
  if (forces.visible) {
    loco.feet.forEach((ft, i) => { const a = arrows[i], L = ft.F.length() / (loco.mass * 9.81) * 2.2; a.visible = L > 0.03; if (a.visible) { a.position.copy(ft.cop).setY(0.03); a.setDirection(tmp.copy(ft.F).normalize()); a.setLength(L, 0.3, 0.16); } });
    comDot.position.copy(loco.com);
    if (!trailInit) { for (let i = 0; i < trailN; i++) trailPos.set([loco.com.x, loco.com.y, loco.com.z], 3 * i); trailInit = true; }
    trailPos.copyWithin(0, 3); trailPos.set([loco.com.x, loco.com.y, loco.com.z], 3 * (trailN - 1)); trail.geometry.attributes.position.needsUpdate = true;
  }
}
function frameCamera(dt) {
  const c = CAMS[camI]; local([1.2, 2.5, 0], tgtW);
  if (c.tripod) {
    if (camera.position.distanceTo(tgtW) > 34 && tmp.copy(camera.position).sub(tgtW).dot(loco.heading) < 0) placeTripod();
    tmp.set(0.6, 2.2, 0); local(tmp.toArray(), tgtW); camera.lookAt(tgtW); camera.fov = 30; camera.updateProjectionMatrix(); return;
  }
  if (camera.fov !== 36) { camera.fov = 36; camera.updateProjectionMatrix(); }
  local(c.tgt, tgtW); tgtW.y = c.tgt[1];
  // rotate the camera offset with the animal's heading so it stays in the same relative view
  if (camInit) { const dA = headingAngle() - prevHeading; tmp.copy(camera.position).sub(controls.target).applyAxisAngle(THREE.Object3D.DEFAULT_UP, dA); camera.position.copy(tgtW).add(tmp); } else camInit = true;
  prevHeading = headingAngle(); controls.target.copy(tgtW); controls.update();
  if (shake > 0.001) { camera.position.y += (Math.random() - 0.5) * 0.02 * shake; shake *= Math.exp(-dt * 9); }
}
const headingAngle = () => Math.atan2(-loco.heading.z, loco.heading.x); let prevHeading = 0;

function resize() {
  renderer.setSize(innerWidth, innerHeight); renderer.getDrawingBufferSize(size); composer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); addEventListener('orientationchange', () => setTimeout(resize, 200));

// settle the simulation before the first frame so the tail and flesh start in a steady state
step(1 / 60); for (let i = 0; i < (Q.has('t') ? +Q.get('t') * 60 : 90); i++) step(1 / 60);
setCam(camI); prevHeading = headingAngle();
const clock = new THREE.Clock(); let fpsAcc = 0, fpsN = 0;
function frame() {
  const raw = Math.min(0.05, clock.getDelta()), dt = raw * state.timeScale;
  if (!window.__paused && dt > 1e-4) { const n = Math.max(1, Math.ceil(dt / (1 / 90))); for (let i = 0; i < n; i++) step(dt / n); }
  world.follow(loco.pos); frameCamera(raw); hud(raw); if (dof) { tmp.copy(loco.O).addScaledVector(loco.heading, 1.6).setY(2.6); dof.focus = Math.max(1.5, camera.position.distanceTo(tmp) - 0.6); } grade.uniforms.uT.value = (performance.now() % 1000) / 1000;
  composer.render();
  fpsAcc += raw; fpsN++; if (fpsAcc > 4 && fpsN / fpsAcc < 24 && quality !== 'low' && !Q.has('q') && !window.__warned) { window.__warned = true; const n = $('note'); n.style.display = 'block'; n.textContent = 'Running slowly — try Advanced → Quality → Low'; setTimeout(() => n.style.display = 'none', 7000); }
  if (!window.__ready) { window.__ready = true; $('lp').style.width = '100%'; $('load').classList.add('done'); }
  if (!window.__manual) requestAnimationFrame(frame);
}
// hooks for headless verification
window.__sim = (sec) => { for (let i = 0; i < Math.round(sec * 60); i++) step(1 / 60); };
window.__api = { loco, body, rex, world, camera, controls, setCam, CAMS, frame, state };
// debug view: target and camera given as [forward, up, right] relative to the animal
window.__view = (t, c, fov = 36) => { local(t, tgtW); tgtW.y = t[1]; local(c, camera.position); camera.position.y = c[1]; camera.fov = fov; camera.updateProjectionMatrix(); camera.lookAt(tgtW); world.follow(loco.pos); if (dof) dof.focus = camera.position.distanceTo(tgtW); composer.render(); };
if (Q.has('shot')) { window.__manual = true; window.__paused = true; $('load').style.display = 'none'; }
window.__step = () => { window.__sim(+(Q.get('dts') || 0.3)); frame(); };
frame();
