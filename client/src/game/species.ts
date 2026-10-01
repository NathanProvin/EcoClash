// Species helpers shared by the UI: display names, glyphs, and tech-tree state at a given time.
// Mirrors the unlock rules of tools/prototype/economy.py (D-029).

import type { ReplayMeta, Source, Species } from "../replay/replay";

/** "tawny_owl" -> "Tawny owl", "lichen_and_moss" -> "Lichen & moss". */
export function label(name: string): string {
  const words = name.replace(/_and_/g, " & ").replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The placeholder shape of a species, as drawn in the 3D view (D-028). */
export function glyph(s: Species): string {
  if (s.kind === "flora") return ["•", "♣", "▲", "■"][s.level - 1] ?? "•";
  return { herbivore: "●", decomposer: "∙", predator: "▲" }[s.role] ?? "●";
}

/** A role as players read it: decomposers are "recyclers" (D-092; the data keeps `decomposer`). */
export function roleName(role: string): string {
  return role === "decomposer" ? "recycler" : role;
}

/** Short tech-tree position, e.g. "L2 · tier 1" or "P3 · tier 1". */
export function position(s: Species): string {
  return `${s.family} · tier ${s.tier}`;
}

/** Species a player has unlocked at tick `tick`: what a live match reports, or, for a replay,
 *  the free species plus the unlocks in its log. */
export function unlockedNow(src: Source, player: number, tick: number): Set<string> {
  return src.unlocked?.(player) ?? unlockedAt(src.meta, player, tick * src.meta.dt);
}

/** Species a player has unlocked at time `t` (seconds): free species plus logged unlocks. */
export function unlockedAt(meta: ReplayMeta, player: number, t: number): Set<string> {
  const out = new Set(meta.species.filter((s) => s.stats.unlock_cost === 0).map((s) => s.name));
  for (const e of meta.log) {
    if (e.player === player && e.t_s <= t && e.what.startsWith("unlock: ")) {
      out.add(e.what.slice("unlock: ".length));
    }
  }
  return out;
}

export type CardState = "unlocked" | "available" | "locked";

/** Whether a species can be unlocked now: one unlocked species on the previous tier of its
 *  family and, for an animal, one unlocked habitat plant (a family name, e.g. "L4" or "W",
 *  means any plant of that family). */
export function cardState(meta: ReplayMeta, s: Species, unlocked: Set<string>): CardState {
  if (unlocked.has(s.name)) return "unlocked";
  const tierOk =
    s.tier === 1 ||
    meta.species.some(
      (o) =>
        o.kind === s.kind && o.family === s.family && o.tier === s.tier - 1 && unlocked.has(o.name),
    );
  const habitatOk =
    s.kind === "flora" ||
    s.habitat.some(
      (h) =>
        unlocked.has(h) ||
        meta.species.some((o) => o.kind === "flora" && o.family === h && unlocked.has(o.name)),
    );
  return tierOk && habitatOk ? "available" : "locked";
}

/** The population cap as shown: a share of the map for plants (D-045), a head count for animals. */
export function capText(s: Species): string {
  return s.kind === "flora"
    ? `${Math.round(s.stats.cap * 100)} % of map`
    : `${s.stats.cap} animals`;
}

/** Family names, in build-bar order (D-087). */
const FAMILY: Record<string, string> = {
  L1: "Herbs",
  L2: "Undergrowth",
  L3: "Shrubs",
  L4: "Trees",
  W: "Water plants",
  D: "Recyclers",
  H1: "Grazers",
  H2: "Undergrowth eaters",
  H3: "Shrub eaters",
  H4: "Tree eaters",
  HW: "Water grazers",
  P1: "Insect eaters",
  P2: "Small hunters",
  P3: "Big hunters",
  PW: "Water hunters",
};
const ORDER = Object.keys(FAMILY);

/** Swarms (D-065): faint dots that show they are there, not units to select or order: soil life
 *  and insects (`swarm` in species.toml). */
export const isSwarm = (s: Species): boolean => s.kind === "fauna" && s.swarm === true;

/** Display name of a family. */
export const familyName = (key: string): string => FAMILY[key] ?? key;

/** The build card's groups (D-063, D-087): plants then animals, one group per family, species
 *  in tier order then stat-sheet order. */
export function families(
  species: Species[],
): { kind: Species["kind"]; key: string; name: string; species: Species[] }[] {
  const out = new Map<
    string,
    { kind: Species["kind"]; key: string; name: string; species: Species[] }
  >();
  const rank = (key: string) => (ORDER.includes(key) ? ORDER.indexOf(key) : ORDER.length);
  const sorted = [...species].sort(
    (a, b) =>
      Number(a.kind === "fauna") - Number(b.kind === "fauna") ||
      rank(a.family) - rank(b.family) ||
      a.tier - b.tier,
  );
  for (const s of sorted) {
    const key = s.family;
    const group = out.get(key) ?? { kind: s.kind, key, name: familyName(key), species: [] };
    group.species.push(s);
    out.set(key, group);
  }
  return [...out.values()];
}

/** The stat lines of a species card's tooltip, in real seconds: the stat sheet counts ecology
 *  seconds, which run at `pace` per real second (D-069). */
export function statLines(s: Species, pace = 1): string[] {
  const { growth, yield: y, spawn_cost: cost } = s.stats;
  const r = (v: number) => Number(v.toPrecision(2));
  return s.kind === "flora"
    ? [
        `Spreads ${r(growth * pace)}/s · yields ${r(y * pace)}/s per cell`,
        `Costs ${cost} per cell · ${capText(s)}`,
      ]
    : [
        `Breeds every ${r(growth / pace)} s · yields ${r(y * pace)}/s`,
        `Costs ${cost} each, ×1.5 off your land · ${capText(s)}`,
      ];
}
