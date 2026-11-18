// Power-ups. One at a time, something useful falls out of the sky and waits a while to be grabbed:
//   star   — a shooting star: your string is enormous for a few seconds
//   wreath — paints the biggest circle your string can close, and holds you to it
//   cane   — a candy cane: sugar rush
// This file only looks after the thing lying in the snow; what it does once grabbed is the game's
// business (see onPickup in main.js).
import * as THREE from 'three';
import { CFG } from './config.js';
import { glowMaterial } from './materials.js';
import { clamp, TAU, offsetOnSphere, starGeometry, canvasTexture } from './utils.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export const PICKUP = {
  star: { glow: [4.4, 3.0, 0.6], ring: [1.6, 1.1, 0.3], spin: 2.4 },
  wreath: { glow: [1.0, 3.8, 1.4], ring: [0.5, 1.6, 0.65], spin: 0 },
  cane: { glow: [4.6, 1.1, 1.3], ring: [1.7, 0.5, 0.6], spin: 0 },
};
const KINDS = Object.keys(PICKUP);

function wreathMesh() {
  const g = new THREE.Group();
  const green = glowMaterial({ twinkle: 0.12, color: new THREE.Color(0.42, 2.1, 0.75) });
  const red = glowMaterial({ twinkle: 0.25, color: new THREE.Color(4.2, 0.5, 0.55) });
  const gold = glowMaterial({ twinkle: 0.4, color: new THREE.Color(4.0, 2.6, 0.5) });
  g.add(new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.21, 10, 30), green));
  const ball = new THREE.SphereGeometry(1, 10, 8);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU + 0.45;
    const b = new THREE.Mesh(ball, i % 2 ? gold : red);
    b.scale.setScalar(0.085);
    b.position.set(Math.cos(a) * 0.7, Math.sin(a) * 0.7, 0.2);
    g.add(b);
  }
  // a bow at the bottom
  for (const sx of [-1, 1]) {
    const loop = new THREE.Mesh(ball, red);
    loop.scale.set(0.24, 0.15, 0.1);
    loop.position.set(sx * 0.2, -0.74, 0.22);
    loop.rotation.z = sx * 0.45;
    g.add(loop);
  }
  const knot = new THREE.Mesh(ball, gold);
  knot.scale.setScalar(0.1);
  knot.position.set(0, -0.72, 0.28);
  g.add(knot);
  return g;
}

function caneMesh() {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.95, 0), new THREE.Vector3(0.05, 1.22, 0),
    new THREE.Vector3(0.24, 1.36, 0), new THREE.Vector3(0.43, 1.24, 0), new THREE.Vector3(0.47, 1.05, 0),
  ]);
  const geo = new THREE.TubeGeometry(curve, 30, 0.115, 9, false).translate(-0.2, -0.68, 0);
  const stripe = canvasTexture(64, 64, (c, w, h) => {
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#ff2a45'; c.lineWidth = 15;
    for (let i = -2; i < 4; i++) { c.beginPath(); c.moveTo(i * 32, 0); c.lineTo(i * 32 + 64, 64); c.stroke(); }
  }, { repeat: true });
  stripe.repeat.set(7, 1);
  // unlit and a little over-bright, so it glows like the rest of the pickups
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: stripe, color: new THREE.Color(1.75, 1.75, 1.75), fog: false }));
  m.scale.setScalar(1.25);
  const g = new THREE.Group();
  g.add(m);
  return g;
}

export class Pickups {
  /**
   * `game` supplies ghost, world, fx, audio, camera, and gets told about:
   *   onPickupLand(item) · onPickup(item) · pickupBlocked(kind) → true to skip that kind for now
   */
  constructor(scene, game) {
    this.game = game;
    this.item = {
      kind: 'star', state: 'none', t: 0, pulse: 0,
      n: new THREE.Vector3(), pos: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(),
    };
    this.meshes = {
      star: new THREE.Mesh(starGeometry(0.9, 0.42, 0.3), glowMaterial({ twinkle: 0.2, color: new THREE.Color(4.4, 3.0, 0.55) })),
      wreath: wreathMesh(),
      cane: caneMesh(),
    };
    for (const k of KINDS) { this.meshes[k].visible = false; scene.add(this.meshes[k]); }
    this.nextT = CFG.pickup.first;
    this.rate = 1; // < 1 = they come more often (clear skies)
    this.bag = [];
  }

  reset(night = 1, rate = 1) {
    this.item.state = 'none';
    this.rate = rate;
    this.nextT = CFG.pickup.first * rate;
    // night one hands them out in a fixed order, so you meet each in turn; after that it's a lucky dip
    this.bag = night === 1 ? KINDS.slice() : this._shuffled();
    for (const k of KINDS) this.meshes[k].visible = false;
  }

  _shuffled() {
    const a = KINDS.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  _nextKind() {
    for (let tries = 0; tries < KINDS.length; tries++) {
      if (!this.bag.length) this.bag = this._shuffled();
      const k = this.bag.shift();
      if (!this.game.pickupBlocked(k)) return k;
    }
    return null;
  }

  /** Send one down. It lands a little way off from the ghost, never right on top of it. */
  spawn(kind) {
    const G = this.game, g = G.ghost, W = G.world, s = this.item;
    s.kind = kind;
    const n = offsetOnSphere(g.p, g.u, g.right, Math.random() * TAU, (13 + Math.random() * 7) / CFG.R);
    s.n.copy(n);
    W.surface(n, 1.5, s.to);
    s.from.copy(s.to).addScaledVector(n, 44).addScaledVector(g.u, 22).addScaledVector(g.right, (Math.random() - 0.5) * 30);
    s.pos.copy(s.from);
    s.state = 'fall';
    s.t = 0;
    G.audio.starFall();
    return s;
  }

  /** Take it away without anyone getting it (the night ended). */
  clear() {
    this.item.state = 'none';
  }

  update(dt, time, playing) {
    const G = this.game, g = G.ghost, W = G.world, fx = G.fx, s = this.item;
    const P = PICKUP[s.kind];
    if (playing && s.state === 'none') {
      this.nextT -= dt;
      if (this.nextT <= 0) {
        const k = this._nextKind();
        if (k) this.spawn(k); else this.nextT = 3;
      }
    }
    if (s.state === 'fall') {
      s.t += dt / 1.25;
      const k = Math.min(1, s.t);
      s.pos.lerpVectors(s.from, s.to, k * k);
      for (let i = 0; i < 3; i++) fx.twinkle(_v.copy(s.pos).addScaledVector(s.n, Math.random() * 1.5), P.glow, 0.5, 0.6);
      if (k >= 1) {
        s.state = 'idle';
        s.t = 0;
        s.pulse = 0;
        G.audio.starLand();
        fx.burst(s.to, s.n, 36, [P.glow, [5, 5, 4]], { speed: 9, life: 0.8, size: 0.42 });
        fx.ring(s.n, W, P.ring, 0.5, 9, 0.7, 0.2);
        fx.addShake(0.25);
        G.onPickupLand(s);
      }
    } else if (s.state === 'idle') {
      s.t += dt;
      s.pulse -= dt;
      s.pos.copy(s.to).addScaledVector(s.n, Math.sin(time * 3.2) * 0.3);
      if (s.pulse <= 0) { s.pulse = 1.1; fx.ring(s.n, W, [P.ring[0] * 0.75, P.ring[1] * 0.75, P.ring[2] * 0.75], 0.4, 4.5, 0.9, 0.22); }
      if (Math.random() < dt * 16) fx.twinkle(_v.copy(s.pos).addScaledVector(s.n, Math.random() * 3), P.glow, 0.35, 0.8, _v2.copy(s.n).multiplyScalar(2.5));
      if (playing && Math.acos(clamp(g.p.dot(s.n), -1, 1)) * CFG.R < 2.2) {
        s.state = 'none';
        this.nextT = CFG.pickup.every * this.rate * (0.85 + Math.random() * 0.4);
        G.onPickup(s);
      } else if (s.t > CFG.pickup.linger) {
        s.state = 'none';
        this.nextT = CFG.pickup.every * this.rate * 0.5;
        fx.burst(s.pos, s.n, 14, P.glow, { speed: 3, life: 0.7, size: 0.3 });
      }
    }
    for (const k of KINDS) {
      const m = this.meshes[k], vis = s.state !== 'none' && s.kind === k;
      m.visible = vis;
      if (!vis) continue;
      m.position.copy(s.pos);
      m.quaternion.copy(G.camera.quaternion);
      m.rotateZ(P.spin ? time * P.spin : Math.sin(time * 2.6) * 0.3);
      // the last few seconds before it fizzles out, it blinks
      const going = s.state === 'idle' && s.t > CFG.pickup.linger - 4 ? 0.75 + 0.25 * Math.sin(time * 18) : 1;
      m.scale.setScalar((s.state === 'fall' ? 1.3 : 1 + Math.sin(time * 6) * 0.12) * going);
    }
  }
}
