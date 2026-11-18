// Every sound in the game is synthesised here with WebAudio — no samples.
// The music is a little music-box carol that starts lonely and minor, and as the planet's
// Christmas spirit rises it gains instruments, speeds up, and finally shifts into the major key.

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const TONIC = 392.0; // G4

// 16 bars. Each bar: chord roots (scale degree, 0-based) for its two halves,
// and melody notes as [startEighth, lengthEighths, degree].
const SONG = [
  { ch: [0, 0], mel: [[0, 2, 2], [2, 2, 4], [4, 2, 7], [6, 2, 6]] },
  { ch: [5, 5], mel: [[0, 6, 5], [6, 2, 7]] },
  { ch: [3, 3], mel: [[0, 2, 5], [2, 2, 3], [4, 2, 5], [6, 2, 7]] },
  { ch: [4, 4], mel: [[0, 4, 6], [4, 4, 4]] },
  { ch: [0, 0], mel: [[0, 2, 2], [2, 2, 4], [4, 2, 7], [6, 2, 9]] },
  { ch: [5, 5], mel: [[0, 2, 8], [2, 2, 7], [4, 4, 5]] },
  { ch: [3, 4], mel: [[0, 2, 3], [2, 2, 5], [4, 2, 4], [6, 2, 6]] },
  { ch: [0, 0], mel: [[0, 8, 7]] },
  { ch: [3, 3], mel: [[0, 4, 5], [4, 2, 7], [6, 2, 5]] },
  { ch: [0, 0], mel: [[0, 4, 4], [4, 4, 2]] },
  { ch: [3, 3], mel: [[0, 2, 5], [2, 2, 7], [4, 2, 8], [6, 2, 7]] },
  { ch: [4, 4], mel: [[0, 4, 6], [4, 4, 8]] },
  { ch: [0, 0], mel: [[0, 2, 2], [2, 2, 4], [4, 2, 7], [6, 2, 9]] },
  { ch: [5, 5], mel: [[0, 2, 8], [2, 2, 7], [4, 4, 5]] },
  { ch: [3, 4], mel: [[0, 2, 3], [2, 2, 5], [4, 2, 4], [6, 2, 6]] },
  { ch: [0, 0], mel: [[0, 8, 7]] },
];
const ARP = [0, 2, 4, 7, 4, 2, 4, 7]; // chord-relative steps, in scale degrees

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.spirit = 0;
    this.mode = 'title'; // title | play | finale
    this.major = false;
    this.step = 0;
    this.nextTime = 0;
    this.lastDing = 0;
    this.hurry = 0;
    try { this.muted = localStorage.getItem('boomas.muted') === '1'; } catch (_) { /* private mode */ }
  }

  get ready() {
    return !!this.ctx;
  }

  /** Must be called from a user gesture. Safe to call repeatedly. */
  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.85;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 14; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.22;
    this.master.connect(comp);
    comp.connect(ctx.destination);

    this.music = ctx.createGain();
    this.music.gain.value = 0.0001;
    this.music.connect(this.master);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 1.0;
    this.sfx.connect(this.master);

    // one shared snowy reverb
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(2.8, 2.6);
    const wet = ctx.createGain();
    wet.gain.value = 0.42;
    this.reverb.connect(wet);
    wet.connect(this.master);
    this.musicSend = ctx.createGain(); this.musicSend.gain.value = 0.55;
    this.music.connect(this.musicSend); this.musicSend.connect(this.reverb);
    this.sfxSend = ctx.createGain(); this.sfxSend.gain.value = 0.3;
    this.sfx.connect(this.sfxSend); this.sfxSend.connect(this.reverb);

    // music-box echo
    this.echo = ctx.createDelay(1.0);
    this.echo.delayTime.value = 0.36;
    const fb = ctx.createGain(); fb.gain.value = 0.28;
    const echoOut = ctx.createGain(); echoOut.gain.value = 0.3;
    this.echo.connect(fb); fb.connect(this.echo);
    this.echo.connect(echoOut); echoOut.connect(this.music);

    // noise source material
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // wind bed + a "whoosh" layer that follows the ghost's speed
    this.wind = this._noiseLoop(420, 0.7, 0.028, this.master);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.13;
    const lfoG = ctx.createGain(); lfoG.gain.value = 180;
    lfo.connect(lfoG); lfoG.connect(this.wind.filter.frequency); lfo.start();
    this.whoosh = this._noiseLoop(900, 1.2, 0.0, this.sfx);

    this.nextTime = ctx.currentTime + 0.12;
    this.timer = setInterval(() => this._schedule(), 40);
    this.music.gain.setTargetAtTime(1.05, ctx.currentTime, 1.2);

    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend();
      else { this.ctx.resume(); this.nextTime = this.ctx.currentTime + 0.1; }
    });
  }

  setMuted(m) {
    this.muted = m;
    try { localStorage.setItem('boomas.muted', m ? '1' : '0'); } catch (_) { /* ignore */ }
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.85, this.ctx.currentTime, 0.05);
  }

  setMode(mode) {
    this.mode = mode;
  }

  /** Called every frame with the planet's spirit (0..1) and the ghost's speed (0..1). */
  update(spirit, speed, hurry = 0) {
    this.spirit = spirit;
    this.hurry = hurry;
    if (!this.ctx) return;
    this.whoosh.gain.gain.setTargetAtTime(speed * speed * 0.05, this.ctx.currentTime, 0.12);
    this.whoosh.filter.frequency.setTargetAtTime(500 + speed * 1300, this.ctx.currentTime, 0.12);
  }

  // ------------------------------------------------------------------ building blocks

  _impulse(seconds, decay) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const n = Math.random() * 2 - 1;
        lp += (n - lp) * (0.55 - t * 0.4); // gets darker as it decays
        d[i] = lp * Math.pow(1 - t, decay);
      }
    }
    return buf;
  }

  _noiseLoop(freq, q, gain, dest) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass'; filter.frequency.value = freq; filter.Q.value = q;
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(filter); filter.connect(g); g.connect(dest);
    src.start();
    return { src, filter, gain: g };
  }

  /** One enveloped oscillator. Returns the gain node (for extra routing). */
  _tone(freq, t, { type = 'sine', attack = 0.004, decay = 0.4, gain = 0.2, dest = this.sfx, glideTo = 0, glideTime = 0, detune = 0, vibrato = 0, vibRate = 6 } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(1, freq), t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, glideTo), t + (glideTime || decay));
    if (detune) o.detune.value = detune;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    o.connect(g); g.connect(dest);
    if (vibrato) {
      const l = ctx.createOscillator(); l.frequency.value = vibRate;
      const lg = ctx.createGain(); lg.gain.value = vibrato;
      l.connect(lg); lg.connect(o.frequency);
      l.start(t); l.stop(t + attack + decay + 0.05);
    }
    o.start(t);
    o.stop(t + attack + decay + 0.05);
    return g;
  }

  /** A burst of filtered noise. */
  _noise(t, { freq = 2000, q = 1, type = 'bandpass', attack = 0.002, decay = 0.1, gain = 0.2, dest = this.sfx, sweepTo = 0 } = {}) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + attack + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t, Math.random() * 1.5);
    src.stop(t + attack + decay + 0.05);
  }

  _degFreq(deg, raise7 = false) {
    const scale = this.major ? MAJOR : MINOR;
    const oct = Math.floor(deg / 7);
    const idx = ((deg % 7) + 7) % 7;
    let semi = scale[idx] + oct * 12;
    if (raise7 && !this.major && idx === 6) semi += 1; // harmonic-minor leading tone over the V chord
    return TONIC * Math.pow(2, semi / 12);
  }

  /** Music box / celesta voice. */
  _box(freq, t, gain = 0.16, long = 1.5, dest = this.music) {
    this._tone(freq, t, { gain, decay: long, dest });
    this._tone(freq * 2, t, { gain: gain * 0.28, decay: long * 0.45, dest });
    this._tone(freq * 5.4, t, { gain: gain * 0.07, decay: 0.12, dest });
    // feed the echo
    const e = this._tone(freq, t, { gain: gain * 0.5, decay: long * 0.5, dest: this.echo });
    void e;
  }

  /** Bright bell for lighting things up. */
  _bell(freq, t, gain = 0.2, decay = 1.1, dest = this.sfx) {
    this._tone(freq, t, { gain, decay, dest });
    this._tone(freq * 2.76, t, { gain: gain * 0.3, decay: decay * 0.5, dest });
    this._tone(freq * 5.4, t, { gain: gain * 0.14, decay: decay * 0.22, dest });
    this._tone(freq * 0.5, t, { gain: gain * 0.25, decay: decay * 0.8, dest, type: 'triangle' });
  }

  _sleigh(t, gain) {
    this._noise(t, { freq: 7200, q: 3.5, decay: 0.07, gain, dest: this.music });
    this._tone(4186, t, { gain: gain * 0.2, decay: 0.06, dest: this.music });
    this._tone(5274, t, { gain: gain * 0.14, decay: 0.05, dest: this.music });
  }

  // ------------------------------------------------------------------ sequencer

  _schedule() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    if (this.nextTime < ctx.currentTime - 0.2) this.nextTime = ctx.currentTime + 0.05; // recover after a stall
    while (this.nextTime < ctx.currentTime + 0.2) {
      this._step(this.step, this.nextTime);
      this.nextTime += this._eighth();
      this.step++;
    }
  }

  _bpm() {
    if (this.mode === 'title') return 76;
    if (this.mode === 'finale') return 112;
    return 86 + this.spirit * 20 + this.hurry * 10;
  }

  _eighth() {
    return 30 / this._bpm();
  }

  _step(step, t) {
    const pos = step % 8;
    const barIdx = Math.floor(step / 8) % SONG.length;
    const bar = SONG[barIdx];
    const sp = this.mode === 'title' ? 0 : this.mode === 'finale' ? Math.max(this.spirit, 0.8) : this.spirit;
    const dur = this._eighth();

    // the key change happens on a bar line, with a harp run to carry it
    if (pos === 0) {
      const wantMajor = this.mode !== 'title' && sp >= 0.5;
      if (wantMajor !== this.major) {
        this.major = wantMajor;
        if (wantMajor) this._gliss(t, true);
      }
    }
    const root = bar.ch[pos < 4 ? 0 : 1];
    const raise = root === 4;

    // melody
    for (const [s, len, deg] of bar.mel) {
      if (s !== pos) continue;
      const f = this._degFreq(deg, raise);
      const accent = pos === 0 ? 1.18 : pos === 4 ? 1.06 : 0.9;
      const tt = t + (Math.random() - 0.5) * 0.012; // nobody winds a music box perfectly
      this._box(f, tt, 0.15 * accent, Math.min(2.2, len * dur * 1.5 + 0.5));
      if (sp >= 0.75) this._box(f * 2, tt, 0.05, 0.9); // glockenspiel doubling
    }
    // pad: soft chord, re-struck each half bar
    if (pos === 0 || pos === 4) {
      const g = 0.028 + sp * 0.022;
      for (const k of [0, 2, 4]) {
        const f = this._degFreq(root + k - 7, raise);
        this._tone(f, t, { type: 'triangle', gain: g, attack: 0.35, decay: dur * 4.4, dest: this.music, detune: k * 3 - 4 });
      }
    }
    // bass
    if (sp >= 0.12 && (pos === 0 || pos === 4)) {
      const f = this._degFreq(root + (pos === 4 ? 4 : 0) - 14, raise);
      this._tone(f, t, { type: 'triangle', gain: 0.17, decay: 0.55, dest: this.music });
      this._tone(f * 0.5, t, { gain: 0.1, decay: 0.5, dest: this.music });
    }
    // arpeggio
    if (sp >= 0.3) {
      const f = this._degFreq(root + ARP[pos] - 7, raise);
      this._box(f, t, 0.045 + sp * 0.03, 0.5);
    }
    // sleigh bells
    if (sp >= 0.55) {
      const acc = pos % 2 === 0 ? 1 : 0.55;
      this._sleigh(t, 0.03 * acc * (0.6 + sp * 0.6));
      if (sp >= 0.8) this._sleigh(t + dur * 0.5, 0.012);
    }
    // soft heartbeat drum once things get merry
    if (sp >= 0.68 && (pos === 0 || pos === 4)) {
      this._tone(110, t, { gain: 0.22, decay: 0.16, glideTo: 46, dest: this.music });
    }
    if (this.hurry > 0 && pos % 2 === 0) {
      this._tone(1568, t, { gain: 0.02 * this.hurry, decay: 0.05, dest: this.music, type: 'square' });
    }
  }

  _gliss(t, up) {
    for (let i = 0; i < 12; i++) {
      const deg = up ? i : 11 - i;
      this._box(this._degFreq(deg), t + i * 0.055, 0.07, 0.8);
    }
    this._noise(t, { freq: 5000, q: 0.7, attack: 0.5, decay: 0.9, gain: 0.05, dest: this.music, type: 'highpass' });
  }

  // ------------------------------------------------------------------ sound effects

  _now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /** i-th note of a rising run; used as things light up one after another. */
  ding(i = 0) {
    if (!this.ctx) return;
    const t = Math.max(this._now(), this.lastDing + 0.03);
    this.lastDing = t;
    const pent = this.major ? [0, 1, 2, 4, 5] : [0, 2, 3, 4, 6]; // major / minor pentatonic, as scale degrees
    const k = Math.min(i, 14);
    const d = pent[k % 5] + Math.floor(k / 5) * 7;
    this._bell(this._degFreq(d + 7), t, 0.2, 1.0);
  }

  loopClose(count) {
    if (!this.ctx) return;
    const t = this._now();
    this._noise(t, { freq: 500, sweepTo: 4200, q: 1.2, attack: 0.03, decay: 0.32, gain: 0.16 });
    this._tone(this._degFreq(0), t, { gain: 0.12, decay: 0.5, type: 'triangle' });
    if (count >= 5) {
      for (let i = 0; i < 6; i++) this._tone(1800 + Math.random() * 3200, t + 0.05 + i * 0.05, { gain: 0.035, decay: 0.3 });
    }
  }

  fizzle() {
    if (!this.ctx) return;
    const t = this._now();
    this._tone(620, t, { gain: 0.15, decay: 0.16, glideTo: 240, type: 'triangle' });
    this._noise(t, { freq: 3000, decay: 0.09, gain: 0.07 });
  }

  boo() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = this._now();
    // "b": a soft thump
    this._tone(170, t, { gain: 0.42, decay: 0.2, glideTo: 52 });
    // "oo": a sawtooth through two formants, pitch swooping down, with a wobble
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(620, t + 0.02);
    o.frequency.exponentialRampToValueAtTime(700, t + 0.09);
    o.frequency.exponentialRampToValueAtTime(250, t + 0.55);
    const vib = ctx.createOscillator(); vib.frequency.value = 9;
    const vg = ctx.createGain(); vg.gain.value = 16;
    vib.connect(vg); vg.connect(o.frequency);
    const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 340; f1.Q.value = 5;
    const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 780; f2.Q.value = 7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9, t + 0.05);
    g.gain.setValueAtTime(0.9, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.62);
    const g2 = ctx.createGain(); g2.gain.value = 0.55;
    o.connect(f1); o.connect(f2); f1.connect(g); f2.connect(g2); g2.connect(g); g.connect(this.sfx);
    o.start(t); vib.start(t); o.stop(t + 0.7); vib.stop(t + 0.7);
    // the shockwave
    this._noise(t + 0.05, { freq: 1400, sweepTo: 160, q: 0.8, attack: 0.02, decay: 0.55, gain: 0.3 });
    this._tone(88, t + 0.05, { gain: 0.3, decay: 0.5, glideTo: 36 });
  }

  booNotReady() {
    if (!this.ctx) return;
    this._tone(180, this._now(), { gain: 0.05, decay: 0.07, type: 'square' });
  }

  bah() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = this._now();
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(210, t);
    o.frequency.exponentialRampToValueAtTime(120, t + 0.2);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    o.connect(f); f.connect(g); g.connect(this.sfx);
    o.start(t); o.stop(t + 0.3);
  }

  flip(delay = 0) {
    if (!this.ctx) return;
    const t = this._now() + delay;
    this._tone(260, t, { gain: 0.24, decay: 0.28, glideTo: 720, glideTime: 0.12, type: 'triangle', vibrato: 30, vibRate: 22 });
  }

  wrap() {
    if (!this.ctx) return;
    const t = this._now();
    for (let i = 0; i < 4; i++) this._noise(t + i * 0.035, { freq: 3200 + i * 500, q: 2, decay: 0.035, gain: 0.13 });
    this._tone(420, t + 0.08, { gain: 0.1, decay: 0.16, glideTo: 1700, type: 'triangle' });
    this._tone(1175, t + 0.24, { gain: 0.14, decay: 0.2 });
    this._noise(t + 0.24, { freq: 1500, decay: 0.05, gain: 0.12 });
  }

  present() {
    if (!this.ctx) return;
    const t = this._now();
    this._bell(this._degFreq(11), t, 0.17, 0.35);
    this._bell(this._degFreq(14), t + 0.07, 0.2, 0.6);
  }

  snip() {
    if (!this.ctx) return;
    const t = this._now();
    this._noise(t, { freq: 6000, q: 1, decay: 0.03, gain: 0.25, type: 'highpass' });
    this._tone(980, t + 0.02, { gain: 0.22, decay: 0.24, glideTo: 170, type: 'triangle' });
    this._tone(this._degFreq(9), t + 0.1, { gain: 0.07, decay: 0.2 });
    this._tone(this._degFreq(7), t + 0.22, { gain: 0.07, decay: 0.3 });
  }

  pop(i = 0) {
    if (!this.ctx) return;
    this._tone(900 + i * 60, this._now() + i * 0.02, { gain: 0.06, decay: 0.05, glideTo: 400 });
  }

  hatOff() {
    if (!this.ctx) return;
    const t = this._now();
    this._tone(1150, t, { gain: 0.17, decay: 0.6, glideTo: 240, glideTime: 0.55, vibrato: 14, vibRate: 11 });
    this._tone(210, t, { gain: 0.3, decay: 0.16, glideTo: 70 });
    this._noise(t, { freq: 900, decay: 0.1, gain: 0.2 });
  }

  hatOn() {
    if (!this.ctx) return;
    const t = this._now();
    this._tone(380, t, { gain: 0.14, decay: 0.3, glideTo: 1250, glideTime: 0.2 });
    this._bell(this._degFreq(7), t + 0.2, 0.16, 0.7);
    this._bell(this._degFreq(11), t + 0.29, 0.14, 0.9);
  }

  unlight() {
    if (!this.ctx) return;
    const t = this._now();
    this._tone(this._degFreq(9), t, { gain: 0.18, decay: 0.2, type: 'triangle' });
    this._tone(this._degFreq(6), t + 0.13, { gain: 0.18, decay: 0.35, type: 'triangle', glideTo: this._degFreq(5) });
    this._noise(t + 0.1, { freq: 800, sweepTo: 200, decay: 0.3, gain: 0.07 });
  }

  gnaw() {
    if (!this.ctx) return;
    this._noise(this._now(), { freq: 2100 + Math.random() * 900, q: 4, decay: 0.03, gain: 0.09 });
  }

  bugSpawn() {
    if (!this.ctx) return;
    const t = this._now();
    this._tone(140, t, { gain: 0.14, decay: 0.2, glideTo: 380, glideTime: 0.1, type: 'triangle' });
    this._noise(t, { freq: 600, decay: 0.12, gain: 0.1 });
  }

  snowball() {
    if (!this.ctx) return;
    this._noise(this._now(), { freq: 900, sweepTo: 2200, q: 0.9, decay: 0.2, gain: 0.12 });
  }

  splat() {
    if (!this.ctx) return;
    const t = this._now();
    this._noise(t, { freq: 700, q: 0.7, decay: 0.14, gain: 0.22, type: 'lowpass' });
    this._tone(150, t, { gain: 0.14, decay: 0.1, glideTo: 60 });
  }

  tier(i) {
    if (!this.ctx) return;
    const t = this._now();
    [0, 2, 4, 7].forEach((d, k) => this._bell(this._degFreq(d + 7 + i), t + k * 0.07, 0.11, 1.3));
  }

  ui(kind = 'hover') {
    if (!this.ctx) return;
    const t = this._now();
    if (kind === 'hover') this._tone(1320, t, { gain: 0.05, decay: 0.05 });
    else { this._bell(1047, t, 0.09, 0.35); this._bell(1568, t + 0.06, 0.09, 0.5); }
  }

  tick() {
    if (!this.ctx) return;
    this._tone(1760, this._now(), { gain: 0.05, decay: 0.05, type: 'square' });
  }

  /** The midnight bell. */
  toll(delay = 0, gain = 0.3) {
    if (!this.ctx) return;
    const t = this._now() + delay;
    const f0 = 130.8;
    const parts = [[0.5, 0.5, 5], [1, 1, 4.2], [1.19, 0.55, 3], [1.56, 0.4, 2.4], [2, 0.6, 2.8], [2.51, 0.3, 1.8], [3.01, 0.22, 1.3], [4.1, 0.12, 0.8]];
    for (const [r, a, d] of parts) this._tone(f0 * r, t, { gain: gain * a, decay: d, attack: 0.006 });
    this._noise(t, { freq: 2400, decay: 0.05, gain: gain * 0.25 });
  }

  whistle(delay = 0) {
    if (!this.ctx) return;
    const t = this._now() + delay;
    this._tone(500, t, { gain: 0.055, decay: 0.7, glideTo: 2300, glideTime: 0.7 });
  }

  bang(power = 1) {
    if (!this.ctx) return;
    const t = this._now();
    this._tone(120, t, { gain: 0.32 * power, decay: 0.35, glideTo: 38 });
    this._noise(t, { freq: 1100, sweepTo: 180, q: 0.5, decay: 0.5, gain: 0.26 * power, type: 'lowpass' });
    for (let i = 0; i < 9; i++) this._noise(t + 0.12 + Math.random() * 0.6, { freq: 4500 + Math.random() * 4000, q: 3, decay: 0.03, gain: 0.05 });
  }

  /** A humbug makes off with the hat: a cheeky little run. */
  steal() {
    if (!this.ctx) return;
    const t = this._now();
    [0, 2, 1, 3, 2, 4].forEach((d, i) => this._tone(this._degFreq(d + 7), t + i * 0.055, { gain: 0.12, decay: 0.07, type: 'square' }));
  }

  /** A shooting star comes down. */
  starFall() {
    if (!this.ctx) return;
    const t = this._now();
    this._tone(2600, t, { gain: 0.09, decay: 1.2, glideTo: 520, glideTime: 1.2, vibrato: 30, vibRate: 13 });
    this._noise(t, { freq: 6000, sweepTo: 1500, q: 1.5, attack: 0.3, decay: 0.9, gain: 0.05 });
  }

  starLand() {
    if (!this.ctx) return;
    const t = this._now();
    [14, 11, 9, 7].forEach((d, i) => this._bell(this._degFreq(d), t + i * 0.05, 0.13, 1.4));
    this._tone(150, t, { gain: 0.25, decay: 0.3, glideTo: 50 });
  }

  /** Star power! A rushing run up the scale. */
  starPower() {
    if (!this.ctx) return;
    const t = this._now();
    const pent = this.major ? [0, 1, 2, 4, 5] : [0, 2, 3, 4, 6];
    for (let i = 0; i < 12; i++) this._bell(this._degFreq(pent[i % 5] + Math.floor(i / 5) * 7 + 7), t + i * 0.045, 0.14, 0.9);
    this._noise(t, { freq: 3000, sweepTo: 9000, q: 0.8, attack: 0.25, decay: 0.7, gain: 0.08, type: 'highpass' });
  }

  /** How hard it is blowing: 0 = the usual night air, 1 = a full gust in a blizzard. */
  setWind(k) {
    if (!this.ctx) return;
    this.wind.gain.gain.setTargetAtTime(0.028 + k * 0.11, this.ctx.currentTime, 0.35);
  }

  /** Somewhere, a Humbug has started on the lights: a small uh-oh, not too often. */
  nibble() {
    if (!this.ctx) return;
    const t = this._now();
    if (t - (this.lastNibble || -9) < 2.5) return;
    this.lastNibble = t;
    this._tone(this._degFreq(8), t, { gain: 0.07, decay: 0.16, type: 'triangle' });
    this._tone(this._degFreq(7) * 0.94, t + 0.13, { gain: 0.08, decay: 0.3, type: 'triangle' });
  }

  /** Stacked bonuses: one bright bell per bonus, climbing. */
  bonus(n = 1) {
    if (!this.ctx) return;
    const t = this._now() + 0.14;
    const pent = this.major ? [0, 1, 2, 4, 5] : [0, 2, 3, 4, 6];
    const notes = Math.min(n, 4) + 2;
    for (let i = 0; i < notes; i++) {
      const k = i * 2;
      this._bell(this._degFreq(pent[k % 5] + Math.floor(k / 5) * 7 + 14), t + i * 0.085, 0.15, 1.3);
    }
    this._noise(t, { freq: 5000, sweepTo: 9000, q: 0.9, attack: 0.05, decay: 0.5, gain: 0.05, type: 'highpass' });
  }

  /** Sugar rush: a quick fizz upward. */
  rush() {
    if (!this.ctx) return;
    const t = this._now();
    this._tone(300, t, { gain: 0.14, decay: 0.5, glideTo: 1500, glideTime: 0.45, type: 'sawtooth' });
    this._noise(t, { freq: 1200, sweepTo: 8000, q: 1.4, attack: 0.04, decay: 0.55, gain: 0.09 });
  }

  powerEnd() {
    if (!this.ctx) return;
    const t = this._now();
    [9, 7, 5].forEach((d, i) => this._tone(this._degFreq(d + 7), t + i * 0.08, { gain: 0.1, decay: 0.2, type: 'triangle' }));
  }

  /** Everything is lit: a short fanfare in the (by now major) key. */
  fanfare() {
    if (!this.ctx) return;
    this.major = true;
    const t = this._now();
    const run = [0, 2, 4, 7, 9, 11, 14];
    run.forEach((d, i) => this._bell(this._degFreq(d + 7), t + i * 0.085, 0.16, 1.6));
    [0, 4, 7, 9].forEach((d) => this._bell(this._degFreq(d + 7), t + 0.75, 0.15, 2.6));
    this._noise(t + 0.7, { freq: 6000, q: 0.6, attack: 0.02, decay: 1.4, gain: 0.07, type: 'highpass' });
  }

  sad() {
    if (!this.ctx) return;
    const t = this._now();
    [9, 8, 7, 5].forEach((d, i) => this._box(this._degFreq(d), t + i * 0.24, 0.16, 1.2, this.sfx));
  }
}
