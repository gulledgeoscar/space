// Web Audio engine: everything is synthesised at runtime - no samples.
// Buses: sfx, ambience, music, voice -> master -> compressor -> out, with a
// generated convolution reverb send.

import { settings } from '../core/settings.js';
import { Organ } from './music.js';
import { Voice } from './voice.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.loops = {};
    this.voice = new Voice();
    settings.onChange((k) => { if (k === 'masterVolume' || k === 'musicVolume') this.applyVolumes(); });
  }

  init() {
    if (this.ready) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16; this.comp.ratio.value = 4;
    this.master.connect(this.comp).connect(ctx.destination);
    const bus = () => { const g = ctx.createGain(); g.connect(this.master); return g; };
    this.sfx = bus(); this.amb = bus(); this.music = bus(); this.voiceBus = bus();
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(3.2, 2.4);
    this.reverbOut = ctx.createGain(); this.reverbOut.gain.value = 0.55;
    this.reverb.connect(this.reverbOut).connect(this.master);
    this.noise = this.makeNoise(3);
    this.brown = this.makeNoise(3, true);
    this.applyVolumes();
    this.startLoops();
    this.organ = new Organ(this);
    this.ready = true;
  }

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(settings.get('masterVolume'), t, 0.05);
    this.music.gain.setTargetAtTime(settings.get('musicVolume') * 0.55, t, 0.05);
  }

  makeNoise(sec, brown = false) {
    const ctx = this.ctx;
    const b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return b;
  }

  makeImpulse(sec, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return b;
  }

  noiseSrc(buf = this.noise) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf; s.loop = true;
    s.loopStart = Math.random(); s.loopEnd = buf.duration;
    return s;
  }

  // ---- continuous loops ------------------------------------------------------
  startLoops() {
    const ctx = this.ctx;
    const mk = (name, build) => { this.loops[name] = build(); };
    // RCS hiss: band-passed noise, gain driven by jet activity, stereo pan
    mk('rcs', () => {
      const src = this.noiseSrc();
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2800; bp.Q.value = 0.8;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 600;
      const g = ctx.createGain(); g.gain.value = 0;
      const pan = ctx.createStereoPanner();
      src.connect(bp).connect(hp).connect(g).connect(pan).connect(this.sfx);
      src.start();
      return { g, bp, pan };
    });
    // main engine rumble
    mk('engine', () => {
      const src = this.noiseSrc(this.brown);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180;
      const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 38;
      const og = ctx.createGain(); og.gain.value = 0.25;
      const lp2 = ctx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 120;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(lp).connect(g);
      osc.connect(og).connect(lp2).connect(g);
      g.connect(this.sfx);
      src.start(); osc.start();
      return { g, lp, osc };
    });
    // atmospheric buffeting / wind
    mk('wind', () => {
      const src = this.noiseSrc();
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500; bp.Q.value = 0.6;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(bp).connect(g).connect(this.sfx);
      src.start();
      return { g, bp };
    });
    // interior hum: mains-like low tones + fan noise
    mk('hum', () => {
      const g = ctx.createGain(); g.gain.value = 0;
      for (const [f, a] of [[55, 0.25], [110, 0.12], [165, 0.05], [233, 0.02]]) {
        const o = ctx.createOscillator(); o.frequency.value = f;
        const og = ctx.createGain(); og.gain.value = a;
        o.connect(og).connect(g); o.start();
      }
      const fan = this.noiseSrc(this.brown);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400;
      const fg = ctx.createGain(); fg.gain.value = 0.35;
      fan.connect(lp).connect(fg).connect(g);
      fan.start();
      g.connect(this.amb);
      return { g, lp };
    });
    // water / hydroponics trickle
    mk('water', () => {
      const src = this.noiseSrc();
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 3;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.35;
      const lg = ctx.createGain(); lg.gain.value = 500;
      lfo.connect(lg).connect(bp.frequency); lfo.start();
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(bp).connect(g).connect(this.amb); src.start();
      return { g };
    });
    // klaxon
    mk('klaxon', () => {
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 520;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
      const gate = ctx.createGain(); gate.gain.value = 0;
      const g = ctx.createGain(); g.gain.value = 0;
      o.connect(lp).connect(gate).connect(g).connect(this.sfx); o.start();
      return { o, gate, g, on: false, t: 0 };
    });
    // master caution tone (high, intermittent)
    mk('caution', () => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 1250;
      const gate = ctx.createGain(); gate.gain.value = 0;
      o.connect(gate).connect(this.sfx); o.start();
      return { o, gate, t: 0, level: 0 };
    });
    // heartbeat (tension)
    this.heart = { rate: 0, t: 0, level: 0 };
  }

  // Per-frame driver from game state.
  update(dt, s) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const L = this.loops;
    L.rcs.g.gain.setTargetAtTime(Math.min(0.5, s.rcs * (s.coarse ? 0.16 : 0.05)), t, 0.02);
    L.rcs.bp.frequency.setTargetAtTime(s.coarse ? 1900 : 3600, t, 0.05);
    L.rcs.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, s.rcsPan || 0)), t, 0.05);
    L.engine.g.gain.setTargetAtTime(s.engine * 0.9, t, 0.08);
    L.engine.lp.frequency.setTargetAtTime(120 + s.engine * 260 + s.q * 0.004, t, 0.1);
    L.engine.osc.frequency.setTargetAtTime(34 + s.engine * 12, t, 0.2);
    L.wind.g.gain.setTargetAtTime(Math.min(0.6, s.q / 40000), t, 0.1);
    L.wind.bp.frequency.setTargetAtTime(300 + Math.min(2500, s.airspeed * 1.2), t, 0.2);
    L.hum.g.gain.setTargetAtTime(s.hum * 0.35, t, 0.4);
    L.hum.lp.frequency.setTargetAtTime(300 + s.hum * 300, t, 0.4);
    L.water.g.gain.setTargetAtTime(s.water * 0.12, t, 0.5);
    // klaxon: two-tone whoop
    const k = L.klaxon;
    k.g.gain.setTargetAtTime(s.klaxon ? 0.12 : 0, t, 0.05);
    if (s.klaxon) {
      k.t += dt;
      const ph = k.t % 0.9;
      k.gate.gain.setTargetAtTime(ph < 0.6 ? 1 : 0, t, 0.01);
      k.o.frequency.setTargetAtTime(ph < 0.3 ? 620 : 470, t, 0.02);
    }
    const c = L.caution;
    if (s.caution) {
      c.t += dt;
      c.gate.gain.setTargetAtTime((c.t % 1.2) < 0.12 || ((c.t % 1.2) > 0.24 && (c.t % 1.2) < 0.36) ? 0.05 : 0, t, 0.005);
    } else c.gate.gain.setTargetAtTime(0, t, 0.02);
    // heartbeat
    const h = this.heart;
    h.level += ((s.heart || 0) - h.level) * Math.min(1, dt * 0.5);
    if (h.level > 0.05) {
      h.t -= dt;
      if (h.t <= 0) { h.t = 60 / (60 + h.level * 70); this.thump(h.level); }
    }
    this.organ?.update(dt);
  }

  // ---- one-shots ---------------------------------------------------------------
  env(node, t0, a, peak, d, end = 0.0001) {
    node.gain.setValueAtTime(0.0001, t0);
    node.gain.exponentialRampToValueAtTime(peak, t0 + a);
    node.gain.exponentialRampToValueAtTime(end, t0 + a + d);
  }

  // Metallic contact: inharmonic modes of a stiff plate + noise transient.
  clunk(intensity = 1, pitch = 1) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = ctx.createGain(); out.gain.value = Math.min(1.2, 0.35 + intensity * 0.5);
    out.connect(this.sfx);
    const send = ctx.createGain(); send.gain.value = 0.35; out.connect(send).connect(this.reverb);
    const modes = [1, 1.59, 2.14, 2.65, 3.91, 5.4];
    modes.forEach((m, i) => {
      const o = ctx.createOscillator(); o.frequency.value = 92 * pitch * m * (1 + (Math.random() - 0.5) * 0.02);
      const g = ctx.createGain();
      this.env(g, t, 0.002, 0.35 / (i + 1), 0.4 + 1.2 / (i + 1));
      o.connect(g).connect(out); o.start(t); o.stop(t + 2);
    });
    const n = ctx.createBufferSource(); n.buffer = this.noise;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    const ng = ctx.createGain(); this.env(ng, t, 0.001, 0.7 * intensity, 0.18);
    n.connect(lp).connect(ng).connect(out); n.start(t); n.stop(t + 0.4);
  }

  latch(i = 0) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    // servo whir
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(300, t); o.frequency.linearRampToValueAtTime(520, t + 0.18);
    const lp = ctx.createBiquadFilter(); lp.type = 'bandpass'; lp.frequency.value = 900; lp.Q.value = 2;
    const g = ctx.createGain(); this.env(g, t, 0.01, 0.05, 0.2);
    const pan = ctx.createStereoPanner(); pan.pan.value = Math.sin(i * 0.52) * 0.7;
    o.connect(lp).connect(g).connect(pan).connect(this.sfx); o.start(t); o.stop(t + 0.3);
    // hook seating click
    setTimeout(() => this.clunk(0.25, 2.4 + (i % 3) * 0.15), 170);
  }

  hiss(duration = 4, gain = 0.25) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this.noiseSrc();
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass';
    hp.frequency.setValueAtTime(5000, t); hp.frequency.exponentialRampToValueAtTime(700, t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.15);
    g.gain.setValueAtTime(gain, t + duration * 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    n.connect(hp).connect(g).connect(this.sfx); n.start(t); n.stop(t + duration + 0.1);
  }

  door() {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this.noiseSrc();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(400, t); bp.frequency.exponentialRampToValueAtTime(1800, t + 0.35);
    const g = ctx.createGain(); this.env(g, t, 0.03, 0.18, 0.5);
    n.connect(bp).connect(g).connect(this.sfx); n.start(t); n.stop(t + 0.7);
    setTimeout(() => this.clunk(0.15, 1.6), 380);
  }

  explosion(scale = 1) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = ctx.createBufferSource(); n.buffer = this.brown;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1800, t); lp.frequency.exponentialRampToValueAtTime(60, t + 3);
    const g = ctx.createGain(); this.env(g, t, 0.01, 1.2 * scale, 4.0);
    n.connect(lp).connect(g).connect(this.sfx); n.start(t); n.stop(t + 4.5);
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(22, t + 2.5);
    const og = ctx.createGain(); this.env(og, t, 0.005, 0.8 * scale, 2.8);
    o.connect(og).connect(this.sfx); o.start(t); o.stop(t + 3);
    const send = ctx.createGain(); send.gain.value = 0.5; g.connect(send).connect(this.reverb);
    this.clunk(scale, 0.6);
  }

  thump(level) {
    const ctx = this.ctx, t = ctx.currentTime;
    for (const [dt2, a] of [[0, 1], [0.22, 0.6]]) {
      const o = ctx.createOscillator(); o.frequency.setValueAtTime(58, t + dt2); o.frequency.exponentialRampToValueAtTime(34, t + dt2 + 0.15);
      const g = ctx.createGain(); this.env(g, t + dt2, 0.005, 0.22 * a * level, 0.2);
      o.connect(g).connect(this.sfx); o.start(t + dt2); o.stop(t + dt2 + 0.3);
    }
  }

  // radio key-up: a short two-tone beep and a breath of static
  radio(who) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const f = who === 'case' ? 2475 : 2525;
    const o = ctx.createOscillator(); o.frequency.value = f;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + 0.01); g.gain.setValueAtTime(0.06, t + 0.2); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    o.connect(g).connect(this.voiceBus); o.start(t); o.stop(t + 0.3);
    const n = ctx.createBufferSource(); n.buffer = this.noise;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 0.7;
    const ng = ctx.createGain(); this.env(ng, t + 0.22, 0.01, 0.03, 0.25);
    n.connect(bp).connect(ng).connect(this.voiceBus); n.start(t + 0.22); n.stop(t + 0.6);
  }

  blip(kind = 'ui') {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const notes = kind === 'good' ? [880, 1320] : kind === 'bad' ? [330, 220] : [1200];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      const g = ctx.createGain(); this.env(g, t + i * 0.09, 0.005, 0.07, 0.12);
      o.connect(g).connect(this.sfx); o.start(t + i * 0.09); o.stop(t + i * 0.09 + 0.2);
    });
  }

  click() {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = ctx.createBufferSource(); n.buffer = this.noise;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
    const g = ctx.createGain(); this.env(g, t, 0.001, 0.4, 0.04);
    n.connect(hp).connect(g).connect(this.sfx); n.start(t); n.stop(t + 0.08);
    this.clunk(0.08, 3.2);
  }

  footstep(kind = 'metal', level = 1) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = ctx.createBufferSource(); n.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    if (kind === 'water') { f.type = 'bandpass'; f.frequency.value = 900 + Math.random() * 600; f.Q.value = 0.8; }
    else if (kind === 'snow') { f.type = 'highpass'; f.frequency.value = 1800; }
    else { f.type = 'bandpass'; f.frequency.value = 260 + Math.random() * 80; f.Q.value = 1.5; }
    const g = ctx.createGain(); this.env(g, t, 0.004, (kind === 'water' ? 0.18 : 0.14) * level, kind === 'water' ? 0.35 : 0.12);
    n.connect(f).connect(g).connect(this.sfx); n.start(t); n.stop(t + 0.5);
    if (kind === 'metal') this.clunk(0.04 * level, 1.8 + Math.random() * 0.3);
  }

  speak(text) { if (settings.get('voice')) this.voice.speak(text, 'case'); }
  speakCrew(text, who) { if (settings.get('voice')) this.voice.speak(text, who); }
}
