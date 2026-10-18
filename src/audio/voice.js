// CASE-9's voice via the browser's speech synthesis (if available):
// low, measured, slightly slow. Crew lines get their own pitch.

const PROFILES = {
  case: { pitch: 0.55, rate: 0.98 },
  okafor: { pitch: 1.15, rate: 1.02 },
  halden: { pitch: 0.95, rate: 1.08 },
  vance: { pitch: 0.75, rate: 0.95 },
  pilot: { pitch: 1.0, rate: 1.0 },
};

export class Voice {
  constructor() {
    this.synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
    this.voices = [];
    if (this.synth) {
      const load = () => { this.voices = this.synth.getVoices().filter((v) => v.lang && v.lang.startsWith('en')); };
      load();
      this.synth.onvoiceschanged = load;
    }
  }
  pick(who) {
    if (!this.voices.length) return null;
    if (who === 'case') return this.voices.find((v) => /Daniel|Google UK English Male|Male|Alex/.test(v.name)) || this.voices[0];
    if (who === 'okafor') return this.voices.find((v) => /Samantha|Female|Google US English|Karen|Serena/.test(v.name)) || this.voices[1] || this.voices[0];
    return this.voices[2] || this.voices[0];
  }
  speak(text, who = 'case') {
    if (!this.synth) return;
    try {
      const u = new SpeechSynthesisUtterance(text.replace(/—/g, ', '));
      const p = PROFILES[who] || PROFILES.pilot;
      u.pitch = p.pitch; u.rate = p.rate; u.volume = 0.85;
      const v = this.pick(who);
      if (v) u.voice = v;
      if (this.synth.pending || this.synth.speaking) {
        // keep at most a short backlog so speech stays in sync with subtitles
        if (this.backlog > 2) this.synth.cancel();
      }
      this.backlog = (this.backlog || 0) + 1;
      u.onend = () => { this.backlog = Math.max(0, this.backlog - 1); };
      this.synth.speak(u);
    } catch { /* speech unavailable */ }
  }
  cancel() { try { this.synth?.cancel(); this.backlog = 0; } catch { /* ignore */ } }
}
