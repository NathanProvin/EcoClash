// The cell panel's at-a-glance status (D-100): how a cell is doing, from what the panel shows.

import type { CellInfo } from "../replay/replay";

export type CellStatus = "none" | "good" | "warn" | "danger";

/** Neutral cells have none. An owned cell is in danger when the other side pushes hard or its
 *  animals are on it, under watch when it is pushed at all or barred, and fine otherwise. */
export function cellStatus(info: CellInfo): CellStatus {
  if (info.owner !== 1 && info.owner !== 2) return info.lock ? "warn" : "none";
  const raiders = info.animals.some((a) => a.owner !== info.owner);
  if (info.push >= 0.5 || raiders) return "danger";
  if (info.push > 0) return "warn";
  return "good";
}

/** The status in words, for the tooltip. */
export const STATUS_TEXT: Record<CellStatus, string> = {
  none: "Nobody holds this cell",
  good: "Thriving: nothing threatens it",
  warn: "Under pressure from the other side",
  danger: "Under attack",
};
