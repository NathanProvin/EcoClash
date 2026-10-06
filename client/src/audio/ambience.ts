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

/** The weather kind (and phase) as a mood: an alert fades the coming weather in part way. */
export function moodOf(kind: string | null, phase: string): Mood {
  if (!kind || phase === "clear") return "clear";
  return kind === "rain" || kind === "drought" || kind === "flood" ? kind : "clear";
}

class Ambience {
  private beds: Record<"wind" | "rain" | "dry" | "water", GainNode> | null = null;
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
    for (const k of ["wind", "rain", "dry", "water"] as const) {
      this.beds[k].gain.setTargetAtTime(this.level(k) * BED_GAIN[k], t, FADE_S / 3);
    }
  }

  private build(): void {
    const ctx = audio.context;
    const noise = audio.noiseBuffer;
    const bus = audio.bus("ambience");
    if (!ctx || !noise || !bus || this.beds) return;
    const bed = (filter: BiquadFilterType, freq: number, q: number, lfo: number, depth: number) => {
      const src = ctx.createBufferSource();
      src.buffer = noise;
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
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(bus);
      src.start(0, Math.random() * 1.5);
      mod.start();
      return g;
    };
    this.beds = {
      wind: bed("lowpass", 380, 0.6, 0.07, 160),
      rain: bed("bandpass", 2600, 0.5, 0.13, 500),
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
const BED_GAIN = { wind: 0.22, rain: 0.18, dry: 0.12, water: 0.12 } as const;

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
  f.frequency.value = 2000 + Math.random() * 4000;
  f.Q.value = 10;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.06, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
  src.connect(f).connect(g).connect(bus);
  src.start(t, Math.random());
  src.stop(t + 0.04);
}

/** The game's ambience. */
export const ambience = new Ambience();
