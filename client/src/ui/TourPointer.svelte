<script lang="ts">
  // Tutorial pointer (D-139): a pulsing gold ring around the control the current step names (the
  // first `data-tour` key of the list that is on screen), with a small arrow above it. The rect is
  // read again four times a second, so the ring follows opened menus and flyouts.
  import { onDestroy } from "svelte";

  let { targets }: { targets: string[] | undefined } = $props();

  /** Space between the control and the ring (px). */
  const PAD = 5;
  let box: { x: number; y: number; w: number; h: number } | null = $state(null);

  function locate() {
    for (const key of targets ?? []) {
      const el = document.querySelector(`[data-tour="${key}"]`);
      const r = el?.getBoundingClientRect();
      if (r && r.width > 0) {
        box = { x: r.left - PAD, y: r.top - PAD, w: r.width + 2 * PAD, h: r.height + 2 * PAD };
        return;
      }
    }
    box = null;
  }
  $effect(() => {
    void targets;
    locate();
  });
  const timer = setInterval(locate, 250);
  onDestroy(() => clearInterval(timer));
</script>

<svelte:window onresize={locate} />

{#if box}
  <div
    class="ring"
    style:left="{box.x}px"
    style:top="{box.y}px"
    style:width="{box.w}px"
    style:height="{box.h}px"
    aria-hidden="true"
  >
    <span class="arrow" class:below={box.y < 60}></span>
  </div>
{/if}

<style>
  .ring {
    position: fixed;
    z-index: 30;
    border: 2px solid var(--gold);
    border-radius: 14px;
    box-shadow: 0 0 14px var(--gold-soft);
    pointer-events: none;
    animation: pulse 1.4s ease-in-out infinite;
  }
  /* A small triangle pointing at the control, above it (below for controls at the top). */
  .arrow {
    position: absolute;
    left: 50%;
    top: -14px;
    transform: translateX(-50%);
    border: 7px solid transparent;
    border-top-color: var(--gold);
    animation: bob 1.4s ease-in-out infinite;
  }
  .arrow.below {
    top: auto;
    bottom: -14px;
    border-top-color: transparent;
    border-bottom-color: var(--gold);
  }
  @keyframes pulse {
    50% {
      box-shadow: 0 0 22px var(--gold-soft);
      transform: scale(1.04);
    }
  }
  @keyframes bob {
    50% {
      translate: 0 -3px;
    }
  }
</style>
