// Character voices via the browser's speech synthesis.
//
// Voice quality varies enormously between systems, so every installed
// English voice is scored and the most natural ones win: the neural
// "Natural"/"Online" voices in Edge, Google's voices in Chrome, the
// Premium/Enhanced voices on macOS and iOS. CASE-9 is calm and measured: a
// natural voice at a slightly lowered pitch, never the old heavy pitch-down
// that made cheap voices sound robotic. Each character gets a different
// voice where the system has enough of them, and the player can pick
// CASE-9's voice in Settings. Long lines are spoken sentence by sentence
// (Chrome drops utterances longer than ~15 s).

import { settings } from '../core/settings.js';

const PROFILES = {
  case: { pitch: 0.9, rate: 0.96, gender: 'm' },
  okafor: { pitch: 1.02, rate: 1.0, gender: 'f' },
  halden: { pitch: 0.98, rate: 1.04, gender: 'm' },
  vance: { pitch: 0.86, rate: 0.95, gender: 'm' },
  pilot: { pitch: 1.0, rate: 1.0, gender: 'm' },
};

const MALE = /\b(Daniel|Arthur|Oliver|Ryan|Guy|Christopher|Eric|Brian|Thomas|Davis|Andrew|Roger|Steffan|Liam|William|George|Alex|Fred|Aaron|Tom|Male|James|Rishi|Mark|David)\b/i;
const FEMALE = /\b(Sonia|Libby|Aria|Jenny|Samantha|Serena|Karen|Moira|Tessa|Fiona|Kate|Emma|Ava|Allison|Susan|Zira|Hazel|Female|Michelle|Natasha|Clara|Sara|Victoria|Martha|Joanna|Salli)\b/i;

export function scoreVoice(v) {
  let s = 0;
  const n = v.name || '';
  if (/Natural|Neural/i.test(n)) s += 14;
  if (/Online/i.test(n)) s += 6;
  if (/Premium|Enhanced|Siri/i.test(n)) s += 10;
  if (/Google/i.test(n)) s += 7;
  if (/eSpeak|espeak|Festival|robot/i.test(n)) s -= 20;
  if (/^en-GB/i.test(v.lang)) s += 2;
  else if (/^en-(US|AU|IE|CA)/i.test(v.lang)) s += 1;
  if (v.localService === false) s += 1;
  return s;
}
const genderOf = (v) => (MALE.test(v.name) ? 'm' : FEMALE.test(v.name) ? 'f' : '?');

export class Voice {
  constructor() {
    this.synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
    this.voices = [];
    this.cast = {};
    this.queue = 0;
    if (this.synth) {
      const load = () => {
        this.voices = this.synth.getVoices().filter((v) => v.lang && /^en/i.test(v.lang)).sort((a, b) => scoreVoice(b) - scoreVoice(a));
        this.cast = {};
      };
      load();
      this.synth.onvoiceschanged = load;
    }
  }

  // English voices, best first (for the settings menu)
  list() { return this.voices.map((v) => ({ name: v.name, lang: v.lang, score: scoreVoice(v) })); }

  // choose a distinct, natural voice per character
  pick(who) {
    if (!this.voices.length) return null;
    if (who === 'case') {
      const want = settings.get('voiceName');
      const chosen = want && this.voices.find((v) => v.name === want);
      if (chosen) return chosen;
    }
    if (this.cast[who]) return this.cast[who];
    const prof = PROFILES[who] || PROFILES.pilot;
    const used = new Set(Object.entries(this.cast).filter(([k]) => k !== who).map(([, v]) => v.name));
    if (who !== 'case') { const c = this.pick('case'); if (c) used.add(c.name); }
    const ranked = this.voices.map((v) => ({ v, s: scoreVoice(v) + (genderOf(v) === prof.gender ? 4 : genderOf(v) === '?' ? 0 : -6) - (used.has(v.name) ? 8 : 0) }))
      .sort((a, b) => b.s - a.s);
    this.cast[who] = ranked[0].v;
    return this.cast[who];
  }

  speak(text, who = 'case') {
    if (!this.synth) return;
    try {
      const clean = text.replace(/—/g, ', ').replace(/·/g, ', ').replace(/\s+/g, ' ').trim();
      // speech should follow the subtitles: drop a stale backlog
      if (this.queue > 3) { this.synth.cancel(); this.queue = 0; }
      const prof = PROFILES[who] || PROFILES.pilot;
      const v = this.pick(who);
      const rateScale = settings.get('voiceRate') || 1;
      const parts = clean.match(/[^.!?]+[.!?]*\s*/g) || [clean];
      // merge short fragments so the voice doesn't sound clipped
      const chunks = [];
      for (const p of parts) {
        if (chunks.length && (chunks[chunks.length - 1].length + p.length < 140)) chunks[chunks.length - 1] += p;
        else chunks.push(p);
      }
      for (const c of chunks) {
        const u = new SpeechSynthesisUtterance(c.trim());
        if (v) { u.voice = v; u.lang = v.lang; }
        // natural voices already sound right; nudge cheap ones less
        const natural = v && scoreVoice(v) >= 7;
        u.pitch = natural ? 1 + (prof.pitch - 1) * 0.7 : prof.pitch;
        u.rate = prof.rate * rateScale;
        u.volume = 0.9;
        this.queue++;
        u.onend = u.onerror = () => { this.queue = Math.max(0, this.queue - 1); };
        this.synth.speak(u);
      }
    } catch { /* speech unavailable */ }
  }

  // a sample line for the settings menu
  test() {
    this.cancel();
    this.cast = {};
    this.speak('This is CASE-9. Range two hundred metres, closing at point one. You are doing fine.', 'case');
  }

  cancel() { try { this.synth?.cancel(); this.queue = 0; } catch { /* ignore */ } }
}
