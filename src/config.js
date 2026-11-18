// Tunables. Everything gameplay-feel related lives here so it is easy to poke at.
import { RNG } from './utils.js';

export const CFG = {
  // Planet radius in world units. Not a constant: each night's world sets it (see nightParams and
  // World), so everything reads CFG.R at the moment it needs it.
  R: 30,

  // the planet grows a little every night, for the first few
  grow: {
    radius: 30, // night one
    perNight: 2.4,
    steps: 5, // ... so it tops out at 42 on night six
    secondsPerNight: 8, // and midnight comes a little later each time
  },

  ghost: {
    speed: 15,
    accel: 6.5,
    hover: 1.5,
    scale: 1.0,
  },

  garland: {
    spacing: 0.7, // distance between recorded trail points
    startLen: 56, // metres of fairy lights you begin night one with
    maxLen: 140, // the most a string can grow to within a night
    perPresent: 3, // a golden present (from a live catch) is worth twice this
    snap: 1.15, // how close to an old point counts as closing the loop
    minArea: 9, // loops smaller than this just fizzle
  },

  boo: {
    radius: 11.5,
    cooldown: 2.2,
    flipTime: 4.6,
  },

  night: {
    duration: 180, // seconds; one second = one minute on the clock (9PM → midnight)
  },

  humbug: {
    speed: 3.1,
    gnawTime: 4.5,
    firstSpawn: 10,
  },

  // power-ups fall out of the sky one at a time and wait a while to be grabbed
  pickup: {
    first: 20,
    every: 27,
    linger: 22,
  },
  // shooting star: for a few seconds your string is much, much longer
  star: {
    time: 10,
    bonus: 90,
  },
  // wreath: paints the biggest circle your string can close, and holds you to it
  wreath: {
    use: 0.93, // how much of the string the circle uses (the rest is slack for wobbles)
    band: 6.5, // how far off the ring (world units) the pull still reaches
    maxAngle: 1.05, // radians; much bigger and the loop would swallow half the planet
  },
  // candy cane: sugar rush
  cane: {
    time: 9,
    speed: 1.45,
  },

  // what carries over from one night to the next
  progress: {
    keep: 0.4, // fraction of the string you gained tonight that you keep
    lenPerStar: 2, // plus this many metres per star earned
    speedPerStar: 0.03, // +3% flying speed per star earned
    maxSpeed: 1.36,
    maxStartLen: 100,
  },

  // scoring: every bonus that applies multiplies the whole loop, and they stack
  bonus: {
    live: 2, // a Humbug looped while still on its feet …
    liveExtra: 0.5, // … and this much more for each further one
    pack: 0.5, // two or more Humbugs in one loop: +50% per extra Humbug
    circle: 1.5, // closing the wreath's ring
  },

  // HDR bulb colours (linear). Roughly equal luminance so they all bloom.
  bulbColors: [
    [4.2, 0.42, 0.38], // red
    [3.6, 1.9, 0.2], // gold
    [0.3, 3.0, 0.7], // green
    [0.42, 1.25, 4.2], // blue
    [3.7, 0.5, 2.0], // pink
  ],
};

// ------------------------------------------------------------------ biomes & weather
// Every night after the first is somewhere new. A biome is the lie of the land and its colours; the
// weather is what's falling out of the sky, and each kind nudges the rules a little.
// Colours are linear RGB unless they are hex.

export const BIOMES = {
  pines: {
    name: 'Pine Hollow',
    terrain: { amp: 1, freq: 1 },
    mix: { villages: 1, groves: 1, loners: 1, snowmen: 1, lamps: 1, ponds: 2, pondR: [4.6, 6.4] },
    snow: [0.8, 0.87, 1.0], ice: [0.5, 0.8, 0.98], rock: null, tree: [1, 1, 1],
    fog: 0x16245f, ambient: 0x5b74cc, ambientK: 1, key: 0xcfe0ff, fill: 0x7f8cff, atmo: [0.13, 0.3, 1.0],
    sky: [[0.01, 0.03, 0.085], [0.028, 0.034, 0.12], [0.052, 0.022, 0.1]], // top, middle, bottom
    aurora: [[0.08, 1.0, 0.52], [0.05, 0.85, 0.9], [0.42, 0.26, 1.0], [1.0, 0.25, 0.62]], auroraK: 1,
  },
  lakes: {
    name: 'the Frozen Lakes',
    terrain: { amp: 0.5, freq: 0.9 },
    mix: { villages: 1, groves: 0.7, loners: 0.8, snowmen: 1.6, lamps: 1.4, ponds: 7, pondR: [5.2, 8.4] },
    snow: [0.76, 0.9, 1.0], ice: [0.4, 0.78, 1.0], rock: null, tree: [0.86, 1.02, 1.12],
    fog: 0x12306c, ambient: 0x5688d8, ambientK: 1, key: 0xd4ecff, fill: 0x62a6ff, atmo: [0.1, 0.48, 1.0],
    sky: [[0.006, 0.035, 0.09], [0.018, 0.046, 0.13], [0.03, 0.04, 0.11]],
    aurora: [[0.05, 0.95, 0.8], [0.1, 0.7, 1.0], [0.3, 0.42, 1.0], [0.5, 0.92, 1.0]], auroraK: 1.1,
  },
  peaks: {
    name: 'Icicle Peaks',
    terrain: { amp: 1.5, freq: 1.18 },
    mix: { villages: 1, groves: 0.8, loners: 1.25, snowmen: 0.8, lamps: 1, ponds: 1, pondR: [4.4, 5.6] },
    snow: [0.85, 0.9, 1.0], ice: [0.52, 0.76, 1.0], rock: [0.3, 0.38, 0.62], tree: [0.84, 0.95, 1.06],
    fog: 0x1b2466, ambient: 0x6272cc, ambientK: 1, key: 0xdfe8ff, fill: 0x8a84ff, atmo: [0.26, 0.32, 1.0],
    sky: [[0.014, 0.022, 0.09], [0.034, 0.03, 0.125], [0.05, 0.024, 0.1]],
    aurora: [[0.3, 0.5, 1.0], [0.2, 0.82, 1.0], [0.62, 0.3, 1.0], [0.92, 0.4, 1.0]], auroraK: 1.05,
  },
  sugar: {
    name: 'Sugarplum Fields',
    terrain: { amp: 0.8, freq: 1.32 },
    mix: { villages: 1, groves: 0.9, loners: 1.5, snowmen: 1, lamps: 1.5, ponds: 2, pondR: [4.4, 6] },
    snow: [0.96, 0.86, 0.98], ice: [0.76, 0.7, 1.0], rock: null, tree: [1.04, 0.94, 1.06],
    fog: 0x3a2262, ambient: 0x8c6ed2, ambientK: 1, key: 0xffe2f1, fill: 0xb47eff, atmo: [0.5, 0.26, 1.0],
    sky: [[0.03, 0.012, 0.07], [0.06, 0.022, 0.11], [0.08, 0.02, 0.085]],
    aurora: [[1.0, 0.42, 0.72], [1.0, 0.76, 0.36], [0.7, 0.3, 1.0], [1.0, 0.3, 0.52]], auroraK: 1.05,
  },
  dark: {
    name: 'the Long Dark',
    terrain: { amp: 0.65, freq: 0.8 },
    mix: { villages: 1.25, groves: 0.6, loners: 1.4, snowmen: 1.2, lamps: 1.2, ponds: 3, pondR: [4.6, 6.6] },
    snow: [0.7, 0.8, 1.0], ice: [0.42, 0.74, 0.92], rock: null, tree: [0.9, 1, 1],
    fog: 0x0c1740, ambient: 0x3f5aa8, ambientK: 0.82, key: 0xbcd2ff, fill: 0x5a78e0, atmo: [0.08, 0.5, 0.62],
    sky: [[0.004, 0.016, 0.05], [0.012, 0.022, 0.075], [0.02, 0.016, 0.06]],
    aurora: [[0.08, 1.0, 0.52], [0.05, 0.9, 0.7], [0.2, 0.6, 1.0], [0.6, 1.0, 0.5]], auroraK: 1.7,
  },
};

export const WEATHER = {
  flurries: { name: 'Light flurries', note: '', flakes: 1, flakeSize: 1, fall: 1, wind: 0, fog: 1, stars: 1, aurora: 1, gust: 0, bugSpeed: 1, pickups: 1 },
  clear: { name: 'Clear skies', note: 'more falls out of them: power-ups come quicker', flakes: 0.18, flakeSize: 1, fall: 0.8, wind: 0, fog: 0.72, stars: 1.45, aurora: 1.5, gust: 0, bugSpeed: 1, pickups: 0.62 },
  snow: { name: 'Heavy snow', note: 'the Humbugs wade through it slowly', flakes: 2.3, flakeSize: 1.35, fall: 0.7, wind: 1.2, fog: 1.25, stars: 0.5, aurora: 0.7, gust: 0, bugSpeed: 0.82, pickups: 1 },
  blizzard: { name: 'Blizzard', note: 'the gusts will push you about', flakes: 1.9, flakeSize: 1.1, fall: 1.5, wind: 9, fog: 1.45, stars: 0.35, aurora: 0.6, gust: 2.3, bugSpeed: 1, pickups: 1 },
  fog: { name: 'Freezing fog', note: 'you can\'t see far: trust the globe', flakes: 0.5, flakeSize: 1, fall: 0.6, wind: 0.6, fog: 1.75, stars: 0.4, aurora: 0.5, gust: 0, bugSpeed: 1, pickups: 1 },
};

/** Which biome and weather night N gets. Night one is always the classic; after that it depends on the seed. */
function nightPlan(n, seed) {
  if (n <= 1) return { biome: 'pines', weather: 'flurries' };
  const rng = new RNG(seed + ':plan');
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = rng.int(0, i); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const biomes = shuffle(['lakes', 'peaks', 'sugar', 'dark']).concat('pines'); // somewhere new four nights running, then round again
  const weather = shuffle(['clear', 'snow', 'blizzard', 'fog']).concat('flurries');
  return { biome: biomes[(n - 2) % biomes.length], weather: weather[(n - 2) % weather.length] };
}

/** Everything about night N (1-based): how big the planet is, what's on it, how hard it is. */
export function nightParams(n, seed = '') {
  const G = CFG.grow;
  const plan = nightPlan(n, String(seed));
  const biome = BIOMES[plan.biome], weather = WEATHER[plan.weather], mix = biome.mix;
  const step = Math.min(n - 1, G.steps);
  const radius = G.radius + step * G.perNight;
  const area = (radius * radius) / (G.radius * G.radius); // how much more ground there is than on night one
  return {
    biomeKey: plan.biome, weatherKey: plan.weather, biome, weather,
    radius, area,
    duration: CFG.night.duration + step * G.secondsPerNight,
    humbugCap: Math.min(2 + n, 9),
    spawnEvery: Math.max(3.5, 10.5 - n * 1.3),
    humbugSpeed: (CFG.humbug.speed + Math.min(n - 1, 6) * 0.35) * weather.bugSpeed,
    chaser: Math.min(0.75, (n - 1) * 0.22), // chance a humbug hunts you / your string
    // more to light each night, but it grows slower than the ground does: later planets are roomier,
    // which is what the longer string and the extra speed are for
    villages: Math.round(Math.min(3 + Math.floor((n - 1) / 2), 5) * mix.villages),
    groves: Math.round(Math.min(9 + (n - 1), 14) * mix.groves),
    loners: Math.round(10 * Math.sqrt(area) * mix.loners),
    snowmen: Math.round(5 * Math.sqrt(area) * mix.snowmen),
    lamps: Math.round(5 * Math.sqrt(area) * mix.lamps),
    ponds: mix.ponds, pondR: mix.pondR,
    burrows: 4 + (step >= 3 ? 1 : 0),
    lumps: Math.round(70 * area),
  };
}
