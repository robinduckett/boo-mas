// Keyboard, mouse-follow, touch and gamepad → one move vector + a few edge-triggered actions.
import * as THREE from 'three';
import { clamp } from './utils.js';

const MOVE_KEYS = {
  KeyW: [0, 1], ArrowUp: [0, 1],
  KeyS: [0, -1], ArrowDown: [0, -1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
};

export class Input {
  /** @param opts.stick optional element for the on-screen thumb-stick (touch screens) */
  constructor(surface, opts = {}) {
    this.surface = surface;
    this.keys = new Set();
    this.move = new THREE.Vector2();
    this.pointer = { x: 0, y: 0, active: false, touch: false, id: -1 };
    this.taps = new Map(); // pointerId → where/when a finger went down (a quick lift is a tap)
    this.mode = 'pointer'; // pointer | keys | pad | stick
    this.enabled = true;
    this.events = { boo: false, pause: false, mute: false, any: false, photo: false, globe: false, wreath: false };
    this.look = new THREE.Vector2(); // pointer in -1..1, for the ghost's eyes on the title screen
    this.onGlobe = null; // optional (x, y) => boolean: is this screen point on the minimap?
    this._padBoo = false;
    this._padUse = false;
    // Touch screens get a thumb-stick (see .stick in the CSS). A touch that begins on it steers
    // like a joystick, measured from where the thumb went down; a touch anywhere else on the
    // screen still steers toward the finger, as before. So both ways work, with nothing to set.
    this.stick = { el: opts.stick || null, id: -1, ox: 0, oy: 0, x: 0, y: 0, hx: 0, hy: 0, reach: 40 };
    this._wireStick();

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.events.any = true;
      if (MOVE_KEYS[e.code]) { this.keys.add(e.code); this.mode = 'keys'; e.preventDefault(); return; }
      if (e.code === 'Space' || e.code === 'Enter') { this.events.boo = true; e.preventDefault(); }
      else if (e.code === 'Escape' || e.code === 'KeyP') this.events.pause = true;
      else if (e.code === 'KeyM') this.events.mute = true;
      else if (e.code === 'KeyH') this.events.photo = true;
      else if (e.code === 'KeyG') this.events.globe = true;
      else if (e.code === 'KeyE') this.events.wreath = true;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    const letGo = () => { this.pointer.active = false; this.pointer.id = -1; this.taps.clear(); this._dropStick(); };
    window.addEventListener('blur', () => { this.keys.clear(); letGo(); });

    // The mouse steers from anywhere in the window (the HUD's buttons shouldn't interrupt it), so
    // moves are heard on the window. A touch only steers if it began on the play surface: the first
    // finger down is the steering finger, and any other finger is just a tap.
    window.addEventListener('pointermove', (e) => {
      const p = this.pointer;
      if (e.pointerId === this.stick.id) { this._moveStick(e.clientX, e.clientY); return; }
      if (e.pointerType === 'mouse') {
        if (Math.abs(e.clientX - p.x) + Math.abs(e.clientY - p.y) > 3) this.mode = 'pointer';
        p.active = true; p.touch = false; p.id = -1;
      } else if (e.pointerId !== p.id) return;
      p.x = e.clientX; p.y = e.clientY;
      this.look.set((e.clientX / window.innerWidth) * 2 - 1, -((e.clientY / window.innerHeight) * 2 - 1));
    });
    surface.addEventListener('pointerdown', (e) => {
      const p = this.pointer;
      this.events.any = true;
      const globe = !!(this.onGlobe && this.onGlobe(e.clientX, e.clientY));
      if (e.pointerType === 'mouse') {
        p.x = e.clientX; p.y = e.clientY;
        if (e.button === 0) this.events[globe ? 'globe' : 'boo'] = true;
        return;
      }
      this.taps.set(e.pointerId, { t: performance.now(), x: e.clientX, y: e.clientY, globe });
      if (!globe && p.id === -1) {
        p.id = e.pointerId; p.touch = true; p.active = true; this.mode = 'pointer';
        p.x = e.clientX; p.y = e.clientY;
      }
      try { surface.setPointerCapture(e.pointerId); } catch (_) { /* fine */ }
    });
    const up = (e) => {
      if (e.pointerType === 'mouse') return;
      const p = this.pointer;
      const tap = this.taps.get(e.pointerId);
      this.taps.delete(e.pointerId);
      // a quick tap is a BOO (or, on the minimap, a zoom)
      if (tap && e.type === 'pointerup' && performance.now() - tap.t < 220 && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 14) {
        this.events[tap.globe ? 'globe' : 'boo'] = true;
      }
      if (e.pointerId === p.id) { p.active = false; p.id = -1; }
    };
    surface.addEventListener('pointerup', up);
    surface.addEventListener('pointercancel', up);
    // the mouse leaving the window altogether lets go of the reins
    document.documentElement.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') this.pointer.active = false; });
    document.addEventListener('mouseleave', () => { if (!this.pointer.touch) this.pointer.active = false; });
    surface.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ---------------------------------------------------------------- the thumb-stick

  _wireStick() {
    const s = this.stick, el = s.el;
    if (!el) return;
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || s.id !== -1) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      s.id = e.pointerId;
      s.hx = r.left + r.width / 2; s.hy = r.top + r.height / 2; // where the stick lives
      s.ox = s.x = e.clientX; s.oy = s.y = e.clientY; // it re-centres under the thumb: no lurch on touching it
      s.reach = r.width * 0.24; // how far the knob travels for full speed
      this.events.any = true;
      try { el.setPointerCapture(e.pointerId); } catch (_) { /* fine */ }
      el.classList.add('held');
      this._drawStick();
    });
    const end = (e) => { if (e.pointerId === s.id) this._dropStick(); };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _moveStick(x, y) {
    const s = this.stick;
    s.x = x; s.y = y;
    // push past the rim and the whole stick comes along, so changing direction never needs a long reach back
    const dx = x - s.ox, dy = y - s.oy, d = Math.hypot(dx, dy);
    if (d > s.reach) { s.ox = x - (dx / d) * s.reach; s.oy = y - (dy / d) * s.reach; }
    this._drawStick();
  }

  _dropStick() {
    const s = this.stick;
    if (s.id === -1) return;
    s.id = -1;
    s.x = s.ox = s.hx; s.y = s.oy = s.hy;
    if (s.el) { s.el.classList.remove('held'); this._drawStick(); }
  }

  _drawStick() {
    const s = this.stick, st = s.el.style;
    st.setProperty('--bx', (s.ox - s.hx).toFixed(1) + 'px');
    st.setProperty('--by', (s.oy - s.hy).toFixed(1) + 'px');
    st.setProperty('--kx', (s.x - s.hx).toFixed(1) + 'px');
    st.setProperty('--ky', (s.y - s.hy).toFixed(1) + 'px');
  }

  /** Read-and-clear an edge-triggered action. */
  take(name) {
    const v = this.events[name];
    this.events[name] = false;
    return v;
  }

  /**
   * @param ox, oy  where pointer steering is measured from, in CSS pixels (the middle of the screen,
   *                which is where the camera keeps the ghost)
   */
  update(ox, oy) {
    const m = this.move.set(0, 0);
    if (!this.enabled) return m;

    // gamepad
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad) continue;
      const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
      const mag = Math.hypot(ax, ay);
      if (mag > 0.22) {
        this.mode = 'pad';
        m.set(ax, -ay).multiplyScalar(Math.min(1, (mag - 0.2) / 0.7) / mag);
      } else if (this.mode === 'pad') {
        m.set(0, 0);
      }
      // the bottom two face buttons BOO; the top two use a wreath you are carrying
      const pressed = pad.buttons.slice(0, 2).some((b) => b && b.pressed);
      if (pressed && !this._padBoo) { this.events.boo = true; this.events.any = true; }
      this._padBoo = pressed;
      const use = pad.buttons.slice(2, 4).some((b) => b && b.pressed);
      if (use && !this._padUse) { this.events.wreath = true; this.events.any = true; }
      this._padUse = use;
      if (this.mode === 'pad') return m;
    }

    // the thumb-stick, while a thumb is on it
    const s = this.stick;
    if (s.id !== -1) {
      this.mode = 'stick';
      const dx = (s.x - s.ox) / s.reach, dy = -(s.y - s.oy) / s.reach, d = Math.hypot(dx, dy);
      const dead = 0.16;
      if (d > dead) {
        const mag = Math.min(1, (d - dead) / (1 - dead));
        m.set((dx / d) * mag, (dy / d) * mag);
      }
      return m;
    }
    if (this.mode === 'stick') this.mode = 'pointer';

    if (this.mode === 'keys') {
      for (const code of this.keys) {
        const d = MOVE_KEYS[code];
        if (d) { m.x += d[0]; m.y += d[1]; }
      }
      if (m.lengthSq() > 1) m.normalize();
      return m;
    }

    // pointer-follow: steer toward the cursor, faster the further it is from the middle
    const p = this.pointer;
    if (p.active) {
      const dx = p.x - ox, dy = -(p.y - oy);
      const dist = Math.hypot(dx, dy);
      const dead = p.touch ? 18 : 30;
      const full = Math.min(window.innerWidth, window.innerHeight) * (p.touch ? 0.16 : 0.2);
      if (dist > dead) {
        const mag = clamp((dist - dead) / Math.max(1, full - dead));
        m.set((dx / dist) * mag, (dy / dist) * mag);
      }
    }
    return m;
  }
}
