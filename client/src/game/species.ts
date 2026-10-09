// Species helpers shared by the UI: display names and tech-tree state at a given time.
// Mirrors the unlock rules of tools/prototype/economy.py (D-029).

import type { ReplayMeta, Source, Species } from "../replay/replay";

/** "tawny_owl" -> "Tawny owl", "lichen_and_moss" -> "Lichen & moss". */
export function label(name: string): string {
  const words = name.replace(/_and_/g, " & ").replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** What `s` feeds on (D-122), primary first; a family name stands for its plants. Recyclers
 *  eat dead biomass, which is no species: none. */
export function foodsOf(s: Species, all: readonly Species[]): Species[] {
  return s.eats.flatMap((e) =>
    all.filter((o) => o.name === e || (o.kind === "flora" && o.family === e)),
  );
}

/** Who feeds on `s`, and the rank `s` has in each diet (0: their primary food). */
export function eatersOf(s: Species, all: readonly Species[]): { s: Species; rank: number }[] {
  return all.flatMap((o) => {
    const rank = o.eats.findIndex((e) => e === s.name || (s.kind === "flora" && e === s.family));
    return rank < 0 ? [] : [{ s: o, rank }];
  });
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

/** The plants that make an animal's habitat (D-172): its habitat lists plant names or plant
 *  families ("L3": any shrub), resolved to the plant species. */
export function habitatPlants(s: Species, all: readonly Species[]): Species[] {
  return all.filter(
    (o) => o.kind === "flora" && s.habitat.some((h) => h === o.name || h === o.family),
  );
}

/** Names as a choice: "Elder", "Elder or Hazel", "Elder, Hawthorn or Hazel". */
export function orList(names: readonly string[]): string {
  return names.length < 2
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

/** What a locked card still needs (D-172): the previous tier, and an animal's habitat plants
 *  by name. */
export function lockText(s: Species, all: readonly Species[]): string {
  const parts = s.tier > 1 ? [`tier ${s.tier - 1}`] : [];
  if (s.kind === "fauna" && s.habitat.length)
    parts.push(orList(habitatPlants(s, all).map((o) => label(o.name))));
  return `${parts.join(" + ")} first`;
}

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

/** Family names, in build-bar order (D-087, D-105): land plants, land animals, the water
 *  families together, then the recyclers at the far right. */
const FAMILY: Record<string, string> = {
  L1: "Herbs",
  L2: "Undergrowth",
  L3: "Shrubs",
  L4: "Trees",
  H1: "Grazers",
  H2: "Undergrowth eaters",
  H3: "Shrub eaters",
  H4: "Tree eaters",
  P1: "Insect eaters",
  P2: "Small hunters",
  P3: "Big hunters",
  S: "Superpredators",
  W: "Water plants",
  HW: "Water grazers",
  PW: "Water hunters",
  D: "Recyclers",
};

/** Build-bar sections (D-105): a separator stands between two. */
export type Section = "plants" | "animals" | "water" | "recyclers";
export function sectionOf(family: string, kind: Species["kind"]): Section {
  if (family === "W" || family === "HW" || family === "PW") return "water";
  if (family === "D") return "recyclers";
  return kind === "flora" ? "plants" : "animals";
}
const ORDER = Object.keys(FAMILY);

/** Swarms (D-065): faint dots, soil life and insects (`swarm` in species.toml). They are selected
 *  from the unit list or their strategic icon, not by clicking a dot (D-238). */
export const isSwarm = (s: Species): boolean => s.kind === "fauna" && s.swarm === true;

/** Where a plant grows best, from its water optimum (D-239); undefined for animals. */
export function groundOf(s: Species): string | undefined {
  const w = s.stats.water;
  if (s.kind !== "flora" || w === undefined) return undefined;
  if (w >= 0.85) return "Grows in water";
  if (w >= 0.75) return "Grows best on wet ground";
  if (w > 0.55) return "Grows best on moist ground";
  if (w < 0.45) return "Grows best on dry ground";
  return "Grows on most ground";
}

/** Display name of a family. */
export const familyName = (key: string): string => FAMILY[key] ?? key;

export interface Family {
  kind: Species["kind"];
  key: string;
  name: string;
  section: Section;
  species: Species[];
}

/** The build bar's groups (D-063, D-087, D-105): one per family, in bar order (unknown families
 *  last), species in tier order then stat-sheet order. */
export function families(species: Species[]): Family[] {
  const out = new Map<string, Family>();
  const rank = (key: string) => (ORDER.includes(key) ? ORDER.indexOf(key) : ORDER.length);
  const sorted = [...species].sort(
    (a, b) =>
      rank(a.family) - rank(b.family) ||
      Number(a.kind === "fauna") - Number(b.kind === "fauna") ||
      a.tier - b.tier,
  );
  for (const s of sorted) {
    const key = s.family;
    const group = out.get(key) ?? {
      kind: s.kind,
      key,
      name: familyName(key),
      section: sectionOf(key, s.kind),
      species: [],
    };
    group.species.push(s);
    out.set(key, group);
  }
  return [...out.values()];
}

/** Tier medal classes (D-106), by tier - 1; colours in app.css. */
export const MEDAL = ["bronze", "silver", "gold"] as const;

/** One quick stat of a species tooltip (D-106): an icon, a short value, the words on hover. */
export interface QuickStat {
  icon: "coin" | "biomass" | "spread" | "egg" | "cap";
  value: string;
  title: string;
}

/** The quick stats of a species, in real seconds: the stat sheet counts ecology seconds, which
 *  run at `pace` per real second (D-069). Plants: cost per cell, yield per cell, spread, map
 *  share; animals: cost (×1.5 off your land), yield, breeding period, head cap. */
export function quickStats(s: Species, pace = 1): QuickStat[] {
  const { growth, yield: y, spawn_cost: cost, cap } = s.stats;
  const r = (v: number) => Number(v.toPrecision(2));
  return s.kind === "flora"
    ? [
        { icon: "coin", value: `${cost}`, title: "Cost per cell planted" },
        { icon: "biomass", value: `+${r(y * pace)}/s`, title: "Biomass per covered cell" },
        {
          icon: "spread",
          value: `${r(growth * pace)}/s`,
          title: "Spread: how fast it claims land",
        },
        {
          icon: "cap",
          value: `${Math.round(cap * 100)}%`,
          title: "Most of the map one side may hold",
        },
      ]
    : [
        { icon: "coin", value: `${cost}`, title: "Cost each, ×1.5 off your land" },
        { icon: "biomass", value: `+${r(y * pace)}/s`, title: "Biomass per animal" },
        { icon: "egg", value: `${r(growth / pace)}s`, title: "Breeds at most this often" },
        { icon: "cap", value: `${cap}`, title: "Most animals one side may have" },
      ];
}
