// Audio engine (D-176): one Web Audio graph for the game. Every sound goes through a bus (ui,
// fx for world events, ambience, music) into a master gain and a soft compressor, so stacked
// sounds never clip. The context starts on the first user gesture (browsers start silent),
// sleeps while the tab is hidden, and the volumes are remembered per browser. Sounds are
// procedural recipes (sounds.ts); a recorded file replaces a recipe when public/audio/manifest.json
// lists its id (the file is public/audio/<id>.ogg): the seam for real sounds, like a species
// .webp replaces its silhouette. One manifest request, no probing per sound.

import { RECIPES, type Recipe } from "./sounds";

export type Bus = "ui" | "fx" | "ambience" | "music";
export const BUSES: readonly Bus[] = ["ui", "fx", "ambience", "music"];

export interface Volumes {
  master: number;
  ui: number;
  fx: number;
  ambience: number;
  music: number;
  muted: boolean;
}
export const DEFAULT_VOLUMES: Volumes = {
  master: 0.75,
  ui: 0.9,
  fx: 0.5,
  ambience: 0.4,
  music: 0.4,
  muted: false,
};
const KEY = "ecoclash.audio.v2";

/** Voices playing at once per bus at most, and the shortest gap between two plays of one id. */
export const LIMITS: Record<Bus, number> = { ui: 4, fx: 6, ambience: 8, music: 2 };
const COOLDOWN_MS = 70;

/** A value varied by ±`spread` (a share) from a random `r` in [0, 1): repeats never sound alike. */
export function vary(base: number, spread: number, r: number): number {
  return base * (1 + (r * 2 - 1) * spread);
}

/** Stereo pan (-1 left .. 1 right) for a sound at screen x of a screen `width` wide, kept off the
 *  extremes (headphones). */
export function panFor(x: number, width: number): number {
  const p = (x / Math.max(1, width)) * 2 - 1;
  return Math.max(-0.8, Math.min(0.8, p * 0.8));
}

/** Who may play now: one id not twice within COOLDOWN_MS, and no more than LIMITS voices a bus.
 *  Pure bookkeeping, times in ms. */
export class Gate {
  private last = new Map<string, number>();
  private ends: Record<Bus, number[]> = { ui: [], fx: [], ambience: [], music: [] };

  /** Whether `id` on `bus` may start at `now`; if so, it is booked for `ms`. */
  admit(id: string, bus: Bus, now: number, ms: number, cooldown = COOLDOWN_MS): boolean {
    if (now - (this.last.get(id) ?? -Infinity) < cooldown) return false;
    const live = this.ends[bus].filter((t) => t > now);
    if (live.length >= LIMITS[bus]) {
      this.ends[bus] = live;
      return false;
    }
    this.last.set(id, now);
    this.ends[bus] = [...live, now + ms];
    return true;
  }
}

/** Where a world sound is: its screen point (the viewer's projection) and the screen width. */
export interface Place {
  x: number;
  inView: boolean;
  width: number;
}

export interface PlayOptions {
  /** A world sound's place: panned by screen x, softer off screen. */
  at?: Place | null;
  gain?: number;
  pitch?: number;
  /** Override the per-id cooldown (ms). */
  cooldown?: number;
}

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buses = new Map<Bus, GainNode>();
  private noise: AudioBuffer | null = null;
  private readonly gate = new Gate();
  private readonly files = new Map<string, AudioBuffer | "missing" | "loading">();
  volumes: Volumes = load();
  /** Listeners told when the context starts (ambience beds start with it). */
  private readonly onStart: (() => void)[] = [];

  /** Start (or resume) on a user gesture. Safe to call many times. */
  start(): void {
    if (typeof AudioContext === "undefined") return;
    if (!this.ctx) {
      const ctx = new AudioContext();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      comp.attack.value = 0.004;
      comp.release.value = 0.2;
      const master = ctx.createGain();
      master.connect(comp).connect(ctx.destination);
      for (const b of BUSES) {
        const g = ctx.createGain();
        g.connect(master);
        this.buses.set(b, g);
      }
      // One shared second of white noise: rain, wind, hiss and rustles all filter it.
      const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      [this.ctx, this.master, this.noise] = [ctx, master, noise];
      this.apply();
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) void ctx.suspend();
        else void ctx.resume();
      });
      for (const f of this.onStart) f();
      this.loadManifest(ctx);
    }
    if (this.ctx.state === "suspended" && !document.hidden) void this.ctx.resume();
  }

  /** Run `f` once the context exists (now, or at the first gesture). */
  whenStarted(f: () => void): void {
    if (this.ctx) f();
    else this.onStart.push(f);
  }

  get context(): AudioContext | null {
    return this.ctx;
  }
  get noiseBuffer(): AudioBuffer | null {
    return this.noise;
  }
  bus(b: Bus): GainNode | null {
    return this.buses.get(b) ?? null;
  }

  setVolumes(v: Partial<Volumes>): void {
    this.volumes = { ...this.volumes, ...v };
    save(this.volumes);
    this.apply();
  }

  private apply(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const v = this.volumes;
    const t = ctx.currentTime;
    this.master.gain.setTargetAtTime(v.muted ? 0 : v.master, t, 0.05);
    for (const b of BUSES) this.buses.get(b)?.gain.setTargetAtTime(v[b], t, 0.05);
  }

  /** Play sound `id` (a recipe, or its file when one exists) on its bus. */
  play(id: string, opts: PlayOptions = {}): void {
    const ctx = this.ctx;
    const recipe: Recipe | undefined = RECIPES[id];
    if (!ctx || ctx.state !== "running" || !recipe || this.volumes.muted) return;
    const at = opts.at;
    if (at && !at.inView && recipe.bus === "fx") return; // world sounds off screen: silent
    const now = performance.now();
    if (!this.gate.admit(id, recipe.bus, now, recipe.ms, opts.cooldown)) return;
    const out = ctx.createGain();
    out.gain.value = vary(opts.gain ?? 1, 0.12, Math.random());
    let tail: AudioNode = out;
    if (at) {
      const pan = ctx.createStereoPanner();
      pan.pan.value = panFor(at.x, at.width);
      out.connect(pan);
      tail = pan;
    }
    const bus = this.buses.get(recipe.bus);
    if (!bus) return;
    tail.connect(bus);
    const pitch = vary(opts.pitch ?? 1, recipe.vary ?? 0.06, Math.random());
    const file = this.file(id);
    if (file) {
      const src = ctx.createBufferSource();
      src.buffer = file;
      src.playbackRate.value = pitch;
      src.connect(out);
      src.start();
    } else {
      recipe.play(ctx, out, ctx.currentTime + 0.005, pitch, this.noise);
    }
    // Free the voice once it is done.
    setTimeout(() => tail.disconnect(), recipe.ms + 300);
  }

  /** A recorded file by id, once loaded (music tracks, D-180). */
  fileFor(id: string): AudioBuffer | null {
    return this.file(id);
  }

  /** The recorded file for `id`, once loaded (only ids the manifest lists). */
  private file(id: string): AudioBuffer | null {
    const got = this.files.get(id);
    return got instanceof AudioBuffer ? got : null;
  }

  /** Load the recorded sounds listed in audio/manifest.json (an array of ids), if any. */
  private loadManifest(ctx: AudioContext): void {
    fetch("audio/manifest.json")
      .then((r) => (r.ok ? (r.json() as Promise<unknown>) : []))
      .then((ids) => {
        if (!Array.isArray(ids)) return;
        for (const id of ids) {
          if (typeof id !== "string" || !(RECIPES[id] || id.startsWith("music."))) continue;
          this.files.set(id, "loading");
          fetch(`audio/${id}.ogg`)
            .then((r) => r.arrayBuffer())
            .then((b) => ctx.decodeAudioData(b))
            .then((buf) => this.files.set(id, buf))
            .catch(() => this.files.set(id, "missing"));
        }
      })
      .catch(() => {}); // no manifest (or not JSON): every sound is procedural
  }
}

function load(): Volumes {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_VOLUMES, ...(JSON.parse(raw) as Partial<Volumes>) } : DEFAULT_VOLUMES;
  } catch {
    return DEFAULT_VOLUMES;
  }
}
function save(v: Volumes): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    // blocked site data: the volumes last for this page only
  }
}

/** The game's one audio engine. */
export const audio = new AudioEngine();
