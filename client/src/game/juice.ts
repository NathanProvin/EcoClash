// Game feel (D-233): the pure side of the instant feedback. The income pulse sums your cells'
// income per patch; captures play a pentatonic phrase (gains) or sad low notes (losses); the
// biodiversity combo reports its rises and falls; kills are sorted into yours and your losses.
// Everything here is plain data in and out: the overlay and the audio do the showing.

/** The income pulse: every PULSE_MS, one number per PATCH x PATCH cells of your land. */
export const PULSE_MS = 3000;
export const PATCH = 4;
/** Numbers on screen at once, at most (the largest patches win). */
export const MAX_POPS = 40;

/** One income number: a patch's centre (cells) and the points it made over the pulse. */
export interface Pop {
  row: number;
  col: number;
  value: number;
}

/** The pulse's numbers (D-233): each PATCH-square patch with land of `me`, the points its cells
 *  made over `seconds` (income in hundredths of a point per second per cell), largest first. */
export function incomePops(
  owner: ArrayLike<number>,
  income: ArrayLike<number>,
  n: number,
  me: number,
  seconds: number,
): Pop[] {
  const pops: Pop[] = [];
  for (let r0 = 0; r0 < n; r0 += PATCH) {
    for (let c0 = 0; c0 < n; c0 += PATCH) {
      let [sum, cells, rs, cs] = [0, 0, 0, 0];
      for (let r = r0; r < Math.min(n, r0 + PATCH); r++) {
        for (let c = c0; c < Math.min(n, c0 + PATCH); c++) {
          const k = r * n + c;
          if (owner[k] !== me) continue;
          sum += income[k] ?? 0;
          [cells, rs, cs] = [cells + 1, rs + r, cs + c];
        }
      }
      const value = (sum / 100) * seconds;
      if (cells && value > 0) pops.push({ row: rs / cells, col: cs / cells, value });
    }
  }
  return pops.sort((a, b) => b.value - a.value);
}

/** A number's look (D-233): small and light green when low, larger and mossy green when high;
 *  `max` is the largest value of the pulse. */
export function popStyle(value: number, max: number): { scale: number; color: string } {
  const t = Math.min(1, Math.max(0, max > 0 ? value / max : 0));
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
  // Light clear green (#9be37a) to deep moss (#4f7d2e).
  return { scale: 0.8 + 0.7 * t, color: `rgb(${mix(155, 79)}, ${mix(227, 125)}, ${mix(122, 46)})` };
}

/** Cells `me` gained and lost between two owner frames. */
export function captures(
  before: ArrayLike<number>,
  after: ArrayLike<number>,
  me: number,
): { gained: number[]; lost: number[] } {
  const gained: number[] = [];
  const lost: number[] = [];
  for (let k = 0; k < after.length; k++) {
    const [b, a] = [before[k], after[k]];
    if (a === me && b !== me) gained.push(k);
    else if (b === me && a !== me) lost.push(k);
  }
  return { gained, lost };
}

/** Gains climb a major pentatonic scale (semitones from the root, two octaves), so fast
 *  expansion always sounds in tune; losses fall a minor pentatonic, an octave lower. */
export const RISE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21] as const;
export const FALL = [0, -3, -5, -7, -10, -12] as const;

/** A phrase that climbs while notes follow each other, and starts over after a pause. */
export class Phrase {
  private step = 0;
  private last = -Infinity;
  constructor(
    private readonly scale: readonly number[],
    /** Milliseconds of silence that restart the phrase. */
    private readonly rest: number,
  ) {}

  /** The next note (semitones from the root) at time `now` (ms). */
  next(now: number): number {
    if (now - this.last > this.rest) this.step = 0;
    this.last = now;
    const note = this.scale[Math.min(this.step, this.scale.length - 1)] ?? 0;
    this.step = this.step + 1 < this.scale.length ? this.step + 1 : 0; // wrap: a new run
    return note;
  }
}

/** A pitch ratio for a note `semitones` above the root. */
export const ratio = (semitones: number) => 2 ** (semitones / 12);

/** How the combo moved (D-233): "up", "down", or null when it held (to 1/100). */
export function comboChange(before: number, now: number): "up" | "down" | null {
  const [b, a] = [Math.round(before * 100), Math.round(now * 100)];
  return a > b ? "up" : a < b ? "down" : null;
}

/** A kill as `me` sees it (D-233): "won" when your hunter took enemy prey, "lost" when your
 *  animal was taken by the enemy, null otherwise (a hunter culling its own surplus). */
export function killKind(k: { hunter: number; owner: number }, me: number): "won" | "lost" | null {
  if (k.hunter === me && k.owner !== me) return "won";
  if (k.owner === me && k.hunter !== me) return "lost";
  return null;
}
