// Keyboard and mouse state with per-frame edge detection and pointer lock.

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.buttons = 0;
    this.mousePressed = new Set();
    this.mouseReleased = new Set();
    this.locked = false;
    this.typing = false;
    this.lastTap = new Map();
    this.doubleTapped = new Set();
    this.lastMouseMove = 0;
    this.listeners = [];
    // Touch and gamepad play without pointer lock ("virtual" lock).
    this.virtual = false;
    this.analog = { x: 0, y: 0 };
    this.padPrev = [];
    this.padSprint = false;

    const on = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); this.listeners.push([target, type, fn, opts]); };
    on(window, 'keydown', (e) => {
      if (this.typing || (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName))) return;
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace', 'F3', 'F2', 'Slash', 'KeyT'].includes(e.code) || (e.ctrlKey && ['KeyS', 'KeyW', 'KeyD'].includes(e.code))) e.preventDefault();
      if (!this.down.has(e.code)) {
        this.pressed.add(e.code);
        const now = performance.now();
        if (now - (this.lastTap.get(e.code) || 0) < 280) this.doubleTapped.add(e.code);
        this.lastTap.set(e.code, now);
      }
      this.down.add(e.code);
    });
    on(window, 'keyup', (e) => {
      this.down.delete(e.code);
      this.released.add(e.code);
    });
    on(window, 'blur', () => { this.down.clear(); this.buttons = 0; });
    on(window, 'mousemove', (e) => {
      // Some browsers report a huge jump on the first move after locking.
      if (Math.abs(e.movementX) > 350 || Math.abs(e.movementY) > 350) return;
      if (this.locked) { this.mouseDX += e.movementX; this.mouseDY += e.movementY; this.lastMouseMove = performance.now(); }
    });
    on(canvas, 'mousedown', (e) => {
      if (!this.locked) return;
      this.buttons |= 1 << e.button;
      this.mousePressed.add(e.button);
    });
    on(window, 'mouseup', (e) => {
      if (this.buttons & (1 << e.button)) this.mouseReleased.add(e.button);
      this.buttons &= ~(1 << e.button);
    });
    on(canvas, 'contextmenu', (e) => e.preventDefault());
    on(window, 'wheel', (e) => { if (this.locked) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    on(document, 'pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) { this.buttons = 0; this.down.clear(); }
      this.onLockChange?.(this.locked);
    });
  }

  dispose() {
    for (const [t, type, fn, opts] of this.listeners) t.removeEventListener(type, fn, opts);
    this.listeners = [];
    this.onLockChange = null;
  }

  lock() {
    if (this.virtual) { this.locked = true; return; }
    try {
      const p = this.canvas.requestPointerLock?.({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => this.canvas.requestPointerLock?.()?.catch?.(() => {}));
    } catch { /* ignore */ }
  }
  unlock() {
    if (this.virtual) { this.locked = false; this.down.clear(); this.buttons = 0; this.analog.x = this.analog.y = 0; }
    if (document.pointerLockElement) document.exitPointerLock();
  }

  // Virtual keys and buttons for touch controls and gamepads.
  pressKey(code) {
    if (!this.down.has(code)) {
      this.pressed.add(code);
      const now = performance.now();
      if (now - (this.lastTap.get(code) || 0) < 280) this.doubleTapped.add(code);
      this.lastTap.set(code, now);
    }
    this.down.add(code);
  }
  releaseKey(code) { if (this.down.delete(code)) this.released.add(code); }
  pressMouse(b) { if (!(this.buttons & (1 << b))) this.mousePressed.add(b); this.buttons |= 1 << b; }
  releaseMouse(b) { if (this.buttons & (1 << b)) this.mouseReleased.add(b); this.buttons &= ~(1 << b); }

  // Standard-mapping gamepad: sticks move and look, triggers break/place.
  pollGamepad(dt) {
    const pads = navigator.getGamepads?.() ?? [];
    const pad = [...pads].find((p) => p && p.connected);
    if (!pad) return null;
    const dz = (v) => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
    const ax = pad.axes.map(dz);
    const btn = pad.buttons.map((b) => b.pressed || b.value > 0.5);
    const used = btn.some(Boolean) || ax.some((v) => v !== 0);
    if (used && !this.virtual) this.virtual = true;
    if (!this.virtual) return null;
    const edge = (i) => btn[i] && !this.padPrev[i];
    const up = (i) => !btn[i] && this.padPrev[i];
    const events = { pause: edge(9), menuConfirm: edge(0), menuBack: edge(1) };
    if (this.locked) {
      this.analog.x = ax[0] ?? 0;
      this.analog.y = -(ax[1] ?? 0);
      const look = 900 * dt;
      this.mouseDX += (ax[2] ?? 0) * Math.abs(ax[2] ?? 0) * look;
      this.mouseDY += (ax[3] ?? 0) * Math.abs(ax[3] ?? 0) * look;
      const keys = { 0: 'Space', 1: 'ShiftLeft', 2: 'KeyR', 3: 'KeyE', 8: 'KeyG', 11: 'F5', 12: 'KeyF', 13: 'KeyQ', 14: 'KeyT', 15: 'KeyM' };
      for (const [i, code] of Object.entries(keys)) {
        if (edge(+i)) this.pressKey(code);
        if (up(+i)) this.releaseKey(code);
      }
      if (edge(10)) this.padSprint = !this.padSprint;
      if (this.padSprint && this.analog.y > 0.5) this.down.add('ControlLeft'); else if (this.padSprint) { this.down.delete('ControlLeft'); if (this.analog.y <= 0.1) this.padSprint = false; }
      if (edge(7)) this.pressMouse(0); if (up(7)) this.releaseMouse(0);
      if (edge(6)) this.pressMouse(2); if (up(6)) this.releaseMouse(2);
      if (edge(4)) this.wheel -= 1;
      if (edge(5)) this.wheel += 1;
    }
    this.padPrev = btn;
    return events;
  }

  key(code) { return this.down.has(code); }
  hit(code) { return this.pressed.has(code); }
  doubleTap(code) { return this.doubleTapped.has(code); }
  axis(neg, pos) {
    let v = (this.key(pos) ? 1 : 0) - (this.key(neg) ? 1 : 0);
    if (pos === 'KeyW' && neg === 'KeyS') v += this.analog.y;
    else if (pos === 'KeyD' && neg === 'KeyA') v += this.analog.x;
    else if (pos === 'KeyA' && neg === 'KeyD') v -= this.analog.x;
    return Math.max(-1, Math.min(1, v));
  }
  mouse(b) { return (this.buttons & (1 << b)) !== 0; }
  click(b) { return this.mousePressed.has(b); }
  release(b) { return this.mouseReleased.has(b); }

  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.mousePressed.clear();
    this.mouseReleased.clear();
    this.doubleTapped.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }
}
