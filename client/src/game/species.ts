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
  if (s.kind === "flora") return ["•", "▲", "■"][s.level - 1] ?? "•";
  return { herbivore: "●", decomposer: "∙", predator: "▲" }[s.role] ?? "●";
}

/** Short tech-tree position, e.g. "L2 · tier 1" or "F5 · tier 1". */
export function position(s: Species): string {
  return `${s.kind === "flora" ? "L" : "F"}${s.level} · tier ${s.tier}`;
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
 *  level and, for an animal, one unlocked habitat plant (L1..L3 means any plant of that level). */
export function cardState(meta: ReplayMeta, s: Species, unlocked: Set<string>): CardState {
  if (unlocked.has(s.name)) return "unlocked";
  const tierOk =
    s.tier === 1 ||
    meta.species.some(
      (o) =>
        o.kind === s.kind && o.level === s.level && o.tier === s.tier - 1 && unlocked.has(o.name),
    );
  const habitatOk =
    s.kind === "flora" ||
    s.habitat.some((h) =>
      /^L\d$/.test(h)
        ? meta.species.some(
            (o) => o.kind === "flora" && `L${o.level}` === h && unlocked.has(o.name),
          )
        : unlocked.has(h),
    );
  return tierOk && habitatOk ? "available" : "locked";
}

/** The population cap as shown: a share of the map for plants (D-045), a head count for animals. */
export function capText(s: Species): string {
  return s.kind === "flora"
    ? `${Math.round(s.stats.cap * 100)} % of map`
    : `${s.stats.cap} animals`;
}

const FAMILY: Record<string, string> = {
  L1: "Herbs",
  L2: "Shrubs",
  L3: "Trees",
  F1: "Soil life",
  F2: "Insects",
  F3: "Small mammals",
  F4: "Birds",
  F5: "Carnivores",
};

/** Soil life and insects (fauna levels 1-2) are swarms (D-065): faint dots that show they are
 *  there, not units to select or order. Control starts from small mammals (level 3). */
export const SWARM_LEVEL = 2;
export const isSwarm = (s: Species): boolean => s.kind === "fauna" && s.level <= SWARM_LEVEL;

/** The build card's groups (D-063): per kind, one family per level (herbs, shrubs, trees; soil
 *  life … carnivores), species in tier order then stat-sheet order. */
export function families(
  species: Species[],
): { kind: Species["kind"]; name: string; species: Species[] }[] {
  const out = new Map<string, { kind: Species["kind"]; name: string; species: Species[] }>();
  const keyOf = (s: Species) => `${s.kind === "flora" ? "L" : "F"}${s.level}`;
  const sorted = [...species].sort(
    (a, b) =>
      Number(a.kind === "fauna") - Number(b.kind === "fauna") ||
      a.level - b.level ||
      a.tier - b.tier,
  );
  for (const s of sorted) {
    const key = keyOf(s);
    const group = out.get(key) ?? { kind: s.kind, name: FAMILY[key] ?? key, species: [] };
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
