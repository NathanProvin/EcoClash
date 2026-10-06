<script lang="ts">
  // Resource bar (D-030, D-048, D-064): land (with a P1 / P2 tug-of-war gauge), species alive,
  // biomass and its rate, for the viewed player. Icon buttons on the right: tech tree, view and
  // display (layers, quality, viewed player, source, performance readout), full screen, main menu.
  import type { Source } from "../replay/replay";
  import type { Layer } from "../render/viewer";
  import type { Quality } from "../render/quality";
  import type { WeatherKind, WeatherNow } from "../game/weather";
  import { OVERLAYS, type Overlay, type OverlayId } from "../game/overlays";
  import { OVERLAY_RAMPS } from "../render/palette";
  import FamilyIcon from "./FamilyIcon.svelte";
  import Icon from "./Icon.svelte";
  import WeatherBadge from "./WeatherBadge.svelte";

  // Full screen (D-156): the browser's own; Esc or the button leaves it.
  let fullscreen = $state(!!document.fullscreenElement);
  $effect(() => {
    const sync = () => (fullscreen = !!document.fullscreenElement);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  });
  function toggleFullscreen() {
    const done = document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen();
    done.catch(() => {}); // refused (an iframe without permission): nothing to do
  }

  let {
    replay,
    tick,
    player = $bindable(),
    victory = null,
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
    weather,
    overlay = $bindable(),
  }: {
    replay: Source;
    tick: number;
    player: 1 | 2;
    onTech: () => void;
    onMenu: () => void;
    /** The share of the map that wins now (live matches, D-175). */
    victory?: number | null;
    layers: Record<Layer, boolean>;
    toggle: (l: Layer) => void;
    quality: Quality;
    onQuality: (q: Quality) => void;
    perf: boolean;
    icons: boolean;
    replays: string[];
    chosen: string;
    onChoose: (name: string) => void;
    /** Live matches: the weather now and its kinds (D-132), shown in the icon row. */
    weather?: { now: WeatherNow; kinds: WeatherKind[] } | undefined;
    /** The map overlay shown (D-135), or none. */
    overlay: OverlayId | null;
  } = $props();

  let menu = $state(false);
  const row = $derived(replay.seriesIndex(tick));
  const value = (key: string) => replay.meta.series[key]?.[row] ?? 0;
  const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
  const rate = $derived(value(`yield_p${player}`));
  const land = $derived([value("territory_p1"), value("territory_p2")]);
  /** Show / hide the map's pieces (D-135): territory lines, each stratum's models, animals. */
  const layerNames: [Layer, string][] = [
    ["territory", "Territory lines"],
    ["L1", "Herbs"],
    ["L2", "Undergrowth"],
    ["L3", "Shrubs"],
    ["L4", "Trees"],
    ["animals", "Animals"],
  ];
  const OVERLAY_ICON = {
    soil: "soil",
    diversity: "diversity",
    moisture: "water",
    shade: "shade",
  } as const;
  const QUALITIES: [Quality, string][] = [
    ["low", "Low"],
    ["medium", "Med"],
    ["high", "High"],
  ];
  const shown = $derived(OVERLAYS.find((o) => o.id === overlay));
  const gradient = (o: Overlay) => `linear-gradient(90deg, ${OVERLAY_RAMPS[o.ramp].join(", ")})`;
</script>

{#snippet legend(o: Overlay)}
  <span class="legend-bar" style:background={gradient(o)}></span>
  <span class="legend-ends"><span>low</span><span>{o.high}</span></span>
{/snippet}

<header class="bar">
  <div class="resources panel p{player}" data-tour="resources">
    <!-- Tug of war (D-134): P1 from the left, P2 from the right, free land between, 50 % marked. -->
    <span
      class="tug"
      title={victory
        ? `Land: P1 (left) vs P2 (right) · win at ${Math.round(victory * 100)} %`
        : "Land: P1 (left) vs P2 (right)"}
      aria-hidden="true"
      data-tour="land"
    >
      <span class="t1" style:width="{(land[0] ?? 0) * 100}%"></span>
      <span class="t2" style:width="{(land[1] ?? 0) * 100}%"></span>
      {#if victory}
        <!-- Victory marks (D-175): where you win (green, from your side) and where the enemy
             would (red, from theirs), moving as the threshold decays. -->
        <span class="mark win" style:left="{(player === 1 ? victory : 1 - victory) * 100}%"></span>
        <span class="mark lose" style:left="{(player === 1 ? 1 - victory : victory) * 100}%"></span>
      {/if}
    </span>
    <div class="res" title="Land: your share of the map">
      <Icon name="land" />
      <span class="value num">{((land[player - 1] ?? 0) * 100).toFixed(0)}%</span>
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
    {#if weather}<WeatherBadge now={weather.now} kinds={weather.kinds} />{/if}
    <button
      class="icon"
      onclick={onTech}
      title="Tech tree (T)"
      aria-label="Tech tree"
      data-tour="tech"
    >
      <Icon name="tree" />
    </button>
    <div class="menu">
      <button
        class="icon"
        onclick={() => (menu = !menu)}
        aria-expanded={menu}
        title="View and display"
        aria-label="View and display"
        data-tour="display"
      >
        <Icon name="layers" />
      </button>
      {#if menu}
        <div class="drop panel" role="menu">
          <span class="fh">Map overlay</span>
          <div class="grid">
            {#each OVERLAYS as o (o.id)}
              {@const off = o.live === true && !weather}
              <button
                class="tog"
                class:on={overlay === o.id}
                disabled={off}
                aria-pressed={overlay === o.id}
                data-tour="overlay-{o.id}"
                title={off ? "Live matches only" : `${o.label}: darker where ${o.high}`}
                onclick={() => (overlay = overlay === o.id ? null : o.id)}
              >
                <span class="disc">
                  {#if o.id.startsWith("L")}
                    <FamilyIcon family={o.id} size={18} bare />
                  {:else}
                    <Icon name={OVERLAY_ICON[o.id as keyof typeof OVERLAY_ICON]} size={18} />
                  {/if}
                </span>
                <span class="lab">{o.label}</span>
              </button>
            {/each}
          </div>
          {#if shown}{@render legend(shown)}{/if}
          <hr />
          <span class="fh">Show</span>
          <div class="row">
            {#each layerNames as [layer, name] (layer)}
              <button
                class="mini"
                class:on={layers[layer]}
                aria-pressed={layers[layer]}
                title="{layers[layer] ? 'Hide' : 'Show'} {name.toLowerCase()}"
                onclick={() => toggle(layer)}
              >
                {#if layer === "territory"}
                  <Icon name="land" size={15} />
                {:else}
                  <FamilyIcon family={layer === "animals" ? "P3" : layer} size={15} bare />
                {/if}
              </button>
            {/each}
          </div>
          <hr />
          <div class="pair">
            Quality
            <span
              class="seg"
              role="radiogroup"
              aria-label="Quality preset"
              title="Shadows change from the next match"
            >
              {#each QUALITIES as [q, name] (q)}
                <button
                  role="radio"
                  aria-checked={quality === q}
                  class:on={quality === q}
                  onclick={() => onQuality(q)}>{name}</button
                >
              {/each}
            </span>
          </div>
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
          <div class="row two">
            <button
              class="tog"
              class:on={icons}
              aria-pressed={icons}
              title="Strategic icons over your large groups (I)"
              onclick={() => (icons = !icons)}
            >
              <span class="disc"><Icon name="pin" size={17} /></span>
              <span class="lab">Group icons</span>
            </button>
            <button
              class="tog"
              class:on={perf}
              aria-pressed={perf}
              title="Frame rate and simulation time"
              onclick={() => (perf = !perf)}
            >
              <span class="disc"><Icon name="gauge" size={17} /></span>
              <span class="lab">Performance</span>
            </button>
          </div>
        </div>
      {/if}
      {#if shown && !menu}
        <div class="legend panel" aria-label="Overlay legend">
          <span class="fh">{shown.label}</span>
          {@render legend(shown)}
        </div>
      {/if}
    </div>
    <button
      class="icon"
      onclick={toggleFullscreen}
      title={fullscreen ? "Leave full screen" : "Full screen"}
      aria-label={fullscreen ? "Leave full screen" : "Full screen"}
    >
      <Icon name={fullscreen ? "shrink" : "expand"} />
    </button>
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
    position: relative;
    display: flex;
    gap: 4px;
    padding: 12px 14px 6px;
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
    position: absolute;
    left: 22px;
    right: 22px;
    top: 4px;
    height: 5px;
    border-radius: 3px;
    background: var(--well);
    overflow: hidden;
  }
  .tug::after {
    content: "";
    position: absolute;
    left: calc(50% - 1px);
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--ink-soft);
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
  .tug .mark {
    width: 2px;
    margin-left: -1px;
    z-index: 1;
  }
  .mark.win {
    background: #7fdc6a;
    box-shadow: 0 0 4px #7fdc6a;
  }
  .mark.lose {
    background: #ff5a44;
    box-shadow: 0 0 4px #ff5a44;
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
    cursor: var(--cursor-pointer);
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
    gap: 7px;
    width: 262px;
    white-space: nowrap;
    font-size: 0.9em;
  }
  .fh {
    font-size: 0.68em;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  /* Round toggles (D-135): a disc that lights up gold when on, its name under it. */
  .grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 6px 2px;
  }
  .tog {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    border: 0;
    background: none;
    color: var(--ink-soft);
    cursor: var(--cursor-pointer);
    font-size: 0.72em;
  }
  .tog:disabled {
    opacity: 0.35;
    cursor: var(--cursor);
  }
  .disc {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border: 1px solid var(--line);
    border-radius: 50%;
    background: var(--well);
    color: var(--ink);
    transition:
      border-color 0.15s,
      box-shadow 0.15s,
      background 0.15s;
  }
  .tog:not(:disabled):hover .disc {
    border-color: var(--accent);
  }
  .tog.on {
    color: var(--ink);
  }
  .tog.on .disc {
    border-color: var(--gold);
    background: rgba(212, 175, 55, 0.18);
    box-shadow: 0 0 10px var(--gold-soft);
    color: var(--gold);
  }
  .row {
    display: flex;
    justify-content: space-between;
  }
  .row.two {
    justify-content: space-around;
  }
  .mini {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border: 1px solid var(--line);
    border-radius: 50%;
    background: var(--well);
    color: var(--ink-soft);
    opacity: 0.5;
    cursor: var(--cursor-pointer);
  }
  .mini.on {
    color: var(--ink);
    opacity: 1;
    border-color: var(--accent);
  }
  .seg {
    display: inline-flex;
    padding: 2px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--well);
  }
  .seg button {
    padding: 2px 10px;
    border: 0;
    border-radius: 999px;
    background: none;
    color: var(--ink-soft);
    cursor: var(--cursor-pointer);
    font-size: 0.85em;
  }
  .seg button.on {
    background: var(--panel);
    color: var(--gold);
    box-shadow: 0 0 0 1px var(--gold-soft);
  }
  .legend-bar {
    height: 8px;
    border-radius: 4px;
  }
  .legend-ends {
    display: flex;
    justify-content: space-between;
    font-size: 0.72em;
    color: var(--ink-soft);
  }
  .legend {
    position: absolute;
    right: 0;
    top: 70px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 180px;
    padding: 6px 10px 7px;
    font-size: 0.85em;
  }
  .drop label {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: var(--cursor-pointer);
  }
  .drop .pair {
    display: flex;
    align-items: center;
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
