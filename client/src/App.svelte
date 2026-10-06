<script lang="ts">
  // RTS shell (D-030): resource bar on top, unit bar at the bottom, full-screen tech tree, and the
  // 3D view in between. Mouse: click = inspect a cell, left-drag = box select, right-click = order
  // the selection (move, or attack on an enemy cell), middle-drag = rotate, right-drag = pan,
  // wheel = zoom. Keys (gamerules §9.2, D-053): arrows = pan, Q / E = rotate, A + click =
  // attack-move, S = stop, Shift or Ctrl + 1-9 = set a control group, 1-9 = recall it,
  // Home = reset view, Space = play, T = tech tree, Esc = cancel / close / clear selection.
  import { onDestroy, onMount } from "svelte";
  import { SvelteMap, SvelteSet } from "svelte/reactivity";
  import { strategicGroups } from "./game/groups";
  import { loadSetup, MAP_SIZES, saveSetup, withUrl } from "./game/setup";
  import { ALL_TIPS, loadSeen, saveSeen, TIPS, TipWatch } from "./game/tips";
  import { CATASTROPHE_LOOK } from "./game/catastrophes";
  import { advance, DEFEND_TITLE, OBJECTIVES, RAID, topUp, TUTORIAL_SETUP } from "./game/tutorial";
  import { loadReplay, type Fields, type Role, type Source, type Species } from "./replay/replay";
  import { Live, type Outcome } from "./worker/live";
  import {
    FrontWatch,
    fresh,
    RaidWatch,
    VictoryWatch,
    TOAST,
    type Kind,
    type Severity,
    type Toast,
  } from "./game/alerts";
  import { cardState, isSwarm, label, unlockedNow } from "./game/species";
  import { plantColor, WORLD } from "./render/palette";
  import { Viewer, type CameraKeys, type Layer } from "./render/viewer";
  import { loadQuality, saveQuality, type Quality } from "./render/quality";
  import { censusText, frameStats, Sections } from "./game/perf";
  import BottomBar from "./ui/BottomBar.svelte";
  import CellPanel from "./ui/CellPanel.svelte";
  import UnitPanel from "./ui/UnitPanel.svelte";
  import UnitList from "./ui/UnitList.svelte";
  import { shortNotice } from "./game/notices";
  import { audio } from "./audio/engine";
  import { ambience, moodOf } from "./audio/ambience";
  import { unlockSound, voiceOf } from "./audio/sounds";
  import { music } from "./audio/music";
  import { formOf as bodyOf } from "./render/bodies";
  import { unitCard } from "./game/units";
  import MainMenu from "./ui/MainMenu.svelte";
  import EndScreen from "./ui/EndScreen.svelte";
  import TechTree from "./ui/TechTree.svelte";
  import Timeline from "./ui/Timeline.svelte";
  import Objectives from "./ui/Objectives.svelte";
  import StrategicIcons from "./ui/StrategicIcons.svelte";
  import Toasts from "./ui/Toasts.svelte";
  import TourPointer from "./ui/TourPointer.svelte";
  import { CLEAR, weatherToasts, type WeatherNow } from "./game/weather";
  import type { OverlayId } from "./game/overlays";
  import { catalogSource } from "./game/catalog";
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
  let setup = $state(loadSetup()); // the next match: opponent, seed, sandbox (D-081)
  /** The perf panel's detail (D-198): JS per section, GPU time, triangles and draws per family. */
  let perfDetail = $state("");
  const appTiming = new Sections();
  let lastCensus = 0;
  let censusLine = "";
  /** `?perf=1` (D-198): a scripted late-game bench. Bot vs bot at 8× to `minute` (22), then
   *  10 s measured at 1× from the overview; the figures land in the console and `window.ecoPerf`. */
  const PERF = new URLSearchParams(location.search);
  const perfBench = PERF.has("perf")
    ? { until: Number(PERF.get("minute") ?? 22) * 600, phase: "warm", t0: 0, gaps: [] as number[] }
    : null;
  let perfFrames = 0;
  let perfStart = 0;
  let perfWorst = 0;
  const LIVE = "live match";
  let viewer: Viewer | undefined;
  let error = $state("");
  // The HUD's tick: whole ticks only, so the bars re-render at the sim's 10 Hz, not every frame
  // (D-149). The renderer reads the fractional `frameTick`, which animals glide on.
  let tick = $state(0);
  let frameTick = 0;
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
  let weather: WeatherNow = $state.raw(CLEAR); // D-132 (raw: compared by identity)
  /** The map overlay shown (D-135): off at the start of every match. */
  let overlay: OverlayId | null = $state(null);
  $effect(() => {
    const id = overlay; // read first: the viewer is not reactive, the overlay is
    viewer?.setOverlay(id);
  });
  let arrows: { x: number; y: number; angle: number }[] = $state([]);
  let pinged: { cell: { row: number; col: number }; until: number }[] = [];
  let watch = new RaidWatch();
  let front = new FrontWatch();
  let victory = new VictoryWatch();
  let tips = new TipWatch(loadSeen(), saveSeen);
  let tipsOn = $state(loadSeen().size < TIPS.length); // Options switch (D-082)
  let raided = false; // a raid alert was raised this match (for the tips)
  let homeless = $state(false); // no land yet: the first planting is the spawn (D-095)
  let tutorial = $state(false); // the match is the tutorial (M5a 8b)
  let castArmed: string | null = $state(null); // the catastrophe card armed (D-129)
  let tutorialStep = $state(0);
  let raidOrdered = false; // an order sent animals onto enemy land (tutorial)
  /** Tutorial (D-139): explanation steps the player clicked Next on; the tech tree opened. */
  let acked = new SvelteSet<number>();
  let techSeen = false;
  /** The tutorial's scripted grasshopper raid (D-141): waves sent, and when the next one comes. */
  let raidWaves = 0;
  let raidNext = 0;
  $effect(() => {
    if (techOpen) techSeen = true;
  });
  /** The menu's Species page (D-140): the tech tree over a catalog of every species. */
  let catalog: Source | null = $state(null);
  async function openCatalog() {
    // The species table comes from the sim itself (the same data files as a match), loaded once.
    const [{ default: init, Sim }, { default: wasmUrl }, { default: bal }, { default: spe }] =
      await Promise.all([
        import("../../sim-wasm/pkg/sim_wasm.js"),
        import("../../sim-wasm/pkg/sim_wasm_bg.wasm?url"),
        import("../../data/balance.toml?raw"),
        import("../../data/species.toml?raw"),
      ]);
    await init({ module_or_path: wasmUrl });
    const sim = new Sim(bal, spe, 1n, 0);
    catalog = catalogSource(JSON.parse(sim.speciesTable()) as Species[]);
    sim.free();
  }
  function nextStep(step: number) {
    acked.add(step);
    if (tutorialStep === step) tutorialStep = step + 1;
  }
  let lastScan = 0;
  let seenNotice = 0; // `at` of the last order notice turned into a toast
  let available: Set<string> | null = null; // species you could buy (and afford) at the last scan
  let toastId = 0;
  const kinds = $derived<Kind[]>(
    (replay?.meta.species ?? [])
      .filter((s) => s.kind === "fauna")
      .map((s) => ({ label: label(s.name), predator: s.role === "predator", swarm: isSwarm(s) })),
  );

  // Strategic icons (D-078): on by default, remembered per browser; refreshed ~10 times a second.
  const ICONS_KEY = "ecoclash.icons";
  const ICONS_MS = 100;
  let showIcons = $state(loadIcons());
  let icons: {
    key: string;
    x: number;
    y: number;
    s: Species;
    count: number;
    ids: number[];
    order: boolean;
    enemy: boolean;
  }[] = $state.raw([]); // replaced every frame: no deep proxies (D-202)
  let lastIcons = 0;
  const fauna = $derived((replay?.meta.species ?? []).filter((s) => s.kind === "fauna"));

  function loadIcons(): boolean {
    try {
      return localStorage.getItem(ICONS_KEY) !== "off";
    } catch {
      return true;
    }
  }
  // No live blur behind the HUD in a match (D-202): it was recomputed over the moving scene every
  // frame. Menus keep it.
  $effect(() => {
    document.documentElement.classList.toggle("in-match", !!replay && !inMenu);
  });
  $effect(() => {
    try {
      localStorage.setItem(ICONS_KEY, showIcons ? "on" : "off");
    } catch {
      // blocked site data: the choice lasts for this page only
    }
  });

  /** The groups the icons stand for (map cells), regrouped ~10 times a second. */
  let iconGroups: (Omit<(typeof icons)[number], "x" | "y"> & { row: number; col: number })[] = [];

  /** Icons over sizeable groups: regroup the animals (10 Hz, in `frame`). */
  function placeIcons() {
    const v = viewer;
    if (!v || !showIcons) {
      iconGroups = [];
      if (icons.length) icons = [];
      return;
    }
    const swarm = kinds.map((k) => k.swarm);
    // Yours, then the enemy's (D-146): see where the threat is; theirs only show.
    const mine = live ? me : player;
    const animals = v.visibleAnimals();
    iconGroups = [mine, 3 - mine].flatMap((owner) =>
      strategicGroups(animals, owner, swarm).flatMap((g) => {
        const s = fauna[g.species];
        if (!s) return [];
        const key = `${owner}:${g.species}:${g.ids[0] ?? 0}`;
        const enemy = owner !== mine;
        const order = !enemy && !swarm[g.species];
        return [{ key, row: g.row, col: g.col, s, count: g.count, ids: g.ids, order, enemy }];
      }),
    );
  }

  /** Every frame (D-171): the icons follow the camera smoothly; regrouping alone at 10 Hz made
   *  them jump behind the map while panning. */
  function projectIcons() {
    const v = viewer;
    if (!v || !iconGroups.length) return;
    icons = iconGroups.flatMap((g) => {
      const at = v.screenPoint({ row: g.row, col: g.col });
      return at.inView ? [{ ...g, x: at.x, y: at.y }] : [];
    });
  }

  /** Seconds before each catastrophe card is ready again for you (D-129). */
  const catastropheWaits = $derived.by(() => {
    void tick; // refreshed with every tick message
    return live?.waits[me - 1] ?? [];
  });

  // Drop cursor (D-079): the armed species' model follows the cursor; "×1.5" off your land.
  let dropTag: { x: number; y: number } | null = $state(null);
  $effect(() => {
    const s = planting ? replay?.meta.species.find((x) => x.name === planting) : undefined;
    const l = live;
    const card = castArmed ? l?.catastrophes.find((c) => c.name === castArmed) : undefined;
    if (card) {
      // D-129: the disc the card will hit, a ring only.
      viewer?.setGhost({
        name: card.name,
        kind: "catastrophe",
        level: 0,
        role: "herbivore",
        player: me,
        radius: card.radius,
      });
      return;
    }
    viewer?.setGhost(
      s && l
        ? {
            name: s.name,
            kind: s.kind,
            level: s.level,
            family: s.family,
            role: s.role as Role,
            player: me,
            radius: s.kind === "flora" ? l.plantRadius : l.dropRadius,
          }
        : null,
    );
    if (!s) dropTag = null;
  });

  /** Each toast kind's cue (D-177). */
  const TOAST_SOUND: Record<Toast["kind"], string> = {
    notice: "ui.error",
    alert: "ui.alert",
    info: "ui.info",
    tip: "ui.tip",
  };
  function toast(text: string, kind: Toast["kind"], cell?: Toast["cell"], severity?: Severity) {
    toasts = [...toasts, { id: toastId++, text, kind, at: performance.now(), cell, severity }];
    audio.play(TOAST_SOUND[kind]);
  }

  /** A world sound's place on screen, for panning (D-177). */
  function placeOf(cell: { row: number; col: number } | null) {
    const v = viewer;
    if (!v || !cell) return null;
    const p = v.screenPoint(cell);
    return { x: p.x, inView: p.inView, width: canvas.clientWidth };
  }
  // Music (D-180): always on the main menu, now and then in a match.
  $effect(() => {
    music.setScene(replay ? "game" : "menu");
  });

  /** The chance that a dropped animal calls as it lands (D-179), or one of yours answers a
   *  selection or an order (D-182). */
  const DROP_CALL = 0.6;
  const SELECT_CALL = 0.5;
  const ORDER_CALL = 0.35;
  /** One of these animals (yours, on screen) calls, with chance `chance` (D-182). The cooldown
   *  keeps a box drag or spam clicks from stacking calls. */
  function speak(ids: Iterable<number>, chance: number, delay = 0) {
    const v = viewer;
    if (!v || !replay || Math.random() > chance) return;
    const want = new Set(ids);
    const mine = v.visibleAnimals().filter((a) => want.has(a.id) && a.owner === me);
    const a = mine[Math.floor(Math.random() * mine.length)];
    if (!a) return;
    const call = callOf(replay.meta.fauna.names[a.species] ?? "");
    const place = placeOf({ row: Math.floor(a.y), col: Math.floor(a.x) });
    if (call && place?.inView)
      setTimeout(() => audio.play(call, { at: place, cooldown: 1200 }), delay);
  }
  /** A woodpecker drums on dead wood on screen now and then (D-185). */
  let lastDrum = 0;
  function drumming(now: number) {
    const [l, v] = [live, viewer];
    if (!l || !v || now - lastDrum < 4000) return;
    lastDrum = now;
    const dead = l.fields().deadwood;
    if (!dead || Math.random() > 0.2 + 0.5 * v.closeness()) return;
    const n = l.meta.n;
    const cells: number[] = [];
    for (let c = 0; c < dead.length; c++) if ((dead[c] ?? 0) > 0) cells.push(c);
    const c = cells[Math.floor(Math.random() * cells.length)];
    if (c === undefined) return;
    const place = placeOf({ row: Math.floor(c / n), col: c % n });
    if (place?.inView) audio.play("fx.drum", { at: place, gain: 0.8 });
  }
  /** A tree reaching full size near the camera creaks (D-185): the canopy cover of a cell on
   *  screen crosses GROWN between two field frames. */
  const GROWN = 200;
  let lastCanopy: Uint8Array | null = null;
  let lastCreak = 0;
  function creaks(now: number) {
    const [l, v] = [live, viewer];
    if (!l || !v) return;
    const canopy = l.fields().cover[3];
    if (!canopy || canopy === lastCanopy) return;
    const before = lastCanopy;
    lastCanopy = canopy;
    if (!before || before.length !== canopy.length || v.closeness() < 0.4) return;
    if (now - lastCreak < 3000) return;
    const n = l.meta.n;
    for (let c = 0; c < canopy.length; c++) {
      if ((before[c] ?? 0) >= GROWN || (canopy[c] ?? 0) < GROWN) continue;
      const place = placeOf({ row: Math.floor(c / n), col: c % n });
      if (!place?.inView) continue;
      lastCreak = now;
      audio.play("fx.creak", { at: place });
      return;
    }
  }
  /** A planting's sound by plant group (D-179): herbs light, shrubs fuller, trees deep, water
   *  plants watery. */
  function plantSound(s: Species | undefined): string {
    if (s?.family === "W") return "fx.plant.water";
    if ((s?.level ?? 1) >= 4) return "fx.plant.tree";
    if ((s?.level ?? 1) === 3) return "fx.plant.shrub";
    return "fx.plant.herb";
  }
  /** Life in the soundscape (D-179): birds and insects arrive with your first shrub, fully with
   *  your first tree; bare land is quiet. */
  function lifeOf(names: Set<string>): number {
    const fam = (f: string) =>
      (replay?.meta.species ?? []).some((x) => x.family === f && names.has(x.name));
    return fam("L4") ? 1 : fam("L3") ? 0.5 : 0;
  }
  /** Enemy swarms eating your plants munch now and then (D-179), at one of them on screen. */
  let lastMunch = 0;
  function munching(now: number) {
    const [l, v] = [live, viewer];
    if (!l || !v || now - lastMunch < 2200) return;
    const owner = l.fields().owner;
    const n = l.meta.n;
    const raiders = v.visibleAnimals().filter((a) => {
      const k = kinds[a.species];
      return a.owner !== me && k?.swarm && owner[Math.floor(a.y) * n + Math.floor(a.x)] === me;
    });
    if (raiders.length < 3) return;
    const a = raiders[Math.floor(Math.random() * raiders.length)];
    const place = a ? placeOf({ row: Math.floor(a.y), col: Math.floor(a.x) }) : null;
    if (!place?.inView) return;
    lastMunch = now;
    audio.play("fx.munch", { at: place });
  }
  /** The call of an animal species (D-177), if it has one. */
  function callOf(name: string): string | null {
    const s = replay?.meta.species.find((x) => x.name === name);
    return s ? voiceOf(name, bodyOf(name, s.role as never).body) : null;
  }
  /** Now and then, an animal somewhere on the map calls (D-177, D-195): every 3–8 s, more often
   *  the more animals there are. On screen it calls from its place; off screen, a quiet,
   *  distant call from its side. */
  let nextLife = 0;
  function animalLife(now: number) {
    const v = viewer;
    if (!v || !replay || now < nextLife) return;
    nextLife = now + 3000 + Math.random() * 5000;
    const all = v.visibleAnimals();
    if (Math.random() > Math.min(1, 0.3 + all.length / 60)) return;
    const a = all[Math.floor(Math.random() * all.length)];
    if (!a) return;
    const call = callOf(replay.meta.fauna.names[a.species] ?? "");
    const place = placeOf({ row: Math.floor(a.y), col: Math.floor(a.x) });
    if (!call || !place) return;
    if (place.inView) audio.play(call, { at: place, gain: 0.55 });
    else {
      const x = Math.min(Math.max(place.x, 0), place.width); // from its side of the screen
      audio.play(call, { at: { ...place, x, inView: true }, gain: 0.2 });
    }
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
      raided ||= a.text.startsWith("Enemy");
      if (a.text.startsWith("Enemy")) music.alarm(); // the music turns tense (D-185)
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
    const share = [1, 2].map((p) => l.meta.series[`territory_p${p}`]?.at(-1) ?? 0);
    homeless = (share[me - 1] ?? 0) === 0;
    for (const text of victory.scan(share, me, l.victory, tick * l.meta.dt, l.timeLimitS)) {
      toast(text, "info");
    }
    if (available) {
      for (const name of can) if (!available.has(name)) toast(`${label(name)}: available`, "info");
    }
    available = can;
    const animalsUnlocked = kinds.filter((_, i) => {
      const s = fauna[i];
      return s ? unlocked.has(s.name) : false;
    }).length;
    if (tutorial) {
      const n = l.meta.n;
      // Swarms cannot be selected or ordered: the tutorial teaches with animals that can.
      const mine = v.visibleAnimals().filter((a) => {
        const sp = fauna[a.species];
        return a.owner === me && sp !== undefined && !isSwarm(sp);
      });
      const onEnemy = mine.filter(
        (a) => fields.owner[Math.floor(a.y) * n + Math.floor(a.x)] === 3 - me,
      ).length;
      // The highest plant layer held: plant counts come first, in flora-table order.
      const cells = l.counts(tick, me);
      const layer = l.meta.flora.level.reduce(
        (top, level, i) => ((cells[i] ?? 0) > 0 ? Math.max(top, level) : top),
        0,
      );
      // Predator-prey loop (D-141): births (animals no spawn order brought), drops that landed on
      // enemy land a moment ago, and the animal species the player fields.
      const born = mine.filter((a) => !l.wasCalled(a.id)).length;
      const airdropped = mine.filter(
        (a) =>
          l.droppedAt(a.id) !== undefined &&
          fields.owner[Math.floor(a.y) * n + Math.floor(a.x)] === 3 - me,
      ).length;
      const held = new Set(
        v.visibleAnimals().flatMap((a) => (a.owner === me ? [fauna[a.species]?.name ?? ""] : [])),
      );
      if (OBJECTIVES[tutorialStep]?.title === DEFEND_TITLE) raid(l, fields, now);
      const step = advance(tutorialStep, {
        owned: share[me - 1] ?? 0,
        unlocked,
        animals: mine.length,
        onEnemy: raidOrdered ? onEnemy : 0, // grazers drifting over the front do not count
        acked,
        overlay,
        techOpened: techSeen,
        layer,
        plants: new Set(l.meta.flora.names.filter((_, i) => (cells[i] ?? 0) > 0)),
        selected: selection.size,
        born,
        airdropped,
        fauna: held,
        swarm: v
          .visibleAnimals()
          .filter((a) => a.owner === 3 - me && fauna[a.species]?.name === "grasshoppers").length,
        raidOver: raidWaves >= RAID.waves,
      });
      if (step !== tutorialStep) {
        tutorialStep = step;
        // No waiting to save up (D-144): grant the new step's shortfall (tutorial only).
        const bank = l.meta.series[`bank_p${me}`]?.at(-1) ?? 0;
        const gift = topUp(step, bank);
        if (gift > 0) l.grant(me, gift);
        toast(step < OBJECTIVES.length ? "Objective done" : "Tutorial complete", "info");
      }
      return; // no first-match tips during the tutorial: the objectives guide
    }
    const tip = tips.scan({
      t: tick * l.meta.dt,
      canUnlock: can.size > 0,
      animalsUnlocked,
      animals: v.visibleAnimals().filter((a) => a.owner === me).length,
      raided,
    });
    if (tip) toast(tip, "tip");
  }

  /** The tutorial's scripted raid (D-141): the bot drops a grasshopper swarm onto the player's
   *  grass nearest its own land, a wave every RAID.everyMs. The bot's commands go through the same
   *  queue as anyone's; the grant keeps them affordable (refused outside the tutorial). */
  function raid(l: Live, fields: Fields, now: number) {
    if (raidWaves >= RAID.waves || now < raidNext) return;
    const n = l.meta.n;
    const grass = fields.species[l.meta.flora.names.indexOf("grasses")];
    const enemy: number[] = [];
    fields.owner.forEach((o, k) => o === 3 - me && enemy.push(k));
    let best = -1;
    let bestD = Infinity;
    fields.owner.forEach((o, k) => {
      if (o !== me || !grass?.[k]) return;
      const [r, c] = [Math.floor(k / n), k % n];
      for (const e of enemy) {
        const d = (Math.floor(e / n) - r) ** 2 + ((e % n) - c) ** 2;
        if (d < bestD) [best, bestD] = [k, d];
      }
    });
    if (best < 0) return; // no grass of yours to raid yet
    const bot = (3 - me) as 1 | 2;
    raidNext = now + RAID.everyMs;
    raidWaves++;
    l.grant(bot, RAID.grant);
    if (!l.unlocked(bot).has("grasshoppers")) l.unlock(bot, "grasshoppers");
    l.spawn(bot, "grasshoppers", Math.floor(best / n), best % n);
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
  // The same Set while nothing new is unlocked (D-202): the effects and cards that read it don't
  // rerun on every tick.
  let lastUnlocked = new Set<string>();
  const unlocked = $derived.by(() => {
    void tick; // live unlocks arrive with the ticks
    const now = replay ? unlockedNow(replay, player, tick) : new Set<string>();
    if (now.size === lastUnlocked.size && [...now].every((x) => lastUnlocked.has(x))) {
      return lastUnlocked;
    }
    lastUnlocked = now;
    return now;
  });
  // A victory or defeat stinger as the end screen opens (D-185).
  let stung: Outcome | null = null;
  $effect(() => {
    if (!outcome || outcome === stung) return;
    stung = outcome;
    audio.play(outcome.winner === me ? "ui.victory" : "ui.defeat");
  });
  // Unlock feedback (D-169): once the worker confirms an unlock, the species is armed in hand
  // (one click saved) and its card pops.
  let pendingArm: string | null = null;
  let popped = $state<string | null>(null);
  const unlock = (name: string) => {
    live?.unlock(me, name);
    pendingArm = name;
  };
  $effect(() => {
    const now = unlocked;
    const name = pendingArm;
    if (!name || !now.has(name)) return;
    pendingArm = null;
    planting = name;
    popped = name;
    audio.play(unlockSound(replay?.meta.species.find((x) => x.name === name)?.family)); // D-185
    setTimeout(() => {
      if (popped === name) popped = null;
    }, 900);
  });
  const armedKind = $derived(
    replay?.meta.species.find((s) => s.name === planting)?.kind ?? "flora",
  );
  let cell = $state<{ row: number; col: number } | null>(null);
  const cellInfo = $derived(replay && cell ? replay.cell(tick, cell.row, cell.col) : null);
  // The unit card (D-161): the clicked or box-selected animals, or the strategic icon under the
  // pointer while hovered; it follows them every tick and goes when they are gone.
  let unitIds = $state<number[]>([]);
  /** The share of the map that wins now (D-175), for the tug bar's marks. */
  const victoryNow = $derived.by(() => {
    void tick;
    return live ? live.victoryNow : null;
  });
  /** The animals drawn now, refreshed with the HUD tick (the unit list, D-174). */
  const listAnimals = $derived.by(() => {
    void tick;
    return viewer?.visibleAnimals() ?? [];
  });
  let hoverIds = $state<number[] | null>(null);
  const unit = $derived.by(() => {
    void tick;
    const ids = hoverIds ?? unitIds;
    if (!viewer || !replay || !ids.length) return null;
    const card = unitCard(viewer.visibleAnimals(), ids);
    const name = card ? replay.meta.fauna.names[card.species] : undefined;
    const s = name ? replay.meta.species.find((x) => x.name === name) : undefined;
    return card && s ? { card, s } : null;
  });
  let box: { x0: number; y0: number; x1: number; y1: number } | null = $state(null);
  let layers: Record<Layer, boolean> = $state({
    territory: true,
    L1: true,
    L2: true,
    L3: true,
    L4: true,
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
    const frameStart = performance.now();
    const r = replay;
    const seconds = Math.min((now - last) / 1000, 0.1);
    if (Math.floor(frameTick) !== tick) frameTick = tick; // a seek on the timeline, or a reset
    if (live) {
      frameTick = live.renderTick(now); // between the last two animal frames: animals glide
      simMs = live.simMs;
      if (live.error) error = live.error;
      if (live.netProblem) error = live.netProblem;
      if (live.stalled !== stalled) stalled = live.stalled;
      if (live.result !== outcome) outcome = live.result;
      for (const n of live.notices) {
        if (n.player !== me || n.at <= seenNotice) continue;
        seenNotice = n.at;
        toast(shortNotice(label(n.text)), "notice"); // short and red (D-170)
      }
      if (now - lastScan > SCAN_MS) {
        lastScan = now;
        scan(now);
      }
      aim(now);
      if (live.weather !== weather) {
        for (const text of weatherToasts(weather, live.weather)) toast(text, "alert", undefined, 1);
        if (live.weather.phase === "alert" && weather.phase !== "alert") audio.play("fx.rumble"); // D-185
        viewer?.setWeather(live.weather.kind, live.weather.phase);
        weather = live.weather;
      }
      if (now - lastIcons > ICONS_MS) {
        lastIcons = now;
        placeIcons();
        ambience.set(moodOf(weather.kind, weather.phase), weather.phase === "alert" ? 0.35 : 1);
        ambience.setPaused(!playing);
        if (viewer) {
          ambience.setNear(viewer.closeness());
          ambience.setWater(viewer.hasWater());
        }
        ambience.setLife(lifeOf(unlocked));
        animalLife(now);
        munching(now);
        drumming(now);
        creaks(now);
      }
      const showing = fresh(toasts, now);
      if (showing.length !== toasts.length) toasts = showing;
    }
    if (r && viewer) {
      if (live) {
        // the worker keeps time
      } else if (playing) {
        frameTick = Math.min(frameTick + (seconds / r.meta.dt) * speed, r.meta.ticks - 1);
        if (frameTick >= r.meta.ticks - 1) playing = false;
      }
      if (!techOpen) viewer.moveCamera(keys, seconds);
      if (live) {
        for (const e of live.takeEffects()) {
          const c = live.catastrophes[e.card];
          if (!c) continue;
          const at = { row: e.row, col: e.col };
          const look = CATASTROPHE_LOOK[c.act];
          viewer.catastropheFx(c.act, at, c.radius, c.duration_s, look?.color ?? WORLD.alert);
          const cue = { kill_trees: "fx.caterpillars", storm: "fx.storm", spill: "fx.spill" }[
            c.act
          ];
          if (cue) audio.play(cue, { at: placeOf(at) });
          if (e.player !== me) {
            toast(`Enemy ${label(c.name).toLowerCase()}!`, "alert", at, 2);
            audio.play("fx.rumble", { gain: 0.8 }); // D-185
          }
        }
      }
      if (Math.floor(frameTick) !== tick) tick = Math.floor(frameTick);
      const before = performance.now();
      appTiming.add("app", before - frameStart);
      viewer.render(frameTick);
      const after = performance.now();
      projectIcons(); // after the camera moved this frame
      appTiming.add("icons", performance.now() - after);
      if (perfBench && live) benchStep(now);
    }
    perfFrames++;
    perfWorst = Math.max(perfWorst, now - last);
    if (now - perfStart >= 500) {
      const fps = (perfFrames * 1000) / (now - perfStart);
      perf = `${fps.toFixed(0)} fps · worst ${perfWorst.toFixed(0)} ms · ${viewer?.backend ?? ""}`;
      if (showPerf && viewer) {
        if (now - lastCensus > 2000) {
          lastCensus = now;
          censusLine = censusText(viewer.census());
        }
        const gpu = viewer.gpuMs ? ` · gpu ${viewer.gpuMs.toFixed(1)} ms` : "";
        const res = ` · res ${viewer.res.scale.toFixed(1)}`; // dynamic resolution (D-200)
        perfDetail = `js: ${appTiming.text()} · ${viewer.timing.text()}${gpu}${res}\ntris/draws: ${censusLine}`;
      }
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
    weather = CLEAR;
    overlay = null;
    front = new FrontWatch();
    victory = new VictoryWatch();
    tips = new TipWatch(loadSeen(), saveSeen);
    raided = false;
    homeless = name === LIVE;
    try {
      if (name === LIVE) {
        // ?seed=N&size=N (0 = the balance grid size); a fixed default seed keeps runs reproducible
        const q = new URLSearchParams(location.search);
        const relay = q.get("relay") ?? undefined; // ?relay=ws://host:port: lockstep (D-062)
        joining = !!relay;
        // The menu's setup (URL parameters win), or the tutorial's fixed match.
        const s = tutorial ? TUTORIAL_SETUP : withUrl(setup, location.search);
        // ?size=N wins (tools); a lockstep match uses the balance grid, the same for both peers.
        const size = relay ? 0 : Number(q.get("size") ?? MAP_SIZES[s.map]);
        live = await Live.start(s.seed, size, s.sandbox, s.bot, relay, tutorial);
        joining = false;
        player = live.me; // view your own side
        replay = live;
        speed = 1; // a match starts in real time (D-069)
      } else {
        replay = await loadReplay(`replays/${name}`);
        speed = 4; // replays: fast playback
      }
      viewer = await Viewer.create(canvas, replay, quality, !!perfBench);
      viewer.resize();
      // Dev only: lets a browser check drive the camera and the match (window.ecoViewer, ecoLive).
      if (import.meta.env.DEV) Object.assign(window, { ecoViewer: viewer, ecoLive: live });
      if (perfBench && live) {
        live.send({ type: "bot", player: live.me, level: "hard" }); // both sides played (D-198)
        speed = 8;
      }
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
    if (ids.length) speak(ids, SELECT_CALL); // D-182
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
    audio.play("fx.order");
    if (kind !== "stop") speak(selection, ORDER_CALL, 150); // D-182
    if (kind !== "stop" && at) viewer?.addOrder([...selection], at, kind); // its line (D-162)
    if (kind !== "stop" && at && enemyAt(at)) raidOrdered = true; // for the tutorial
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
    const r = canvas.getBoundingClientRect();
    const [x, y] = [e.clientX - r.left, e.clientY - r.top];
    if (planting && viewer) {
      const aim = viewer.aimGhost(x, y);
      dropTag = aim?.offLand && armedKind === "fauna" ? { x, y } : null;
    }
    if (!box) return;
    box = { ...box, x1: x, y1: y };
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
    if (click && castArmed && live) {
      const at = viewer.pickCell(box.x0, box.y0);
      if (at) live.catastrophe(me, castArmed, at.row, at.col);
      if (!e.shiftKey) castArmed = null;
      box = null;
      return;
    }
    if (click && attackArmed) {
      order("attack", viewer.pickCell(box.x0, box.y0));
      if (!e.shiftKey) attackArmed = false;
      box = null;
      return;
    }
    const at = click && planting && live ? viewer.pickCell(box.x0, box.y0) : null;
    if (at && planting && live) {
      // Shift keeps the order armed, like RTS build orders.
      if (armedKind === "flora") {
        live.plant(me, planting, at.row, at.col);
        const s = live.meta.species.find((x) => x.name === planting);
        viewer.plantFeedback(at, live.plantRadius, plantColor(planting, s?.level ?? 1, me));
        audio.play(plantSound(s), { at: placeOf(at), gain: 1.4 });
      } else {
        live.spawn(me, planting, at.row, at.col);
        const place = placeOf(at);
        audio.play("fx.drop", { at: place });
        const call = callOf(planting);
        // Most drops land with a call (D-179), not every one.
        if (call && Math.random() < DROP_CALL)
          setTimeout(() => audio.play(call, { at: place }), 450);
      }
      if (!e.shiftKey) planting = null;
    } else if (click) {
      // A click on an animal (anyone's) shows its card, and selects it when it is yours
      // (D-161); elsewhere it inspects the cell under the cursor.
      const hit = viewer.pick(box.x0, box.y0, box.x0, box.y0, null)[0];
      const mine = live ? me : player;
      if (hit !== undefined) {
        const a = viewer.visibleAnimals().find((x) => x.id === hit);
        if (a?.owner === mine) select([hit]);
        unitIds = [hit];
        inspect(null);
      } else {
        unitIds = [];
        inspect(viewer.pickCell(box.x0, box.y0));
      }
    } else {
      const ids = viewer.pick(box.x0, box.y0, box.x1, box.y1, live ? me : player); // own animals
      select(ids);
      unitIds = ids;
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
    if (down && inMenu && catalog && key === "Escape") catalog = null; // the Species page (D-140)
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
    } else if (key === "i") {
      showIcons = !showIcons;
    } else if (key === "m") {
      const muted = !audio.volumes.muted; // D-178
      audio.setVolumes({ muted });
      toast(muted ? "Sound off (M)" : "Sound on (M)", "info");
    } else if (key === "t") {
      techOpen = !techOpen;
    } else if (key === "Escape") {
      if (confirmLeave) confirmLeave = false;
      else if (techOpen) techOpen = false;
      else if (attackArmed) attackArmed = false;
      else if (castArmed) castArmed = null;
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

  /** The `?perf=1` bench (D-198): warm up at 8× to the target minute, then measure 10 s at 1×
   *  from the overview and publish the figures. */
  function benchStep(now: number) {
    const b = perfBench;
    if (!b || !live || !viewer) return;
    if (b.phase === "warm" && live.renderTick(now) >= b.until) {
      speed = 1;
      viewer.resetView();
      [b.phase, b.t0, b.gaps] = ["measure", now, []];
    } else if (b.phase === "measure") {
      b.gaps.push(now - last);
      if (now - b.t0 < 10_000) return;
      b.phase = "done";
      const f = frameStats(b.gaps.slice(5)); // skip the frames right after the speed change
      const result = {
        fps: Math.round(f.fps),
        medianMs: +f.median.toFixed(1),
        p90Ms: +f.p90.toFixed(1),
        quality,
        n: live.meta.n,
        animals: viewer.visibleAnimals().length,
        gpuMs: +viewer.gpuMs.toFixed(1),
        js: `${appTiming.text()} · ${viewer.timing.text()}`,
        census: censusText(viewer.census()),
        simMs: +live.simMs.toFixed(1),
      };
      console.log("[perf]", JSON.stringify(result));
      Object.assign(window, { ecoPerf: result });
      toast(
        `perf: ${result.fps} fps, median ${result.medianMs} ms, p90 ${result.p90Ms} ms`,
        "info",
      );
    }
  }

  /** From the main menu: start a live match (`asTutorial`: the tutorial's). */
  async function launch(asTutorial = false) {
    tutorial = asTutorial;
    tutorialStep = 0;
    acked = new SvelteSet();
    techSeen = false;
    raidWaves = 0;
    raidNext = 0;
    raidOrdered = false;
    if (!asTutorial) saveSetup(setup);
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
    ambience.set("menu"); // the quiet menu bed (D-177)
    ambience.setPaused(false);
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

  /** Audio (D-177): browsers start silent, so the first gesture starts it; any button ticks. */
  function wakeAudio() {
    audio.start();
  }
  function clickSound(e: MouseEvent) {
    const el = e.target instanceof Element ? e.target : null;
    if (el?.closest("button, label.choice, [role=tab], [role=switch]")) audio.play("ui.click");
  }

  onMount(() => {
    window.addEventListener("pointerdown", wakeAudio, true);
    window.addEventListener("keydown", wakeAudio, true);
    window.addEventListener("click", clickSound, true);
    window.addEventListener("resize", resize);
    // Dev only: lets a browser check read the audio state (window.ecoAudio, ecoAmbience).
    if (import.meta.env.DEV)
      Object.assign(window, { ecoAudio: audio, ecoAmbience: ambience, ecoMusic: music });
    raf = requestAnimationFrame(frame);
    void start();
    if (perfBench) {
      showPerf = true;
      setup = {
        ...setup,
        map: (PERF.get("map") as typeof setup.map | null) ?? "large",
        bot: "hard",
      };
      void launch();
    }
  });

  onDestroy(() => {
    window.removeEventListener("pointerdown", wakeAudio, true);
    window.removeEventListener("keydown", wakeAudio, true);
    window.removeEventListener("click", clickSound, true);
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
    class:planting={attackArmed}
    class:dropping={!!planting}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerleave={() => {
      viewer?.aimGhost(null);
      dropTag = null;
    }}
    onpointerup={onPointerUp}
    oncontextmenu={(e) => e.preventDefault()}
  ></canvas>

  {#if dropTag}
    <span class="drop-tag" style:left="{dropTag.x}px" style:top="{dropTag.y}px">×1.5</span>
  {/if}
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
      victory={victoryNow}
      bind:player
      onTech={() => (techOpen = true)}
      onMenu={askMenu}
      {layers}
      {toggle}
      {quality}
      onQuality={setQuality}
      bind:perf={showPerf}
      bind:icons={showIcons}
      {replays}
      bind:chosen
      onChoose={open}
      weather={live ? { now: weather, kinds: live.weatherKinds } : undefined}
      bind:overlay
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
      {popped}
      onPickSpecies={pickSpecies}
      onClear={() => select([])}
      catastrophes={live?.catastrophes ?? []}
      waits={catastropheWaits}
      {castArmed}
      onCast={(name) => {
        castArmed = name;
        planting = null;
      }}
    />
    {#if attackArmed || planting || castArmed}
      <p class="hint">
        {#if castArmed}
          <strong>{label(castArmed)}:</strong> click the centre of the area · it hits both sides · Esc:
          cancel
        {:else if attackArmed}
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
    <div class="p{live ? me : player}" style:display="contents">
      <StrategicIcons {icons} onSelect={(ids) => select(ids)} onHover={(ids) => (hoverIds = ids)} />
    </div>
    {#if showPerf && perfDetail}
      <pre class="perf-detail">{perfDetail}</pre>
    {/if}
    {#if live && tutorial && !outcome}
      <Objectives step={tutorialStep} onMenu={toMenu} onNext={nextStep} />
      <TourPointer targets={OBJECTIVES[tutorialStep]?.point} />
    {:else if live && homeless && !outcome}
      <p class="found panel">
        <strong>Choose your spawn.</strong> Pick a plant in the bar and click anywhere on land.
      </p>
    {/if}
    <Toasts {toasts} {arrows} onGo={(t) => t.cell && viewer?.lookAt(t.cell)} />
    {#if live}
      <UnitList
        animals={listAnimals}
        species={replay?.meta.species ?? []}
        fauna={replay?.meta.fauna.names ?? []}
        {me}
        onPick={(name) => pickSpecies(name)}
      />
    {/if}
    <div class="cards">
      {#if cellInfo && cell}
        <CellPanel
          info={cellInfo}
          species={replay?.meta.species ?? []}
          me={live ? me : player}
          onZoom={() => cell && viewer?.zoomToCell(cell)}
          onClose={() => inspect(null)}
        />
      {/if}
      {#if unit}
        <UnitPanel
          card={unit.card}
          species={unit.s}
          all={replay?.meta.species ?? []}
          me={live ? me : player}
          onClose={() => {
            unitIds = [];
            hoverIds = null;
          }}
        />
      {/if}
    </div>
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
      human={me}
      series={replay.meta.series}
      dt={replay.meta.dt}
      onMenu={toMenu}
      onAgain={() => launch(tutorial)}
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
  {#if inMenu}
    <MainMenu
      bind:setup
      {quality}
      onQuality={setQuality}
      bind:icons={showIcons}
      bind:perf={showPerf}
      tips={tipsOn}
      onTips={(on) => {
        tipsOn = on;
        saveSeen(on ? new Set() : ALL_TIPS()); // on: every tip again; off: none
      }}
      onStart={() => launch()}
      onTutorial={() => launch(true)}
      onSpecies={() => void openCatalog().catch((e: unknown) => (error = String(e)))}
    />
    {#if catalog}
      <div class="catalog">
        <TechTree replay={catalog} tick={0} player={1} onClose={() => (catalog = null)} />
      </div>
    {/if}
  {/if}
</main>

<style>
  /* The perf panel's detail (D-198). */
  .perf-detail {
    position: fixed;
    left: 12px;
    bottom: 96px;
    z-index: 20;
    margin: 0;
    padding: 6px 8px;
    max-width: min(92vw, 900px);
    white-space: pre-wrap;
    font:
      11px/1.4 ui-monospace,
      monospace;
    color: var(--ink-soft);
    background: rgb(0 0 0 / 0.45);
    border-radius: 6px;
    pointer-events: none;
  }
  /* The Species page sits over the main menu (D-140). */
  .catalog {
    position: absolute;
    inset: 0;
    z-index: 25;
  }
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
  /* The cell and unit cards, stacked on the right (D-161). */
  .cards {
    position: absolute;
    top: 74px;
    right: 14px;
    z-index: 4;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 10px;
    pointer-events: none;
  }
  .cards > :global(*) {
    pointer-events: auto;
  }
  canvas.planting {
    cursor: crosshair !important;
  }
  canvas.dropping {
    cursor: none !important; /* the ghost model is the cursor (D-079) */
  }
  .drop-tag {
    position: absolute;
    transform: translate(16px, -30px);
    padding: 1px 8px;
    border-radius: 999px;
    font-size: 0.8em;
    font-weight: 700;
    color: #2a120c;
    background: #ff7a5c;
    pointer-events: none;
  }
  .box {
    position: absolute;
    border: 1px solid var(--gold);
    background: rgba(216, 180, 92, 0.12);
    box-shadow: 0 0 10px rgba(216, 180, 92, 0.4);
    pointer-events: none;
  }
  /* The armed card's prompt, above the build bar (D-175: the top-left holds the speed bar). */
  .hint {
    position: absolute;
    bottom: 104px;
    left: 50%;
    transform: translateX(-50%);
    white-space: nowrap;
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
  .found {
    position: absolute;
    top: 74px;
    left: 50%;
    transform: translateX(-50%);
    margin: 0;
    padding: 6px 14px;
    pointer-events: none;
  }
  .found strong {
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
