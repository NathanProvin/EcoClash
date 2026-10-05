<script lang="ts">
  // Catastrophe deck (D-129): the last item of the build bar. Its flyout holds the cards: ready
  // ones in full colour (gold cost when affordable), cooling ones grey under a sweep with the
  // seconds left. Clicking a ready card arms it; the next map click plays it.
  import { cardStatus, CATASTROPHE_LOOK, type Catastrophe } from "../game/catastrophes";
  import { label } from "../game/species";
  import FamilyIcon from "./FamilyIcon.svelte";
  import Icon from "./Icon.svelte";

  let {
    cards,
    waits,
    bank,
    armed,
    onArm,
  }: {
    cards: Catastrophe[];
    /** Seconds before each card is ready again (table order). */
    waits: number[];
    bank: number;
    armed: string | null;
    onArm: (name: string) => void;
  } = $props();

  let open = $state(false);
  let hover: Catastrophe | null = $state(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const enter = () => {
    clearTimeout(timer);
    open = true;
  };
  const leave = () => {
    timer = setTimeout(() => {
      open = false;
      hover = null;
    }, 120);
  };
</script>

{#if cards.length}
  <span class="sep" aria-hidden="true"></span>
  <div class="group" role="group" onpointerenter={enter} onpointerleave={leave}>
    <button
      class="item"
      class:open
      class:armed={armed !== null}
      aria-expanded={open}
      aria-label="Catastrophes"
      title="Catastrophes"
      onclick={() => (open = !open)}
    >
      <FamilyIcon family="C" size={40} />
    </button>
    {#if open}
      <div class="flyout panel" role="menu" aria-label="Catastrophes">
        <span class="fh">Catastrophes</span>
        <div class="cards">
          {#each cards as c, i (c.name)}
            {@const st = cardStatus(c, waits[i] ?? 0, bank)}
            {@const look = CATASTROPHE_LOOK[c.act] ?? { icon: "storm" as const, color: "#888" }}
            <button
              class="card"
              class:cooling={st.left > 0}
              class:armed={armed === c.name}
              style:--tone={look.color}
              disabled={!st.ready}
              onclick={() => onArm(c.name)}
              onpointerenter={() => (hover = c)}
              onpointerleave={() => (hover = null)}
              aria-label={label(c.name)}
            >
              <Icon name={look.icon} size={26} />
              {#if st.left > 0}
                <span class="sweep" style:--left="{st.left * 360}deg"></span>
                <span class="secs num">{Math.ceil(waits[i] ?? 0)}s</span>
              {/if}
              <span class="cost num" class:gold={st.affordable}>{c.cost / 1000}k</span>
            </button>
          {/each}
        </div>
        {#if hover}
          <div class="tip panel">
            <strong>{label(hover.name)}</strong>
            <span>{hover.effect}</span>
            <span class="muted"
              >{hover.cost} biomass · radius {hover.radius} cells · cooldown {Math.round(
                hover.cooldown_s / 60,
              )} min · hits both sides</span
            >
          </div>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .sep {
    width: 1px;
    align-self: stretch;
    margin: 6px 4px;
    background: var(--line);
  }
  .group {
    position: relative;
  }
  .item {
    display: flex;
    padding: 2px;
    border: 1px solid transparent;
    border-radius: 12px;
    background: none;
    cursor: var(--cursor-pointer);
  }
  .item:hover,
  .item.open,
  .item.armed {
    border-color: var(--gold);
  }
  .flyout {
    position: absolute;
    bottom: calc(100% + 10px);
    right: 0;
    z-index: 4;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px 8px 8px;
    width: max-content;
  }
  .fh {
    font-size: 0.66em;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-soft);
    text-align: center;
  }
  .cards {
    display: flex;
    gap: 6px;
  }
  .card {
    position: relative;
    display: grid;
    place-items: center;
    width: 54px;
    height: 54px;
    border: 1px solid var(--line);
    border-radius: 10px;
    overflow: hidden;
    color: #fff;
    background: radial-gradient(circle at 35% 28%, var(--tone), #2a2622);
    box-shadow: inset 0 0 0 1.5px var(--tone);
    cursor: var(--cursor-pointer);
  }
  .card:disabled {
    cursor: var(--cursor);
    filter: grayscale(0.85);
    opacity: 0.7;
  }
  .card.armed {
    border-color: var(--gold);
    box-shadow: 0 0 12px var(--gold-soft);
  }
  .sweep {
    position: absolute;
    inset: 0;
    background: conic-gradient(rgba(0, 0, 0, 0.6) var(--left), transparent 0);
  }
  .secs {
    position: absolute;
    font-size: 0.75em;
    font-weight: 800;
  }
  .cost {
    position: absolute;
    bottom: 1px;
    right: 4px;
    font-size: 0.62em;
    font-weight: 800;
    color: var(--ink-soft);
  }
  .cost.gold {
    color: var(--gold);
  }
  /* Out of the flyout's flow: growing it would slide the cards from under the pointer, which
     hides the tip again (a flicker loop). */
  .tip {
    position: absolute;
    bottom: calc(100% + 6px);
    right: 0;
    width: 260px;
    padding: 6px 8px;
    pointer-events: none;
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: 0.78em;
  }
  .tip strong {
    color: var(--gold);
  }
  .muted {
    color: var(--ink-soft);
  }
</style>
