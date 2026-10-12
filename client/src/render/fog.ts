// Fog of war mask (D-249): per-cell sight upsampled `res` times and box-blurred twice, so the
// edges of the sight circles are smooth curves instead of cell steps. Pure, for the viewer.

/** Texels per cell, and the blur radius in texels. */
export const FOG_RES = 4;
const BLUR = 3;

/** Fog opacity (0..255) per texel, `n * res` a side, rows flipped like the ground texture (row 0
 *  is the grid's last row): `dark` where never seen, `dim` where seen before, clear in sight. */
export function fogMask(
  vis: Uint8Array,
  seen: Uint8Array,
  n: number,
  dark: number,
  dim: number,
  res = FOG_RES,
): Uint8Array {
  const m = n * res;
  let a: Float32Array = new Float32Array(m * m);
  for (let y = 0; y < m; y++) {
    const row = n - 1 - Math.floor(y / res); // flipped
    for (let x = 0; x < m; x++) {
      const k = row * n + Math.floor(x / res);
      a[y * m + x] = vis[k] ? 0 : seen[k] ? dim : dark;
    }
  }
  // Two separable box blurs (running sums) round the corners into near-circles.
  for (let pass = 0; pass < 2; pass++) {
    a = blur(blur(a, m, 1, m), m, m, 1);
  }
  return Uint8Array.from(a, (v) => Math.round(v));
}

/** One box blur of radius BLUR along one axis: `step` between neighbours, `line` between lines. */
function blur(src: Float32Array, m: number, step: number, line: number): Float32Array {
  const out = new Float32Array(src.length);
  for (let l = 0; l < m; l++) {
    const base = l * line;
    let sum = 0;
    let count = 0;
    for (let i = 0; i <= BLUR && i < m; i++) {
      sum += src[base + i * step] ?? 0;
      count++;
    }
    for (let i = 0; i < m; i++) {
      out[base + i * step] = sum / count;
      const add = i + BLUR + 1;
      const drop = i - BLUR;
      if (add < m) {
        sum += src[base + add * step] ?? 0;
        count++;
      }
      if (drop >= 0) {
        sum -= src[base + drop * step] ?? 0;
        count--;
      }
    }
  }
  return out;
}
