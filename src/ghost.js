// Boo: one small ghost, one Santa hat.
import * as THREE from 'three';
import { CFG } from './config.js';
import { U, poolMaterial, poolGeometry, RENDER_ORDER } from './materials.js';
import { clamp, lerp, damp, TAU, quatFromUpForward, projectTangent, moveOnSphere, easeOutBack, easeOutElastic, easeOutCubic, canvasTexture } from './utils.js';

const Y = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();

// Dome of the body is an ellipsoid centred here.
const DOME_Y = 0.28, DOME_RX = 0.8, DOME_RY = 0.78;

function bodyGeometry() {
  const SEG = 64, RINGS = 44;
  const pos = [], nor = [], skirt = [], idx = [];
  const prof = (t) => {
    if (t < 0.42) {
      const a = (t / 0.42) * (Math.PI / 2);
      return [DOME_RX * Math.sin(a), DOME_Y + DOME_RY * Math.cos(a), 0];
    }
    const s = (t - 0.42) / 0.58;
    return [DOME_RX + 0.02 * s + 0.18 * s * s, DOME_Y - 1.23 * s, s];
  };
  for (let i = 0; i <= RINGS; i++) {
    const t = i / RINGS;
    const [r, y, s] = prof(t);
    const p1 = prof(Math.max(0, t - 0.002)), p2 = prof(Math.min(1, t + 0.002));
    const dr = p2[0] - p1[0], dy = p2[1] - p1[1];
    const l = Math.hypot(dr, dy) || 1;
    const nr = -dy / l, ny = dr / l;
    for (let j = 0; j <= SEG; j++) {
      const th = (j / SEG) * TAU, c = Math.cos(th), sn = Math.sin(th);
      pos.push(r * c, y, r * sn);
      nor.push(nr * c, ny, nr * sn);
      skirt.push(s);
    }
  }
  for (let i = 0; i < RINGS; i++) {
    for (let j = 0; j < SEG; j++) {
      const a = i * (SEG + 1) + j, b = a + SEG + 1, d = a + 1, c = b + 1;
      idx.push(a, d, b, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aSkirt', new THREE.Float32BufferAttribute(skirt, 1));
  g.setIndex(idx);
  return g;
}

/** Point + outward normal on the dome at a given yaw (0 = straight ahead, +Z) and height. */
function onDome(yaw, y, outP, outN) {
  const k = clamp((y - DOME_Y) / DOME_RY, -1, 1);
  const r = DOME_RX * Math.sqrt(1 - k * k);
  outP.set(Math.sin(yaw) * r, y, Math.cos(yaw) * r);
  outN.set(outP.x / (DOME_RX * DOME_RX), (y - DOME_Y) / (DOME_RY * DOME_RY), outP.z / (DOME_RX * DOME_RX)).normalize();
}

/** Orient an object so its local +Z points along n, keeping +Y as upright as possible. */
function faceNormal(obj, n) {
  _a.crossVectors(Y, n).normalize();
  _b.crossVectors(n, _a);
  _m.makeBasis(_a, _b, n);
  obj.quaternion.setFromRotationMatrix(_m);
}

const HAT_RINGS = 16, HAT_SEG = 24, HAT_H = 1.06;

function hatConeGeometry() {
  const pos = [], idx = [], ts = [];
  for (let i = 0; i <= HAT_RINGS; i++) {
    const t = i / HAT_RINGS;
    const r = 0.44 * Math.pow(1 - t, 0.82) + 0.035 * (1 - t) + 0.014;
    for (let j = 0; j <= HAT_SEG; j++) {
      const th = (j / HAT_SEG) * TAU;
      pos.push(Math.cos(th) * r, 0.03 + t * HAT_H, Math.sin(th) * r);
      ts.push(t);
    }
  }
  for (let i = 0; i < HAT_RINGS; i++) {
    for (let j = 0; j < HAT_SEG; j++) {
      const a = i * (HAT_SEG + 1) + j, b = a + HAT_SEG + 1, d = a + 1, c = b + 1;
      idx.push(a, b, d, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.userData.base = new Float32Array(pos);
  g.userData.t = new Float32Array(ts);
  return g;
}

function fluff(geo, amount, freq = 9) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = (Math.sin(x * freq * 1.3 + y * freq) * Math.cos(z * freq * 1.1 + x * 2.0) + Math.sin(y * freq * 1.7 + z * 3.0) * 0.5) * amount;
    p.setXYZ(i, x + n.getX(i) * k, y + n.getY(i) * k, z + n.getZ(i) * k);
  }
  geo.computeVertexNormals();
  return geo;
}

export class Ghost {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;

    // --- state on the sphere
    this.p = new THREE.Vector3(0, 1, 0); // where we are (unit vector)
    this.u = new THREE.Vector3(0, 0, -1); // "up the screen" tangent; parallel-transported as we travel
    this.right = new THREE.Vector3(1, 0, 0);
    this.vel = new THREE.Vector3(); // its own flying
    this.drift = new THREE.Vector3(); // plus whatever the wind adds (set by the game; a tangent)
    this.prevVel = new THREE.Vector3();
    this.facing = new THREE.Vector3(0, 0, 1);
    this.pos = new THREE.Vector3();
    this.speed = 0;
    this.speedMul = 1;

    // --- status
    this.hasHat = true;
    this.hatState = 'on'; // on | flying | ground | returning | stolen
    this.hatT = 0;
    this.hatN = new THREE.Vector3();
    this.hatFrom = new THREE.Vector3();
    this.hatTo = new THREE.Vector3();
    this.invuln = 0;
    this.booT = -1;
    this.joy = 0;
    this.shock = 0;
    this.blinkT = 2;
    this.blink = 0;
    this.look = new THREE.Vector2();
    this.lean = new THREE.Vector3();
    this.bobPhase = 0;
    this.spinT = -1;
    this.idleFace = null; // optional tangent to face when standing still (title screen)

    // --- scene graph
    this.root = new THREE.Group();
    this.vis = new THREE.Group();
    this.root.add(this.vis);
    scene.add(this.root);
    this.root.scale.setScalar(CFG.ghost.scale);

    this.bodyMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: U.uTime,
        uLean: { value: new THREE.Vector3() },
        uBoo: { value: 0 },
        uWobble: { value: 1 },
        uColor: { value: new THREE.Color(0.93, 0.96, 1.0) },
        uRim: { value: new THREE.Color(0.5, 0.78, 1.0) },
        uOpacity: { value: 1 },
        uFlash: { value: 0 },
        uGain: { value: 0.84 },
      },
      vertexShader: /* glsl */ `
        uniform float uTime; uniform vec3 uLean; uniform float uBoo; uniform float uWobble;
        attribute float aSkirt;
        varying vec3 vN; varying vec3 vV; varying float vSkirt;
        void main(){
          vec3 p = position;
          float s = aSkirt;
          float s2 = s * s;
          float ang = atan(p.z, p.x);
          vec2 radial = normalize(p.xz + vec2(1e-5));
          // the hem ripples like a sheet in a draught
          float w = sin(ang * 6.0 + uTime * 3.4) * 0.075 * s2 + sin(ang * 3.0 - uTime * 2.3 + p.y * 3.5) * 0.045 * s;
          p.xz += radial * w * uWobble;
          p.y += sin(ang * 6.0 + uTime * 3.4 + 1.5) * 0.09 * s2 * s;
          // ...and trails behind the motion
          p.xz += uLean.xz * s2;
          p.y += length(uLean.xz) * 0.28 * s2;
          // BOO: puff out
          p.xz *= 1.0 + uBoo * 0.22 * (0.35 + s);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vN = normalize(normalMatrix * normal);
          vV = normalize(-mv.xyz);
          vSkirt = s;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform vec3 uRim; uniform float uOpacity; uniform float uFlash; uniform float uGain;
        varying vec3 vN; varying vec3 vV; varying float vSkirt;
        void main(){
          vec3 n = normalize(vN); vec3 v = normalize(vV);
          float ndv = clamp(dot(n, v), 0.0, 1.0);
          float fres = pow(1.0 - ndv, 2.3);
          float wrap = dot(n, normalize(vec3(-0.38, 0.74, 0.55))) * 0.5 + 0.5;
          vec3 shade = mix(vec3(0.36, 0.5, 0.94), vec3(1.0), smoothstep(0.16, 0.9, wrap));
          vec3 col = uColor * shade;
          col = mix(col, col * vec3(0.62, 0.78, 1.1), vSkirt * 0.65);
          col += uRim * fres * fres * 1.5;
          col += vec3(uFlash);
          float alpha = mix(0.985, 0.38, smoothstep(0.42, 1.0, vSkirt));
          alpha = clamp(alpha + fres * 0.35, 0.0, 1.0) * uOpacity;
          gl_FragColor = vec4(col * uGain, alpha);
        }`,
      transparent: true,
    });

    this.body = new THREE.Mesh(bodyGeometry(), this.bodyMat);
    this.body.renderOrder = 2;
    this.vis.add(this.body);

    // It's a ghost: when something solid is in front of Boo, you can still see it through the thing.
    // Same geometry and vertex animation, drawn only where the depth test FAILS.
    this.xrayMat = new THREE.ShaderMaterial({
      uniforms: this.bodyMat.uniforms,
      vertexShader: this.bodyMat.vertexShader,
      fragmentShader: /* glsl */ `
        uniform vec3 uRim; uniform float uOpacity;
        varying vec3 vN; varying vec3 vV; varying float vSkirt;
        void main(){
          float fres = pow(1.0 - clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0), 1.6);
          float a = (0.22 + fres * 0.6) * mix(1.0, 0.35, vSkirt);
          gl_FragColor = vec4(mix(vec3(0.8, 0.9, 1.0), uRim, fres) * 1.1, a);
        }`,
      transparent: true,
      depthWrite: false,
      depthFunc: THREE.GreaterDepth,
    });
    this.xray = new THREE.Mesh(this.body.geometry, this.xrayMat);
    this.xray.renderOrder = 1.5;
    this.vis.add(this.xray);

    // --- face
    // NB: these are flagged transparent purely so they draw *after* the x-ray layer (see above);
    // that way the x-ray only ever sees world geometry in the depth buffer, never Boo's own face.
    const dark = new THREE.MeshBasicMaterial({ color: 0x0c0918, fog: false, transparent: true });
    const white = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, transparent: true });
    const blush = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.38, 0.55), transparent: true, opacity: 0.6, depthWrite: false, fog: false });
    const xrayDark = new THREE.MeshBasicMaterial({ color: 0x0c0918, transparent: true, opacity: 0.7, depthWrite: false, depthFunc: THREE.GreaterDepth, fog: false });
    const sph = new THREE.SphereGeometry(1, 20, 14);
    this.eyes = [];
    const P = new THREE.Vector3(), N = new THREE.Vector3();
    for (const sx of [-1, 1]) {
      const eye = new THREE.Group();
      onDome(sx * 0.36, 0.5, P, N);
      eye.position.copy(P).addScaledVector(N, 0.012);
      faceNormal(eye, N);
      const ball = new THREE.Mesh(sph, dark);
      ball.scale.set(0.128, 0.182, 0.06);
      ball.renderOrder = 2.5;
      const hi = new THREE.Mesh(sph, white);
      hi.scale.setScalar(0.04);
      hi.position.set(-0.035, 0.07, 0.05);
      const hi2 = new THREE.Mesh(sph, white);
      hi2.scale.setScalar(0.017);
      hi2.position.set(0.04, -0.05, 0.055);
      hi.renderOrder = hi2.renderOrder = 2.6;
      eye.add(ball, hi, hi2);
      // the eyes show through solid things too
      const ghostEye = new THREE.Mesh(sph, xrayDark);
      ghostEye.scale.copy(ball.scale);
      ghostEye.renderOrder = 1.6;
      eye.add(ghostEye);
      eye.userData.home = eye.position.clone();
      this.vis.add(eye);
      this.eyes.push(eye);

      const cheek = new THREE.Mesh(new THREE.CircleGeometry(0.1, 18), blush);
      onDome(sx * 0.72, 0.27, P, N);
      cheek.position.copy(P).addScaledVector(N, 0.014);
      faceNormal(cheek, N);
      cheek.scale.set(1.15, 0.72, 1);
      cheek.renderOrder = 3;
      this.vis.add(cheek);
    }
    this.mouth = new THREE.Mesh(sph, dark);
    onDome(0, 0.2, P, N);
    this.mouth.position.copy(P).addScaledVector(N, 0.01);
    faceNormal(this.mouth, N);
    this.mouth.scale.set(0.07, 0.045, 0.04);
    this.mouth.renderOrder = 2.5;
    this.vis.add(this.mouth);

    // --- little arms (same shader, no skirt)
    const armGeo = new THREE.SphereGeometry(1, 14, 10);
    armGeo.setAttribute('aSkirt', new THREE.BufferAttribute(new Float32Array(armGeo.attributes.position.count), 1));
    this.arms = [];
    for (const sx of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx * 0.72, 0.02, 0.2);
      const arm = new THREE.Mesh(armGeo, this.bodyMat);
      arm.scale.set(0.2, 0.135, 0.135);
      arm.position.set(sx * 0.15, 0, 0);
      arm.renderOrder = 2;
      pivot.add(arm);
      pivot.userData.sx = sx;
      this.vis.add(pivot);
      this.arms.push(pivot);
    }

    // --- the hat
    this.hat = new THREE.Group();
    this.hatRest = { pos: new THREE.Vector3(0.03, 0.9, -0.03), rot: new THREE.Euler(-0.2, 0, -0.2) };
    this.hat.position.copy(this.hatRest.pos);
    this.hat.rotation.copy(this.hatRest.rot);
    const red = new THREE.MeshStandardMaterial({ color: 0xe22438, roughness: 0.7, emissive: 0x9a1424, emissiveIntensity: 1, transparent: true });
    const fur = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, emissive: 0x7f8cb8, emissiveIntensity: 1, transparent: true });
    this.hatCone = new THREE.Mesh(hatConeGeometry(), red);
    this.hatBrim = new THREE.Mesh(fluff(new THREE.TorusGeometry(0.47, 0.15, 12, 34).rotateX(Math.PI / 2), 0.022), fur);
    this.hatBrim.position.y = 0.03;
    this.pom = new THREE.Mesh(fluff(new THREE.SphereGeometry(0.175, 14, 10), 0.02, 14), fur);
    for (const m of [this.hatCone, this.hatBrim, this.pom]) { m.castShadow = true; m.renderOrder = 2.4; this.hat.add(m); }
    this.vis.add(this.hat);
    this.tipRest = new THREE.Vector3(0.5, -0.56, -0.12);
    this.tip = this.tipRest.clone();
    this.tipV = new THREE.Vector3();
    this._bendHat();

    // --- a soft halo so Boo reads as luminous against anything
    const haloTex = canvasTexture(128, 128, (g, w, h) => {
      const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      gr.addColorStop(0, 'rgba(255,255,255,0.85)');
      gr.addColorStop(0.4, 'rgba(255,255,255,0.3)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, color: new THREE.Color(0.28, 0.5, 1.0), blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.42, fog: false }));
    this.halo.scale.setScalar(5.4);
    this.halo.position.y = 0.1;
    this.halo.renderOrder = 1;
    this.root.add(this.halo);

    // --- glow: a real light for nearby objects, plus a pool painted on the snow
    this.light = new THREE.PointLight(new THREE.Color(0.72, 0.85, 1.0), 3.4, 22, 1.5);
    this.light.position.set(0, 0.9, 0);
    this.root.add(this.light);
    this.poolMat = poolMaterial();
    this.poolMat.uniforms.uTint.value.setRGB(0.17, 0.29, 0.55);
    this.pool = new THREE.Mesh(poolGeometry(), this.poolMat);
    this.pool.renderOrder = RENDER_ORDER.pools + 1;
    this.pool.scale.setScalar(7);
    scene.add(this.pool);
  }

  setWorld(world) {
    this.world = world;
  }

  /** Teleport to unit vector n with screen-up tangent u. */
  place(n, u) {
    this.p.copy(n).normalize();
    this.u.copy(u);
    projectTangent(this.u, this.p).normalize();
    this.right.crossVectors(this.u, this.p);
    this.vel.set(0, 0, 0);
    this.prevVel.set(0, 0, 0);
    this.facing.copy(this.u).negate();
    this.lean.set(0, 0, 0);
    this._syncTransform(0, 0);
  }

  get booReady() {
    return this.booT < 0;
  }

  /** Kick off the BOO animation. */
  boo() {
    this.booT = 0;
    this.blink = 0;
  }

  celebrate(amount = 1) {
    this.joy = Math.max(this.joy, amount);
  }

  /** A humbug bumped us: the hat goes flying. `away` is a unit tangent. */
  knockHat(away, dist = 8) {
    if (!this.hasHat) return false;
    this.hasHat = false;
    this.hatState = 'flying';
    this.hatT = 0;
    this.hat.updateWorldMatrix(true, false);
    this.scene.attach(this.hat);
    this.hatFrom.copy(this.hat.position);
    this.hatN.copy(this.p);
    moveOnSphere(this.hatN, away, dist / CFG.R);
    this.world.surface(this.hatN, 0.12, this.hatTo);
    this.hatSpin = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    this.hatQ0 = this.hat.quaternion.clone();
    this.invuln = 2.2;
    this.shock = 1;
    this.spinT = 0;
    return true;
  }

  /** A humbug has picked the hat up and is wearing it. `head` is the object to parent it to. */
  stealHat(head, x, y, z, scale) {
    head.attach(this.hat);
    this.hat.position.set(x, y, z);
    this.hat.rotation.set(-0.1, 0, 0.12);
    this.hat.scale.setScalar(scale);
    this.hatState = 'stolen';
    this.hatT = 0;
  }

  /** The thief has been bowled over: the hat tumbles off and lands nearby. `away` is a unit tangent. */
  dropHat(away, dist = 3) {
    this.hat.updateWorldMatrix(true, false);
    this.scene.attach(this.hat);
    this.hatFrom.copy(this.hat.position);
    this.hatN.copy(this.hatFrom).normalize();
    projectTangent(away, this.hatN);
    if (away.lengthSq() > 1e-8) moveOnSphere(this.hatN, away.normalize(), dist / CFG.R);
    this.world.surface(this.hatN, 0.12, this.hatTo);
    this.hatSpin = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    this.hatQ0 = this.hat.quaternion.clone();
    this.hatState = 'flying';
    this.hatT = 0;
  }

  /** Put the hat straight back on (new night, restart). */
  resetHat() {
    if (this.hatState !== 'on') {
      this.vis.attach(this.hat);
      this.hat.position.copy(this.hatRest.pos);
      this.hat.rotation.copy(this.hatRest.rot);
      this.hat.scale.setScalar(1);
      this.hatState = 'on';
    }
    this.hasHat = true;
    this.invuln = 0;
    this.justGotHat = false;
    this.tip.copy(this.tipRest);
    this.tipV.set(0, 0, 0);
  }

  /** World position of the hat wherever it currently is. */
  hatWorld(out = new THREE.Vector3()) {
    return this.hat.getWorldPosition(out);
  }

  headWorld(out = new THREE.Vector3(), lift = 1.5) {
    return out.copy(this.pos).addScaledVector(this.p, lift);
  }

  _bendHat() {
    const g = this.hatCone.geometry;
    const base = g.userData.base, ts = g.userData.t;
    const pos = g.attributes.position;
    const tip = this.tip;
    for (let i = 0; i < pos.count; i++) {
      const t = ts[i];
      const f = t * t * (0.55 + 0.45 * t);
      pos.setXYZ(i, base[i * 3] + tip.x * f, base[i * 3 + 1] + tip.y * f, base[i * 3 + 2] + tip.z * f);
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();
    this.pom.position.set(tip.x, 0.03 + HAT_H + tip.y - 0.02, tip.z);
  }

  _syncTransform(time, speedFrac) {
    const h = this.world.heightAt(this.p);
    const bob = Math.sin(this.bobPhase) * 0.13;
    this.pos.copy(this.p).multiplyScalar(CFG.R + h + CFG.ghost.hover + bob);
    this.root.position.copy(this.pos);
    // lean into the motion
    _a.copy(this.p);
    if (this.speed > 0.01) _a.addScaledVector(this.vel, (0.13 * speedFrac) / Math.max(this.speed, 0.01));
    _a.normalize();
    _b.copy(this.facing);
    projectTangent(_b, _a);
    if (_b.lengthSq() < 1e-8) _b.copy(this.u).negate();
    quatFromUpForward(_a, _b.normalize(), this.root.quaternion);
    // light pool on the snow below
    this.pool.position.copy(this.p).multiplyScalar(CFG.R + h + 0.12);
    quatFromUpForward(this.p, this.u, this.pool.quaternion);
  }

  /**
   * @param move THREE.Vector2 desired direction in screen space (x right, y up), length 0..1
   * @param lookAt optional THREE.Vector2 (-1..1) the eyes drift toward
   */
  update(dt, time, move, lookAt = null) {
    // ---------------- motion on the sphere
    const maxSpeed = CFG.ghost.speed * this.speedMul;
    _a.set(0, 0, 0).addScaledVector(this.right, move.x).addScaledVector(this.u, move.y).multiplyScalar(maxSpeed);
    this.prevVel.copy(this.vel);
    this.vel.lerp(_a, 1 - Math.exp(-CFG.ghost.accel * dt));
    let speed = this.vel.length();
    _d.copy(this.vel).add(this.drift); // where it actually goes
    const travel = _d.length();
    if (travel > 1e-4) {
      _b.copy(_d).multiplyScalar(1 / travel);
      _c.crossVectors(this.p, _b).normalize();
      _q.setFromAxisAngle(_c, (travel * dt) / CFG.R);
      this.p.applyQuaternion(_q).normalize();
      this.u.applyQuaternion(_q);
      this.vel.applyQuaternion(_q);
      this.prevVel.applyQuaternion(_q);
      this.facing.applyQuaternion(_q);
    }
    projectTangent(this.u, this.p).normalize();
    projectTangent(this.vel, this.p);
    this.right.crossVectors(this.u, this.p);
    this.speed = speed;
    const speedFrac = clamp(speed / CFG.ghost.speed);

    // face where we're going; when idle, turn to face the camera
    if (speed > 1.2) {
      const up = clamp(this.vel.dot(this.u) / speed, 0, 1); // how much we're heading "away"
      const side = this.facing.dot(this.right) >= 0 ? 1 : -1;
      _a.copy(this.vel).multiplyScalar(0.62 / speed).addScaledVector(this.u, -0.8).addScaledVector(this.right, side * up * 0.75);
    } else if (this.idleFace) _a.copy(this.idleFace);
    else _a.copy(this.u).negate();
    projectTangent(_a, this.p);
    if (_a.lengthSq() > 1e-8) {
      _a.normalize();
      // slerp-ish turn that never passes through zero
      const k = 1 - Math.exp(-9 * dt);
      this.facing.lerp(_a, k);
      projectTangent(this.facing, this.p);
      if (this.facing.lengthSq() < 1e-6) this.facing.copy(this.right);
      this.facing.normalize();
    }

    this.bobPhase += dt * (2.3 + speedFrac * 2.0);
    this._syncTransform(time, speedFrac);

    // ---------------- squash, stretch & BOO
    let sx = 1 - speedFrac * 0.05, sy = 1 + speedFrac * 0.09;
    let booAmt = 0, armLift = 0, mouthOpen = 0;
    if (this.booT >= 0) {
      this.booT += dt;
      const t = this.booT;
      if (t < 0.09) {
        const k = t / 0.09; // wind-up: squash down
        sx *= 1 + 0.16 * k; sy *= 1 - 0.2 * k;
        mouthOpen = k * 0.3;
      } else if (t < 0.7) {
        const k = (t - 0.09) / 0.61;
        const e = easeOutElastic(Math.min(1, k * 1.25));
        const burst = 1 - easeOutCubic(k);
        sx *= lerp(1.16, 1, e) + burst * 0.3; sy *= lerp(0.8, 1, e) + burst * 0.34;
        booAmt = burst;
        armLift = burst;
        mouthOpen = Math.min(1, burst * 1.6);
      } else {
        this.booT = -1;
      }
    }
    if (this.joy > 0) {
      this.joy = Math.max(0, this.joy - dt * 1.6);
      sy *= 1 + Math.sin(this.joy * 14) * 0.06 * this.joy;
    }
    if (this.spinT >= 0) {
      this.spinT += dt;
      const k = clamp(this.spinT / 0.7);
      this.vis.rotation.y = (1 - easeOutCubic(k)) * TAU * 2;
      if (k >= 1) { this.spinT = -1; this.vis.rotation.y = 0; }
    }
    this.vis.scale.set(sx, sy, sx);
    this.bodyMat.uniforms.uBoo.value = booAmt;
    this.bodyMat.uniforms.uFlash.value = booAmt * booAmt * 0.35;

    // ---------------- trailing skirt
    _q.copy(this.root.quaternion).invert();
    _a.copy(this.vel).applyQuaternion(_q).multiplyScalar(-0.036);
    _a.y = 0;
    this.lean.x = damp(this.lean.x, _a.x, 7, dt);
    this.lean.z = damp(this.lean.z, _a.z, 7, dt);
    this.bodyMat.uniforms.uLean.value.copy(this.lean);
    this.bodyMat.uniforms.uWobble.value = 1 + speedFrac * 0.6 + booAmt * 2;

    // ---------------- hat tip: a springy pom-pom that streams behind us
    {
      this.hat.getWorldQuaternion(_q2).invert();
      const wind = _a.copy(this.vel).applyQuaternion(_q2).multiplyScalar(-0.038); // drag
      const acc = _b.copy(this.vel).sub(this.prevVel).multiplyScalar(1 / Math.max(dt, 1e-4)).applyQuaternion(_q2).multiplyScalar(-0.012);
      acc.clampLength(0, 1.2);
      const bobKick = Math.cos(this.bobPhase) * 0.05;
      const target = _c.copy(this.tipRest).add(wind).add(acc);
      target.y += bobKick + booAmt * 0.5;
      if (this.hatState !== 'on') target.copy(this.tipRest);
      const k = 70, c = 6.5;
      _d.copy(target).sub(this.tip).multiplyScalar(k).addScaledVector(this.tipV, -c);
      this.tipV.addScaledVector(_d, dt);
      this.tip.addScaledVector(this.tipV, dt);
      this.tip.clampLength(0, 1.15);
      this._bendHat();
    }

    // ---------------- hat off / hat home
    if (this.hatState === 'flying') {
      this.hatT += dt / 0.75;
      const t = Math.min(1, this.hatT);
      this.hat.position.lerpVectors(this.hatFrom, this.hatTo, t);
      _a.copy(this.hat.position).normalize();
      this.hat.position.addScaledVector(_a, Math.sin(t * Math.PI) * 4.5);
      _q.setFromAxisAngle(this.hatSpin, t * TAU * 2.5);
      // land upright
      quatFromUpForward(this.hatN, this.u, _q2);
      this.hat.quaternion.copy(this.hatQ0).premultiply(_q).slerp(_q2, t * t);
      this.hat.scale.setScalar(CFG.ghost.scale);
      if (t >= 1) { this.hatState = 'ground'; this.hatT = 0; }
    } else if (this.hatState === 'ground') {
      this.hatT += dt;
      // a little hop so it's easy to spot
      const hop = Math.abs(Math.sin(this.hatT * 3.2)) * 0.5;
      this.hat.position.copy(this.hatTo).addScaledVector(this.hatN, hop);
      const d = Math.acos(clamp(this.p.dot(this.hatN), -1, 1)) * CFG.R;
      if (d < 1.9 && this.hatT > 0.25) {
        this.hatState = 'returning';
        this.hatT = 0;
        this.hatFrom.copy(this.hat.position);
        this.hatQ0.copy(this.hat.quaternion);
      }
    } else if (this.hatState === 'returning') {
      this.hatT += dt / 0.32;
      const t = Math.min(1, this.hatT);
      // home in on where the head is *now*
      _a.copy(this.hatRest.pos);
      this.vis.localToWorld(_a);
      this.hat.position.lerpVectors(this.hatFrom, _a, easeOutCubic(t));
      this.hat.position.addScaledVector(this.p, Math.sin(t * Math.PI) * 1.4);
      this.vis.getWorldQuaternion(_q2).multiply(_q.setFromEuler(this.hatRest.rot));
      this.hat.quaternion.copy(this.hatQ0).slerp(_q2, t);
      if (t >= 1) {
        this.vis.attach(this.hat);
        this.hat.position.copy(this.hatRest.pos);
        this.hat.rotation.copy(this.hatRest.rot);
        this.hat.scale.setScalar(1);
        this.hatState = 'on';
        this.hasHat = true;
        this.tipV.set(0, 3.5, 0);
        this.joy = 1;
        this.justGotHat = true;
      }
    }

    // ---------------- face
    this.shock = Math.max(0, this.shock - dt * 0.9);
    this.blinkT -= dt;
    if (this.blinkT <= 0) { this.blink = 0.13; this.blinkT = 1.6 + Math.random() * 3.4; }
    this.blink = Math.max(0, this.blink - dt);
    const sad = this.hasHat ? 0 : 1;
    let eyeY = this.blink > 0 && booAmt < 0.1 ? 0.12 : 1;
    let eyeS = 1 + booAmt * 0.3 + this.shock * 0.25;
    if (this.joy > 0.3) eyeY = Math.min(eyeY, 0.45); // happy squint
    const lx = lookAt ? lookAt.x : clamp(this.vel.dot(this.right) / CFG.ghost.speed, -1, 1) * 0.6;
    const ly = lookAt ? lookAt.y : 0;
    this.look.x = damp(this.look.x, lx, 8, dt);
    this.look.y = damp(this.look.y, ly, 8, dt);
    for (const eye of this.eyes) {
      const home = eye.userData.home;
      eye.position.set(home.x + this.look.x * 0.045, home.y + this.look.y * 0.04 - sad * 0.02, home.z);
      eye.scale.set(eyeS, eyeS * eyeY, 1);
    }
    const smile = Math.max(this.joy, speedFrac * 0.5);
    this.mouth.scale.set(
      lerp(lerp(0.062, 0.1, smile), 0.17, mouthOpen),
      lerp(lerp(0.04, 0.062, smile), 0.21, mouthOpen) * (1 - sad * 0.4),
      0.04
    );
    this.mouth.position.y = 0.2 - mouthOpen * 0.06;

    // arms: sway when idle, trail when moving, fling up for a BOO
    for (const pivot of this.arms) {
      const s = pivot.userData.sx;
      const idle = Math.sin(time * 2.4 + s) * 0.18;
      const up = armLift * 1.5 + this.joy * 0.9 + sad * 0.5 * Math.abs(Math.sin(time * 9));
      pivot.rotation.z = s * (idle - 0.25 + up - speedFrac * 0.25);
      pivot.rotation.y = -s * speedFrac * 0.7;
    }

    // ---------------- invulnerability shimmer + glow
    this.invuln = Math.max(0, this.invuln - dt);
    this.bodyMat.uniforms.uOpacity.value = this.invuln > 0 ? 0.55 + 0.4 * Math.sin(time * 30) : 1;
    this.light.intensity = 3.4 + booAmt * 16 + Math.sin(time * 3.1) * 0.25;
    this.poolMat.uniforms.uGain.value = 1 + booAmt * 1.2;
    this.halo.material.opacity = 0.42 + booAmt * 0.3;
    this.halo.scale.setScalar(5.4 + booAmt * 3);
  }
}
