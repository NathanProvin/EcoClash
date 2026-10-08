<script lang="ts">
  // End screen (D-059): the verdict for the human player, how it was reached, and the match's
  // territory and standing-biomass curves for both players.
  import { CHART } from "../render/palette";
  import type { Outcome } from "../worker/live";
  import LineChart from "./LineChart.svelte";

  let {
    outcome,
    human,
    series,
    dt,
    note = "",
    onMenu,
    onAgain,
    onWatch,
  }: {
    outcome: Outcome;
    human: 1 | 2;
    series: Record<string, number[]>;
    dt: number;
    /** A line under the match time, e.g. the bot's style (D-228). */
    note?: string;
    onMenu: () => void;
    onAgain: () => void;
    onWatch: () => void;
  } = $props();

  const title = $derived(
    outcome.reason === "desync"
      ? "Void"
      : outcome.winner === 0
        ? "Draw"
        : outcome.winner === human
          ? "Victory"
          : "Defeat",
  );
  const why = $derived(
    {
      territory: `P${outcome.winner} took the map: it held the territory threshold.`,
      biomass: `Time's up: P${outcome.winner} had the most standing biomass.`,
      "territory share": `Time's up, biomass tied: P${outcome.winner} held more land.`,
      draw: "Time's up: a perfect tie.",
      left: "Your opponent left the match.", // D-221
      desync: "The two simulations disagreed: the match is void.",
    }[outcome.reason] ?? outcome.reason,
  );
  const clock = (s: number) =>
    `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
  const t = $derived(series["t_s"] ?? []);
  const pair = (key: string, scale = 1) =>
    ([1, 2] as const).map((p) => ({
      label: `P${p}`,
      values: (series[`${key}_p${p}`] ?? []).map((v) => v * scale),
      color: CHART[p],
      dashed: p === 2,
    }));
</script>

<div class="end" role="dialog" aria-modal="true" aria-label="Match over">
  <div class="panel card">
    <h1 class:win={title === "Victory"} class:loss={title === "Defeat"}>{title}</h1>
    <p class="why">{why}</p>
    <p class="label">Match time {clock(outcome.tick * dt)}</p>
    {#if note}<p class="label">{note}</p>{/if}
    <div class="charts">
      <LineChart
        title="Territory, % of the map"
        {t}
        lines={pair("territory", 100)}
        format={(v) => `${v.toFixed(0)}%`}
      />
      <LineChart
        title="Standing biomass (plants and animals)"
        {t}
        lines={pair("standing")}
        format={(v) => compact.format(v)}
      />
    </div>
    <div class="buttons">
      <button class="btn" onclick={onWatch}>Keep watching</button>
      <button class="btn" onclick={onMenu}>Main menu</button>
      <button class="btn primary" onclick={onAgain}>Play again</button>
    </div>
  </div>
</div>

<style>
  .end {
    position: absolute;
    inset: 0;
    z-index: 15;
    display: grid;
    place-items: center;
    background: rgba(8, 12, 10, 0.55);
    backdrop-filter: blur(2px);
  }
  .card {
    width: min(1100px, calc(100% - 32px));
    padding: 22px 28px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  h1 {
    margin: 0;
    font-size: 2.6em;
    font-weight: 900;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    text-align: center;
  }
  h1.win {
    color: var(--gold);
  }
  h1.loss {
    color: var(--ink-soft);
  }
  .why {
    margin: 0;
    text-align: center;
  }
  .label {
    margin: 0;
    text-align: center;
  }
  .charts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
    gap: 22px;
    margin-top: 8px;
  }
  .buttons {
    display: flex;
    justify-content: center;
    gap: 12px;
    margin-top: 8px;
  }
  .primary {
    border-color: var(--gold);
  }
</style>
