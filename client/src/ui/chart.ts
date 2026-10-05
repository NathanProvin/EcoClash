// Chart data for the end-screen curves (D-059, D-138): a long match has tens of thousands of
// samples per line, more than a 520 px plot can show and more than `Math.max(...values)` can take
// as arguments. Sample them down, always keeping the last point, and read non-finite values as 0.

/** Most points drawn per line. */
export const MAX_POINTS = 400;

/** Evenly spaced sample indices of a series of `n` points, the last one included. */
export function sampleIndices(n: number, max = MAX_POINTS): number[] {
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  const step = (n - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => Math.round(i * step));
}

/** `values` at `indices`, non-finite values as 0. */
export function pick(values: readonly number[], indices: readonly number[]): number[] {
  return indices.map((i) => {
    const v = values[i] ?? 0;
    return Number.isFinite(v) ? v : 0;
  });
}

/** The largest value of all series (0 when they are empty or all zero), without spreading them
 *  into arguments. */
export function topValue(series: readonly (readonly number[])[]): number {
  let top = 0;
  for (const s of series) for (const v of s) if (Number.isFinite(v) && v > top) top = v;
  return top;
}
