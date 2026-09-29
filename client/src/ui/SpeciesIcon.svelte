<script module lang="ts">
  import { SvelteSet } from "svelte/reactivity";

  /** Species without an icon file, learned once per session (no repeated failed requests). */
  const missing = new SvelteSet<string>();
</script>

<script lang="ts">
  // Species icon slot (D-048). Drop a square image with a transparent background, 128 px or more,
  // at client/public/icons/species/<species name>.webp (e.g. tawny_owl.webp) and every card shows
  // it; until then the slot shows the placeholder glyph on the species' stratum or role colour.
  import { glyph } from "../game/species";
  import type { Species } from "../replay/replay";

  let { s, size = 44 }: { s: Species; size?: number } = $props();
  const tone = $derived(s.kind === "flora" ? `l${s.level}` : s.role);
</script>

<span class="icon {tone}" style:--size="{size}px" aria-hidden="true">
  <span class="glyph">{glyph(s)}</span>
  {#if !missing.has(s.name)}
    <img src="icons/species/{s.name}.webp" alt="" onerror={() => missing.add(s.name)} />
  {/if}
</span>

<style>
  .icon {
    position: relative;
    display: inline-grid;
    place-items: center;
    flex: none;
    width: var(--size);
    height: var(--size);
    border-radius: calc(var(--size) * 0.22);
    background: radial-gradient(circle at 35% 30%, var(--hi), var(--lo));
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.25),
      inset 0 -2px 4px rgba(0, 0, 0, 0.35),
      0 0 0 1px rgba(0, 0, 0, 0.45);
    overflow: hidden;
  }
  .glyph {
    font-size: calc(var(--size) * 0.5);
    line-height: 1;
    color: rgba(255, 255, 255, 0.85);
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
  }
  img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  /* Placeholder tones: flora by stratum, fauna by role. */
  .l1 {
    --hi: #a6d17a;
    --lo: #4e7a34;
  }
  .l2 {
    --hi: #6fae58;
    --lo: #2f5a26;
  }
  .l3 {
    --hi: #4c8a45;
    --lo: #1b3b1d;
  }
  .decomposer {
    --hi: #b08a62;
    --lo: #5a4028;
  }
  .herbivore {
    --hi: #d2b25a;
    --lo: #7a5a1c;
  }
  .predator {
    --hi: #d0695a;
    --lo: #6e2219;
  }
</style>
