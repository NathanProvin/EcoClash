<script lang="ts">
  // RTS resource bar (D-030, D-048): land colonized (with a P1 / P2 tug-of-war gauge), species
  // alive, biomass stock and its rate, for the viewed player; plus the player switch, the tech
  // tree button, the source menu and the layers menu.
  import type { Source } from "../replay/replay";
  import type { Layer } from "../render/viewer";
  import type { Quality } from "../render/quality";
  import Icon from "./Icon.svelte";

  let {
    replay,
    tick,
    player = $bindable(),
    onTech,
    layers,
    toggle,
    quality,
    onQuality,
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
    quality: Quality;
    onQuality: (q: Quality) => void;
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
  const land = $derived([value("territory_p1"), value("territory_p2")]);
  const layerNames: [Layer, string][] = [
    ["territory", "Territory tint"],
    ["L1", "L1 herbaceous (grass)"],
    ["L2", "L2 shrubs ▲"],
    ["L3", "L3 trees ■"],
    ["animals", "Animals ● ▲"],
  ];
</script>

<header class="bar">
  <div class="left">
    <strong class="brand">ECO<span>CLASH</span></strong>
    <div class="seg" role="group" aria-label="Viewed player">
      {#each [1, 2] as const as p (p)}
        <button class="p{p}" class:on={player === p} onclick={() => (player = p)}>P{p}</button>
      {/each}
    </div>
  </div>

  <div class="resources panel p{player}">
    <div class="res" title="Land: share of the map you hold">
      <span class="ico"><Icon name="land" /></span>
      <div>
        <span class="label">Land</span>
        <span class="value num">{((land[player - 1] ?? 0) * 100).toFixed(1)}%</span>
      </div>
      <span class="tug" aria-hidden="true">
        <span class="t1" style:width="{(land[0] ?? 0) * 100}%"></span>
        <span class="t2" style:width="{(land[1] ?? 0) * 100}%"></span>
      </span>
      <span class="vs num">vs {((land[other - 1] ?? 0) * 100).toFixed(0)}%</span>
    </div>
    <div class="res" title="Species alive">
      <span class="ico"><Icon name="species" /></span>
      <div>
        <span class="label">Species</span>
        <span class="value num">{value(`species_p${player}`)}</span>
      </div>
    </div>
    <div class="res" title="Biomass points banked, and income per second">
      <span class="ico"><Icon name="biomass" /></span>
      <div>
        <span class="label">Biomass</span>
        <span class="value num">{compact.format(value(`bank_p${player}`))}</span>
      </div>
      <span class="rate num">{rate >= 0 ? "+" : ""}{compact.format(rate)}/s</span>
    </div>
  </div>

  <div class="actions">
    <button class="btn" onclick={onTech} title="Tech tree (T)"
      ><Icon name="tree" /> Tech tree</button
    >
    {#if replays.length > 1}
      <select
        class="btn"
        bind:value={chosen}
        onchange={(e) => onChoose(e.currentTarget.value)}
        aria-label="Replay"
      >
        {#each replays as name (name)}<option value={name}>{name}</option>{/each}
      </select>
    {/if}
    <div class="menu">
      <button class="btn" onclick={() => (menu = !menu)} aria-expanded={menu}>
        <Icon name="layers" /> Layers
      </button>
      {#if menu}
        <div class="drop panel" role="menu">
          {#each layerNames as [layer, name] (layer)}
            <label>
              <input type="checkbox" checked={layers[layer]} onchange={() => toggle(layer)} />
              {name}
            </label>
          {/each}
          <label class="quality">
            <span class="label">Quality</span>
            <select
              class="btn"
              value={quality}
              onchange={(e) => onQuality(e.currentTarget.value as Quality)}
              aria-label="Quality preset"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
        </div>
      {/if}
    </div>
  </div>
</header>

<style>
  .bar {
    position: absolute;
    inset: 0 0 auto 0;
    height: 64px;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    padding: 10px 14px 0;
    pointer-events: none; /* the map stays clickable between the pieces */
  }
  .bar > * {
    pointer-events: auto;
  }
  .left {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 4px 4px 4px 14px;
    border-radius: 12px;
    background: var(--panel);
    box-shadow: var(--trim);
  }
  .brand {
    font-size: 1.15em;
    font-weight: 900;
    letter-spacing: 0.08em;
    color: var(--ink);
    text-shadow: 0 2px 6px rgba(0, 0, 0, 0.55);
  }
  .brand span {
    color: var(--gold);
  }
  .seg {
    display: flex;
    gap: 4px;
    padding: 3px;
    border-radius: 10px;
    background: var(--well);
  }
  .seg button {
    border: 0;
    border-radius: 7px;
    background: transparent;
    padding: 4px 12px;
    cursor: pointer;
    font-weight: 800;
    color: var(--ink-soft);
  }
  .seg button.on {
    color: white;
    background: linear-gradient(180deg, var(--player-glow), var(--player));
    box-shadow: 0 0 10px var(--player);
  }
  .resources {
    display: flex;
    gap: 6px;
    padding: 6px 10px;
    border-top: 2px solid var(--player);
  }
  .res {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 10px;
    white-space: nowrap;
  }
  .res + .res {
    border-left: 1px solid var(--line);
  }
  .res > div {
    display: flex;
    flex-direction: column;
    line-height: 1.1;
  }
  .ico {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    color: var(--gold);
    background: var(--well);
    box-shadow: inset 0 0 0 1px var(--gold-soft);
  }
  .value {
    font-size: 1.25em;
    font-weight: 800;
  }
  .rate {
    font-weight: 700;
    color: var(--good);
    font-size: 0.9em;
  }
  .vs {
    white-space: nowrap;
    font-size: 0.8em;
    color: var(--ink-soft);
  }
  .tug {
    position: relative;
    width: 64px;
    height: 8px;
    border-radius: 4px;
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
    display: flex;
    gap: 8px;
  }
  .actions .btn {
    white-space: nowrap;
    display: flex;
    align-items: center;
    gap: 6px;
    background-color: var(--panel-flat);
    box-shadow: var(--trim);
  }
  .menu {
    position: relative;
  }
  .drop {
    position: absolute;
    right: 0;
    top: 40px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    white-space: nowrap;
  }
  .drop label {
    display: flex;
    gap: 8px;
    cursor: pointer;
  }
  .drop .quality {
    align-items: center;
    justify-content: space-between;
    margin-top: 6px;
    padding-top: 8px;
    border-top: 1px solid var(--line);
  }
</style>
