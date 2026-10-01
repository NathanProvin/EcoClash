// Territory frontier lines (D-040, D-099): each player's border is drawn just inside its own
// cells, a solid line in the player's colour (P2's dashes were dropped, D-099). Where a player pushes
// into the enemy cell across the edge, its line widens with that push (D-076), so the fronts
// being won show at a glance. Painted into an RGBA overlay of TEXELS x TEXELS per cell, rows
// flipped like the ground texture (viewer.ts).

export const TEXELS = 8; // per cell side: a texel is CELL / 8 = 0.5 m
export const WIDTH = { min: 1, max: 4 } as const; // line width in texels: 0.5 m .. 2 m

/** Line width (texels) for a push of 0..255 into the cell across the edge. */
export const widthFor = (push: number) =>
  WIDTH.min + Math.round(((WIDTH.max - WIDTH.min) * Math.min(Math.max(push, 0), 255)) / 255);

/** Paint the frontier of both players into `out` ((n * TEXELS)² RGBA texels, cleared first).
 *  `color[p]` is the RGB of player p; `pressure[k]` (optional) is how hard the non-owner pushes
 *  into cell k, 0..255. Map edges are not frontiers. */
export function paintFrontier(
  owner: Uint8Array,
  n: number,
  color: Record<1 | 2, readonly number[]>,
  out: Uint8Array,
  pressure?: Uint8Array,
): void {
  out.fill(0);
  const side = n * TEXELS;
  const put = (x: number, y: number, p: 1 | 2) => {
    const t = ((side - 1 - y) * side + x) * 4;
    const rgb = color[p];
    out[t] = rgb[0] ?? 0;
    out[t + 1] = rgb[1] ?? 0;
    out[t + 2] = rgb[2] ?? 0;
    out[t + 3] = 255;
  };
  const other = (rr: number, cc: number, p: number) =>
    rr >= 0 && rr < n && cc >= 0 && cc < n && owner[rr * n + cc] !== p;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const p = owner[r * n + c];
      if (p !== 1 && p !== 2) continue;
      const [up, down, left, right] = [
        other(r - 1, c, p),
        other(r + 1, c, p),
        other(r, c - 1, p),
        other(r, c + 1, p),
      ];
      if (!(up || down || left || right)) continue; // interior cell
      const [x0, y0] = [c * TEXELS, r * TEXELS];
      // Width toward each side: this player's push into the enemy cell across it.
      const w = (rr: number, cc: number) => {
        const q = rr * n + cc;
        const enemy = rr >= 0 && rr < n && cc >= 0 && cc < n && owner[q] === 3 - p;
        return enemy && pressure ? widthFor(pressure[q] ?? 0) : WIDTH.min;
      };
      const [wu, wd, wl, wr] = [w(r - 1, c), w(r + 1, c), w(r, c - 1), w(r, c + 1)];
      for (let i = 0; i < TEXELS; i++) {
        for (let d = 0; d < WIDTH.max; d++) {
          if (up && d < wu) put(x0 + i, y0 + d, p);
          if (down && d < wd) put(x0 + i, y0 + TEXELS - 1 - d, p);
          if (left && d < wl) put(x0 + d, y0 + i, p);
          if (right && d < wr) put(x0 + TEXELS - 1 - d, y0 + i, p);
        }
      }
    }
  }
}
