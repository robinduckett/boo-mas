// DOM overlay: title, HUD (the spirit meter is a string of bulbs across the top), popups, results.
import * as THREE from 'three';
import { CFG } from './config.js';
import { clamp, tangentToward } from './utils.js';

const $ = (id) => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const HB_COLORS = ['#ff4d63', '#ffd257', '#3fe08a', '#5aa0ff', '#ff7ac0'];
const BUFFS = { star: 'Long string', wreath: 'Perfect circle', cane: 'Sugar rush' };
// Screen-edge pointers: how close together (px) two of a kind are rolled into one, and how many of
// each kind may show at the edge at once. (The globe is the full picture; these are just the headlines.)
const MERGE = { dark: 200, bug: 120, gift: 160 };
const MAX_EDGE = { dark: 2, bug: 2, gift: 1 };
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _t = new THREE.Vector3();

export class UI {
  constructor() {
    this.hud = $('hud');
    this.title = $('title');
    this.pauseEl = $('pause');
    this.results = $('results');
    this.fade = $('fade');
    this.garland = $('garland');
    this.popLayer = $('popups');
    this.bannerEl = $('banner');
    this.hintEl = $('hint');
    this.booBtn = $('boo-btn');
    this.wreathBtn = $('wreath-btn');
    this.clock = $('clock');
    this.hatArrow = $('hat-arrow');
    this.markerLayer = $('markers');
    this.markers = [];
    this._e = { x: 0, y: 0, ang: 0, on: false };
    // bits of HUD the markers should keep out from under
    this._zoneEls = [document.querySelector('#hud .tl'), document.querySelector('.globe-left'), document.querySelector('#hud .tr'), this.clock, document.querySelector('#hud .br'), this.booBtn, this.wreathBtn, $('stick'), this.hintEl];
    this._zoneRects = [];
    this._zoneT = -1e9;

    this.popups = [];
    this.popPool = [];
    this.bulbs = [];
    this.lit = -1;
    this.spirit = 0;
    this.scoreShown = 0;
    this.scoreTarget = 0;
    this.hintTimer = null;
    this.lastClock = '';
    this.sound = () => {};

    $('three-rev').textContent = THREE.REVISION;
    // one chip per power-up, shown while it is running
    this.buffEls = {};
    for (const k in BUFFS) {
      const el = document.createElement('div');
      el.className = 'buff ' + k;
      el.innerHTML = `<i></i><span>${BUFFS[k]}</span>`;
      $('buffs').appendChild(el);
      this.buffEls[k] = el;
    }
    this._buildGarland();
    let rt = 0;
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => this._buildGarland(), 120); });

    // the OO in the logo are eyes, and they watch you
    this.eyes = Array.from(document.querySelectorAll('.logo .eye'));
    window.addEventListener('pointermove', (e) => {
      if (this.title.classList.contains('hidden')) return;
      for (const eye of this.eyes) {
        const r = eye.getBoundingClientRect();
        let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        const l = Math.hypot(dx, dy) || 1;
        const k = Math.min(1, l / 180) / l;
        eye.firstElementChild.style.setProperty('--px', (dx * k).toFixed(3));
        eye.firstElementChild.style.setProperty('--py', (dy * k).toFixed(3));
      }
    });
    const blink = () => {
      for (const eye of this.eyes) eye.classList.add('blink');
      setTimeout(() => { for (const eye of this.eyes) eye.classList.remove('blink'); }, 130);
      setTimeout(blink, 1800 + Math.random() * 3600);
    };
    setTimeout(blink, 1500);
  }

  /** Wire buttons to game actions. `h` = { start, resume, restart, next, retry, share, mute, pause, boo, sound } */
  bind(h) {
    this.sound = h.sound || this.sound;
    const click = (id, fn) => {
      const el = $(id);
      el.addEventListener('click', (e) => { e.currentTarget.blur(); this.sound('click'); fn(e); });
      el.addEventListener('pointerenter', () => this.sound('hover'));
    };
    click('btn-start', h.start);
    click('btn-resume', h.resume);
    click('btn-restart', h.restart);
    click('btn-next', h.next);
    click('btn-retry', h.retry);
    click('btn-share', h.share);
    click('btn-mute', h.mute);
    click('btn-pause', h.pause);
    this.booBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); h.boo(); });
    this.wreathBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); h.wreath(); });
    this.wreathBtn.addEventListener('animationend', (e) => { if (e.animationName === 'nope') this.wreathBtn.classList.remove('nope'); });
  }

  // ------------------------------------------------------------ HUD pieces

  _buildGarland() {
    const svg = this.garland;
    const w = window.innerWidth, H = 76;
    svg.setAttribute('viewBox', `0 0 ${w} ${H}`);
    let swags = Math.max(2, Math.round(w / 310));
    if (swags % 2) swags++;
    const sw = w / swags, sag = Math.min(30, sw * 0.12), y0 = 3;
    let d = `M -10 ${y0}`;
    for (let i = 0; i < swags; i++) d += ` Q ${(i * sw + sw / 2).toFixed(1)} ${y0 + sag * 2} ${((i + 1) * sw + (i === swags - 1 ? 10 : 0)).toFixed(1)} ${y0}`;
    svg.innerHTML = `<path class="wire" d="${d}"/><path class="wire hi" d="${d}" transform="translate(0 -1)"/>`;
    const path = svg.querySelector('.wire');
    const L = path.getTotalLength();
    const n = clamp(Math.round(w / 40), 10, 46);
    this.bulbs = [];
    for (let i = 0; i < n; i++) {
      const at = (L * (i + 0.5)) / n;
      const p = path.getPointAtLength(at), p2 = path.getPointAtLength(Math.min(L, at + 2));
      const ang = (Math.atan2(p2.y - p.y, p2.x - p.x) * 180) / Math.PI;
      const g = document.createElementNS(NS, 'g');
      g.setAttribute('transform', `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${(ang * 0.7).toFixed(1)})`);
      g.innerHTML = `<g class="hb" style="--c:${HB_COLORS[i % HB_COLORS.length]}"><rect class="cap" x="-3.3" y="-1" width="6.6" height="6.5" rx="1.7"/><path class="glass" d="M0 4.5C7 6.5 8 17 0 22C-8 17-7 6.5 0 4.5Z"/></g>`;
      svg.appendChild(g);
      this.bulbs.push(g.firstElementChild);
    }
    this.lit = -1;
    this.setSpirit(this.spirit);
  }

  setSpirit(p) {
    this.spirit = p;
    $('spirit-pct').textContent = Math.round(p * 100) + '%';
    const lit = p >= 1 ? this.bulbs.length : Math.min(this.bulbs.length - 1, Math.floor(p * this.bulbs.length + 0.001));
    if (lit === this.lit) return;
    this.bulbs.forEach((b, i) => b.classList.toggle('on', i < lit));
    this.lit = lit;
  }

  setScore(n, instant = false) {
    this.scoreTarget = n;
    if (instant) { this.scoreShown = n; $('score').textContent = n.toLocaleString('en-US'); }
  }

  bump(id) {
    const el = $(id);
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }

  /** elapsed/duration in seconds; the clock runs 9:00 PM → midnight. */
  setClock(elapsed, duration) {
    const frac = clamp(elapsed / duration);
    const mins = 21 * 60 + Math.floor(frac * 180);
    const h24 = Math.floor(mins / 60) % 24, m = mins % 60;
    const text = `${h24 % 12 || 12}:${String(m).padStart(2, '0')}`;
    if (text !== this.lastClock) {
      this.lastClock = text;
      $('clock-time').textContent = text;
      $('clock-ampm').textContent = h24 >= 12 ? 'PM' : 'AM';
    }
    $('clock-ring').style.strokeDashoffset = (frac * 100).toFixed(2);
    this.clock.classList.toggle('late', duration - elapsed <= 30 && elapsed < duration);
  }

  /** frac: 0 = just fired, 1 = ready. */
  setBoo(frac) {
    this.booBtn.style.setProperty('--p', frac.toFixed(3));
    this.booBtn.classList.toggle('ready', frac >= 1);
  }

  booFired() {
    this.booBtn.classList.remove('fire');
    void this.booBtn.offsetWidth;
    this.booBtn.classList.add('fire');
  }

  setLights(m) {
    const el = $('lights-len');
    const t = String(Math.round(m));
    if (el.textContent !== t) { el.textContent = t; this.bump('lights'); }
  }

  /** n loops in a row; `mul` is what that multiplies the next loop by (the same number its bonus tag will show). */
  setStreak(n, frac, mul = n) {
    const el = $('streak');
    if (n >= 2 && frac > 0) {
      el.classList.add('on');
      $('streak-text').textContent = `Jolly streak ×${+mul.toFixed(2)}`;
      $('streak-bar').style.setProperty('--f', frac.toFixed(3));
    } else el.classList.remove('on');
  }

  setMuted(m) {
    $('btn-mute').classList.toggle('off', m);
  }

  /** Which power-ups are running. list: [{ kind: 'star' | 'wreath' | 'cane', p: fraction of its time left }] */
  setBuffs(list) {
    for (const k in this.buffEls) {
      const el = this.buffEls[k];
      let it = null;
      for (const b of list) if (b.kind === k) it = b;
      if (el._on !== !!it) { el._on = !!it; el.classList.toggle('on', !!it); }
      if (!it) continue;
      el.style.setProperty('--p', clamp(it.p).toFixed(3));
      const low = it.p < 0.28;
      if (el._low !== low) { el._low = low; el.classList.toggle('low', low); }
    }
  }

  /**
   * The wreath you are carrying (or not). `n` is how many things its ring would catch from here;
   * `good` makes the button pulse: this is the place.
   */
  setWreath(held, n = 0, good = false) {
    const el = this.wreathBtn;
    if (el._on !== held) {
      el._on = held;
      el.className = held ? 'wreath-btn on' : 'wreath-btn'; // a fresh start each time: no stale pulse or shake
      el._n = -1; el._good = false;
    }
    if (!held) return;
    if (el._n !== n) { el._n = n; $('wreath-count').textContent = n; el.classList.toggle('none', n === 0); }
    if (el._good !== good) { el._good = good; el.classList.toggle('good', good); }
  }

  /** "Not here": the wreath button shakes its head. */
  wreathNope() {
    const el = this.wreathBtn;
    el.classList.remove('nope');
    void el.offsetWidth;
    el.classList.add('nope');
  }

  /** Something just went dark: the spirit meter winces. */
  lost() {
    const el = $('spirit');
    el.classList.remove('lost');
    void el.offsetWidth;
    el.classList.add('lost');
  }

  setPauseInfo(text) {
    $('pause-info').textContent = text;
  }

  hint(html, seconds = 4.5) {
    clearTimeout(this.hintTimer);
    if (!html) { this.hintEl.classList.remove('on'); return; }
    this.hintEl.innerHTML = html;
    this.hintEl.classList.add('on');
    if (seconds > 0) this.hintTimer = setTimeout(() => this.hintEl.classList.remove('on'), seconds * 1000);
  }

  banner(title, sub = '', hold = false) {
    const el = this.bannerEl;
    el.innerHTML = `<h3>${title}</h3>${sub ? `<p>${sub}</p>` : ''}`;
    el.classList.remove('on', 'hold');
    void el.offsetWidth;
    el.classList.add(hold ? 'hold' : 'on');
  }

  clearBanner() {
    this.bannerEl.classList.remove('on', 'hold');
  }

  /** Floating text pinned to a point in the world. */
  popup(pos, html, cls = 'score', life = 1.2) {
    let el = this.popPool.pop();
    if (!el) {
      el = document.createElement('div');
      el.appendChild(document.createElement('span'));
    }
    el.className = 'pop ' + cls;
    el.firstChild.innerHTML = html;
    el.style.transform = 'translate(-999px,-999px)';
    this.popLayer.appendChild(el);
    // a big loop's middle can be well off screen; its combo still deserves to be seen
    this.popups.push({ el, pos: pos.clone(), t: life, keep: cls.startsWith('combo') });
  }

  // ------------------------------------------------------------ screens

  showTitle(show) { this.title.classList.toggle('hidden', !show); }
  showHUD(show) { this.hud.classList.toggle('hidden', !show); }
  showPause(show) {
    this.pauseEl.classList.toggle('hidden', !show);
    this.hud.classList.toggle('paused', show); // the pointers step back while the game is paused
  }
  hideLoading() { this.fade.classList.remove('on'); }
  setSeed(seed) { $('seed-label').textContent = seed; }

  showResults(r) {
    if (!r) { this.results.classList.add('hidden'); return; }
    $('res-title').textContent = r.title;
    $('res-sub').innerHTML = r.sub;
    $('st-spirit').textContent = Math.round(r.spirit * 100) + '%';
    $('st-loops').textContent = r.loops;
    $('st-big').textContent = r.biggest ? `×${r.biggest}` : '—';
    $('st-wrapped').textContent = r.wrapped;
    $('st-live').textContent = r.live || 0;
    $('res-keep').innerHTML = r.keep || '';
    $('st-time').textContent = r.win ? `${Math.floor(r.timeLeft / 60)}:${String(Math.floor(r.timeLeft % 60)).padStart(2, '0')}` : '—';
    $('st-score').textContent = r.score.toLocaleString('en-US');
    $('res-best').innerHTML = r.isBest ? '<b>New best!</b>' : r.best ? `Best: <b>${r.best.toLocaleString('en-US')}</b>` : '';
    $('btn-next').textContent = `Night ${r.night + 1} →`;
    const stars = $('stars').children;
    for (let i = 0; i < stars.length; i++) {
      stars[i].classList.remove('on');
      void stars[i].getBoundingClientRect();
      if (i < r.stars) stars[i].classList.add('on');
    }
    this.results.classList.remove('hidden');
  }

  // ------------------------------------------------------------ per-frame

  /**
   * Where on screen to draw a pointer to a world position. If the thing is in view that is simply
   * where it is; otherwise the result is clamped to the screen edge, with the angle an arrow should
   * point. `frame` is the ghost (p, u, right): given it, something hidden by the planet itself is
   * pointed at along the way you would steer to reach it — where it "would" project to through
   * the planet means nothing.
   */
  _edge(worldPos, camera, m, frame = null) {
    const w = window.innerWidth, h = window.innerHeight, cx = w / 2, cy = h / 2;
    let x, y, lost = false; // lost = can't be seen at all: over the horizon, or behind the camera
    const len = worldPos.length();
    if (frame && camera.position.dot(worldPos) < len * (CFG.R - 0.4)) {
      tangentToward(frame.p, _n.copy(worldPos).multiplyScalar(1 / len), _t);
      x = cx + _t.dot(frame.right) * w;
      y = cy - _t.dot(frame.u) * w;
      if (_t.lengthSq() === 0) y = cy + w; // dead opposite: any way will do
      lost = true;
    } else {
      _v.copy(worldPos).project(camera);
      x = (_v.x * 0.5 + 0.5) * w;
      y = (-_v.y * 0.5 + 0.5) * h;
      if (_v.z > 1) { x = w - x; y = h - y; lost = true; }
    }
    const e = this._e;
    // keep clear of the garland along the top. (The rest of the HUD — buttons, the globe, a
    // notification if one is showing — is dodged piece by piece in setMarkers, wherever it is.)
    const top = m + 64, bottom = h - m - 8;
    e.on = !lost && x > m && x < w - m && y > top && y < bottom;
    e.ang = 90;
    if (!e.on) {
      let dx = x - cx, dy = y - cy;
      if (lost) { const l = Math.hypot(dx, dy) || 1; dx = (dx / l) * w; dy = (dy / l) * w; }
      const ky = dy > 0 ? (bottom - cy) / Math.max(1, dy) : (cy - top) / Math.max(1, -dy);
      const k = Math.min(1, (cx - m) / Math.max(1, Math.abs(dx)), ky);
      e.ang = (Math.atan2(dy, dx) * 180) / Math.PI;
      x = cx + dx * k; y = cy + dy * k;
    }
    e.x = x; e.y = y;
    return e;
  }

  /** Where to point when the hat has been knocked off (null hides the marker). */
  setHatArrow(worldPos, camera, frame = null) {
    const el = this.hatArrow;
    if (!worldPos) { el.classList.add('hidden'); return; }
    const e = this._edge(worldPos, camera, 56, frame);
    if (e.on) e.y -= 74; // hover above the hat, pointing down at it
    el.style.transform = `translate(${e.x.toFixed(1)}px, ${e.y.toFixed(1)}px)`;
    el.style.setProperty('--a', e.ang.toFixed(1) + 'deg');
    el.classList.remove('hidden');
  }

  /** Where the HUD is, so markers can keep clear of it. Measured now and then, not every frame. */
  _zones() {
    const now = performance.now();
    if (now - this._zoneT > 350) {
      this._zoneT = now;
      const out = this._zoneRects;
      out.length = 0;
      for (const el of this._zoneEls) {
        if (el === this.hintEl && !el.classList.contains('on')) continue;
        const r = el.getBoundingClientRect();
        if (r.width > 0) out.push(r);
      }
    }
    return this._zoneRects;
  }

  /**
   * Pointers to things in the world. `items` is a fixed array of slots; an empty slot is null.
   * item: { pos: Vector3, kind, pin, edge, p, n }
   *   kind  'bug' | 'bulb' | 'group' | 'gift' | 'star' | 'wreath' | 'cane' (the CSS class)
   *   pin   hover over the thing while it is in view
   *   edge  sit at the edge of the screen, pointing the way, while it is not
   *   p     0..1 for the countdown ring some kinds have
   *   n     a count to show as a badge (groups)
   * Items should come nearest-first within a kind: when pointers are rolled together, or there are
   * too many, it is the earlier ones that are kept.
   */
  setMarkers(items, camera, frame = null) {
    const zones = this._zones(), w = window.innerWidth, h = window.innerHeight, S = this._marks || (this._marks = []);
    const count = this._edgeCount || (this._edgeCount = { dark: 0, bug: 0, gift: 0 });
    count.dark = count.bug = count.gift = 0;
    // pass 1: where does each one go, and is it showing?
    for (let i = 0; i < items.length; i++) {
      const it = items[i], s = S[i] || (S[i] = { show: false, on: false, x: 0, y: 0, ang: 0, n: 0, kind: '', fam: '', p: 0 });
      s.show = false;
      if (!it) continue;
      const e = this._edge(it.pos, camera, it.kind.startsWith('gift') ? 26 : 36, frame);
      s.on = e.on;
      s.show = e.on ? it.pin : it.edge;
      if (!s.show) continue;
      s.kind = it.kind; s.p = it.p; s.n = it.n || 1; s.ang = e.ang; s.x = e.x;
      s.fam = it.kind === 'group' || it.kind === 'bulb' ? 'dark' : it.kind.startsWith('gift') ? 'gift' : it.kind === 'bug' ? 'bug' : '';
      s.y = e.on ? e.y - 46 : e.y;
      // slide out from under the HUD: down from anything in the top half, up from anything below
      for (const z of zones) {
        if (s.x > z.left - 24 && s.x < z.right + 24 && s.y > z.top - 24 && s.y < z.bottom + 24) s.y = z.top + z.bottom < h ? z.bottom + 24 : z.top - 24;
      }
      if (s.on) continue;
      if (s.fam) {
        // Pointers of a kind that lie the same way from the edge of the screen are rolled into
        // one, with a count (and, for chewing Humbugs, the most urgent of their countdowns)...
        let merged = false;
        for (let j = 0; j < i; j++) {
          const o = S[j];
          if (!o.show || o.on || o.fam !== s.fam || Math.hypot(o.x - s.x, o.y - s.y) > MERGE[s.fam]) continue;
          o.n += s.n;
          if (s.fam === 'dark') o.kind = 'group';
          if (s.p > o.p) o.p = s.p;
          merged = true;
          break;
        }
        // ...and only so many of each kind show at once: the nearest, or the most urgent
        if (merged || ++count[s.fam] > MAX_EDGE[s.fam]) { s.show = false; continue; }
      }
      // two different pointers on the same spot: shuffle this one along the edge
      for (let j = 0; j < i; j++) {
        const o = S[j];
        if (!o.show || o.on || Math.abs(o.x - s.x) > 40 || Math.abs(o.y - s.y) > 40) continue;
        if (s.x < 60 || s.x > w - 60) s.y = o.y + (o.y + 46 < h - 60 ? 46 : -46);
        else s.x = o.x + (o.x + 46 < w - 60 ? 46 : -46);
      }
    }
    // pass 2: put them there
    for (let i = 0; i < items.length; i++) {
      let el = this.markers[i];
      const s = S[i];
      if (!s.show) { if (el && !el._hid) { el._hid = true; el.classList.add('hidden'); } continue; }
      if (!el) {
        el = document.createElement('div');
        el.className = 'marker hidden';
        el.style.transform = 'translate(-99px,-99px)';
        el.innerHTML = '<u><b></b><em></em></u><i></i>';
        el._badge = '';
        this.markerLayer.appendChild(el);
        this.markers[i] = el;
      }
      const cls = 'marker ' + s.kind + (s.on ? ' on' : '');
      if (el._cls !== cls || el._hid) { el._cls = cls; el.className = cls; }
      el._hid = false;
      el.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px)`;
      el.style.setProperty('--a', s.ang.toFixed(1) + 'deg');
      el.style.setProperty('--p', clamp(s.p).toFixed(3));
      const badge = s.n > 1 ? String(s.n) : '';
      if (el._badge !== badge) { el._badge = badge; el.firstChild.lastChild.textContent = badge; }
    }
  }

  setPower(on) {
    $('lights').classList.toggle('power', on);
  }

  update(dt, camera) {
    const w = window.innerWidth, h = window.innerHeight;
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.t -= dt;
      if (p.t <= 0) {
        p.el.remove();
        this.popPool.push(p.el);
        this.popups.splice(i, 1);
        continue;
      }
      _v.copy(p.pos).project(camera);
      let x = (_v.x * 0.5 + 0.5) * w, y = (-_v.y * 0.5 + 0.5) * h;
      if (p.keep) {
        if (_v.z > 1) { x = w / 2; y = h * 0.3; }
        x = clamp(x, w * 0.2, w * 0.8);
        y = clamp(y, h * 0.24, h * 0.66);
      } else if (_v.z > 1) { p.el.style.transform = 'translate(-999px,-999px)'; continue; }
      p.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
    if (this.scoreShown !== this.scoreTarget) {
      const d = this.scoreTarget - this.scoreShown;
      this.scoreShown = Math.abs(d) < 3 ? this.scoreTarget : this.scoreShown + d * Math.min(1, dt * 9);
      $('score').textContent = Math.round(this.scoreShown).toLocaleString('en-US');
    }
  }
}
