// MERIDIAN - entry point.
import { Game } from './core/game.js';
import * as scenario from './missions/scenario.js';

const canvas = document.getElementById('view');
const root = document.getElementById('ui-root');
let game;
try {
  game = new Game(canvas, root);
} catch (e) {
  root.innerHTML = `<div class="loading" style="color:#ff8f80">WebGL2 is required to run MERIDIAN.<br>${e.message}</div>`;
  throw e;
}
window.meridian = game;
window.meridianDev = scenario;
const params = new URLSearchParams(location.search);
if (params.get('mission')) game.startMission(Number(params.get('mission')), params.get('stage'));
else game.toTitle();
game.start();
