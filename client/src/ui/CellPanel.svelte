<script lang="ts">
  // Cell card (D-031, D-100, D-163): the core facts of a cell at a glance, titles only. A header
  // in the owner's colour (whose, ground, health, lock and dead-wood chips), one full-width bar
  // per height layer, soil and enemy push, then the plants and the animals on the cell, yours
  // and the enemy's apart. Details in tooltips.
  import { cellStatus, STATUS_TEXT, type CellStatus } from "../game/cell";
  import { label } from "../game/species";
  import type { CellInfo, Species } from "../replay/replay";
  import Icon from "./Icon.svelte";
  import SpeciesIcon from "./SpeciesIcon.svelte";

  let {
    info,
    species,
    me,
    onZoom,
    onClose,
  }: {
    info: CellInfo;
    species: Species[];
    me: number;
    onZoom: () => void;
    onClose: () => void;
  } = $props();

  /** The height layers, low to high, with their bar colours. */
  const LAYERS = [
    { name: "Herbs", color: "#a9cf63" },
    { name: "Undergrowth", color: "#76aa4c" },
    { name: "Shrubs", color: "#4f8f3f" },
    { name: "Trees", color: "#2f6e37" },
  ] as const;
  const GROUND = [
    { icon: "land", name: "Land" },
    { icon: "water", name: "Shallows" },
    { icon: "water", name: "Deep water" },
    { icon: "rock", name: "Rock" },
  ] as const;
  const STATUS_WORD: Record<CellStatus, string> = {
    none: "Free",
    good: "Thriving",
    warn: "Pushed",
    danger: "Under attack",
  };

  const pct = (v: number) => `${Math.round(v * 100)} %`;
  const css = (v: number) => `${Math.round(Math.min(Math.max(v, 0), 1) * 100)}%`;
  const byName = $derived(new Map(species.map((s) => [s.name, s])));
  const status = $derived(cellStatus(info));
  const ground = $derived(GROUND[info.ground] ?? GROUND[0]);
  const whose = $derived(!info.owner ? "Free land" : info.owner === me ? "Yours" : "Enemy");
  const sides = $derived(
    [
      { title: "Your animals", list: info.animals.filter((a) => a.owner === me) },
      { title: "Enemy animals", list: info.animals.filter((a) => a.owner !== me) },
    ].filter((g) => g.list.length),
  );
</script>

<aside class="panel cell p{info.owner}" aria-label="Selected cell">
  <header>
    <div class="who">
      <strong>{whose}</strong>
      <span class="chips">
        <span class="chip" title={ground.name}
          ><Icon name={ground.icon} size={15} />{ground.name}</span
        >
        {#if info.owner}
          <span class="chip {status}" title={STATUS_TEXT[status]}>
            <Icon name="heart" size={14} />{STATUS_WORD[status]}
          </span>
        {/if}
        {#if info.lock}
          <span
            class="chip lock p{info.lock.player}"
            title="P{info.lock.player} may not take this cell back for {info.lock.s} s"
            ><Icon name="lock" size={13} />{info.lock.s}s</span
          >
        {/if}
        {#if info.deadwood > 0}
          <span
            class="chip dead"
            title="A dead tree stands here: no tree can grow until recyclers or rot clear it"
            ><Icon name="deadtree" size={14} />Dead tree</span
          >
        {/if}
      </span>
    </div>
    <button class="ib" onclick={onZoom} title="Zoom to plant scale" aria-label="Zoom">
      <Icon name="zoom" size={17} />
    </button>
    <button class="ib" onclick={onClose} title="Close" aria-label="Close">
      <Icon name="close" size={17} />
    </button>
  </header>

  <section>
    <h4>Layers</h4>
    {#each LAYERS as l, i (l.name)}
      <div class="row">
        <span class="name">{l.name}</span>
        <span class="bar"
          ><span style:width={css(info.strata[i] ?? 0)} style:background={l.color}></span></span
        >
        <span class="num">{pct(info.strata[i] ?? 0)}</span>
      </div>
    {/each}
  </section>

  <section>
    <div class="row" title="Soil development: richer soil lets taller layers grow">
      <span class="name">Soil</span>
      <span class="bar soil"><span style:width={css(info.soil)}></span></span>
      <span class="num">{pct(info.soil)}</span>
    </div>
    {#if info.front}
      {@const over = info.front.push > info.front.strength}
      <div
        class="row"
        title="Strength: the owner's species on this cell (plants established and resident animals), times the soil's fertility. Push: the summed strength of the enemy's cells next to it. When the push beats the strength, the cell's plants are smothered; a cell just taken is held for a while (D-225, D-230)."
      >
        <span class="name">Strength</span>
        <span class="vs"
          ><strong>{info.front.strength.toFixed(1)}</strong> vs
          <strong class:over>{info.front.push.toFixed(1)}</strong> push</span
        >
      </div>
    {/if}
    <div class="row" title="How hard the other side pushes into this cell">
      <span class="name">Enemy push</span>
      <span class="bar push"><span style:width={css(info.push)}></span></span>
      <span class="num">{pct(info.push)}</span>
    </div>
  </section>

  {#if info.plants.length}
    <section>
      <h4>Plants</h4>
      <div class="icons">
        {#each info.plants as p (p.name)}
          {@const s = byName.get(p.name)}
          <span class="tile" title="{label(p.name)}: {pct(p.cover)}">
            {#if s}<SpeciesIcon {s} size={34} />{/if}
            <span class="fill"><span style:width={css(p.cover)}></span></span>
          </span>
        {/each}
      </div>
    </section>
  {/if}
  {#each sides as g (g.title)}
    <section>
      <h4>{g.title}</h4>
      <div class="icons">
        {#each g.list as a (`${a.name}:${a.owner}`)}
          {@const s = byName.get(a.name)}
          <span class="tile p{a.owner}" title="{label(a.name)} × {a.count}">
            {#if s}<SpeciesIcon {s} size={34} />{/if}
            <span class="count">{a.count}</span>
          </span>
        {/each}
      </div>
    </section>
  {/each}
</aside>

<style>
  .cell {
    width: 340px;
    padding: 0 0 10px;
    font-size: 0.9em;
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 10px 12px;
    background: linear-gradient(
      90deg,
      color-mix(in srgb, var(--player, #8a8a7a) 45%, transparent),
      transparent
    );
    border-top: 3px solid var(--player, var(--gold));
  }
  .cell.p0 header {
    --player: #9a9a86;
  }
  .who {
    display: grid;
    flex: 1;
    gap: 6px;
  }
  .who strong {
    font-size: 1.35em;
    letter-spacing: 0.01em;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.12);
    font-weight: 700;
    font-size: 0.9em;
  }
  .chip.good {
    background: rgba(127, 176, 79, 0.45);
  }
  .chip.warn {
    background: rgba(214, 170, 60, 0.5);
  }
  .chip.danger {
    background: rgba(216, 57, 43, 0.6);
  }
  .chip.dead {
    background: rgba(168, 158, 144, 0.4);
  }
  .ib {
    padding: 4px;
    border: 0;
    background: none;
    color: inherit;
    cursor: var(--cursor-pointer);
    opacity: 0.8;
  }
  section {
    padding: 8px 12px 0;
  }
  h4 {
    margin: 0 0 6px;
    font-size: 0.78em;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    opacity: 0.65;
  }
  .row {
    display: grid;
    grid-template-columns: 92px 1fr 44px;
    align-items: center;
    gap: 8px;
    margin: 5px 0;
  }
  .name {
    font-weight: 700;
  }
  .bar {
    height: 12px;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.1);
    overflow: hidden;
  }
  .bar > span {
    display: block;
    height: 100%;
    border-radius: 6px;
  }
  .bar.soil > span {
    background: linear-gradient(90deg, #8b6a43, #c49a5c);
  }
  .bar.push > span {
    background: linear-gradient(90deg, #b8402e, #e2452b);
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
    opacity: 0.9;
  }
  .icons {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .tile {
    position: relative;
    display: grid;
    justify-items: center;
    gap: 3px;
  }
  .fill {
    width: 34px;
    height: 4px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.12);
    overflow: hidden;
  }
  .fill > span {
    display: block;
    height: 100%;
    background: #9cc65a;
  }
  .count {
    position: absolute;
    right: -6px;
    bottom: -4px;
    min-width: 18px;
    padding: 0 5px;
    border-radius: 999px;
    background: rgba(20, 24, 20, 0.85);
    box-shadow: 0 0 0 1.5px var(--player);
    font-size: 0.8em;
    font-weight: 800;
    text-align: center;
  }
  .vs {
    grid-column: span 2;
    font-variant-numeric: tabular-nums;
  }
  .vs .over {
    color: var(--threat);
  }
</style>
