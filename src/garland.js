// The string of fairy lights Boo drags behind it — and the loop detection that makes the game.
import * as THREE from 'three';
import { CFG } from './config.js';
import { glowMaterial, poolMaterial, poolGeometry, RENDER_ORDER } from './materials.js';
import { clamp, arcIntersect, moveOnSphere, tangentToward, easeOutBack, quatFromUpYaw } from './utils.js';

const MAX_PTS = Math.ceil((CFG.garland.maxLen + CFG.star.bonus) / CFG.garland.spacing) + 14;
const LIFT = 0.62; // how high above the snow the wire hangs
const IDENT_Q = new THREE.Quaternion();
const GOLD = [4.4, 2.9, 0.5];
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _t = new THREE.Vector3();
const _side = new THREE.Vector3();
const _x = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _c = new THREE.Color();

export class Garland {
  /**
   * hooks.onLoop({ pts: Vector3[] (unit), bulbs: [{pos, ci}] })  — a loop was closed
   * hooks.onBreak(bulbs)                                          — lights were lost (cut / dropped)
   */
  constructor(scene, world, hooks) {
    this.scene = scene;
    this.world = world;
    this.hooks = hooks;
    this.pts = []; // { n, pos, id, born }
    this.nextId = 0;
    this.maxLen = CFG.garland.startLen;
    this.bonus = 0; // extra length while star power lasts
    this.enabled = true;
    this.time = 0;
    this.nearClose = -1; // index of the old point we are about to close on (for the UI hint glow)

    // wire: a flat ribbon lying just above the snow
    const wp = new Float32Array((MAX_PTS + 2) * 2 * 3);
    const wi = new Uint16Array((MAX_PTS + 1) * 6);
    for (let i = 0; i < MAX_PTS + 1; i++) {
      const a = i * 2;
      wi.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6);
    }
    this.wireGeo = new THREE.BufferGeometry();
    this.wireGeo.setAttribute('position', new THREE.BufferAttribute(wp, 3).setUsage(THREE.DynamicDrawUsage));
    this.wireGeo.setIndex(new THREE.BufferAttribute(wi, 1));
    this.wire = new THREE.Mesh(this.wireGeo, new THREE.MeshBasicMaterial({ color: 0x0c3a22, side: THREE.DoubleSide, fog: false }));
    this.wire.frustumCulled = false;
    scene.add(this.wire);

    // bulbs + the little pools of colour they throw on the snow
    this.bulbMat = glowMaterial({ twinkle: 0.35 });
    this.bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), this.bulbMat, MAX_PTS);
    this.bulbs.frustumCulled = false;
    this.bulbs.count = 0;
    this.poolMat = poolMaterial();
    this.pools = new THREE.InstancedMesh(poolGeometry(), this.poolMat, MAX_PTS);
    this.pools.frustumCulled = false;
    this.pools.renderOrder = RENDER_ORDER.pools + 1;
    this.pools.count = 0;
    for (let i = 0; i < MAX_PTS; i++) {
      this.bulbs.setColorAt(i, _c.setRGB(1, 1, 1));
      this.pools.setColorAt(i, _c.setRGB(0, 0, 0));
    }
    scene.add(this.bulbs, this.pools);
  }

  setWorld(world) {
    this.world = world;
  }

  get length() {
    return Math.max(0, this.pts.length - 1) * CFG.garland.spacing;
  }

  _point(n) {
    const p = { n: n.clone(), pos: new THREE.Vector3(), id: this.nextId++, born: this.time };
    this.world.surface(p.n, LIFT, p.pos);
    return p;
  }

  _bulbsOf(points) {
    const out = [];
    for (const p of points) if (p.id % 2 === 0) out.push({ pos: p.pos.clone(), ci: (p.id >> 1) % CFG.bulbColors.length });
    return out;
  }

  /** Drop the whole string (hat knocked off, night over...). */
  clear(fizzle = true) {
    if (fizzle && this.pts.length > 1) this.hooks.onBreak(this._bulbsOf(this.pts));
    this.pts.length = 0;
    this.nearClose = -1;
  }

  /** A humbug chewed through the wire at point index i: everything older than that falls away. */
  cutAt(i) {
    if (i < 0 || i >= this.pts.length) return;
    const lost = this.pts.splice(0, i + 1);
    this.hooks.onBreak(this._bulbsOf(lost));
  }

  /** Index of the trail point nearest to unit vector n within `dist` world units, or -1. */
  hitTest(n, dist, skipNewest = 3) {
    const cosMax = Math.cos(dist / CFG.R);
    let best = -1, bestDot = cosMax;
    for (let i = 0; i < this.pts.length - skipNewest; i++) {
      const d = this.pts[i].n.dot(n);
      if (d > bestDot) { bestDot = d; best = i; }
    }
    return best;
  }

  _closeLoop(startIdx, crossing) {
    // points startIdx..end form the loop; optionally begin at an exact crossing point
    const loop = this.pts.slice(startIdx);
    const poly = loop.map((p) => p.n);
    if (crossing) poly.unshift(crossing.clone());
    const bulbs = this._bulbsOf(loop);
    const head = this.pts[this.pts.length - 1];
    this.pts.length = startIdx;
    // the string that's left is pinched off where it crossed and carries on from the ghost
    if (crossing) this.pts.push(this._point(crossing));
    this.pts.push(this._point(head.n));
    this.hooks.onLoop({ pts: poly, bulbs });
  }

  _checkLoop() {
    const k = this.pts.length - 1;
    if (k < 6) return false;
    const a = this.pts[k - 1].n, b = this.pts[k].n;
    // 1. did the newest segment cross an older one?
    for (let i = k - 3; i >= 0; i--) {
      if (arcIntersect(a, b, this.pts[i].n, this.pts[i + 1].n, _x)) {
        this._closeLoop(i + 1, _x);
        return true;
      }
    }
    // 2. forgiving snap: passing close to an old bit of string counts
    const minGap = 10;
    const cosSnap = Math.cos(CFG.garland.snap / CFG.R);
    let best = -1, bestDot = cosSnap;
    for (let i = k - minGap; i >= 0; i--) {
      const d = this.pts[i].n.dot(b);
      if (d > bestDot) { bestDot = d; best = i; }
    }
    if (best >= 0) {
      this._closeLoop(best, null);
      return true;
    }
    return false;
  }

  update(dt, time, ghost) {
    this.time = time;
    const sp = CFG.garland.spacing;

    if (this.enabled && ghost.hasHat) {
      if (this.pts.length === 0) this.pts.push(this._point(ghost.p));
      // lay down new points as the ghost moves
      let guard = 0;
      while (guard++ < 8) {
        const last = this.pts[this.pts.length - 1];
        const d = Math.acos(clamp(last.n.dot(ghost.p), -1, 1)) * CFG.R;
        if (d < sp) break;
        tangentToward(last.n, ghost.p, _t);
        _v.copy(last.n);
        moveOnSphere(_v, _t, sp / CFG.R);
        this.pts.push(this._point(_v));
        if (this._checkLoop()) break;
      }
      // the string is only so long: the oldest lights wink out
      const maxPts = Math.floor((this.maxLen + this.bonus) / sp) + 1;
      if (this.pts.length > maxPts + 3) {
        // a lot went at once (star power ran out): let it fizzle rather than just vanish
        this.hooks.onBreak(this._bulbsOf(this.pts.splice(0, this.pts.length - maxPts)));
      } else while (this.pts.length > maxPts) this.pts.shift();

      // which old point would we snap to if we kept going? (used to make it pulse invitingly)
      this.nearClose = -1;
      if (this.pts.length > 14) {
        const cosHint = Math.cos(5.5 / CFG.R);
        let bestDot = cosHint;
        for (let i = this.pts.length - 12; i >= 0; i--) {
          const dd = this.pts[i].n.dot(ghost.p);
          if (dd > bestDot) { bestDot = dd; this.nearClose = i; }
        }
      }
    }

    this._render(time, ghost);
  }

  _render(time, ghost) {
    const n = this.pts.length;
    const pos = this.wireGeo.attributes.position;
    const arr = pos.array;
    const half = 0.05;
    let vi = 0;
    const total = n > 0 && ghost.hasHat ? n + 1 : n; // + the live end in the ghost's hands
    if (n > 0) {
      // where the string meets the ghost
      _v2.copy(ghost.pos).addScaledVector(ghost.p, -0.62 * CFG.ghost.scale);
    }
    for (let i = 0; i < total; i++) {
      const cur = i < n ? this.pts[i].pos : _v2;
      const prev = i > 0 ? (i - 1 < n ? this.pts[i - 1].pos : _v2) : cur;
      const next = i + 1 < total ? (i + 1 < n ? this.pts[i + 1].pos : _v2) : cur;
      _t.subVectors(next, prev);
      if (_t.lengthSq() < 1e-10) _t.set(1, 0, 0);
      _v.copy(cur).normalize();
      _side.crossVectors(_v, _t).normalize().multiplyScalar(half);
      const bob = i < n ? Math.sin(time * 2.2 + this.pts[i].id * 0.55) * 0.06 : 0;
      const bx = cur.x + _v.x * bob, by = cur.y + _v.y * bob, bz = cur.z + _v.z * bob;
      arr[vi++] = bx - _side.x; arr[vi++] = by - _side.y; arr[vi++] = bz - _side.z;
      arr[vi++] = bx + _side.x; arr[vi++] = by + _side.y; arr[vi++] = bz + _side.z;
    }
    pos.needsUpdate = true;
    this.wireGeo.setDrawRange(0, Math.max(0, total - 1) * 6);
    this.wire.visible = total > 1;

    // bulbs on every other point
    let bi = 0;
    const tailFade = 7;
    for (let i = 0; i < n; i++) {
      const p = this.pts[i];
      if (p.id % 2 !== 0) continue;
      const age = time - p.born;
      let s = age < 0.28 ? easeOutBack(clamp(age / 0.28), 3) : 1;
      s *= clamp((i + 1) / tailFade); // the tail end shrinks away
      let glow = 1;
      if (this.nearClose >= 0 && Math.abs(i - this.nearClose) < 4) {
        const pulse = 0.5 + 0.5 * Math.sin(time * 14);
        s *= 1.25 + 0.35 * pulse;
        glow = 1.6 + pulse;
      }
      const bob = Math.sin(time * 2.2 + p.id * 0.55) * 0.06 - 0.13;
      _v.copy(p.n).multiplyScalar(bob).add(p.pos);
      _m.compose(_v, IDENT_Q, _s.setScalar(0.17 * s));
      this.bulbs.setMatrixAt(bi, _m);
      const c = this.bonus > 0 ? GOLD : CFG.bulbColors[(p.id >> 1) % CFG.bulbColors.length];
      this.bulbs.setColorAt(bi, _c.setRGB(c[0] * glow, c[1] * glow, c[2] * glow));
      // light pool
      _v.copy(p.pos).addScaledVector(p.n, -LIFT + 0.1);
      _m.compose(_v, quatFromUpYaw(p.n, 0, _q), _s.setScalar(2.3 * Math.min(1, s)));
      this.pools.setMatrixAt(bi, _m);
      const k = 0.06 * s * glow;
      this.pools.setColorAt(bi, _c.setRGB(c[0] * k, c[1] * k, c[2] * k));
      bi++;
    }
    this.bulbs.count = bi;
    this.pools.count = bi;
    this.bulbs.instanceMatrix.needsUpdate = true;
    this.pools.instanceMatrix.needsUpdate = true;
    this.bulbs.instanceColor.needsUpdate = true;
    this.pools.instanceColor.needsUpdate = true;
  }
}
