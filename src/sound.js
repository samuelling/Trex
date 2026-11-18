// Minimal synthesized audio: footfalls, a low vocalisation, wind. Off until the user enables it.
export class Sound {
  constructor() { this.on = false; this.ctx = null; }
  toggle() {
    if (!this.ctx) {
      const C = window.AudioContext || window.webkitAudioContext; if (!C) return false;
      const c = this.ctx = new C(); this.master = c.createGain(); this.master.gain.value = 0;
      const comp = c.createDynamicsCompressor(); this.master.connect(comp); comp.connect(c.destination);
      const n = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = n.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; this.noise = n;
      const w = c.createBufferSource(); w.buffer = n; w.loop = true; const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 420; f.Q.value = 0.4; const g = c.createGain(); g.gain.value = 0.035;
      const lfo = c.createOscillator(); lfo.frequency.value = 0.09; const lg = c.createGain(); lg.gain.value = 0.02; lfo.connect(lg); lg.connect(g.gain); lfo.start(); w.connect(f); f.connect(g); g.connect(this.master); w.start();
    }
    this.on = !this.on; if (this.ctx.state === 'suspended') this.ctx.resume();
    this.master.gain.setTargetAtTime(this.on ? 0.9 : 0, this.ctx.currentTime, 0.08); return this.on;
  }
  thump(strength, dist) {
    if (!this.on) return; const c = this.ctx, t = c.currentTime, att = strength / (1 + dist / 9);
    const o = c.createOscillator(), g = c.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(68, t); o.frequency.exponentialRampToValueAtTime(27, t + 0.32);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.9 * att, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.62); o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.7);
    const s = c.createBufferSource(); s.buffer = this.noise; const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(120, t + 0.25); const g2 = c.createGain();
    g2.gain.setValueAtTime(0.35 * att, t); g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.3); s.connect(f); f.connect(g2); g2.connect(this.master); s.start(t, Math.random()); s.stop(t + 0.35);
  }
  roar() {
    if (!this.on) return; const c = this.ctx, t = c.currentTime, out = c.createGain(), lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(180, t); lp.frequency.linearRampToValueAtTime(950, t + 0.6); lp.frequency.linearRampToValueAtTime(220, t + 3);
    out.gain.setValueAtTime(0.0001, t); out.gain.exponentialRampToValueAtTime(0.5, t + 0.5); out.gain.setValueAtTime(0.5, t + 2.2); out.gain.exponentialRampToValueAtTime(0.0001, t + 3.2); lp.connect(out); out.connect(this.master);
    const trem = c.createOscillator(), tg = c.createGain(); trem.frequency.value = 23; tg.gain.value = 0.35; trem.connect(tg); tg.connect(out.gain); trem.start(t); trem.stop(t + 3.3);
    for (const [f, ty, gn] of [[41, 'sawtooth', 0.5], [61.5, 'sawtooth', 0.35], [83, 'square', 0.12]]) { const o = c.createOscillator(), g = c.createGain(); o.type = ty; o.frequency.setValueAtTime(f * 1.25, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.7); o.frequency.exponentialRampToValueAtTime(f * 0.8, t + 3.1); g.gain.value = gn; o.connect(g); g.connect(lp); o.start(t); o.stop(t + 3.3); }
    const s = c.createBufferSource(); s.buffer = this.noise; s.loop = true; const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 620; bp.Q.value = 0.7; const g = c.createGain(); g.gain.value = 0.4; s.connect(bp); bp.connect(g); g.connect(out); s.start(t); s.stop(t + 3.3);
  }
}
