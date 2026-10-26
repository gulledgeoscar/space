// The player's own body, shown in third person and while riding.
import * as THREE from 'three';
import { Entity } from './base.js';
import { buildModel } from './models.js';

export class PlayerAvatar extends Entity {
  constructor(game) {
    super(game, 'avatar');
    this.model = buildModel(this, 'player');
    this.mesh.add(this.model.root);
    this.mesh.visible = false;
    this.phase = 0;
    this.height = 1.8;
    game.scene.add(this.mesh);
  }

  update(dt) {
    const g = this.game;
    const p = g.player;
    this.mesh.visible = g.thirdPerson && !p.dead;
    if (!this.mesh.visible) return;
    this.pos.set(p.box.x, p.box.y, p.box.z);
    if (p.vehicle) this.pos.y -= 0.55;
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = p.yaw + Math.PI;
    const crouch = p.box.h < 1.7;
    this.model.root.position.y = crouch ? -0.2 : 0;
    this.model.body.rotation.x = crouch ? 0.4 : 0;
    this.model.head.rotation.x = -p.pitch * 0.8;
    const speed = Math.hypot(p.vel.x, p.vel.z);
    this.phase += dt * speed * 2.6;
    const s = Math.sin(this.phase) * Math.min(1, speed / 4) * 0.9;
    const m = this.model;
    if (p.vehicle) {
      m.legs.forEach((l) => { l.rotation.x = -1.4; });
      m.arms.forEach((a) => { a.rotation.x = -0.9; });
    } else {
      m.legs[0].rotation.x = s; m.legs[1].rotation.x = -s;
      m.arms[0].rotation.x = -s; m.arms[1].rotation.x = s;
      if (g.tools.swingTime > 0) m.arms[1].rotation.x = -1.2 - Math.sin(g.tools.swingTime * 12) * 0.6;
    }
    this.updateLook(dt);
  }
}

export { THREE };
