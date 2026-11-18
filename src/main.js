// Boo-mas — a small game about a ghost in a Santa hat.
// This file is the conductor: renderer, camera, rules, scoring, and the flow of a night.
import * as THREE from 'three';
import { UnrealBloomPass } from '../vendor/three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from '../vendor/three/addons/postprocessing/ShaderPass.js';
import { CFG } from './config.js';
import { U, poolGeometry, RENDER_ORDER } from './materials.js';
import { Sky } from './sky.js';
import { World } from './world.js';
import { Ghost } from './ghost.js';
import { Garland } from './garland.js';
import { Fx } from './fx.js';
import { Humbugs } from './humbugs.js';
import { Presents, PRESENT_GLOW } from './presents.js';
import { Pickups, PICKUP } from './pickups.js';
import { Wreath } from './wreath.js';
import { AudioEngine } from './audio.js';
import { UI } from './ui.js';
import { Minimap } from './minimap.js';
import { Input } from './input.js';
import {
  clamp, lerp, TAU, RNG, anyTangent, gnomonic, pointInPoly, polyArea, easeInOutCubic,
  tangentToward, projectTangent, offsetOnSphere, quatFromUpYaw,
} from './utils.js';

const ZERO2 = new THREE.Vector2();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _n = new THREE.Vector3();
const _p2 = new THREE.Vector2();
const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();

const SEED_WORDS = ['tinsel', 'holly', 'nutmeg', 'mitten', 'cocoa', 'jingle', 'frosty', 'cinder', 'marzipan', 'icicle', 'bauble', 'chestnut', 'ginger', 'pudding', 'sleigh', 'figgy', 'yule', 'cranberry', 'twinkle', 'pinecone'];
const NAME_A = ['Tinsel', 'Mitten', 'Nutmeg', 'Cocoa', 'Frost', 'Jingle', 'Holly', 'Pudding', 'Icicle', 'Ginger', 'Bauble', 'Figgy', 'Snowdrop', 'Chestnut'];
const NAME_B = ['ton', 'berg', ' Hollow', 'wick', ' Crossing', 'ville', ' Nook', 'stead', ' Drift', 'by-the-Pole'];
const WORDS = ['', 'Twinkle!', 'Jolly!', 'Festive!', 'Merry!', 'Dazzling!', 'Sleigh!', 'Tinsel-tastic!', 'Yule rule!', 'HO HO HOLY NIGHT!'];
const BAHS = ['Bah!', 'Humbug!', 'Hmph.', 'Bah!', 'Tsk.', 'Bah, lights.'];
const STREAK_TIME = 7;
// Screen markers live in fixed slots, so each DOM element keeps the same job from frame to frame:
// chewing Humbugs, the power-up, presents, groups of dark things, and single stragglers.
// (More slots than will ever show at once: the UI rolls pointers that lie the same way into one,
// and caps how many groups it shows.)
const SLOT = { bug: 0, bugN: 4, pick: 4, gift: 5, giftN: 3, group: 8, groupN: 6, bulb: 14, bulbN: 6 };
const MARKER_SLOTS = 20;
const GOLD_PRESENT = 4; // the yellow one with the red ribbon
const times = (k) => '×' + String(+k.toFixed(2));

const FinalShader = {
  name: 'BooFinal',
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uShock: { value: new THREE.Vector4(0.5, 0.5, 0, 0) }, // xy: centre (uv), z: radius, w: strength
    uAspect: { value: 1 },
    uVignette: { value: 0.46 },
    uAberration: { value: 0.01 },
    uFlash: { value: 0 },
    uDanger: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime; uniform vec4 uShock; uniform float uAspect;
    uniform float uVignette; uniform float uAberration; uniform float uFlash; uniform float uDanger;
    varying vec2 vUv;
    float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    void main(){
      vec2 uv = vUv;
      // BOO: a ring of refraction racing outward from the ghost
      vec2 d = uv - uShock.xy; d.x *= uAspect;
      float dist = length(d);
      float ring = (1.0 - smoothstep(0.0, 0.075, abs(dist - uShock.z))) * uShock.w;
      vec2 dn = d / max(dist, 1e-4); dn.x /= uAspect;
      uv -= dn * ring * 0.03;
      // lens fringe toward the edges
      vec2 c = uv - 0.5;
      vec2 off = c * dot(c, c) * (uAberration + ring * 0.1);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + off).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - off).b;
      float v = smoothstep(1.08, 0.3, length(c * vec2(1.0, 0.92)) * 1.36);
      col *= mix(1.0 - uVignette, 1.0, v);
      col += vec3(0.42, 0.02, 0.05) * (1.0 - v) * uDanger;   // nearly midnight
      col += uFlash * vec3(1.0, 0.94, 0.82);
      col += (hash(vUv * 1024.0 + fract(uTime) * 61.0) - 0.5) * 0.014 * (0.35 + col); // a whisper of grain
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

function randomSeed() {
  return SEED_WORDS[(Math.random() * SEED_WORDS.length) | 0] + '-' + (10 + ((Math.random() * 90) | 0));
}

class Game {
  constructor() {
    const q = new URLSearchParams(location.search);
    this.seed = (q.get('seed') || randomSeed()).slice(0, 40);
    this.night = Math.max(1, parseInt(q.get('night'), 10) || 1);
    this.canvas = document.getElementById('game');

    // ---------------------------------------------------------- renderer
    // three r187: with outputBufferType set, the renderer draws the scene into its own
    // multisampled HDR target, runs our effects, then tone-maps to the canvas.
    const renderer = (this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
      outputBufferType: THREE.HalfFloatType,
      stencil: false,
    }));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.setClearColor(0x05071c, 1);
    this.quality = 1;
    this.bloomBase = 0.3;

    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.3, 0.55, 1.0);
    this.final = new ShaderPass(FinalShader);
    renderer.setEffects([this.bloom, this.final]);

    const scene = (this.scene = new THREE.Scene());
    scene.fog = new THREE.FogExp2(0x16245f, 0.0105);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.4, 2400);

    // moonlight rig: follows the camera so the view is always lit from the same flattering angle
    this.ambient = new THREE.AmbientLight(0x5b74cc, 1.0);
    this.key = new THREE.DirectionalLight(0xcfe0ff, 1.15);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.camera.near = 1;
    this.key.shadow.camera.far = 220;
    this.key.shadow.bias = -0.0008;
    this.key.shadow.normalBias = 0.05;
    this.key.shadow.radius = 2.5;
    this.fill = new THREE.DirectionalLight(0x7f8cff, 0.62);
    scene.add(this.ambient, this.key, this.key.target, this.fill, this.fill.target);
    this.shadowSize = 0;

    // ---------------------------------------------------------- world & actors
    this.world = new World(scene, this.seed, this.night);
    this.worldFresh = true;
    const W = this.world;
    const right0 = new THREE.Vector3().crossVectors(W.startUp, W.start);
    const moonDir = new THREE.Vector3().addScaledVector(W.startUp, 0.68).addScaledVector(right0, -0.72).addScaledVector(W.start, -0.15);
    this.sky = new Sky(scene, moonDir);
    this._applyLook();
    this.fx = new Fx(scene);
    this.fx.onBang = (k) => this.audio.bang(0.5 + k.power * 0.3);
    this.ghost = new Ghost(scene, W);
    this.ghost.place(W.start, W.startUp);
    this.garland = new Garland(scene, W, { onLoop: (l) => this.onLoop(l), onBreak: (b) => this.onBreak(b) });
    this.garland.enabled = false;
    this.humbugs = new Humbugs(scene, W, this);
    this.presents = new Presents(scene, W, this);
    this.audio = new AudioEngine();
    this.ui = new UI();
    this.input = new Input(this.canvas, { stick: document.getElementById('stick') });
    this.minimap = new Minimap(document.getElementById('globe'));
    // a click or tap on the globe makes it bigger instead of going BOO
    this.input.onGlobe = (x, y) => this.state === 'play' && !this.paused && this.minimap.contains(x, y);
    this._wireWorld();

    // ---------------------------------------------------------- state
    this.state = 'title'; // title | play | finale | results
    this.paused = false;
    this.time = 0;
    this.elapsed = 0;
    this.duration = CFG.night.duration;
    this.score = 0;
    this.scoreAtStart = 0;
    this.streak = 0;
    this.streakT = 0;
    this.booCool = 0;
    this.hitStop = 0;
    this.timers = [];
    this.seen = {};
    this.stats = { loops: 0, biggest: 0, wrapped: 0, presents: 0, hats: 0, live: 0, bestMul: 1 };
    this.shockT = 1;
    this.flash = 0;
    this.trailT = 0;
    // first-night tutorial: a dashed ring painted round the nearest grove ("loop this!")
    this.guideMat = new THREE.ShaderMaterial({
      uniforms: { uTime: U.uTime, uAlpha: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uAlpha; varying vec2 vUv;
        void main(){
          vec2 c = vUv - 0.5;
          float d = length(c) * 2.0;
          float ang = atan(c.y, c.x) / 6.2831853;
          float ring = smoothstep(0.9, 0.925, d) * smoothstep(1.0, 0.975, d);
          float dash = smoothstep(0.42, 0.5, abs(fract(ang * 22.0 - uTime * 0.6) - 0.5) * 2.0);
          // a brighter comet running round the ring, to show the motion
          float lead = pow(1.0 - abs(fract(ang - uTime * 0.28) - 0.5) * 2.0, 6.0);
          gl_FragColor = vec4(vec3(1.3, 0.95, 0.35) * ring * (dash * 0.75 + lead * 1.6) * uAlpha, 1.0);
        }`,
      blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: false, fog: false,
    });
    this.guide = new THREE.Mesh(poolGeometry(), this.guideMat);
    this.guide.renderOrder = RENDER_ORDER.pools + 2;
    this.guide.frustumCulled = false;
    this.guide.visible = false;
    scene.add(this.guide);
    this.guideOn = false;

    // power-ups (pickups.js is the thing lying in the snow; what it does once grabbed is below)
    this.pickups = new Pickups(scene, this);
    this.wreath = new Wreath(scene);
    // A wreath isn't used the moment you grab it: you carry it, and set it off where it will do the
    // most good. While you carry one its button shows how much the ring would catch from here.
    this.wreathHeld = false;
    this.wreathGood = false;
    this.wreathScanT = 0;
    this.wreathDingT = -99;
    this.wreathA = 0;
    this.power = 0; // star power: seconds left
    this.rush = 0; // sugar rush: seconds left
    this.buffs = [];
    // what carries over from night to night: a longer string, a faster ghost
    this.prog = this._assumedProgress(this.night);
    this.progAtStart = { ...this.prog };
    this.reward = { len: 0, speed: 0 };
    this.pingT = 0;
    this.markers = new Array(MARKER_SLOTS).fill(null);
    this.markPool = Array.from({ length: MARKER_SLOTS }, () => ({ pos: new THREE.Vector3(), kind: '', pin: false, edge: true, p: 0, n: 0 }));
    this.autopilot = q.has('autopilot');
    this.apTarget = null;
    this.calmMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.touch = !!(window.matchMedia && window.matchMedia('(hover: none)').matches); // hints say "tap", not "Space"
    this.perf = { acc: 0, n: 0 };
    try { this.best = parseInt(localStorage.getItem('boomas.best'), 10) || 0; } catch (_) { this.best = 0; }

    this.cam = {
      mode: 'title', blend: 1, dur: 1,
      pos: new THREE.Vector3(), target: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), fov: 38,
      from: { pos: new THREE.Vector3(), target: new THREE.Vector3(), up: new THREE.Vector3(), fov: 38 },
      want: { pos: new THREE.Vector3(), target: new THREE.Vector3(), up: new THREE.Vector3(), fov: 38 },
      orbit: 0,
    };

    this.ui.bind({
      start: () => this.start(),
      resume: () => this.togglePause(false),
      restart: () => { this.togglePause(false); this.score = this.scoreAtStart; this.prog = { ...this.progAtStart }; this.startNight(this.night); },
      // moving on banks what tonight earned; having another go at the same night doesn't
      next: () => { this._bankReward(); this.startNight(this.night + 1); },
      retry: () => { this.score = this.scoreAtStart; this.prog = { ...this.progAtStart }; this.startNight(this.night); },
      share: (e) => this.share(e.currentTarget),
      mute: () => this.toggleMute(),
      pause: () => this.togglePause(),
      boo: () => { this.audio.start(); this.input.events.boo = true; },
      wreath: () => { this.audio.start(); this.input.events.wreath = true; },
      sound: (kind) => this.audio.ui(kind),
    });
    this.ui.setSeed(this.seed + (this.best ? ` · your best ${this.best.toLocaleString('en-US')}` : ''));
    this.ui.setMuted(this.audio.muted);

    // browsers only let audio begin from inside a real user gesture
    const wake = () => this.audio.start();
    window.addEventListener('pointerdown', wake, { capture: true });
    window.addEventListener('keydown', wake, { capture: true });

    window.addEventListener('resize', () => this.resize());
    this.resize();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'play' && !this.paused) this.togglePause(true);
    });

    // first frame, then lift the curtain
    this._desired(this.cam.want);
    this.cam.pos.copy(this.cam.want.pos);
    this.cam.target.copy(this.cam.want.target);
    this.cam.up.copy(this.cam.want.up);
    this.last = performance.now();
    this.manual = q.has('manual'); // tests drive frames themselves
    if (!this.manual) renderer.setAnimationLoop((now) => this.tick(now));
    requestAnimationFrame(() => this.ui.hideLoading());
  }

  _wireWorld() {
    this.world.onGreatTier = (i) => {
      if (this.state !== 'play') return;
      const G = this.world.great;
      this.audio.tier(i);
      const tierY = 3 + i * 2.2;
      _v.copy(G.pos).addScaledVector(G.n, tierY);
      this.fx.burst(_v, G.n, 40, CFG.bulbColors, { speed: 9, life: 1.0, size: 0.45, spread: 1.4, upBias: 0.2, jitter: 3 });
      this.ui.popup(_v2.copy(G.top), i === 4 ? 'The Great Tree is ready…' : 'The Great Tree glows!', 'note', 1.6);
    };
  }

  // ============================================================ sizing

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const budget = 3.3e6; // cap the pixel count: bloom + MSAA at 4K is not a kindness
    const pr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(budget / (w * h))) * this.quality;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.final.uniforms.uAspect.value = w / h;
  }

  // ============================================================ tonight's biome & weather

  /** Dress the scene for the world we've just been given: its biome's colours, its weather, its wind. */
  _applyLook() {
    const P = this.world.params, B = P.biome;
    this.scene.fog.color.setHex(B.fog);
    this.fogK = P.weather.fog;
    this.ambient.color.setHex(B.ambient);
    this.ambient.intensity = B.ambientK;
    this.key.color.setHex(B.key);
    this.fill.color.setHex(B.fill);
    // Wind on a sphere has to go round something. It circles an axis square to where the night
    // begins, so the start is in the thick of it; it dies away toward the axis's two ends.
    const r = new RNG(this.seed + ':wind:' + this.world.night);
    this.windAxis = anyTangent(this.world.start).applyAxisAngle(this.world.start, r.range(0, TAU)).normalize();
    this.gust = 0;
    this.sky.setLook(P, this.windAxis);
  }

  // ============================================================ progression

  /** Starting on a later night (?night=3) assumes two-star nights before it, so it isn't a cold start. */
  _assumedProgress(night) {
    const P = CFG.progress, n = Math.max(0, night - 1);
    return {
      len: Math.min(P.maxStartLen, CFG.garland.startLen + n * (2 * P.lenPerStar + 5)),
      speed: Math.min(P.maxSpeed, 1 + n * 2 * P.speedPerStar),
    };
  }

  /** What tonight's performance is worth on the next night. */
  _reward(stars) {
    const P = CFG.progress, pr = this.prog;
    const gained = Math.max(0, this.garland.maxLen - pr.len);
    const len = Math.min(P.maxStartLen - pr.len, Math.round(gained * P.keep) + stars * P.lenPerStar);
    const speed = Math.min(P.maxSpeed - pr.speed, stars * P.speedPerStar);
    return { len: Math.max(0, len), speed: Math.max(0, +speed.toFixed(3)) };
  }

  _bankReward() {
    this.prog = { len: this.progAtStart.len + this.reward.len, speed: +(this.progAtStart.speed + this.reward.speed).toFixed(3) };
  }

  _progText(pr = this.prog) {
    const pct = Math.round((pr.speed - 1) * 100);
    return `${Math.round(pr.len)} m of lights` + (pct > 0 ? ` · +${pct}% speed` : '');
  }

  // ============================================================ timers

  after(sec, fn) {
    this.timers.push({ t: sec, fn });
  }

  _timers(dt) {
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const t = this.timers[i];
      t.t -= dt;
      if (t.t <= 0) {
        this.timers.splice(i, 1);
        t.fn();
      }
    }
  }

  // ============================================================ flow

  start() {
    if (this.state !== 'title') return;
    this.audio.start();
    this.startNight(this.night);
  }

  planetName() {
    const r = new RNG(this.seed + ':name:' + this.night);
    return r.pick(NAME_A) + r.pick(NAME_B);
  }

  startNight(n) {
    this.timers.length = 0;
    this.ui.showResults(null);
    this.ui.clearBanner();
    if (!this.worldFresh || n !== this.world.night) {
      this.world.dispose();
      this.world = new World(this.scene, this.seed, n);
      this._wireWorld();
    }
    this.worldFresh = false;
    const W = this.world, g = this.ghost;
    this.night = n;
    g.setWorld(W);
    g.resetHat();
    g.place(W.start, W.startUp);
    this.garland.setWorld(W);
    this.garland.clear(false);
    this.garland.maxLen = this.prog.len;
    this.garland.enabled = true;
    this.humbugs.reset(W);
    this.humbugs.enabled = true;
    this.presents.reset(W);

    this._applyLook();
    this.elapsed = 0;
    this.duration = W.params.duration;
    this.booCool = 0;
    this.streak = 0;
    this.streakT = 0;
    this.pickups.reset(n, W.params.weather.pickups);
    this.wreath.stop();
    this.wreathHeld = false;
    this.ui.setWreath(false);
    this.power = 0;
    this.rush = 0;
    this.garland.bonus = 0;
    this.ui.setPower(false);
    this.ui.setBuffs(this.buffs = []);
    this.markers.fill(null);
    this.progAtStart = { ...this.prog };
    this.reward = { len: 0, speed: 0 };
    this.warned = false;
    this.lastTick = -1;
    this.won = false;
    this.apTarget = null;
    this.stats = { loops: 0, biggest: 0, wrapped: 0, presents: 0, hats: 0, live: 0, bestMul: 1 };
    this.scoreAtStart = this.score;
    this.state = 'play';
    this.paused = false;
    this.input.enabled = true;
    this.input.take('boo');

    this.setCam('play', 2.3);
    this.ui.showTitle(false);
    this.ui.showPause(false);
    this.ui.showHUD(true);
    this.ui.setSpirit(0);
    this.ui.setScore(this.score, true);
    this.ui.setLights(this.garland.maxLen);
    this.ui.setClock(0, this.duration);
    this.audio.setMode('play');
    const P = W.params, carried = this.prog.len > CFG.garland.startLen || this.prog.speed > 1;
    this.ui.banner(`Night ${n}`, n === 1 ? `${this.planetName()} · 9 PM · light it all before midnight` : `${this.planetName()} · ${P.biome.name} · ${P.weather.name}`);
    this.ui.setPauseInfo(`Night ${n} · ${P.biome.name} · ${P.weather.name} · ${this._progText()}`);
    // after night one: what the weather will do tonight, and what you've brought with you
    const brief = [];
    if (P.weather.note) brief.push(`<b>${P.weather.name}</b>: ${P.weather.note}.`);
    if (carried) {
      const pct = Math.round((this.prog.speed - 1) * 100);
      brief.push(`You start with <b>${Math.round(this.prog.len)} m</b> of lights${pct > 0 ? ` and <b>+${pct}%</b> speed` : ''}.`);
    }
    if (n > 1 && brief.length) this.after(1.6, () => { if (this.state === 'play') this.ui.hint(brief.join(' '), 8); });
    this.guideOn = false;
    if (n === 1 && !this.seen.loop) {
      this.after(2.6, () => { if (!this.seen.loop) this.ui.hint('Draw a <b>loop</b> around the trees with your fairy lights to switch them on!', 9); });
      this._placeGuide();
    }
  }

  togglePause(force) {
    if (this.state !== 'play') return;
    this.paused = force === undefined ? !this.paused : force;
    this.ui.showPause(this.paused);
    this.last = performance.now();
  }

  toggleMute() {
    this.audio.setMuted(!this.audio.muted);
    this.ui.setMuted(this.audio.muted);
  }

  finish(win) {
    if (this.state !== 'play') return;
    const W = this.world;
    this.state = 'finale';
    this.won = win;
    this.input.enabled = false;
    this.garland.clear(true);
    this.garland.enabled = false;
    this.humbugs.enabled = false;
    this.humbugs.calm = true;
    this.ui.hint(null);
    this.ui.showHUD(false);
    this.ui.setHatArrow(null);
    this.ui.setMarkers(this.markers.fill(null), this.camera);
    this.pickups.clear();
    this.wreath.stop();
    this.wreathHeld = false;
    this.ui.setWreath(false);
    this.power = 0;
    this.rush = 0;
    this.garland.bonus = 0;
    this.ui.setBuffs(this.buffs = []);
    // whatever happened to the hat, Boo gets it back for the party
    if (this.ghost.hatState !== 'on') {
      for (const b of this.humbugs.list) if (b.hasHat) { b.hasHat = false; b.hat.visible = true; }
      this.humbugs.thief = null;
      this.ghost.resetHat();
    }
    this.timeLeft = Math.max(0, this.duration - this.elapsed);
    const spirit = W.spirit;
    this.score += Math.round(spirit * 100) * 20 + (win ? Math.ceil(this.timeLeft) * 25 : 0);
    this.cam.orbit = Math.atan2(this.ghost.p.z, this.ghost.p.x);
    this.setCam('finale', 3.4);
    this.audio.setMode('finale');

    if (win) {
      W.great.starTarget = 1;
      this.flash = 0.55;
      this.audio.fanfare();
      this.ui.banner('Christmas is saved!', 'Every last light is on.');
      this.humbugs.list.slice().forEach((b, i) => this.after(0.4 + i * 0.16, () => this._wrapBug(b, i, 1, 1, true)));
      for (let i = 0; i < 20; i++) this.after(0.7 + i * 0.33 + Math.random() * 0.2, () => this._firework(2.6));
      this.after(1.2, () => this.audio.toll(0, 0.22));
    } else {
      this.ui.banner('Midnight!', `Christmas arrived at ${Math.round(spirit * 100)}% sparkle.`);
      for (let i = 0; i < 4; i++) this.audio.toll(i * 1.25, 0.3);
      this.audio.sad();
      const n = Math.round(spirit * 8);
      for (let i = 0; i < n; i++) this.after(1.2 + i * 0.45, () => this._firework(2.0));
    }
    this.after(win ? 7.4 : 5.6, () => this.showResults());
  }

  _firework(power) {
    const W = this.world;
    const lit = W.lightables.filter((o) => o.lit);
    const n = lit.length && Math.random() < 0.7 ? lit[(Math.random() * lit.length) | 0].n : W.pole;
    const t1 = anyTangent(n), t2 = _v.crossVectors(n, t1);
    const at = offsetOnSphere(n, t1, t2, Math.random() * TAU, (Math.random() * 6) / CFG.R);
    const cols = CFG.bulbColors;
    const a = cols[(Math.random() * cols.length) | 0], b = cols[(Math.random() * cols.length) | 0];
    // mostly one colour with a pinch of a second, slightly dimmed so overlapping sparks stay colourful
    const dim = (c) => [c[0] * 0.62, c[1] * 0.62, c[2] * 0.62];
    this.fx.firework(at, W, [dim(a), dim(a), dim(a), dim(b)], power);
    this.audio.whistle();
  }

  showResults() {
    const W = this.world, win = this.won, spirit = W.spirit;
    const stars = win ? 3 : spirit >= 0.75 ? 2 : spirit >= 0.4 ? 1 : 0;
    const pct = Math.round(spirit * 100);
    const copy = [
      ['Total humbug', `Only ${pct}% of ${this.planetName()} was lit at midnight. The Humbugs are insufferable.`],
      ['A bit bah', `${pct}% sparkle. Christmas happened, technically.`],
      ['So nearly merry', `${pct}% of the lights were on. One more loop would have done it!`],
      ['Merry Boo-mas!', `You lit every last bulb in ${this.planetName()}. You <i>are</i> the Christmas spirit.`],
    ][stars];
    this.reward = this._reward(stars);
    const rw = this.reward, bits = [];
    if (rw.len > 0) bits.push(`<b>+${rw.len} m</b> of lights`);
    if (rw.speed > 0) bits.push(`<b>+${Math.round(rw.speed * 100)}%</b> speed`);
    const keep = bits.length ? `Night ${this.night + 1} starts with ${bits.join(' and ')}` : stars ? '' : 'Earn a star to carry lights and speed into the next night';
    const isBest = this.score > this.best;
    if (isBest) {
      this.best = this.score;
      try { localStorage.setItem('boomas.best', String(this.best)); } catch (_) { /* ignore */ }
    }
    this.state = 'results';
    this.ui.clearBanner();
    this.lastResult = { win, spirit, stars, night: this.night, score: this.score, wrapped: this.stats.wrapped };
    // keep the party going behind the score card
    const encore = () => {
      if (this.state !== 'results') return;
      this._firework(2.2);
      this.after(0.7 + Math.random() * 0.9, encore);
    };
    if (stars >= 2) this.after(0.4, encore);
    this.ui.showResults({
      title: copy[0], sub: copy[1], win, spirit, stars, night: this.night,
      loops: this.stats.loops, biggest: this.stats.biggest, wrapped: this.stats.wrapped, live: this.stats.live,
      timeLeft: this.timeLeft, score: this.score, best: this.best, isBest, keep,
    });
  }

  share(btn) {
    const r = this.lastResult;
    if (!r) return;
    const url = `${location.origin}${location.pathname}?seed=${encodeURIComponent(this.seed)}`;
    const text = `👻🎄 Boo-mas · night ${r.night} on planet "${this.seed}"\n${Math.round(r.spirit * 100)}% Christmas spirit ${'⭐'.repeat(r.stars) || '🪨'} · ${r.score.toLocaleString('en-US')} pts · ${r.wrapped} Humbugs gift-wrapped\n${url}`;
    const done = () => { const old = btn.textContent; btn.textContent = 'Copied!'; setTimeout(() => (btn.textContent = old), 1400); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => window.prompt('Copy your result:', text));
    else window.prompt('Copy your result:', text);
  }

  // ============================================================ the BOO

  boo() {
    const g = this.ghost, W = this.world;
    if (this.booCool > 0 || !g.booReady) { this.audio.booNotReady(); return; }
    this.booCool = CFG.boo.cooldown;
    g.boo();
    this.audio.boo();
    this.ui.booFired();
    this.after(0.09, () => {
      const n = g.p.clone();
      const rad = CFG.boo.radius;
      this.fx.ring(n, W, [0.6, 0.85, 2.0], 1.0, rad, 0.62, 0.15);
      this.fx.ring(n, W, [0.28, 0.42, 1.0], 0.5, rad * 0.7, 0.8, 0.34);
      this.fx.addShake(0.55);
      this.sky.blastSnow(n);
      this.minimap.ping(n, 'boo');
      this.shockT = 0;
      this.ui.popup(g.headWorld(_v, 2.3), 'BOO!', 'boo', 0.85);
      this.fx.burst(g.pos, g.p, 30, [[1.4, 2.2, 4.2], [3, 3.2, 3.6]], { speed: 12, life: 0.5, size: 0.42, gravity: 2, drag: 2.6, spread: 1.6, upBias: 0.1 });
      const flipped = this.humbugs.boo(n, rad);
      for (const o of W.near(n, rad)) {
        const delay = Math.acos(clamp(o.n.dot(n), -1, 1)) * CFG.R * 0.04;
        this.after(delay, () => {
          W.jolt(o, 5.5);
          if (o.type === 'tree') this.fx.snowPuff(o.top, o.n, 4, 2.2, 0.75);
        });
      }
      if (flipped && !this.seen.flip) {
        this.seen.flip = true;
        this.ui.hint('Belly up! Now <b>loop</b> the Humbug to gift-wrap it.', 6);
      }
    });
  }

  // ============================================================ loops

  onLoop({ pts, bulbs }) {
    const W = this.world, g = this.ghost;
    // every bulb in the loop bursts into sparks
    bulbs.forEach((b, i) => {
      this.fx.burst(b.pos, _n.copy(b.pos).normalize(), 2, CFG.bulbColors[b.ci], { speed: 3.6, life: 0.55, size: 0.3, gravity: 5, delay: i * 0.004 });
    });

    const c = new THREE.Vector3();
    for (const p of pts) c.add(p);
    if (c.lengthSq() < 1e-8) return;
    c.normalize();
    const e1 = anyTangent(c), e2 = new THREE.Vector3().crossVectors(c, e1);
    const plane = [];
    for (const p of pts) {
      const v = new THREE.Vector2();
      if (!gnomonic(p, c, e1, e2, v)) { this.audio.fizzle(); return; }
      plane.push(v);
    }
    const area = Math.abs(polyArea(plane)) * CFG.R * CFG.R;
    if (area < CFG.garland.minArea) { this.audio.fizzle(); return; }

    const inside = (n) => n.dot(c) > 0.2 && gnomonic(n, c, e1, e2, _p2) && pointInPoly(_p2.x, _p2.y, plane);
    const lights = W.lightables.filter((o) => !o.lit && inside(o.n));
    const bugs = this.humbugs.select(inside);
    const count = lights.length + bugs.length;
    const center = W.surface(c, 2.4);

    // was that the wreath's ring? A perfect circle uses the wreath up; any other loop just lays a
    // fresh ring from where Boo is now.
    let perfect = false;
    if (this.wreath.on) {
      perfect = this.wreath.matches(c, area);
      if (perfect) this.wreath.stop(); else this._anchorWreath();
    }

    if (count === 0) {
      const already = W.lightables.some((o) => o.lit && inside(o.n));
      this.fx.fill(pts, plane, W, [0.14, 0.22, 0.5]);
      this.audio.fizzle();
      this.ui.popup(center, already ? 'Already twinkling!' : 'Nothing in there…', 'note', 1.3);
      return;
    }

    this.streak = this.streakT > 0 ? this.streak + 1 : 1;
    this.streakT = STREAK_TIME;
    const streakMul = 1 + Math.min(this.streak - 1, 8) * 0.25; // caps at ×3

    // Bonuses. Each one that applies multiplies the whole loop, and they stack.
    const live = bugs.filter((b) => this.humbugs.isLive(b)); // still on their feet: the hard way to catch one
    const B = CFG.bonus, bonuses = [];
    if (streakMul > 1) bonuses.push(['Jolly streak', streakMul]);
    if (live.length) bonuses.push([live.length > 1 ? `${live.length} live catches` : 'Live catch', B.live + (live.length - 1) * B.liveExtra]);
    if (bugs.length > 1) bonuses.push([bugs.length === 2 ? 'Humbug pair' : bugs.length === 3 ? 'Humbug trio' : 'Humbug swarm', 1 + (bugs.length - 1) * B.pack]);
    if (perfect) bonuses.push(['Perfect circle', B.circle]);
    const mul = bonuses.reduce((k, b) => k * b[1], 1);

    this.stats.loops++;
    this.stats.biggest = Math.max(this.stats.biggest, count);
    this.stats.live += live.length;
    this.stats.bestMul = Math.max(this.stats.bestMul, count * mul);
    if (!this.seen.loop) {
      this.seen.loop = true;
      this.ui.hint('Lovely! Bigger loops score more. Light the <b>whole planet</b> before midnight.', 6);
    }

    this.fx.fill(pts, plane, W, count >= 6 ? [1.15, 0.45, 0.8] : count >= 3 ? [1.05, 0.7, 0.22] : [0.7, 0.55, 0.3]);
    this.audio.loopClose(count);
    if (count >= 3) { if (!this.calmMotion) this.hitStop = 0.085; this.fx.addShake(0.18 + Math.min(0.45, count * 0.045)); }
    g.celebrate(Math.min(1, 0.45 + count * 0.1));

    // light things one after another, rippling out from where the loop was closed
    const origin = pts[0];
    const targets = [...lights.map((o) => ({ o, n: o.n })), ...bugs.map((b) => ({ b, n: b.n }))];
    targets.sort((a, b) => b.n.dot(origin) - a.n.dot(origin));
    targets.forEach((t, i) => {
      const isLive = !!t.b && live.includes(t.b);
      this.after(0.07 + i * 0.075, () => {
        if (t.o) this._lightUp(t.o, i, count, mul);
        else this._wrapBug(t.b, i, count, mul, false, isLive);
      });
    });
    const word = perfect ? 'Perfect circle!' : WORDS[Math.min(count, WORDS.length - 1)];
    // the stack of bonuses, one tag each, under the combo
    const tags = bonuses.map(([label, k], i) => `<em style="--i:${i}">${label} <b>${times(k)}</b></em>`).join('');
    this.ui.popup(W.surface(c, 8.5), `×${count}<small>${word}</small>${tags ? `<span class="tags">${tags}</span>` : ''}`, tags ? 'combo long' : 'combo', tags ? 2.5 : 1.6);
    const extra = bonuses.length - (streakMul > 1 ? 1 : 0); // the streak already has its own fanfare
    if (extra > 0) {
      this.audio.bonus(extra);
      this.fx.addShake(0.2);
    }
    if (live.length && !this.seen.live) {
      this.seen.live = true;
      this.ui.hint('A <b>live catch</b>! Looping a Humbug that is still on its feet doubles the whole loop — and bonuses <b>stack</b>.', 7);
    }
  }

  _lightUp(o, i, mult, streakMul) {
    const W = this.world;
    if (!W.setLit(o, true)) return;
    this.addScore(Math.round(100 * mult * streakMul), o.top);
    this.audio.ding(i);
    this.fx.burst(o.top, o.n, o.type === 'house' ? 24 : 14, CFG.bulbColors, { speed: 6.5, life: 0.8, size: 0.36 });
    const warm = o.type === 'snowman' ? [0.5, 0.85, 1.5] : [1.4, 0.85, 0.3];
    this.fx.ring(o.n, W, warm, 0.5, o.type === 'house' ? 6.5 : 4.2, 0.55, 0.3);
    if (o.type === 'tree') this.fx.snowPuff(o.top, o.n, 5, 2.4, 0.8);
    if (o.type === 'snowman' && !this.seen.snowman) {
      this.seen.snowman = true;
      this.ui.hint('That snowman is alive now. It throws <b>snowballs</b> at Humbugs for you.', 6);
    }
    this._spiritChanged();
  }

  _wrapBug(b, i, mult, streakMul, quiet = false, live = false) {
    if (!this.humbugs.wrap(b)) return;
    this.stats.wrapped++;
    const pos = b.group.position.clone().addScaledVector(b.n, 0.6);
    const n = b.n.clone();
    if (!quiet) this.addScore(Math.round(250 * mult * streakMul), pos);
    if (live) this.ui.popup(pos.clone().addScaledVector(n, 2.1), 'Live catch!', 'live', 1.5);
    this.audio.wrap();
    this.fx.burst(pos, n, live ? 30 : 18, [[6, 5, 2.5], [5, 5, 5], [6, 1.5, 3]], { speed: live ? 8 : 6, life: 0.7, size: 0.38 });
    this.fx.snowPuff(pos, n, 6, 2.2, 0.9, [1, 0.96, 0.86]);
    // a live catch wraps up as a golden present, worth twice the string
    this.after(0.26, () => (live ? this.presents.spawn(pos, n, 0, GOLD_PRESENT, true) : this.presents.spawn(pos, n)));
    if (!quiet && !this.seen.wrap) {
      this.seen.wrap = true;
      this.ui.hint('Gift-wrapped! Every present makes your <b>string of lights longer</b>.', 6);
    }
  }

  addScore(pts, pos) {
    this.score += pts;
    this.ui.setScore(this.score);
    if (pos) this.ui.popup(pos, '+' + pts.toLocaleString('en-US'), 'score');
  }

  _spiritChanged() {
    this.ui.setSpirit(this.world.spirit);
    if (this.state === 'play' && this.world.litCount >= this.world.lightables.length) this.finish(true);
  }

  onBreak(bulbs) {
    bulbs.forEach((b, i) => {
      this.fx.burst(b.pos, _n.copy(b.pos).normalize(), 2, CFG.bulbColors[b.ci], { speed: 2.6, life: 0.5, size: 0.24, gravity: 6, delay: i * 0.012 });
      if (i < 7) this.audio.pop(i);
    });
  }

  // ============================================================ callbacks from the humbugs & presents

  onBugSpawn(b) {
    const W = this.world;
    this.audio.bugSpawn();
    W.surface(b.n, 0.4, _v);
    this.fx.snowPuff(_v, b.n, 9, 3, 1.0, [0.3, 0.29, 0.36]);
    this.ui.popup(_v2.copy(_v).addScaledVector(b.n, 1.6), 'Bah!', 'bah');
    if (!this.seen.bug && this.state === 'play') {
      this.seen.bug = true;
      this.ui.hint(`A <b>Humbug</b> — they chew the lights out! ${this.touch ? '<b>Tap</b>' : '<kbd>Space</kbd>'} to BOO it onto its back.`, 8);
    }
  }

  onBah(b) {
    if (b.n.dot(this.ghost.p) < Math.cos(24 / CFG.R)) return;
    this.ui.popup(_v.copy(b.group.position).addScaledVector(b.n, 1.7), BAHS[(Math.random() * BAHS.length) | 0], 'bah');
    this.audio.bah();
  }

  onGnawStart(b, o) {
    this.ui.popup(_v.copy(o.top).addScaledVector(o.n, 0.6), 'nom nom…', 'bah', 1.3);
    this.audio.nibble(); // heard from anywhere: there's a marker to follow
  }

  onGnawTick(b, o) {
    if (b.n.dot(this.ghost.p) > Math.cos(22 / CFG.R)) this.audio.gnaw();
    _v.copy(b.group.position).addScaledVector(b.n, 0.6).addScaledVector(b.heading, 0.7);
    this.fx.burst(_v, b.n, 1, [6, 3.5, 0.6], { speed: 3, life: 0.35, size: 0.2, gravity: 8 });
  }

  onUnlit(o) {
    this.world.setLit(o, false);
    this.audio.unlight();
    this.ui.popup(o.top, 'Lights out. Bah!', 'sad', 1.4);
    this.ui.lost();
    this.fx.snowPuff(o.top, o.n, 6, 1.6, 0.9, [0.28, 0.28, 0.38]);
    this._spiritChanged();
  }

  onBugFlip(b) {
    this.audio.flip();
    this.fx.snowPuff(b.group.position, b.n, 5, 2.6, 0.7);
    _v.copy(b.group.position).addScaledVector(b.n, 1.2);
    this.fx.burst(_v, b.n, 6, [6, 5, 1.5], { speed: 3, life: 0.6, size: 0.3, gravity: 1, spread: 2 });
  }

  onSnip(b, pos) {
    this.audio.snip();
    this.ui.popup(pos, 'Snip!', 'sad', 1.1);
    this.fx.burst(pos, _n.copy(pos).normalize(), 12, [6, 5, 2], { speed: 5, life: 0.5, size: 0.3 });
    if (!this.seen.snip) {
      this.seen.snip = true;
      this.ui.hint('Humbugs <b>chew through your string</b>. BOO them first — or risk it: a <b>live catch</b> is worth double.', 7);
    }
  }

  onGhostHit(b, away) {
    const g = this.ghost;
    if (this.state !== 'play') return;
    if (g.hasHat) {
      projectTangent(away, g.p);
      if (away.lengthSq() < 1e-8) anyTangent(g.p, away);
      away.normalize().applyAxisAngle(g.p, (Math.random() - 0.5) * 1.3);
      g.knockHat(away, 5.5 + Math.random() * 2.5);
      this.garland.clear(true);
      this.wreath.stop(); // no string, no circle
      this.audio.hatOff();
      this.fx.addShake(0.75);
      this.fx.burst(g.pos, g.p, 22, [[6, 1, 1], [5, 5, 5]], { speed: 7, life: 0.6, size: 0.36 });
      this.ui.popup(g.headWorld(_v, 2.1), 'My hat!', 'sad', 1.5);
      this.streak = 0;
      this.streakT = 0;
      this.stats.hats++;
      this.ui.hint('No hat, no Christmas magic! <b>Go and grab it.</b>', 0);
    } else {
      g.invuln = 1.2;
      g.shock = 1;
      this.audio.bah();
    }
  }

  onHatStolen(b) {
    this.audio.bah();
    this.audio.steal();
    this.ui.popup(_v.copy(b.group.position).addScaledVector(b.n, 2.2), 'Mine!', 'bah', 1.5);
    this.fx.snowPuff(b.group.position, b.n, 6, 2.4, 0.8);
    this.ui.hint(`That Humbug has <b>your hat</b>! Chase it and BOO it${this.touch ? '' : ' <kbd>Space</kbd>'} to make it drop.`, 0);
  }

  onHatDropped(b) {
    tangentToward(b.n, this.ghost.p, _dir).negate();
    if (_dir.lengthSq() < 1e-8) anyTangent(b.n, _dir);
    _dir.applyAxisAngle(b.n, (Math.random() - 0.5) * 1.6);
    this.ghost.dropHat(_dir, 3.4);
    if (this.state === 'play') this.ui.hint('Dropped it! <b>Grab your hat.</b>', 0);
  }

  onSnowball() {
    this.audio.snowball();
  }

  onSnowballHit(b, pos) {
    this.audio.splat();
    this.fx.snowPuff(pos, b.n, 10, 3.2, 0.9);
  }

  onPresentLand(p) {
    this.fx.snowPuff(p.to, p.n, 4, 1.6, 0.6);
  }

  onPresentTrail(p) {
    if (Math.random() < 0.6) this.fx.twinkle(p.pos, PRESENT_GLOW[p.ci], 0.3, 0.4);
  }

  onPresent(p) {
    const g = this.ghost;
    this.stats.presents++;
    const before = this.garland.maxLen;
    this.garland.maxLen = Math.min(CFG.garland.maxLen, before + CFG.garland.perPresent * (p.gold ? 2 : 1));
    this.addScore(p.gold ? 150 : 50, null);
    this.audio.present();
    this.fx.burst(g.pos, g.p, 14, PRESENT_GLOW[p.ci], { speed: 6, life: 0.6, size: 0.36 });
    g.celebrate(0.6);
    const gain = Math.round(this.garland.maxLen - before);
    this.ui.popup(g.headWorld(_v, 1.9), gain > 0 ? `+${gain}m of lights!` : '+50', 'note', 1.3);
    this.ui.setLights(this.garland.maxLen + this.garland.bonus);
  }

  // ============================================================ ambience

  _ambient(dt) {
    const W = this.world, g = this.ghost;
    for (const o of W.lightables) {
      if (o.type !== 'house' || !o.lit || o.anim < 1) continue;
      o.smokeT -= dt;
      if (o.smokeT <= 0) { o.smokeT = 0.45 + Math.random() * 0.5; this.fx.smoke(o.chimney, o.n); }
      if (this.state !== 'play') continue;
      // a happy house lobs the occasional present out of its chimney
      if (o.giftT === undefined) o.giftT = 10 + Math.random() * 18;
      o.giftT -= dt;
      if (o.giftT <= 0) {
        o.giftT = 22 + Math.random() * 16;
        if (this.presents.list.length < 5) {
          const t1 = anyTangent(o.n), t2 = _v.crossVectors(o.n, t1);
          const n = offsetOnSphere(o.n, t1, t2, Math.random() * TAU, 4.2 / CFG.R);
          this.presents.spawn(o.chimney, n);
          this.fx.snowPuff(o.chimney, o.n, 5, 2, 0.6);
          this.audio.pop(3);
        }
      }
    }
    // Boo sheds a little stardust when moving
    this.trailT -= dt;
    if (g.speed > 4 && this.trailT <= 0) {
      this.trailT = 0.04;
      _v.copy(g.pos).addScaledVector(g.p, -0.55 + Math.random() * 0.5);
      _v.x += (Math.random() - 0.5) * 0.7; _v.y += (Math.random() - 0.5) * 0.7; _v.z += (Math.random() - 0.5) * 0.7;
      this.fx.twinkle(_v, [0.8, 1.2, 2.3], 0.2 + Math.random() * 0.18, 0.55);
    }
    // a beacon over the lost hat
    if (g.hatState === 'ground' && Math.random() < dt * 14) {
      g.hatWorld(_v);
      this.fx.twinkle(_v, [6, 4, 1], 0.4, 0.8, _v2.copy(g.hatN).multiplyScalar(4 + Math.random() * 3));
    }
  }

  /** Paint the tutorial ring round the grove nearest the start. */
  _placeGuide() {
    const W = this.world;
    let first = null, bd = -2;
    for (const o of W.lightables) if (o.type === 'tree' && o.n.dot(W.start) > bd) { bd = o.n.dot(W.start); first = o; }
    if (!first) return;
    const group = W.lightables.filter((o) => o.n.dot(first.n) > Math.cos(6 / CFG.R));
    const c = new THREE.Vector3();
    for (const o of group) c.add(o.n);
    c.normalize();
    let r = 0;
    for (const o of group) r = Math.max(r, Math.acos(clamp(o.n.dot(c), -1, 1)) * CFG.R);
    r = Math.min(8.2, r + 2.6); // must stay loopable with the starting length of string
    W.surface(c, 0.2, this.guide.position);
    quatFromUpYaw(c, 0, this.guide.quaternion);
    this.guide.scale.setScalar(r);
    this.guideOn = true;
  }

  // ============================================================ power-ups

  /** Don't send down a power-up whose effect is already running. */
  pickupBlocked(kind) {
    return (kind === 'star' && this.power > 0) || (kind === 'wreath' && (this.wreath.on || this.wreathHeld)) || (kind === 'cane' && this.rush > 0);
  }

  onPickupLand(item) {
    const key = 'pick_' + item.kind;
    if (this.seen[key]) return;
    this.seen[key] = true;
    this.ui.hint({
      star: 'A <b>shooting star</b> landed! Grab it: your string gets <b>much</b> longer for a few seconds.',
      wreath: 'A <b>wreath</b>! Grab it and keep it for a good spot: it paints the <b>biggest circle</b> your string can close.',
      cane: 'A <b>candy cane</b>! Grab it for a <b>sugar rush</b>.',
    }[item.kind], 7);
  }

  onPickup(item) {
    const g = this.ghost, W = this.world, P = PICKUP[item.kind];
    this.flash = 0.3;
    this.audio.starPower();
    this.fx.burst(g.pos, g.p, 44, [P.glow, [5, 5, 4]], { speed: 10, life: 0.9, size: 0.45, spread: 1.6 });
    this.fx.ring(g.p, W, P.ring, 1, 12, 0.7, 0.18);
    g.celebrate(1);
    this.addScore(100, null);
    if (item.kind === 'star') {
      this.power = CFG.star.time;
      this.garland.bonus = CFG.star.bonus;
      this.ui.popup(g.headWorld(_v, 3.4), 'Star power!<small>your string is HUGE — go big!</small>', 'combo', 1.9);
      this.ui.setPower(true);
      this.ui.setLights(this.garland.maxLen + this.garland.bonus);
      if (this.wreath.on) this._anchorWreath(); // more string, bigger ring
    } else if (item.kind === 'wreath') {
      // kept until you choose to use it: where it goes down is the whole point
      this.wreathHeld = true;
      this.wreathGood = false;
      this.wreathScanT = 0;
      this.ui.popup(g.headWorld(_v, 3.4), 'A wreath!<small>keep it for a good spot</small>', 'combo', 1.9);
      if (!this.seen.wreathHeld) {
        this.seen.wreathHeld = true;
        this.ui.hint(`You have a <b>wreath</b>. ${this.touch ? 'Tap it' : 'Press <kbd>E</kbd>'} where there's plenty to light: its number is what the ring would catch.`, 9);
      }
    } else {
      this.rush = CFG.cane.time;
      this.audio.rush();
      this.ui.popup(g.headWorld(_v, 3.4), 'Sugar rush!<small>zoom zoom zoom</small>', 'combo', 1.9);
    }
  }

  /**
   * How much is there worth lighting inside the circle of angular radius `a` about unit vector c?
   * A Humbug counts double when choosing where the ring goes; `plain` just counts heads.
   */
  _worth(c, a, plain = false) {
    const cosA = Math.cos(a);
    let w = 0;
    for (const o of this.world.lightables) if (!o.lit && o.n.dot(c) > cosA) w++;
    for (const b of this.humbugs.list) if (b.state !== 'wrapped' && b.n.dot(c) > cosA) w += plain ? 1 : 2;
    return w;
  }

  /** If the wreath's ring went down here and now, how many things would be inside it? */
  _surveyWreath() {
    return this.wreath.survey(
      this.ghost, this.garland.maxLen + this.garland.bonus,
      (c, a) => this._worth(c, a),
      (c, a) => { this.wreathA = a; return this._worth(c, a, true); }
    );
  }

  /** Set off the wreath you are carrying: its ring goes down here, now. */
  useWreath() {
    if (!this.wreathHeld || this.state !== 'play') return;
    const g = this.ghost;
    const here = g.hasHat ? this._surveyWreath() : 0;
    if (here <= 0) {
      // no hat means no string — and a ring round nothing would be a waste of a good wreath
      this.audio.booNotReady();
      this.ui.wreathNope();
      this.ui.popup(g.headWorld(_v, 2.2), g.hasHat ? 'Nothing to ring here…' : 'Not without my hat!', 'note', 1.2);
      return;
    }
    this.wreathHeld = false;
    this.ui.setWreath(false);
    this.wreath.begin(this.world, g, this.garland.maxLen + this.garland.bonus, (c, a) => this._worth(c, a));
    this.audio.starPower();
    this.flash = 0.2;
    this.fx.ring(g.p, this.world, PICKUP.wreath.ring, 1, 12, 0.7, 0.18);
    g.celebrate(0.7);
    this.ui.popup(g.headWorld(_v, 3.4), 'Wreath!<small>follow the ring for a perfect circle</small>', 'combo', 1.9);
  }

  _anchorWreath() {
    this.wreath.anchor(this.world, this.ghost, this.garland.maxLen + this.garland.bonus, (c, a) => this._worth(c, a));
  }

  /** Count down whatever is running, and keep the HUD chips up to date. */
  _powers(dt) {
    const g = this.ghost;
    if (this.power > 0) {
      this.power -= dt;
      if (Math.random() < dt * 40) {
        _v.copy(g.pos).addScaledVector(g.p, -0.4 + Math.random());
        this.fx.twinkle(_v, PICKUP.star.glow, 0.3, 0.7, null, 0);
      }
      if (this.power <= 0) {
        this.power = 0;
        this.garland.bonus = 0;
        this.audio.powerEnd();
        this.ui.setPower(false);
        this.ui.setLights(this.garland.maxLen);
        if (this.wreath.on) this._anchorWreath(); // the string just shrank: so does the ring
      }
    }
    if (this.rush > 0) {
      this.rush -= dt;
      if (g.speed > 4 && Math.random() < dt * 55) {
        _v.copy(g.pos).addScaledVector(g.p, -0.5 + Math.random() * 0.9).addScaledVector(g.vel, -0.03);
        this.fx.twinkle(_v, Math.random() < 0.5 ? PICKUP.cane.glow : [4, 4, 4.4], 0.3, 0.5, null, 0);
      }
      if (this.rush <= 0) { this.rush = 0; this.audio.powerEnd(); }
    }
    // carrying a wreath: keep its button's number current, and nudge when this is a good spot
    if (this.wreathHeld) {
      this.wreathScanT -= dt;
      if (this.wreathScanT <= 0) {
        this.wreathScanT = 0.2;
        const n = g.hasHat ? this._surveyWreath() : 0;
        const left = this.world.lightables.length - this.world.litCount;
        // "Good" is well above what a ring dropped at random would catch (a ring this size covers
        // `share` of the planet) — or, late on, simply everything that is left.
        const share = (1 - Math.cos(this.wreathA)) / 2;
        const k = lerp(3.5, 2, clamp((share - 0.02) / 0.08));
        const good = n > 0 && (n >= Math.max(4, Math.ceil(left * share * k)) || n >= left);
        if (good && !this.wreathGood && this.time - this.wreathDingT > 4) { this.wreathDingT = this.time; this.audio.ding(7); }
        this.wreathGood = good;
        this.ui.setWreath(true, n, good);
      }
    }
    const wasOn = this.wreath.on;
    this.wreath.update(dt, g);
    if (wasOn && !this.wreath.on && this.state === 'play') this.audio.powerEnd();
    // night-to-night speed, times any sugar rush
    g.speedMul = this.prog.speed * (this.rush > 0 ? CFG.cane.speed : 1);

    const b = this.buffs;
    b.length = 0;
    if (this.power > 0) b.push({ kind: 'star', p: this.power / CFG.star.time });
    if (this.wreath.on) b.push({ kind: 'wreath', p: 1 - this.wreath.t / this.wreath.dur });
    if (this.rush > 0) b.push({ kind: 'cane', p: this.rush / CFG.cane.time });
    this.ui.setBuffs(b);
  }

  // ============================================================ markers

  /** pin: hover over the thing while it is in view · edge: sit at the screen edge, pointing, while it isn't */
  _mark(slot, pos, kind, pin = false, edge = true, p = 0, n = 0) {
    const it = this.markPool[slot];
    it.pos.copy(pos); it.kind = kind; it.pin = pin; it.edge = edge; it.p = p; it.n = n;
    this.markers[slot] = it;
  }

  /**
   * Pointers to things worth knowing about: Humbugs chewing, power-ups, presents, and what is
   * still dark. Out of view (or over the horizon) they sit at the edge of the screen and point the
   * way to steer; some also hover over their target while it is in view.
   */
  _markers(dt) {
    const W = this.world, g = this.ghost, M = this.markers;
    M.fill(null);
    if (this.state === 'play') {
      // Humbugs chewing the lights out of something: a countdown ring, wherever it is happening
      // (the nearest to finishing first: if there are too many to show, those are the ones that matter)
      let k = 0;
      const chewing = this.humbugs.list.filter((b) => b.state === 'gnaw' && b.target).sort((a, b) => b.t - a.t);
      for (const b of chewing) {
        if (k >= SLOT.bugN) break;
        this._mark(SLOT.bug + k++, b.target.top, 'bug', true, true, clamp(b.t / CFG.humbug.gnawTime));
      }
      // a power-up waiting to be grabbed, with how long it will wait
      const it = this.pickups.item;
      if (it.state === 'idle') this._mark(SLOT.pick, it.pos, it.kind, false, true, 1 - it.t / CFG.pickup.linger);
      // presents lying in the snow
      k = 0;
      for (const p of this.presents.list) {
        if (p.state !== 'idle' || k >= SLOT.giftN) continue;
        this._mark(SLOT.gift + k++, p.pos, p.gold ? 'gift gold' : 'gift');
      }

      // What's still dark, kept to a few pointers at the edge of the screen. A group of dark things
      // (a village, a grove) is one pointer with a count, and pointers that lie the same way are
      // rolled into one. Nothing is drawn over a group you can already see — except stragglers:
      // the last one or two in a group that is otherwise lit, and the last few of the whole night,
      // each get a small pip so they can be found.
      const left = W.lightables.length - W.litCount;
      const few = left > 0 && left <= 5;
      const cls = W.clusters;
      for (const cl of cls) {
        cl.unlit = 0;
        cl.un.set(0, 0, 0);
        for (const o of cl.members) if (!o.lit) { cl.unlit++; cl.un.add(o.n); }
        if (cl.unlit) { cl.un.normalize(); cl.dot = cl.un.dot(g.p); } else cl.dot = -2;
      }
      cls.sort((a, b) => b.dot - a.dot); // nearest first
      let gi = 0, bi = 0;
      for (const cl of cls) {
        if (!cl.unlit) continue;
        const straggling = cl.unlit <= 2 && cl.unlit < cl.members.length;
        if (few || straggling) {
          for (const o of cl.members) {
            if (o.lit || bi >= SLOT.bulbN) continue;
            this._mark(SLOT.bulb + bi++, o.top, 'bulb', true, true);
          }
        } else if (gi < SLOT.groupN) {
          this._mark(SLOT.group + gi++, W.surface(cl.un, 3.2, _v), cl.unlit > 1 ? 'group' : 'bulb', false, true, 0, cl.unlit);
        }
      }
      if (few) {
        this.pingT -= dt;
        if (this.pingT <= 0) {
          this.pingT = 1.5;
          for (const o of W.lightables) if (!o.lit) this.fx.ring(o.n, W, [1.3, 0.9, 0.25], 0.4, 3.6, 0.9, 0.25);
        }
      }
    }
    this.ui.setMarkers(M, this.camera, g);
  }

  /** Test/attract helper: wander the planet drawing loops round unlit things. */
  _autopilot() {
    const W = this.world, g = this.ghost;
    if (!g.hasHat) {
      g.hatWorld(_v).normalize();
      if (g.hatState === 'stolen' && this.booCool <= 0 && _v.dot(g.p) > Math.cos(8 / CFG.R)) this.boo();
      tangentToward(g.p, _v, _dir);
      return _p2.set(_dir.dot(g.right), _dir.dot(g.u));
    }
    if (!this.apTarget || this.apTarget.lit) {
      let best = null, bd = -2;
      for (const o of W.lightables) if (!o.lit && o.n.dot(g.p) > bd) { bd = o.n.dot(g.p); best = o; }
      this.apTarget = best;
    }
    if (!this.apTarget) return ZERO2;
    const c = this.apTarget.n;
    const d = Math.acos(clamp(g.p.dot(c), -1, 1)) * CFG.R;
    tangentToward(g.p, c, _dir);
    _v.crossVectors(g.p, _dir); // sideways: orbit the target
    const radial = clamp((d - 4.6) / 2.5, -1, 1);
    _dir.multiplyScalar(radial).addScaledVector(_v, 1 - Math.abs(radial) * 0.6).normalize();
    return _p2.set(_dir.dot(g.right), _dir.dot(g.u));
  }

  // ============================================================ camera

  setCam(mode, dur) {
    const c = this.cam;
    c.from.pos.copy(c.pos); c.from.target.copy(c.target); c.from.up.copy(c.up); c.from.fov = c.fov;
    c.mode = mode;
    c.blend = dur > 0 ? 0 : 1;
    c.dur = Math.max(0.001, dur);
  }

  _desired(out) {
    const g = this.ghost, W = this.world, c = this.cam;
    const aspect = this.camera.aspect;
    const tall = clamp((1.3 - aspect) / 0.8); // 0 = landscape, 1 = very tall portrait
    const base = _v.copy(g.p).multiplyScalar(CFG.R + W.heightAt(g.p) + CFG.ghost.hover);
    if (c.mode === 'title') {
      const k = 1 + tall * 0.32;
      out.pos.copy(base).addScaledVector(g.u, -8.0 * k).addScaledVector(g.right, 5.0 * k + Math.sin(this.time * 0.27) * 0.3).addScaledVector(g.p, 1.9 + tall * 1.3 + Math.sin(this.time * 0.4) * 0.15);
      out.target.copy(base).addScaledVector(g.p, 0.3 - tall * 1.05);
      out.up.copy(g.p);
      out.fov = 36;
    } else if (c.mode === 'play') {
      const lenK = clamp((this.garland.maxLen - CFG.garland.startLen) / (CFG.garland.maxLen - CFG.garland.startLen));
      const dist = (25.5 + lenK * 6.5) * (1 + tall * 0.6);
      const pitch = 0.95;
      out.pos.copy(base).addScaledVector(g.p, dist * Math.sin(pitch)).addScaledVector(g.u, -dist * Math.cos(pitch));
      // Look straight at Boo, so he sits dead centre: steering is measured from the middle of the
      // screen and needs the same room in every direction. (The velocity lead only cancels the
      // smoothing lag below; it doesn't push him off-centre.)
      out.target.copy(base).addScaledVector(g.p, 0.3).addScaledVector(g.vel, 0.12);
      out.up.copy(g.p);
      out.fov = this.rush > 0 ? 45.5 : 42; // a sugar rush opens the lens up a touch
    } else {
      // finale: pull right out and drift around the whole glowing planet
      const k = CFG.R / CFG.grow.radius; // a bigger planet needs a longer lens
      const d = 124 * k * (1 + tall * 0.75);
      const lat = 0.62;
      out.pos.set(Math.cos(c.orbit) * Math.cos(lat) * d, Math.sin(lat) * d, Math.sin(c.orbit) * Math.cos(lat) * d);
      out.target.set(0, 15 * k, 0);
      out.up.set(0, 1, 0);
      out.fov = 40;
    }
    return out;
  }

  _camera(dt) {
    const c = this.cam, cam = this.camera;
    if (c.mode === 'finale') c.orbit += dt * 0.11;
    const want = this._desired(c.want);
    if (c.blend < 1) {
      c.blend = Math.min(1, c.blend + dt / c.dur);
      const k = easeInOutCubic(c.blend);
      c.pos.lerpVectors(c.from.pos, want.pos, k);
      c.target.lerpVectors(c.from.target, want.target, k);
      c.up.lerpVectors(c.from.up, want.up, k).normalize();
      c.fov = lerp(c.from.fov, want.fov, k);
    } else {
      const kp = 1 - Math.exp(-(c.mode === 'play' ? 5.5 : 3) * dt);
      const kt = 1 - Math.exp(-(c.mode === 'play' ? 8 : 3) * dt);
      c.pos.lerp(want.pos, kp);
      c.target.lerp(want.target, kt);
      c.up.lerp(want.up, kp).normalize();
      c.fov = lerp(c.fov, want.fov, kp);
    }
    cam.position.copy(c.pos);
    cam.up.copy(c.up);
    if (Math.abs(cam.fov - c.fov) > 0.01) { cam.fov = c.fov; cam.updateProjectionMatrix(); }
    cam.lookAt(c.target);
    // shake
    const s = this.fx.shake * this.fx.shake * (this.calmMotion ? 0.15 : 1);
    if (s > 0.0005) {
      const t = this.time * 43;
      cam.position.x += Math.sin(t * 1.3) * s * 0.9;
      cam.position.y += Math.sin(t * 1.7 + 1) * s * 0.9;
      cam.position.z += Math.sin(t * 2.1 + 2) * s * 0.9;
      cam.rotateZ(Math.sin(t * 0.9) * s * 0.02);
    }
    cam.updateMatrixWorld();

    this.world.fadeGreat(cam.position, this.ghost.pos, c.mode === 'play' ? dt : -1);

    // fog thins out as the camera pulls away, so wide shots stay crisp
    const far = c.mode === 'finale' ? 0.0016 : (c.mode === 'title' ? 0.009 : 0.0105) * this.fogK; // tonight's weather thickens or thins it
    this.scene.fog.density += (far - this.scene.fog.density) * Math.min(1, dt * 1.5);

    // moonlight comes from over the camera's left shoulder
    cam.getWorldDirection(_dir);
    _right.crossVectors(_dir, cam.up).normalize();
    _up.crossVectors(_right, _dir);
    const focus = c.mode === 'finale' ? _v.set(0, 0, 0) : _v.copy(this.ghost.pos);
    if (c.blend < 1 && c.from && c.mode === 'finale') focus.copy(this.ghost.pos).multiplyScalar(1 - easeInOutCubic(c.blend));
    this.key.position.copy(focus).addScaledVector(_dir, -0.35 * 90).addScaledVector(_up, 0.75 * 90).addScaledVector(_right, -0.55 * 90);
    this.key.target.position.copy(focus);
    this.key.target.updateMatrixWorld();
    this.fill.position.copy(focus).addScaledVector(_right, 60).addScaledVector(_up, 14).addScaledVector(_dir, -22);
    this.fill.target.position.copy(focus);
    this.fill.target.updateMatrixWorld();
    const size = c.mode === 'finale' ? Math.round((50 * CFG.R) / CFG.grow.radius) : c.mode === 'title' ? 20 : 36;
    if (size !== this.shadowSize) {
      this.shadowSize = size;
      const sc = this.key.shadow.camera;
      sc.left = -size; sc.right = size; sc.top = size; sc.bottom = -size;
      sc.updateProjectionMatrix();
    }
  }

  // ============================================================ frame

  tick(now) {
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.frame(dt);
    // adaptive quality: if we're well under 45fps for a while, render fewer pixels
    if (!this.paused && !document.hidden) {
      this.perf.acc += dt; this.perf.n++;
      if (this.perf.n >= 100) {
        const avg = this.perf.acc / this.perf.n;
        this.perf.acc = 0; this.perf.n = 0;
        if (avg > 1 / 43 && this.quality > 0.55) { this.quality = Math.max(0.55, this.quality - 0.15); this.resize(); }
      }
    }
  }

  frame(dt) {
    const inp = this.input;
    if (inp.take('any')) this.audio.start();
    if (inp.take('mute')) this.toggleMute();
    if (inp.take('photo')) document.body.classList.toggle('photo');
    if (inp.take('pause')) this.togglePause();
    if (inp.take('globe') && this.state === 'play' && !this.paused) { this.minimap.toggle(); this.audio.ui('click'); }

    if (this.paused) {
      inp.take('boo');
      inp.take('wreath');
      U.uTime.value += dt * 0.2;
      this.render();
      return;
    }
    this.hitStop = Math.max(0, this.hitStop - dt);
    const gdt = this.hitStop > 0 ? dt * 0.1 : dt;
    this.time += gdt;
    U.uTime.value += dt;
    this.update(gdt, dt);
    this.render();
  }

  update(dt, rdt) {
    const g = this.ghost, W = this.world, inp = this.input;
    const playing = this.state === 'play';

    // Pointer steering is measured from the middle of the screen, which is exactly where the play
    // camera holds Boo, so there is the same amount of room to steer in every direction (and camera
    // shake or lag can't feed back into the controls).
    let move = inp.update(window.innerWidth / 2, window.innerHeight / 2);
    if (!playing) move = ZERO2;
    else if (this.autopilot) move = this._autopilot();
    else move = this.wreath.assist(move, g, dt); // the wreath holds Boo to its ring

    // weather: in a blizzard the gusts carry Boo (and the snow) along with them
    const wx = W.params.weather;
    this.gust = wx.gust > 0 && playing ? clamp(Math.sin(this.time * 0.5) * 1.7 - 0.55) : 0; // blowing about a third of the time
    if (this.gust > 0) {
      g.drift.crossVectors(this.windAxis, g.p).multiplyScalar(wx.gust * this.gust);
      // streaks of snow racing past, so you can see which way it is blowing
      if (Math.random() < rdt * 46 * this.gust) {
        _v.copy(g.pos).addScaledVector(g.right, (Math.random() - 0.5) * 30).addScaledVector(g.u, (Math.random() - 0.5) * 22).addScaledVector(g.p, Math.random() * 2.5);
        this.fx.twinkle(_v, [1.5, 1.7, 2.3], 0.26, 0.5, _v2.copy(g.drift).multiplyScalar(9 / Math.max(0.3, g.drift.length())), 0);
      }
    } else g.drift.set(0, 0, 0);
    this.audio.setWind(wx.wind / 26 + this.gust * 0.65);

    if (this.state === 'title') {
      // on the title screen Boo looks straight down the lens
      g.idleFace = (g.idleFace || new THREE.Vector3()).copy(this.cam.pos).sub(g.pos);
    } else g.idleFace = null;
    g.update(dt, this.time, move, this.state === 'title' ? inp.look : null);
    if (g.justGotHat) {
      g.justGotHat = false;
      this.audio.hatOn();
      this.fx.burst(g.headWorld(_v, 1.2), g.p, 18, [[6, 1, 1], [5, 5, 5], [6, 4.5, 1]], { speed: 6, life: 0.7, size: 0.36 });
      this.ui.popup(g.headWorld(_v, 2), 'Phew!', 'note', 1.1);
      this.ui.hint(null);
    }

    if (playing) {
      this.elapsed += dt;
      this.booCool = Math.max(0, this.booCool - dt);
      this.streakT = Math.max(0, this.streakT - dt);
      if (this.streakT <= 0) this.streak = 0;
      if (inp.take('boo')) this.boo();
      if (inp.take('wreath')) this.useWreath();
      const left = this.duration - this.elapsed;
      if (left <= 30 && !this.warned) {
        this.warned = true;
        this.ui.hint('Half past eleven — <b>hurry!</b>', 4);
      }
      if (left <= 10 && left > 0) {
        const s = Math.ceil(left);
        if (s !== this.lastTick) { this.lastTick = s; this.audio.tick(); }
      }
      if (left <= 0) this.finish(false);
    } else if (this.state === 'title') {
      if (inp.take('boo')) this.start();
      inp.take('wreath');
    } else { inp.take('boo'); inp.take('wreath'); }

    this.pickups.update(dt, this.time, playing);
    this._powers(dt);
    // tutorial ring: there until the first loop is closed (or the player clearly doesn't need it)
    if (this.guideOn && (this.seen.loop || this.state !== 'play' || this.elapsed > 45)) this.guideOn = false;
    const ga = this.guideMat.uniforms.uAlpha;
    ga.value += ((this.guideOn ? 1 : 0) - ga.value) * Math.min(1, rdt * 3);
    this.guide.visible = ga.value > 0.01;
    this.garland.update(dt, this.time, g);
    this.humbugs.update(dt, this.time, g, this.garland);
    this.presents.update(dt, this.time, g);
    W.update(dt, this.time);
    this._ambient(dt);
    this._timers(dt);
    this.fx.update(dt, this.camera, this.renderer);
    this._camera(rdt);
    this.sky.update(rdt, this.camera, this.renderer, W.spirit, this.gust);

    // HUD
    if (this.state === 'play') {
      this.ui.setClock(this.elapsed, this.duration);
      this.ui.setBoo(1 - this.booCool / CFG.boo.cooldown);
      this.ui.setStreak(this.streak, this.streakT / STREAK_TIME, 1 + Math.min(this.streak - 1, 8) * 0.25);
      this.ui.setHatArrow(g.hatState !== 'on' && g.hatState !== 'returning' ? g.hatWorld(_v) : null, this.camera, g);
      this._markers(rdt);
      this.minimap.update(rdt, this);
      // say what the globe is for, once, at a moment when no other hint is talking
      if (!this.seen.globe && this.elapsed > (this.seen.loop ? 16 : 40) && !this.ui.hintEl.classList.contains('on')) {
        this.seen.globe = true;
        const bigger = this.touch ? 'Tap it to make it bigger.' : '<kbd>G</kbd> makes it bigger.';
        this.ui.hint(`Your <b>globe</b> shows the whole planet: the pale dots still need lighting. ${bigger}`, 7);
      }
    }
    this.ui.update(rdt, this.camera);

    // post-processing drivers
    const fu = this.final.uniforms;
    fu.uTime.value = U.uTime.value;
    if (this.shockT < 1) {
      this.shockT = Math.min(1, this.shockT + rdt / 0.75);
      _v.copy(g.pos).project(this.camera);
      fu.uShock.value.set(_v.x * 0.5 + 0.5, _v.y * 0.5 + 0.5, this.shockT * 0.85, (1 - this.shockT) * (1 - this.shockT));
    } else fu.uShock.value.w = 0;
    fu.uAberration.value = 0.01 + (this.calmMotion ? 0 : this.fx.shake * 0.1);
    this.flash = Math.max(0, this.flash - rdt * 0.9);
    fu.uFlash.value = this.flash * this.flash;
    const left = this.duration - this.elapsed;
    const danger = playing && left <= 30 ? 0.35 + 0.35 * Math.sin(this.time * (left <= 10 ? 12 : 6)) : 0;
    fu.uDanger.value += (danger - fu.uDanger.value) * Math.min(1, rdt * 6);
    // the whole picture warms up a touch as the planet lights
    this.bloom.strength = this.bloomBase + W.spirit * 0.06 + (this.state === 'finale' ? 0.05 : 0);

    this.audio.update(W.spirit, clamp(g.speed / CFG.ghost.speed), playing && left <= 30 ? 1 : 0);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}

// ------------------------------------------------------------------ boot

let game;
try {
  game = new Game();
} catch (err) {
  console.error(err);
  const f = document.getElementById('fade');
  if (f) f.innerHTML = `<span style="max-width:30em;text-align:center;padding:1em">Boo-mas couldn't start (it needs WebGL 2).<br><small>${String(err && err.message ? err.message : err)}</small></span>`;
}

// A small console API, because you were going to open the dev tools anyway.
if (game) {
  try { sessionStorage.removeItem('boomas.retry'); } catch (_) { /* fine */ } // loaded: forget any reload attempts
  window.boo = {
    game,
    /** Advance the simulation by `seconds` in fixed steps (used by the headless screenshot tests). */
    step(seconds = 1, dt = 1 / 60) {
      const n = Math.max(1, Math.round(seconds / dt));
      for (let i = 0; i < n; i++) {
        const inp = game.input;
        if (game.paused) continue;
        game.time += dt;
        U.uTime.value += dt;
        game.update(dt, dt);
        void inp;
      }
      game.render();
    },
    /** Light a fraction of the planet instantly. boo.light(1) wins the night. */
    light(frac = 1) {
      const W = game.world;
      const want = Math.round(W.lightables.length * frac);
      for (const o of W.lightables) { if (W.litCount >= want) break; W.setLit(o, true); }
      game._spiritChanged();
    },
    bug() { return game.humbugs.spawn(); },
    /** Drop a power-up: 'star', 'wreath' or 'cane'. */
    pickup(kind = 'wreath') { return game.pickups.spawn(kind); },
    autopilot(on = true) { game.autopilot = on; },
    night(n) { game.state = 'title'; game.startNight(n); },
    seed: game.seed,
  };
  console.log(
    '%c  .-.\n (o o)   BOO-MAS\n | O \\   looking for bugs? they\'re called Humbugs here.\n  \\   \\  try: boo.light(0.5)  boo.bug()  boo.pickup(\'wreath\')  boo.night(3)\n   `~~~\'',
    'color:#bfe3ff;font-family:monospace;line-height:1.25'
  );
}
