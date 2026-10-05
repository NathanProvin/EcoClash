<script lang="ts">
  // Cell inspector (D-031, D-100): a compact card read at a glance. Icons and bars, names in
  // tooltips: owner and ground, a health dot (thriving / pushed / attacked), the cover of each
  // height stratum, soil, the enemy push, a lockout badge (D-098), then the plants and the
  // animals on the cell as species icons with their cover or head count.
  import { cellStatus, STATUS_TEXT } from "../game/cell";
  import { label } from "../game/species";
  import type { CellInfo, Species } from "../replay/replay";
  import Icon from "./Icon.svelte";
  import SpeciesIcon from "./SpeciesIcon.svelte";

  let {
    info,
    species,
    onZoom,
    onClose,
  }: { info: CellInfo; species: Species[]; onZoom: () => void; onClose: () => void } = $props();

  const STRATA = [
    { glyph: "•", name: "Herbs" },
    { glyph: "♣", name: "Undergrowth" },
    { glyph: "▲", name: "Shrubs" },
    { glyph: "■", name: "Trees" },
  ] as const;
  const GROUND = [
    { icon: "land", name: "Land" },
    { icon: "water", name: "Shallows" },
    { icon: "water", name: "Deep water" },
    { icon: "rock", name: "Rock" },
  ] as const;

  const pct = (v: number) => `${Math.round(v * 100)} %`; // for reading
  const css = (v: number) => `${Math.round(Math.min(Math.max(v, 0), 1) * 100)}%`; // for sizes
  const byName = $derived(new Map(species.map((s) => [s.name, s])));
  const status = $derived(cellStatus(info));
  const ground = $derived(GROUND[info.ground] ?? GROUND[0]);
  const owner = $derived(info.owner ? `Held by P${info.owner}` : "Nobody holds it");
  const animals = $derived(
    [...info.animals].sort((a, b) => a.owner - b.owner || b.count - a.count),
  );
</script>

<aside class="panel cell p{info.owner}" aria-label="Selected cell">
  <header>
    <span class="dot p{info.owner}" title={owner}></span>
    <span class="chip" title={ground.name}><Icon name={ground.icon} size={15} /></span>
    <span class="chip {status}" title={STATUS_TEXT[status]}><Icon name="heart" size={15} /></span>
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
        ><Icon name="deadtree" size={15} /></span
      >
    {/if}
    <span class="gap"></span>
    <button class="ib" onclick={onZoom} title="Zoom to plant scale" aria-label="Zoom">
      <Icon name="zoom" size={15} />
    </button>
    <button class="ib" onclick={onClose} title="Close" aria-label="Close">
      <Icon name="close" size={15} />
    </button>
  </header>

  <div class="strata">
    {#each STRATA as s, i (s.name)}
      <span class="stratum" title="{s.name}: {pct(info.strata[i] ?? 0)}">
        <span class="column"><span style:height={css(info.strata[i] ?? 0)}></span></span>
        <span class="glyph">{s.glyph}</span>
      </span>
    {/each}
    <span class="meters">
      <span class="meter" title="Soil development: {pct(info.soil)}">
        <Icon name="soil" size={14} />
        <span class="bar soil"><span style:width={css(info.soil)}></span></span>
      </span>
      <span class="meter" title="Enemy push: {pct(info.push)}">
        <Icon name="push" size={14} />
        <span class="bar push"><span style:width={css(info.push)}></span></span>
      </span>
    </span>
  </div>

  {#if info.plants.length}
    <div class="icons">
      {#each info.plants as p (p.name)}
        {@const s = byName.get(p.name)}
        <span class="tile" title="{label(p.name)}: {pct(p.cover)}">
          {#if s}<SpeciesIcon {s} size={26} />{/if}
          <span class="fill"><span style:width={css(p.cover)}></span></span>
        </span>
      {/each}
    </div>
  {/if}
  {#if animals.length}
    <div class="icons">
      {#each animals as a (`${a.name}:${a.owner}`)}
        {@const s = byName.get(a.name)}
        <span class="tile p{a.owner}" title="{label(a.name)} × {a.count} (P{a.owner})">
          {#if s}<SpeciesIcon {s} size={26} />{/if}
          <span class="count">{a.count}</span>
        </span>
      {/each}
    </div>
  {/if}
</aside>

<style>
  .cell {
    position: absolute;
    top: 74px;
    right: 14px;
    width: 214px;
    padding: 8px 10px;
    font-size: 0.82em;
    border-top: 2px solid var(--player, var(--gold));
  }
  header {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .gap {
    flex: 1;
  }
  .dot {
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: #777;
  }
  .dot.p1 {
    background: var(--p1);
  }
  .dot.p2 {
    background: var(--p2);
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    color: var(--ink-soft);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .chip.good {
    color: var(--good);
  }
  .chip.warn {
    color: var(--gold);
  }
  .chip.danger {
    color: var(--alert, #ff7a5c);
  }
  .chip.dead {
    color: #b8ab98;
  }
  .chip.lock.p1 {
    color: var(--p1-glow);
  }
  .chip.lock.p2 {
    color: var(--p2-glow);
  }
  .ib {
    display: inline-flex;
    padding: 2px;
    border: 0;
    background: none;
    cursor: var(--cursor-pointer);
    color: var(--ink-soft);
  }
  .ib:hover {
    color: var(--ink);
  }
  .strata {
    display: flex;
    align-items: flex-end;
    gap: 5px;
    margin: 8px 0 4px;
  }
  .stratum {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
  }
  .column {
    display: flex;
    align-items: flex-end;
    width: 9px;
    height: 30px;
    background: var(--well);
    border-radius: 3px;
    overflow: hidden;
  }
  .column span {
    display: block;
    width: 100%;
    background: linear-gradient(0deg, #6f9f4e, var(--good));
  }
  .glyph {
    font-size: 0.75em;
    line-height: 1;
    color: var(--ink-soft);
  }
  .meters {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 6px;
    margin-left: 6px;
    color: var(--ink-soft);
  }
  .meter {
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .bar {
    flex: 1;
    height: 6px;
    background: var(--well);
    border-radius: 3px;
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
  }
  .bar.soil span {
    background: #9b7a4f;
  }
  .bar.push span {
    background: var(--alert, #ff7a5c);
  }
  .icons {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 6px;
  }
  .tile {
    position: relative;
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    border-radius: 8px;
  }
  .tile.p1 {
    box-shadow: 0 0 0 2px var(--p1);
  }
  .tile.p2 {
    box-shadow: 0 0 0 2px var(--p2);
  }
  .fill {
    width: 26px;
    height: 3px;
    margin-top: 2px;
    background: var(--well);
    border-radius: 2px;
    overflow: hidden;
  }
  .fill span {
    display: block;
    height: 100%;
    background: var(--good);
  }
  .count {
    position: absolute;
    right: -4px;
    bottom: -4px;
    min-width: 14px;
    padding: 0 3px;
    border-radius: 7px;
    background: rgba(0, 0, 0, 0.7);
    color: #fff;
    font-size: 0.72em;
    font-weight: 800;
    text-align: center;
  }
</style>
