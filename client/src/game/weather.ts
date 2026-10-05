// Weather (D-132) as the HUD reads it: the sim reports [kind + 1, phase, ticks left]; this turns it
// into a state, and into toasts when the weather changes, so players can prepare.

import { label } from "./species";

/** A kind of weather, from the sim's weather table. */
export interface WeatherKind {
  name: string;
  duration_s: number;
  effect: string;
  /** Factors on plant growth, animal speed, herbivore bites. */
  growth: number;
  speed: number;
  bite: number;
}

export interface WeatherNow {
  /** The kind announced or at work, null when the sky is clear. */
  kind: string | null;
  phase: "clear" | "alert" | "active";
  /** Seconds before it starts (alert) or ends (active). */
  seconds: number;
}

/** A factor as a signed change, "+15 %"; null when it changes nothing. */
export function change(factor: number): string | null {
  const pct = Math.round((factor - 1) * 100);
  return pct ? `${pct > 0 ? "+" : "−"}${Math.abs(pct)} %` : null;
}

export const CLEAR: WeatherNow = { kind: null, phase: "clear", seconds: 0 };

/** Pictogram (`Icon` names) and what to prepare for, per kind. */
export const WEATHER_LOOK: Record<
  string,
  { icon: "sun" | "rain" | "drought" | "flood"; hint: string }
> = {
  clear: { icon: "sun", hint: "Clear sky" },
  rain: { icon: "rain", hint: "plants will grow faster, animals will slow down" },
  drought: { icon: "drought", hint: "growth will slow down; trees may die and grass dry up" },
  flood: { icon: "flood", hint: "the water will rise over its banks and drown the plants there" },
};

export function decodeWeather(
  raw: readonly number[],
  kinds: readonly WeatherKind[],
  hz: number,
): WeatherNow {
  const [k = 0, phase = 0, ticks = 0] = raw;
  const kind = kinds[k - 1]?.name ?? null;
  if (!kind || phase === 0) return CLEAR;
  return { kind, phase: phase === 1 ? "alert" : "active", seconds: ticks / hz };
}

/** The toasts for a change of weather from `prev` to `now`. */
export function weatherToasts(prev: WeatherNow, now: WeatherNow): string[] {
  if (now.phase === prev.phase && now.kind === prev.kind) return [];
  const name = label(now.kind ?? "");
  if (now.phase === "alert")
    return [
      `Weather alert: ${name.toLowerCase()} in ${Math.ceil(now.seconds)} s — ${WEATHER_LOOK[now.kind ?? ""]?.hint ?? ""}`,
    ];
  if (now.phase === "active") return [`${name} has begun`];
  return prev.phase === "active" ? ["The weather clears"] : [];
}
