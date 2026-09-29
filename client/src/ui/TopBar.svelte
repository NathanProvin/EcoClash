<script lang="ts">
  // RTS resource bar (D-030): land colonized, species alive, biomass stock and its rate, for the
  // viewed player; plus the view switch, the tech tree button and the layers menu.
  import type { Source } from "../replay/replay";
  import type { Layer } from "../render/viewer";

  let {
    replay,
    tick,
    player = $bindable(),
    onTech,
    layers,
    toggle,
    replays,
    chosen = $bindable(),
    onChoose,
  }: {
    replay: Source;
    tick: number;
    player: 1 | 2;
    onTech: () => void;
    layers: Record<Layer, boolean>;
    toggle: (l: Layer) => void;
    replays: string[];
    chosen: string;
    onChoose: (name: string) => void;
  } = $props();

  let menu = $state(false);
  const row = $derived(replay.seriesIndex(tick));
  const value = (key: string) => replay.meta.series[key]?.[row] ?? 0;
  const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
  const other = $derived(player === 1 ? 2 : 1);
  const rate = $derived(value(`yield_p${player}`));
  const layerNames: [Layer, string][] = [
    ["territory", "Territory tint"],
    ["L1", "L1 herbaceous •"],
    ["L2", "L2 shrubs ▲"],
    ["L3", "L3 trees ■"],
    ["animals", "Animals ● ▲"],
  ];
</script>

<header class="bar">
  <strong class="brand">EcoClash</strong>

  <div class="seg" role="group" aria-label="Viewed player">
    {#each [1, 2] as const as p (p)}
      <button class="p{p}" class:on={player === p} onclick={() => (player = p)}>P{p}</button>
    {/each}
  </div>

  <dl class="stats">
    <div>
      <dt>Land</dt>
      <dd>
        {(value(`territory_p${player}`) * 100).toFixed(1)} %
        <span class="muted">vs {(value(`territory_p${other}`) * 100).toFixed(0)} %</span>
      </dd>
    </div>
    <div>
      <dt>Species</dt>
      <dd>{value(`species_p${player}`)}</dd>
    </div>
    <div>
      <dt>Biomass stock</dt>
      <dd>
        {compact.format(value(`bank_p${player}`))}
        <span class="rate">{rate >= 0 ? "+" : ""}{compact.format(rate)}/s</span>
      </dd>
    </div>
  </dl>

  <div class="actions">
    <button onclick={onTech} title="Tech tree (T)">Tech tree</button>
    {#if replays.length > 1}
      <select
        bind:value={chosen}
        onchange={(e) => onChoose(e.currentTarget.value)}
        aria-label="Replay"
      >
        {#each replays as name (name)}<option value={name}>{name}</option>{/each}
      </select>
    {/if}
    <div class="menu">
      <button onclick={() => (menu = !menu)} aria-expanded={menu}>Layers</button>
      {#if menu}
        <div class="drop" role="menu">
          {#each layerNames as [layer, name] (layer)}
            <label>
              <input type="checkbox" checked={layers[layer]} onchange={() => toggle(layer)} />
              {name}
            </label>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</header>

<style>
  .bar {
    position: absolute;
    inset: 0 0 auto 0;
    height: 44px;
    display: flex;
    align-items: center;
    gap: 20px;
    padding: 0 16px;
    background: var(--panel);
    border-bottom: 1px solid var(--line);
    backdrop-filter: blur(6px);
  }
  .brand {
    letter-spacing: 0.02em;
  }
  .seg {
    display: flex;
    border: 1px solid var(--line);
    border-radius: 6px;
    overflow: hidden;
  }
  .seg button {
    border: 0;
    background: transparent;
    padding: 3px 10px;
    cursor: pointer;
    color: var(--ink-soft);
  }
  .seg button.on {
    color: white;
  }
  .seg .p1.on {
    background: var(--p1);
  }
  .seg .p2.on {
    background: var(--p2);
  }
  .stats {
    display: flex;
    gap: 28px;
    margin: 0 auto;
  }
  .stats div {
    display: flex;
    gap: 8px;
    align-items: baseline;
  }
  dt {
    color: var(--ink-soft);
    font-size: 0.8em;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  dd {
    margin: 0;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .muted {
    color: var(--ink-soft);
    font-weight: 400;
    font-size: 0.85em;
  }
  .rate {
    color: #2e7d32;
    font-weight: 500;
    font-size: 0.85em;
  }
  .actions {
    display: flex;
    gap: 8px;
  }
  .actions button {
    border: 1px solid var(--line);
    background: white;
    border-radius: 6px;
    padding: 4px 12px;
    cursor: pointer;
  }
  .menu {
    position: relative;
  }
  .drop {
    position: absolute;
    right: 0;
    top: 34px;
    background: white;
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 8px 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    white-space: nowrap;
  }
</style>
