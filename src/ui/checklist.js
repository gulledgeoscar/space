// Pre-launch switch panel: guarded toggles that must be thrown in order,
// with lamps, CASE-9 reading the checklist, and a LAUNCH COMMIT button.

export const STARTUP = [
  { id: 'busA', label: 'MAIN BUS A', say: 'Main bus A.' },
  { id: 'busB', label: 'MAIN BUS B', say: 'Bus B.' },
  { id: 'avion', label: 'AVIONICS', say: 'Avionics.' },
  { id: 'imu', label: 'IMU ALIGN', say: 'Inertial platform aligning. Hold still. Well — the planet is turning. Hold as still as the planet.', delay: 4 },
  { id: 'cells', label: 'FUEL CELLS', say: 'Fuel cells on line.' },
  { id: 'rcs', label: 'RCS PRESS', guard: true, say: 'RCS pressurised. Twenty-four jets ready.' },
  { id: 'eng', label: 'MAIN ENG ARM', guard: true, say: 'Main engine armed.' },
  { id: 'link', label: 'BOOSTER LINK', say: 'Booster link good. Stage one is listening.' },
  { id: 'gnc', label: 'GUIDANCE INT', say: 'Guidance internal. We are flying ourselves now.' },
];

export class SwitchPanel {
  constructor(game, root, items = STARTUP) {
    this.game = game;
    this.items = items.map((it) => ({ ...it, on: false, guardOpen: !it.guard, busy: false }));
    this.next = 0;
    this.el = document.createElement('div');
    this.el.className = 'switchpanel interactive';
    this.el.innerHTML = `<div class="title">KESTREL · PRE-LAUNCH CONFIGURATION</div><div class="row"></div><button class="commit" disabled>LAUNCH COMMIT</button>
      <div style="text-align:center;font:11px var(--mono);color:#8d877a;margin-top:6px">click switches in order (guarded switches: click twice) · or press SPACE for the next item</div>`;
    const row = this.el.querySelector('.row');
    this.items.forEach((it, i) => {
      const sw = document.createElement('div');
      sw.className = 'sw';
      sw.innerHTML = `<div class="lab">${it.label}</div><div class="base"><div class="lever"></div>${it.guard ? '<div class="guard"></div>' : ''}</div><div class="lamp"></div><div class="state">OFF</div>`;
      sw.onclick = () => this.flip(i);
      row.appendChild(sw);
      it.el = sw;
    });
    this.commitBtn = this.el.querySelector('.commit');
    this.commitBtn.onclick = () => { if (this.ready) { this.game.audio?.clunk(0.4, 2); this.onCommit?.(); } };
    root.appendChild(this.el);
    this.refresh();
  }

  get ready() { return this.items.every((i) => i.on); }

  flip(i) {
    const it = this.items[i];
    const say = (t, o) => this.game.ui.subs.say('case', t, o);
    if (it.on || it.busy) return;
    if (i !== this.next) {
      this.game.audio?.blip('bad');
      say(i > this.next ? `Checklist order, please. ${this.items[this.next].label} first. I would hate to explode out of sequence.` : 'Already done.', { key: 'order', cooldown: 4 });
      it.el.classList.add('shake');
      return;
    }
    if (it.guard && !it.guardOpen) { it.guardOpen = true; this.game.audio?.click(); this.refresh(); return; }
    this.game.audio?.click();
    if (it.delay) {
      it.busy = true;
      it.el.querySelector('.state').textContent = 'ALIGN…';
      let blink = 0;
      const iv = setInterval(() => { blink++; it.el.querySelector('.lamp').style.background = blink % 2 ? '#6dff9c' : '#300'; }, 250);
      setTimeout(() => { clearInterval(iv); it.busy = false; this.done(i); }, it.delay * 1000);
      it.el.classList.add('on');
      say(it.say);
      return;
    }
    this.done(i);
    say(it.say, { key: 'sw' + i, cooldown: 1 });
  }

  done(i) {
    const it = this.items[i];
    it.on = true;
    this.next = i + 1;
    this.refresh();
    this.game.audio?.blip('ui');
    if (this.ready) this.game.ui.subs.say('case', 'All systems configured. Launch commit is yours.');
  }

  key(input) { if (input.hit('Space') && this.next < this.items.length) this.flip(this.next); }

  refresh() {
    this.items.forEach((it, i) => {
      it.el.classList.toggle('on', it.on || it.busy);
      it.el.classList.toggle('next', i === this.next);
      it.el.classList.toggle('guard-open', it.guardOpen);
      if (!it.busy) it.el.querySelector('.state').textContent = it.on ? 'ON' : it.guard && !it.guardOpen ? 'GUARDED' : 'OFF';
      if (!it.busy) it.el.querySelector('.lamp').style.background = '';
    });
    this.commitBtn.disabled = !this.ready;
  }

  remove() { this.el.remove(); }
}
