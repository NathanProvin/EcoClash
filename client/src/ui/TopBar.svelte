<script lang="ts">
  // Resource bar (D-030, D-048, D-064): land (with a P1 / P2 tug-of-war gauge), species alive,
  // biomass and its rate, for the viewed player. Icon buttons on the right: tech tree, view and
  // display (layers, quality, viewed player, source, performance readout), main menu.
  import type { Source } from "../replay/replay";
  import type { Layer } from "../render/viewer";
  import type { Quality } from "../render/quality";
  import Icon from "./Icon.svelte";

  let {
    replay,
    tick,
    player = $bindable(),
    onTech,
    onMenu,
    layers,
    toggle,
    quality,
    onQuality,
    perf = $bindable(),
    icons = $bindable(),
    replays,
    chosen = $bindable(),
    onChoose,
  }: {
    replay: Source;
    tick: number;
    player: 1 | 2;
    onTech: () => void;
    onMenu: () => void;
    layers: Record<Layer, boolean>;
    toggle: (l: Layer) => void;
    quality: Quality;
    onQuality: (q: Quality) => void;
    perf: boolean;
    icons: boolean;
    replays: string[];
    chosen: string;
    onChoose: (name: string) => void;
  } = $props();

  let menu = $state(false);
  const row = $derived(replay.seriesIndex(tick));
  const value = (key: string) => replay.meta.series[key]?.[row] ?? 0;
  const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
  const rate = $derived(value(`yield_p${player}`));
  const land = $derived([value("territory_p1"), value("territory_p2")]);
  const layerNames: [Layer, string][] = [
    ["territory", "Territory"],
    ["L1", "Grass"],
    ["L2", "Shrubs"],
    ["L3", "Trees"],
    ["animals", "Animals"],
  ];
</script>

<header class="bar">
  <div class="resources panel p{player}">
    <div class="res" title="Land: your share of the map (the gauge: you vs the other player)">
      <Icon name="land" />
      <span class="value num">{((land[player - 1] ?? 0) * 100).toFixed(0)}%</span>
      <span class="tug" aria-hidden="true">
        <span class="t1" style:width="{(land[0] ?? 0) * 100}%"></span>
        <span class="t2" style:width="{(land[1] ?? 0) * 100}%"></span>
      </span>
    </div>
    <div class="res" title="Species alive">
      <Icon name="species" />
      <span class="value num">{value(`species_p${player}`)}</span>
    </div>
    <div class="res" title="Biomass banked, and earned per second">
      <Icon name="biomass" />
      <span class="value num">{compact.format(value(`bank_p${player}`))}</span>
      <span class="rate num">+{compact.format(Math.max(rate, 0))}</span>
    </div>
  </div>

  <div class="actions">
    <button class="icon" onclick={onTech} title="Tech tree (T)" aria-label="Tech tree">
      <Icon name="tree" />
    </button>
    <div class="menu">
      <button
        class="icon"
        onclick={() => (menu = !menu)}
        aria-expanded={menu}
        title="View and display"
        aria-label="View and display"
      >
        <Icon name="layers" />
      </button>
      {#if menu}
        <div class="drop panel" role="menu">
          {#each layerNames as [layer, name] (layer)}
            <label>
              <input type="checkbox" checked={layers[layer]} onchange={() => toggle(layer)} />
              {name}
            </label>
          {/each}
          <hr />
          <label class="pair">
            Quality
            <select
              value={quality}
              onchange={(e) => onQuality(e.currentTarget.value as Quality)}
              aria-label="Quality preset"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
          <label class="pair">
            View
            <select bind:value={player} aria-label="Viewed player">
              <option value={1}>Player 1</option>
              <option value={2}>Player 2</option>
            </select>
          </label>
          {#if replays.length > 1}
            <label class="pair">
              Source
              <select
                bind:value={chosen}
                onchange={(e) => onChoose(e.currentTarget.value)}
                aria-label="Replay"
              >
                {#each replays as name (name)}<option value={name}>{name}</option>{/each}
              </select>
            </label>
          {/if}
          <label><input type="checkbox" bind:checked={icons} /> Strategic icons (I)</label>
          <label><input type="checkbox" bind:checked={perf} /> Performance readout</label>
        </div>
      {/if}
    </div>
    <button class="icon" onclick={onMenu} title="Main menu" aria-label="Main menu">
      <Icon name="menu" />
    </button>
  </div>
</header>

<style>
  .bar {
    position: absolute;
    inset: 0 0 auto 0;
    display: flex;
    justify-content: center;
    padding: 12px 14px 0;
    pointer-events: none; /* the map stays clickable around the pieces */
  }
  .bar > * {
    pointer-events: auto;
  }
  .resources {
    display: flex;
    gap: 4px;
    padding: 6px 14px;
    border-radius: 999px;
  }
  .res {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 0 10px;
    color: var(--ink-soft);
    white-space: nowrap;
  }
  .value {
    color: var(--ink);
    font-size: 1.05em;
    font-weight: 600;
  }
  .rate {
    color: var(--good);
    font-size: 0.85em;
  }
  .tug {
    position: relative;
    width: 56px;
    height: 5px;
    border-radius: 3px;
    background: var(--well);
    overflow: hidden;
  }
  .tug span {
    position: absolute;
    top: 0;
    bottom: 0;
  }
  .t1 {
    left: 0;
    background: var(--p1);
  }
  .t2 {
    right: 0;
    background: var(--p2);
  }
  .actions {
    position: absolute;
    right: 14px;
    top: 12px;
    display: flex;
    gap: 6px;
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
    color: var(--ink);
    cursor: pointer;
    transition: border-color 0.15s;
  }
  .icon:hover {
    border-color: var(--accent);
  }
  .menu {
    position: relative;
  }
  .drop {
    position: absolute;
    right: 0;
    top: 46px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 190px;
    white-space: nowrap;
    font-size: 0.9em;
  }
  .drop label {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }
  .drop .pair {
    justify-content: space-between;
  }
  .drop select {
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--well);
    padding: 2px 6px;
  }
  .drop select option {
    background: #1f2823;
  }
  hr {
    width: 100%;
    border: 0;
    border-top: 1px solid var(--line);
    margin: 2px 0;
  }
</style>
