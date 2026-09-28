<script lang="ts">
  // RTS shell (D-030): resource bar on top, unit bar at the bottom, full-screen tech tree, and the
  // 3D view in between. Mouse: click = inspect a cell, left-drag = box select, middle-drag =
  // rotate, right-drag = pan, wheel = zoom. Keys: WASD / arrows = pan, Q / E = rotate, Home = reset view, Space = play,
  // T = tech tree, Esc = close / clear selection.
  import { onDestroy, onMount } from "svelte";
  import { loadReplay, type Replay } from "./replay/replay";
  import { Viewer, type CameraKeys, type Layer } from "./render/viewer";
  import BottomBar from "./ui/BottomBar.svelte";
  import CellPanel from "./ui/CellPanel.svelte";
  import TechTree from "./ui/TechTree.svelte";
  import Timeline from "./ui/Timeline.svelte";
  import TopBar from "./ui/TopBar.svelte";

  let canvas: HTMLCanvasElement;
  let replays: string[] = $state([]);
  let chosen = $state("");
  let replay: Replay | undefined = $state();
  let viewer: Viewer | undefined;
  let error = $state("");
  let tick = $state(0);
  let playing = $state(true);
  let speed = $state(4);
  let player: 1 | 2 = $state(1);
  let techOpen = $state(false);
  let selection = $state(new Set<number>());
  let focus: string | null = $state(null);
  let cell = $state<{ row: number; col: number } | null>(null);
  const cellInfo = $derived(replay && cell ? replay.cell(tick, cell.row, cell.col) : null);
  let box: { x0: number; y0: number; x1: number; y1: number } | null = $state(null);
  let layers: Record<Layer, boolean> = $state({
    territory: true,
    L1: true,
    L2: true,
    L3: true,
    animals: true,
  });

  const keys: CameraKeys = {
    forward: false,
    back: false,
    left: false,
    right: false,
    rotateLeft: false,
    rotateRight: false,
  };
  const keyMap: Record<string, keyof CameraKeys> = {
    KeyW: "forward",
    ArrowUp: "forward",
    KeyS: "back",
    ArrowDown: "back",
    KeyA: "left",
    ArrowLeft: "left",
    KeyD: "right",
    ArrowRight: "right",
    KeyQ: "rotateLeft",
    KeyE: "rotateRight",
  };

  const result = $derived.by(() => {
    const r = replay;
    if (!r) return "";
    const end = r.meta.log.find(
      (e) => e.what.startsWith("end:") && e.t_s <= tick * r.meta.dt + 1e-9,
    );
    return end ? `${end.player ? `P${end.player} wins` : "Draw"} — ${end.what.slice(5)}` : "";
  });

  let raf = 0;
  let last = 0;

  function frame(now: number) {
    const r = replay;
    const seconds = Math.min((now - last) / 1000, 0.1);
    if (r && viewer) {
      if (playing) {
        tick = Math.min(tick + (seconds / r.meta.dt) * speed, r.meta.ticks - 1);
        if (tick >= r.meta.ticks - 1) playing = false;
      }
      if (!techOpen) viewer.moveCamera(keys, seconds);
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
      viewer.resize();
      for (const [layer, on] of Object.entries(layers)) viewer.setVisible(layer as Layer, on);
      tick = 0;
      playing = true;
      select([]);
      inspect(null);
    } catch (e) {
      error = String(e);
    }
  }

  function toggle(layer: Layer) {
    layers[layer] = !layers[layer];
    viewer?.setVisible(layer, layers[layer]);
  }

  function select(ids: number[]) {
    selection = new Set(ids);
    viewer?.setSelection(selection);
    if (!ids.length) focus = null;
  }

  /** Select all the viewed player's animals of one species on screen (from the unit bar). */
  function pickSpecies(name: string) {
    if (!replay || !viewer) return;
    const fauna = replay.meta.fauna.names;
    select(
      viewer
        .visibleAnimals()
        .filter((a) => a.owner === player && fauna[a.species] === name)
        .map((a) => a.id),
    );
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const r = canvas.getBoundingClientRect();
    const [x, y] = [e.clientX - r.left, e.clientY - r.top];
    box = { x0: x, y0: y, x1: x, y1: y };
    canvas.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (!box) return;
    const r = canvas.getBoundingClientRect();
    box = { ...box, x1: e.clientX - r.left, y1: e.clientY - r.top };
  }

  function onPointerUp() {
    if (!box || !viewer) return;
    const click = Math.abs(box.x1 - box.x0) < 4 && Math.abs(box.y1 - box.y0) < 4;
    if (click) {
      inspect(viewer.pickCell(box.x0, box.y0)); // click: inspect the cell under the cursor
    } else {
      select(viewer.pick(box.x0, box.y0, box.x1, box.y1, player)); // drag: box-select animals
      focus = null;
    }
    box = null;
  }

  function inspect(c: { row: number; col: number } | null) {
    cell = c;
    viewer?.setCell(c);
  }

  function onKey(e: KeyboardEvent, down: boolean) {
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
    const move = keyMap[e.code];
    if (move && !typing) {
      keys[move] = down;
      e.preventDefault();
      return;
    }
    if (!down || typing) return;
    if (e.code === "Space") {
      e.preventDefault();
      playing = !playing;
    } else if (e.code === "KeyT") {
      techOpen = !techOpen;
    } else if (e.code === "Escape") {
      if (techOpen) techOpen = false;
      else if (cell) inspect(null);
      else select([]);
    } else if (e.code === "Home") {
      viewer?.resetView();
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

<svelte:window onkeydown={(e) => onKey(e, true)} onkeyup={(e) => onKey(e, false)} />

<main>
  <canvas
    bind:this={canvas}
    aria-label="Match view: click a cell to inspect it, drag to select your animals"
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    oncontextmenu={(e) => e.preventDefault()}
  ></canvas>

  {#if box}
    <div
      class="box"
      style:left="{Math.min(box.x0, box.x1)}px"
      style:top="{Math.min(box.y0, box.y1)}px"
      style:width="{Math.abs(box.x1 - box.x0)}px"
      style:height="{Math.abs(box.y1 - box.y0)}px"
    ></div>
  {/if}

  {#if !replays.length}
    <div class="panel empty">
      <h1>No replay yet</h1>
      <p>Generate one from the Python prototype, then reload:</p>
      <code>npm run proto -- --replay</code>
    </div>
  {:else if replay}
    <TopBar
      {replay}
      {tick}
      bind:player
      onTech={() => (techOpen = true)}
      {layers}
      {toggle}
      {replays}
      bind:chosen
      onChoose={() => open(chosen)}
    />
    <Timeline {replay} bind:tick bind:playing bind:speed {result} />
    <BottomBar
      {replay}
      {tick}
      {player}
      {selection}
      bind:focus
      onPickSpecies={pickSpecies}
      onClear={() => select([])}
    />
    <p class="hint">
      Click: inspect cell · Drag: select · Middle-drag / Q E: rotate · Right-drag / WASD: pan ·
      Wheel: zoom · T: tech tree
    </p>
    {#if cellInfo && cell}
      <CellPanel
        info={cellInfo}
        onZoom={() => cell && viewer?.zoomToCell(cell)}
        onClose={() => inspect(null)}
      />
    {/if}
    {#if techOpen}
      <TechTree {replay} {tick} {player} onClose={() => (techOpen = false)} />
    {/if}
  {/if}
  {#if error}<p class="panel error" role="alert">{error}</p>{/if}
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
    touch-action: none;
  }
  .box {
    position: absolute;
    border: 1px solid white;
    background: rgba(255, 255, 255, 0.15);
    pointer-events: none;
  }
  .hint {
    position: absolute;
    top: 52px;
    left: 16px;
    margin: 0;
    font-size: 0.78em;
    color: var(--ink-soft);
    background: rgba(250, 250, 247, 0.7);
    padding: 2px 8px;
    border-radius: 6px;
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
    top: 56px;
    right: 16px;
    color: #a3261b;
  }
</style>
