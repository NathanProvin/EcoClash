<script lang="ts">
  // In-game HUD (INSTRUCTIONS §8): territory %, standing biomass, bank and animals per player.
  import type { Replay } from "../replay/replay";

  let { replay, tick }: { replay: Replay; tick: number } = $props();

  const row = $derived(replay.seriesIndex(tick));
  const value = (key: string) => replay.meta.series[key]?.[row] ?? 0;
  const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
  const time = $derived(tick * replay.meta.dt);
  const end = $derived(
    replay.meta.log.find((e) => e.what.startsWith("end:") && e.t_s <= time + 1e-9),
  );
  const players = [1, 2] as const;
</script>

<section class="panel hud" aria-label="Match statistics">
  <table>
    <thead>
      <tr>
        <th></th>
        {#each players as p (p)}
          <th class="p{p}">P{p} <span class="muted">{replay.meta.builds[p - 1]}</span></th>
        {/each}
      </tr>
    </thead>
    <tbody>
      <tr>
        <th>Territory</th>
        {#each players as p (p)}<td>{(value(`territory_p${p}`) * 100).toFixed(1)} %</td>{/each}
      </tr>
      <tr>
        <th>Standing biomass</th>
        {#each players as p (p)}
          <td>{compact.format(value(`standing_p${p}`) || value(`biomass_p${p}`))}</td>
        {/each}
      </tr>
      <tr>
        <th>Bank</th>
        {#each players as p (p)}<td>{compact.format(value(`bank_p${p}`))}</td>{/each}
      </tr>
      <tr>
        <th>Herbivores</th>
        {#each players as p (p)}<td>{value(`herbivores_p${p}`)}</td>{/each}
      </tr>
      <tr>
        <th>Predators</th>
        {#each players as p (p)}<td>{value(`predators_p${p}`)}</td>{/each}
      </tr>
      <tr>
        <th>Decomposers</th>
        {#each players as p (p)}<td>{value(`decomposers_p${p}`)}</td>{/each}
      </tr>
    </tbody>
  </table>
  {#if end}
    <p class="result" role="status">
      {end.player ? `P${end.player} wins` : "Draw"} — {end.what.slice(5)}
    </p>
  {/if}
</section>

<style>
  .hud {
    position: absolute;
    top: 12px;
    right: 12px;
    font-size: 0.9em;
  }
  table {
    border-collapse: collapse;
  }
  th,
  td {
    padding: 2px 8px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  tbody th {
    text-align: left;
    font-weight: 500;
    color: var(--ink-soft);
  }
  .p1 {
    border-bottom: 3px solid var(--p1);
  }
  .p2 {
    border-bottom: 3px solid var(--p2);
  }
  .muted {
    color: var(--ink-soft);
    font-weight: 400;
  }
  .result {
    margin: 8px 0 0;
    font-weight: 600;
    text-align: center;
  }
</style>
