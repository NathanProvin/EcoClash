<script lang="ts">
  // Weather badge (D-132), top left under the clock: the sky now, or the weather announced (a
  // pulsing ring and the seconds before it hits), or the weather at work and the time it has left.
  // Hover for what it does.
  import { label } from "../game/species";
  import { WEATHER_LOOK, type WeatherKind, type WeatherNow } from "../game/weather";
  import Icon from "./Icon.svelte";

  let { now, kinds }: { now: WeatherNow; kinds: WeatherKind[] } = $props();

  const look = $derived(WEATHER_LOOK[now.kind ?? "clear"] ?? WEATHER_LOOK["clear"]);
  const effect = $derived(kinds.find((k) => k.name === now.kind)?.effect ?? "");
  const clock = (s: number) =>
    s >= 60
      ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`
      : `${Math.ceil(s)}s`;
  const title = $derived(
    now.phase === "clear"
      ? "Clear sky"
      : `${now.phase === "alert" ? "Weather alert: " : ""}${label(now.kind ?? "")} — ${effect}`,
  );
</script>

<div class="badge panel {now.phase} {now.kind ?? 'clear'}" {title} aria-label={title} role="status">
  <span class="icon"><Icon name={look?.icon ?? "sun"} size={20} /></span>
  {#if now.phase !== "clear"}
    <span class="what">{label(now.kind ?? "")}</span>
    <span class="num left">{now.phase === "alert" ? "in " : ""}{clock(now.seconds)}</span>
  {/if}
</div>

<style>
  .badge {
    position: absolute;
    left: 14px;
    top: 58px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 12px 4px 4px;
    border-radius: 999px;
    font-size: 0.82em;
  }
  .badge.clear {
    padding-right: 4px;
  }
  .icon {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: var(--well);
    color: var(--gold);
  }
  .rain .icon,
  .flood .icon {
    color: #9fc3d6;
  }
  .drought .icon {
    color: #e8a854;
  }
  .alert .icon {
    animation: pulse 1.2s ease-in-out infinite;
  }
  .what {
    font-weight: 700;
  }
  .left {
    color: var(--ink-soft);
  }
  .alert .left {
    color: var(--bad);
  }
  @keyframes pulse {
    50% {
      box-shadow: 0 0 0 4px rgba(232, 168, 84, 0.35);
    }
  }
</style>
