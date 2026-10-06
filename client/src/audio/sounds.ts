// Procedural sounds (D-176): every cue synthesised with Web Audio, no files. Two building blocks,
// an enveloped tone and a filtered noise burst, make clicks, chimes, buzzes, patter, thumps,
// chirps, croaks and grunts. Each recipe names its bus, how long it lasts (ms, for the voice
// limits) and how much its pitch may vary. The engine plays a recorded file instead when one
// is listed (engine.ts), so any cue can be replaced by a real sound without code.

import type { Bus } from "./engine";

export interface Recipe {
  bus: Bus;
  ms: number;
  /** Pitch variation per play (a share; default 6 %). */
  vary?: number;
  play: (
    ctx: AudioContext,
    out: AudioNode,
    t: number,
    pitch: number,
    noise: AudioBuffer | null,
  ) => void;
}

/** An enveloped oscillator gliding from f0 to f1 over `dur` s. */
function tone(
  ctx: AudioContext,
  out: AudioNode,
  t: number,
  o: {
    type?: OscillatorType;
    f0: number;
    f1?: number;
    dur: number;
    gain: number;
    attack?: number;
    lp?: number;
  },
): void {
  const osc = ctx.createOscillator();
  osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(o.f0, t);
  if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
  const g = ctx.createGain();
  const a = o.attack ?? 0.004;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(o.gain, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  let head: AudioNode = osc;
  if (o.lp) {
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = o.lp;
    osc.connect(f);
    head = f;
  }
  head.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + o.dur + 0.02);
}

/** A noise burst through a filter (its centre gliding from f0 to f1), enveloped over `dur` s. */
function hiss(
  ctx: AudioContext,
  out: AudioNode,
  t: number,
  noise: AudioBuffer | null,
  o: {
    type: BiquadFilterType;
    f0: number;
    f1?: number;
    q?: number;
    dur: number;
    gain: number;
    attack?: number;
  },
): void {
  if (!noise) return;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const f = ctx.createBiquadFilter();
  f.type = o.type;
  f.frequency.setValueAtTime(o.f0, t);
  if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
  f.Q.value = o.q ?? 1;
  const g = ctx.createGain();
  const a = o.attack ?? 0.003;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(o.gain, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  src.connect(f).connect(g).connect(out);
  src.start(t, Math.random() * 1.5);
  src.stop(t + o.dur + 0.02);
}

/** Seeds falling: `grains` tiny noise ticks around `centre` Hz (± `spread`) over 0.35 s. */
function sprinkle(
  ctx: AudioContext,
  out: AudioNode,
  t: number,
  noise: AudioBuffer | null,
  centre: number,
  spread: number,
  grains: number,
  gain: number,
): void {
  for (let i = 0; i < grains; i++) {
    hiss(ctx, out, t + Math.random() * 0.35, noise, {
      type: "bandpass",
      f0: Math.max(200, centre + (Math.random() * 2 - 1) * spread),
      q: 6,
      dur: 0.04,
      gain,
    });
  }
}

/** A drop into water: a sine that rises quickly (a bubble's "bloop"). */
function plop(ctx: AudioContext, out: AudioNode, t: number, f: number, gain: number): void {
  tone(ctx, out, t, { f0: f, f1: f * 2.2, dur: 0.09, gain });
}

export const RECIPES: Record<string, Recipe> = {
  // Interface.
  // A soft, low brown-noise tap (D-179), like a press on felt.
  "ui.click": {
    bus: "ui",
    ms: 80,
    play: (c, o, t, p, n) => {
      hiss(c, o, t, n, {
        type: "lowpass",
        f0: 420 * p,
        f1: 220 * p,
        q: 0.9,
        dur: 0.07,
        gain: 0.55,
      });
      tone(c, o, t, { f0: 150 * p, f1: 110 * p, dur: 0.05, gain: 0.12 });
    },
  },
  "ui.open": {
    bus: "ui",
    ms: 120,
    play: (c, o, t, p) => {
      tone(c, o, t, { f0: 620 * p, dur: 0.06, gain: 0.12 });
      tone(c, o, t + 0.045, { f0: 930 * p, dur: 0.07, gain: 0.1 });
    },
  },
  "ui.unlock": {
    bus: "ui",
    ms: 650,
    vary: 0.02,
    play: (c, o, t, p) => {
      tone(c, o, t, { f0: 660 * p, dur: 0.45, gain: 0.16 });
      tone(c, o, t, { f0: 1320 * p, dur: 0.3, gain: 0.04 });
      tone(c, o, t + 0.09, { f0: 990 * p, dur: 0.55, gain: 0.16 });
      tone(c, o, t + 0.09, { f0: 1980 * p, dur: 0.35, gain: 0.035 });
    },
  },
  "ui.error": {
    bus: "ui",
    ms: 260,
    vary: 0.02,
    play: (c, o, t, p) => {
      tone(c, o, t, { type: "triangle", f0: 230 * p, f1: 190 * p, dur: 0.11, gain: 0.2, lp: 1200 });
      tone(c, o, t + 0.13, {
        type: "triangle",
        f0: 200 * p,
        f1: 165 * p,
        dur: 0.12,
        gain: 0.18,
        lp: 1100,
      });
    },
  },
  "ui.info": {
    bus: "ui",
    ms: 200,
    play: (c, o, t, p) => tone(c, o, t, { f0: 1320 * p, dur: 0.18, gain: 0.08 }),
  },
  "ui.tip": {
    bus: "ui",
    ms: 380,
    play: (c, o, t, p) => {
      tone(c, o, t, { f0: 990 * p, dur: 0.25, gain: 0.07 });
      tone(c, o, t + 0.07, { f0: 1480 * p, dur: 0.3, gain: 0.06 });
    },
  },
  "ui.alert": {
    bus: "ui",
    ms: 420,
    vary: 0.02,
    play: (c, o, t, p) => {
      tone(c, o, t, { type: "sawtooth", f0: 880 * p, dur: 0.16, gain: 0.08, lp: 2200 });
      tone(c, o, t + 0.17, { type: "sawtooth", f0: 660 * p, dur: 0.22, gain: 0.08, lp: 1800 });
    },
  },

  // World events.
  // Planting (D-179): a sprinkle of seeds, high and light for herbs and undergrowth, lower and
  // fuller for shrubs, deep for trees, watery drops for water plants.
  "fx.plant.herb": {
    bus: "fx",
    ms: 420,
    play: (c, o, t, p, n) => sprinkle(c, o, t, n, 4200 * p, 2800, 11, 0.2),
  },
  "fx.plant.shrub": {
    bus: "fx",
    ms: 460,
    play: (c, o, t, p, n) => sprinkle(c, o, t, n, 2300 * p, 1400, 10, 0.22),
  },
  "fx.plant.tree": {
    bus: "fx",
    ms: 520,
    play: (c, o, t, p, n) => {
      sprinkle(c, o, t, n, 1300 * p, 800, 9, 0.24);
      tone(c, o, t, { f0: 140 * p, f1: 90 * p, dur: 0.18, gain: 0.12 });
    },
  },
  "fx.plant.water": {
    bus: "fx",
    ms: 520,
    play: (c, o, t, p) => {
      for (let i = 0; i < 5; i++)
        plop(c, o, t + Math.random() * 0.38, (500 + Math.random() * 500) * p, 0.1);
    },
  },
  // Enemy swarms eating your plants (D-179): crunchy bites, irregular.
  "fx.munch": {
    bus: "fx",
    ms: 700,
    vary: 0.12,
    play: (c, o, t, p, n) => {
      let at = t;
      for (let i = 0; i < 4; i++) {
        hiss(c, o, at, n, {
          type: "bandpass",
          f0: (2600 + Math.random() * 1600) * p,
          q: 3,
          dur: 0.05,
          gain: 0.2,
        });
        hiss(c, o, at + 0.02, n, {
          type: "bandpass",
          f0: (1100 + Math.random() * 600) * p,
          q: 2,
          dur: 0.06,
          gain: 0.12,
        });
        at += 0.12 + Math.random() * 0.08;
      }
    },
  },
  // Water on the map (D-179): a plop, a short trickle.
  "fx.plop": {
    bus: "ambience",
    ms: 300,
    vary: 0.15,
    play: (c, o, t, p) => plop(c, o, t, 700 * p, 0.09),
  },
  "fx.trickle": {
    bus: "ambience",
    ms: 900,
    play: (c, o, t, p, n) => {
      for (let i = 0; i < 8; i++) {
        hiss(c, o, t + i * 0.1 + Math.random() * 0.05, n, {
          type: "bandpass",
          f0: (900 + Math.random() * 900) * p,
          q: 9,
          dur: 0.08,
          gain: 0.07,
        });
      }
    },
  },
  "fx.drop": {
    bus: "fx",
    ms: 320,
    play: (c, o, t, p, n) => {
      tone(c, o, t, { f0: 130 * p, f1: 55 * p, dur: 0.16, gain: 0.3 });
      hiss(c, o, t + 0.02, n, { type: "lowpass", f0: 900, f1: 300, dur: 0.24, gain: 0.12 });
    },
  },
  "fx.order": {
    bus: "fx",
    ms: 70,
    play: (c, o, t, p, n) => {
      tone(c, o, t, { type: "triangle", f0: 900 * p, f1: 700 * p, dur: 0.04, gain: 0.1 });
      hiss(c, o, t, n, { type: "bandpass", f0: 1800, q: 2, dur: 0.03, gain: 0.04 });
    },
  },
  "fx.storm": {
    bus: "fx",
    ms: 1800,
    play: (c, o, t, _p, n) => {
      hiss(c, o, t, n, {
        type: "bandpass",
        f0: 260,
        f1: 1400,
        q: 0.8,
        dur: 0.8,
        gain: 0.35,
        attack: 0.3,
      });
      hiss(c, o, t + 0.7, n, {
        type: "bandpass",
        f0: 1400,
        f1: 220,
        q: 0.8,
        dur: 1,
        gain: 0.3,
        attack: 0.05,
      });
    },
  },
  "fx.spill": {
    bus: "fx",
    ms: 1300,
    play: (c, o, t, _p, n) => {
      hiss(c, o, t, n, { type: "highpass", f0: 2500, dur: 1.2, gain: 0.16, attack: 0.15 });
      tone(c, o, t, { type: "sawtooth", f0: 70, dur: 1, gain: 0.05, lp: 300, attack: 0.2 });
    },
  },
  "fx.caterpillars": {
    bus: "fx",
    ms: 900,
    play: (c, o, t, _p, n) => {
      for (let i = 0; i < 14; i++) {
        hiss(c, o, t + Math.random() * 0.8, n, {
          type: "bandpass",
          f0: 1200 + Math.random() * 1500,
          q: 4,
          dur: 0.05,
          gain: 0.09,
        });
      }
    },
  },

  // Animals, by voice.
  "animal.bird": {
    bus: "fx",
    ms: 380,
    vary: 0.1,
    play: (c, o, t, p) => {
      const notes = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < notes; i++) {
        const f = (2800 + Math.random() * 1400) * p;
        tone(c, o, t + i * 0.085, {
          f0: f,
          f1: f * (1.25 + Math.random() * 0.3),
          dur: 0.06,
          gain: 0.07,
        });
      }
    },
  },
  "animal.woodpecker": {
    bus: "fx",
    ms: 520,
    play: (c, o, t, p, n) => {
      for (let i = 0; i < 7; i++)
        hiss(c, o, t + i * 0.065, n, {
          type: "bandpass",
          f0: 1500 * p,
          q: 5,
          dur: 0.03,
          gain: 0.18,
        });
    },
  },
  "animal.heron": {
    bus: "fx",
    ms: 380,
    play: (c, o, t, p, n) => {
      tone(c, o, t, { type: "sawtooth", f0: 190 * p, f1: 150 * p, dur: 0.3, gain: 0.12, lp: 900 });
      hiss(c, o, t, n, { type: "bandpass", f0: 700, q: 2, dur: 0.28, gain: 0.05 });
    },
  },
  "animal.duck": {
    bus: "fx",
    ms: 330,
    play: (c, o, t, p) => {
      tone(c, o, t, {
        type: "sawtooth",
        f0: 420 * p,
        f1: 330 * p,
        dur: 0.13,
        gain: 0.08,
        lp: 1300,
      });
      tone(c, o, t + 0.16, {
        type: "sawtooth",
        f0: 400 * p,
        f1: 310 * p,
        dur: 0.13,
        gain: 0.07,
        lp: 1200,
      });
    },
  },
  "animal.insect": {
    bus: "fx",
    ms: 420,
    vary: 0.1,
    play: (c, o, t, p, n) => {
      for (let i = 0; i < 6; i++)
        hiss(c, o, t + i * 0.06, n, { type: "highpass", f0: 5200 * p, dur: 0.035, gain: 0.07 });
    },
  },
  "animal.small": {
    bus: "fx",
    ms: 240,
    vary: 0.1,
    play: (c, o, t, p) => {
      tone(c, o, t, { f0: 2100 * p, f1: 2700 * p, dur: 0.07, gain: 0.06 });
      tone(c, o, t + 0.1, { f0: 2300 * p, f1: 2900 * p, dur: 0.06, gain: 0.05 });
    },
  },
  "animal.large": {
    bus: "fx",
    ms: 380,
    vary: 0.08,
    play: (c, o, t, p, n) => {
      tone(c, o, t, {
        type: "sawtooth",
        f0: 95 * p,
        f1: 70 * p,
        dur: 0.28,
        gain: 0.16,
        lp: 420,
        attack: 0.03,
      });
      hiss(c, o, t, n, { type: "lowpass", f0: 600, dur: 0.3, gain: 0.07, attack: 0.04 });
    },
  },
  "animal.hunter": {
    bus: "fx",
    ms: 300,
    vary: 0.08,
    play: (c, o, t, p) => {
      tone(c, o, t, { type: "sawtooth", f0: 560 * p, f1: 360 * p, dur: 0.08, gain: 0.1, lp: 1600 });
      tone(c, o, t + 0.13, {
        type: "sawtooth",
        f0: 520 * p,
        f1: 340 * p,
        dur: 0.08,
        gain: 0.08,
        lp: 1500,
      });
    },
  },
  "animal.howl": {
    bus: "fx",
    ms: 2000,
    vary: 0.05,
    play: (c, o, t, p) => {
      const osc = c.createOscillator();
      const vib = c.createOscillator();
      const depth = c.createGain();
      vib.frequency.value = 5.5;
      depth.gain.value = 9;
      vib.connect(depth).connect(osc.frequency);
      osc.type = "triangle";
      osc.frequency.setValueAtTime(380 * p, t);
      osc.frequency.exponentialRampToValueAtTime(620 * p, t + 0.45);
      osc.frequency.setValueAtTime(620 * p, t + 1.2);
      osc.frequency.exponentialRampToValueAtTime(430 * p, t + 1.8);
      const f = c.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = 1600;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.25);
      g.gain.setValueAtTime(0.12, t + 1.3);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.9);
      osc.connect(f).connect(g).connect(o);
      osc.start(t);
      vib.start(t);
      osc.stop(t + 1.95);
      vib.stop(t + 1.95);
    },
  },
  "animal.frog": {
    bus: "fx",
    ms: 340,
    play: (c, o, t, p) => {
      for (let i = 0; i < 7; i++)
        tone(c, o, t + i * 0.04, { type: "square", f0: 150 * p, dur: 0.03, gain: 0.06, lp: 700 });
    },
  },
  "animal.fish": {
    bus: "fx",
    ms: 320,
    play: (c, o, t, _p, n) =>
      hiss(c, o, t, n, { type: "lowpass", f0: 2400, f1: 300, dur: 0.3, gain: 0.16 }),
  },
};

/** The voice of an animal species (by name and body type), or null for the silent ones (slugs,
 *  worms, fungi). */
export function voiceOf(name: string, body: string | undefined): string | null {
  if (["grasshoppers", "caterpillars", "bark_beetles", "larvae"].includes(name))
    return "animal.insect";
  if (["slugs", "earthworms", "fungi"].includes(name)) return null;
  if (name === "black_woodpecker") return "animal.woodpecker";
  switch (body) {
    case "bird":
      return "animal.bird";
    case "wader":
      return "animal.heron";
    case "duck":
      return "animal.duck";
    case "frog":
      return "animal.frog";
    case "fish":
      return "animal.fish";
    case "canid":
      return name === "wolf" ? "animal.howl" : "animal.hunter";
    case "cat":
      return "animal.hunter";
    case "deer":
    case "stag":
    case "boar":
    case "bison":
    case "bear":
    case "beaver":
      return "animal.large";
    default:
      return "animal.small";
  }
}
