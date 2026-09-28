<script lang="ts">
  // Cell inspector (D-031): what grows and lives on the clicked cell, with a zoom to plant scale.
  import { label } from "../game/species";
  import type { CellInfo } from "../replay/replay";

  let { info, onZoom, onClose }: { info: CellInfo; onZoom: () => void; onClose: () => void } =
    $props();

  const glyph = (level: number) => ["•", "▲", "■"][level - 1] ?? "•";
  const pct = (v: number) => `${Math.round(v * 100)} %`;
  const owner = $derived(info.owner ? `P${info.owner}` : "Nobody");
</script>

<aside class="panel cell" aria-label="Selected cell">
  <header>
    <h2>Cell {info.row} · {info.col}</h2>
    <button class="x" onclick={onClose} aria-label="Close">×</button>
  </header>
  <p class="line">
    <span class="dot p{info.owner}"></span>
    {owner}
    <span class="muted">· soil</span>
    <span class="bar"><span style:width={pct(info.soil)}></span></span>
    <span class="muted">{pct(info.soil)}</span>
  </p>

  <h3>Plants</h3>
  {#each info.plants as p (p.name)}
    <p class="line">
      <span class="glyph p{info.owner}">{glyph(p.level)}</span>
      <span class="name">{label(p.name)}</span>
      <span class="bar"><span style:width={pct(p.cover)}></span></span>
      <span class="num">{pct(p.cover)}</span>
    </p>
  {:else}
    <p class="muted">Bare ground.</p>
  {/each}

  <h3>Animals</h3>
  {#each info.animals as a (`${a.name}:${a.owner}`)}
    <p class="line">
      <span class="dot p{a.owner}"></span>
      <span class="name">{label(a.name)}</span>
      <span class="num">× {a.count}</span>
    </p>
  {:else}
    <p class="muted">None here right now.</p>
  {/each}

  <button class="zoom" onclick={onZoom}>Zoom to plant scale</button>
</aside>

<style>
  .cell {
    position: absolute;
    top: 56px;
    right: 16px;
    width: 260px;
    font-size: 0.88em;
  }
  header {
    display: flex;
    align-items: center;
  }
  h2 {
    margin: 0;
    font-size: 1em;
  }
  h3 {
    margin: 10px 0 4px;
    font-size: 0.8em;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-soft);
  }
  .x {
    margin-left: auto;
    border: 0;
    background: none;
    font-size: 1.3em;
    cursor: pointer;
    color: var(--ink-soft);
  }
  .line {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 2px 0;
  }
  .name {
    flex: 1;
  }
  .num {
    font-variant-numeric: tabular-nums;
    min-width: 3.2em;
    text-align: right;
  }
  .bar {
    width: 70px;
    height: 6px;
    background: #e6e6e0;
    border-radius: 3px;
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: #7aa37e;
  }
  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: #bbb;
  }
  .dot.p1 {
    background: var(--p1);
  }
  .dot.p2 {
    background: var(--p2);
  }
  .glyph {
    width: 1.1em;
    text-align: center;
  }
  .glyph.p1 {
    color: var(--p1);
  }
  .glyph.p2 {
    color: var(--p2);
  }
  .muted {
    color: var(--ink-soft);
    margin: 0;
  }
  .zoom {
    margin-top: 10px;
    width: 100%;
    border: 1px solid var(--line);
    background: white;
    border-radius: 6px;
    padding: 5px 8px;
    cursor: pointer;
  }
</style>
