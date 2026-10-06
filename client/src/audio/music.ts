// Music (D-180): soft, sparse, atmospheric, in the spirit of calm ambient game scores. Generated:
// a felt-piano voice (a decaying sine with a touch of harmonics) wanders over slow major-seventh
// chords, with rests, a low note at each chord, and a quiet pad, all through a long reverb.
// The main menu plays it all the time; a match plays a piece now and then, silence between.
// A recorded track replaces it: list "music.menu" or "music.game" in public/audio/manifest.json
// and put public/audio/music.menu.ogg / music.game.ogg next to it.

import { audio } from "./engine";

export type Scene = "menu" | "game" | "off";

/** Chords (MIDI notes), four beats each: Cmaj7, Am9, Fmaj7(#11), G6sus (C major, all soft). */
export const CHORDS: number[][] = [
  [48, 55, 59, 64, 67, 71],
  [45, 52, 59, 60, 64, 67],
  [41, 53, 57, 60, 64, 71],
  [43, 50, 57, 62, 64, 69],
];
/** Under attack (D-185): the same voices over minor chords (Am9, Fmaj7, Dm9, Esus), with a low
 *  pulse, for TENSION_S after the last raid alert. */
export const TENSE: number[][] = [
  [45, 52, 59, 60, 64, 71],
  [41, 48, 57, 60, 64, 69],
  [38, 50, 57, 60, 64, 65],
  [40, 52, 57, 59, 64, 71],
];
const TENSION_S = 45;
const PULSE_S = 1.6;
/** Seconds per chord; a match's pieces last PIECE_S, with GAP_S of silence between. */
const CHORD_S = 9;
const PIECE_S = [120, 170] as const;
const GAP_S = [360, 660] as const;

/** A MIDI note's frequency. */
export const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** The melody notes of a chord: its upper tones, an octave up for some (pure: the generator picks). */
export function melodyOf(chord: readonly number[]): number[] {
  const upper = chord.slice(2);
  return [...upper, ...upper.map((n) => n + 12)].filter((n) => n >= 60 && n <= 84);
}

class Music {
  private scene: Scene = "off";
  private out: GainNode | null = null;
  private wet: ConvolverNode | null = null;
  private timer = 0;
  private chord = 0;
  private chordAt = 0;
  private nextNote = 0;
  /** In a match: when the current piece ends, and when the next starts (context time). */
  private pieceEnd = 0;
  private pieceStart = 0;
  private track: AudioBufferSourceNode | null = null;
  private tenseUntil = 0;
  private nextPulse = 0;

  constructor() {
    audio.whenStarted(() => this.build());
  }

  /** Where we are: the menu (always music), a match (now and then) or off. */
  setScene(scene: Scene): void {
    if (scene === this.scene) return;
    this.scene = scene;
    const ctx = audio.context;
    if (!ctx || !this.out) return;
    this.stopTrack();
    const t = ctx.currentTime;
    // A match opens with a short silence, then its first piece.
    this.pieceStart = scene === "game" ? t + 40 : t;
    this.pieceEnd = scene === "game" ? this.pieceStart + span(PIECE_S) : Infinity;
    this.fade(scene === "menu" ? 1 : 0, 2);
  }

  /** A raid on your land (D-185): in a match, the music turns tense, starting a piece if none
   *  plays. */
  alarm(): void {
    const ctx = audio.context;
    if (!ctx || this.scene !== "game") return;
    const t = ctx.currentTime;
    this.tenseUntil = t + TENSION_S;
    if (t < this.pieceStart || t >= this.pieceEnd) {
      this.pieceStart = t;
      this.chordAt = t; // a new chord at once, from the tense set
    }
    this.pieceEnd = Math.max(this.pieceEnd, this.tenseUntil + 20);
  }

  private build(): void {
    const ctx = audio.context;
    const bus = audio.bus("music");
    if (!ctx || !bus || this.out) return;
    const out = ctx.createGain();
    out.gain.value = 0;
    const dry = ctx.createGain();
    dry.gain.value = 0.45;
    const wet = ctx.createConvolver();
    wet.buffer = impulse(ctx, 4.5);
    const wetGain = ctx.createGain();
    wetGain.gain.value = 0.75;
    const tone = ctx.createBiquadFilter(); // a warm, soft top
    tone.type = "lowpass";
    tone.frequency.value = 2600;
    tone.connect(dry).connect(out);
    tone.connect(wet).connect(wetGain).connect(out);
    out.connect(bus);
    [this.out, this.wet] = [out, wet];
    this.input = tone;
    const scene = this.scene;
    this.scene = "off";
    this.setScene(scene === "off" ? "menu" : scene);
    this.timer = window.setInterval(() => this.tick(), 200);
  }
  private input: AudioNode | null = null;

  private fade(to: number, s: number): void {
    const ctx = audio.context;
    if (!ctx || !this.out) return;
    this.out.gain.setTargetAtTime(to, ctx.currentTime, s / 3);
  }

  /** Schedule notes a little ahead; open and close a match's pieces. */
  private tick(): void {
    const ctx = audio.context;
    if (!ctx || !this.input || ctx.state !== "running" || this.scene === "off") return;
    const t = ctx.currentTime;
    if (this.scene === "game") {
      if (t >= this.pieceEnd) {
        this.fade(0, 6);
        this.pieceStart = t + span(GAP_S);
        this.pieceEnd = this.pieceStart + span(PIECE_S);
        this.stopTrack();
      }
      if (t < this.pieceStart) return;
      if (t < this.pieceStart + 0.3) this.fade(1, 4);
    }
    const file = audio.fileFor(this.scene === "menu" ? "music.menu" : "music.game");
    if (file) {
      this.playTrack(file);
      return;
    }
    const tense = this.scene === "game" && t < this.tenseUntil;
    const set = tense ? TENSE : CHORDS;
    if (tense && t >= this.nextPulse) {
      this.nextPulse = t + PULSE_S;
      this.note(hz((set[this.chord]?.[0] ?? 45) - 12), t + 0.05, 0.1, 1.2);
    }
    if (t >= this.chordAt) {
      this.chord = (this.chord + 1) % set.length;
      this.chordAt = t + CHORD_S;
      const chord = set[this.chord] ?? [];
      this.note(hz((chord[0] ?? 48) - 12), t + 0.05, 0.11, 6);
      this.pad(chord, t + 0.05, CHORD_S + 2);
    }
    if (t >= this.nextNote) {
      const notes = melodyOf(set[this.chord] ?? []);
      const pick = notes[Math.floor(Math.random() * notes.length)];
      if (pick && Math.random() > 0.25) this.note(hz(pick), t + 0.05, 0.09, 4.5);
      if (pick && Math.random() < 0.18)
        this.note(hz(pick + (Math.random() < 0.5 ? 7 : 4)), t + 0.25, 0.05, 4);
      this.nextNote = t + 0.9 + Math.random() * 1.8;
    }
  }

  /** One felt-piano note: a sine and its octave, a soft attack, a long decay. */
  private note(f: number, t: number, gain: number, decay: number): void {
    const ctx = audio.context;
    if (!ctx || !this.input) return;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    for (const [mult, share] of [
      [1, 1],
      [2, 0.18],
      [3, 0.05],
    ] as const) {
      const o = ctx.createOscillator();
      o.frequency.value = f * mult * (1 + (Math.random() - 0.5) * 0.002);
      const s = ctx.createGain();
      s.gain.value = share;
      o.connect(s).connect(g);
      o.start(t);
      o.stop(t + decay + 0.1);
    }
    g.connect(this.input);
    setTimeout(() => g.disconnect(), (decay + 1) * 1000 + (t - ctx.currentTime) * 1000);
  }

  /** A quiet pad on a chord's middle tones: slow in, slow out. */
  private pad(chord: readonly number[], t: number, dur: number): void {
    const ctx = audio.context;
    if (!ctx || !this.input) return;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.025, t + 3);
    g.gain.setValueAtTime(0.025, t + dur - 3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    for (const n of chord.slice(1, 4)) {
      for (const detune of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = "triangle";
        o.frequency.value = hz(n);
        o.detune.value = detune;
        o.connect(g);
        o.start(t);
        o.stop(t + dur + 0.1);
      }
    }
    g.connect(this.input);
    setTimeout(() => g.disconnect(), (dur + 1) * 1000);
  }

  private playTrack(buffer: AudioBuffer): void {
    const ctx = audio.context;
    if (!ctx || !this.out || this.track) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = this.scene === "menu";
    src.connect(this.out);
    src.start();
    src.onended = () => {
      if (this.track === src) this.track = null;
    };
    this.track = src;
  }
  private stopTrack(): void {
    this.track?.stop();
    this.track = null;
  }

  /** Stop the scheduler (teardown). */
  stop(): void {
    window.clearInterval(this.timer);
  }
}

/** A random length within [lo, hi] seconds. */
function span([lo, hi]: readonly [number, number]): number {
  return lo + Math.random() * (hi - lo);
}

/** A stereo reverb tail: decaying noise, `seconds` long (no file needed). */
function impulse(ctx: AudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  }
  return buf;
}

/** The game's music. */
export const music = new Music();
