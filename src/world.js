// The tiny planet: procedural terrain, everything standing on it, and the lit/unlit state of it all.
import * as THREE from 'three';
import { CFG, nightParams } from './config.js';
import { U, glowMaterial, poolMaterial, poolGeometry, RENDER_ORDER } from './materials.js';
import {
  RNG, makeNoise3D, mulberry32, hashStr, fbm, anyTangent, offsetOnSphere, quatFromUpYaw, quatFromUpForward,
  mergeColored, trs, clamp, smoothstep, lerp, TAU, starGeometry, easeOutBack, tangentToward, canvasTexture, GLSL_NOISE,
} from './utils.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const IDENT_Q = new THREE.Quaternion();

// ------------------------------------------------------------------ shared geometry (built once)

const TREE_TIERS = [
  { y: 0.62, r: 1.32, h: 1.85 },
  { y: 1.6, r: 1.04, h: 1.6 },
  { y: 2.5, r: 0.74, h: 1.4 },
];
const TREE_TOP = 3.9;
const TREE_GREENS = [0x1a6b4b, 0x208059, 0x279668];

const GT_TIERS = [
  { y: 1.7, r: 4.7, h: 4.6 },
  { y: 4.3, r: 3.9, h: 4.1 },
  { y: 6.7, r: 3.1, h: 3.6 },
  { y: 8.9, r: 2.3, h: 3.1 },
  { y: 10.8, r: 1.5, h: 2.7 },
];
const GT_TOP = 13.5;
const GT_BULBS = [16, 14, 12, 10, 7];
export const GT_THRESHOLDS = [0.16, 0.34, 0.52, 0.7, 0.88];

const SNOW = 0xf0f5ff;
const HOUSE = { W: 3.0, D: 2.6, WH: 1.8, RISE: 1.25, OV: 0.38, OVZ: 0.36 };
const HOUSE_WALLS = [0xd9564a, 0x4fa9c0, 0xf0cc9a, 0x9d7bd6, 0x6cb07a];
const HOUSE_DOORS = [0x4f2e1c, 0x24394a, 0x6d2a2a, 0x2c2440, 0x5a3a20];

const GEO = {};

function conifer(tiers, greens, trunkR, trunkH, seg) {
  const parts = [{ geo: new THREE.CylinderGeometry(trunkR * 0.7, trunkR, trunkH, 7), color: 0x4a2e20, matrix: trs(0, trunkH / 2, 0) }];
  tiers.forEach((t, i) => {
    const rot = i * 0.7;
    parts.push({ geo: new THREE.ConeGeometry(t.r, t.h, seg, 1), color: greens[Math.min(i, greens.length - 1)], matrix: trs(0, t.y + t.h / 2, 0, 0, rot, 0) });
    // snow resting on the upper part of each tier
    const k = 0.62;
    parts.push({ geo: new THREE.ConeGeometry(t.r * k, t.h * k, seg, 1), color: SNOW, matrix: trs(0, t.y + t.h + 0.05 - (t.h * k) / 2, 0, 0, rot, 0) });
  });
  return mergeColored(parts);
}

function gableGeometry(hw, rise, depth) {
  const z = depth / 2;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-hw, 0, z, hw, 0, z, 0, rise, z, hw, 0, -z, -hw, 0, -z, 0, rise, -z], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1], 3));
  return g;
}

function houseGeometry(wall, door) {
  const { W, D, WH, RISE, OV, OVZ } = HOUSE;
  const hw = W / 2;
  const al = Math.atan2(RISE, hw);
  const slabL = (hw + OV) / Math.cos(al) + 0.1;
  const slabT = 0.34;
  const trim = 0xfff1dc;
  const parts = [];
  parts.push({ geo: new THREE.BoxGeometry(W, WH, D), color: wall, matrix: trs(0, WH / 2, 0) });
  parts.push({ geo: gableGeometry(hw, RISE, D), color: wall, matrix: trs(0, WH, 0) });
  // thick snowy roof
  const along = slabL / 2 - 0.05, off = slabT / 2 - 0.06;
  const cx = Math.cos(al) * along + Math.sin(al) * off;
  const cy = WH + RISE - Math.sin(al) * along + Math.cos(al) * off;
  parts.push({ geo: new THREE.BoxGeometry(slabL, slabT, D + OVZ * 2), color: SNOW, matrix: trs(cx, cy, 0, 0, 0, -al) });
  parts.push({ geo: new THREE.BoxGeometry(slabL, slabT, D + OVZ * 2), color: SNOW, matrix: trs(-cx, cy, 0, 0, 0, al) });
  parts.push({ geo: new THREE.CylinderGeometry(0.22, 0.22, D + OVZ * 2, 8), color: SNOW, matrix: trs(0, WH + RISE + 0.13, 0, Math.PI / 2, 0, 0) });
  // chimney
  parts.push({ geo: new THREE.BoxGeometry(0.52, 1.3, 0.52), color: 0x8a3c2f, matrix: trs(0.75, 2.775, -0.5) });
  parts.push({ geo: new THREE.BoxGeometry(0.7, 0.17, 0.7), color: SNOW, matrix: trs(0.75, 3.48, -0.5) });
  // door, knob, wreath
  parts.push({ geo: new THREE.BoxGeometry(0.66, 1.16, 0.1), color: door, matrix: trs(0, 0.58, D / 2 + 0.03) });
  parts.push({ geo: new THREE.SphereGeometry(0.05, 6, 5), color: 0xe7b84a, matrix: trs(0.2, 0.56, D / 2 + 0.1) });
  parts.push({ geo: new THREE.TorusGeometry(0.2, 0.07, 6, 12), color: 0x1f8a55, matrix: trs(0, 1.47, D / 2 + 0.07) });
  parts.push({ geo: new THREE.SphereGeometry(0.075, 6, 5), color: 0xe8384f, matrix: trs(0, 1.28, D / 2 + 0.13) });
  // doorstep snow
  parts.push({ geo: new THREE.BoxGeometry(1.0, 0.12, 0.5), color: SNOW, matrix: trs(0, 0.03, D / 2 + 0.25) });
  // window trim
  for (const sx of [-1, 1]) {
    const x = sx * 0.9;
    parts.push({ geo: new THREE.BoxGeometry(0.72, 0.08, 0.2), color: SNOW, matrix: trs(x, 0.68, D / 2 + 0.08) });
    parts.push({ geo: new THREE.BoxGeometry(0.05, 0.6, 0.05), color: trim, matrix: trs(x, 1.02, D / 2 + 0.03) });
    parts.push({ geo: new THREE.BoxGeometry(0.58, 0.05, 0.05), color: trim, matrix: trs(x, 1.02, D / 2 + 0.03) });
    parts.push({ geo: new THREE.BoxGeometry(0.05, 0.6, 0.05), color: trim, matrix: trs(sx * (hw + 0.03), 1.02, 0.1) });
    parts.push({ geo: new THREE.BoxGeometry(0.05, 0.05, 0.72), color: trim, matrix: trs(sx * (hw + 0.03), 1.02, 0.1) });
  }
  return mergeColored(parts);
}

function houseWindowsGeometry() {
  const { D, W, WH } = HOUSE;
  const hw = W / 2;
  const parts = [];
  for (const sx of [-1, 1]) {
    parts.push({ geo: new THREE.PlaneGeometry(0.58, 0.6), matrix: trs(sx * 0.9, 1.02, D / 2 + 0.012) });
    parts.push({ geo: new THREE.PlaneGeometry(0.72, 0.6), matrix: trs(sx * (hw + 0.012), 1.02, 0.1, 0, (sx * Math.PI) / 2, 0) });
  }
  parts.push({ geo: new THREE.PlaneGeometry(0.7, 0.6), matrix: trs(0, 1.02, -(D / 2 + 0.012), 0, Math.PI, 0) });
  parts.push({ geo: new THREE.CircleGeometry(0.2, 14), matrix: trs(0, WH + 0.48, D / 2 + 0.012) });
  return mergeColored(parts);
}

/** Local-space spots for fairy lights along the roofline. */
function houseBulbSpots() {
  const { W, D, WH, RISE, OV, OVZ } = HOUSE;
  const hw = W / 2;
  const eaveY = WH - (OV * RISE) / hw;
  const z = D / 2 + OVZ + 0.03;
  const spots = [];
  const ridge = new THREE.Vector3(0, WH + RISE - 0.02, z);
  for (const sx of [-1, 1]) {
    const eave = new THREE.Vector3(sx * (hw + OV + 0.04), eaveY - 0.06, z);
    for (const t of [0.14, 0.34, 0.54, 0.74, 0.94]) spots.push(new THREE.Vector3().lerpVectors(ridge, eave, t));
    for (const t of [0.15, 0.4, 0.65, 0.9]) spots.push(new THREE.Vector3(sx * (hw + OV + 0.06), eaveY - 0.1, lerp(z, -z, t)));
  }
  spots.push(ridge.clone().add(new THREE.Vector3(0, -0.06, 0)));
  return spots;
}

function lampGeometry() {
  const iron = 0x232733;
  const parts = [{ geo: new THREE.CylinderGeometry(0.15, 0.21, 0.24, 8), color: iron, matrix: trs(0, 0.12, 0) }];
  const N = 8, segH = 2.08 / N;
  for (let i = 0; i < N; i++) {
    parts.push({ geo: new THREE.CylinderGeometry(0.058, 0.058, segH, 7), color: i % 2 ? 0xf6f2ea : 0xd9303f, matrix: trs(0, 0.24 + segH * (i + 0.5), 0) });
  }
  parts.push({ geo: new THREE.CylinderGeometry(0.11, 0.11, 0.07, 8), color: iron, matrix: trs(0, 2.35, 0) });
  parts.push({ geo: new THREE.CylinderGeometry(0.15, 0.1, 0.08, 6), color: iron, matrix: trs(0, 2.42, 0) });
  parts.push({ geo: new THREE.ConeGeometry(0.24, 0.22, 6), color: iron, matrix: trs(0, 2.97, 0) });
  parts.push({ geo: new THREE.SphereGeometry(0.12, 8, 6), color: SNOW, matrix: trs(0, 3.06, 0, 0, 0, 0, 1.2, 0.6, 1.2) });
  return mergeColored(parts);
}

function caneGeometry() {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.95, 0), new THREE.Vector3(0.05, 1.22, 0),
    new THREE.Vector3(0.24, 1.36, 0), new THREE.Vector3(0.43, 1.24, 0), new THREE.Vector3(0.47, 1.05, 0),
  ]);
  return new THREE.TubeGeometry(curve, 26, 0.075, 7, false);
}

function geo(name, make) {
  return GEO[name] || (GEO[name] = make());
}

// ------------------------------------------------------------------ world

export class World {
  constructor(scene, seed, night = 1) {
    this.scene = scene;
    this.seed = String(seed);
    this.night = night;
    this.params = nightParams(night, this.seed);
    this.biome = this.params.biome;
    // The planet is a different size each night. Everything else reads CFG.R when it needs it, so
    // making a world is what sets it. (There is only ever one world at a time.)
    CFG.R = this.params.radius;
    this.rng = new RNG(this.seed + ':layout:' + night);
    this.noise = makeNoise3D(mulberry32(hashStr(this.seed + ':terrain:' + night)));
    this.noiseOff = (hashStr(this.seed + ':off:' + night) % 1000) / 10;

    this.group = new THREE.Group();
    scene.add(this.group);
    this.disposables = [];

    this.lightables = [];
    this.active = new Set();
    this.litCount = 0;
    this.flats = [];
    this.ponds = [];
    this.placed = [];
    this.obstacles = [];
    this.burrows = [];
    this.smoke = []; // lit houses puff from here; the game spawns the particles

    this.onGreatTier = null; // (tierIndex) => void

    this._layout();
    this._buildTerrain();
    this._buildObjects();
    this._cluster();
  }

  /**
   * Group the things that can be lit into neighbourhoods (a village, a grove, a lone snowman), so
   * the screen-edge pointers can say "five dark things over there" rather than point at each one.
   */
  _cluster() {
    const L = this.lightables;
    const link = Math.cos(6.2 / CFG.R), reach = Math.cos(10.5 / CFG.R);
    this.clusters = [];
    for (const o of L) o.cluster = -1;
    for (let i = 0; i < L.length; i++) {
      if (L[i].cluster >= 0) continue;
      const id = this.clusters.length, seed = L[i].n, members = [L[i]];
      L[i].cluster = id;
      // grow outward through near neighbours, without straying too far from where we started
      for (let k = 0; k < members.length; k++) {
        const a = members[k].n;
        for (const o of L) {
          if (o.cluster >= 0 || o.n.dot(a) < link || o.n.dot(seed) < reach) continue;
          o.cluster = id;
          members.push(o);
        }
      }
      this.clusters.push({ id, members, unlit: 0, un: new THREE.Vector3(), dot: 0, near: false });
    }
  }

  get spirit() {
    return this.lightables.length ? this.litCount / this.lightables.length : 0;
  }

  // ---------------------------------------------------------------- heights

  baseHeight(n) {
    const o = this.noiseOff, T = this.biome.terrain;
    // hills stay the same size on the ground however big the planet is; the biome sets how tall and how busy
    const f = (CFG.R / 30) * T.freq, f1 = 1.55 * f, f2 = 5.5 * f;
    let h = fbm(this.noise, n.x * f1 + o, n.y * f1 + 1.3, n.z * f1 + 9.1, 3) * 3.4 * T.amp;
    h += fbm(this.noise, n.x * f2 + 3.3, n.y * f2 + o, n.z * f2, 2) * 0.55 * Math.sqrt(T.amp);
    return h;
  }

  heightAt(n) {
    let h = this.baseHeight(n);
    for (let i = 0; i < this.flats.length; i++) {
      const f = this.flats[i];
      const dot = n.dot(f.n);
      if (dot < f.cosMax) continue;
      const d = Math.acos(Math.min(1, dot)) * CFG.R;
      const w = 1 - smoothstep(f.r, f.r + f.blend, d);
      h = lerp(h, f.level, w);
    }
    return h;
  }

  /** World position on the snow at unit direction n, lifted by `lift`. */
  surface(n, lift = 0, out = new THREE.Vector3()) {
    return out.copy(n).multiplyScalar(CFG.R + this.heightAt(n) + lift);
  }

  // ---------------------------------------------------------------- layout

  _reserve(n, r) {
    this.placed.push({ n: n.clone(), r });
  }

  _free(n, r) {
    for (let i = 0; i < this.placed.length; i++) {
      const p = this.placed[i];
      if (Math.acos(clamp(n.dot(p.n), -1, 1)) * CFG.R < r + p.r) return false;
    }
    return true;
  }

  _findFree(r, { minPole = 0, minStart = 0 } = {}, tries = 260) {
    const n = new THREE.Vector3();
    for (let i = 0; i < tries; i++) {
      this.rng.onSphere(n);
      if (minPole && Math.acos(clamp(n.dot(this.pole), -1, 1)) * CFG.R < minPole) continue;
      if (minStart && Math.acos(clamp(n.dot(this.start), -1, 1)) * CFG.R < minStart) continue;
      if (this._free(n, r)) return n.clone();
    }
    return null;
  }

  _addFlat(n, r, blend, level, pond = false) {
    this.flats.push({ n: n.clone(), r, blend, level, pond, cosMax: Math.cos(Math.min(Math.PI, (r + blend) / CFG.R)) });
  }

  _layout() {
    const rng = this.rng, P = this.params;
    this.pole = new THREE.Vector3(0, 1, 0);
    const ex = new THREE.Vector3(1, 0, 0), ez = new THREE.Vector3(0, 0, 1);
    this.start = offsetOnSphere(this.pole, ex, ez, rng.range(0, TAU), 16.5 / CFG.R);
    this.startUp = tangentToward(this.start, this.pole); // "up the screen" at the start = toward the Great Tree
    this._reserve(this.pole, 7.6);
    this._reserve(this.start, 3.2);
    this._addFlat(this.pole, 6.5, 6, this.baseHeight(this.pole) + 0.35);

    this.trees = [];
    this.houses = [];
    this.lamps = [];
    this.snowmen = [];
    this.canes = [];
    this.lumps = [];

    // frozen ponds
    for (let i = 0; i < P.ponds; i++) {
      const n = this._findFree(9, { minPole: 17, minStart: 13 });
      if (!n) continue;
      const r = rng.range(P.pondR[0], P.pondR[1]);
      this.ponds.push({ n, r });
      this._reserve(n, r + 0.4);
      this._addFlat(n, r - 0.4, 2.6, this.baseHeight(n) - 0.9, true);
    }

    // a single lamp already burning beside the start, so you can see what "lit" means
    {
      const side = new THREE.Vector3().crossVectors(this.startUp, this.start); // screen-right at the start
      const n = offsetOnSphere(this.start, this.startUp, side, -1.3, 2.35 / CFG.R);
      this.lamps.push({ n, yaw: 0, pilot: true });
      this._reserve(n, 1.0);
    }

    // villages: a ring of cottages around a plaza lamp
    for (let v = 0; v < P.villages; v++) {
      const c = this._findFree(9.6, { minPole: 18, minStart: 10 });
      if (!c) continue;
      this._addFlat(c, 7.8, 4, this.baseHeight(c));
      const t1 = anyTangent(c), t2 = new THREE.Vector3().crossVectors(c, t1);
      const nH = rng.int(3, 4);
      const a0 = rng.range(0, TAU);
      for (let k = 0; k < nH; k++) {
        const b = a0 + (k / nH) * TAU + rng.range(-0.2, 0.2);
        const n = offsetOnSphere(c, t1, t2, b, 5.3 / CFG.R);
        const fwd = tangentToward(n, c);
        this.houses.push({ n, fwd, variant: rng.int(0, HOUSE_WALLS.length - 1) });
        this._reserve(n, 2.7);
        // candy canes flanking the door
        const right = new THREE.Vector3().crossVectors(n, fwd);
        for (const sx of [-1, 1]) {
          const cn = n.clone().addScaledVector(fwd, 2.1 / CFG.R).addScaledVector(right, (sx * 0.95) / CFG.R).normalize();
          this.canes.push({ n: cn, yaw: rng.range(0, TAU), s: rng.range(0.8, 1.05) });
        }
      }
      this.lamps.push({ n: c.clone(), yaw: rng.range(0, TAU) });
      this._reserve(c, 1.1);
      const extra = rng.int(1, 2);
      for (let k = 0; k < extra; k++) {
        const b = a0 + ((k * 2 + 0.5) / nH) * TAU;
        const n = offsetOnSphere(c, t1, t2, b, 8.2 / CFG.R);
        if (this._free(n, 1.0)) { this.lamps.push({ n, yaw: rng.range(0, TAU) }); this._reserve(n, 1.0); }
      }
    }

    // groves
    for (let g = 0; g < P.groves; g++) {
      const c = this._findFree(4.2, { minPole: 12.5, minStart: 5.5 });
      if (!c) continue;
      const t1 = anyTangent(c), t2 = new THREE.Vector3().crossVectors(c, t1);
      const cnt = rng.int(4, 7);
      for (let k = 0; k < cnt; k++) {
        for (let tries = 0; tries < 14; tries++) {
          const n = offsetOnSphere(c, t1, t2, rng.range(0, TAU), rng.range(0.5, 5.2) / CFG.R);
          if (!this._free(n, 1.3)) continue;
          this.trees.push({ n, yaw: rng.range(0, TAU), scale: rng.range(0.82, 1.38) });
          this._reserve(n, 1.3);
          break;
        }
      }
    }
    // loners
    for (let i = 0; i < P.loners; i++) {
      const n = this._findFree(1.8, { minPole: 10.5, minStart: 4.5 });
      if (!n) continue;
      this.trees.push({ n, yaw: rng.range(0, TAU), scale: rng.range(0.8, 1.3) });
      this._reserve(n, 1.3);
    }
    // snowmen
    for (let i = 0; i < P.snowmen; i++) {
      const n = this._findFree(2.3, { minPole: 11.5, minStart: 6 });
      if (!n) continue;
      const fwd = anyTangent(n).applyAxisAngle(n, rng.range(0, TAU));
      this.snowmen.push({ n, fwd });
      this._reserve(n, 1.3);
    }
    // stray lamps
    for (let i = 0; i < P.lamps; i++) {
      const n = this._findFree(2.2, { minPole: 11, minStart: 6 });
      if (!n) continue;
      this.lamps.push({ n, yaw: rng.range(0, TAU) });
      this._reserve(n, 1.0);
    }
    // humbug burrows, well away from where you start
    for (let i = 0; i < P.burrows; i++) {
      const n = this._findFree(3.4, { minPole: 15, minStart: 24 });
      if (!n) continue;
      this.burrows.push({ n });
      this._reserve(n, 2.2);
    }
    // snow drifts (pure decoration)
    for (let i = 0; i < P.lumps; i++) {
      const n = this._findFree(0.9, { minPole: 9, minStart: 3 }, 30);
      if (!n) continue;
      this.lumps.push({ n, yaw: rng.range(0, TAU), s: rng.range(0.35, 1.0) });
    }
  }

  // ---------------------------------------------------------------- terrain

  _buildTerrain() {
    const B = this.biome;
    const N = Math.min(104, Math.round((76 * CFG.R) / 30)); // keep the grid the same size on the ground
    const per = (N + 1) * (N + 1);
    const count = per * 6;
    const pos = new Float32Array(count * 3);
    const nor = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const ice = new Float32Array(count);
    const idx = new Uint32Array(N * N * 6 * 6);
    const faces = [
      [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1)],
      [new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1)],
      [new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0)],
      [new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 0, 0)],
      [new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0)],
      [new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0)],
    ];
    const d = new THREE.Vector3(), t1 = new THREE.Vector3(), t2 = new THREE.Vector3();
    const p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), p2 = new THREE.Vector3(), nn = new THREE.Vector3();
    const up = new THREE.Vector3();
    const eps = 0.012;
    let vi = 0, ii = 0;
    for (let f = 0; f < 6; f++) {
      const [fwd, right] = faces[f];
      up.crossVectors(fwd, right);
      const base = f * per;
      for (let j = 0; j <= N; j++) {
        for (let i = 0; i <= N; i++) {
          const a = Math.tan(((i / N) * 2 - 1) * (Math.PI / 4));
          const b = Math.tan(((j / N) * 2 - 1) * (Math.PI / 4));
          d.copy(fwd).addScaledVector(right, a).addScaledVector(up, b).normalize();
          const h = this.heightAt(d);
          p0.copy(d).multiplyScalar(CFG.R + h);
          // analytic-ish normal from two nearby samples
          anyTangent(d, t1);
          t2.crossVectors(d, t1);
          p1.copy(d).addScaledVector(t1, eps).normalize(); p1.multiplyScalar(CFG.R + this.heightAt(p1));
          p2.copy(d).addScaledVector(t2, eps).normalize(); p2.multiplyScalar(CFG.R + this.heightAt(p2));
          nn.crossVectors(p1.sub(p0), p2.sub(p0)).normalize();
          if (nn.dot(d) < 0) nn.negate();
          pos[vi * 3] = p0.x; pos[vi * 3 + 1] = p0.y; pos[vi * 3 + 2] = p0.z;
          nor[vi * 3] = nn.x; nor[vi * 3 + 1] = nn.y; nor[vi * 3 + 2] = nn.z;
          // colour: cool snow with gentle variation, bluer in the dips; ice on the ponds
          let iceW = 0;
          for (const pond of this.ponds) {
            const dist = Math.acos(clamp(d.dot(pond.n), -1, 1)) * CFG.R;
            iceW = Math.max(iceW, 1 - smoothstep(pond.r - 0.9, pond.r - 0.2, dist));
          }
          const shade = 0.9 + 0.1 * fbm(this.noise, d.x * 9, d.y * 9, d.z * 9, 2) + clamp(h * 0.035, -0.06, 0.06);
          let r = B.snow[0] * shade, g = B.snow[1] * shade, bl = B.snow[2] * shade;
          if (B.rock) {
            // bare rock and blue ice show through where it is too steep for snow to settle
            const k = smoothstep(0.035, 0.11, 1 - nn.dot(d));
            r = lerp(r, B.rock[0], k); g = lerp(g, B.rock[1], k); bl = lerp(bl, B.rock[2], k);
          }
          r = lerp(r, B.ice[0], iceW); g = lerp(g, B.ice[1], iceW); bl = lerp(bl, B.ice[2], iceW);
          col[vi * 3] = r; col[vi * 3 + 1] = g; col[vi * 3 + 2] = bl;
          ice[vi] = iceW;
          vi++;
        }
      }
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const a = base + j * (N + 1) + i, b = a + 1, dd = a + (N + 1), c = dd + 1;
          idx[ii++] = a; idx[ii++] = b; idx[ii++] = c;
          idx[ii++] = a; idx[ii++] = c; idx[ii++] = dd;
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aIce', new THREE.BufferAttribute(ice, 1));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();

    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = U.uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aIce;\nvarying float vIce;\nvarying vec3 vWPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvIce = aIce;\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying float vIce;\nvarying vec3 vWPos;\nuniform float uTime;\n${GLSL_NOISE}`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.14, vIce);')
        .replace(
          '#include <opaque_fragment>',
          /* glsl */ `
          {
            // glitter: sparse snow crystals that catch the light as the camera moves
            vec3 vd = normalize(cameraPosition - vWPos);
            vec3 cell = floor(vWPos * 13.0);
            float h1 = hash31(cell);
            float h2 = hash31(cell + 19.0);
            float glint = pow(max(0.0, sin(dot(vd, vec3(41.0, 29.0, 23.0)) + h2 * 80.0 + uTime * 0.9)), 22.0);
            float sp = step(0.984, h1) * glint * (1.0 - vIce);
            outgoingLight += vec3(0.85, 0.92, 1.0) * sp * 1.9;
            // frosty streaks inside the ice
            float streak = smoothstep(0.62, 0.9, fbm3(vWPos * vec3(1.4, 1.4, 6.0)));
            outgoingLight += vec3(0.25, 0.4, 0.55) * streak * vIce * 0.3;
            // the ice picks up a little of the aurora at glancing angles
            float gl = pow(1.0 - clamp(dot(vd, normalize(vWPos)), 0.0, 1.0), 2.5);
            outgoingLight += vec3(0.05, 0.42, 0.36) * gl * vIce * 0.5 + vec3(0.02, 0.07, 0.09) * vIce;
          }
          #include <opaque_fragment>`
        );
    };
    this.terrain = new THREE.Mesh(g, mat);
    this.terrain.receiveShadow = true;
    this.terrain.renderOrder = RENDER_ORDER.terrain;
    this.group.add(this.terrain);
    this.disposables.push(g, mat);
  }

  // ---------------------------------------------------------------- objects

  _addBulb(pos, size, ci) {
    this.bulbP.push(pos.clone());
    this.bulbS.push(size);
    this.bulbC.push(ci);
    return this.bulbP.length - 1;
  }

  _addPool(n, radius, color) {
    this.poolN.push(n.clone());
    this.poolR.push(radius);
    this.poolC.push(color);
    return this.poolN.length - 1;
  }

  _buildObjects() {
    const rng = new RNG(this.seed + ':objects:' + this.night);
    this.bulbP = []; this.bulbS = []; this.bulbC = [];
    this.poolN = []; this.poolR = []; this.poolC = [];
    const flatMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.88, metalness: 0 });
    this.disposables.push(flatMat);
    this.flatMat = flatMat;
    const mkId = () => this.lightables.length;

    // ---- trees
    const treeGeo = geo('tree', () => conifer(TREE_TIERS, TREE_GREENS, 0.24, 0.9, 9));
    this.treeMesh = new THREE.InstancedMesh(treeGeo, flatMat, Math.max(1, this.trees.length));
    this.treeMesh.castShadow = true;
    this.treeMesh.receiveShadow = true;
    this.treeMesh.count = this.trees.length;
    this.group.add(this.treeMesh);
    this.starSpots = [];
    this.trees.forEach((t, i) => {
      const o = {
        id: mkId(), type: 'tree', n: t.n, idx: i, scale: t.scale,
        base: this.surface(t.n, -0.06), quat: quatFromUpYaw(t.n, t.yaw),
        lit: false, anim: 0, target: 0, wob: 0, wobV: 0, gnaw: 0, claimed: null,
      };
      o.pos = o.base;
      _m.compose(o.base, o.quat, _s.setScalar(t.scale));
      this.treeMesh.setMatrixAt(i, _m);
      this.treeMesh.setColorAt(i, _c.setRGB(this.biome.tree[0], this.biome.tree[1], this.biome.tree[2]));
      const b0 = this.bulbP.length;
      TREE_TIERS.forEach((tier, ti) => {
        const cnt = [6, 5, 4][ti];
        const offA = rng.range(0, TAU);
        for (let k = 0; k < cnt; k++) {
          const a = offA + (k / cnt) * TAU;
          const rr = tier.r * 0.86 + 0.07, yy = tier.y + tier.h * 0.14;
          _v.set(Math.cos(a) * rr, yy, Math.sin(a) * rr).applyMatrix4(_m);
          this._addBulb(_v, 0.135 * Math.sqrt(t.scale), (k + ti * 2 + i) % CFG.bulbColors.length);
        }
      });
      o.bulbs = [b0, this.bulbP.length];
      o.star = this.starSpots.length;
      this.starSpots.push({ pos: new THREE.Vector3(0, TREE_TOP + 0.16, 0).applyMatrix4(_m), quat: o.quat, s: 0.3 * Math.sqrt(t.scale) });
      o.pool = this._addPool(t.n, 5.2 * t.scale, [0.34, 0.24, 0.12]);
      o.top = new THREE.Vector3(0, TREE_TOP * 0.6, 0).applyMatrix4(_m);
      this.lightables.push(o);
    });

    // ---- houses
    const winGeo = geo('houseWin', houseWindowsGeometry);
    this.winMat = glowMaterial({ twinkle: 0.07 });
    this.winMesh = new THREE.InstancedMesh(winGeo, this.winMat, Math.max(1, this.houses.length));
    this.winMesh.count = this.houses.length;
    this.group.add(this.winMesh);
    this.disposables.push(this.winMat);
    const hSpots = geo('houseSpots', houseBulbSpots);
    this.houses.forEach((h, i) => {
      const g = geo('house' + h.variant, () => houseGeometry(HOUSE_WALLS[h.variant], HOUSE_DOORS[h.variant]));
      const mesh = new THREE.Mesh(g, flatMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.surface(h.n, -0.1, mesh.position);
      quatFromUpForward(h.n, h.fwd, mesh.quaternion);
      mesh.updateMatrix();
      this.group.add(mesh);
      this.winMesh.setMatrixAt(i, mesh.matrix);
      this.winMesh.setColorAt(i, _c.setRGB(0.02, 0.03, 0.06));
      const o = {
        id: mkId(), type: 'house', n: h.n, idx: i, mesh, pos: mesh.position.clone(),
        lit: false, anim: 0, target: 0, wob: 0, wobV: 0, gnaw: 0, claimed: null, smokeT: rng.range(0, 1),
      };
      const b0 = this.bulbP.length;
      hSpots.forEach((s, k) => this._addBulb(_v.copy(s).applyMatrix4(mesh.matrix), 0.11, (k + i) % CFG.bulbColors.length));
      o.bulbs = [b0, this.bulbP.length];
      o.pool = this._addPool(h.n, 8.5, [0.5, 0.3, 0.1]);
      o.chimney = new THREE.Vector3(0.75, 3.62, -0.5).applyMatrix4(mesh.matrix);
      o.top = new THREE.Vector3(0, 2.2, 0).applyMatrix4(mesh.matrix);
      this.lightables.push(o);
      this.obstacles.push({ n: h.n, r: 2.5 });
    });

    // ---- lamps
    const lampGeo = geo('lamp', lampGeometry);
    const glassGeo = geo('lampGlass', () => new THREE.CylinderGeometry(0.33, 0.16, 0.42, 6).translate(0, 2.65, 0));
    this.lampMesh = new THREE.InstancedMesh(lampGeo, flatMat, Math.max(1, this.lamps.length));
    this.lampMesh.castShadow = true;
    this.lampMesh.count = this.lamps.length;
    this.glassMat = glowMaterial({ twinkle: 0.1 });
    this.glassMesh = new THREE.InstancedMesh(glassGeo, this.glassMat, Math.max(1, this.lamps.length));
    this.glassMesh.count = this.lamps.length;
    this.group.add(this.lampMesh, this.glassMesh);
    this.disposables.push(this.glassMat);
    this.lamps.forEach((l, i) => {
      const base = this.surface(l.n, -0.04);
      const q = quatFromUpYaw(l.n, l.yaw);
      _m.compose(base, q, _s.setScalar(1));
      this.lampMesh.setMatrixAt(i, _m);
      this.lampMesh.setColorAt(i, _c.setRGB(1, 1, 1));
      this.glassMesh.setMatrixAt(i, _m);
      this.glassMesh.setColorAt(i, _c.setRGB(0.03, 0.04, 0.07));
      const pool = this._addPool(l.n, 7.0, [0.55, 0.36, 0.13]);
      const top = new THREE.Vector3(0, 2.7, 0).applyMatrix4(_m);
      if (l.pilot) {
        this.pilot = { type: 'lamp', idx: i, pool, n: l.n, pos: base, top };
        return;
      }
      this.lightables.push({
        id: mkId(), type: 'lamp', n: l.n, idx: i, pos: base, top, pool, bulbs: [0, 0],
        lit: false, anim: 0, target: 0, wob: 0, wobV: 0, gnaw: 0, claimed: null,
      });
    });

    // ---- snowmen
    const snowMat = new THREE.MeshStandardMaterial({ color: 0xf1f5ff, roughness: 0.95 });
    const coalMat = new THREE.MeshStandardMaterial({ color: 0x15151c, roughness: 0.6 });
    const carrotMat = new THREE.MeshStandardMaterial({ color: 0xff8a2b, roughness: 0.7, emissive: 0x4a1c00 });
    const twigMat = new THREE.MeshStandardMaterial({ color: 0x4a2e20, roughness: 0.9 });
    const scarfMat = new THREE.MeshStandardMaterial({ color: 0xe8384f, roughness: 0.8, emissive: 0x3a0810 });
    this.disposables.push(snowMat, coalMat, carrotMat, twigMat, scarfMat);
    const sph = geo('sph', () => new THREE.SphereGeometry(1, 16, 12));
    const dot = geo('dot', () => new THREE.SphereGeometry(1, 6, 5));
    const twig = geo('twig', () => new THREE.CylinderGeometry(0.022, 0.035, 0.72, 5).translate(0, 0.36, 0));
    const carrot = geo('carrot', () => new THREE.ConeGeometry(0.07, 0.36, 6).rotateX(Math.PI / 2));
    const scarfG = geo('scarf', () => new THREE.TorusGeometry(0.3, 0.09, 6, 14).rotateX(Math.PI / 2));
    const scarfTail = geo('scarfTail', () => new THREE.BoxGeometry(0.16, 0.42, 0.07));
    this.snowmen.forEach((sm) => {
      const g = new THREE.Group();
      this.surface(sm.n, -0.08, g.position);
      quatFromUpForward(sm.n, sm.fwd, g.quaternion);
      const add = (geom, mat, x, y, z, sx, sy = sx, sz = sx, parent = g) => {
        const m = new THREE.Mesh(geom, mat);
        m.position.set(x, y, z); m.scale.set(sx, sy, sz);
        m.castShadow = true;
        parent.add(m);
        return m;
      };
      const body = new THREE.Group();
      g.add(body);
      add(sph, snowMat, 0, 0.5, 0, 0.64, 0.6, 0.64, body);
      add(sph, snowMat, 0, 1.28, 0, 0.47, 0.45, 0.47, body);
      const head = new THREE.Group();
      head.position.set(0, 1.92, 0);
      body.add(head);
      add(sph, snowMat, 0, 0, 0, 0.35, 0.34, 0.35, head);
      add(carrot, carrotMat, 0, 0, 0.46, 1, 1, 1, head);
      add(dot, coalMat, -0.12, 0.09, 0.3, 0.045, 0.045, 0.045, head);
      add(dot, coalMat, 0.12, 0.09, 0.3, 0.045, 0.045, 0.045, head);
      for (let k = 0; k < 5; k++) {
        const a = (k - 2) * 0.22;
        add(dot, coalMat, Math.sin(a) * 0.19, -0.15 + Math.abs(k - 2) * 0.032, 0.285 + Math.cos(a) * 0.03, 0.026, 0.026, 0.026, head);
      }
      add(dot, coalMat, 0, 1.4, 0.44, 0.045, 0.045, 0.045, body);
      add(dot, coalMat, 0, 1.2, 0.46, 0.045, 0.045, 0.045, body);
      const armL = new THREE.Group(), armR = new THREE.Group();
      armL.position.set(-0.4, 1.38, 0); armR.position.set(0.4, 1.38, 0);
      armL.rotation.z = 1.0; armR.rotation.z = -1.0;
      add(twig, twigMat, 0, 0, 0, 1, 1, 1, armL); add(twig, twigMat, 0, 0, 0, 1, 1, 1, armR);
      body.add(armL, armR);
      const scarf = new THREE.Group();
      scarf.position.set(0, 1.63, 0);
      add(scarfG, scarfMat, 0, 0, 0, 1, 1, 1, scarf);
      add(scarfTail, scarfMat, 0.2, -0.22, 0.27, 1, 1, 1, scarf).rotation.z = 0.25;
      scarf.scale.setScalar(0.001);
      body.add(scarf);
      g.updateMatrixWorld(true);
      this.group.add(g);
      const o = {
        id: mkId(), type: 'snowman', n: sm.n, group: g, body, head, armL, armR, scarf, fwd: sm.fwd, pos: g.position.clone(),
        lit: false, anim: 0, target: 0, wob: 0, wobV: 0, gnaw: 0, claimed: null, cool: rng.range(0.5, 2), phase: rng.range(0, TAU),
      };
      // a sash of fairy lights across the chest
      const b0 = this.bulbP.length;
      for (let k = 0; k < 6; k++) {
        const t = k / 5;
        _v.set(lerp(-0.36, 0.34, t), lerp(1.52, 0.98, t), 0.44 - Math.abs(t - 0.5) * 0.3).applyMatrix4(g.matrixWorld);
        this._addBulb(_v, 0.085, k % CFG.bulbColors.length);
      }
      o.bulbs = [b0, this.bulbP.length];
      o.pool = this._addPool(sm.n, 5.0, [0.2, 0.3, 0.42]);
      o.top = new THREE.Vector3(0, 1.9, 0).applyMatrix4(g.matrixWorld);
      o.hand = new THREE.Vector3(0.75, 1.9, 0.2).applyMatrix4(g.matrixWorld);
      this.lightables.push(o);
    });

    // ---- the Great Tree at the pole
    {
      const g = conifer(GT_TIERS, [0x15624a, 0x196f51, 0x1e7d59, 0x238b61, 0x299a6a], 0.95, 2.1, 14);
      // its own material: the tree fades to a ghostly outline when it gets between the camera and Boo
      this.greatMat = flatMat.clone();
      this.greatMat.transparent = true;
      this.disposables.push(this.greatMat);
      const mesh = new THREE.Mesh(g, this.greatMat);
      this.surface(this.pole, -0.2, mesh.position);
      quatFromUpYaw(this.pole, 0, mesh.quaternion);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.updateMatrix();
      this.group.add(mesh);
      this.disposables.push(g);
      const tiers = [];
      GT_TIERS.forEach((tier, ti) => {
        const b0 = this.bulbP.length;
        const cnt = GT_BULBS[ti];
        const offA = rng.range(0, TAU);
        for (let k = 0; k < cnt; k++) {
          const a = offA + (k / cnt) * TAU;
          const rr = tier.r * 0.87 + 0.1, yy = tier.y + tier.h * 0.13;
          _v.set(Math.cos(a) * rr, yy, Math.sin(a) * rr).applyMatrix4(mesh.matrix);
          this._addBulb(_v, 0.26, (k + ti) % CFG.bulbColors.length);
        }
        tiers.push({ bulbs: [b0, this.bulbP.length], anim: 0, on: false });
      });
      this.starMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 0.36, 0.1), fog: false });
      const star = new THREE.Mesh(geo('bigStar', () => starGeometry(1.25, 0.56, 0.36)), this.starMat);
      star.position.set(0, GT_TOP + 1.0, 0).applyMatrix4(mesh.matrix);
      star.quaternion.copy(mesh.quaternion);
      this.group.add(star);
      this.disposables.push(this.starMat);
      // a beam of light from the star, switched on when the planet is fully lit
      this.beamMat = new THREE.ShaderMaterial({
        uniforms: { uTime: U.uTime, uGain: { value: 0 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: /* glsl */ `
          uniform float uTime; uniform float uGain; varying vec2 vUv;
          void main(){
            // clamp: interpolated vUv.y can land a hair above 1.0 at the beam's tip, and pow() of a
            // negative base is NaN, which bloom then smears into a black block across the frame
            float fade = pow(max(0.0, 1.0 - vUv.y), 1.6);
            float shimmer = 0.75 + 0.25 * sin(vUv.y * 40.0 - uTime * 9.0 + sin(vUv.x * 12.566) * 2.0);
            gl_FragColor = vec4(vec3(1.0, 0.82, 0.45) * fade * shimmer * uGain, 1.0);
          }`,
        blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
      });
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 0.45, 70, 20, 1, true).translate(0, 35, 0), this.beamMat);
      beam.position.copy(star.position);
      beam.quaternion.copy(mesh.quaternion);
      beam.visible = false;
      beam.renderOrder = 13;
      this.group.add(beam);
      this.beam = beam;
      this.disposables.push(this.beamMat, beam.geometry);
      const pool = this._addPool(this.pole, 17, [0.55, 0.4, 0.2]);
      this.great = {
        mesh, tiers, star, starAnim: 0, starTarget: 0, pool, level: 0,
        top: star.position.clone(), n: this.pole.clone(), pos: mesh.position.clone(), spin: 0, fade: 1,
      };
      this.obstacles.push({ n: this.pole, r: 3.6 });

      // presents heaped under it
      const giftGeo = geo('gift', () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
      const giftMat = new THREE.MeshStandardMaterial({ roughness: 0.6, emissive: 0x000000 });
      this.disposables.push(giftMat);
      const gifts = new THREE.InstancedMesh(giftGeo, giftMat, 11);
      const giftCols = [0xe8384f, 0x2fa56f, 0xffc94d, 0x3b7fe0, 0xf06fb0, 0xf2f2f2];
      const pe1 = new THREE.Vector3(1, 0, 0), pe2 = new THREE.Vector3(0, 0, 1);
      for (let i = 0; i < 11; i++) {
        const n = offsetOnSphere(this.pole, pe1, pe2, (i / 11) * TAU + rng.range(-0.2, 0.2), rng.range(2.3, 4.0) / CFG.R);
        const s = rng.range(0.45, 0.95);
        _m.compose(this.surface(n, -0.05, _v), quatFromUpYaw(n, rng.range(0, TAU), _q), _s.set(s, s * rng.range(0.6, 1.1), s));
        gifts.setMatrixAt(i, _m);
        gifts.setColorAt(i, _c.set(giftCols[i % giftCols.length]));
      }
      gifts.castShadow = true;
      this.group.add(gifts);
    }

    // ---- decoration: snow drifts, candy canes, coal burrows
    if (this.lumps.length) {
      const lg = geo('lump', () => new THREE.SphereGeometry(1, 14, 8));
      const lm = new THREE.MeshStandardMaterial({ color: 0xe9f0ff, roughness: 0.95 });
      this.disposables.push(lm);
      const lumps = new THREE.InstancedMesh(lg, lm, this.lumps.length);
      this.lumps.forEach((l, i) => {
        _m.compose(this.surface(l.n, -0.25 * l.s, _v), quatFromUpYaw(l.n, l.yaw, _q), _s.set(l.s * 1.7, l.s * 0.5, l.s * 1.3));
        lumps.setMatrixAt(i, _m);
      });
      lumps.receiveShadow = true;
      this.group.add(lumps);
    }
    if (this.canes.length) {
      const stripe = canvasTexture(64, 64, (g, w, h) => {
        g.fillStyle = '#fbf6ee'; g.fillRect(0, 0, w, h);
        g.strokeStyle = '#d9303f'; g.lineWidth = 15;
        for (let i = -2; i < 4; i++) { g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32 + 64, 64); g.stroke(); }
      }, { repeat: true });
      stripe.repeat.set(7, 1);
      const cm = new THREE.MeshStandardMaterial({ map: stripe, roughness: 0.35, emissive: 0x2a0a0c });
      this.disposables.push(cm, stripe);
      const canes = new THREE.InstancedMesh(geo('cane', caneGeometry), cm, this.canes.length);
      this.canes.forEach((c, i) => {
        _m.compose(this.surface(c.n, -0.05, _v), quatFromUpYaw(c.n, c.yaw, _q), _s.setScalar(c.s));
        canes.setMatrixAt(i, _m);
      });
      canes.castShadow = true;
      this.group.add(canes);
    }
    if (this.burrows.length) {
      const cg = geo('coal', () => new THREE.IcosahedronGeometry(1, 0));
      const cmat = new THREE.MeshStandardMaterial({ color: 0x17161d, roughness: 0.45, flatShading: true });
      this.disposables.push(cmat);
      const per = 8;
      const coal = new THREE.InstancedMesh(cg, cmat, this.burrows.length * per);
      this.burrows.forEach((b, bi) => {
        const t1 = anyTangent(b.n), t2 = new THREE.Vector3().crossVectors(b.n, t1);
        b.pos = this.surface(b.n, 0);
        for (let k = 0; k < per; k++) {
          const n = offsetOnSphere(b.n, t1, t2, (k / per) * TAU + rng.range(-0.3, 0.3), rng.range(0.7, 1.35) / CFG.R);
          const s = rng.range(0.3, 0.6);
          _m.compose(this.surface(n, s * 0.2, _v), _q.setFromEuler(new THREE.Euler(rng.range(0, 3), rng.range(0, 3), rng.range(0, 3))), _s.set(s, s * 0.8, s));
          coal.setMatrixAt(bi * per + k, _m);
        }
      });
      coal.castShadow = true;
      this.group.add(coal);
      // the hole itself: a dark disc
      const hole = new THREE.InstancedMesh(poolGeometry(), new THREE.MeshBasicMaterial({ color: 0x05060c, fog: false }), this.burrows.length);
      this.burrows.forEach((b, bi) => {
        _m.compose(this.surface(b.n, 0.06, _v), quatFromUpYaw(b.n, 0, _q), _s.setScalar(0.75));
        hole.setMatrixAt(bi, _m);
      });
      this.group.add(hole);
      this.disposables.push(hole.material, hole.geometry);
    }

    // ---- instanced glowing things: bulbs, tree stars, light pools
    const nb = Math.max(1, this.bulbP.length);
    this.bulbMat = glowMaterial({ twinkle: 0.45 });
    this.bulbMesh = new THREE.InstancedMesh(geo('bulb', () => new THREE.SphereGeometry(1, 8, 6)), this.bulbMat, nb);
    this.bulbMesh.frustumCulled = false;
    for (let i = 0; i < this.bulbP.length; i++) {
      _m.compose(this.bulbP[i], IDENT_Q, _s.setScalar(0));
      this.bulbMesh.setMatrixAt(i, _m);
      const c = CFG.bulbColors[this.bulbC[i]];
      this.bulbMesh.setColorAt(i, _c.setRGB(c[0], c[1], c[2]));
    }
    this.group.add(this.bulbMesh);

    this.treeStarMat = glowMaterial({ twinkle: 0.25 });
    this.starMesh = new THREE.InstancedMesh(geo('star', () => starGeometry(1, 0.46, 0.3)), this.treeStarMat, Math.max(1, this.starSpots.length));
    this.starMesh.count = this.starSpots.length;
    this.starMesh.frustumCulled = false;
    this.starSpots.forEach((s, i) => {
      _m.compose(s.pos, s.quat, _s.setScalar(0));
      this.starMesh.setMatrixAt(i, _m);
      this.starMesh.setColorAt(i, _c.setRGB(3.8, 2.5, 0.5));
    });
    this.group.add(this.starMesh);

    this.poolMat = poolMaterial();
    this.poolMesh = new THREE.InstancedMesh(geo('pool', poolGeometry), this.poolMat, Math.max(1, this.poolN.length));
    this.poolMesh.renderOrder = RENDER_ORDER.pools;
    this.poolMesh.frustumCulled = false;
    for (let i = 0; i < this.poolN.length; i++) {
      _m.compose(this.surface(this.poolN[i], 0.1, _v), quatFromUpYaw(this.poolN[i], 0, _q), _s.setScalar(this.poolR[i]));
      this.poolMesh.setMatrixAt(i, _m);
      this.poolMesh.setColorAt(i, _c.setRGB(0, 0, 0));
    }
    this.group.add(this.poolMesh);
    this.disposables.push(this.bulbMat, this.treeStarMat, this.poolMat);

    // pilot lamp is on from the start
    if (this.pilot) {
      this.glassMesh.setColorAt(this.pilot.idx, _c.setRGB(3.6, 2.2, 0.7));
      const pc = this.poolC[this.pilot.pool];
      this.poolMesh.setColorAt(this.pilot.pool, _c.setRGB(pc[0], pc[1], pc[2]));
    }
    this._flush(true);
  }

  // ---------------------------------------------------------------- lighting state

  /** Light or un-light something. Returns true if the state changed. */
  setLit(o, lit) {
    if (o.lit === lit) return false;
    o.lit = lit;
    o.target = lit ? 1 : 0;
    this.litCount += lit ? 1 : -1;
    o.wobV += lit ? 7 : -4;
    o.gnaw = 0;
    this.active.add(o);
    return true;
  }

  /** Give something a squash-and-stretch jolt (used by the BOO shockwave). */
  jolt(o, amount = 5) {
    o.wobV += amount;
    this.active.add(o);
  }

  /** A humbug chewing on the wiring makes the lights flicker (0..1). */
  setGnaw(o, g) {
    o.gnaw = g;
    this.active.add(o);
  }

  _setBulbs(range, a, dim = 1) {
    const [b0, b1] = range;
    const n = b1 - b0;
    for (let i = b0; i < b1; i++) {
      const start = ((i - b0) / n) * 0.6;
      const t = clamp((a - start) / 0.4);
      const s = this.bulbS[i] * (t <= 0 ? 0 : easeOutBack(t, 2.4)) * dim;
      _m.compose(this.bulbP[i], IDENT_Q, _s.setScalar(Math.max(0, s)));
      this.bulbMesh.setMatrixAt(i, _m);
    }
    if (n > 0) this._dirty.bulbM = true;
  }

  _setPool(idx, k) {
    const c = this.poolC[idx];
    this.poolMesh.setColorAt(idx, _c.setRGB(c[0] * k, c[1] * k, c[2] * k));
    this._dirty.poolC = true;
  }

  _apply(o, time) {
    const a = o.anim;
    const fl = o.gnaw > 0 ? 1 - 0.8 * o.gnaw * (0.5 + 0.5 * Math.sin(time * 34 + o.id * 1.7)) : 1;
    const k = a * fl;
    const sy = 1 + o.wob * 0.2, sxz = 1 - o.wob * 0.1;
    switch (o.type) {
      case 'tree': {
        this._setBulbs(o.bulbs, a, 0.55 + 0.45 * fl);
        const st = clamp((a - 0.55) / 0.45);
        const sp = this.starSpots[o.star];
        _m.compose(sp.pos, sp.quat, _s.setScalar(sp.s * (st <= 0 ? 0 : easeOutBack(st, 3)) * fl));
        this.starMesh.setMatrixAt(o.star, _m);
        _m.compose(o.base, o.quat, _s.set(o.scale * sxz, o.scale * sy, o.scale * sxz));
        this.treeMesh.setMatrixAt(o.idx, _m);
        const tt = this.biome.tree;
        this.treeMesh.setColorAt(o.idx, _c.setRGB(tt[0] * (1 + 0.75 * k), tt[1] * (1 + 0.6 * k), tt[2] * (1 + 0.3 * k)));
        this._dirty.starM = this._dirty.treeM = this._dirty.treeC = true;
        break;
      }
      case 'house': {
        this._setBulbs(o.bulbs, a, 0.55 + 0.45 * fl);
        this.winMesh.setColorAt(o.idx, _c.setRGB(lerp(0.02, 3.3, k), lerp(0.03, 1.9, k), lerp(0.06, 0.6, k)));
        o.mesh.scale.set(sxz, sy, sxz);
        o.mesh.updateMatrix();
        this.winMesh.setMatrixAt(o.idx, o.mesh.matrix);
        this._dirty.winC = this._dirty.winM = true;
        break;
      }
      case 'lamp': {
        this.glassMesh.setColorAt(o.idx, _c.setRGB(lerp(0.03, 3.6, k), lerp(0.04, 2.2, k), lerp(0.07, 0.7, k)));
        this._dirty.glassC = true;
        break;
      }
      case 'snowman': {
        this._setBulbs(o.bulbs, a, 0.55 + 0.45 * fl);
        o.scarf.scale.setScalar(Math.max(0.001, a <= 0 ? 0 : easeOutBack(a, 2)));
        o.group.scale.set(sxz, sy, sxz);
        break;
      }
    }
    this._setPool(o.pool, k);
  }

  _flush(all = false) {
    const d = this._dirty || {};
    if (all || d.bulbM) this.bulbMesh.instanceMatrix.needsUpdate = true;
    if (all || d.poolC) this.poolMesh.instanceColor.needsUpdate = true;
    if (all || d.starM) this.starMesh.instanceMatrix.needsUpdate = true;
    if ((all || d.treeM) && this.treeMesh.count) this.treeMesh.instanceMatrix.needsUpdate = true;
    if ((all || d.treeC) && this.treeMesh.instanceColor) this.treeMesh.instanceColor.needsUpdate = true;
    if ((all || d.winC) && this.winMesh.instanceColor) this.winMesh.instanceColor.needsUpdate = true;
    if (all || d.winM) this.winMesh.instanceMatrix.needsUpdate = true;
    if ((all || d.glassC) && this.glassMesh.instanceColor) this.glassMesh.instanceColor.needsUpdate = true;
    this._dirty = {};
  }

  update(dt, time) {
    if (!this._dirty) this._dirty = {};
    // per-object transitions
    for (const o of this.active) {
      const rate = o.target > o.anim ? 1.5 : 2.4;
      if (o.anim !== o.target) {
        o.anim = o.target > o.anim ? Math.min(o.target, o.anim + dt * rate) : Math.max(o.target, o.anim - dt * rate);
      }
      // squash & stretch spring
      const acc = -190 * o.wob - 11 * o.wobV;
      o.wobV += acc * dt;
      o.wob += o.wobV * dt;
      this._apply(o, time);
      if (o.anim === o.target && Math.abs(o.wob) < 0.004 && Math.abs(o.wobV) < 0.04 && o.gnaw <= 0) {
        o.wob = 0; o.wobV = 0;
        this._apply(o, time);
        this.active.delete(o);
      }
    }

    // living snowmen sway and wave
    for (const o of this.lightables) {
      if (o.type !== 'snowman' || o.anim <= 0) continue;
      const t = time * 2.2 + o.phase;
      o.body.rotation.z = Math.sin(t) * 0.07 * o.anim;
      o.body.position.y = Math.abs(Math.sin(t * 1.5)) * 0.07 * o.anim;
      o.armR.rotation.z = -1.0 - (0.5 + 0.5 * Math.sin(t * 2.4)) * 0.9 * o.anim;
      o.armL.rotation.z = 1.0 + Math.sin(t * 1.3) * 0.25 * o.anim;
      o.head.rotation.y = Math.sin(t * 0.7) * 0.35 * o.anim;
    }

    // the Great Tree fills up tier by tier with the planet's spirit
    const G = this.great;
    const sp = this.spirit;
    let level = 0;
    G.tiers.forEach((tier, i) => {
      const on = sp >= GT_THRESHOLDS[i] - 1e-6 || G.starTarget > 0;
      if (on && !tier.on && this.onGreatTier) this.onGreatTier(i);
      tier.on = on;
      const target = on ? 1 : 0;
      if (tier.anim !== target) {
        tier.anim = target > tier.anim ? Math.min(1, tier.anim + dt * 1.2) : Math.max(0, tier.anim - dt * 2);
        this._setBulbs(tier.bulbs, tier.anim);
      }
      level += tier.anim;
    });
    if (level !== G.level) {
      G.level = level;
      this._setPool(G.pool, level / 5);
    }
    if (G.starAnim !== G.starTarget) {
      G.starAnim = G.starTarget > G.starAnim ? Math.min(1, G.starAnim + dt * 0.9) : Math.max(0, G.starAnim - dt * 2);
    }
    const sa = G.starAnim;
    const glow = 0.25 + (level / 5) * 0.75;
    this.starMat.color.setRGB(lerp(0.5 * glow, 5.5, sa), lerp(0.36 * glow, 3.7, sa), lerp(0.1 * glow, 0.85, sa));
    G.spin += dt * (0.4 + sa * 2.2);
    _q.setFromAxisAngle(_v.set(0, 1, 0), G.spin);
    G.star.quaternion.copy(G.mesh.quaternion).multiply(_q);
    G.star.scale.setScalar(1 + sa * 0.35 + Math.sin(time * 5) * 0.04 * sa);
    this.beam.visible = sa > 0.01;
    this.beamMat.uniforms.uGain.value = sa * sa * 0.85;
    // once the star is lit, every bulb on the planet burns a little brighter
    this.bulbMat.uniforms.uGain.value = 1 + sa * 0.5;
    this.poolMat.uniforms.uGain.value = 1 + sa * 0.6;

    this._flush();
  }

  /**
   * Fade the Great Tree out when it would block the view of the ghost.
   * Closest distance between the camera→ghost segment and the tree's trunk axis decides it.
   */
  fadeGreat(camPos, ghostPos, dt) {
    const G = this.great;
    const p2 = G.pos, d2 = _v2.copy(G.n).multiplyScalar(GT_TOP);
    const d1 = _v.copy(ghostPos).sub(camPos);
    const rx = camPos.x - p2.x, ry = camPos.y - p2.y, rz = camPos.z - p2.z;
    const a = d1.dot(d1), e = d2.dot(d2), f = d2.x * rx + d2.y * ry + d2.z * rz;
    const c = d1.x * rx + d1.y * ry + d1.z * rz, b = d1.dot(d2), denom = a * e - b * b;
    let s = denom > 1e-9 ? clamp((b * f - c * e) / denom) : 0;
    let t = (b * s + f) / e;
    if (t < 0) { t = 0; s = clamp(-c / a); } else if (t > 1) { t = 1; s = clamp((b - c) / a); }
    const dx = rx + d1.x * s - d2.x * t, dy = ry + d1.y * s - d2.y * t, dz = rz + d1.z * s - d2.z * t;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const radius = 5.0 * (1 - t) + 0.8;
    const blocking = dt > 0 && s < 0.93 && dist < radius + 3.5;
    if (dt < 0) dt = 0.05;
    G.fade += ((blocking ? 0.16 : 1) - G.fade) * Math.min(1, dt * 7);
    this.greatMat.opacity = G.fade;
    this.greatMat.depthWrite = G.fade > 0.97;
  }

  /** Lightables whose direction lies within `radius` world units of unit vector n. */
  near(n, radius, out = []) {
    const cosMax = Math.cos(radius / CFG.R);
    for (const o of this.lightables) if (o.n.dot(n) >= cosMax) out.push(o);
    return out;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
    });
    for (const d of this.disposables) d.dispose && d.dispose();
  }
}
