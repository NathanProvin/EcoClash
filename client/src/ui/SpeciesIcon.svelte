<script module lang="ts">
  import { SvelteSet } from "svelte/reactivity";

  /** Species without an icon file, learned once per session (no repeated failed requests). */
  const missing = new SvelteSet<string>();
</script>

<script lang="ts">
  // Species icon slot (D-048). Drop a square image with a transparent background, 128 px or more,
  // at client/public/icons/species/<species name>.webp (e.g. tawny_owl.webp) and every card shows
  // it; until then the slot shows the species' silhouette on its family's tile (D-167).
  import type { Species } from "../replay/replay";
  import FamilyIcon from "./FamilyIcon.svelte";

  let { s, size = 44 }: { s: Species; size?: number } = $props();
  let loaded = $state(false); // no broken-image flash while a missing file is being tried
</script>

<span class="icon" aria-hidden="true">
  <FamilyIcon family={s.family} {size} glyph={s.name} />
  {#if !missing.has(s.name)}
    <img
      class:loaded
      src="icons/species/{s.name}.webp"
      alt=""
      onload={() => (loaded = true)}
      onerror={() => missing.add(s.name)}
    />
  {/if}
</span>

<style>
  .icon {
    position: relative;
    display: inline-grid;
    flex: none;
  }
  img {
    visibility: hidden;
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  img.loaded {
    visibility: visible;
  }
</style>
