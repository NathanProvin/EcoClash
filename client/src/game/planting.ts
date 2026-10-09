// Planting check at the cursor (D-242): before the click, how many cells of the planting disc
// the sim would seed, with the checks of `Flora::plantable` on the data the client has. The ring
// turns red when none would take or the bank cannot pay them all. The sim still decides: the
// species' cell cap and the dead-wood bar are left out (rare), so a green ring may still be
// refused.

import type { Fields, Species } from "../replay/replay";
import type { TerrainFrame } from "../render/terrain";

/** Ground classes (terrain.rs). */
const SHALLOW = 1;
const DEEP = 2;
const ROCK = 3;

/** The disc cells around (row, col) that `species` could take for `me`, and whether the bank
 *  pays them all: own land, or free land not locked against `me`; not rock or deep water; soil
 *  at the species' need; its moisture response above 0 (the shallows always seep). */
export function plantable(
  s: Species,
  at: { row: number; col: number },
  radius: number,
  n: number,
  me: number,
  fields: Pick<Fields, "owner" | "soil" | "moisture" | "lock">,
  terrain: Pick<TerrainFrame, "ground"> | undefined,
  bank: number,
): { cells: number; ok: boolean } {
  const { soil_need: need = 0, water: opt, water_tolerance: tol = 0, spawn_cost: cost } = s.stats;
  let cells = 0;
  for (let r = Math.max(at.row - radius, 0); r <= Math.min(at.row + radius, n - 1); r++) {
    for (let c = Math.max(at.col - radius, 0); c <= Math.min(at.col + radius, n - 1); c++) {
      if ((r - at.row) ** 2 + (c - at.col) ** 2 > radius * radius) continue;
      const k = r * n + c;
      const owner = fields.owner[k] ?? 0;
      const barred = (fields.lock?.[2 * k] ?? 0) === me && (fields.lock?.[2 * k + 1] ?? 0) > 0;
      if (owner !== me && (owner !== 0 || barred)) continue;
      const ground = terrain?.ground[k] ?? 0;
      if (ground === ROCK || ground === DEEP) continue;
      if (need > 0 && (fields.soil[k] ?? 0) / 255 <= need) continue;
      const m = fields.moisture?.[k];
      const wet = ground === SHALLOW || m === undefined || !tol || opt === undefined;
      if (!wet && Math.abs((m ?? 0) / 255 - opt) >= tol) continue;
      cells++;
    }
  }
  return { cells, ok: cells > 0 && bank >= cells * cost };
}
