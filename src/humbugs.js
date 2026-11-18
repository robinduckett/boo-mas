// Humbugs: grumpy little beetles striped like the mint. They chew through Christmas lights. Bah!
// Also here: the snowmen who, once lit, lob snowballs at them.
import * as THREE from 'three';
import { CFG } from './config.js';
import { clamp, lerp, TAU, anyTangent, tangentToward, moveOnSphere, projectTangent, quatFromUpForward, canvasTexture, easeOutBack } from './utils.js';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const Z = new THREE.Vector3(0, 0, 1);

let ASSETS = null;
function assets() {
  if (ASSETS) return ASSETS;
  const stripes = canvasTexture(8, 128, (g, w, h) => {
    const bands = 9;
    for (let i = 0; i < bands; i++) {
      g.fillStyle = i % 2 ? '#f4ecda' : '#1a1622';
      g.fillRect(0, (i / bands) * h, w, h / bands + 1);
    }
  });
  const body = new THREE.SphereGeometry(1, 20, 16).rotateX(Math.PI / 2);
  const sph = new THREE.SphereGeometry(1, 12, 10);
  const leg = new THREE.CylinderGeometry(0.045, 0.03, 0.5, 5).translate(0, -0.25, 0);
  const hatTop = new THREE.CylinderGeometry(0.15, 0.17, 0.27, 10).translate(0, 0.135, 0);
  const hatBrim = new THREE.CylinderGeometry(0.27, 0.27, 0.035, 12);
  const hatBand = new THREE.CylinderGeometry(0.176, 0.176, 0.07, 10).translate(0, 0.06, 0);
  const brow = new THREE.BoxGeometry(0.16, 0.035, 0.04);
  const feeler = new THREE.CylinderGeometry(0.012, 0.016, 0.34, 4).translate(0, 0.17, 0);
  ASSETS = {
    body, sph, leg, hatTop, hatBrim, hatBand, brow, feeler,
    bodyMat: new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.28, metalness: 0.0, emissive: 0x1a1a22, emissiveIntensity: 0.6 }),
    darkMat: new THREE.MeshStandardMaterial({ color: 0x1b1724, roughness: 0.5 }),
    hatMat: new THREE.MeshStandardMaterial({ color: 0x0d0c12, roughness: 0.45 }),
    bandMat: new THREE.MeshStandardMaterial({ color: 0x8c2bb8, roughness: 0.6, emissive: 0x2a0a3a }),
    eyeMat: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.25, 1.2, 1.05), fog: false }),
    pupilMat: new THREE.MeshBasicMaterial({ color: 0x0b0910, fog: false }),
    ballGeo: new THREE.SphereGeometry(0.2, 10, 8),
    ballMat: new THREE.MeshStandardMaterial({ color: 0xf4f8ff, roughness: 0.9, emissive: 0x556080, emissiveIntensity: 0.5 }),
  };
  return ASSETS;
}

function makeBug() {
  const A = assets();
  const g = new THREE.Group();
  const rig = new THREE.Group(); // flips, hops, wobbles
  g.add(rig);
  const add = (geo, mat, x, y, z, sx = 1, sy = sx, sz = sx, parent = rig) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.scale.set(sx, sy, sz);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  const core = new THREE.Group();
  core.position.y = 0.5;
  rig.add(core);
  add(A.body, A.bodyMat, 0, 0, -0.05, 0.52, 0.44, 0.68, core);
  const head = new THREE.Group();
  head.position.set(0, 0.06, 0.6);
  core.add(head);
  add(A.sph, A.darkMat, 0, 0, 0, 0.29, 0.27, 0.27, head);
  for (const sx of [-1, 1]) {
    add(A.sph, A.eyeMat, sx * 0.12, 0.06, 0.2, 0.085, 0.085, 0.06, head);
    add(A.sph, A.pupilMat, sx * 0.115, 0.05, 0.25, 0.04, 0.04, 0.03, head);
    const br = add(A.brow, A.darkMat, sx * 0.12, 0.165, 0.23, 1, 1, 1, head);
    br.rotation.z = -sx * 0.5;
    const f = add(A.feeler, A.darkMat, sx * 0.1, 0.2, 0.05, 1, 1, 1, head);
    f.rotation.set(0.5, 0, -sx * 0.45);
    f.castShadow = false;
  }
  const hat = new THREE.Group();
  hat.position.set(0, 0.24, -0.04);
  hat.rotation.set(-0.15, 0, 0.14);
  add(A.hatBrim, A.hatMat, 0, 0, 0, 1, 1, 1, hat);
  add(A.hatTop, A.hatMat, 0, 0, 0, 1, 1, 1, hat);
  add(A.hatBand, A.bandMat, 0, 0, 0, 1, 1, 1, hat);
  head.add(hat);
  // two tripods of legs that swing in opposition
  const legsA = new THREE.Group(), legsB = new THREE.Group();
  const spots = [[-1, 0.36], [1, 0.02], [-1, -0.34], [1, 0.36], [-1, 0.02], [1, -0.34]];
  spots.forEach(([sx, z], i) => {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.36, -0.14, z);
    pivot.rotation.z = sx * 0.75;
    add(A.leg, A.darkMat, 0, 0, 0, 1, 1, 1, pivot).castShadow = false;
    (i < 3 ? legsA : legsB).add(pivot);
  });
  core.add(legsA, legsB);
  return { group: g, rig, core, head, hat, legsA, legsB };
}

export class Humbugs {
  constructor(scene, world, game) {
    this.scene = scene;
    this.world = world;
    this.game = game;
    this.list = [];
    this.pool = [];
    this.spawnT = CFG.humbug.firstSpawn;
    this.enabled = false;
    this.calm = false; // night's over: stop causing trouble
    this.thief = null; // the bug that is going for (or wearing) Boo's hat
    this.total = 0;
    // snowballs
    this.balls = [];
    const A = assets();
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(A.ballGeo, A.ballMat);
      m.visible = false;
      scene.add(m);
      this.balls.push({ mesh: m, active: false, t: 0, dur: 0.6, from: new THREE.Vector3(), bug: null, to: new THREE.Vector3() });
    }
  }

  reset(world) {
    // Retire the old bugs while this.world is still the world they were in: letting go of a target
    // touches that world's bookkeeping, and an object from last night must never end up in tonight's.
    for (const b of this.list) this._retire(b);
    this.list.length = 0;
    this.world = world;
    this.spawnT = CFG.humbug.firstSpawn;
    this.total = 0;
    this.calm = false;
    this.thief = null;
    for (const s of this.balls) { s.active = false; s.mesh.visible = false; }
  }

  _retire(b) {
    b.group.visible = false;
    if (b.target) { this.world.setGnaw(b.target, 0); b.target.claimed = null; b.target = null; }
    this.pool.push(b);
  }

  get alive() {
    let n = 0;
    for (const b of this.list) if (b.state !== 'wrapped') n++;
    return n;
  }

  spawn(burrow = null) {
    const W = this.world;
    if (!W.burrows.length) return null;
    if (!burrow) {
      // prefer a burrow away from the ghost so they don't pop up in your face
      const gp = this.game.ghost.p;
      const sorted = W.burrows.slice().sort((a, b) => a.n.dot(gp) - b.n.dot(gp));
      burrow = sorted[Math.floor(Math.random() * Math.min(3, sorted.length))];
    }
    let b = this.pool.pop();
    if (!b) {
      b = makeBug();
      b.n = new THREE.Vector3();
      b.heading = new THREE.Vector3();
      b.want = new THREE.Vector3();
      this.scene.add(b.group);
    }
    b.group.visible = true;
    b.n.copy(burrow.n);
    anyTangent(b.n, b.heading).applyAxisAngle(b.n, Math.random() * TAU);
    b.want.copy(b.heading);
    b.spin = 0;
    b.state = 'emerge';
    b.t = 0;
    b.target = null;
    b.flip = 0; // 0 upright → 1 on its back
    b.hop = 0;
    b.phase = Math.random() * TAU;
    b.cutCool = 0;
    b.wanderT = 0.5 + Math.random();
    b.gnawTick = 0;
    b.speedMul = 0.9 + Math.random() * 0.25;
    b.chaser = Math.random() < this.world.params.chaser;
    b.bahT = 2 + Math.random() * 4;
    b.hasHat = false;
    b.hat.visible = true;
    b.id = this.total++;
    b.rig.scale.setScalar(0.001);
    this.list.push(b);
    this.game.onBugSpawn(b);
    return b;
  }

  /** Flip every active bug within `radius` of unit vector n. Returns how many. */
  boo(n, radius) {
    const cosMax = Math.cos(radius / CFG.R);
    let count = 0;
    for (const b of this.list) {
      if (b.state === 'wrapped' || b.state === 'emerge') continue;
      if (b.n.dot(n) < cosMax) continue;
      this.flip(b, CFG.boo.flipTime, 0.05 + (1 - b.n.dot(n)) * 6);
      count++;
    }
    return count;
  }

  flip(b, time, delay = 0) {
    if (b.state === 'wrapped') return;
    if (b.target) { this.world.setGnaw(b.target, 0); b.target.claimed = null; b.target = null; }
    if (this.thief === b && !b.hasHat) this.thief = null;
    b.state = 'flipped';
    b.t = -delay; // negative = waiting for the shockwave to arrive
    b.flipTime = time;
    b.flipped = false;
  }

  /** Bugs for which test(n) is true (used for "is it inside the loop?"). */
  select(test) {
    return this.list.filter((b) => b.state !== 'wrapped' && b.state !== 'emerge' && test(b.n));
  }

  /** Up and about (not on its back, not struggling back onto its feet)? Catching one like this is worth more. */
  isLive(b) {
    return b.state !== 'wrapped' && b.state !== 'recover' && !(b.state === 'flipped' && b.flipped);
  }

  /** Gift-wrap a bug. The game spawns the present. */
  wrap(b) {
    if (b.state === 'wrapped') return false;
    if (b.target) { this.world.setGnaw(b.target, 0); b.target.claimed = null; b.target = null; }
    this._dropHat(b);
    b.state = 'wrapped';
    b.t = 0;
    return true;
  }

  /** If this bug is wearing Boo's hat, it falls off. */
  _dropHat(b) {
    if (this.thief === b) this.thief = null;
    if (!b.hasHat) return;
    b.hasHat = false;
    b.hat.visible = true;
    this.game.onHatDropped(b);
  }

  _steer(b, desired, speed, dt, turn = 5) {
    // keep clear of houses and the Great Tree
    for (const o of this.world.obstacles) {
      const d = Math.acos(clamp(b.n.dot(o.n), -1, 1)) * CFG.R;
      if (d < o.r + 1.2) {
        tangentToward(b.n, o.n, _c);
        desired.addScaledVector(_c, -2.2 * (1 - d / (o.r + 1.2)) - 0.4);
      }
    }
    projectTangent(desired, b.n);
    if (desired.lengthSq() > 1e-8) {
      desired.normalize();
      b.heading.lerp(desired, 1 - Math.exp(-turn * dt));
      projectTangent(b.heading, b.n);
      if (b.heading.lengthSq() < 1e-8) b.heading.copy(desired);
      b.heading.normalize();
    }
    moveOnSphere(b.n, b.heading, (speed * dt) / CFG.R);
    // carry the heading along the surface
    projectTangent(b.heading, b.n).normalize();
    b.phase += speed * dt * 4.2;
  }

  _pickTarget(b) {
    let best = null, bestScore = -Infinity;
    for (const o of this.world.lightables) {
      if (!o.lit || o.claimed || o.anim < 1) continue;
      const score = o.n.dot(b.n) + Math.random() * 0.12;
      if (score > bestScore) { bestScore = score; best = o; }
    }
    return best;
  }

  update(dt, time, ghost, garland) {
    const W = this.world, G = this.game, P = W.params;

    // ---- spawning
    if (this.enabled) {
      this.spawnT -= dt;
      const cap = Math.min(P.humbugCap, 1 + Math.floor(W.spirit * P.humbugCap * 1.6));
      if (this.spawnT <= 0) {
        if (this.alive < cap) this.spawn();
        this.spawnT = P.spawnEvery * (0.75 + Math.random() * 0.5);
      }
    }

    for (let i = this.list.length - 1; i >= 0; i--) {
      const b = this.list[i];
      const speed = P.humbugSpeed * b.speedMul;
      if (this.calm && (b.state === 'seek' || b.state === 'gnaw' || b.state === 'chase')) {
        if (b.target) { W.setGnaw(b.target, 0); b.target.claimed = null; b.target = null; }
        b.state = 'wander'; b.t = 0;
      }
      b.cutCool = Math.max(0, b.cutCool - dt);
      let walking = false;
      let scale = 1;

      // a hat lying in the snow is irresistible
      if (!this.calm && !this.thief && ghost.hatState === 'ground' && ghost.hatT > 0.35 && (b.state === 'wander' || b.state === 'seek' || b.state === 'chase' || (b.state === 'flee' && b.t > 0.45)) && b.n.dot(ghost.hatN) > Math.cos(17 / CFG.R)) {
        if (b.target) { W.setGnaw(b.target, 0); b.target.claimed = null; b.target = null; }
        this.thief = b;
        b.state = 'steal'; b.t = 0;
      }

      switch (b.state) {
        case 'emerge': {
          b.t += dt;
          const k = clamp(b.t / 0.55);
          scale = easeOutBack(k);
          b.hop = Math.sin(k * Math.PI) * 0.9;
          if (k >= 1) { b.state = 'wander'; b.t = 0; }
          break;
        }
        case 'wander': {
          b.t += dt;
          b.wanderT -= dt;
          walking = true;
          if (b.wanderT <= 0) {
            b.wanderT = 0.8 + Math.random() * 1.6;
            b.want.copy(b.heading).applyAxisAngle(b.n, (Math.random() - 0.5) * 2.4);
          }
          projectTangent(b.want, b.n);
          _a.copy(b.want);
          this._steer(b, _a, speed * 0.7, dt, 3);
          if (b.t > 1.2 && !this.calm) {
            if (b.chaser && ghost.hasHat && Math.random() < 0.5) { b.state = 'chase'; b.t = 0; }
            else {
              const tgt = this._pickTarget(b);
              if (tgt) { b.target = tgt; tgt.claimed = b; b.state = 'seek'; b.t = 0; }
              else b.t = 0.4;
            }
          }
          break;
        }
        case 'seek': {
          const o = b.target;
          if (!o || !o.lit) { if (o) o.claimed = null; b.target = null; b.state = 'wander'; b.t = 0; break; }
          walking = true;
          tangentToward(b.n, o.n, _a);
          const d = Math.acos(clamp(b.n.dot(o.n), -1, 1)) * CFG.R;
          const reach = o.type === 'house' ? 2.7 : o.type === 'lamp' ? 0.85 : 1.35;
          if (d <= reach) { b.state = 'gnaw'; b.t = 0; G.onGnawStart(b, o); }
          else this._steer(b, _a, speed, dt);
          break;
        }
        case 'gnaw': {
          const o = b.target;
          if (!o || !o.lit) { if (o) { W.setGnaw(o, 0); o.claimed = null; } b.target = null; b.state = 'wander'; b.t = 0; break; }
          b.t += dt;
          tangentToward(b.n, o.n, _a);
          if (_a.lengthSq() > 0) b.heading.lerp(_a, 1 - Math.exp(-8 * dt)).normalize();
          W.setGnaw(o, clamp(b.t / CFG.humbug.gnawTime));
          b.gnawTick -= dt;
          if (b.gnawTick <= 0) { b.gnawTick = 0.16; G.onGnawTick(b, o); }
          if (b.t >= CFG.humbug.gnawTime) {
            W.setGnaw(o, 0);
            o.claimed = null;
            b.target = null;
            b.state = 'wander'; b.t = 0;
            G.onUnlit(o, b);
          }
          break;
        }
        case 'chase': {
          b.t += dt;
          walking = true;
          // go for the string if there is one nearby, otherwise for the hat itself
          let tn = ghost.p;
          if (garland.pts.length > 12) tn = garland.pts[Math.floor(garland.pts.length * 0.55)].n;
          tangentToward(b.n, tn, _a);
          this._steer(b, _a, speed * 1.25, dt);
          if (b.t > 7 || !ghost.hasHat) { b.state = 'wander'; b.t = 0; }
          break;
        }
        case 'steal': {
          b.t += dt;
          walking = true;
          if (ghost.hatState !== 'ground') { if (this.thief === b) this.thief = null; b.state = 'wander'; b.t = 0; break; }
          tangentToward(b.n, ghost.hatN, _a);
          if (Math.acos(clamp(b.n.dot(ghost.hatN), -1, 1)) * CFG.R < 0.95) {
            b.hasHat = true;
            b.hat.visible = false;
            ghost.stealHat(b.head, 0, 0.25, -0.03, 0.66);
            b.state = 'thief'; b.t = 0;
            G.onHatStolen(b);
          } else this._steer(b, _a, speed * 1.5, dt, 7);
          break;
        }
        case 'thief': {
          // scarper, weaving, whenever the ghost gets close
          b.t += dt;
          b.wanderT -= dt;
          walking = true;
          const near = b.n.dot(ghost.p) > Math.cos(16 / CFG.R);
          if (near) {
            tangentToward(b.n, ghost.p, _a).negate();
            _a.applyAxisAngle(b.n, Math.sin(time * 2.3 + b.id) * 0.55);
          } else {
            if (b.wanderT <= 0) { b.wanderT = 0.8 + Math.random() * 1.6; b.want.copy(b.heading).applyAxisAngle(b.n, (Math.random() - 0.5) * 2.4); }
            projectTangent(b.want, b.n);
            _a.copy(b.want);
          }
          this._steer(b, _a, speed * (near ? 1.65 : 0.9), dt, 6);
          break;
        }
        case 'flee': {
          b.t += dt;
          walking = true;
          tangentToward(b.n, ghost.p, _a).negate();
          this._steer(b, _a, speed * 2.0, dt, 8);
          if (b.t > 1.3) { b.state = 'wander'; b.t = 0; }
          break;
        }
        case 'flipped': {
          b.t += dt;
          if (b.t < 0) { walking = true; break; } // shockwave hasn't reached it yet
          if (!b.flipped) { b.flipped = true; b.hopT = 0; G.onBugFlip(b); this._dropHat(b); }
          b.hopT += dt;
          b.hop = Math.max(0, Math.sin(clamp(b.hopT / 0.42) * Math.PI)) * 1.5;
          b.flip = Math.min(1, b.flip + dt / 0.3);
          if (b.t > b.flipTime) { b.state = 'recover'; b.t = 0; }
          break;
        }
        case 'recover': {
          b.t += dt;
          const k = clamp(b.t / 0.4);
          b.hop = Math.sin(k * Math.PI) * 1.0;
          b.flip = 1 - k;
          if (k >= 1) { b.flip = 0; b.state = 'flee'; b.t = 0; }
          break;
        }
        case 'wrapped': {
          b.t += dt;
          const k = clamp(b.t / 0.32);
          scale = 1 - k * k;
          b.hop = k * 1.2;
          b.spin = (b.spin || 0) + dt * 26;
          if (k >= 1) {
            this._retire(b);
            this.list.splice(i, 1);
            continue;
          }
          break;
        }
      }

      if (b.state !== 'flipped' && b.state !== 'recover' && b.state !== 'wrapped' && b.state !== 'emerge' && !this.calm) {
        b.hop = Math.max(0, b.hop - dt * 4);
        // snip the string?
        if (b.cutCool <= 0 && garland.pts.length > 4) {
          const idx = garland.hitTest(b.n, 0.78);
          if (idx >= 0) {
            b.cutCool = 1.6;
            G.onSnip(b, garland.pts[idx].pos);
            garland.cutAt(idx);
          }
        }
        // bump the ghost?
        if (ghost.invuln <= 0 && Math.acos(clamp(b.n.dot(ghost.p), -1, 1)) * CFG.R < 1.3) {
          tangentToward(b.n, ghost.p, _a);
          if (_a.lengthSq() === 0) anyTangent(b.n, _a);
          G.onGhostHit(b, _a);
          if (this.thief === b && !b.hasHat) this.thief = null; // gave up on the hat
          b.state = b.hasHat ? 'thief' : 'flee'; b.t = 0;
          if (b.target) { W.setGnaw(b.target, 0); b.target.claimed = null; b.target = null; }
        }
        // the occasional grumble
        b.bahT -= dt;
        if (b.bahT <= 0) { b.bahT = 5 + Math.random() * 7; G.onBah(b); }
      }

      // ---- pose
      const h = W.heightAt(b.n);
      b.group.position.copy(b.n).multiplyScalar(CFG.R + h + b.hop);
      quatFromUpForward(b.n, b.heading, b.group.quaternion);
      const flipA = b.flip * Math.PI;
      b.rig.rotation.set(0, b.state === 'wrapped' ? b.spin : 0, flipA);
      b.rig.position.y = b.flip * 0.95; // resting on its back
      b.rig.scale.setScalar(Math.max(0.001, scale));
      const onBack = b.flip > 0.5;
      const wig = onBack ? Math.sin(time * 26 + b.id) * 0.75 : walking ? Math.sin(b.phase) * 0.55 : 0;
      b.legsA.rotation.x = wig;
      b.legsB.rotation.x = -wig;
      b.core.position.y = 0.5 + (walking ? Math.abs(Math.sin(b.phase)) * 0.05 : 0);
      b.core.rotation.z = walking ? Math.sin(b.phase) * 0.06 : onBack ? Math.sin(time * 7 + b.id) * 0.14 : 0;
      b.head.rotation.x = b.state === 'gnaw' ? 0.35 + Math.sin(time * 34) * 0.3 : 0;
      b.core.rotation.x = b.state === 'gnaw' ? 0.18 : 0;
      b.pos = b.group.position;
    }

    this._snowmen(dt, time);
  }

  _snowmen(dt, time) {
    const W = this.world, G = this.game;
    for (const o of W.lightables) {
      if (o.type !== 'snowman' || !o.lit || o.anim < 1) continue;
      o.cool -= dt;
      if (o.cool > 0) continue;
      // nearest upright humbug in range
      let best = null, bestDot = Math.cos(12 / CFG.R);
      for (const b of this.list) {
        if (b.state === 'wrapped' || b.state === 'flipped' || b.state === 'recover' || b.state === 'emerge') continue;
        const d = b.n.dot(o.n);
        if (d > bestDot) { bestDot = d; best = b; }
      }
      if (!best) { o.cool = 0.4; continue; }
      const s = this.balls.find((x) => !x.active);
      if (!s) { o.cool = 0.4; continue; }
      o.cool = 2.8;
      s.active = true; s.t = 0; s.bug = best;
      s.from.copy(o.hand);
      s.dur = 0.5 + Math.acos(clamp(bestDot, -1, 1)) * CFG.R * 0.035;
      s.mesh.visible = true;
      W.jolt(o, 4);
      G.onSnowball(o);
    }
    for (const s of this.balls) {
      if (!s.active) continue;
      s.t += dt / s.dur;
      const b = s.bug;
      const t = Math.min(1, s.t);
      if (b && b.group.visible) s.to.copy(b.group.position).addScaledVector(b.n, 0.5);
      s.mesh.position.lerpVectors(s.from, s.to, t);
      _a.copy(s.mesh.position).normalize();
      s.mesh.position.addScaledVector(_a, Math.sin(t * Math.PI) * 2.6);
      if (t >= 1) {
        s.active = false;
        s.mesh.visible = false;
        if (b && b.state !== 'wrapped' && b.group.visible) {
          this.flip(b, 3.0);
          G.onSnowballHit(b, s.to);
        }
      }
    }
  }
}
