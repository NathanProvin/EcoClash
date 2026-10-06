<script lang="ts">
  // Weather badge (D-132): the sky now, or the weather announced (a
  // pulsing ring and the seconds before it hits), or the weather at work and the time it has left.
  // A round button of the top-right icon row (D-134).
  // Hover: a tooltip in the build bar's style (D-133) with what it changes.
  import { label } from "../game/species";
  import { change, WEATHER_LOOK, type WeatherKind, type WeatherNow } from "../game/weather";
  import Icon from "./Icon.svelte";

  let {
    now,
    kinds,
    compact = false,
  }: { now: WeatherNow; kinds: WeatherKind[]; compact?: boolean } = $props();

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
  class="wx {now.phase} {now.kind ?? 'clear'}"
  class:compact
  role="status"
  aria-label={now.phase === "clear"
    ? "Clear sky"
    : `${label(now.kind ?? "")}: ${kind?.effect ?? ""}`}
  onpointerenter={() => (hover = true)}
  onpointerleave={() => (hover = false)}
>
  <span class="icon"><Icon name={look?.icon ?? "sun"} size={20} /></span>
  {#if now.phase !== "clear"}
    <span class="left num">{now.phase === "alert" ? "in " : ""}{clock(now.seconds)}</span>
  {/if}
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
      <em
        >{kind?.effect ??
          "Normal growth and movement. A weather alert comes before each event."}</em
      >
    </div>
  {/if}
</div>

<style>
  /* A round button of the top-right icon row (TopBar .icon), the countdown in a pill under it. */
  .wx {
    position: relative;
  }
  .icon {
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    border: 1px solid var(--line);
    border-radius: 50%;
    background: var(--panel);
    backdrop-filter: var(--blur);
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
  .left {
    position: absolute;
    top: 42px;
    left: 50%;
    transform: translateX(-50%);
    padding: 0 6px;
    border-radius: 999px;
    background: var(--panel);
    color: var(--ink-soft);
    font-size: 0.7em;
    white-space: nowrap;
  }
  .alert .left {
    color: var(--bad);
  }
  /* In the clock strip (D-215): smaller, its pill and tooltip below, opening to the right. */
  .compact .icon {
    width: 30px;
    height: 30px;
  }
  .compact .left {
    top: 34px;
  }
  .compact .tip {
    left: 0;
    right: auto;
    top: 44px;
  }
  @keyframes pulse {
    50% {
      box-shadow: 0 0 0 4px rgba(232, 168, 84, 0.35);
    }
  }
  /* The species tooltip's look (BottomBar), opening below the badge. */
  .tip {
    position: absolute;
    right: 0;
    top: 62px;
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
