// Juice: particles, shockwave rings, the flash that fills a closed loop, fireworks.
import * as THREE from 'three';
import { CFG } from './config.js';
import { U, poolGeometry, RENDER_ORDER } from './materials.js';
import { TAU, anyTangent, GLSL_NOISE, quatFromUpYaw } from './utils.js';

const _v = new THREE.Vector3();
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _n = new THREE.Vector3();

class Particles {
  constructor(scene, max, additive) {
    this.max = max;
    this.n = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.alpha0 = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.delay = new Float32Array(max);
    this.additive = additive;

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 } },
      vertexShader: /* glsl */ `
        attribute vec4 aColor; attribute float aSize;
        uniform float uScale;
        varying vec4 vColor;
        void main(){
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * uScale / -mv.z;
        }`,
      fragmentShader: additive
        ? /* glsl */ `
        varying vec4 vColor;
        void main(){
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          float core = smoothstep(0.5, 0.0, d);
          float star = max(0.0, 1.0 - abs(c.x * c.y) * 110.0) * smoothstep(0.5, 0.05, d);
          float a = core * core * core * 1.4 + star * 0.55;
          gl_FragColor = vec4(vColor.rgb * a * vColor.a, 1.0);
        }`
        : /* glsl */ `
        varying vec4 vColor;
        void main(){
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.12, d) * vColor.a;
          if (a < 0.004) discard;
          gl_FragColor = vec4(vColor.rgb, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      fog: false,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 14 : 12;
    scene.add(this.points);
  }

  spawn(x, y, z, vx, vy, vz, life, size, r, g, b, alpha = 1, gravity = 0, drag = 0, grow = 0, delay = 0) {
    if (this.n >= this.max) return;
    const i = this.n++;
    const i3 = i * 3, i4 = i * 4;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.col[i4] = r; this.col[i4 + 1] = g; this.col[i4 + 2] = b; this.col[i4 + 3] = delay > 0 ? 0 : alpha;
    this.size[i] = delay > 0 ? 0 : size;
    this.size0[i] = size;
    this.alpha0[i] = alpha;
    this.life[i] = life; this.maxLife[i] = life;
    this.grav[i] = gravity; this.drag[i] = drag; this.grow[i] = grow; this.delay[i] = delay;
  }

  update(dt) {
    const { pos, vel, col, size } = this;
    for (let i = 0; i < this.n; i++) {
      if (this.delay[i] > 0) {
        this.delay[i] -= dt;
        continue;
      }
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // swap-remove
        const j = --this.n;
        if (i !== j) {
          pos.copyWithin(i * 3, j * 3, j * 3 + 3);
          vel.copyWithin(i * 3, j * 3, j * 3 + 3);
          col.copyWithin(i * 4, j * 4, j * 4 + 4);
          size[i] = size[j]; this.size0[i] = this.size0[j]; this.alpha0[i] = this.alpha0[j];
          this.life[i] = this.life[j]; this.maxLife[i] = this.maxLife[j];
          this.grav[i] = this.grav[j]; this.drag[i] = this.drag[j]; this.grow[i] = this.grow[j]; this.delay[i] = this.delay[j];
        }
        i--;
        continue;
      }
      const i3 = i * 3;
      let x = pos[i3], y = pos[i3 + 1], z = pos[i3 + 2];
      const g = this.grav[i];
      if (g !== 0) {
        const inv = (g * dt) / Math.hypot(x, y, z);
        vel[i3] -= x * inv; vel[i3 + 1] -= y * inv; vel[i3 + 2] -= z * inv;
      }
      const dr = this.drag[i];
      if (dr !== 0) {
        const k = Math.exp(-dr * dt);
        vel[i3] *= k; vel[i3 + 1] *= k; vel[i3 + 2] *= k;
      }
      pos[i3] = x + vel[i3] * dt; pos[i3 + 1] = y + vel[i3 + 1] * dt; pos[i3 + 2] = z + vel[i3 + 2] * dt;
      const k = this.life[i] / this.maxLife[i]; // 1 → 0
      col[i * 4 + 3] = this.alpha0[i] * (this.additive ? Math.min(1, k * 2.2) : Math.sin(Math.PI * Math.sqrt(k)));
      size[i] = this.size0[i] * (1 + this.grow[i] * (1 - k));
    }
    this.geo.setDrawRange(0, this.n);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
  }
}

export class Fx {
  constructor(scene) {
    this.scene = scene;
    this.sparks = new Particles(scene, 4500, true);
    this.puffs = new Particles(scene, 1500, false);
    this.rings = [];
    this.fills = [];
    this.rockets = [];
    this.shake = 0;

    // shockwave rings
    this.ringGeo = poolGeometry();
    for (let i = 0; i < 8; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(1, 1, 1) }, uAlpha: { value: 0 }, uThick: { value: 0.2 } },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor; uniform float uAlpha; uniform float uThick;
          varying vec2 vUv;
          void main(){
            float d = length(vUv - 0.5) * 2.0;
            float ring = smoothstep(1.0 - uThick, 1.0 - uThick * 0.35, d) * smoothstep(1.0, 0.94, d);
            float inner = smoothstep(1.0, 0.0, d) * 0.05;
            gl_FragColor = vec4(uColor * (ring + inner) * uAlpha, 1.0);
          }`,
        blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: false, fog: false,
      });
      const mesh = new THREE.Mesh(this.ringGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = RENDER_ORDER.pools + 2;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.rings.push({ mesh, mat, t: 1, dur: 1, r0: 0, r1: 1 });
    }

    this.fillMat = () =>
      new THREE.ShaderMaterial({
        uniforms: { uTime: U.uTime, uT: { value: 0 }, uColor: { value: new THREE.Color(1, 0.8, 0.4) } },
        vertexShader: /* glsl */ `
          attribute vec2 aPlane;
          varying vec2 vP;
          void main(){ vP = aPlane; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform float uTime; uniform float uT; uniform vec3 uColor;
          varying vec2 vP;
          ${GLSL_NOISE}
          void main(){
            float fade = (1.0 - uT); fade *= fade;
            // glitter: one soft twinkling dot per cell
            vec2 gp = vP * 1.7;
            vec2 id = floor(gp);
            vec2 f = fract(gp) - 0.5;
            float h = hash21(id);
            vec2 o = (vec2(hash21(id + 7.1), hash21(id + 13.7)) - 0.5) * 0.62;
            float tw = 0.5 + 0.5 * sin(uTime * (7.0 + h * 9.0) + h * 40.0);
            float glit = smoothstep(0.2, 0.0, length(f - o)) * step(0.3, h) * tw;
            // a sheen sweeping across
            float sw = 1.0 - abs(fract((vP.x + vP.y) * 0.045 - uT * 1.3) - 0.5) * 2.0;
            float a = fade * (0.17 + 1.5 * glit + 0.3 * sw * sw * sw) + smoothstep(0.28, 0.0, uT) * 0.4;
            gl_FragColor = vec4(uColor * a, 1.0);
          }`,
        blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: false, side: THREE.DoubleSide, fog: false,
      });
  }

  // ------------------------------------------------------------ emitters

  /** Sparks flung outward in the hemisphere around `up`. */
  burst(pos, up, n, color, opts = {}) {
    const { speed = 6, life = 0.7, size = 0.35, gravity = 9, drag = 1.5, spread = 1, upBias = 0.6, delay = 0, jitter = 0.2 } = opts;
    anyTangent(up, _t1);
    _t2.crossVectors(up, _t1);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const el = Math.random() * spread;
      const sp = speed * (0.35 + Math.random() * 0.8);
      const c = Math.cos(a) * el, s = Math.sin(a) * el;
      _v.copy(up).multiplyScalar(upBias + Math.random() * 0.6).addScaledVector(_t1, c).addScaledVector(_t2, s).normalize().multiplyScalar(sp);
      const col = Array.isArray(color[0]) ? color[(Math.random() * color.length) | 0] : color;
      this.sparks.spawn(
        pos.x + (Math.random() - 0.5) * jitter, pos.y + (Math.random() - 0.5) * jitter, pos.z + (Math.random() - 0.5) * jitter,
        _v.x, _v.y, _v.z, life * (0.6 + Math.random() * 0.7), size * (0.6 + Math.random() * 0.8),
        col[0], col[1], col[2], 1, gravity, drag, 0, delay + Math.random() * 0.05
      );
    }
  }

  /** A single lazy sparkle (trails, idle twinkles). */
  twinkle(pos, color, size = 0.3, life = 0.6, vel = null, gravity = 0) {
    this.sparks.spawn(pos.x, pos.y, pos.z, vel ? vel.x : 0, vel ? vel.y : 0, vel ? vel.z : 0, life, size, color[0], color[1], color[2], 1, gravity, 1.2, 0, 0);
  }

  /** Soft white puffs: snow knocked loose, bugs landing, etc. */
  snowPuff(pos, up, n = 8, speed = 2.5, size = 0.9, tint = [0.92, 0.95, 1.0]) {
    anyTangent(up, _t1);
    _t2.crossVectors(up, _t1);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const sp = speed * (0.4 + Math.random() * 0.9);
      _v.copy(up).multiplyScalar(0.3 + Math.random() * 0.9).addScaledVector(_t1, Math.cos(a)).addScaledVector(_t2, Math.sin(a)).normalize().multiplyScalar(sp);
      this.puffs.spawn(
        pos.x + (Math.random() - 0.5) * 0.5, pos.y + (Math.random() - 0.5) * 0.5, pos.z + (Math.random() - 0.5) * 0.5,
        _v.x, _v.y, _v.z, 0.5 + Math.random() * 0.6, size * (0.5 + Math.random() * 0.9),
        tint[0], tint[1], tint[2], 0.75, 4, 2.2, 1.2, 0
      );
    }
  }

  /** Chimney smoke: one slow puff drifting up. */
  smoke(pos, up) {
    anyTangent(up, _t1);
    _v.copy(up).multiplyScalar(1.1 + Math.random() * 0.5).addScaledVector(_t1, (Math.random() - 0.5) * 0.5);
    this.puffs.spawn(pos.x, pos.y, pos.z, _v.x, _v.y, _v.z, 2.2 + Math.random(), 0.55, 0.62, 0.66, 0.78, 0.5, 0, 0.25, 2.6, 0);
  }

  /** Expanding ring painted on the snow. */
  ring(n, world, color, r0, r1, dur = 0.6, thick = 0.2) {
    const ring = this.rings.find((r) => r.t >= 1) || this.rings[0];
    ring.t = 0; ring.dur = dur; ring.r0 = r0; ring.r1 = r1;
    world.surface(n, 0.15, ring.mesh.position);
    quatFromUpYaw(n, 0, ring.mesh.quaternion);
    ring.mat.uniforms.uColor.value.setRGB(color[0], color[1], color[2]);
    ring.mat.uniforms.uThick.value = thick;
    ring.mesh.visible = true;
  }

  /**
   * Flash-fill a closed loop. `pts` are unit vectors; `plane` are their 2D gnomonic coordinates.
   */
  fill(pts, plane, world, color) {
    let tris;
    try {
      tris = THREE.ShapeUtils.triangulateShape(plane, []);
    } catch (e) {
      return;
    }
    if (!tris || !tris.length) return;
    const pos = new Float32Array(pts.length * 3);
    const pl = new Float32Array(pts.length * 2);
    for (let i = 0; i < pts.length; i++) {
      world.surface(pts[i], 0.3, _v);
      pos[i * 3] = _v.x; pos[i * 3 + 1] = _v.y; pos[i * 3 + 2] = _v.z;
      pl[i * 2] = plane[i].x * CFG.R; pl[i * 2 + 1] = plane[i].y * CFG.R;
    }
    const idx = [];
    for (const t of tris) idx.push(t[0], t[1], t[2]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aPlane', new THREE.BufferAttribute(pl, 2));
    g.setIndex(idx);
    const mat = this.fillMat();
    mat.uniforms.uColor.value.setRGB(color[0], color[1], color[2]);
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = RENDER_ORDER.pools + 3;
    this.scene.add(mesh);
    this.fills.push({ mesh, t: 0, dur: 1.0 });
  }

  /** Launch a firework from a point on the planet. */
  firework(n, world, color, power = 1) {
    const start = world.surface(n, 1, new THREE.Vector3());
    this.rockets.push({ pos: start, up: n.clone(), t: 0, dur: 0.75 + Math.random() * 0.35, speed: (16 + Math.random() * 6) * (0.7 + power * 0.3), color, power });
  }

  addShake(amount) {
    this.shake = Math.min(1.2, this.shake + amount);
  }

  // ------------------------------------------------------------ update

  update(dt, camera, renderer) {
    const scale = renderer.domElement.height / (2 * Math.tan((camera.fov * Math.PI) / 360));
    this.sparks.mat.uniforms.uScale.value = scale;
    this.puffs.mat.uniforms.uScale.value = scale;
    this.sparks.update(dt);
    this.puffs.update(dt);

    for (const r of this.rings) {
      if (r.t >= 1) continue;
      r.t = Math.min(1, r.t + dt / r.dur);
      const e = 1 - Math.pow(1 - r.t, 3);
      r.mesh.scale.setScalar(r.r0 + (r.r1 - r.r0) * e);
      r.mat.uniforms.uAlpha.value = (1 - r.t) * (1 - r.t) * 1.15;
      if (r.t >= 1) r.mesh.visible = false;
    }

    for (let i = this.fills.length - 1; i >= 0; i--) {
      const f = this.fills[i];
      f.t += dt / f.dur;
      f.mesh.material.uniforms.uT.value = Math.min(1, f.t);
      if (f.t >= 1) {
        this.scene.remove(f.mesh);
        f.mesh.geometry.dispose();
        f.mesh.material.dispose();
        this.fills.splice(i, 1);
      }
    }

    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const k = this.rockets[i];
      k.t += dt;
      k.pos.addScaledVector(k.up, k.speed * dt * (1 - (k.t / k.dur) * 0.6));
      // trail
      this.sparks.spawn(k.pos.x, k.pos.y, k.pos.z, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, 0.35, 0.35 * (0.5 + k.power * 0.5), 3, 2.2, 1.2, 1, 0, 2, 0, 0);
      if (k.t >= k.dur) {
        const n = Math.floor(70 + 44 * k.power);
        const cols = Array.isArray(k.color[0]) ? k.color : [k.color];
        for (let j = 0; j < n; j++) {
          // uniform direction on a sphere
          const z = Math.random() * 2 - 1, a = Math.random() * TAU, rr = Math.sqrt(1 - z * z);
          const sp = (7 + Math.random() * 2.5) * k.power;
          const sz = 0.5 * (0.55 + k.power * 0.42);
          const c = cols[j % cols.length];
          this.sparks.spawn(k.pos.x, k.pos.y, k.pos.z, rr * Math.cos(a) * sp, z * sp, rr * Math.sin(a) * sp, 1.2 + Math.random() * 0.8, sz, c[0], c[1], c[2], 1, 2.5, 1.5, 0, 0);
        }
        // white core flash
        this.sparks.spawn(k.pos.x, k.pos.y, k.pos.z, 0, 0, 0, 0.22, 6 * k.power, 2.5, 2.3, 2.0, 1, 0, 0, 0, 0);
        if (this.onBang) this.onBang(k);
        this.rockets.splice(i, 1);
      }
    }

    this.shake = Math.max(0, this.shake - dt * 2.4);
  }
}
