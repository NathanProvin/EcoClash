// First-match tips (D-082): short hints that appear once each, when they become useful, through
// the notification stack. Which ones were seen is remembered per browser; Options can turn them
// off or show them again. Pure: the HUD feeds it what the player has done so far.

/** What the tips look at, once a second. */
export interface Progress {
  /** Match time (s). */
  t: number;
  /** A species card can be unlocked and afforded now. */
  canUnlock: boolean;
  /** Animal species unlocked (sandbox: all). */
  animalsUnlocked: number;
  /** The player's animals on the map. */
  animals: number;
  /** A raid alert has been raised this match. */
  raided: boolean;
}

export interface Tip {
  id: string;
  text: string;
  when: (p: Progress) => boolean;
}

/** In the order they are offered; at most one per `gapS`. */
export const TIPS: Tip[] = [
  {
    id: "spread",
    when: (p) => p.t >= 3,
    text: "Your plants spread on their own. Plant more: open Herbs in the bar, pick a species, click your land.",
  },
  {
    id: "unlock",
    when: (p) => p.canUnlock,
    text: "Biomass buys new species: a padlock marks one you can unlock now.",
  },
  {
    id: "fronts",
    when: (p) => p.t >= 60,
    text: "Shrubs and trees smother the enemy's lower plants: that is how fronts move. A wider border shows the side pushing.",
  },
  {
    id: "animals",
    when: (p) => p.animalsUnlocked > 0 && p.animals === 0,
    text: "Call animals: pick one in the bar and click your land. Elsewhere it is a ×1.5 drop onto enemy food or prey.",
  },
  {
    id: "orders",
    when: (p) => p.animals >= 3,
    text: "Drag to select your animals, right-click to move, A to attack-move. Press I for group icons.",
  },
  {
    id: "raids",
    when: (p) => p.raided,
    text: "Alerts show here: click one to fly to the spot.",
  },
  {
    id: "victory",
    when: (p) => p.t >= 150,
    text: "Win by taking most of the map (the flag gauge at the top), or with the most standing biomass when time runs out.",
  },
];

export const TIP_GAP_S = 20;
const KEY = "ecoclash.tips";

/** Offers each tip once, when its moment comes, one at a time. */
export class TipWatch {
  private last = -Infinity;

  constructor(
    private readonly seen: Set<string>,
    private readonly save: (seen: Set<string>) => void = () => {},
  ) {}

  /** The tip to show now, if any. */
  scan(p: Progress): string | null {
    if (p.t - this.last < TIP_GAP_S) return null;
    const tip = TIPS.find((x) => !this.seen.has(x.id) && x.when(p));
    if (!tip) return null;
    this.seen.add(tip.id);
    this.save(this.seen);
    this.last = p.t;
    return tip.text;
  }
}

/** Tips already seen in this browser ("*" = tips off). */
export function loadSeen(storage?: Pick<Storage, "getItem">): Set<string> {
  try {
    const raw = (storage ?? globalThis.localStorage)?.getItem(KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function saveSeen(seen: Set<string>, storage?: Pick<Storage, "setItem">): void {
  try {
    (storage ?? globalThis.localStorage)?.setItem(KEY, JSON.stringify([...seen]));
  } catch {
    // blocked site data: tips come back next time
  }
}

/** Every tip, marked as seen: tips off. */
export const ALL_TIPS = () => new Set(TIPS.map((t) => t.id));
