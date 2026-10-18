// Fixed-timestep simulation clock, decoupled from rendering.
// The renderer runs at whatever rate the display allows; physics always
// advances in exact PHYSICS_DT steps (120 Hz). Time warp simply runs more
// fixed steps per frame - the step size never changes, so warp never alters
// the physics, only how much of it you see per second.

import { PHYSICS_DT } from './constants.js';

export class FixedStepLoop {
  constructor(dt = PHYSICS_DT, maxStepsPerFrame = 900) {
    this.dt = dt;
    this.maxSteps = maxStepsPerFrame;
    this.acc = 0;
    this.simTime = 0;
    this.stepsLastFrame = 0;
    this.alpha = 0;
    this.dropped = 0;
  }

  // stepFn(dt) is called once per fixed step. Returns steps taken.
  advance(realDt, warp, stepFn) {
    this.acc += Math.min(realDt, 0.1) * warp;
    let n = 0;
    while (this.acc >= this.dt) {
      if (n >= this.maxSteps) { this.dropped += this.acc; this.acc = 0; break; }
      stepFn(this.dt);
      this.acc -= this.dt;
      this.simTime += this.dt;
      n++;
    }
    this.stepsLastFrame = n;
    this.alpha = this.acc / this.dt;
    return n;
  }
}
