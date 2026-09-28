<script lang="ts">
  // What the placeholder shapes mean, with a visibility toggle per layer (D-028).
  import type { Layer } from "../render/viewer";

  let { layers, toggle }: { layers: Record<Layer, boolean>; toggle: (l: Layer) => void } = $props();

  const items: { layer: Layer; shape: string; label: string }[] = [
    { layer: "territory", shape: "▦", label: "Territory tint" },
    { layer: "L1", shape: "•", label: "L1 herbaceous (dots)" },
    { layer: "L2", shape: "▲", label: "L2 shrubs (cones)" },
    { layer: "L3", shape: "■", label: "L3 trees (cubes)" },
    { layer: "animals", shape: "●▴", label: "Animals: herbivores, decomposers, predators" },
  ];
</script>

<aside class="panel legend" aria-label="Legend and layers">
  {#each items as it (it.layer)}
    <label>
      <input type="checkbox" checked={layers[it.layer]} onchange={() => toggle(it.layer)} />
      <span class="shape" aria-hidden="true">{it.shape}</span>
      {it.label}
    </label>
  {/each}
  <p class="players"><span class="p1">■</span> P1 <span class="p2">■</span> P2</p>
</aside>

<style>
  .legend {
    position: absolute;
    left: 12px;
    top: 64px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 0.9em;
  }
  label {
    display: flex;
    gap: 6px;
    align-items: center;
    cursor: pointer;
  }
  .shape {
    width: 1.6em;
    text-align: center;
  }
  .players {
    margin: 4px 0 0;
  }
  .p1 {
    color: var(--p1);
  }
  .p2 {
    color: var(--p2);
  }
</style>
