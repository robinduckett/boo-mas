// Presents: what a humbug turns into once it has been lovingly gift-wrapped.
import * as THREE from 'three';
import { CFG } from './config.js';
import { clamp, lerp, TAU, quatFromUpYaw, easeOutBack, moveOnSphere, tangentToward } from './utils.js';

const _v = new THREE.Vector3();
const _t = new THREE.Vector3();

const PAIRS = [
  [0xe8384f, 0xffe08a], [0x2fa56f, 0xfff3d6], [0x3b7fe0, 0xffd34d],
  [0xf06fb0, 0xffffff], [0xffc94d, 0xe8384f], [0x8b5cf6, 0xffe08a],
];
export const PRESENT_GLOW = [
  [6, 0.6, 0.6], [0.5, 5, 1.2], [0.7, 2.2, 7], [6, 1, 3.4], [6, 3.6, 0.5], [3, 1.2, 7],
];

let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  SHARED = {
    box: new THREE.BoxGeometry(0.74, 0.62, 0.74).translate(0, 0.31, 0),
    r1: new THREE.BoxGeometry(0.77, 0.64, 0.17).translate(0, 0.315, 0),
    r2: new THREE.BoxGeometry(0.17, 0.64, 0.77).translate(0, 0.315, 0),
    bow: new THREE.SphereGeometry(1, 10, 8),
    mats: PAIRS.map(([a, b]) => ({
      box: new THREE.MeshStandardMaterial({ color: a, roughness: 0.55, emissive: a, emissiveIntensity: 0.38 }),
      rib: new THREE.MeshStandardMaterial({ color: b, roughness: 0.4, emissive: b, emissiveIntensity: 0.5 }),
    })),
  };
  return SHARED;
}

function makePresent(ci) {
  const S = shared();
  const m = S.mats[ci];
  const g = new THREE.Group();
  const add = (geo, mat) => { const x = new THREE.Mesh(geo, mat); x.castShadow = true; g.add(x); return x; };
  add(S.box, m.box);
  add(S.r1, m.rib);
  add(S.r2, m.rib);
  for (const sx of [-1, 1]) {
    const b = add(S.bow, m.rib);
    b.scale.set(0.19, 0.1, 0.11);
    b.position.set(sx * 0.15, 0.7, 0);
    b.rotation.z = sx * 0.5;
  }
  const knot = add(S.bow, m.rib);
  knot.scale.setScalar(0.085);
  knot.position.y = 0.67;
  return g;
}

export class Presents {
  constructor(scene, world, game) {
    this.scene = scene;
    this.world = world;
    this.game = game;
    this.list = [];
    this.pool = [];
  }

  reset(world) {
    this.world = world;
    for (const p of this.list) { p.group.visible = false; this.pool.push(p); }
    this.list.length = 0;
  }

  /**
   * Pop a present out of `from` (world position) so that it lands at unit direction n.
   * A `gold` one is bigger and worth twice the string (the reward for a live catch).
   */
  spawn(from, n, delay = 0, ci = (Math.random() * PAIRS.length) | 0, gold = false) {
    let p = this.pool.find((x) => x.ci === ci);
    if (p) this.pool.splice(this.pool.indexOf(p), 1);
    else {
      p = { ci, group: makePresent(ci), n: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), pos: new THREE.Vector3() };
      this.scene.add(p.group);
    }
    p.group.visible = false;
    p.gold = gold;
    p.n.copy(n).normalize();
    p.from.copy(from);
    this.world.surface(p.n, 0.05, p.to);
    p.pos.copy(from);
    p.state = 'pop';
    p.t = -delay;
    p.yaw = Math.random() * TAU;
    p.spin = 6 + Math.random() * 4;
    p.h = 0.05;
    p.v = 0;
    p.scale = 0.001;
    this.list.push(p);
    return p;
  }

  update(dt, time, ghost) {
    const W = this.world;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      let scale = 1;
      if (p.state === 'pop') {
        p.t += dt / 0.6;
        if (p.t < 0) continue;
        p.group.visible = true;
        const k = clamp(p.t);
        p.pos.lerpVectors(p.from, p.to, k);
        _v.copy(p.pos).normalize();
        p.pos.addScaledVector(_v, Math.sin(k * Math.PI) * 3.0);
        scale = easeOutBack(Math.min(1, k * 1.7), 2.2);
        p.yaw += dt * p.spin;
        if (k >= 1) {
          p.state = 'idle';
          p.t = 0;
          this.game.onPresentLand(p);
        }
      } else if (p.state === 'idle') {
        p.t += dt;
        const bounce = Math.abs(Math.sin(p.t * 3.4)) * 0.32 * Math.max(0.35, 1 - p.t * 0.25);
        p.h = 0.05 + bounce;
        p.pos.copy(p.n).multiplyScalar(CFG.R + W.heightAt(p.n) + p.h);
        p.yaw += dt * 1.2;
        const d = Math.acos(clamp(p.n.dot(ghost.p), -1, 1)) * CFG.R;
        // they zoom to you if you're anywhere near; otherwise they wait a while
        if ((p.t > 0.12 && d < 15) || d < 7) { p.state = 'fly'; p.t = 0; p.v = 4; }
        else if (p.t > 30) { scale = clamp(1 - (p.t - 30) / 0.4); if (p.t > 30.4) { this._remove(i); continue; } }
      } else if (p.state === 'fly') {
        p.t += dt;
        p.v += 46 * dt;
        const d = Math.acos(clamp(p.n.dot(ghost.p), -1, 1)) * CFG.R;
        tangentToward(p.n, ghost.p, _t);
        moveOnSphere(p.n, _t, Math.min(d, p.v * dt) / CFG.R);
        p.h = lerp(p.h, CFG.ghost.hover + 0.2, 1 - Math.exp(-7 * dt));
        p.pos.copy(p.n).multiplyScalar(CFG.R + W.heightAt(p.n) + p.h);
        p.yaw += dt * 14;
        scale = clamp(0.45 + d * 0.2, 0.45, 1);
        this.game.onPresentTrail(p);
        if (d < 0.9) {
          this.game.onPresent(p);
          this._remove(i);
          continue;
        }
      }
      p.group.position.copy(p.pos);
      quatFromUpYaw(p.n, p.yaw, p.group.quaternion);
      p.group.scale.setScalar(Math.max(0.001, scale) * (p.gold ? 1.4 : 1));
    }
  }

  _remove(i) {
    const p = this.list[i];
    p.group.visible = false;
    this.pool.push(p);
    this.list.splice(i, 1);
  }
}
