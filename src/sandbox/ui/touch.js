// On-screen controls for phones and tablets. They switch on with the first
// touch, so touchscreen laptops keep the mouse until you actually touch.
//   left thumb: move stick · right side: drag to look, tap to use,
//   hold to break · buttons for jump, sneak, fly, ride, inventory, menu.

export class TouchControls {
  constructor(game) {
    this.game = game;
    this.input = game.input;
    this.enabled = false;
    this.stick = null;     // { id, x, y }
    this.look = null;      // { id, x, y, start, moved }
    this.root = null;
    this.onFirstTouch = () => this.enable();
    window.addEventListener('touchstart', this.onFirstTouch, { passive: true, once: true });
  }

  enable() {
    if (this.enabled) return;
    this.enabled = true;
    const input = this.input;
    input.virtual = true;
    document.body.classList.add('touch');
    const r = document.createElement('div');
    r.className = 'touch-ui';
    r.innerHTML = `
      <div class="look-pad"></div>
      <div class="stick-zone"><div class="stick-base"><div class="stick-knob"></div></div></div>
      <div class="tbtns right">
        <button data-k="Space" class="big">⤒</button>
        <button data-m="0" class="big">⛏</button>
        <button data-m="2">✋</button>
        <button data-k="ShiftLeft">⤓</button>
      </div>
      <div class="tbtns top">
        <button data-k="KeyE">🎒</button>
        <button data-k="KeyF">🕊</button>
        <button data-k="KeyR">🚗</button>
        <button data-k="F5">👁</button>
        <button data-k="KeyT">💬</button>
        <button data-a="pause">❚❚</button>
      </div>`;
    // Under the menus so overlays stay tappable.
    this.game.ui.insertBefore(r, this.game.menus.root);
    this.game.menus.panel?.style && (this.game.menus.panel.style.zIndex = 5);
    this.root = r;
    this.knob = r.querySelector('.stick-knob');
    this.base = r.querySelector('.stick-base');

    // Buttons.
    r.querySelectorAll('button').forEach((b) => {
      const down = (e) => {
        e.preventDefault();
        b.classList.add('on');
        if (b.dataset.a === 'pause') { this.game.menus.showPause(); return; }
        if (!input.locked) return;
        if (b.dataset.k) input.pressKey(b.dataset.k);
        if (b.dataset.m) input.pressMouse(+b.dataset.m);
      };
      const up = (e) => {
        e.preventDefault();
        b.classList.remove('on');
        if (b.dataset.k) input.releaseKey(b.dataset.k);
        if (b.dataset.m) input.releaseMouse(+b.dataset.m);
      };
      b.addEventListener('touchstart', down, { passive: false });
      b.addEventListener('touchend', up, { passive: false });
      b.addEventListener('touchcancel', up, { passive: false });
    });

    // Move stick.
    const zone = r.querySelector('.stick-zone');
    zone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      this.stick = { id: t.identifier, x: t.clientX, y: t.clientY };
      const rect = zone.getBoundingClientRect();
      this.base.style.left = `${t.clientX - rect.left}px`;
      this.base.style.top = `${t.clientY - rect.top}px`;
      this.base.classList.add('on');
    }, { passive: false });
    const moveStick = (t) => {
      const dx = t.clientX - this.stick.x, dy = t.clientY - this.stick.y;
      const max = 50;
      const len = Math.hypot(dx, dy);
      const k = len > max ? max / len : 1;
      this.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      input.analog.x = (dx * k) / max;
      input.analog.y = -(dy * k) / max;
      // Push the stick all the way forward to sprint.
      if (input.analog.y > 0.95) input.down.add('ControlLeft'); else input.down.delete('ControlLeft');
    };
    const endStick = () => {
      this.stick = null;
      input.analog.x = input.analog.y = 0;
      input.down.delete('ControlLeft');
      this.knob.style.transform = '';
      this.base.classList.remove('on');
    };

    // Look pad: drag to look, tap to use, hold still to break.
    const pad = r.querySelector('.look-pad');
    pad.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (this.look) return;
      const t = e.changedTouches[0];
      this.look = { id: t.identifier, x: t.clientX, y: t.clientY, start: performance.now(), moved: 0, breaking: false };
      this.holdTimer = setTimeout(() => {
        if (this.look && this.look.moved < 12 && input.locked) { this.look.breaking = true; input.pressMouse(0); }
      }, 350);
    }, { passive: false });

    this.onMove = (e) => {
      for (const t of e.changedTouches) {
        if (this.stick && t.identifier === this.stick.id) moveStick(t);
        else if (this.look && t.identifier === this.look.id) {
          const dx = t.clientX - this.look.x, dy = t.clientY - this.look.y;
          this.look.x = t.clientX; this.look.y = t.clientY;
          this.look.moved += Math.abs(dx) + Math.abs(dy);
          if (input.locked) { input.mouseDX += dx * 1.6; input.mouseDY += dy * 1.6; input.lastMouseMove = performance.now(); }
        }
      }
    };
    this.onEnd = (e) => {
      for (const t of e.changedTouches) {
        if (this.stick && t.identifier === this.stick.id) endStick();
        else if (this.look && t.identifier === this.look.id) {
          clearTimeout(this.holdTimer);
          if (this.look.breaking) input.releaseMouse(0);
          else if (this.look.moved < 12 && performance.now() - this.look.start < 300 && input.locked) {
            input.pressMouse(2);
            setTimeout(() => input.releaseMouse(2), 60);
          }
          this.look = null;
        }
      }
    };
    window.addEventListener('touchmove', this.onMove, { passive: true });
    window.addEventListener('touchend', this.onEnd, { passive: true });
    window.addEventListener('touchcancel', this.onEnd, { passive: true });
    if (!this.game.menus.open) input.locked = true;
  }

  setVisible(v) { if (this.root) this.root.style.display = v ? '' : 'none'; }

  dispose() {
    window.removeEventListener('touchstart', this.onFirstTouch);
    window.removeEventListener('touchmove', this.onMove);
    window.removeEventListener('touchend', this.onEnd);
    window.removeEventListener('touchcancel', this.onEnd);
    this.root?.remove();
    document.body.classList.remove('touch');
  }
}
