<script lang="ts">
  // Unit card (D-161): one animal or a group, read at a glance, in the cell card's style. The
  // species and its owner, a fullness bar, the order it follows, its speed, what it eats and what
  // hunts it. Names in tooltips.
  import { related } from "../game/foodweb";
  import { label, roleName } from "../game/species";
  import { ORDER_TEXT, type UnitCard } from "../game/units";
  import type { Species } from "../replay/replay";
  import { CELL } from "../render/layout";
  import Icon from "./Icon.svelte";
  import SpeciesIcon from "./SpeciesIcon.svelte";

  let {
    card,
    species,
    all,
    me,
    onClose,
  }: {
    card: UnitCard;
    species: Species;
    all: Species[];
    me: number;
    onClose: () => void;
  } = $props();

  const web = $derived(related(species, all));
  const pct = (v: number) => `${Math.round(v * 100)} %`;
  const css = (v: number) => `${Math.round(Math.min(Math.max(v, 0), 1) * 100)}%`;
  const whose = $derived(card.owner === me ? "Yours" : "Enemy");
  const speed = $derived(((species.stats.speed ?? 0) * CELL).toFixed(1));
</script>

<aside class="panel unit p{card.owner}" aria-label="Selected animal">
  <header>
    <SpeciesIcon s={species} size={40} />
    <div class="title">
      <strong>{label(species.name)}{card.count > 1 ? ` ×${card.count}` : ""}</strong>
      <span class="sub">
        <span class="dot p{card.owner}"></span>{whose} · {roleName(species.role)}
      </span>
    </div>
    <button class="ib" onclick={onClose} title="Close" aria-label="Close">
      <Icon name="close" size={15} />
    </button>
  </header>

  <div class="row" title="How full: a fed animal breeds, a hungry one starves">
    <span class="name">Fullness</span>
    <span class="bar"><span style:width={css(card.full)}></span></span>
    <span class="num">{pct(card.full)}</span>
  </div>
  <div class="facts">
    <span class="fact order o{card.order}">{ORDER_TEXT[card.order] ?? "Free"}</span>
    <span class="fact" title="Top speed">{speed} m/s</span>
  </div>

  {#if web.foods.length}
    <div class="list" aria-label="Eats">
      <span class="name">Eats</span>
      {#each web.foods as f (f.s.name)}
        <span class="sp" title={label(f.s.name)}><SpeciesIcon s={f.s} size={24} /></span>
      {/each}
    </div>
  {/if}
  {#if web.eaters.length}
    <div class="list" aria-label="Hunted by">
      <span class="name">Hunted by</span>
      {#each web.eaters as e (e.s.name)}
        <span class="sp" title={label(e.s.name)}><SpeciesIcon s={e.s} size={24} /></span>
      {/each}
    </div>
  {/if}
</aside>

<style>
  .unit {
    width: 300px;
    padding: 10px 12px;
    font-size: 0.86em;
    border-top: 3px solid var(--player, var(--gold));
  }
  header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
  }
  .title {
    display: grid;
    flex: 1;
    gap: 2px;
  }
  .title strong {
    font-size: 1.15em;
  }
  .sub {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    opacity: 0.8;
  }
  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--player);
  }
  .ib {
    padding: 3px;
    border: 0;
    background: none;
    color: inherit;
    cursor: var(--cursor-pointer);
    opacity: 0.75;
  }
  .row {
    display: grid;
    grid-template-columns: 74px 1fr 42px;
    align-items: center;
    gap: 8px;
    margin: 6px 0;
  }
  .name {
    font-weight: 700;
    opacity: 0.85;
  }
  .bar {
    height: 10px;
    border-radius: 5px;
    background: rgba(255, 255, 255, 0.12);
    overflow: hidden;
  }
  .bar > span {
    display: block;
    height: 100%;
    border-radius: 5px;
    background: linear-gradient(90deg, #c9a43b, #7fb04f);
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .facts {
    display: flex;
    gap: 8px;
    margin: 8px 0;
  }
  .fact {
    padding: 2px 9px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.1);
    font-weight: 700;
  }
  .order.o1 {
    background: rgba(201, 205, 210, 0.3);
  }
  .order.o2 {
    background: rgba(226, 69, 43, 0.45);
  }
  .list {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 5px;
    margin-top: 6px;
  }
  .list .name {
    width: 74px;
  }
</style>
