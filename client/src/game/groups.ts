// Strategic icons (D-078): your animals grouped per species, so a species icon can stand over
// every sizeable group. Animals of one species within a few cells of each other form a group
// (coarse areas, merged with their neighbours). Pure: the HUD feeds it the animals it draws.

import type { Animal } from "../replay/replay";

/** Areas are squares of `area` cells; a group needs `min` animals (`minSwarm` for swarms,
 *  which come in large numbers). */
export const GROUP = { area: 5, min: 3, minSwarm: 8 } as const;

export interface Group {
  /** Fauna species index. */
  species: number;
  count: number;
  /** Centre, in cells (the animals' own units). */
  row: number;
  col: number;
  ids: number[];
}

/** Groups of `me`'s animals, largest first. `swarm[species]` marks swarm species. */
export function strategicGroups(
  animals: readonly Animal[],
  me: number,
  swarm: readonly boolean[],
): Group[] {
  // Per species, the animals of each area.
  const areas = new Map<string, Animal[]>();
  for (const a of animals) {
    if (a.owner !== me) continue;
    const key = `${a.species}:${Math.floor(a.y / GROUP.area)}:${Math.floor(a.x / GROUP.area)}`;
    const list = areas.get(key);
    if (list) list.push(a);
    else areas.set(key, [a]);
  }
  // Merge areas of one species that touch (8-neighbourhood), by flood fill.
  const seen = new Set<string>();
  const out: Group[] = [];
  for (const start of areas.keys()) {
    if (seen.has(start)) continue;
    seen.add(start);
    const [sp, ...rest] = start.split(":").map(Number) as [number, number, number];
    const members: Animal[] = [];
    const todo = [rest];
    while (todo.length) {
      const [ay, ax] = todo.pop() as [number, number];
      members.push(...(areas.get(`${sp}:${ay}:${ax}`) ?? []));
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const key = `${sp}:${ay + dy}:${ax + dx}`;
          if (areas.has(key) && !seen.has(key)) {
            seen.add(key);
            todo.push([ay + dy, ax + dx]);
          }
        }
      }
    }
    if (members.length < (swarm[sp] ? GROUP.minSwarm : GROUP.min)) continue;
    const mean = (f: (a: Animal) => number) =>
      members.reduce((s, a) => s + f(a), 0) / members.length;
    out.push({
      species: sp,
      count: members.length,
      row: mean((a) => a.y),
      col: mean((a) => a.x),
      ids: members.map((a) => a.id),
    });
  }
  return out.sort((p, q) => q.count - p.count);
}
