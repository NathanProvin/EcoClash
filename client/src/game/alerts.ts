// Raid alerts (D-077): enemy animals on your land, grouped by area, raise an alert when the group
// is big enough, worded by its size ("Enemy voles incursion" … "Enemy fox raid!"), at most once
// per area per cooldown unless it grows worse. Pure: the HUD feeds it the animals it draws.

import type { Animal } from "../replay/replay";

/** Areas are squares of `bucket` cells. Threat weight per animal: swarms (insects, soil life)
 *  count little, predators a lot. Severity thresholds on the summed weight: incursion, attack,
 *  raid. An area stays quiet for `cooldownS` unless its severity rises; the whole map for
 *  `gapS`, so alerts never pile up. */
export const RAID = {
  bucket: 4,
  weight: { swarm: 0.25, animal: 1, predator: 3 },
  severity: [2, 6, 15],
  cooldownS: 30,
  gapS: 5, // at most one new alert in this time, anywhere, unless it is worse
} as const;

const WORDING = [
  ["Enemy {s} incursion", "Enemy {s} foray", "Enemy {s} sighted on your land"],
  ["Enemy {s} attack", "Enemy {s} assault", "Enemy {s} offensive"],
  ["Enemy {s} raid!", "Major enemy {s} raid!", "Enemy {s} invasion!"],
] as const;

export type Severity = 0 | 1 | 2;

export interface RaidAlert {
  text: string;
  severity: Severity;
  /** Where to look: the group's centre, in cells. */
  row: number;
  col: number;
}

/** What the watch needs to know about each animal species (fauna order). */
export interface Kind {
  label: string;
  predator: boolean;
  swarm: boolean;
}

export class RaidWatch {
  private readonly heard = new Map<string, { t: number; severity: Severity }>();
  private turn = 0;
  private lastAlert = { t: -Infinity, severity: -1 };

  /** Alerts for player `me` at time `t` (s), most severe first. */
  scan(
    animals: readonly Animal[],
    owner: Uint8Array,
    n: number,
    me: number,
    kinds: readonly Kind[],
    t: number,
  ): RaidAlert[] {
    const areas = new Map<string, { w: number; y: number; x: number; by: Map<number, number> }>();
    for (const a of animals) {
      if (a.owner === me) continue;
      const [row, col] = [Math.round(a.y), Math.round(a.x)];
      if (owner[row * n + col] !== me) continue;
      const kind = kinds[a.species];
      const w = kind?.swarm
        ? RAID.weight.swarm
        : kind?.predator
          ? RAID.weight.predator
          : RAID.weight.animal;
      const key = `${Math.floor(row / RAID.bucket)},${Math.floor(col / RAID.bucket)}`;
      const area = areas.get(key) ?? { w: 0, y: 0, x: 0, by: new Map<number, number>() };
      area.w += w;
      area.y += row * w;
      area.x += col * w;
      area.by.set(a.species, (area.by.get(a.species) ?? 0) + w);
      areas.set(key, area);
    }
    const out: RaidAlert[] = [];
    const biggest = [...areas].sort((p, q) => q[1].w - p[1].w); // the gap keeps the worst
    for (const [key, area] of biggest) {
      let severity = -1;
      RAID.severity.forEach((min, i) => {
        if (area.w >= min) severity = i;
      });
      if (severity < 0) continue;
      const s = severity as Severity;
      if (this.quiet(key, s, t)) continue;
      if (t - this.lastAlert.t < RAID.gapS && s <= this.lastAlert.severity) continue;
      this.lastAlert = { t, severity: s };
      this.heard.set(key, { t, severity: s });
      const [species] = [...area.by].sort((p, q) => q[1] - p[1])[0] ?? [0];
      const name = kinds[species]?.label ?? "animal";
      const words = WORDING[s];
      const template = words[this.turn++ % words.length] ?? words[0];
      out.push({
        text: template.replace("{s}", name.toLowerCase()),
        severity: s,
        row: Math.round(area.y / area.w),
        col: Math.round(area.x / area.w),
      });
    }
    return out.sort((p, q) => q.severity - p.severity);
  }

  /** Whether this area or a neighbouring one was alerted recently at this severity or worse. */
  private quiet(key: string, severity: Severity, t: number): boolean {
    const [by, bx] = key.split(",").map(Number) as [number, number];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const h = this.heard.get(`${by + dy},${bx + dx}`);
        if (h && t - h.t < RAID.cooldownS && severity <= h.severity) return true;
      }
    }
    return false;
  }
}

/** A notification: a raid alert (with a place to fly to), an info, or an order that did nothing. */
export interface Toast {
  id: number;
  text: string;
  kind: "alert" | "info" | "notice";
  /** When it appeared (ms, performance.now). */
  at: number;
  cell?: { row: number; col: number };
  severity?: Severity;
}

/** How long a toast stays (ms), and how many show at once. */
export const TOAST = { alertMs: 8000, otherMs: 5000, max: 4 } as const;

/** The toasts still showing at `now`, newest last. */
export function fresh(toasts: readonly Toast[], now: number): Toast[] {
  return toasts
    .filter((t) => now - t.at < (t.kind === "alert" ? TOAST.alertMs : TOAST.otherMs))
    .slice(-TOAST.max);
}

/** Victory near (D-081): warn when a side is within `margin` of the winning share of the map
 *  (again only after it fell `rearm` below it), and when these minutes are left. */
export const VICTORY = { margin: 0.1, rearm: 0.15, minutesLeft: [5, 1] } as const;

/** Watches both players' share of the map and the clock for the last stretch of a match. */
export class VictoryWatch {
  private warned = [false, false];
  private told = new Set<number>();

  /** Toast texts for player `me`: `share[p - 1]` is player p's share of the map, `t` and
   *  `limit` the match time and length (s). */
  scan(share: readonly number[], me: number, victory: number, t: number, limit: number): string[] {
    const out: string[] = [];
    const pct = (v: number) => `${Math.round(v * 100)} %`;
    share.forEach((s, i) => {
      if (s >= victory - VICTORY.margin && !this.warned[i]) {
        this.warned[i] = true;
        out.push(
          i + 1 === me
            ? `Victory in sight: you hold ${pct(s)} of the map (${pct(victory)} wins)`
            : `The enemy nears victory: ${pct(s)} of the map (${pct(victory)} wins)`,
        );
      } else if (s < victory - VICTORY.rearm) {
        this.warned[i] = false;
      }
    });
    for (const m of VICTORY.minutesLeft) {
      if (limit - t <= m * 60 && limit - t > 0 && !this.told.has(m)) {
        this.told.add(m);
        out.push(m === 1 ? "One minute left" : `${m} minutes left`);
      }
    }
    return out;
  }
}

/** Ground lost (D-077): `minCells` of your cells taken by the enemy within `windowS`. */
export const FRONT = { windowS: 10, minCells: 6 } as const;

const LOSING = [
  "Losing ground to the enemy",
  "Your front is giving way",
  "Enemy plants overrun your land",
] as const;

/** Watches your cells flipping to the enemy between scans. */
export class FrontWatch {
  private prev: Uint8Array | null = null;
  private lost: { t: number; row: number; col: number }[] = [];
  private lastAlert = -Infinity;
  private turn = 0;

  /** An alert when ground is lost fast (at most once per `RAID.cooldownS`), else null. */
  scan(owner: Uint8Array, n: number, me: number, t: number): RaidAlert | null {
    const prev = this.prev;
    this.prev = owner.slice();
    if (!prev) return null;
    for (let k = 0; k < owner.length; k++) {
      if (prev[k] === me && owner[k] === 3 - me) {
        this.lost.push({ t, row: Math.floor(k / n), col: k % n });
      }
    }
    this.lost = this.lost.filter((l) => t - l.t <= FRONT.windowS);
    if (this.lost.length < FRONT.minCells || t - this.lastAlert < RAID.cooldownS) return null;
    this.lastAlert = t;
    const avg = (f: (l: { row: number; col: number }) => number) =>
      Math.round(this.lost.reduce((s, l) => s + f(l), 0) / this.lost.length);
    const text = LOSING[this.turn++ % LOSING.length] ?? LOSING[0];
    return { text, severity: 1, row: avg((l) => l.row), col: avg((l) => l.col) };
  }
}
