// Persistent player settings (localStorage), with change listeners.

const KEY = 'meridian.settings.v1';

export const DEFAULTS = {
  mouseSensitivity: 1.0,
  invertY: false,
  fov: 70,
  quality: 'medium',         // low | medium | high
  maxWarp: 50,               // 1..50
  difficulty: 'assisted',    // assisted | realistic | expert
  masterVolume: 0.8,
  musicVolume: 0.6,
  voice: true,               // CASE-9 speech synthesis
  subtitleSize: 1.0,
  showFps: false,
};

export const QUALITY = {
  low: { pixelRatio: 0.75, shadows: false, shadowSize: 1024, bloom: true, skyScale: 0.6, bhSteps: 70, cube: 1024, antialias: false },
  medium: { pixelRatio: 1.0, shadows: true, shadowSize: 2048, bloom: true, skyScale: 0.85, bhSteps: 110, cube: 1024, antialias: false },
  high: { pixelRatio: 1.5, shadows: true, shadowSize: 2048, bloom: true, skyScale: 1.0, bhSteps: 160, cube: 2048, antialias: true },
};

// Capture tolerances for each docking difficulty. Realistic is the spec:
// closing speed < 0.1 m/s and alignment within ~1 degree.
export const DIFFICULTY = {
  assisted: { label: 'Assisted', closing: 0.15, tilt: 2.5, lateral: 0.18, lateralVel: 0.4, rollRate: 0.09, roll: 12, helpers: true, trajectory: true, guidance: true, expertCam: false },
  realistic: { label: 'Realistic', closing: 0.10, tilt: 1.0, lateral: 0.12, lateralVel: 0.25, rollRate: 0.05, roll: 8, helpers: false, trajectory: true, guidance: false, expertCam: false },
  expert: { label: 'Expert', closing: 0.07, tilt: 0.75, lateral: 0.08, lateralVel: 0.18, rollRate: 0.035, roll: 5, helpers: false, trajectory: false, guidance: false, expertCam: true },
};

class Settings {
  constructor() {
    this.values = { ...DEFAULTS };
    this.listeners = new Set();
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) Object.assign(this.values, JSON.parse(raw));
    } catch { /* storage unavailable */ }
  }
  get(k) { return this.values[k]; }
  set(k, v) {
    this.values[k] = v;
    try { localStorage.setItem(KEY, JSON.stringify(this.values)); } catch { /* ignore */ }
    for (const fn of this.listeners) fn(k, v);
  }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  get quality() { return QUALITY[this.values.quality] || QUALITY.medium; }
  get difficulty() { return DIFFICULTY[this.values.difficulty] || DIFFICULTY.assisted; }
}

export const settings = new Settings();
