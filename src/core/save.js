// Progress and best scores (localStorage).

const KEY = 'meridian.progress.v1';

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}

const state = Object.assign({ unlocked: 1, completed: [], freeDockScores: [] }, load());

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

export const progress = {
  get unlocked() { return state.unlocked; },
  isUnlocked(n) { return n <= state.unlocked || n === 6 && state.unlocked >= 2; },
  complete(n) {
    if (!state.completed.includes(n)) state.completed.push(n);
    state.unlocked = Math.max(state.unlocked, Math.min(6, n + 1));
    persist();
  },
  unlockAll() { state.unlocked = 6; persist(); },
  reset() { state.unlocked = 1; state.completed = []; persist(); },
  get scores() { return state.freeDockScores.slice(); },
  addScore(entry) {
    state.freeDockScores.push(entry);
    state.freeDockScores.sort((a, b) => b.score - a.score);
    state.freeDockScores = state.freeDockScores.slice(0, 10);
    persist();
    return state.freeDockScores.indexOf(entry);
  },
};
