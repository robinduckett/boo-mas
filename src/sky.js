// Everything above the snow: aurora sky dome, stars, moon, atmosphere halo, planet-wide snowfall.
import * as THREE from 'three';
import { CFG } from './config.js';
import { U, RENDER_ORDER } from './materials.js';
import { GLSL_NOISE, RNG, canvasTexture, TAU } from './utils.js';


export class Sky {
  constructor(scene, moonDir) {
    this.scene = scene;
    this.aurora = 0.26; // animated toward a target by the game
    this.auroraK = 1; // the night's biome and weather scale it
    this.windRate = 0;
    const rng = new RNG('boo-mas-sky');

    // Everything "infinitely far away" rides along with the camera.
    this.far = new THREE.Group();
    scene.add(this.far);

    // ---- dome -------------------------------------------------------------
    this.domeMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      uniforms: {
        uTime: U.uTime,
        uAurora: { value: this.aurora },
        uWarm: { value: 0 },
        // the night's palette (see BIOMES in config.js): sky top / middle / bottom, and four aurora colours
        uSky: { value: [new THREE.Color(0.01, 0.03, 0.085), new THREE.Color(0.028, 0.034, 0.12), new THREE.Color(0.052, 0.022, 0.1)] },
        uAu: { value: [new THREE.Color(0.08, 1.0, 0.52), new THREE.Color(0.05, 0.85, 0.9), new THREE.Color(0.42, 0.26, 1.0), new THREE.Color(1.0, 0.25, 0.62)] },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main(){
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uAurora;
        uniform float uWarm;
        uniform vec3 uSky[3];
        uniform vec3 uAu[4];
        varying vec3 vDir;
        ${GLSL_NOISE}

        // One aurora curtain: a wobbly band of latitude with a crisp lower hem that fades upward,
        // broken into vertical rays.
        float curtain(vec3 d, float baseLat, float wob, float seed, out float hgt){
          vec2 q = normalize(d.xz + vec2(1e-4));
          float w  = (vnoise(vec3(q * 1.7 + seed, uTime * 0.021)) - 0.5) * 2.0;
          float w2 = (vnoise(vec3(q * 5.3 - seed, uTime * 0.043)) - 0.5) * 2.0;
          float center = baseLat + wob * w + wob * 0.35 * w2;
          hgt = d.y - center;
          float c = smoothstep(-0.02, 0.015, hgt) * exp(-max(hgt, 0.0) * 5.5);
          float rays = 0.35 + 0.65 * vnoise(vec3(q * 19.0 + seed * 3.0, uTime * 0.11));
          rays *= 0.55 + 0.45 * vnoise(vec3(q * 53.0, uTime * 0.21 + seed));
          return c * rays;
        }

        void main(){
          vec3 d = normalize(vDir);

          // deep-night gradient
          vec3 top = uSky[0];
          vec3 mid = uSky[1];
          vec3 bot = uSky[2];
          vec3 col = mix(mid, top, smoothstep(0.0, 1.0, d.y));
          col = mix(col, bot, smoothstep(0.0, -1.0, d.y));

          // faint nebula so the dark never reads as flat
          float n = fbm3(d * 2.3 + vec3(0.0, uTime * 0.003, 0.0));
          float n2 = fbm3(d * 5.0 + 9.0);
          col += vec3(0.02, 0.018, 0.06) * smoothstep(0.42, 0.85, n);
          col += vec3(0.028, 0.008, 0.035) * smoothstep(0.5, 0.9, n2) * 0.6;

          // aurora, mirrored so there is always some in view wherever you are on the planet
          float h1, h2, h3, h4;
          vec3 dm = vec3(d.x, -d.y, d.z);
          float a1 = curtain(d, 0.50, 0.15, 1.7, h1);
          float a2 = curtain(d, 0.14, 0.20, 7.3, h2);
          float a3 = curtain(dm, 0.42, 0.17, 3.9, h3);
          float a4 = curtain(dm, 0.02, 0.18, 11.1, h4);
          vec3 green = uAu[0];
          vec3 teal = uAu[1];
          vec3 violet = uAu[2];
          vec3 pink = uAu[3];
          vec3 au = vec3(0.0);
          au += mix(green, violet, smoothstep(0.0, 0.32, h1)) * a1;
          au += mix(teal, pink, smoothstep(0.0, 0.30, h2)) * a2 * 0.75;
          au += mix(green, pink, smoothstep(0.0, 0.34, h3)) * a3 * 0.9;
          au += mix(teal, violet, smoothstep(0.0, 0.30, h4)) * a4 * 0.7;
          // as the spirit rises the aurora warms toward festive gold/red
          // a touch more saturation as the spirit rises
          au *= 1.0 + uWarm * 0.25;
          col += au * uAurora;

          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(700, 48, 32), this.domeMat);
    this.dome.renderOrder = RENDER_ORDER.sky;
    this.dome.frustumCulled = false;
    this.far.add(this.dome);

    // ---- stars ------------------------------------------------------------
    const STARS = 2600;
    const sPos = new Float32Array(STARS * 3);
    const sCol = new Float32Array(STARS * 3);
    const sDat = new Float32Array(STARS * 2);
    const v = new THREE.Vector3();
    for (let i = 0; i < STARS; i++) {
      rng.onSphere(v).multiplyScalar(560);
      sPos.set([v.x, v.y, v.z], i * 3);
      const big = rng.next() < 0.06;
      const b = big ? rng.range(1.1, 1.9) : rng.range(0.2, 0.85);
      const warm = rng.next();
      sCol.set([b * (0.8 + 0.3 * warm), b * 0.9, b * (1.1 - 0.3 * warm)], i * 3);
      sDat.set([big ? rng.range(3.2, 5.0) : rng.range(1.2, 2.6), rng.next()], i * 2);
    }
    const sGeo = new THREE.BufferGeometry();
    sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
    sGeo.setAttribute('aColor', new THREE.BufferAttribute(sCol, 3));
    sGeo.setAttribute('aData', new THREE.BufferAttribute(sDat, 2));
    this.starMat = new THREE.ShaderMaterial({
      uniforms: { uTime: U.uTime, uPx: { value: 1 }, uGain: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor; attribute vec2 aData;
        uniform float uTime; uniform float uPx; uniform float uGain;
        varying vec3 vColor;
        void main(){
          float tw = 0.72 + 0.28 * sin(uTime * (0.7 + aData.y * 2.6) + aData.y * 50.0);
          vColor = aColor * tw * uGain;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aData.x * uPx;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        void main(){
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(vColor * a * a, 1.0);
        }`,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    this.stars = new THREE.Points(sGeo, this.starMat);
    this.stars.frustumCulled = false;
    this.far.add(this.stars);

    // ---- moon -------------------------------------------------------------
    const moonTex = canvasTexture(256, 256, (g, w, h) => {
      g.fillStyle = '#f3efe2';
      g.fillRect(0, 0, w, h);
      const r2 = new RNG('moon');
      for (let i = 0; i < 46; i++) {
        const x = r2.range(0, w), y = r2.range(0, h), rad = r2.range(4, 26);
        const gr = g.createRadialGradient(x, y, rad * 0.2, x, y, rad);
        gr.addColorStop(0, 'rgba(150,150,170,0.38)');
        gr.addColorStop(0.8, 'rgba(170,170,185,0.22)');
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr;
        g.beginPath(); g.arc(x, y, rad, 0, TAU); g.fill();
      }
    });
    this.moonDir = moonDir.clone().normalize();
    this.moon = new THREE.Mesh(
      new THREE.SphereGeometry(27, 40, 28),
      new THREE.MeshBasicMaterial({ map: moonTex, color: new THREE.Color(0.9, 0.88, 0.8), fog: false, depthWrite: false })
    );
    this.moon.position.copy(this.moonDir).multiplyScalar(520);
    this.moon.lookAt(0, 0, 0);
    this.far.add(this.moon);

    // soft halo behind the moon
    const haloTex = canvasTexture(128, 128, (g, w, h) => {
      const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.25, 'rgba(190,210,255,0.45)');
      gr.addColorStop(1, 'rgba(120,150,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.42, color: 0x9fb8ff }));
    this.halo.scale.setScalar(210);
    this.halo.position.copy(this.moonDir).multiplyScalar(540);
    this.far.add(this.halo);

    // ---- atmosphere halo around the planet --------------------------------
    this.atmoMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      uniforms: { uColor: { value: new THREE.Color(0.13, 0.3, 1.0) }, uGain: { value: 0.5 }, uEdge: { value: 0.5 } },
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vV;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal);
          vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uGain; uniform float uEdge;
        varying vec3 vN; varying vec3 vV;
        void main(){
          float f = clamp(-dot(normalize(vN), normalize(vV)) / uEdge, 0.0, 1.0);
          float a = pow(f, 2.4);
          gl_FragColor = vec4(uColor * a * uGain, a);
        }`,
    });
    this.atmo = new THREE.Mesh(new THREE.SphereGeometry(CFG.grow.radius * 1.17, 64, 40), this.atmoMat); // scaled per night in setLook
    scene.add(this.atmo);

    // ---- snowfall (world-anchored, wraps in altitude) ---------------------
    const FLAKES = (this.flakes = 22000); // how many are drawn depends on the planet's size and the weather
    const fPos = new Float32Array(FLAKES * 3);
    const fDat = new Float32Array(FLAKES * 4);
    this.snowH = 26;
    for (let i = 0; i < FLAKES; i++) {
      rng.onSphere(v);
      fPos.set([v.x, v.y, v.z], i * 3);
      fDat.set([rng.range(0, this.snowH), rng.range(1.1, 2.6), rng.range(0.05, 0.135), rng.next()], i * 4);
    }
    const fGeo = new THREE.BufferGeometry();
    fGeo.setAttribute('position', new THREE.BufferAttribute(fPos, 3));
    fGeo.setAttribute('aData', new THREE.BufferAttribute(fDat, 4));
    this.snowMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: U.uTime,
        uR: { value: CFG.R },
        uH: { value: this.snowH },
        uScale: { value: 600 },
        uBlast: { value: new THREE.Vector4(0, 1, 0, 0) }, // xyz: boo centre (unit), w: strength
        uSize: { value: 1 },
        uFall: { value: 1 },
        uWindAxis: { value: new THREE.Vector3(0, 1, 0) }, // the wind blows round this axis
        uWind: { value: 0 }, // how far round it the snow has been carried, radians
      },
      vertexShader: /* glsl */ `
        attribute vec4 aData;
        uniform float uTime; uniform float uR; uniform float uH; uniform float uScale;
        uniform vec4 uBlast;
        uniform float uSize; uniform float uFall; uniform vec3 uWindAxis; uniform float uWind;
        varying float vAlpha;
        void main(){
          float alt = mod(aData.x - uTime * aData.y * uFall, uH);
          vec3 dir = normalize(position);
          // wind: carry the flake round the wind's axis (Rodrigues). Each drifts at its own pace.
          float wa = uWind * (0.7 + 0.6 * aData.w);
          dir = dir * cos(wa) + cross(uWindAxis, dir) * sin(wa) + uWindAxis * dot(uWindAxis, dir) * (1.0 - cos(wa));
          vec3 t1 = normalize(cross(dir, vec3(0.31, 0.93, 0.19)));
          vec3 t2 = cross(dir, t1);
          float sw = uTime * 0.55 + aData.w * 6.2831;
          dir = normalize(dir + (t1 * sin(sw) + t2 * cos(sw * 0.8)) * 0.012);
          // a BOO shoves nearby flakes outward
          vec3 away = dir - uBlast.xyz;
          float bd = length(away) * uR;
          float push = uBlast.w * smoothstep(14.0, 0.0, bd);
          dir = normalize(dir + normalize(away + 1e-5) * push * 0.12);
          vec3 wp = dir * (uR + 0.3 + alt + push * 2.0);
          vec4 mv = viewMatrix * vec4(wp, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = max(1.0, aData.z * uSize * uScale / -mv.z);
          vAlpha = smoothstep(0.0, 1.2, alt) * smoothstep(uH, uH - 5.0, alt);
        }`,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        void main(){
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.1, d) * vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vec3(0.62, 0.7, 0.92), a * 0.62);
        }`,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    this.snow = new THREE.Points(fGeo, this.snowMat);
    this.snow.frustumCulled = false;
    scene.add(this.snow);
    this.blast = 0;
  }

  /**
   * Dress the sky for a night: `P` is nightParams() — its biome's palette, its weather, the planet's size.
   * `windAxis` is the unit vector the wind circles (see main.js).
   */
  setLook(P, windAxis) {
    const B = P.biome, W = P.weather, d = this.domeMat.uniforms;
    for (let i = 0; i < 3; i++) d.uSky.value[i].setRGB(B.sky[i][0], B.sky[i][1], B.sky[i][2]);
    for (let i = 0; i < 4; i++) d.uAu.value[i].setRGB(B.aurora[i][0], B.aurora[i][1], B.aurora[i][2]);
    this.auroraK = B.auroraK * W.aurora;
    this.starMat.uniforms.uGain.value = W.stars;
    this.atmo.scale.setScalar(P.radius / CFG.grow.radius);
    this.atmoMat.uniforms.uColor.value.setRGB(B.atmo[0], B.atmo[1], B.atmo[2]);
    const s = this.snowMat.uniforms;
    s.uR.value = P.radius;
    s.uSize.value = W.flakeSize;
    s.uFall.value = W.fall;
    s.uWindAxis.value.copy(windAxis);
    this.windRate = W.wind / P.radius; // radians a second
    // the same amount of snow per patch of sky however big the planet is, then more or less for the weather
    this.snow.geometry.setDrawRange(0, Math.min(this.flakes, Math.round(8500 * P.area * W.flakes)));
  }

  /** Shove the falling snow away from a point (unit vector on the planet). */
  blastSnow(n) {
    this.snowMat.uniforms.uBlast.value.set(n.x, n.y, n.z, 1);
    this.blast = 1;
  }

  /** @param gust 0..1: how hard an extra gust is blowing right now (the snow races along with it) */
  update(dt, camera, renderer, spirit, gust = 0) {
    this.far.position.copy(camera.position);
    this.snowMat.uniforms.uWind.value += this.windRate * (1 + gust * 1.6) * dt;
    const h = renderer.domElement.height;
    this.snowMat.uniforms.uScale.value = h / (2 * Math.tan((camera.fov * Math.PI) / 360));
    this.starMat.uniforms.uPx.value = h / 900;
    // aurora brightens and warms with the Christmas spirit
    const target = (0.27 + spirit * 0.22) * this.auroraK;
    this.aurora += (target - this.aurora) * Math.min(1, dt * 0.8);
    this.domeMat.uniforms.uAurora.value = this.aurora;
    this.domeMat.uniforms.uWarm.value += (spirit - this.domeMat.uniforms.uWarm.value) * Math.min(1, dt * 0.8);
    if (this.blast > 0) {
      this.blast = Math.max(0, this.blast - dt * 1.4);
      this.snowMat.uniforms.uBlast.value.w = this.blast * this.blast;
    }
  }
}
