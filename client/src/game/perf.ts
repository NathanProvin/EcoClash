// Performance figures (D-198): frame-time statistics for the perf panel and the `?perf=1` bench.
// Pure, so the numbers can be tested; the viewer and App feed it timings.

/** Median, 90th percentile and frames per second of a list of frame times (ms). */
export function frameStats(ms: readonly number[]): { fps: number; median: number; p90: number } {
  if (!ms.length) return { fps: 0, median: 0, p90: 0 };
  const s = [...ms].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
  const total = ms.reduce((a, b) => a + b, 0);
  return { fps: total > 0 ? (1000 * ms.length) / total : 0, median: at(0.5), p90: at(0.9) };
}

/** A smoothed timing per named section (ms per frame, exponential average). */
export class Sections {
  readonly ms: Record<string, number> = {};
  constructor(private readonly keep = 0.9) {}

  add(name: string, ms: number): void {
    const was = this.ms[name];
    this.ms[name] = was === undefined ? ms : was * this.keep + ms * (1 - this.keep);
  }

  /** "name 1.2" pairs, largest first. */
  text(): string {
    return Object.entries(this.ms)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${v.toFixed(1)}`)
      .join(" · ");
  }
}

/** Triangles and draw calls per family of the scene (D-198), main pass, and shadow casters. */
export interface Census {
  family: Record<string, { tris: number; draws: number }>;
  shadowTris: number;
}

/** "herbs 658k/48" pairs, largest first. */
export function censusText(c: Census): string {
  const k = (n: number) => `${Math.round(n / 1000)}k`;
  const rows = Object.entries(c.family)
    .sort((a, b) => b[1].tris - a[1].tris)
    .map(([f, r]) => `${f} ${k(r.tris)}/${r.draws}`);
  return `${rows.join(" · ")} · shadow ${k(c.shadowTris)}`;
}
