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

<aside class="panel cell p{info.owner}" aria-label="Selected cell">
  <header>
    <h2>Cell {info.row} · {info.col}</h2>
    <button class="x" onclick={onClose} aria-label="Close">✕</button>
  </header>
  <p class="line">
    <span class="dot p{info.owner}"></span>
    {owner}
    <span class="muted">· soil</span>
    <span class="bar"><span style:width={pct(info.soil)}></span></span>
    <span class="muted">{pct(info.soil)}</span>
  </p>

  <h3 class="label">Plants</h3>
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

  <h3 class="label">Animals</h3>
  {#each info.animals as a (`${a.name}:${a.owner}`)}
    <p class="line">
      <span class="dot p{a.owner}"></span>
      <span class="name">{label(a.name)}</span>
      <span class="num">× {a.count}</span>
    </p>
  {:else}
    <p class="muted">None here right now.</p>
  {/each}

  <button class="btn zoom" onclick={onZoom}>Zoom to plant scale</button>
</aside>

<style>
  .cell {
    position: absolute;
    top: 74px;
    right: 14px;
    width: 270px;
    font-size: 0.88em;
    border-top: 2px solid var(--player, var(--gold));
  }
  header {
    display: flex;
    align-items: center;
  }
  h2 {
    margin: 0;
    font-size: 1.05em;
    font-weight: 800;
  }
  h3 {
    margin: 12px 0 4px;
  }
  .x {
    margin-left: auto;
    border: 0;
    background: none;
    cursor: pointer;
    color: var(--ink-soft);
  }
  .x:hover {
    color: var(--ink);
  }
  .line {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 3px 0;
  }
  .name {
    flex: 1;
  }
  .num {
    font-variant-numeric: tabular-nums;
    min-width: 3.2em;
    text-align: right;
    font-weight: 700;
  }
  .bar {
    width: 70px;
    height: 7px;
    background: var(--well);
    border-radius: 4px;
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: linear-gradient(90deg, #6f9f4e, var(--good));
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #777;
    box-shadow: 0 0 6px currentColor;
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
    color: var(--p1-glow);
  }
  .glyph.p2 {
    color: var(--p2-glow);
  }
  .muted {
    margin: 0;
  }
  .zoom {
    margin-top: 12px;
    width: 100%;
  }
</style>
