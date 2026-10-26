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

    window.addEventListener('keydown', (e) => {
      if (this.typing || (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName))) return;
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace', 'F3', 'Slash', 'KeyT'].includes(e.code) || (e.ctrlKey && ['KeyS', 'KeyW', 'KeyD'].includes(e.code))) e.preventDefault();
      if (!this.down.has(e.code)) {
        this.pressed.add(e.code);
        const now = performance.now();
        if (now - (this.lastTap.get(e.code) || 0) < 280) this.doubleTapped.add(e.code);
        this.lastTap.set(e.code, now);
      }
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.released.add(e.code);
    });
    window.addEventListener('blur', () => { this.down.clear(); this.buttons = 0; });
    window.addEventListener('mousemove', (e) => {
      if (this.locked) { this.mouseDX += e.movementX; this.mouseDY += e.movementY; this.lastMouseMove = performance.now(); }
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.buttons |= 1 << e.button;
      this.mousePressed.add(e.button);
    });
    window.addEventListener('mouseup', (e) => {
      if (this.buttons & (1 << e.button)) this.mouseReleased.add(e.button);
      this.buttons &= ~(1 << e.button);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('wheel', (e) => { if (this.locked) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) { this.buttons = 0; this.down.clear(); }
      this.onLockChange?.(this.locked);
    });
  }

  lock() {
    try {
      const p = this.canvas.requestPointerLock?.({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => this.canvas.requestPointerLock?.()?.catch?.(() => {}));
    } catch { /* ignore */ }
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  key(code) { return this.down.has(code); }
  hit(code) { return this.pressed.has(code); }
  doubleTap(code) { return this.doubleTapped.has(code); }
  axis(neg, pos) { return (this.key(pos) ? 1 : 0) - (this.key(neg) ? 1 : 0); }
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
