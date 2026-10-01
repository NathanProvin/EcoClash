// Territory front lines (D-040, D-099, D-108): a smooth curve, not cell edges. One RGBA texel per
// cell holds each player's ownership and push, blurred twice with a 3 x 3 binomial kernel; the
// ground shader (viewer.ts) draws each player's line in the band just inside its territory where
// its blurred ownership crosses 0.5, widened by its push into the enemy cells across (D-076),
// and glides from one field frame to the next. Rows are flipped like the ground texture.

/** Line width, as a band of blurred ownership above 0.5: no push .. full push (about 0.5 .. 2 m). */
export const BAND = { min: 0.035, max: 0.16 } as const;
const PASSES = 2;
/** The blur dilutes a push that sits in the enemy cells: on a straight front, the line just inside
 *  the attacker's land reads 5/16 of it. The push channels are scaled back by this (D-115), so a
 *  full push draws the full width. */
const PUSH_GAIN = 16 / 5;

/** Fill `out` (n x n RGBA bytes): R = P1 ownership, G = P2 ownership, B = P1's push into P2
 *  cells, A = P2's push into P1 cells (`pressure`: the non-owner's push into each cell, 0..255),
 *  each blurred. Map edges clamp, so a territory reaching the edge draws no line there. */
export function frontierField(
  owner: Uint8Array,
  n: number,
  out: Uint8Array,
  pressure?: Uint8Array,
): void {
  const cells = n * n;
  let [p1, p2, push1, push2] = [0, 0, 0, 0].map(() => new Float32Array(cells)) as [
    Float32Array,
    Float32Array,
    Float32Array,
    Float32Array,
  ];
  for (let k = 0; k < cells; k++) {
    const o = owner[k] ?? 0;
    const push = (pressure?.[k] ?? 0) / 255;
    p1[k] = o === 1 ? 1 : 0;
    p2[k] = o === 2 ? 1 : 0;
    push1[k] = o === 2 ? push : 0; // P1 pushing into a P2 cell
    push2[k] = o === 1 ? push : 0;
  }
  for (let pass = 0; pass < PASSES; pass++) {
    [p1, p2, push1, push2] = [blur(p1, n), blur(p2, n), blur(push1, n), blur(push2, n)];
  }
  const ch = [p1, p2, push1, push2];
  for (let k = 0; k < cells; k++) {
    const t = ((n - 1 - Math.floor(k / n)) * n + (k % n)) * 4; // texture row 0 = grid row n-1
    ch.forEach((c, j) => {
      const v = (c[k] ?? 0) * (j < 2 ? 1 : PUSH_GAIN);
      out[t + j] = Math.round(Math.min(v, 1) * 255);
    });
  }
}

/** One 3 x 3 binomial blur (1 2 1 / 2 4 2 / 1 2 1, over 16), edges clamped. */
function blur(v: Float32Array, n: number): Float32Array {
  const out = new Float32Array(v.length);
  const at = (r: number, c: number) =>
    v[Math.min(Math.max(r, 0), n - 1) * n + Math.min(Math.max(c, 0), n - 1)] ?? 0;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      let s = 4 * at(r, c);
      s += 2 * (at(r - 1, c) + at(r + 1, c) + at(r, c - 1) + at(r, c + 1));
      s += at(r - 1, c - 1) + at(r - 1, c + 1) + at(r + 1, c - 1) + at(r + 1, c + 1);
      out[r * n + c] = s / 16;
    }
  }
  return out;
}
