// Shared math, RNG, noise and geometry helpers.
import * as THREE from 'three';

export const TAU = Math.PI * 2;

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const remap = (x, a, b, c, d) => c + (d - c) * clamp((x - a) / (b - a));
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** Frame-rate independent exponential smoothing. */
export const damp = (cur, target, lambda, dt) => lerp(cur, target, 1 - Math.exp(-lambda * dt));

export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t) => t * t * t;
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutBack = (t, s = 1.70158) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);
export const easeOutElastic = (t) => {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (TAU / 3)) + 1;
};

// ---------------------------------------------------------------- RNG

export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class RNG {
  constructor(seed) {
    this.f = mulberry32(typeof seed === 'string' ? hashStr(seed) : seed >>> 0);
  }
  next() { return this.f(); }
  range(a, b) { return a + (b - a) * this.f(); }
  int(a, b) { return Math.floor(this.range(a, b + 1)); }
  pick(arr) { return arr[Math.floor(this.f() * arr.length)]; }
  chance(p) { return this.f() < p; }
  sign() { return this.f() < 0.5 ? -1 : 1; }
  /** Uniform random unit vector. */
  onSphere(out = new THREE.Vector3()) {
    const z = this.f() * 2 - 1;
    const a = this.f() * TAU;
    const r = Math.sqrt(1 - z * z);
    return out.set(r * Math.cos(a), z, r * Math.sin(a));
  }
}

// ---------------------------------------------------------------- noise

/** Ken Perlin's improved noise, seeded. Returns roughly [-1, 1]. */
export function makeNoise3D(rand) {
  const perm = new Uint8Array(256);
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = (rand() * (i + 1)) | 0;
    const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
  }
  const p = new Uint8Array(512);
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const grad = (hash, x, y, z) => {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  };
  return function noise(x, y, z) {
    const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
    const X = fx & 255, Y = fy & 255, Z = fz & 255;
    x -= fx; y -= fy; z -= fz;
    const u = fade(x), v = fade(y), w = fade(z);
    const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z;
    const B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;
    return lerp(
      lerp(
        lerp(grad(p[AA], x, y, z), grad(p[BA], x - 1, y, z), u),
        lerp(grad(p[AB], x, y - 1, z), grad(p[BB], x - 1, y - 1, z), u),
        v
      ),
      lerp(
        lerp(grad(p[AA + 1], x, y, z - 1), grad(p[BA + 1], x - 1, y, z - 1), u),
        lerp(grad(p[AB + 1], x, y - 1, z - 1), grad(p[BB + 1], x - 1, y - 1, z - 1), u),
        v
      ),
      w
    );
  };
}

export function fbm(noise, x, y, z, octaves = 4, lacunarity = 2.03, gain = 0.5) {
  let amp = 0.5, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x, y, z);
    norm += amp;
    x = x * lacunarity + 13.7; y = y * lacunarity + 7.3; z = z * lacunarity + 3.1;
    amp *= gain;
  }
  return sum / norm;
}

/** GLSL value-noise helpers shared by several shaders. */
export const GLSL_NOISE = /* glsl */ `
float hash31(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float hash21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec3 p){
  vec3 i = floor(p); vec3 f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(
    mix(mix(hash31(i), hash31(i+vec3(1.,0.,0.)), f.x), mix(hash31(i+vec3(0.,1.,0.)), hash31(i+vec3(1.,1.,0.)), f.x), f.y),
    mix(mix(hash31(i+vec3(0.,0.,1.)), hash31(i+vec3(1.,0.,1.)), f.x), mix(hash31(i+vec3(0.,1.,1.)), hash31(i+vec3(1.,1.,1.)), f.x), f.y),
    f.z);
}
float fbm3(vec3 p){ float a = 0.5; float s = 0.0; for (int i = 0; i < 4; i++){ s += a * vnoise(p); p = p * 2.02 + 17.1; a *= 0.5; } return s; }
`;

// ---------------------------------------------------------------- sphere math

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _m = new THREE.Matrix4();

/** Any unit vector perpendicular to unit vector n. */
export function anyTangent(n, out = new THREE.Vector3()) {
  if (Math.abs(n.y) < 0.9) out.set(0, 1, 0); else out.set(1, 0, 0);
  return out.addScaledVector(n, -out.dot(n)).normalize();
}

/** Remove the component of v along unit n (in place). */
export function projectTangent(v, n) {
  return v.addScaledVector(n, -v.dot(n));
}

export function angleBetween(a, b) {
  return Math.acos(clamp(a.dot(b), -1, 1));
}

/** Unit tangent at `from` pointing along the great circle toward `to`. Zero vector if coincident. */
export function tangentToward(from, to, out = new THREE.Vector3()) {
  out.copy(to).addScaledVector(from, -to.dot(from));
  const l = out.length();
  if (l < 1e-7) return out.set(0, 0, 0);
  return out.multiplyScalar(1 / l);
}

/** Move unit vector n by `angle` radians toward unit tangent dir (in place). */
export function moveOnSphere(n, dir, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return n.multiplyScalar(c).addScaledVector(dir, s).normalize();
}

/** Point at distance (radians) and bearing from a centre, given a tangent basis e1/e2 at that centre. */
export function offsetOnSphere(center, e1, e2, bearing, angle, out = new THREE.Vector3()) {
  _v1.copy(e1).multiplyScalar(Math.cos(bearing)).addScaledVector(e2, Math.sin(bearing));
  return moveOnSphere(out.copy(center), _v1, angle);
}

/** Quaternion mapping local +Y to `up` and local +Z to (roughly) `fwd`. */
export function quatFromUpForward(up, fwd, out = new THREE.Quaternion()) {
  _v1.crossVectors(up, fwd);
  if (_v1.lengthSq() < 1e-10) anyTangent(up, _v1); else _v1.normalize(); // right
  _v2.crossVectors(_v1, up).normalize(); // true forward
  _m.makeBasis(_v1, up, _v2);
  return out.setFromRotationMatrix(_m);
}

/** Quaternion mapping local +Y to `up`, spun by `yaw` around it. */
export function quatFromUpYaw(up, yaw, out = new THREE.Quaternion()) {
  anyTangent(up, _v3);
  _v3.applyAxisAngle(up, yaw);
  return quatFromUpForward(up, _v3, out);
}

/**
 * Gnomonic projection of unit vector q onto the tangent plane at c (basis e1, e2).
 * Great-circle arcs become straight lines, so planar polygon tests stay exact.
 * Returns false if q is not in front of the plane.
 */
export function gnomonic(q, c, e1, e2, out) {
  const d = q.dot(c);
  if (d < 0.05) return false;
  out.x = q.dot(e1) / d;
  out.y = q.dot(e2) / d;
  return true;
}

export function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function polyArea(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  return a / 2;
}

/**
 * Intersection of two short great-circle arcs (a→b) and (c→d), all unit vectors.
 * Returns true and writes the crossing point into `out` if they cross.
 */
export function arcIntersect(a, b, c, d, out) {
  _v1.crossVectors(a, b); // normal of first great circle
  _v2.crossVectors(c, d);
  out.crossVectors(_v1, _v2);
  const l = out.length();
  if (l < 1e-12) return false;
  out.multiplyScalar(1 / l);
  // pick the candidate on the same side as the arcs
  if (out.dot(a) < 0) out.negate();
  const within = (p, q, n) => _v3.crossVectors(p, out).dot(n) >= -1e-12 && _v3.crossVectors(out, q).dot(n) >= -1e-12;
  return within(a, b, _v1) && within(c, d, _v2);
}

// ---------------------------------------------------------------- geometry helpers

/**
 * Merge geometries into one non-indexed, vertex-coloured BufferGeometry.
 * parts: [{ geo, color, matrix?, colorFn?(x, y, z, baseColor, outColor) }]
 */
export function mergeColored(parts) {
  let count = 0;
  const prepared = [];
  for (const part of parts) {
    let g = part.geo.index ? part.geo.toNonIndexed() : part.geo.clone();
    if (part.matrix) g.applyMatrix4(part.matrix);
    if (!g.attributes.normal) g.computeVertexNormals();
    count += g.attributes.position.count;
    prepared.push({ g, color: new THREE.Color(part.color ?? 0xffffff), colorFn: part.colorFn });
  }
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const tmp = new THREE.Color();
  let o = 0;
  for (const { g, color, colorFn } of prepared) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    for (let i = 0; i < n; i++) {
      const k = (o + i) * 3;
      if (colorFn) {
        colorFn(pos[k], pos[k + 1], pos[k + 2], color, tmp);
        col[k] = tmp.r; col[k + 1] = tmp.g; col[k + 2] = tmp.b;
      } else {
        col[k] = color.r; col[k + 1] = color.g; col[k + 2] = color.b;
      }
    }
    o += n;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

/** Translation · rotation(euler) · scale matrix helper. */
export function trs(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz)
  );
}

export function canvasTexture(w, h, draw, opts = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = opts.linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  if (opts.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 4;
  return t;
}

/** Five-pointed star, extruded a little. Lies in the XY plane, centred on the origin. */
export function starGeometry(outer = 1, inner = 0.45, depth = 0.25) {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / 10) * TAU + Math.PI / 2;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: depth * 0.5, bevelSize: outer * 0.08, bevelSegments: 1 });
  g.translate(0, 0, -depth / 2);
  return g;
}
