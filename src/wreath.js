// The wreath power-up: the biggest circle your string of lights can close, painted on the snow, with
// a pull that holds Boo to it while you steer round.
//
// On a sphere a circle of angular radius a has circumference 2πR·sin(a), so the radius that uses up
// a string of length L is a = asin(L / 2πR). Every such circle through Boo has its centre somewhere
// on a ring around him, so we try a couple of dozen of them and keep the one with the most left to
// light inside it (preferring, on a tie, one he is already heading along).
import * as THREE from 'three';
import { CFG } from './config.js';
import { U, RENDER_ORDER } from './materials.js';
import { clamp, lerp, TAU, smoothstep, tangentToward } from './utils.js';

const SEG = 200;
const HALF = 0.25; // half the painted line's width, world units
const _r = new THREE.Vector3();
const _t = new THREE.Vector3();
const _w = new THREE.Vector3();
const _h = new THREE.Vector3();
const _n = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _s = new THREE.Vector3();

export class Wreath {
  constructor(scene) {
    this.on = false;
    this.c = new THREE.Vector3(); // centre of the circle (unit vector)
    this.a = 0; // its angular radius
    this.len = 0; // its circumference, world units
    this.dir = 1; // +1 = counter-clockwise seen from above
    this.e1 = new THREE.Vector3();
    this.e2 = new THREE.Vector3();
    this.t = 0;
    this.dur = 0;
    this.frac = 0; // where Boo is round the ring, 0..1 from where it started
    this.progress = 0; // the furthest round he has been
    this.escapeT = 0;
    this.pushT = 0;
    this.grace = 0; // just after the ring is laid: time to turn onto it, and to choose which way round
    this.alpha = 0;
    this.world = null;

    const pos = new Float32Array((SEG + 1) * 2 * 3), uv = new Float32Array((SEG + 1) * 2 * 2);
    const idx = new Uint16Array(SEG * 6);
    for (let i = 0; i <= SEG; i++) {
      uv[i * 4] = i / SEG; uv[i * 4 + 1] = 0;
      uv[i * 4 + 2] = i / SEG; uv[i * 4 + 3] = 1;
    }
    for (let i = 0; i < SEG; i++) {
      const a = i * 2;
      idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6);
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: U.uTime, uAlpha: { value: 0 }, uAt: { value: 0 }, uDone: { value: 0 }, uLen: { value: 50 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying float vFacing;
        void main(){
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          // the planet is centred on the origin, so "up" is just the direction of the point itself
          vFacing = dot(normalize(wp.xyz), normalize(cameraPosition - wp.xyz));
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uAlpha; uniform float uAt; uniform float uDone; uniform float uLen;
        varying vec2 vUv; varying float vFacing;
        void main(){
          if (vFacing <= 0.0) discard;                                  // round the back of the planet
          float line = smoothstep(0.0, 0.55, 1.0 - abs(vUv.y * 2.0 - 1.0));
          float s = vUv.x * uLen;                                       // metres along the ring
          float dash = smoothstep(0.34, 0.5, abs(fract(s / 2.0 - uTime * 1.6) - 0.5) * 2.0);
          float berry = step(0.75, fract(s / 8.0 - uTime * 0.4));       // every fourth dash is a holly berry
          float ahead = fract(vUv.x - uAt);                             // 0 just in front of Boo, 1 just behind
          float todo = step(vUv.x, 1.0) * step(uDone, vUv.x);           // the part still to be drawn
          float lead = pow(1.0 - min(ahead * 7.0, 1.0), 2.0);           // a bright stretch right ahead
          vec3 col = mix(vec3(0.3, 1.55, 0.58), vec3(2.0, 0.3, 0.38), berry) * dash * mix(0.13, 0.9, todo);
          col += vec3(1.5, 1.15, 0.42) * lead * 1.3;
          gl_FragColor = vec4(col * line * uAlpha * smoothstep(0.0, 0.3, vFacing), 1.0);
        }`,
      blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: false, side: THREE.DoubleSide, fog: false,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.renderOrder = RENDER_ORDER.pools + 2;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** Switch the power on for a while, with a ring laid from where Boo is now. */
  begin(world, g, len, weigh) {
    this.anchor(world, g, len, weigh);
    this.on = true;
    this.t = 0;
    this.dur = clamp(this.len / (CFG.ghost.speed * 0.6) + 6, 12, 28);
    this.escapeT = 0;
    this.pushT = 0;
  }

  /**
   * (Re)lay the ring through Boo's current position.
   * @param len    how much string there is to spend
   * @param weigh  (centre, angularRadius) => how much is worth lighting inside that circle
   */
  anchor(world, g, len, weigh) {
    const a = this._best(g, len, weigh, this.c), p = g.p, sa = Math.sin(a);
    this.a = a;
    this.len = TAU * CFG.R * sa;
    this.e1.copy(p).addScaledVector(this.c, -p.dot(this.c)).normalize(); // from the centre out to Boo
    this.e2.crossVectors(this.c, this.e1);
    this.dir = _h.dot(this.e2) >= 0 ? 1 : -1;
    this.world = world;
    this.frac = 0;
    this.progress = 0;
    this.grace = 1.3;
    this.pushT = 0;
    this._build();
  }

  /**
   * The best ring through Boo as things stand: writes its centre to `out`, returns its angular
   * radius. (Leaves _h, the heading it was judged against, set.)
   */
  _best(g, len, weigh, out) {
    const C = Math.min(len * CFG.wreath.use - 1.5, TAU * CFG.R * Math.sin(CFG.wreath.maxAngle));
    const a = Math.asin(clamp(C / (TAU * CFG.R), 0.05, 1));
    const p = g.p, ca = Math.cos(a), sa = Math.sin(a);
    if (g.speed > 1.5) _h.copy(g.vel).normalize(); else _h.copy(g.u);
    _w.crossVectors(p, _h).normalize(); // Boo's left
    // try centres all round him; a centre off to one side means a ring he is already heading along
    let best = -Infinity;
    const N = 24;
    for (let i = 0; i < N; i++) {
      const phi = (i / N) * TAU, cp = Math.cos(phi), sp = Math.sin(phi);
      _a.copy(p).multiplyScalar(ca).addScaledVector(_h, cp * sa).addScaledVector(_w, sp * sa).normalize();
      const score = weigh(_a, a) + 0.45 * Math.abs(sp) + (sp > 0 ? 0.01 : 0);
      if (score > best) { best = score; out.copy(_a); }
    }
    return a;
  }

  /**
   * Without laying anything: if the ring went down right now, what would be inside it?
   * `count` is (centre, angularRadius) => whatever the caller wants to know about that circle.
   */
  survey(g, len, weigh, count) {
    const a = this._best(g, len, weigh, _s);
    return count(_s, a);
  }

  _build() {
    const world = this.world, a = this.a, c = this.c, e1 = this.e1, e2 = this.e2;
    const pos = this.geo.attributes.position, arr = pos.array;
    for (let i = 0; i <= SEG; i++) {
      const th = (i / SEG) * TAU * this.dir, ct = Math.cos(th), st = Math.sin(th);
      for (let k = 0; k < 2; k++) {
        const ang = a + (k ? HALF : -HALF) / CFG.R, ca = Math.cos(ang), sa = Math.sin(ang);
        _n.copy(c).multiplyScalar(ca).addScaledVector(e1, ct * sa).addScaledVector(e2, st * sa).normalize();
        const h = CFG.R + world.heightAt(_n) + 0.26;
        const j = (i * 2 + k) * 3;
        arr[j] = _n.x * h; arr[j + 1] = _n.y * h; arr[j + 2] = _n.z * h;
      }
    }
    pos.needsUpdate = true;
    this.mat.uniforms.uLen.value = this.len;
  }

  stop() {
    this.on = false;
  }

  /** Signed distance of unit vector p from the ring, world units (+ outside, − inside). */
  offset(p) {
    return (Math.acos(clamp(p.dot(this.c), -1, 1)) - this.a) * CFG.R;
  }

  /** Does a just-closed loop (unit centroid, area in world units²) count as "the" circle? */
  matches(centroid, area) {
    const cap = TAU * CFG.R * CFG.R * (1 - Math.cos(this.a));
    return this.progress > 0.72 && centroid.dot(this.c) > Math.cos(this.a * 0.5) && area > cap * 0.62;
  }

  /**
   * Bend the player's steering so Boo holds the ring. `move` is the usual screen-space vector
   * (x → screen right, y → up the screen) and is changed in place.
   * You still steer round it yourself; this only irons out the wobbles. Pushing straight across
   * the ring for a moment lets go.
   */
  assist(move, g, dt) {
    if (!this.on) return move;
    if (this.escapeT > 0) { this.escapeT -= dt; return move; }
    const mag = move.length();
    if (mag < 0.05) { this.pushT = 0; return move; }
    const e = this.offset(g.p), band = CFG.wreath.band;
    if (Math.abs(e) >= band) { this.pushT = 0; return move; }
    tangentToward(g.p, this.c, _r); // toward the middle of the circle
    _t.crossVectors(this.c, g.p).normalize().multiplyScalar(this.dir); // along the ring, the way we're going
    _w.set(0, 0, 0).addScaledVector(g.right, move.x).addScaledVector(g.u, move.y);
    let wt = _w.dot(_t), wr = _w.dot(_r);
    if (this.grace > 0) {
      // the ring has only just appeared: set off either way round it and that becomes "forward"
      if (wt < -0.4 * mag && this.progress < 0.06) {
        this.dir = -this.dir;
        this._build();
        _t.negate();
        wt = -wt;
      }
    } else if (Math.abs(wr) > 0.82 * mag && Math.abs(e) < 2.6) {
      this.pushT += dt;
      if (this.pushT > 0.5) { this.pushT = 0; this.escapeT = 2.2; return move; }
    } else this.pushT = Math.max(0, this.pushT - dt * 2);
    const k = 1 - smoothstep(band * 0.55, band, Math.abs(e));
    const pull = clamp(e / 2.0, -1, 1) * 0.95; // + = inward
    wr = lerp(wr, wr * 0.25 + pull * Math.max(mag, 0.6), k);
    if (wt > 0.15 * mag) wt = lerp(wt, Math.max(wt, mag), k * 0.7); // keep the pace up round the bend
    _w.set(0, 0, 0).addScaledVector(_t, wt).addScaledVector(_r, wr);
    const l = _w.length();
    if (l > 1) _w.multiplyScalar(1 / l);
    return move.set(_w.dot(g.right), _w.dot(g.u));
  }

  /** @returns false once the power has run out */
  update(dt, g) {
    if (this.on) {
      this.t += dt;
      this.grace = Math.max(0, this.grace - dt);
      // how far round is Boo? (only counts while he's actually on the ring)
      let th = Math.atan2(g.p.dot(this.e2) * this.dir, g.p.dot(this.e1));
      if (th < 0) th += TAU;
      const f = th / TAU;
      if (Math.abs(this.offset(g.p)) < CFG.wreath.band) {
        this.frac = f;
        if (f > this.progress && f < this.progress + 0.3) this.progress = f;
      }
      if (this.t >= this.dur) this.on = false;
    }
    const want = this.on ? (this.dur - this.t < 3 ? 0.55 + 0.45 * Math.sin(this.t * 14) : 1) : 0;
    this.alpha += (want - this.alpha) * Math.min(1, dt * (this.on ? 5 : 3));
    this.mesh.visible = this.alpha > 0.01;
    const u = this.mat.uniforms;
    u.uAlpha.value = this.alpha;
    u.uAt.value = this.frac;
    u.uDone.value = this.progress;
    return this.on;
  }
}
