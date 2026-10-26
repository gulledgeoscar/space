// Player preferences, kept in localStorage.

const KEY = 'limitless-settings';

export const DEFAULT_SETTINGS = {
  renderDistance: 8,
  fov: 75,
  sensitivity: 1,
  volume: 0.7,
  music: 0.5,
  pixelRatio: 1,
  invertY: false,
  viewBob: true,
  showCoords: true,
  speedMult: 1,
  jumpMult: 1,
};

export function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { ...DEFAULT_SETTINGS, ...s };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ }
}
