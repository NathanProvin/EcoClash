<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { loadReplay, type Replay } from "./replay/replay";
  import { Viewer, type Layer } from "./render/viewer";
  import Hud from "./ui/Hud.svelte";
  import Legend from "./ui/Legend.svelte";
  import Timeline from "./ui/Timeline.svelte";

  let canvas: HTMLCanvasElement;
  let replays: string[] = $state([]);
  let chosen = $state("");
  let replay: Replay | undefined = $state();
  let viewer: Viewer | undefined;
  let backend = $state("");
  let error = $state("");
  let tick = $state(0);
  let playing = $state(true);
  let speed = $state(4);
  let layers: Record<Layer, boolean> = $state({
    territory: true,
    L1: true,
    L2: true,
    L3: true,
    animals: true,
  });

  let raf = 0;
  let last = 0;

  function frame(now: number) {
    const r = replay;
    if (r && viewer) {
      if (playing) {
        tick = Math.min(tick + ((now - last) / 1000 / r.meta.dt) * speed, r.meta.ticks - 1);
        if (tick >= r.meta.ticks - 1) playing = false;
      }
      viewer.render(tick);
    }
    last = now;
    raf = requestAnimationFrame(frame);
  }

  async function open(name: string) {
    error = "";
    viewer?.dispose();
    viewer = undefined;
    try {
      replay = await loadReplay(`replays/${name}`);
      viewer = await Viewer.create(canvas, replay);
      backend = viewer.backend;
      viewer.resize();
      for (const [layer, on] of Object.entries(layers)) viewer.setVisible(layer as Layer, on);
      tick = 0;
      playing = true;
    } catch (e) {
      error = String(e);
    }
  }

  function toggle(layer: Layer) {
    layers[layer] = !layers[layer];
    viewer?.setVisible(layer, layers[layer]);
  }

  function onKey(e: KeyboardEvent) {
    if (e.code === "Space" && e.target === document.body) {
      e.preventDefault();
      playing = !playing;
    }
  }

  const resize = () => viewer?.resize();

  async function start() {
    try {
      const res = await fetch("replays/index.json");
      replays = res.ok ? ((await res.json()) as string[]) : [];
    } catch {
      replays = [];
    }
    if (replays[0]) {
      chosen = replays[0];
      await open(chosen);
    }
  }

  onMount(() => {
    window.addEventListener("resize", resize);
    raf = requestAnimationFrame(frame);
    void start();
  });

  onDestroy(() => {
    window.removeEventListener("resize", resize);
    cancelAnimationFrame(raf);
    viewer?.dispose();
  });
</script>

<svelte:window onkeydown={onKey} />

<main>
  <canvas bind:this={canvas} aria-label="Match replay"></canvas>

  {#if !replays.length}
    <div class="panel empty">
      <h1>No replay yet</h1>
      <p>Generate one from the Python prototype, then reload:</p>
      <code>npm run proto -- --replay</code>
    </div>
  {:else}
    <header class="panel top">
      <strong>EcoClash</strong>
      <label>
        Replay
        <select bind:value={chosen} onchange={() => open(chosen)}>
          {#each replays as name (name)}<option value={name}>{name}</option>{/each}
        </select>
      </label>
      {#if backend}<span class="muted">renderer: {backend}</span>{/if}
    </header>

    {#if replay}
      <Hud {replay} {tick} />
      <Legend {layers} {toggle} />
      <Timeline {replay} bind:tick bind:playing bind:speed />
    {/if}
    {#if error}<p class="panel error" role="alert">{error}</p>{/if}
  {/if}
</main>

<style>
  main {
    position: relative;
    height: 100%;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
  .top {
    position: absolute;
    top: 12px;
    left: 12px;
    display: flex;
    gap: 16px;
    align-items: center;
  }
  .muted {
    color: var(--ink-soft);
    font-size: 0.85em;
  }
  .empty {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    text-align: center;
  }
  .error {
    position: absolute;
    bottom: 96px;
    left: 12px;
    color: #a3261b;
  }
</style>
