// Far-layer planet: a full-screen ray-traced sphere with scattering
// atmosphere, kept in sync with the far camera.

import { Mesh, PlaneGeometry, ShaderMaterial, Vector3, Matrix3, Color, CustomBlending, OneFactor, OneMinusSrcAlphaFactor, Quaternion } from 'three';
import { PlanetShader } from '../shaders/planet.js';

const LOOK = {
  earth: { kind: 0, betaTint: [1.0, 1.0, 1.0], sunI: 1.8 },
  ocean: { kind: 1, betaTint: [1.6, 1.45, 1.25], sunI: 2.2 },
  ice: { kind: 2, betaTint: [0.9, 0.95, 1.1], sunI: 1.5 },
};

export class PlanetView {
  constructor(pipeline) {
    this.pipeline = pipeline;
    this.material = new ShaderMaterial({
      uniforms: PlanetShader.uniforms,
      vertexShader: PlanetShader.vertexShader,
      fragmentShader: PlanetShader.fragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
    });
    const u = this.material.uniforms;
    u.uCamPos.value = new Vector3();
    u.uCamRot.value = new Matrix3();
    u.uPlanetRot.value = new Matrix3();
    u.uSunDir.value = new Vector3(1, 0, 0);
    u.uSunColor.value = new Color(1, 1, 1);
    u.uAtmoColor.value = new Vector3();
    u.uColOcean.value = new Color();
    u.uColLand.value = new Color();
    u.uColIce.value = new Color();
    this.mesh = new Mesh(new PlaneGeometry(2, 2), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    pipeline.farScene.add(this.mesh);
    this.planet = null;
    this.rotation = 0;
  }

  setPlanet(planet) {
    this.planet = planet;
    this.mesh.visible = !!planet;
    if (!planet) return;
    const look = LOOK[planet.kind];
    const u = this.material.uniforms;
    u.uKind.value = look.kind;
    const R = planet.radius;
    const atm = planet.atmosphere;
    u.uAtmoTop.value = atm ? atm.top / R : 0;
    u.uScaleH.value = atm ? atm.H / R : 0.001;
    u.uDensity.value = atm ? atm.rho0 / 1.225 : 0;
    u.uAtmoColor.value.set(5.8e-6 * R * look.betaTint[0], 13.5e-6 * R * look.betaTint[1], 33.1e-6 * R * look.betaTint[2]);
    u.uColOcean.value.setRGB(...planet.colors.ocean);
    u.uColLand.value.setRGB(...planet.colors.land);
    u.uColIce.value.setRGB(...planet.colors.ice);
    u.uSunI.value = look.sunI;
  }

  // sunDir: unit inertial vector toward the light; sunColor: Color
  update(dt, simTime, sunDir, sunColor, hideSurface = 0) {
    if (!this.planet) return;
    const p = this.pipeline;
    const u = this.material.uniforms;
    const R = this.planet.radius;
    u.uCamPos.value.copy(p.camInertialPos).multiplyScalar(1 / R);
    u.uCamRot.value.setFromMatrix4(p.farCamera.matrixWorld);
    u.uTanHalf.value = Math.tan((p.camera.fov * Math.PI) / 360);
    u.uAspect.value = p.camera.aspect;
    // planet-fixed frame rotates about +Y
    const ang = this.planet.rotationRate * simTime;
    const c = Math.cos(ang), s = Math.sin(ang);
    // inertial -> fixed is rotation by -ang about Y
    u.uPlanetRot.value.set(c, 0, -s, 0, 1, 0, s, 0, c);
    u.uSunDir.value.copy(sunDir);
    u.uSunColor.value.copy(sunColor);
    u.uTime.value += dt;
    u.uHide.value = hideSurface;
  }
}
