// Ambience (D-176): looping beds on the ambience bus, crossfaded by the weather. A soft wind and
// sparse birdsong in clear weather, rain and drops in rain, a dry wind and cicadas in drought,
// water and heavy rain in a flood. Birds and insects come closer as the camera does; the main
// menu plays a quieter bed. Fades are slow (seconds), never cuts.

import { audio, vary } from "./engine";

export type Mood = "menu" | "clear" | "rain" | "drought" | "flood";

/** Each bed's level per mood (0..1, times the ambience bus). */
export const MIX: Record<
  Mood,
  { wind: number; rain: number; dry: number; water: number; birds: number; cicadas: number }
> = {
  menu: { wind: 0.35, rain: 0, dry: 0, water: 0, birds: 0.35, cicadas: 0 },
  clear: { wind: 0.4, rain: 0, dry: 0, water: 0, birds: 1, cicadas: 0.3 },
  rain: { wind: 0.35, rain: 0.8, dry: 0, water: 0, birds: 0.15, cicadas: 0 },
  drought: { wind: 0.1, rain: 0, dry: 0.55, water: 0, birds: 0.2, cicadas: 0.8 },
  flood: { wind: 0.4, rain: 1, dry: 0, water: 0.6, birds: 0, cicadas: 0 },
};
const FADE_S = 2.5;

/** The wind's three voices take turns (D-181): one leads, the others stay low; new weights every
 *  25–45 s, crossfaded over WIND_FADE_S. `r1`, `r2` in [0, 1). The weights sum to 1. */
export function windWeights(r1: number, r2: number): [number, number, number] {
  const lead = Math.min(2, Math.floor(r1 * 3));
  const low = [0.15 + 0.2 * r2, 0.15 + 0.2 * (1 - r2)];
  const w = [...low];
  w.splice(lead, 0, 1);
  const sum = w.reduce((a, b) => a + b, 0);
  const [a = 0, b = 0, c = 0] = w;
  return [a / sum, b / sum, c / sum];
}
const WIND_FADE_S = 8;
const WIND_TURN_S = [25, 45] as const;

/** The weather kind (and phase) as a mood: an alert fades the coming weather in part way. */
export function moodOf(kind: string | null, phase: string): Mood {
  if (!kind || phase === "clear") return "clear";
  return kind === "rain" || kind === "drought" || kind === "flood" ? kind : "clear";
}

class Ambience {
  private beds: Record<"wind" | "rain" | "dry" | "water", GainNode> | null = null;
  /** The wind's voices (D-181): the breeze, the low brown gust, the high whistle; their shares. */
  private winds: GainNode[] = [];
  private windShare: [number, number, number] = [1, 0, 0];
  private windTurn = 0;
  private mood: Mood = "menu";
  private share = 1; // of the mood (an alert: part way)
  private near = 0.5; // 0 zoomed out .. 1 close: more birds and insects
  private paused = false;
  private timer = 0;
  /** How alive the land is (D-179): 0 bare soil, birds and insects silent; 1 a grown forest. */
  private life = 1;
  /** Whether the map has water: plops and trickles now and then (D-179). */
  private water = false;

  /** Build the beds once the audio context runs. */
  constructor() {
    audio.whenStarted(() => this.build());
  }

  /** The weather now: its mood, and how far into it (an alert fades it in part way). */
  set(mood: Mood, share = 1): void {
    if (mood === this.mood && share === this.share) return;
    [this.mood, this.share] = [mood, share];
    this.apply();
  }
  /** How close the camera is (0 far .. 1 close). */
  setNear(near: number): void {
    this.near = Math.max(0, Math.min(1, near));
  }
  /** How alive the land is, 0..1 (D-179): birds and insects follow it (the menu ignores it). */
  setLife(life: number): void {
    this.life = Math.max(0, Math.min(1, life));
  }
  /** Whether the map has water (D-179). */
  setWater(on: boolean): void {
    this.water = on;
  }
  /** Paused game: the beds hush. */
  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    this.apply();
  }

  private level(bed: keyof (typeof MIX)["clear"]): number {
    const to = MIX[this.mood][bed];
    const from = MIX.clear[bed];
    const alive = bed === "birds" || bed === "cicadas" ? (this.mood === "menu" ? 1 : this.life) : 1;
    return (this.paused ? 0.25 : 1) * alive * (from + (to - from) * this.share);
  }

  private apply(): void {
    const ctx = audio.context;
    if (!ctx || !this.beds) return;
    const t = ctx.currentTime;
    for (const k of ["rain", "dry", "water"] as const) {
      this.beds[k].gain.setTargetAtTime(this.level(k) * BED_GAIN[k], t, FADE_S / 3);
    }
    this.applyWind(FADE_S);
  }

  private applyWind(fade: number): void {
    const ctx = audio.context;
    if (!ctx) return;
    const wind = this.level("wind") * BED_GAIN.wind;
    this.winds.forEach((g, i) =>
      g.gain.setTargetAtTime(
        wind * (this.windShare[i] ?? 0) * (WIND_TRIM[i] ?? 1),
        ctx.currentTime,
        fade / 3,
      ),
    );
  }

  private build(): void {
    const ctx = audio.context;
    const noise = audio.noiseBuffer;
    const bus = audio.bus("ambience");
    if (!ctx || !noise || !bus || this.beds) return;
    const bed = (
      filter: BiquadFilterType,
      freq: number,
      q: number,
      lfo: number,
      depth: number,
      buffer: AudioBuffer = noise,
      drift = 0, // Hz of a second, slower wander of the centre (gust rhythm, whistle pitch)
    ) => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = filter;
      f.frequency.value = freq;
      f.Q.value = q;
      // A slow swell on the filter: wind gusts, rain waves.
      const mod = ctx.createOscillator();
      mod.frequency.value = lfo;
      const amount = ctx.createGain();
      amount.gain.value = depth;
      mod.connect(amount).connect(f.frequency);
      if (drift) {
        const slow = ctx.createOscillator();
        slow.frequency.value = drift;
        const by = ctx.createGain();
        by.gain.value = freq * 0.25;
        slow.connect(by).connect(f.frequency);
        slow.start();
      }
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(bus);
      src.start(0, Math.random() * 1.5);
      mod.start();
      return g;
    };
    // The wind's voices (D-181). A: the breeze. B: brown noise, low, with two unrelated swells
    // so its gusts never fall into a rhythm. C: a high whistle whose pitch wanders.
    const breeze = bed("lowpass", 380, 0.6, 0.07, 160);
    const gust = bed("lowpass", 200, 0.5, 0.031, 90, brownNoise(ctx), 0.113);
    const whistle = bed("bandpass", 1100, 2.5, 0.17, 220, noise, 0.02);
    this.winds = [breeze, gust, whistle];
    this.beds = {
      wind: breeze,
      rain: bed("lowpass", 1600, 0.5, 0.13, 300), // softer (D-195)
      dry: bed("bandpass", 900, 1.4, 0.05, 300),
      water: bed("lowpass", 520, 0.8, 0.21, 180),
    };
    this.apply();
    // Sparse events over the beds: birds, cicadas, raindrops.
    this.timer = window.setInterval(() => this.events(), 250);
  }

  private events(): void {
    const ctx = audio.context;
    const bus = audio.bus("ambience");
    const noise = audio.noiseBuffer;
    if (!ctx || !bus || !noise || ctx.state !== "running" || this.paused) return;
    const t = ctx.currentTime + 0.02;
    const nearBoost = 0.5 + this.near;
    if (Math.random() < 0.06 * this.level("birds") * nearBoost) chirp(ctx, bus, t);
    if (Math.random() < 0.35 * this.level("cicadas")) cicada(ctx, bus, t, noise);
    if (Math.random() < 0.5 * this.level("rain")) drop(ctx, bus, t, noise);
    // Macro layer (D-185): close to the ground, a wingbeat passes by, a leaf rustles.
    const macro = Math.max(0, this.near - 0.65) / 0.35;
    if (this.mood !== "menu" && macro > 0 && this.life > 0) {
      if (Math.random() < 0.03 * macro * this.life) flyBy(ctx, bus, t, noise);
      if (Math.random() < 0.05 * macro * this.life) rustle(ctx, bus, t, noise);
    }
    if (ctx.currentTime > this.windTurn) {
      const [lo, hi] = WIND_TURN_S;
      this.windTurn = ctx.currentTime + lo + Math.random() * (hi - lo);
      this.windShare = windWeights(Math.random(), Math.random());
      this.applyWind(WIND_FADE_S);
    }
    if (this.water && this.mood !== "menu") {
      const at = { x: Math.random(), inView: true, width: 1 };
      if (Math.random() < 0.035) audio.play("fx.plop", { at, gain: 0.8 });
      if (Math.random() < 0.01) audio.play("fx.trickle", { at, gain: 0.8 });
    }
  }

  /** Stop the event timer (tests, teardown). */
  stop(): void {
    window.clearInterval(this.timer);
  }
}

/** Bed loudness at full level (the noise beds are much louder than the events). */
const BED_GAIN = { wind: 0.22, rain: 0.1, dry: 0.12, water: 0.12 } as const;
/** Each wind voice's trim, so the three sound about as loud (brown noise is quieter, and so is
 *  the whistle's narrow band). */
const WIND_TRIM = [1, 1.8, 0.7];

/** Brown noise: white noise integrated (a random walk, leaking back to 0), 4 s. */
function brownNoise(ctx: AudioContext): AudioBuffer {
  const len = ctx.sampleRate * 4;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let v = 0;
  for (let i = 0; i < len; i++) {
    v = (v + 0.02 * (Math.random() * 2 - 1)) * 0.998;
    d[i] = v * 1.5;
  }
  // Tilt the walk so its end meets its start: the loop has no seam (no click every 4 s).
  const gap = (d[len - 1] ?? 0) - (d[0] ?? 0);
  for (let i = 0; i < len; i++) d[i] = (d[i] ?? 0) - (gap * i) / (len - 1);
  return buf;
}

/** An insect's wings passing the camera: a fluttering buzz that sweeps across. */
function flyBy(ctx: AudioContext, bus: AudioNode, t: number, noise: AudioBuffer): void {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const f = ctx.createBiquadFilter();
  f.type = "bandpass";
  f.Q.value = 6;
  const base = 180 + Math.random() * 160;
  f.frequency.setValueAtTime(base * 1.15, t);
  f.frequency.exponentialRampToValueAtTime(base * 0.85, t + 1.2);
  const wing = ctx.createOscillator(); // the wingbeat flutter
  wing.frequency.value = base;
  const flutter = ctx.createGain();
  flutter.gain.value = 0.04;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.09, t + 0.5);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
  wing.connect(flutter).connect(g.gain);
  const pan = ctx.createStereoPanner();
  const dir = Math.random() < 0.5 ? -1 : 1;
  pan.pan.setValueAtTime(-0.8 * dir, t);
  pan.pan.linearRampToValueAtTime(0.8 * dir, t + 1.2);
  src.connect(f).connect(g).connect(pan).connect(bus);
  src.start(t, Math.random());
  wing.start(t);
  src.stop(t + 1.25);
  wing.stop(t + 1.25);
  setTimeout(() => pan.disconnect(), 2000);
}

/** A leaf rustling near the camera: a few dry crackles. */
function rustle(ctx: AudioContext, bus: AudioNode, t: number, noise: AudioBuffer): void {
  const pan = ctx.createStereoPanner();
  pan.pan.value = Math.random() * 1.4 - 0.7;
  pan.connect(bus);
  for (let i = 0; i < 6; i++) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = 2500 + Math.random() * 2500;
    const g = ctx.createGain();
    const at = t + Math.random() * 0.35;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.03, at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
    src.connect(f).connect(g).connect(pan);
    src.start(at, Math.random());
    src.stop(at + 0.06);
  }
  setTimeout(() => pan.disconnect(), 1000);
}

/** A distant songbird phrase, panned somewhere. */
function chirp(ctx: AudioContext, bus: AudioNode, t: number): void {
  const pan = ctx.createStereoPanner();
  pan.pan.value = Math.random() * 1.6 - 0.8;
  pan.connect(bus);
  const notes = 2 + Math.floor(Math.random() * 4);
  const base = vary(3200, 0.25, Math.random());
  for (let i = 0; i < notes; i++) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const at = t + i * 0.09;
    osc.frequency.setValueAtTime(base * (0.9 + Math.random() * 0.3), at);
    osc.frequency.exponentialRampToValueAtTime(base * (1.2 + Math.random() * 0.4), at + 0.06);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.035, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.07);
    osc.connect(g).connect(pan);
    osc.start(at);
    osc.stop(at + 0.08);
  }
  setTimeout(() => pan.disconnect(), 1000);
}

/** A cicada pulse train. */
function cicada(ctx: AudioContext, bus: AudioNode, t: number, noise: AudioBuffer): void {
  for (let i = 0; i < 5; i++) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 5600;
    f.Q.value = 8;
    const g = ctx.createGain();
    const at = t + i * 0.045;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.05, at + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.03);
    src.connect(f).connect(g).connect(bus);
    src.start(at, Math.random());
    src.stop(at + 0.04);
  }
}

/** One raindrop on a leaf. */
function drop(ctx: AudioContext, bus: AudioNode, t: number, noise: AudioBuffer): void {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const f = ctx.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = 1200 + Math.random() * 2300;
  f.Q.value = 10;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.03, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
  src.connect(f).connect(g).connect(bus);
  src.start(t, Math.random());
  src.stop(t + 0.04);
}

/** The game's ambience. */
export const ambience = new Ambience();
