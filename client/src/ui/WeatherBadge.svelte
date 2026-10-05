<script lang="ts">
  // Weather badge (D-132), top left under the clock: the sky now, or the weather announced (a
  // pulsing ring and the seconds before it hits), or the weather at work and the time it has left.
  // Hover: a tooltip in the build bar's style (D-133) with what it changes.
  import { label } from "../game/species";
  import { change, WEATHER_LOOK, type WeatherKind, type WeatherNow } from "../game/weather";
  import Icon from "./Icon.svelte";

  let { now, kinds }: { now: WeatherNow; kinds: WeatherKind[] } = $props();

  let hover = $state(false);
  const look = $derived(WEATHER_LOOK[now.kind ?? "clear"] ?? WEATHER_LOOK["clear"]);
  const kind = $derived(kinds.find((k) => k.name === now.kind));
  const clock = (s: number) =>
    s >= 60
      ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`
      : `${Math.ceil(s)}s`;
  const stats = $derived(
    kind
      ? [
          { icon: "biomass" as const, what: "plant growth", v: change(kind.growth) },
          { icon: "push" as const, what: "animal speed", v: change(kind.speed) },
          { icon: "heart" as const, what: "grazing", v: change(kind.bite) },
        ].filter((s) => s.v)
      : [],
  );
</script>

<div
  class="badge panel {now.phase} {now.kind ?? 'clear'}"
  role="status"
  aria-label={now.phase === "clear"
    ? "Clear sky"
    : `${label(now.kind ?? "")}: ${kind?.effect ?? ""}`}
  onpointerenter={() => (hover = true)}
  onpointerleave={() => (hover = false)}
>
  <span class="icon"><Icon name={look?.icon ?? "sun"} size={20} /></span>
  {#if now.phase !== "clear"}
    <span class="what">{label(now.kind ?? "")}</span>
    <span class="num left">{now.phase === "alert" ? "in " : ""}{clock(now.seconds)}</span>
  {/if}
</div>
{#if hover}
  <div class="tip panel" role="tooltip">
    <span class="head">
      <strong>{now.phase === "clear" ? "Clear sky" : label(now.kind ?? "")}</strong>
      <span class="sub"
        >{now.phase === "alert"
          ? `weather alert · in ${clock(now.seconds)}`
          : now.phase === "active"
            ? `${clock(now.seconds)} left`
            : "no weather event"}</span
      >
    </span>
    {#if stats.length}
      <span class="stats">
        {#each stats as s (s.icon)}
          <span class="stat"
            ><Icon name={s.icon} size={13} />{s.v}<span class="sub">{s.what}</span></span
          >
        {/each}
      </span>
    {/if}
    <em>{kind?.effect ?? "Normal growth and movement. A weather alert comes before each event."}</em
    >
  </div>
{/if}

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
  /* The species tooltip's look (BottomBar), opening below the badge. */
  .tip {
    position: absolute;
    left: 14px;
    top: 104px;
    z-index: 5;
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: max-content;
    max-width: 240px;
    padding: 7px 10px;
    font-size: 0.78em;
    pointer-events: none;
  }
  .head {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }
  .head strong {
    font-size: 1.08em;
  }
  .stats {
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .stat {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--ink);
  }
  .stat :global(svg) {
    color: var(--ink-soft);
  }
  .sub,
  em {
    color: var(--ink-soft);
    font-weight: 400;
  }
</style>
