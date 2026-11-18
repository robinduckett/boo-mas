// The minimap: the whole planet in a glass bauble, hanging under the spirit meter.
//
// It is not a second 3D render. Everything on it is a point (or a short line) on the unit sphere, so
// drawing it is just an orthographic projection onto a 2D canvas: rotate each point into Boo's own
// frame (screen-right, up-the-screen, out-of-the-planet); x and y are then where it goes on the disc,
// and z says which side of the globe it is on.
//
// Boo is always in the middle, facing you, and the globe turns underneath him. That makes it a compass
// as well as a map: the bearing of any dot from the middle of the globe is exactly the direction to
// steer on screen to reach it. That stays true for the far side, which you see *through* the glass —
// a great circle through Boo projects to a straight line through the centre, so a dim dot up and to
// the left is over the horizon, up and to the left.
import * as THREE from 'three';
import { CFG } from './config.js';
import { clamp, TAU } from './utils.js';

const _hat = new THREE.Vector3();
const GOLD = [255, 210, 87], RED = [255, 96, 116], ICE = [200, 228, 255], BLUE = [130, 178, 255], GREEN = [110, 235, 160];
const PICK = { star: ['gold', '#fff3b8'], wreath: ['green', '#c9ffe0'], cane: ['red', '#ffe3e8'] }; // glow sprite, sparkle colour
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`;

/** A soft round glow, drawn once and stamped wherever something should shine. */
function glowSprite(c, core = 1) {
  const s = 64, cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const x = cv.getContext('2d');
  const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, rgba(c, core));
  g.addColorStop(0.22, rgba(c, core * 0.55));
  g.addColorStop(0.55, rgba(c, core * 0.14));
  g.addColorStop(1, rgba(c, 0));
  x.fillStyle = g;
  x.fillRect(0, 0, s, s);
  return cv;
}

// Boo, in a 1×1 box centred on the origin (y down, as the canvas has it).
const BOO_BODY = new Path2D('M-.4.5V-.04C-.4-.3-.22-.48 0-.48S.4-.3.4-.04V.5L.27.38.135.5 0 .38-.135.5-.27.38Z');
const BOO_HAT = new Path2D('M-.36-.3C-.3-.62.06-.78.3-.62.42-.54.46-.42.45-.3.36-.4.26-.43.17-.4Z');
const BOO_BRIM = new Path2D('M-.45-.36H.2A.065.065 0 0 1 .2-.23H-.45A.065.065 0 0 1-.45-.36Z');

export class Minimap {
  /** @param root the #globe element (holds the canvas and the "N to light" chip) */
  constructor(root) {
    this.root = root;
    this.canvas = root.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.countEl = root.querySelector('.globe-left b');
    this.world = null;
    this.N = 0;
    this.pts = new Float32Array(0); // unit vectors of everything that can be lit
    this.X = new Float32Array(0);
    this.Y = new Float32Array(0);
    this.Z = new Float32Array(0);
    this.was = new Uint8Array(0); // lit last frame? (a change makes a ping)
    this.flash = new Float32Array(0);
    this.grat = [];
    this.gratXY = new Float32Array(0);
    this.pings = [];
    this.t = 0;
    this.left = -1;
    this.D = 0;
    this.S = 0;
    this.c = 0;
    this.r = 0;
    this.dpr = 1;
    this.veil = null;
    this.sonarT = 0;
    this.hatT = 0;

    this.glow = { gold: glowSprite(GOLD), ice: glowSprite(ICE), red: glowSprite(RED), green: glowSprite(GREEN), white: glowSprite([255, 255, 255]) };

    let big = false;
    try { big = localStorage.getItem('boomas.globe') === 'big'; } catch (_) { /* private mode */ }
    this.big = big;
    root.classList.toggle('big', big);

    this._buildGraticule();
    if (window.ResizeObserver) new ResizeObserver(() => this._measure()).observe(root);
    window.addEventListener('resize', () => this._measure());
    this._measure();
  }

  // ---------------------------------------------------------------- size

  _measure() {
    const D = this.root.clientWidth; // 0 while the HUD is display:none (photo mode)
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    if (D === this.D && dpr === this.dpr) return;
    this.D = D;
    this.dpr = dpr;
    if (!D) return;
    // the canvas is a little bigger than the glass, so glows (and the Great Tree) can poke past the rim
    const pad = Math.ceil(D * 0.16);
    const S = (this.S = D + pad * 2);
    this.c = S / 2;
    this.r = D / 2 - 2.5;
    const cv = this.canvas;
    cv.width = cv.height = Math.round(S * dpr);
    cv.style.width = cv.style.height = S + 'px';
    cv.style.left = cv.style.top = -pad + 'px';
    // looking through the middle of a glass ball you look through the most glass: the far side is
    // dimmest dead centre (the antipode, as far away as anything gets) and clearest near the rim
    const v = (this.veil = this.ctx.createRadialGradient(this.c, this.c, 0, this.c, this.c, this.r));
    v.addColorStop(0, 'rgba(9,13,50,0.56)');
    v.addColorStop(0.7, 'rgba(9,13,50,0.40)');
    v.addColorStop(1, 'rgba(9,13,50,0.06)');
  }

  /** Is this screen point (CSS px) on the globe? */
  contains(x, y) {
    if (!this.D) return false;
    const b = this.root.getBoundingClientRect();
    return Math.hypot(x - (b.left + b.width / 2), y - (b.top + b.height / 2)) <= b.width / 2 + 4;
  }

  /** Small ↔ big. */
  toggle() {
    this.big = !this.big;
    const el = this.root;
    el.classList.toggle('big', this.big);
    el.classList.remove('resized'); // (not "pop": that class belongs to the floating score text)
    void el.offsetWidth;
    el.classList.add('resized');
    try { localStorage.setItem('boomas.globe', this.big ? 'big' : 'small'); } catch (_) { /* fine */ }
    this._measure();
    return this.big;
  }

  // ---------------------------------------------------------------- data

  _buildGraticule() {
    // latitude rings and meridians about the pole — which is where the Great Tree stands
    const lines = [];
    for (let k = 1; k <= 5; k++) {
      const a = (k * Math.PI) / 6, n = 48, p = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const th = (i / n) * TAU;
        p[i * 3] = Math.sin(a) * Math.cos(th); p[i * 3 + 1] = Math.cos(a); p[i * 3 + 2] = Math.sin(a) * Math.sin(th);
      }
      lines.push(p);
    }
    for (let k = 0; k < 4; k++) {
      const lon = (k * Math.PI) / 4, n = 64, p = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const th = (i / n) * TAU;
        p[i * 3] = Math.sin(th) * Math.cos(lon); p[i * 3 + 1] = Math.cos(th); p[i * 3 + 2] = Math.sin(th) * Math.sin(lon);
      }
      lines.push(p);
    }
    this.grat = lines;
    this.gratXY = new Float32Array(64 * 3);
  }

  _adopt(world) {
    this.world = world;
    const L = world.lightables, N = (this.N = L.length);
    this.pts = new Float32Array(N * 3);
    this.X = new Float32Array(N);
    this.Y = new Float32Array(N);
    this.Z = new Float32Array(N);
    this.was = new Uint8Array(N);
    this.flash = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const n = L[i].n;
      this.pts[i * 3] = n.x; this.pts[i * 3 + 1] = n.y; this.pts[i * 3 + 2] = n.z;
      this.was[i] = L[i].lit ? 1 : 0;
    }
    this.pings.length = 0;
    this.left = -1;
  }

  /** An expanding ring on the globe at unit vector n. kind: 'gold' | 'red' | 'ice' | 'boo' */
  ping(n, kind = 'gold') {
    if (kind === 'boo') this._ping(n.x, n.y, n.z, BLUE, CFG.boo.radius / CFG.R, 0.55, 1);
    else this._ping(n.x, n.y, n.z, kind === 'red' ? RED : kind === 'ice' ? ICE : GOLD, 0.2, 0.7, 1);
  }

  _ping(x, y, z, color, a0, life, gain) {
    if (this.pings.length > 40) this.pings.shift();
    this.pings.push({ x, y, z, color, a0, life, gain, t: 0 });
  }

  // ---------------------------------------------------------------- drawing

  /** Draw one frame. `game` supplies world, ghost, garland, humbugs, presents, pickups, wreath. */
  update(dt, game) {
    const W = game.world, g = game.ghost;
    if (W !== this.world) this._adopt(W);
    if (!this.D) return;
    const ctx = this.ctx, c = this.c, r = this.r, calm = game.calmMotion;
    const t = (this.t += dt);
    const rx = g.right.x, ry = g.right.y, rz = g.right.z;
    const ux = g.u.x, uy = g.u.y, uz = g.u.z;
    const px = g.p.x, py = g.p.y, pz = g.p.z;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.S, this.S);
    ctx.lineCap = ctx.lineJoin = 'round';

    // ---- project everything that can be lit, and notice what changed
    const N = this.N, src = this.pts, X = this.X, Y = this.Y, Z = this.Z, was = this.was, fl = this.flash, L = W.lightables;
    let left = 0;
    for (let i = 0; i < N; i++) {
      const a = src[i * 3], b = src[i * 3 + 1], d = src[i * 3 + 2];
      X[i] = c + (a * rx + b * ry + d * rz) * r;
      Y[i] = c - (a * ux + b * uy + d * uz) * r;
      Z[i] = a * px + b * py + d * pz;
      const lit = L[i].lit ? 1 : 0;
      if (lit !== was[i]) {
        was[i] = lit;
        fl[i] = 1;
        this._ping(a, b, d, lit ? GOLD : RED, lit ? 0.17 : 0.24, lit ? 0.6 : 0.9, lit ? 0.8 : 1);
      } else if (fl[i] > 0) fl[i] = Math.max(0, fl[i] - dt * 1.7);
      if (!lit) left++;
    }
    if (left !== this.left) {
      this.left = left;
      this.countEl.textContent = left;
      this.root.classList.toggle('few', left > 0 && left <= 6);
      this.root.classList.toggle('done', left === 0);
    }
    // the last few get a sonar ping, so the endgame isn't a hunt
    if (left > 0 && left <= 6) {
      this.sonarT -= dt;
      if (this.sonarT <= 0) {
        this.sonarT = 1.5;
        for (let i = 0; i < N; i++) if (!was[i]) this._ping(src[i * 3], src[i * 3 + 1], src[i * 3 + 2], ICE, 0.3, 1.2, 0.9);
      }
    } else this.sonarT = 0;

    const ru = clamp(r * 0.036, 1.7, 5.2); // unlit dot
    const rs = clamp(r * 0.024, 1.15, 3.6); // lit speck
    const pts = game.garland.pts, nG = pts.length;
    const power = game.garland.bonus > 0;
    // a ripple of brightness runs outward from Boo through the unlit dots (and on round the back)
    const wave = (z) => (calm ? 0.6 : 0.5 + 0.5 * Math.sin(t * 3.1 - Math.acos(clamp(z, -1, 1)) * 3.4));

    // ================================================= the far side, through the glass
    this._graticule(ctx, false, rx, ry, rz, ux, uy, uz, px, py, pz, 'rgba(165,195,255,0.13)');
    if (nG > 1) this._string(ctx, pts, g, false, power ? 'rgba(255,214,110,0.6)' : 'rgba(255,226,170,0.5)', Math.max(1, r * 0.016));

    ctx.fillStyle = 'rgba(255,205,110,0.62)';
    ctx.beginPath();
    for (let i = 0; i < N; i++) if (Z[i] < 0 && was[i]) { ctx.moveTo(X[i] + rs * 0.75, Y[i]); ctx.arc(X[i], Y[i], rs * 0.75, 0, TAU); }
    ctx.fill();
    const few = left <= 6; // the last stragglers must be findable even round the back
    if (few) {
      ctx.globalCompositeOperation = 'lighter';
      const hs = r * 0.2;
      for (let i = 0; i < N; i++) {
        if (Z[i] >= 0 || was[i]) continue;
        ctx.globalAlpha = 0.5 + 0.4 * wave(Z[i]);
        ctx.drawImage(this.glow.ice, X[i] - hs, Y[i] - hs, hs * 2, hs * 2);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.fillStyle = few ? '#ffffff' : 'rgba(206,230,255,0.92)';
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      if (Z[i] >= 0 || was[i]) continue;
      const q = ru * (few ? 0.95 : 0.66 + 0.2 * wave(Z[i]));
      ctx.moveTo(X[i] + q, Y[i]); ctx.arc(X[i], Y[i], q, 0, TAU);
    }
    ctx.fill();
    this._bugs(ctx, game, false, rx, ry, rz, ux, uy, uz, px, py, pz, t);
    this._tree(ctx, W, false, rx, ry, rz, ux, uy, uz, px, py, pz);
    const wreath = game.wreath;
    if (wreath.alpha > 0.02) this._ring(ctx, wreath, false, rx, ry, rz, ux, uy, uz, px, py, pz, t);

    ctx.fillStyle = this.veil;
    ctx.beginPath(); ctx.arc(c, c, r, 0, TAU); ctx.fill();

    // ================================================= the near side
    this._graticule(ctx, true, rx, ry, rz, ux, uy, uz, px, py, pz, 'rgba(175,205,255,0.2)');

    // frozen ponds, as landmarks
    ctx.fillStyle = 'rgba(150,212,255,0.2)';
    for (const pond of W.ponds) {
      const n = pond.n, z = n.x * px + n.y * py + n.z * pz;
      if (z <= 0.05) continue;
      const x = n.x * rx + n.y * ry + n.z * rz, y = n.x * ux + n.y * uy + n.z * uz;
      const a = pond.r / CFG.R, ca = Math.cos(a), sa = Math.sin(a);
      ctx.beginPath();
      ctx.ellipse(c + x * ca * r, c - y * ca * r, Math.max(0.3, sa * z * r), sa * r, Math.atan2(-y, x), 0, TAU);
      ctx.fill();
    }

    // what's lit: a warm pool and a gold speck each
    ctx.globalCompositeOperation = 'lighter';
    const ps = r * 0.19;
    for (let i = 0; i < N; i++) {
      if (Z[i] < 0 || !was[i]) continue;
      ctx.globalAlpha = (0.2 + 0.2 * Z[i]) * (calm ? 1 : 0.85 + 0.15 * Math.sin(t * 2.3 + i * 1.9));
      ctx.drawImage(this.glow.gold, X[i] - ps, Y[i] - ps, ps * 2, ps * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#ffd866';
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      if (Z[i] < 0 || !was[i]) continue;
      const q = rs * (0.78 + 0.22 * Z[i]);
      ctx.moveTo(X[i] + q, Y[i]); ctx.arc(X[i], Y[i], q, 0, TAU);
    }
    ctx.fill();

    // the wreath's ring: the circle to follow
    if (wreath.alpha > 0.02) this._ring(ctx, wreath, true, rx, ry, rz, ux, uy, uz, px, py, pz, t);

    // the string of lights trailing behind Boo
    if (nG > 1) {
      this._string(ctx, pts, g, true, power ? 'rgba(255,200,70,0.34)' : 'rgba(255,214,150,0.26)', Math.max(2.6, r * 0.05));
      this._string(ctx, pts, g, true, power ? '#ffe28a' : '#fff0cf', Math.max(1.1, r * 0.02));
    }

    // what's still dark: the point of the whole thing
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < N; i++) {
      if (Z[i] < 0 || was[i]) continue;
      const w = wave(Z[i]), hs = r * (0.15 + 0.07 * w) * (0.8 + 0.2 * Z[i]);
      ctx.globalAlpha = 0.34 + 0.5 * w;
      ctx.drawImage(this.glow.ice, X[i] - hs, Y[i] - hs, hs * 2, hs * 2);
    }
    // something just changed: a bright pop, gold for lit, red for chewed out
    for (let i = 0; i < N; i++) {
      if (fl[i] <= 0) continue;
      const hs = r * (0.2 + 0.24 * (1 - fl[i]));
      ctx.globalAlpha = fl[i] * (Z[i] < 0 ? 0.45 : 1);
      ctx.drawImage(was[i] ? this.glow.gold : this.glow.red, X[i] - hs, Y[i] - hs, hs * 2, hs * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#f6faff';
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      if (Z[i] < 0 || was[i]) continue;
      const q = ru * (0.8 + 0.2 * Z[i]);
      ctx.moveTo(X[i] + q, Y[i]); ctx.arc(X[i], Y[i], q, 0, TAU);
    }
    ctx.fill();

    this._bugs(ctx, game, true, rx, ry, rz, ux, uy, uz, px, py, pz, t);
    this._tree(ctx, W, true, rx, ry, rz, ux, uy, uz, px, py, pz);

    // presents lying in the snow
    const rg = clamp(r * 0.03, 1.6, 4);
    for (const pr of game.presents.list) {
      if (pr.state !== 'idle') continue;
      const n = pr.n, z = n.x * px + n.y * py + n.z * pz;
      if (z < 0) continue;
      const x = c + (n.x * rx + n.y * ry + n.z * rz) * r, y = c - (n.x * ux + n.y * uy + n.z * uz) * r;
      ctx.fillStyle = pr.gold ? '#ffc94d' : '#ff86b6';
      ctx.strokeStyle = '#3a0d24';
      ctx.lineWidth = Math.max(0.8, rg * 0.34);
      ctx.beginPath(); ctx.rect(x - rg, y - rg, rg * 2, rg * 2); ctx.fill(); ctx.stroke();
    }

    // a power-up waiting to be grabbed
    const pick = game.pickups.item;
    if (pick.state !== 'none') {
      const n = pick.n, z = n.x * px + n.y * py + n.z * pz;
      const x = c + (n.x * rx + n.y * ry + n.z * rz) * r, y = c - (n.x * ux + n.y * uy + n.z * uz) * r;
      const k = (z < 0 ? 0.55 : 1) * (calm ? 1 : 0.75 + 0.25 * Math.sin(t * 7));
      const hs = r * 0.3, look = PICK[pick.kind];
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = k;
      ctx.drawImage(this.glow[look[0]], x - hs, y - hs, hs * 2, hs * 2);
      ctx.globalCompositeOperation = 'source-over';
      const s = clamp(r * 0.085, 4, 11), w = s * 0.24;
      ctx.fillStyle = look[1];
      ctx.beginPath();
      ctx.moveTo(x, y - s); ctx.lineTo(x + w, y - w); ctx.lineTo(x + s, y); ctx.lineTo(x + w, y + w);
      ctx.lineTo(x, y + s); ctx.lineTo(x - w, y + w); ctx.lineTo(x - s, y); ctx.lineTo(x - w, y - w);
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
    }

    const hatOff = g.hatState !== 'on' && g.hatState !== 'returning';

    // rings: things switching on and off, a BOO, the last few stragglers
    for (let i = this.pings.length - 1; i >= 0; i--) {
      const p = this.pings[i];
      p.t += dt;
      const k = p.t / p.life;
      if (k >= 1) { this.pings.splice(i, 1); continue; }
      const z = p.x * px + p.y * py + p.z * pz;
      const x = p.x * rx + p.y * ry + p.z * rz, y = p.x * ux + p.y * uy + p.z * uz;
      const a = p.a0 * (1 - (1 - k) * (1 - k)), ca = Math.cos(a), sa = Math.sin(a);
      ctx.strokeStyle = rgba(p.color, (1 - k) * (z < 0 ? 0.4 : 0.95) * p.gain);
      ctx.lineWidth = Math.max(1, r * 0.026) * (1 - k * 0.55);
      ctx.beginPath();
      ctx.ellipse(c + x * ca * r, c - y * ca * r, Math.max(0.3, sa * Math.abs(z) * r), sa * r, Math.atan2(-y, x), 0, TAU);
      ctx.stroke();
    }

    // ---- you are here
    const s = clamp(r * 0.3, 14, 32);
    const hs = s * 1.25;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.5;
    ctx.drawImage(this.glow.white, c - hs, c - hs, hs * 2, hs * 2);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.translate(c, c + s * 0.1); ctx.scale(s, s);
    ctx.lineWidth = 0.15; ctx.strokeStyle = '#0b1030';
    ctx.stroke(BOO_BODY);
    ctx.fillStyle = '#f6f9ff'; ctx.fill(BOO_BODY);
    ctx.fillStyle = '#0b1030';
    ctx.beginPath(); ctx.ellipse(-0.15, -0.1, 0.062, 0.095, 0, 0, TAU); ctx.ellipse(0.15, -0.1, 0.062, 0.095, 0, 0, TAU); ctx.fill();
    if (!hatOff) {
      ctx.lineWidth = 0.12;
      ctx.stroke(BOO_HAT); ctx.stroke(BOO_BRIM);
      ctx.fillStyle = '#ef3b55'; ctx.fill(BOO_HAT);
      ctx.fillStyle = '#fff'; ctx.fill(BOO_BRIM);
      ctx.beginPath(); ctx.arc(0.45, -0.31, 0.075, 0, TAU); ctx.stroke(); ctx.fill();
    }
    ctx.restore();

    // the hat, when it isn't on Boo's head (drawn last: it matters more than anything else)
    if (hatOff) {
      const h = g.hatWorld(_hat).normalize();
      const z = h.x * px + h.y * py + h.z * pz;
      const x = c + (h.x * rx + h.y * ry + h.z * rz) * r, y = c - (h.x * ux + h.y * uy + h.z * uz) * r;
      const k = z < 0 ? 0.6 : 1, hs = r * 0.26;
      this.hatT -= dt;
      if (this.hatT <= 0) { this.hatT = 0.8; this._ping(h.x, h.y, h.z, RED, 0.2, 0.8, 1); }
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = k * (calm ? 0.8 : 0.6 + 0.4 * Math.sin(t * 9));
      ctx.drawImage(this.glow.red, x - hs, y - hs, hs * 2, hs * 2);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = k;
      const s = clamp(r * 0.2, 9, 22);
      ctx.save();
      ctx.translate(x, y + s * 0.42); ctx.scale(s, s);
      ctx.fillStyle = '#ef3b55'; ctx.fill(BOO_HAT);
      ctx.fillStyle = '#fff'; ctx.fill(BOO_BRIM);
      ctx.beginPath(); ctx.arc(0.45, -0.31, 0.075, 0, TAU); ctx.fill();
      ctx.restore();
      ctx.globalAlpha = 1;
    } else this.hatT = 0;
  }

  _graticule(ctx, front, rx, ry, rz, ux, uy, uz, px, py, pz, style) {
    const c = this.c, r = this.r, xy = this.gratXY;
    ctx.strokeStyle = style;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const line of this.grat) {
      const n = line.length / 3;
      for (let i = 0; i < n; i++) {
        const a = line[i * 3], b = line[i * 3 + 1], d = line[i * 3 + 2];
        xy[i * 3] = c + (a * rx + b * ry + d * rz) * r;
        xy[i * 3 + 1] = c - (a * ux + b * uy + d * uz) * r;
        xy[i * 3 + 2] = a * px + b * py + d * pz;
      }
      let pen = false;
      for (let i = 0; i <= n; i++) {
        const j = (i % n) * 3;
        if (xy[j + 2] >= 0 !== front) { pen = false; continue; }
        if (pen) ctx.lineTo(xy[j], xy[j + 1]); else { ctx.moveTo(xy[j], xy[j + 1]); pen = true; }
      }
    }
    ctx.stroke();
  }

  /** The wreath's guide circle: a small circle on the sphere, so an ellipse here; one side at a time. */
  _ring(ctx, wreath, front, rx, ry, rz, ux, uy, uz, px, py, pz, t) {
    const c = this.c, r = this.r, C = wreath.c, e1 = wreath.e1, e2 = wreath.e2;
    const ca = Math.cos(wreath.a), sa = Math.sin(wreath.a), n = 72;
    ctx.strokeStyle = `rgba(110,235,160,${((front ? 0.95 : 0.5) * wreath.alpha).toFixed(3)})`;
    ctx.lineWidth = Math.max(1.3, r * 0.024);
    ctx.setLineDash([r * 0.06, r * 0.05]);
    ctx.lineDashOffset = -t * r * 0.2 * wreath.dir;
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i <= n; i++) {
      const th = (i / n) * TAU, ct = Math.cos(th) * sa, st = Math.sin(th) * sa;
      const x = C.x * ca + e1.x * ct + e2.x * st, y = C.y * ca + e1.y * ct + e2.y * st, z = C.z * ca + e1.z * ct + e2.z * st;
      if (x * px + y * py + z * pz >= 0 !== front) { pen = false; continue; }
      const sx = c + (x * rx + y * ry + z * rz) * r, sy = c - (x * ux + y * uy + z * uz) * r;
      if (pen) ctx.lineTo(sx, sy); else { ctx.moveTo(sx, sy); pen = true; }
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /** The garland, as a line from its tail to Boo (who is at the centre). Front or back half only. */
  _string(ctx, pts, g, front, style, width) {
    const c = this.c, r = this.r, R0 = g.right, U0 = g.u, P0 = g.p;
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i < pts.length; i++) {
      const n = pts[i].n;
      if (n.dot(P0) >= 0 !== front) { pen = false; continue; }
      const x = c + n.dot(R0) * r, y = c - n.dot(U0) * r;
      if (pen) ctx.lineTo(x, y); else { ctx.moveTo(x, y); pen = true; }
    }
    if (front && pen) ctx.lineTo(c, c);
    ctx.stroke();
  }

  _bugs(ctx, game, front, rx, ry, rz, ux, uy, uz, px, py, pz, t) {
    const c = this.c, r = this.r, rb = clamp(r * 0.034, 1.7, 4.6);
    for (const b of game.humbugs.list) {
      if (b.state === 'wrapped') continue;
      const n = b.n, z = n.x * px + n.y * py + n.z * pz;
      if (z >= 0 !== front) continue;
      const x = c + (n.x * rx + n.y * ry + n.z * rz) * r, y = c - (n.x * ux + n.y * uy + n.z * uz) * r;
      if (front && b.state === 'gnaw') {
        // chewing the lights out of something: worth a glance
        const hs = r * 0.2;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = game.calmMotion ? 0.8 : 0.55 + 0.45 * Math.sin(t * 11);
        ctx.drawImage(this.glow.red, x - hs, y - hs, hs * 2, hs * 2);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
      const flipped = b.state === 'flipped' || b.state === 'recover';
      ctx.fillStyle = front ? (flipped ? '#c9a2ad' : '#ff4d63') : 'rgba(255,96,116,0.8)';
      ctx.beginPath(); ctx.arc(x, y, front ? rb : rb * 0.75, 0, TAU); ctx.fill();
      if (front) { ctx.lineWidth = Math.max(0.8, rb * 0.36); ctx.strokeStyle = '#2a0a1c'; ctx.stroke(); }
    }
  }

  /** The Great Tree stands on the pole; it sticks out of the globe, so it reads as a landmark. */
  _tree(ctx, W, front, rx, ry, rz, ux, uy, uz, px, py, pz) {
    const n = W.pole, z = n.x * px + n.y * py + n.z * pz;
    if (z >= 0 !== front) return;
    const c = this.c, r = this.r;
    const x = n.x * rx + n.y * ry + n.z * rz, y = -(n.x * ux + n.y * uy + n.z * uz);
    const bx = c + x * r, by = c + y * r, h = 0.2, tx = c + x * r * (1 + h), ty = c + y * r * (1 + h);
    const l = Math.hypot(x, y), w = Math.max(2.2, r * 0.062);
    ctx.globalAlpha = front ? 1 : 0.75;
    ctx.fillStyle = '#35c98e';
    ctx.strokeStyle = '#0b3a26';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (l > 0.12) {
      const ox = (-y / l) * w, oy = (x / l) * w;
      ctx.moveTo(bx + ox, by + oy); ctx.lineTo(tx, ty); ctx.lineTo(bx - ox, by - oy); ctx.closePath();
    } else ctx.arc(bx, by, w, 0, TAU); // pointing straight at you
    ctx.fill(); ctx.stroke();
    // the star on top lights up at the end of a won night
    const lit = W.great && W.great.starTarget > 0;
    ctx.fillStyle = lit ? '#fff3b0' : '#ffd257';
    ctx.beginPath(); ctx.arc(tx, ty, Math.max(1.5, r * 0.036), 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  }
}
