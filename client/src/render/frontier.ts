// Territory frontier lines (D-040): each player's border is drawn just inside its own cells, P1
// solid and P2 dashed, so the two sides differ without relying on colour. Painted into an RGBA
// overlay of TEXELS x TEXELS per cell, rows flipped like the ground texture (viewer.ts).

export const TEXELS = 4; // per cell side: the line is one texel (CELL / 4 = 0.5 m) wide
const DASH = 2; // P2 dashes: DASH texels on, DASH off

/** Paint the frontier of both players into `out` ((n * TEXELS)² RGBA texels, cleared first).
 *  `color[p]` is the RGB of player p. Map edges are not frontiers. */
export function paintFrontier(
  owner: Uint8Array,
  n: number,
  color: Record<1 | 2, readonly number[]>,
  out: Uint8Array,
): void {
  out.fill(0);
  const side = n * TEXELS;
  const put = (x: number, y: number, p: 1 | 2, along: number) => {
    if (p === 2 && Math.floor(along / DASH) % 2) return;
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
      for (let i = 0; i < TEXELS; i++) {
        if (up) put(x0 + i, y0, p, x0 + i);
        if (down) put(x0 + i, y0 + TEXELS - 1, p, x0 + i);
        if (left) put(x0, y0 + i, p, y0 + i);
        if (right) put(x0 + TEXELS - 1, y0 + i, p, y0 + i);
      }
    }
  }
}
