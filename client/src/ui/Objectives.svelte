<script lang="ts">
  // Tutorial objectives (M5a 8b, D-139): the current one with its tip, a Next button on the
  // explanation steps, progress dots; at the end, a short well-done with the way out.
  import { OBJECTIVES } from "../game/tutorial";
  import Icon from "./Icon.svelte";

  let {
    step,
    onMenu,
    onNext,
  }: { step: number; onMenu: () => void; onNext: (step: number) => void } = $props();
  const current = $derived(OBJECTIVES[step]);
</script>

<aside class="objectives panel" aria-live="polite" aria-label="Tutorial">
  <span class="head">
    Tutorial
    <span class="dots" aria-label="{Math.min(step, OBJECTIVES.length)} of {OBJECTIVES.length} done">
      {#each OBJECTIVES as o, i (o.title)}
        <span class="dot" class:done={i < step} class:now={i === step}></span>
      {/each}
    </span>
  </span>
  {#if current}
    <strong>{current.title}</strong>
    <p>{current.text}</p>
    {#if current.tip}<p class="tip">{current.tip}</p>{/if}
    {#if current.ack}<button class="btn next" onclick={() => onNext(step)}>Next</button>{/if}
  {:else}
    <strong><Icon name="heart" size={14} /> Tutorial complete</strong>
    <p>
      You know the basics. Keep playing to beat the bot, or go back to the menu for a full match.
    </p>
    <button class="btn" onclick={onMenu}>Main menu</button>
  {/if}
</aside>

<style>
  .objectives {
    position: absolute;
    top: 100px; /* below the clock and speed bar (D-175) */
    left: 18px;
    z-index: 4;
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: min(300px, calc(100vw - 36px));
    padding: 10px 14px 12px;
  }
  .tip {
    font-size: 0.82em;
    font-style: italic;
    color: var(--ink-soft);
  }
  .next {
    align-self: flex-end;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 0.68em;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  .dots {
    display: flex;
    gap: 4px;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--line);
  }
  .dot.done {
    background: var(--gold);
  }
  .dot.now {
    box-shadow: 0 0 0 1.5px var(--gold);
  }
  strong {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--gold);
  }
  p {
    margin: 0;
    font-size: 0.85em;
    line-height: 1.4;
    color: var(--ink);
  }
  .btn {
    align-self: flex-start;
    margin-top: 6px;
  }
</style>
