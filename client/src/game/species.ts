// Species helpers shared by the UI: display names, glyphs, and tech-tree state at a given time.
// Mirrors the unlock rules of tools/prototype/economy.py (D-029).

import type { ReplayMeta, Species } from "../replay/replay";

/** "tawny_owl" -> "Tawny owl". */
export function label(name: string): string {
  const words = name.replace(/_/g, " ");
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
