<script lang="ts">
  // Tutorial objectives (M5a 8b, D-139): the current one as short bullets with its tip, a Next
  // button on the explanation steps, progress dots; at the end, a short well-done with the way
  // out. Back and forward arrows review earlier steps (D-261): `back` steps behind the current
  // one, reset when the tutorial moves on.
  import { OBJECTIVES } from "../game/tutorial";
  import Icon from "./Icon.svelte";

  let {
    step,
    back = $bindable(0),
    onMenu,
    onNext,
  }: {
    step: number;
    back?: number;
    onMenu: () => void;
    onNext: (step: number) => void;
  } = $props();
  const shown = $derived(Math.max(0, Math.min(step, OBJECTIVES.length) - back));
  const current = $derived(OBJECTIVES[shown]);
  const reviewing = $derived(shown < step);
  $effect(() => {
    void step; // a new step brings the view back to it
    back = 0;
  });
</script>

<aside class="objectives panel" aria-live="polite" aria-label="Tutorial">
  <span class="head">
    Tutorial
    <span class="dots" aria-label="{Math.min(step, OBJECTIVES.length)} of {OBJECTIVES.length} done">
      {#each OBJECTIVES as o, i (o.title)}
        <span class="dot" class:done={i < step} class:now={i === shown}></span>
      {/each}
    </span>
  </span>
  {#if current && (reviewing || step < OBJECTIVES.length)}
    <strong
      >{current.title}{#if reviewing}<small class="done-mark">done</small>{/if}</strong
    >
    <ul>
      {#each current.text as line, i (i)}<li>{line}</li>{/each}
    </ul>
    {#if current.tip}<p class="tip">{current.tip}</p>{/if}
    <span class="nav">
      <button
        class="btn arrow"
        disabled={shown === 0}
        title="Previous step"
        aria-label="Previous step"
        onclick={() => back++}>‹</button
      >
      {#if reviewing}
        <button class="btn arrow" title="Next step" aria-label="Next step" onclick={() => back--}
          >›</button
        >
      {:else if current.ack}
        <button class="btn next" onclick={() => onNext(step)}>Next</button>
      {/if}
    </span>
  {:else}
    <strong><Icon name="heart" size={14} /> Tutorial complete</strong>
    <p>
      You know the basics. Keep playing to beat the bot, or go back to the menu for a full match.
    </p>
    <span class="nav">
      <button
        class="btn arrow"
        title="Previous step"
        aria-label="Previous step"
        onclick={() => back++}>‹</button
      >
      <button class="btn" onclick={onMenu}>Main menu</button>
    </span>
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
  ul {
    margin: 0;
    padding-left: 16px;
    font-size: 0.85em;
    line-height: 1.4;
  }
  li + li {
    margin-top: 2px;
  }
  li::marker {
    color: var(--gold);
  }
  .nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .nav .btn {
    margin-top: 6px;
  }
  .arrow {
    min-width: 30px;
    padding: 2px 8px;
    font-size: 1.1em;
    line-height: 1.2;
  }
  .arrow:disabled {
    opacity: 0.35;
  }
  .done-mark {
    margin-left: 6px;
    font-size: 0.7em;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-soft);
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
