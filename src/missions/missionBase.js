// Mission framework: coroutine scripting, objectives, checkpoints.
//
// Script generators yield:
//   number          -> wait that many SIM seconds (time warp speeds it up)
//   { real: s }     -> wait real seconds (dialogue pacing)
//   () => bool      -> wait until the predicate is true
//   { all: [...] }  -> nothing special; use yield* for sub-sequences

import { progress } from '../core/save.js';

export class Mission {
  constructor(game, stage = null) {
    this.game = game;
    this.stage = stage;
    this.tasks = [];
    this.checkpointData = null;
    this.checkpointName = '';
    this.objs = [];
    this.failed = false;
    this.done = false;
    this.t = 0;
  }
  get world() { return this.game.world; }
  get ui() { return this.game.ui; }
  get audio() { return this.game.audio; }
  get id() { return this.constructor.id; }

  start() {}
  dispose() { for (const off of this._offs || []) off(); this._offs = []; }
  on(type, fn) { (this._offs ||= []).push(this.game.on(type, fn)); }

  run(gen) {
    const task = { it: gen, wait: null };
    this.tasks.push(task);
    return task;
  }
  stopAll() { this.tasks.length = 0; }

  update(simDt, realDt) {
    this.t += simDt;
    for (let i = 0; i < this.tasks.length; i++) {
      const task = this.tasks[i];
      let guard = 0;
      while (task && guard++ < 50) {
        const w = task.wait;
        if (w !== null && w !== undefined) {
          if (typeof w === 'number') { task.wait = w - simDt; if (task.wait > 0) break; }
          else if (typeof w === 'function') { if (!w()) break; }
          else if (typeof w === 'object' && 'real' in w) { w.real -= realDt; if (w.real > 0) break; }
        }
        const r = task.it.next();
        if (r.done) { this.tasks.splice(i, 1); i--; break; }
        task.wait = r.value ?? null;
        if (typeof task.wait === 'number' && task.wait <= 0) task.wait = null;
      }
    }
  }

  // ---- dialogue ----------------------------------------------------------------
  say(who, text, opts) { this.ui.subs.say(who, text, opts); }
  *line(who, text, pad = 0.4) {
    this.say(who, text);
    yield { real: Math.max(2.4, text.length * 0.062) + pad };
  }
  *lines(list) { for (const [who, text] of list) yield* this.line(who, text); }

  // ---- objectives --------------------------------------------------------------
  objectives(title, sub, items) {
    this.objs = items.map(([id, text]) => ({ id, text, done: false }));
    this.ui.setObjectives(title, sub, this.objs);
  }
  complete(id) { this.ui.completeObjective(id); }

  // ---- checkpoints ---------------------------------------------------------------
  saveCheckpoint(name, extra = {}) {
    this.checkpointName = name;
    this.checkpointData = { world: this.world.snapshot(), extra: JSON.parse(JSON.stringify(extra)), stage: this.stageAt };
    this.ui.toast(`CHECKPOINT · ${name}`);
  }
  canRetry() { return !!this.checkpointData || !!this.retryStage; }
  retry() {
    this.game.restartMission(this.id, this.checkpointStage || this.stage, this.checkpointData);
  }
  reachStage(id) { this.stageAt = id; this.checkpointStage = id; progress.reachStage(this.id, id); }

  fail(title, text) {
    if (this.failed || this.done) return;
    this.failed = true;
    this.stopAll();
    this.game.audio?.blip?.('bad');
    setTimeout(() => this.ui.menus.failed({ title, text }, () => this.retry()), 1800);
    this.game.input.exitLock();
  }

  finish(results) {
    if (this.done) return;
    this.done = true;
    progress.complete(this.id);
    this.game.onMissionComplete(this, results);
  }
}
