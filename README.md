# MERIDIAN

A physics-driven 3D docking game for the browser, built with **Vite + Three.js**.

You fly the Kestrel, a small lander, to and from the Meridian: a twelve-module ring station spinning for 1 g, far from home and close to a black hole. Docking is the heart of the game, and everything runs on real physics in SI units:

- 6-DOF rigid bodies with full inertia tensors, at a fixed 120 Hz timestep.
- RCS jets at their real offsets, so they cause parasitic torque.
- Newtonian orbits and Clohessy–Wiltshire relative motion.
- A rotating station you have to match before it will take you.

The setting is inspired by hard-SF space films, but it is entirely original: characters, ships, logos and dialogue.

## Play

```bash
npm install
npm run dev        # http://localhost:5173
```

Other scripts:

```bash
npm run build      # production build into dist/
npm run preview    # serve the production build
npm test           # physics + docking unit tests (node --test)
```

Chrome, Edge or Firefox with WebGL2 is required. Click the game to capture the mouse; Esc pauses.

### Deploying to GitHub Pages

`.github/workflows/deploy.yml` tests, builds and publishes `dist/` to GitHub Pages on every push to `main`, or when run manually from the Actions tab.

1. In the repository, open **Settings → Pages** and set **Source** to **GitHub Actions**.
2. Merge to `main`, or run the *Deploy to GitHub Pages* workflow by hand.
3. Play at **https://gulledgeoscar.github.io/space/**

`vite.config.js` uses `base: './'`, so the build also works from any sub-path or static host.

## Missions

| # | Mission | What happens |
|---|---------|--------------|
| 1 | **Launch & First Dock** | Switch-by-switch startup checklist, a real ascent (drag ∝ ρv², max-Q, gravity turn, booster staging) and orbit insertion. Then a phasing rendezvous and a drift tutorial: why pointing at the station is wrong. Ends with your first dock. |
| 2 | **Walk the Ship** | Unstrap and walk the Meridian: bridge → corridor → quarters → lab → hydroponics → airlock. Climb the spoke ladder as gravity fades toward the hub, float through the hub to the port, and board the Kestrel. Feel the Coriolis effect along the way. |
| 3 | **The Ocean World** | Undock, wait for the burn window and land at 1.3 g beside a beacon. Then the tidal mega-wave arrives, and a Δv-limited ascent ends in a re-dock on fumes. |
| 4 | **The Ice World** | Fog, snow and frozen clouds. A betrayal: the second lander is stolen, its botched dock explodes, and module nine is torn off the ring. The station is left tumbling, venting and precessing. |
| 5 | **The Spin Dock** | Dock with a ring spinning at ~65 RPM while it nutates, vents and sheds debris. Then fire the rim jets to despin it to zero. |
| 6 | **Free Dock** | Randomised orbit, spin, geometry and propellant. Timed and scored, with a local best-scores table. |

Every docking has a checkpoint; a failed capture or a crash lets you retry from it. Missions unlock in order, and their stages can be replayed from the mission menu.

## Controls

**Flight (Kestrel), Simple** (the default difficulty)

| Key | Action |
|-----|--------|
| Mouse or ↑ ↓ ← → | Point the ship. It holds where you point and never tumbles. |
| W | Near the station: go faster toward the port. Elsewhere: fire the engine; for a guided burn, hold W and it cuts off by itself. |
| S | Slow down / back off |
| Space | Stop (near the station) |
| A D R F | Slide sideways |
| Q / E | Roll |
| H | Take over or hand back the landing |
| C · M · , . | Camera · map · time warp |

Inside 6 km of the Meridian a fly-by-wire flight computer takes over. W and S only set your approach speed. The computer routes you around the ring onto the docking axis, cancels orbital drift and keeps a speed it can always stop from. Inside 400 m it also lines the Kestrel up with the port, matches the station's spin and slows to capture speed in the last metres. Ascents follow the pitch program, with the throttle handled through max-Q and cut at the target apoapsis. Landings are automatic.

**Flight (Kestrel), Realistic and Expert**

| Key | Action |
|-----|--------|
| W / S | Translate forward / back |
| A / D | Translate left / right |
| R / F | Translate up / down |
| Mouse or ↑ ↓ ← → | Pitch / yaw |
| Q / E | Roll |
| Z / X | Throttle up / down (hold Shift for faster), Backspace to cut |
| T | RCS fine / coarse |
| C | Cycle camera: cockpit → chase → docking camera |
| Right mouse / Alt + mouse | Look around (chase: orbit the camera, wheel to zoom) |
| M | Map view: Ap/Pe, target orbit, closest approach |
| , / . | Time warp down / up (1–50×, limited near traffic) |
| G | Landing gear |
| H | Landing assist (surface missions) |
| Space | Stage separation / flip next checklist switch |
| U | Release latches (undock) when docked |
| E | Unstrap and float to the hatch when docked |
| **Simple only** | 1–0 attitude holds (prograde, retrograde, normal, anti-normal, radial out/in, target, anti-target, port-align, burn) |

**On foot**

| Key | Action |
|-----|--------|
| WASD + mouse | Walk and look (Shift to run) |
| Space | Jump |
| E | Interact: doors open as you approach; E for consoles, hatches and the ladder |
| F | Flashlight |
| V | First / third person |
| B | Drop a bolt (watch it Coriolis-drift) |

**Zero-g (hub, Kestrel cabin)**

| Key | Action |
|-----|--------|
| Mouse | Look |
| W A S D | Float. The suit's thrusters stop you when you let go. |
| Space / Ctrl | Up / down |
| Shift | Faster |
| E | Go through a hatch or onto the ladder (a short guided glide) |

**Ladder**: W climbs up toward the hub, S climbs down toward the ring.

Aboard the station, a yellow ◆ marker always points to the next step toward your objective.

**Anywhere**: Tab shows controls and objectives · I switches between the minimal HUD and the full instruments · P physics debug overlay · Esc pause / settings.

Every mission opens on a controls card for the way you start (flying, floating or walking). A smaller reminder card appears the first time a mission switches you to a different mode.

## Difficulty

- **Simple** puts the fly-by-wire flight computer between you and the jets (see the controls above). It adds a guidance arrow, the predicted trajectory and the approach corridor, and loosens the capture tolerances. The computer only commands the same RCS jets and engine you would, burning the same propellant; it never touches the physics.
- **Realistic** captures at closing speed < 0.10 m/s, alignment within 1°, and lateral offset within 0.12 m, with no helpers.
- **Expert** tightens the tolerances further, shows raw numbers only, and gives you just the grainy docking-camera feed inside 300 m.

Settings also cover mouse sensitivity, invert Y, FOV, graphics quality (Low / Medium / High), the time-warp limit, volumes and subtitle size. You can also choose CASE-9's voice: Automatic picks the most natural voice your system has, the list marks natural voices with ★, and TEST VOICE plays a sample.

## The physics

| System | Model |
|--------|-------|
| Rigid bodies | State (x, v, q, **L**) with ω = I⁻¹_world **L**. Orientation is integrated with RK4 (energy drift ~1e-7 over 300 s). Composite mass models use the parallel-axis theorem; fuel burn moves the CoM and inertia. |
| RCS & engine | 24 RCS jets at their real positions, with jet allocation and parasitic torque. Jets heat up and derate. Fuel mass, Isp and Tsiolkovsky Δv are shown on the HUD. |
| Orbits | Universal-variable Kepler propagation. Clohessy–Wiltshire closed-form relative motion in the LVLH frame drives the predicted-trajectory line and closest approach. Two-impulse targeting, Hohmann phasing and prograde/normal/radial burns. |
| Atmosphere | Exponential atmospheres per planet, with drag ½ρv²C_dA, max-Q and Sutton–Graves stagnation heating. Hull thermal mass drives a blackbody reentry glow. |
| Station spin | Ring gravity a = ω²r, fading linearly toward the hub. Coriolis −2ω×v acts on walking, jumping, dropped bolts and ladder climbing. Docking in the rotating frame needs ω matched and the ring on the spin axis, where the port's tangential speed ωr → 0. The HUD shows the ΔL mismatch. |
| Contact & capture | Impulse contacts (restitution 0.42) with damage on hard hits. Soft capture is a 6-DOF spring-damper whose stiffness scales with ω². Implicit damping is applied in the rotating frame, so it is stable at 65 RPM. Then 12 latches engage, and the hard dock merges both bodies, conserving linear and angular momentum about the combined CoM. Undocking is a rigid breakup with separation springs. |
| Station damage | Detached modules fly off on rigid-breakup trajectories (v + ω×r). Venting is real thrust and torque at the breach. Ballast water pumping drives the CoM back onto the axis, and passive nutation damping conserves **L**. Rim jets: 4 × 25 kN at 41.2 m. |
| Time dilation | Kerr metric. The orbital dt/dτ comes from Bardeen–Press–Teukolsky for a near-extremal black hole; the ocean world's orbit gives ~61 000× (about 1 h ≈ 7 years). Ship and Earth clocks are shown on the HUD. |
| Black hole | A ray-marched Schwarzschild null-geodesic shader (a = −3h²x/r⁵). It renders a lensed procedural sky, an Einstein ring and a thin accretion disk with Doppler beaming and gravitational redshift. |
| Tides | The ocean world librates in its tidally locked orbit. The resulting tidal surge (~1 km) travels across the ocean as a mega-wave. |
| Planets | Each planet has its own GM, radius, atmosphere and escape velocity. Rayleigh/Mie scattering is computed in the planet shader and the sky. |

### Approximations (honest list)

- Lensing uses the Schwarzschild metric for the visuals, while the time dilation uses Kerr. The black hole's on-screen distance is artistic.
- The black hole's tidal perturbation on local orbits is ignored. Each planet is the only gravitating body in its mission.
- Debris pieces are point masses on Keplerian paths that only collide with the Kestrel.
- CASE-9's voice uses the browser's speech synthesis, so its quality depends on your system. Edge's "Natural" voices and Chrome's Google voices sound best; subtitles always show.

## Code layout

```
src/
  core/       game loop, renderer pipeline, input, settings, saves, world container
  physics/    rigid bodies, orbital mechanics, rotating frames, time dilation,
              atmosphere, rocket equation, collisions, constants (SI units)
  ship/       Kestrel (dynamics + model), Meridian (dynamics + model + interior),
              docking port and docking system
  player/     piloting, on-foot walker, zero-g floater, interior & surface players,
              primitive-built astronaut
  missions/   one file per mission + scenario helpers, docking director, cinematics
  ui/         HUD, docking HUD, docking camera, map view, menus, subtitles, debug overlay
  audio/      Web Audio synthesis (RCS, engine, hum, latches, klaxons), organ score, voice
  shaders/    black hole / sky, planet atmosphere, ocean, post FX (red-out, camera feed)
  world/      sky, planets, surfaces, particles, geometry helpers
tests/        node --test physics & docking tests
```

Rendering uses two layers: a far scene (the lensed sky and a ray-traced planet), then, after a depth clear, the near scene. A floating origin keeps float precision at orbital distances. Post-processing runs bloom, then PostFX (red-out/grey-out, docking-camera grain, damage), then output. Render poses are interpolated between physics steps.

### Performance

The target is 60 fps on a laptop GPU. The graphics presets:

- **Low**: reduced resolution, no shadows, FXAA, fewer black-hole ray-march steps and a lower-resolution sky.
- **Medium** (default): shadows and 4× MSAA.
- **High**: higher resolution, 4096 shadow maps and GTAO ambient occlusion (soft contact shadows in corners and under furniture).

All presets use generated normal maps for hull plating, interior panels and floor gratings. If you drop frames, use **Settings → Graphics: Low**.

## Dev helpers

- `?mission=N&stage=ID` in the URL jumps straight to a mission stage (for example `?mission=5`, `?mission=3&stage=descent`).
- `window.meridian` is the game instance, and `window.meridianDev` holds the scenario helpers.
