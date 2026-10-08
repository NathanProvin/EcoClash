// Match setup (D-081): who you play and on which map, chosen in the main menu and remembered per
// browser. URL parameters still override it, for development and the lockstep test
// (?bot=, ?style=, ?seed=, ?sandbox=1, ?relay=, ?size=).

export const BOTS = ["easy", "normal", "hard", "none"] as const;
export type Bot = (typeof BOTS)[number];

/** The bot's play style (D-228): random (from the match seed) or one of the four. */
export const STYLES = ["random", "wide", "tall", "rush", "balanced"] as const;
export type BotStyle = (typeof STYLES)[number];

/** Map sizes (D-103): cells per side. Mid is the balance's default grid. */
export const MAP_SIZES = { small: 24, mid: 38, large: 56 } as const;
export type MapSize = keyof typeof MAP_SIZES;

export interface MatchSetup {
  /** The P2 opponent: a bot level, or "none" for an empty map to practise on. */
  bot: Bot;
  /** The bot's play style (D-228). */
  style: BotStyle;
  /** Map and match seed: the same seed gives the same match. */
  seed: number;
  /** Everything unlocked and free (practice). */
  sandbox: boolean;
  /** Map size (D-103). */
  map: MapSize;
}

/** The Play menu's modes (D-137): a sandbox (everything unlocked and free, no opponent), a match
 *  against a bot, or an online 1v1 (D-219). Ranked comes later. */
export type Mode = "sandbox" | "ai" | "online";

/** The setup for a mode: the sandbox and online matches have no bot; the AI mode keeps the
 *  chosen bot level (normal if none was chosen). */
export function forMode(setup: MatchSetup, mode: Mode): MatchSetup {
  if (mode === "ai")
    return { ...setup, sandbox: false, bot: setup.bot === "none" ? "normal" : setup.bot };
  return { ...setup, sandbox: mode === "sandbox", bot: "none" };
}

/** Room code letters: no look-alikes (I, O). */
const CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

/** A new online room code (D-219): 5 letters. */
export function roomCode(rand: () => number = Math.random): string {
  return Array.from({ length: 5 }, () => CODE_LETTERS[Math.floor(rand() * 24)]).join("");
}

/** A typed room code, cleaned: upper case, letters and digits only; "" if too short or long. */
export function cleanCode(typed: string): string {
  const code = typed.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return code.length >= 4 && code.length <= 8 ? code : "";
}

export const DEFAULT_SETUP: MatchSetup = {
  bot: "normal",
  style: "random",
  seed: 1,
  sandbox: false,
  map: "mid",
};

/** What the worker's bot is told (D-228): "level:style", or "none". */
export const botSpec = (s: MatchSetup): string =>
  s.bot === "none" ? "none" : `${s.bot}:${s.style}`;
const KEY = "ecoclash.setup";

/** A random seed for a new map (1 .. 999 999). */
export const randomSeed = () => 1 + Math.floor(Math.random() * 999_999);

/** The remembered setup, or the default. */
export function loadSetup(storage?: Pick<Storage, "getItem">): MatchSetup {
  try {
    const raw = (storage ?? globalThis.localStorage)?.getItem(KEY);
    return clean(raw ? (JSON.parse(raw) as Partial<MatchSetup>) : {});
  } catch {
    return { ...DEFAULT_SETUP };
  }
}

export function saveSetup(setup: MatchSetup, storage?: Pick<Storage, "setItem">): void {
  try {
    (storage ?? globalThis.localStorage)?.setItem(KEY, JSON.stringify(setup));
  } catch {
    // blocked site data: the setup lasts for this page only
  }
}

/** The setup to play: URL parameters override the chosen one. */
export function withUrl(setup: MatchSetup, search: string): MatchSetup {
  const q = new URLSearchParams(search);
  return clean({
    bot: (q.get("bot") as Bot | null) ?? setup.bot,
    style: (q.get("style") as BotStyle | null) ?? setup.style,
    seed: q.has("seed") ? Number(q.get("seed")) : setup.seed,
    sandbox: q.has("sandbox") ? q.get("sandbox") === "1" : setup.sandbox,
    map: (q.get("map") as MapSize | null) ?? setup.map,
  });
}

function clean(s: Partial<MatchSetup>): MatchSetup {
  const seed = Math.floor(Number(s.seed));
  return {
    bot: BOTS.includes(s.bot as Bot) ? (s.bot as Bot) : DEFAULT_SETUP.bot,
    style: STYLES.includes(s.style as BotStyle) ? (s.style as BotStyle) : DEFAULT_SETUP.style,
    seed: Number.isFinite(seed) && seed > 0 ? seed : DEFAULT_SETUP.seed,
    sandbox: s.sandbox === true,
    map: s.map && Object.hasOwn(MAP_SIZES, s.map) ? s.map : DEFAULT_SETUP.map,
  };
}
