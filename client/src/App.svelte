<script lang="ts">
  // RTS shell (D-030): resource bar on top, unit bar at the bottom, full-screen tech tree, and the
  // 3D view in between. Mouse: click = inspect a cell, left-drag = box select, right-click = order
  // the selection (move, or attack on an enemy cell), middle-drag = rotate, right-drag = pan,
  // wheel = zoom. Keys (gamerules §9.2, D-053): arrows = pan, Q / E = rotate, A + click =
  // attack-move, S = stop, Shift or Ctrl + 1-9 = set a control group, 1-9 = recall it,
  // Home = reset view, Space = play, T = tech tree, Esc = cancel / close / clear selection.
  import { onDestroy, onMount } from "svelte";
  import { SvelteMap } from "svelte/reactivity";
  import { loadReplay, type Source } from "./replay/replay";
  import { Live, type Notice, type Outcome } from "./worker/live";
  import { label, unlockedNow } from "./game/species";
  import { Viewer, type CameraKeys, type Layer } from "./render/viewer";
  import { loadQuality, saveQuality, type Quality } from "./render/quality";
  import BottomBar from "./ui/BottomBar.svelte";
  import CellPanel from "./ui/CellPanel.svelte";
  import MainMenu from "./ui/MainMenu.svelte";
  import EndScreen from "./ui/EndScreen.svelte";
  import TechTree from "./ui/TechTree.svelte";
  import Timeline from "./ui/Timeline.svelte";
  import TopBar from "./ui/TopBar.svelte";

  let canvas: HTMLCanvasElement;
  let replays: string[] = $state([]);
  let chosen = $state("");
  let replay: Source | undefined = $state();
  let live: Live | undefined = $state();
  let simMs = $state(0);
  // Render rate for the perf check (D-040): frames per second over the last half second, and the
  // longest frame in it (a field frame's repaint shows up there).
  let perf = $state("");
  let perfFrames = 0;
  let perfStart = 0;
  let perfWorst = 0;
  const LIVE = "live match";
  let viewer: Viewer | undefined;
  let error = $state("");
  let tick = $state(0);
  let playing = $state(true);
  let speed = $state(4);
  let player: 1 | 2 = $state(1);
  let techOpen = $state(false);
  let outcome: Outcome | null = $state(null); // the verdict of a live match
  let endDismissed = $state(false); // "keep watching" hides the end screen
  let inMenu = $state(true); // the main menu covers everything until a game is launched
  let quality: Quality = $state(loadQuality()); // render preset (D-056)
  let selection = $state(new Set<number>());
  let focus: string | null = $state(null);
  let planting: string | null = $state(null); // species armed for the next map click
  let attackArmed = $state(false); // A pressed: the next map click is an attack-move
  const groups = new SvelteMap<number, number[]>(); // control groups: digit -> animal ids
  let rightDown: { x: number; y: number } | null = null;
  let notices: Notice[] = $state([]); // recent orders that did nothing
  const unlocked = $derived.by(() => {
    void tick; // live unlocks arrive with the ticks
    return replay ? unlockedNow(replay, player, tick) : new Set<string>();
  });
  const unlock = (name: string) => live?.unlock(player, name);
  const armedKind = $derived(
    replay?.meta.species.find((s) => s.name === planting)?.kind ?? "flora",
  );
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
  // Arrows pan: A and S are unit orders (gamerules §9.2).
  const keyMap: Record<string, keyof CameraKeys> = {
    ArrowUp: "forward",
    ArrowDown: "back",
    ArrowLeft: "left",
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
    if (live) {
      tick = live.renderTick(now); // between the last two animal frames: animals glide
      simMs = live.simMs;
      if (live.error) error = live.error;
      if (live.result !== outcome) outcome = live.result;
      const fresh = live.notices.filter((n) => now - n.at < 5000);
      if (fresh.length !== notices.length) notices = fresh;
    }
    if (r && viewer) {
      if (live) {
        // the worker keeps time
      } else if (playing) {
        tick = Math.min(tick + (seconds / r.meta.dt) * speed, r.meta.ticks - 1);
        if (tick >= r.meta.ticks - 1) playing = false;
      }
      if (!techOpen) viewer.moveCamera(keys, seconds);
      viewer.render(tick);
    }
    perfFrames++;
    perfWorst = Math.max(perfWorst, now - last);
    if (now - perfStart >= 500) {
      const fps = (perfFrames * 1000) / (now - perfStart);
      perf = `${fps.toFixed(0)} fps · worst ${perfWorst.toFixed(0)} ms · ${viewer?.backend ?? ""}`;
      [perfFrames, perfStart, perfWorst] = [0, now, 0];
    }
    last = now;
    raf = requestAnimationFrame(frame);
  }

  async function open(name: string) {
    error = "";
    viewer?.dispose();
    viewer = undefined;
    live?.dispose();
    live = undefined;
    planting = null;
    outcome = null;
    endDismissed = false;
    try {
      if (name === LIVE) {
        // ?seed=N&size=N (0 = the balance grid size); a fixed default seed keeps runs reproducible
        const q = new URLSearchParams(location.search);
        live = await Live.start(
          Number(q.get("seed") ?? 1),
          Number(q.get("size") ?? 0),
          q.get("sandbox") === "1", // ?sandbox=1: everything unlocked and free (D-058)
        );
        replay = live;
      } else {
        replay = await loadReplay(`replays/${name}`);
      }
      viewer = await Viewer.create(canvas, replay, quality);
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

  function setQuality(q: Quality) {
    quality = q;
    saveQuality(q);
    viewer?.setQuality(q);
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

  /** Order the selected animals (live match only). */
  function order(kind: "move" | "attack" | "stop", at?: { row: number; col: number } | null) {
    if (!live || !selection.size) return;
    live.order(player, [...selection], kind, at?.row ?? 0, at?.col ?? 0);
  }

  /** An enemy cell: enemy land, or enemy animals on it (right-click there attacks). */
  function enemyAt(at: { row: number; col: number }): boolean {
    const info = replay?.cell(tick, at.row, at.col);
    return !!info && (info.owner === 3 - player || info.animals.some((a) => a.owner !== player));
  }

  function onPointerDown(e: PointerEvent) {
    const r = canvas.getBoundingClientRect();
    const [x, y] = [e.clientX - r.left, e.clientY - r.top];
    if (e.button === 2) rightDown = { x, y }; // a right click orders; a right drag pans
    if (e.button !== 0) return;
    box = { x0: x, y0: y, x1: x, y1: y };
    canvas.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (!box) return;
    const r = canvas.getBoundingClientRect();
    box = { ...box, x1: e.clientX - r.left, y1: e.clientY - r.top };
  }

  function onPointerUp(e: PointerEvent) {
    if (e.button === 2 && rightDown && viewer) {
      const r = canvas.getBoundingClientRect();
      const [x, y] = [e.clientX - r.left, e.clientY - r.top];
      if (Math.abs(x - rightDown.x) < 4 && Math.abs(y - rightDown.y) < 4) {
        const at = viewer.pickCell(x, y);
        if (at) order(enemyAt(at) ? "attack" : "move", at);
      }
      rightDown = null;
      return;
    }
    if (!box || !viewer) return;
    const click = Math.abs(box.x1 - box.x0) < 4 && Math.abs(box.y1 - box.y0) < 4;
    if (click && attackArmed) {
      order("attack", viewer.pickCell(box.x0, box.y0));
      if (!e.shiftKey) attackArmed = false;
      box = null;
      return;
    }
    const at = click && planting && live ? viewer.pickCell(box.x0, box.y0) : null;
    if (at && planting && live) {
      // Shift keeps the order armed, like RTS build orders.
      if (armedKind === "flora") live.plant(player, planting, at.row, at.col);
      else live.spawn(player, planting, at.row, at.col);
      if (!e.shiftKey) planting = null;
    } else if (click) {
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
    if (!down || typing || inMenu) return;
    const digit = /^Digit([1-9])$/.exec(e.code)?.[1];
    if (digit) {
      // Chrome keeps Ctrl + 1-8 for its tabs: Shift + digit also sets a group.
      if (e.ctrlKey || e.shiftKey) groups.set(Number(digit), [...selection]);
      else select(groups.get(Number(digit)) ?? []);
      e.preventDefault();
    } else if (e.code === "KeyA" && live && selection.size) {
      attackArmed = true;
    } else if (e.code === "KeyS" && live && selection.size) {
      order("stop");
    } else if (e.code === "Space") {
      e.preventDefault();
      playing = !playing;
    } else if (e.code === "KeyT") {
      techOpen = !techOpen;
    } else if (e.code === "Escape") {
      if (techOpen) techOpen = false;
      else if (attackArmed) attackArmed = false;
      else if (planting) planting = null;
      else if (cell) inspect(null);
      else select([]);
    } else if (e.code === "Home") {
      viewer?.resetView();
    }
  }

  $effect(() => {
    live?.send({ type: "pause", paused: !playing });
    live?.send({ type: "speed", speed });
  });

  const resize = () => viewer?.resize();

  async function start() {
    try {
      const res = await fetch("replays/index.json");
      replays = [LIVE, ...(res.ok ? ((await res.json()) as string[]) : [])];
    } catch {
      replays = [LIVE];
    }
  }

  /** From the main menu: start a live match. */
  async function launch() {
    inMenu = false;
    chosen = LIVE;
    await open(LIVE);
  }

  /** Back to the main menu: the match and its worker end. */
  function toMenu() {
    viewer?.dispose();
    viewer = undefined;
    live?.dispose();
    live = undefined;
    replay = undefined;
    techOpen = false;
    inspect(null);
    select([]);
    inMenu = true;
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
    live?.dispose();
  });
</script>

<svelte:window onkeydown={(e) => onKey(e, true)} onkeyup={(e) => onKey(e, false)} />

<main>
  <canvas
    bind:this={canvas}
    aria-label="Match view: click a cell to inspect it, drag to select your animals"
    class:planting={planting || attackArmed}
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

  {#if replay}
    <TopBar
      {replay}
      {tick}
      bind:player
      onTech={() => (techOpen = true)}
      onMenu={toMenu}
      {layers}
      {toggle}
      {quality}
      onQuality={setQuality}
      {replays}
      bind:chosen
      onChoose={open}
    />
    <Timeline {replay} live={!!live} {simMs} {perf} bind:tick bind:playing bind:speed {result} />
    <BottomBar
      {replay}
      {tick}
      {player}
      {selection}
      bind:focus
      live={!!live}
      bind:planting
      {unlocked}
      onUnlock={unlock}
      onPickSpecies={pickSpecies}
      onClear={() => select([])}
    />
    <p class="hint">
      {#if attackArmed}
        <strong>Attack-move:</strong> click a cell: your animals go there, feeding on any enemy food on
        the way · Esc: cancel
      {:else if live && selection.size && !planting}
        <strong>{selection.size} selected:</strong> right-click: move (enemy cell: attack) · A + click:
        attack-move · S: stop · Shift + 1-9: set group · 1-9: recall
      {:else if planting}
        <strong>{armedKind === "flora" ? "Planting" : "Calling"} {label(planting)}:</strong>
        {armedKind === "flora"
          ? "click a cell"
          : "click near where it should go (predators land on enemy prey)"} · Shift: keep going · Esc:
        cancel
      {:else}
        Click: inspect cell · Drag: select · Middle-drag / Q E: rotate · Right-drag / arrows: pan ·
        Wheel: zoom · T: tech tree
      {/if}
    </p>
    {#if notices.length}
      <div class="notices" role="status">
        {#each notices as n (n.at + n.text)}
          <p class="notice panel p{n.player}">P{n.player} · {label(n.text)}</p>
        {/each}
      </div>
    {/if}
    {#if cellInfo && cell}
      <CellPanel
        info={cellInfo}
        onZoom={() => cell && viewer?.zoomToCell(cell)}
        onClose={() => inspect(null)}
      />
    {/if}
    {#if techOpen}
      <TechTree
        {replay}
        {tick}
        {player}
        onClose={() => (techOpen = false)}
        onUnlock={live ? unlock : undefined}
      />
    {/if}
  {/if}
  {#if error}<p class="panel error" role="alert">{error}</p>{/if}
  {#if outcome && replay && !endDismissed && !inMenu}
    <EndScreen
      {outcome}
      human={1}
      series={replay.meta.series}
      dt={replay.meta.dt}
      onMenu={toMenu}
      onWatch={() => (endDismissed = true)}
    />
  {/if}
  {#if inMenu}<MainMenu onLaunch={launch} />{/if}
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
  canvas.planting {
    cursor: crosshair;
  }
  .box {
    position: absolute;
    border: 1px solid var(--gold);
    background: rgba(216, 180, 92, 0.12);
    box-shadow: 0 0 10px rgba(216, 180, 92, 0.4);
    pointer-events: none;
  }
  .hint {
    position: absolute;
    top: 64px;
    left: 14px;
    margin: 0;
    font-size: 0.76em;
    color: var(--ink-soft);
    background: var(--panel-flat);
    box-shadow: var(--trim);
    padding: 3px 10px;
    border-radius: 999px;
  }
  .hint strong {
    color: var(--gold);
  }
  .notices {
    position: absolute;
    top: 104px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    gap: 6px;
    pointer-events: none;
  }
  .notice {
    margin: 0;
    font-size: 0.85em;
    border-left: 3px solid var(--player);
  }
  .error {
    position: absolute;
    top: 74px;
    left: 50%;
    transform: translateX(-50%);
    color: var(--bad);
  }
</style>
