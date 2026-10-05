// Species catalog (D-140): the main menu's "Species" page shows the in-game tech tree outside a
// match. This is the Source it reads: every species unlocked (full-colour cards), nothing on
// any map (zero counts, so no enemy or counter marks), no series.

import {
  cellAt,
  decodeFields,
  REPLAY_VERSION,
  type ReplayMeta,
  type Role,
  type Source,
  type Species,
} from "../replay/replay";

export function catalogSource(species: Species[]): Source {
  const plants = species.filter((s) => s.kind === "flora");
  const animals = species.filter((s) => s.kind === "fauna");
  const meta: ReplayMeta = {
    version: REPLAY_VERSION,
    species,
    counts: [],
    n: 1,
    dt: 0.1,
    ticks: 1,
    field_every: 1,
    builds: [],
    flora: { names: plants.map((s) => s.name), level: plants.map((s) => s.level) },
    fauna: { names: animals.map((s) => s.name), role: animals.map((s) => s.role as Role) },
    series: {},
    log: [],
  };
  const fields = decodeFields(0, new Uint8Array(2 + plants.length), meta);
  const all = new Set(species.map((s) => s.name));
  const src: Source = {
    meta,
    animals: () => [],
    fields: () => fields,
    cell: (tick, row, col) => cellAt(src, tick, row, col),
    counts: () => new Array<number>(species.length).fill(0),
    maxAnimals: () => 0,
    seriesIndex: () => 0,
    unlocked: () => all,
  };
  return src;
}
