// Pipe-organ score synthesised with Web Audio.
//
// Each pipe rank is an oscillator with a custom PeriodicWave (flue-pipe
// harmonic recipe), a little wind noise "chiff" on attack, slow swells and a
// long cathedral reverb. A lookahead sequencer plays an original minor-key
// progression with layers (pedal, chords, arpeggio ostinato, descant) that
// fade in with the intensity parameter.

const PROG = [
  { bass: 38, chord: [50, 57, 62, 64] },   // Dm(add9)
  { bass: 34, chord: [50, 53, 57, 62] },   // Bbmaj7
  { bass: 41, chord: [48, 53, 57, 60] },   // F
  { bass: 40, chord: [48, 52, 55, 60] },   // C/E
  { bass: 43, chord: [50, 55, 58, 62] },   // Gm
  { bass: 33, chord: [50, 53, 57, 62] },   // Dm/A
  { bass: 34, chord: [50, 53, 57, 60] },   // Bb(add9)
  { bass: 33, chord: [49, 52, 57, 61] },   // A
];
const ARP = [0, 2, 1, 3, 2, 1, 3, 2];
const DESCANT = [74, 72, 69, 67, 70, 69, 72, 73];

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Organ {
  constructor(engine) {
    this.e = engine;
    const ctx = (this.ctx = engine.ctx);
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.frequency.value = 3200;
    this.out.connect(this.tone).connect(engine.music);
    const send = ctx.createGain(); send.gain.value = 0.9;
    this.tone.connect(send).connect(engine.reverb);
    const flue = (amps) => {
      const real = new Float32Array(amps.length + 1), imag = new Float32Array(amps.length + 1);
      amps.forEach((a, i) => { imag[i + 1] = a; });
      return ctx.createPeriodicWave(real, imag);
    };
    this.waves = {
      principal: flue([1, 0.55, 0.32, 0.22, 0.12, 0.09, 0.05, 0.06]),
      flute: flue([1, 0.18, 0.05, 0.02]),
      reed: flue([1, 0.8, 0.7, 0.6, 0.5, 0.42, 0.35, 0.3, 0.25, 0.2, 0.16, 0.12]),
    };
    this.playing = false;
    this.intensity = 0;
    this.targetIntensity = 0;
    this.tempo = 64;
    this.nextTime = 0;
    this.step = 0;              // eighth-note counter
    this.theme = 'ambient';
  }

  play(theme = 'ambient', intensity = 0.3) {
    this.theme = theme;
    this.targetIntensity = intensity;
    if (!this.playing) {
      this.playing = true;
      this.nextTime = this.ctx.currentTime + 0.1;
      this.step = 0;
    }
    this.tempo = theme === 'finale' ? 72 : theme === 'tension' ? 66 : 58;
    const t = this.ctx.currentTime;
    this.out.gain.setTargetAtTime(theme === 'silence' ? 0 : 0.5, t, 2.0);
  }
  stop(fade = 3) {
    this.targetIntensity = 0;
    this.out.gain.setTargetAtTime(0, this.ctx.currentTime, fade / 3);
    setTimeout(() => { if (this.targetIntensity === 0) this.playing = false; }, fade * 1000);
  }
  setIntensity(x) { this.targetIntensity = Math.max(0, Math.min(1, x)); }

  pipe(midi, t, dur, gain, wave = 'principal', detune = 0, attack = 0.25) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.setPeriodicWave(this.waves[wave]);
    o.frequency.value = mtof(midi);
    o.detune.value = detune;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.setValueAtTime(gain, t + Math.max(attack, dur - 0.05));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 1.2);
    o.connect(g).connect(this.out);
    o.start(t); o.stop(t + dur + 1.4);
    // wind chiff on attack
    if (gain > 0.02 && wave !== 'reed') {
      const n = ctx.createBufferSource(); n.buffer = this.e.noise;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = mtof(midi) * 3; bp.Q.value = 6;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(gain * 0.25, t + 0.02); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      n.connect(bp).connect(ng).connect(this.out); n.start(t, Math.random()); n.stop(t + 0.2);
    }
  }

  update(dt) {
    if (!this.playing) return;
    this.intensity += (this.targetIntensity - this.intensity) * Math.min(1, dt * 0.25);
    const I = this.intensity;
    this.tone.frequency.setTargetAtTime(1400 + I * 4200, this.ctx.currentTime, 0.5);
    const eighth = 60 / this.tempo / 2;
    const ahead = this.ctx.currentTime + 0.25;
    while (this.nextTime < ahead) {
      const s = this.step;
      const bar = Math.floor(s / 8);
      const chordIdx = Math.floor(bar / 2) % PROG.length;
      const ch = PROG[chordIdx];
      const t = this.nextTime;
      const inBar = s % 16;
      // chords + pedal: held for two bars
      if (inBar === 0) {
        const hold = eighth * 16;
        const cg = 0.03 + I * 0.05;
        for (const n of ch.chord) {
          this.pipe(n, t, hold, cg, 'principal', -3, 0.9 - I * 0.5);
          this.pipe(n + 12, t, hold, cg * 0.45, 'flute', 4, 1.0);
        }
        if (I > 0.15) this.pipe(ch.bass, t, hold, 0.05 + I * 0.07, 'principal', 0, 1.2);
        if (I > 0.55) this.pipe(ch.bass - 12, t, hold, 0.04 + (I - 0.55) * 0.12, 'flute', 0, 1.5);
        if (I > 0.8) for (const n of ch.chord) this.pipe(n, t, hold, 0.012 + (I - 0.8) * 0.06, 'reed', 2, 0.6);
      }
      // arpeggio ostinato
      if (I > 0.3) {
        const n = ch.chord[ARP[s % 8]] + 12;
        this.pipe(n, t, eighth * 0.9, 0.012 + (I - 0.3) * 0.045, 'flute', 0, 0.02);
      }
      // descant (half notes) at high intensity
      if (I > 0.65 && s % 4 === 0) {
        const m = DESCANT[(bar + Math.floor(s / 4)) % DESCANT.length];
        this.pipe(m, t, eighth * 4, 0.01 + (I - 0.65) * 0.05, 'principal', 6, 0.15);
      }
      this.nextTime += eighth;
      this.step++;
    }
  }
}
