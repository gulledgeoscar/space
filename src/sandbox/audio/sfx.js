// Every sound is synthesised with WebAudio: no audio files to download.
// Positional sounds use panner nodes driven by the camera.

const MATERIAL = {
  stone: { f: 2200, q: 0.8, dur: 0.09, gain: 0.35 },
  dirt: { f: 700, q: 0.7, dur: 0.12, gain: 0.45 },
  grass: { f: 1100, q: 0.5, dur: 0.12, gain: 0.4 },
  sand: { f: 3200, q: 0.4, dur: 0.14, gain: 0.25 },
  snow: { f: 1800, q: 0.3, dur: 0.15, gain: 0.25 },
  wood: { f: 500, q: 2.5, dur: 0.1, gain: 0.5 },
  glass: { f: 4200, q: 4, dur: 0.12, gain: 0.3 },
  metal: { f: 3000, q: 8, dur: 0.2, gain: 0.3 },
  cloth: { f: 900, q: 0.4, dur: 0.1, gain: 0.3 },
  slime: { f: 400, q: 6, dur: 0.18, gain: 0.5 },
  water: { f: 800, q: 0.6, dur: 0.25, gain: 0.3 },
  lava: { f: 300, q: 0.6, dur: 0.3, gain: 0.3 },
  fire: { f: 1400, q: 0.5, dur: 0.2, gain: 0.25 },
};

export class Audio {
  constructor() {
    this.ctx = null;
    this.volume = 0.8;
    this.listenerPos = { x: 0, y: 0, z: 0 };
    this.loops = new Map();
    this.lastPlay = new Map();
  }

  // Must be called from a user gesture.
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = this.volume;
    this.muffle = c.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000;
    this.comp = c.createDynamicsCompressor();
    this.master.connect(this.muffle).connect(this.comp).connect(c.destination);
    const len = c.sampleRate * 2;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // Brown noise for rumbles.
    this.brown = c.createBuffer(1, len, c.sampleRate);
    const bd = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; bd[i] = last * 3.5; }
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }

  setUnderwater(on) {
    if (!this.ctx) return;
    this.muffle.frequency.setTargetAtTime(on ? 600 : 20000, this.ctx.currentTime, 0.1);
  }

  updateListener(camera) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const p = camera.position;
    this.listenerPos = { x: p.x, y: p.y, z: p.z };
    const f = { x: 0, y: 0, z: -1 };
    const e = camera.matrixWorld.elements;
    f.x = -e[8]; f.y = -e[9]; f.z = -e[10];
    if (l.positionX) {
      l.positionX.value = p.x; l.positionY.value = p.y; l.positionZ.value = p.z;
      l.forwardX.value = f.x; l.forwardY.value = f.y; l.forwardZ.value = f.z;
      l.upX.value = e[4]; l.upY.value = e[5]; l.upZ.value = e[6];
    } else {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(f.x, f.y, f.z, e[4], e[5], e[6]);
    }
  }

  out(pos, gain = 1) {
    const c = this.ctx;
    const g = c.createGain();
    g.gain.value = gain;
    if (pos) {
      const dx = pos.x - this.listenerPos.x, dy = pos.y - this.listenerPos.y, dz = pos.z - this.listenerPos.z;
      if (dx * dx + dy * dy + dz * dz > 80 * 80) return null;
      const p = c.createPanner();
      p.panningModel = 'equalpower';
      p.distanceModel = 'inverse';
      p.refDistance = 4;
      p.rolloffFactor = 1.2;
      p.maxDistance = 80;
      if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; }
      else p.setPosition(pos.x, pos.y, pos.z);
      g.connect(p).connect(this.master);
    } else g.connect(this.master);
    return g;
  }

  noiseBurst(dest, { type = 'bandpass', f = 1000, q = 1, dur = 0.1, gain = 0.5, attack = 0.002, sweep = 0, brown = false, delay = 0 }) {
    const c = this.ctx;
    const t = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = brown ? this.brown : this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filt = c.createBiquadFilter();
    filt.type = type;
    filt.frequency.setValueAtTime(f, t);
    if (sweep) filt.frequency.exponentialRampToValueAtTime(Math.max(40, f * sweep), t + dur);
    filt.Q.value = q;
    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt).connect(env).connect(dest);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  tone(dest, { type = 'sine', f = 440, f2 = null, dur = 0.2, gain = 0.3, attack = 0.005, delay = 0, vibrato = 0, vibratoRate = 6, filter = 0 }) {
    const c = this.ctx;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
    if (vibrato) {
      const lfo = c.createOscillator();
      const lg = c.createGain();
      lfo.frequency.value = vibratoRate;
      lg.gain.value = vibrato;
      lfo.connect(lg).connect(o.frequency);
      lfo.start(t); lfo.stop(t + dur + 0.05);
    }
    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if (filter) {
      const fl = c.createBiquadFilter();
      fl.type = 'lowpass'; fl.frequency.value = filter; fl.Q.value = 3;
      o.connect(fl); node = fl;
    }
    node.connect(env).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  play(name, opts = {}) {
    if (!this.ctx || this.volume <= 0) return;
    // Throttle identical sounds so a hundred TNT don't melt the mixer.
    const now = this.ctx.currentTime;
    const minGap = name === 'explosion' ? 0.06 : 0.02;
    if (now - (this.lastPlay.get(name) || 0) < minGap) return;
    this.lastPlay.set(name, now);
    const dest = this.out(opts.pos, opts.gain ?? 1);
    if (!dest) return;
    const m = MATERIAL[opts.material] || MATERIAL.stone;
    const r = () => 0.9 + Math.random() * 0.2;
    switch (name) {
      case 'step': this.noiseBurst(dest, { f: m.f * r(), q: m.q, dur: m.dur, gain: m.gain * 0.5 }); break;
      case 'land': this.noiseBurst(dest, { type: 'lowpass', f: m.f * 0.6, q: 0.5, dur: 0.15, gain: 0.5 }); break;
      case 'break':
        this.noiseBurst(dest, { f: m.f * r(), q: m.q, dur: m.dur * 2.2, gain: m.gain });
        this.noiseBurst(dest, { type: 'lowpass', f: m.f * 0.5, q: 1, dur: m.dur * 1.5, gain: m.gain * 0.6, delay: 0.03 });
        if (opts.material === 'glass') for (let i = 0; i < 4; i++) this.tone(dest, { type: 'triangle', f: 2500 + Math.random() * 3000, dur: 0.15, gain: 0.06, delay: i * 0.03 });
        break;
      case 'place': this.noiseBurst(dest, { type: 'lowpass', f: m.f * 0.7 * r(), q: 1, dur: 0.08, gain: m.gain * 0.9 }); break;
      case 'dig': this.noiseBurst(dest, { f: m.f * r(), q: m.q, dur: m.dur * 0.8, gain: m.gain * 0.35 }); break;
      case 'jump': break;
      case 'hurt': this.tone(dest, { type: 'square', f: 300, f2: 140, dur: 0.18, gain: 0.15, filter: 1200 }); break;
      case 'splash': this.noiseBurst(dest, { type: 'lowpass', f: 2500, q: 0.5, dur: 0.6, gain: 0.5, sweep: 0.2 }); break;
      case 'eat': for (let i = 0; i < 3; i++) this.noiseBurst(dest, { f: 1400, q: 1, dur: 0.07, gain: 0.3, delay: i * 0.12 }); break;
      case 'pop': this.tone(dest, { type: 'sine', f: 600 * r(), f2: 1200, dur: 0.08, gain: 0.2 }); break;
      case 'click': this.tone(dest, { type: 'square', f: 1200, dur: 0.03, gain: 0.05 }); break;
      case 'pistol':
        this.noiseBurst(dest, { type: 'lowpass', f: 5000, q: 0.7, dur: 0.18, gain: 0.8, sweep: 0.2 });
        this.tone(dest, { type: 'sine', f: 180, f2: 50, dur: 0.15, gain: 0.5 });
        break;
      case 'rifle':
        this.noiseBurst(dest, { type: 'lowpass', f: 6000, q: 0.7, dur: 0.12, gain: 0.7, sweep: 0.25 });
        this.tone(dest, { type: 'sine', f: 140, f2: 45, dur: 0.1, gain: 0.45 });
        break;
      case 'shotgun':
        this.noiseBurst(dest, { type: 'lowpass', f: 3500, q: 0.5, dur: 0.4, gain: 1, sweep: 0.15 });
        this.tone(dest, { type: 'sine', f: 120, f2: 35, dur: 0.3, gain: 0.7 });
        this.noiseBurst(dest, { f: 900, q: 3, dur: 0.06, gain: 0.25, delay: 0.35 });
        break;
      case 'laser': this.tone(dest, { type: 'sawtooth', f: 1800, f2: 200, dur: 0.2, gain: 0.15, filter: 4000 }); break;
      case 'rocket': this.noiseBurst(dest, { type: 'bandpass', f: 600, q: 0.7, dur: 0.7, gain: 0.6, sweep: 3 }); break;
      case 'throw': this.noiseBurst(dest, { type: 'bandpass', f: 900, q: 1, dur: 0.18, gain: 0.25, sweep: 2 }); break;
      case 'explosion': {
        const big = opts.size ?? 1;
        this.noiseBurst(dest, { type: 'lowpass', f: 1800, q: 0.3, dur: 1.4 + big * 0.4, gain: 1, sweep: 0.06, brown: false });
        this.noiseBurst(dest, { type: 'lowpass', f: 300, q: 0.5, dur: 2.2 + big * 0.5, gain: 1, brown: true });
        this.tone(dest, { type: 'sine', f: 70, f2: 25, dur: 1.2, gain: 0.9 });
        break;
      }
      case 'thunder':
        this.noiseBurst(dest, { type: 'lowpass', f: 3000, q: 0.3, dur: 0.4, gain: 0.8, sweep: 0.2 });
        this.noiseBurst(dest, { type: 'lowpass', f: 250, q: 0.4, dur: 3.5, gain: 1, brown: true, delay: 0.1 });
        break;
      case 'fuse': this.noiseBurst(dest, { type: 'highpass', f: 4000, q: 0.5, dur: 1.2, gain: 0.25 }); break;
      case 'boing': this.tone(dest, { type: 'sine', f: 200, f2: 700, dur: 0.3, gain: 0.3, vibrato: 30, vibratoRate: 18 }); break;
      case 'grapple': this.tone(dest, { type: 'square', f: 900, f2: 300, dur: 0.15, gain: 0.08 }); break;
      case 'whoosh': this.noiseBurst(dest, { type: 'bandpass', f: 500, q: 1, dur: 0.35, gain: 0.35, sweep: 4 }); break;
      case 'flame': this.noiseBurst(dest, { type: 'lowpass', f: 900, q: 0.5, dur: 0.18, gain: 0.25 }); break;
      case 'fizz': this.noiseBurst(dest, { type: 'highpass', f: 3000, q: 0.5, dur: 0.5, gain: 0.25 }); break;
      case 'teleport': this.tone(dest, { type: 'sine', f: 300, f2: 1600, dur: 0.35, gain: 0.2, vibrato: 40, vibratoRate: 25 }); break;
      case 'resize': this.tone(dest, { type: 'triangle', f: opts.up ? 300 : 900, f2: opts.up ? 900 : 300, dur: 0.3, gain: 0.2 }); break;
      case 'freeze': this.noiseBurst(dest, { type: 'highpass', f: 6000, q: 1, dur: 0.4, gain: 0.25 }); this.tone(dest, { type: 'sine', f: 2400, f2: 1800, dur: 0.4, gain: 0.08 }); break;
      case 'hit': this.noiseBurst(dest, { type: 'lowpass', f: 900, q: 1, dur: 0.1, gain: 0.6 }); break;
      case 'swing': this.noiseBurst(dest, { type: 'bandpass', f: 1200, q: 1, dur: 0.12, gain: 0.15, sweep: 2 }); break;
      case 'pig': this.tone(dest, { type: 'sawtooth', f: 260 * r(), f2: 170, dur: 0.25, gain: 0.15, filter: 900 }); this.tone(dest, { type: 'sawtooth', f: 240 * r(), f2: 160, dur: 0.2, gain: 0.12, filter: 900, delay: 0.3 }); break;
      case 'cow': this.tone(dest, { type: 'sawtooth', f: 130 * r(), f2: 95, dur: 1.1, gain: 0.2, filter: 600, vibrato: 4, attack: 0.15 }); break;
      case 'sheep': this.tone(dest, { type: 'sawtooth', f: 420 * r(), f2: 380, dur: 0.6, gain: 0.12, filter: 1500, vibrato: 25, vibratoRate: 9, attack: 0.05 }); break;
      case 'chicken': for (let i = 0; i < 3; i++) this.tone(dest, { type: 'square', f: 900 * r(), f2: 600, dur: 0.07, gain: 0.06, delay: i * 0.1, filter: 2500 }); break;
      case 'zombie': this.tone(dest, { type: 'sawtooth', f: 95 * r(), f2: 70, dur: 1.0, gain: 0.2, filter: 400, vibrato: 6, vibratoRate: 4, attack: 0.2 }); break;
      case 'skeleton': for (let i = 0; i < 5; i++) this.noiseBurst(dest, { f: 2500, q: 6, dur: 0.03, gain: 0.25, delay: i * 0.05 }); break;
      case 'wolf': this.tone(dest, { type: 'sawtooth', f: 500 * r(), f2: 300, dur: 0.12, gain: 0.15, filter: 1500 }); this.noiseBurst(dest, { f: 900, q: 1, dur: 0.1, gain: 0.2 }); break;
      case 'horse': this.tone(dest, { type: 'sawtooth', f: 500, f2: 900, dur: 0.5, gain: 0.12, filter: 2000, vibrato: 40, vibratoRate: 14 }); break;
      case 'villager': this.tone(dest, { type: 'sawtooth', f: 180 * r(), f2: 220, dur: 0.35, gain: 0.12, filter: 700, vibrato: 8 }); break;
      case 'spider': this.noiseBurst(dest, { type: 'highpass', f: 2000, q: 1, dur: 0.3, gain: 0.15 }); break;
      case 'death': this.tone(dest, { type: 'square', f: 400, f2: 80, dur: 0.6, gain: 0.12, filter: 1200 }); break;
      case 'bell': this.tone(dest, { type: 'sine', f: 880, dur: 1.2, gain: 0.2 }); this.tone(dest, { type: 'sine', f: 1320, dur: 0.9, gain: 0.08 }); break;
      case 'note': this.tone(dest, { type: 'triangle', f: opts.f ?? 440, dur: 0.6, gain: 0.25 }); break;
      case 'levelup': [523, 659, 784, 1046].forEach((f, i) => this.tone(dest, { type: 'triangle', f, dur: 0.25, gain: 0.15, delay: i * 0.08 })); break;
      case 'bird': for (let i = 0; i < 3; i++) this.tone(dest, { type: 'sine', f: 2500 + Math.random() * 1500, f2: 3200 + Math.random() * 1000, dur: 0.08, gain: 0.04, delay: i * 0.11 }); break;
      case 'cricket': for (let i = 0; i < 4; i++) this.tone(dest, { type: 'sine', f: 4200, dur: 0.03, gain: 0.025, delay: i * 0.05 }); break;
      default: break;
    }
  }

  // Continuous loop (rain, wind, engines, flamethrower). Returns a controller.
  loop(name, make) {
    if (!this.ctx) return null;
    if (this.loops.has(name)) return this.loops.get(name);
    const ctl = make(this.ctx);
    this.loops.set(name, ctl);
    return ctl;
  }

  stopLoop(name) {
    const l = this.loops.get(name);
    if (l) { l.stop(); this.loops.delete(name); }
  }

  noiseLoop(name, { type = 'lowpass', f = 800, q = 0.5, gain = 0.2, brown = false }) {
    return this.loop(name, (c) => {
      const src = c.createBufferSource();
      src.buffer = brown ? this.brown : this.noise;
      src.loop = true;
      const filt = c.createBiquadFilter();
      filt.type = type; filt.frequency.value = f; filt.Q.value = q;
      const g = c.createGain();
      g.gain.value = 0;
      src.connect(filt).connect(g).connect(this.master);
      src.start();
      return {
        set: (v, freq) => { g.gain.setTargetAtTime(v * gain, c.currentTime, 0.2); if (freq) filt.frequency.setTargetAtTime(freq, c.currentTime, 0.1); },
        stop: () => { g.gain.setTargetAtTime(0, c.currentTime, 0.1); setTimeout(() => src.stop(), 500); },
      };
    });
  }

  engine(name) {
    return this.loop(name, (c) => {
      const o1 = c.createOscillator(); o1.type = 'sawtooth';
      const o2 = c.createOscillator(); o2.type = 'square';
      const filt = c.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 500; filt.Q.value = 2;
      const g = c.createGain(); g.gain.value = 0;
      o1.connect(filt); o2.connect(filt); filt.connect(g).connect(this.master);
      o1.start(); o2.start();
      return {
        set: (rpm, vol = 0.12) => {
          const t = c.currentTime;
          o1.frequency.setTargetAtTime(30 + rpm * 90, t, 0.05);
          o2.frequency.setTargetAtTime(15 + rpm * 45, t, 0.05);
          filt.frequency.setTargetAtTime(300 + rpm * 900, t, 0.05);
          g.gain.setTargetAtTime(vol, t, 0.1);
        },
        stop: () => { g.gain.setTargetAtTime(0, c.currentTime, 0.05); setTimeout(() => { o1.stop(); o2.stop(); }, 400); },
      };
    });
  }
}
