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
  import { Live, type Outcome } from "./worker/live";
  import {
    FrontWatch,
    fresh,
    RaidWatch,
    TOAST,
    type Kind,
    type Severity,
    type Toast,
  } from "./game/alerts";
  import { cardState, isSwarm, label, unlockedNow } from "./game/species";
  import { WORLD } from "./render/palette";
  import { Viewer, type CameraKeys, type Layer } from "./render/viewer";
  import { loadQuality, saveQuality, type Quality } from "./render/quality";
  import BottomBar from "./ui/BottomBar.svelte";
  import CellPanel from "./ui/CellPanel.svelte";
  import MainMenu from "./ui/MainMenu.svelte";
  import EndScreen from "./ui/EndScreen.svelte";
  import TechTree from "./ui/TechTree.svelte";
  import Timeline from "./ui/Timeline.svelte";
  import Toasts from "./ui/Toasts.svelte";
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
  let showPerf = $state(false); // the performance readout, off by default (D-064)
  let perfFrames = 0;
  let perfStart = 0;
  let perfWorst = 0;
  const LIVE = "live match";
  let viewer: Viewer | undefined;
  let error = $state("");
  let tick = $state(0);
  let playing = $state(true);
  let speed = $state(4);
  let player: 1 | 2 = $state(1); // the viewed player
  // The human's side: P1 against the bot (D-060); in a relayed match, the seat the relay gave.
  const me = $derived<1 | 2>(live?.me ?? 1);
  let joining = $state(false); // relayed: waiting for the other player to join
  let stalled = $state(false); // relayed: waiting for the other player's turn
  const mine = $derived(!!live && player === me); // viewing own side: orders allowed
  let techOpen = $state(false);
  let outcome: Outcome | null = $state(null); // the verdict of a live match
  let endDismissed = $state(false); // "keep watching" hides the end screen
  let inMenu = $state(true); // the main menu covers everything until a game is launched
  let quality: Quality = $state(loadQuality()); // render preset (D-056)
  let selection = $state(new Set<number>());
  let confirmLeave = $state(false); // "leave the match?" dialog
  let planting: string | null = $state(null); // species armed for the next map click
  let attackArmed = $state(false); // A pressed: the next map click is an attack-move
  const groups = new SvelteMap<number, number[]>(); // control groups: digit -> animal ids
  let rightDown: { x: number; y: number } | null = null;
  // Notifications (D-077): toasts, raid pings still showing, and arrows to the off-screen ones.
  const SCAN_MS = 1000; // raid and unlock checks, once a second
  const EDGE = 28; // arrows keep this far from the screen edge (px)
  let toasts: Toast[] = $state([]);
  let arrows: { x: number; y: number; angle: number }[] = $state([]);
  let pinged: { cell: { row: number; col: number }; until: number }[] = [];
  let watch = new RaidWatch();
  let front = new FrontWatch();
  let lastScan = 0;
  let seenNotice = 0; // `at` of the last order notice turned into a toast
  let available: Set<string> | null = null; // species you could buy (and afford) at the last scan
  let toastId = 0;
  const kinds = $derived<Kind[]>(
    (replay?.meta.species ?? [])
      .filter((s) => s.kind === "fauna")
      .map((s) => ({ label: label(s.name), predator: s.role === "predator", swarm: isSwarm(s) })),
  );

  function toast(text: string, kind: Toast["kind"], cell?: Toast["cell"], severity?: Severity) {
    toasts = [...toasts, { id: toastId++, text, kind, at: performance.now(), cell, severity }];
  }

  /** Raids on your land, and species newly within reach (live matches). */
  function scan(now: number) {
    const [l, v] = [live, viewer];
    if (!l || !v) return;
    const fields = l.fields();
    const found = watch.scan(v.visibleAnimals(), fields.owner, l.meta.n, me, kinds, now / 1000);
    const lost = front.scan(fields.owner, l.meta.n, me, now / 1000);
    if (lost) found.push(lost);
    for (const a of found) {
      const at = { row: a.row, col: a.col };
      toast(a.text, "alert", at, a.severity);
      v.ping(at, WORLD.alert);
      pinged.push({ cell: at, until: now + TOAST.alertMs });
    }
    const bank = l.meta.series[`bank_p${me}`]?.at(-1) ?? 0; // what you can afford now
    const can = new Set(
      l.meta.species
        .filter(
          (s) => cardState(l.meta, s, unlocked) === "available" && s.stats.unlock_cost <= bank,
        )
        .map((s) => s.name),
    );
    if (available) {
      for (const name of can)
        if (!available.has(name)) toast(`${label(name)} can be unlocked`, "info");
    }
    available = can;
  }

  /** Arrows at the screen edge toward pings out of view. */
  function aim(now: number) {
    pinged = pinged.filter((p) => p.until > now);
    if (!viewer || (!pinged.length && !arrows.length)) return;
    const [w, h] = [canvas.clientWidth, canvas.clientHeight];
    const v = viewer;
    arrows = pinged.flatMap(({ cell: c }) => {
      const s = v.screenPoint(c);
      if (s.inView) return [];
      const angle = Math.atan2(s.y - h / 2, s.x - w / 2);
      const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
      const k = Math.min(
        (w / 2 - EDGE) / Math.max(Math.abs(cos), 1e-6),
        (h / 2 - EDGE) / Math.max(Math.abs(sin), 1e-6),
      );
      return [{ x: w / 2 + cos * k, y: h / 2 + sin * k, angle }];
    });
  }
  const unlocked = $derived.by(() => {
    void tick; // live unlocks arrive with the ticks
    return replay ? unlockedNow(replay, player, tick) : new Set<string>();
  });
  const unlock = (name: string) => live?.unlock(me, name);
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
  // Arrows pan: A and S are unit orders (gamerules §9.2). Letters are matched by the letter the
  // key prints (`letter`), so AZERTY and QWERTY both work (D-075).
  const keyMap: Record<string, keyof CameraKeys> = {
    ArrowUp: "forward",
    ArrowDown: "back",
    ArrowLeft: "left",
    ArrowRight: "right",
    q: "rotateLeft",
    e: "rotateRight",
  };
  /** A key's printed letter in lower case (Shift-proof), or its name (Escape, Home, arrows…). */
  const letter = (e: KeyboardEvent) => (e.key.length === 1 ? e.key.toLowerCase() : e.key);

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
      if (live.netProblem) error = live.netProblem;
      if (live.stalled !== stalled) stalled = live.stalled;
      if (live.result !== outcome) outcome = live.result;
      for (const n of live.notices) {
        if (n.player !== me || n.at <= seenNotice) continue;
        seenNotice = n.at;
        toast(label(n.text), "notice");
      }
      if (now - lastScan > SCAN_MS) {
        lastScan = now;
        scan(now);
      }
      aim(now);
      const showing = fresh(toasts, now);
      if (showing.length !== toasts.length) toasts = showing;
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
    [toasts, arrows, pinged, available, seenNotice] = [[], [], [], null, 0];
    watch = new RaidWatch();
    front = new FrontWatch();
    try {
      if (name === LIVE) {
        // ?seed=N&size=N (0 = the balance grid size); a fixed default seed keeps runs reproducible
        const q = new URLSearchParams(location.search);
        const relay = q.get("relay") ?? undefined; // ?relay=ws://host:port: lockstep (D-062)
        joining = !!relay;
        live = await Live.start(
          Number(q.get("seed") ?? 1),
          Number(q.get("size") ?? 0),
          q.get("sandbox") === "1", // ?sandbox=1: everything unlocked and free (D-058)
          q.get("bot") ?? "normal", // ?bot=easy|normal|hard|none: the P2 opponent (D-060)
          relay,
        );
        joining = false;
        player = live.me; // view your own side
        replay = live;
        speed = 1; // a match starts in real time (D-069)
      } else {
        replay = await loadReplay(`replays/${name}`);
        speed = 4; // replays: fast playback
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
    live.order(me, [...selection], kind, at?.row ?? 0, at?.col ?? 0);
  }

  /** An enemy cell: enemy land, or enemy animals on it (right-click there attacks). */
  function enemyAt(at: { row: number; col: number }): boolean {
    const info = replay?.cell(tick, at.row, at.col);
    return !!info && (info.owner === 3 - me || info.animals.some((a) => a.owner !== me));
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
      if (armedKind === "flora") live.plant(me, planting, at.row, at.col);
      else live.spawn(me, planting, at.row, at.col);
      if (!e.shiftKey) planting = null;
    } else if (click) {
      inspect(viewer.pickCell(box.x0, box.y0)); // click: inspect the cell under the cursor
    } else {
      select(viewer.pick(box.x0, box.y0, box.x1, box.y1, live ? me : player)); // own animals
    }
    box = null;
  }

  function inspect(c: { row: number; col: number } | null) {
    cell = c;
    viewer?.setCell(c);
  }

  function onKey(e: KeyboardEvent, down: boolean) {
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
    const key = letter(e);
    const move = keyMap[key];
    if (move && !typing) {
      keys[move] = down;
      e.preventDefault();
      return;
    }
    if (!down || typing || inMenu) return;
    const digit = /^Digit([1-9])$/.exec(e.code)?.[1]; // the digit row, whatever the layout
    if (digit) {
      // Chrome keeps Ctrl + 1-8 for its tabs: Shift + digit also sets a group.
      if (e.ctrlKey || e.shiftKey) groups.set(Number(digit), [...selection]);
      else select(groups.get(Number(digit)) ?? []);
      e.preventDefault();
    } else if (key === "a" && live && selection.size) {
      attackArmed = true;
    } else if (key === "s" && live && selection.size) {
      order("stop");
    } else if (e.code === "Space") {
      e.preventDefault();
      playing = !playing;
    } else if (key === "t") {
      techOpen = !techOpen;
    } else if (key === "Escape") {
      if (confirmLeave) confirmLeave = false;
      else if (techOpen) techOpen = false;
      else if (attackArmed) attackArmed = false;
      else if (planting) planting = null;
      else if (cell) inspect(null);
      else select([]);
    } else if (key === "Home") {
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

  /** The Menu button: a live match still on asks first (it would be lost). */
  function askMenu() {
    if (live && !outcome) confirmLeave = true;
    else toMenu();
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
    confirmLeave = false;
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
      onMenu={askMenu}
      {layers}
      {toggle}
      {quality}
      onQuality={setQuality}
      bind:perf={showPerf}
      {replays}
      bind:chosen
      onChoose={open}
    />
    <Timeline
      {replay}
      live={!!live}
      {simMs}
      {perf}
      {showPerf}
      bind:tick
      bind:playing
      bind:speed
      {result}
    />
    <BottomBar
      {replay}
      {tick}
      {player}
      {selection}
      live={mine}
      bind:planting
      {unlocked}
      onUnlock={unlock}
      onPickSpecies={pickSpecies}
      onClear={() => select([])}
    />
    {#if attackArmed || planting}
      <p class="hint">
        {#if attackArmed}
          <strong>Attack-move:</strong> click a cell: your animals go there, feeding on any enemy food
          on the way · Esc: cancel
        {:else if planting}
          <strong>{armedKind === "flora" ? "Planting" : "Calling"} {label(planting)}:</strong>
          {armedKind === "flora"
            ? "click a cell"
            : "click your land (base price), or enemy ground to drop them on food or prey (×1.5)"} · Shift:
          keep going · Esc: cancel
        {/if}
      </p>
    {/if}
    <Toasts {toasts} {arrows} onGo={(t) => t.cell && viewer?.lookAt(t.cell)} />
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
        onUnlock={mine ? unlock : undefined}
      />
    {/if}
  {/if}
  {#if joining || (stalled && live && !outcome)}
    <p class="panel waiting" role="status">
      {joining ? "Waiting for the other player to join…" : "Waiting for the other player…"}
    </p>
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
  {#if confirmLeave}
    <div class="veil" role="dialog" aria-modal="true" aria-label="Leave the match?">
      <div class="panel confirm">
        <strong>Leave the match?</strong>
        <p>It will be lost.</p>
        <div class="choices">
          <button class="btn" onclick={() => (confirmLeave = false)}>Stay</button>
          <button class="btn" onclick={toMenu}>Leave</button>
        </div>
      </div>
    </div>
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
    background: var(--panel);
    backdrop-filter: var(--blur);
    padding: 3px 10px;
    border-radius: 999px;
  }
  .hint strong {
    color: var(--gold);
  }
  .veil {
    position: absolute;
    inset: 0;
    z-index: 30;
    display: grid;
    place-items: center;
    background: rgba(10, 14, 12, 0.35);
    backdrop-filter: blur(3px);
  }
  .confirm {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 18px 26px;
  }
  .confirm p {
    margin: 0;
    color: var(--ink-soft);
  }
  .choices {
    display: flex;
    gap: 10px;
    margin-top: 8px;
  }
  .waiting {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    margin: 0;
    font-weight: 700;
  }
  .error {
    position: absolute;
    top: 74px;
    left: 50%;
    transform: translateX(-50%);
    color: var(--bad);
  }
</style>
