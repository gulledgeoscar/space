import { Vector3 } from 'three';
import { Game } from './core/game.js';
import { circularState, orientStation, placeOnAxis } from './missions/scenario.js';
import { lvlhBasis } from './physics/orbital.js';

const game = new Game(document.getElementById('view'), document.getElementById('ui-root'));
window.game = game;
const W = game.world;
const st = circularState(W.primary, 400e3, 0.3);
W.meridian.body.pos.copy(st.pos); W.meridian.body.vel.copy(st.vel);
const basis = lvlhBasis(st.pos, st.vel);
orientStation(W.meridian, basis.y.clone().negate());
const params = new URLSearchParams(location.search);
placeOnAxis(W, Number(params.get('range') || 40), new Vector3(0.6, -0.4, 0));
game.mode = 'flight';
game.pilot.camMode = params.get('cam') || 'chase';
game.input.wantLock = true;
const dbg = document.createElement('pre');
dbg.style.cssText = 'position:fixed;left:8px;top:8px;color:#9f9;font:12px monospace;margin:0;pointer-events:none';
document.body.appendChild(dbg);
setInterval(() => {
  const r = W.docking.rel;
  dbg.textContent = `phase ${W.docking.phase()}  range ${r.range.toFixed(2)}  closing ${r.closing.toFixed(3)}  lat ${r.lateral.toFixed(3)}\n` +
  `tilt ${r.tilt.toFixed(2)}  roll ${r.roll.toFixed(1)}  rollRate ${r.rollRate.toFixed(3)} spin ${r.spin.toFixed(3)}  fps ${game.fps.toFixed(0)}\n` +
  `fuel ${W.kestrel.fuel.toFixed(0)}  dv ${W.kestrel.deltaVMain().toFixed(0)}  state ${W.docking.state} warp ${game.warp}`;
}, 200);
game.start();
