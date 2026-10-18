// Cinematic helpers: station-frame cameras, letterboxing, fades.

import { Vector3, Quaternion, Matrix4 } from 'three';

const _m = new Matrix4();

// Camera fixed in the rotating station frame (pos/look in station coords).
export function stationCamera(game, pos, look, { fov = 45, up = null, drift = null } = {}) {
  let t = 0;
  return (dt, origin, cam) => {
    t += dt;
    const root = game.meridianModel.root;
    root.updateMatrixWorld();
    const p = drift ? drift(t, pos.clone()) : pos;
    const u = up || p.clone().setZ(0).normalize().negate();
    _m.lookAt(p, look, u.lengthSq() > 0 ? u : new Vector3(0, 1, 0));
    const q = new Quaternion().setFromRotationMatrix(_m);
    cam.position.copy(p).applyMatrix4(root.matrixWorld);
    cam.quaternion.copy(root.quaternion).multiply(q);
    if (cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
  };
}

// Camera at an inertial offset from a body (follow-cam for cutscenes).
export function orbitCamera(game, body, { dist = 60, yaw = 0.4, pitch = 0.2, fov = 50, speed = 0.02, lookOffset = null } = {}) {
  let t = 0;
  return (dt, origin, cam) => {
    t += dt;
    const p = game.interpBodyPos(body, new Vector3()).sub(origin);
    const a = yaw + t * speed;
    cam.position.set(p.x + Math.sin(a) * Math.cos(pitch) * dist, p.y + Math.sin(pitch) * dist, p.z + Math.cos(a) * Math.cos(pitch) * dist);
    cam.up.set(0, 1, 0);
    cam.lookAt(lookOffset ? p.clone().add(lookOffset) : p);
    if (cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
  };
}

export function* fadeOut(game, sec = 1) { game.ui.setFade(true); yield { real: sec }; }
export function* fadeIn(game, sec = 1) { game.ui.setFade(false); yield { real: sec }; }
