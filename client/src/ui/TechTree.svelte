<script lang="ts">
  // Tech tree as a food web (D-124). Three rows, bottom-up: plants, grazers, hunters; each grazer
  // family stands over the plant layer it eats, the recyclers over the dead biomass. Every
  // feeding link is drawn faintly; hovering or clicking a species lights its foods (gold, thicker
  // for the primary) and its hunters (red), and dims the rest. Species the enemy fields now carry
  // an orange mark, and your counters to them a target; "Counters" keeps only those lit. The side
  // panel shows the focused species: stats, diet, hunters, habitat, what unlocks it.
  import {
    COLUMNS,
    LITTER,
    LITTER_ID,
    counters,
    links,
    related,
    ROWS,
    slotOf,
  } from "../game/foodweb";
  import {
    cardState,
    eatersOf,
    families,
    habitatPlants,
    label,
    MEDAL,
    orList,
    quickStats,
    roleName,
    unlockedNow,
    type Family,
    groundOf,
  } from "../game/species";
  import type { Source, Species } from "../replay/replay";
  import FamilyIcon from "./FamilyIcon.svelte";
  import Icon from "./Icon.svelte";

  let {
    replay,
    tick,
    player,
    onClose,
    onUnlock,
  }: {
    replay: Source;
    tick: number;
    player: 1 | 2;
    onClose: () => void;
    onUnlock?: (name: string) => void; // live matches: buy an available card
  } = $props();

  const RANK = ["Primary", "Secondary", "Tertiary"] as const;
  const WIDTH = [3, 2, 1.4] as const; // link width by diet rank (px)

  const meta = $derived(replay.meta);
  const species = $derived(meta.species);
  const groups = $derived(families(species));
  const web = $derived(links(species));
  const unlocked = $derived(unlockedNow(replay, player, tick));
  const mine = $derived(replay.counts(tick, player));
  const theirs = $derived(replay.counts(tick, player === 1 ? 2 : 1));
  const count = (s: Species) => mine[species.indexOf(s)] ?? 0;
  /** What the enemy fields now (plants it holds, animals it has). */
  const enemy = $derived(
    new Set(species.filter((s, i) => (theirs[i] ?? 0) > 0).map((s) => s.name)),
  );
  const yours = $derived(counters(species, enemy));
  const bank = $derived.by(() => {
    void tick;
    return meta.series[`bank_p${player}`]?.at(-1) ?? 0;
  });

  let hover: string | null = $state(null);
  let pinned: string | null = $state(null);
  let countersOnly = $state(false);
  const focus = $derived(hover ?? pinned);
  const focused = $derived(species.find((s) => s.name === focus));
  const rel = $derived(focused ? related(focused, species) : null);

  /** Each family's block in its row and column. */
  const cell = (row: number, col: number): Family | undefined =>
    groups.find((g) => {
      const [r, c] = slotOf(g.key, g.kind);
      return r === row && c === col;
    });

  /** A link's look: lit for the focused species' foods and hunters, or in counters mode. */
  function linkLook(l: { eater: string; food: string; rank: number }) {
    if (focus) {
      if (l.eater === focus) return { cls: "food", w: WIDTH[l.rank] ?? 1 };
      if (l.food === focus) return { cls: "threat", w: WIDTH[l.rank] ?? 1 };
      return { cls: "off", w: 1 };
    }
    if (countersOnly) {
      return yours.has(l.eater) && enemy.has(l.food)
        ? { cls: "counter", w: WIDTH[l.rank] ?? 1 }
        : { cls: "off", w: 1 };
    }
    return { cls: "rest", w: 1 };
  }

  /** How a node reads under the current focus. */
  function nodeLook(s: Species): string {
    if (focus) {
      if (s.name === focus) return "focus";
      const f = rel?.foods.find((x) => x.s.name === s.name);
      if (f) return `food r${f.rank}`;
      const e = rel?.eaters.find((x) => x.s.name === s.name);
      if (e) return `threat r${e.rank}`;
      return "dim";
    }
    if (countersOnly) return yours.has(s.name) || enemy.has(s.name) ? "" : "dim";
    return "";
  }

  // Node positions (relative to the web), measured after layout and on resize, for the links.
  let box: HTMLDivElement | undefined = $state();
  const nodes: Record<string, HTMLElement> = $state({});
  let at: Record<string, { x: number; left: number; right: number; mid: number }> = $state({});
  function measure() {
    if (!box) return;
    const o = box.getBoundingClientRect();
    const next: typeof at = {};
    for (const [name, el] of Object.entries(nodes)) {
      const r = el.getBoundingClientRect();
      const [left, right] = [r.left - o.left + box.scrollLeft, r.right - o.left + box.scrollLeft];
      next[name] = {
        x: (left + right) / 2,
        left,
        right,
        mid: r.top - o.top + box.scrollTop + r.height / 2,
      };
    }
    at = next;
  }
  $effect(() => {
    if (!box) return;
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    measure();
    return () => ro.disconnect();
  });

  /** A link between the facing sides of two nodes, so it never runs behind a sibling; within one
   *  column, an arc through the gutter on the left. */
  function path(eater: string, food: string): string {
    const a = at[eater];
    const b = at[food];
    if (!a || !b) return "";
    if (Math.abs(a.x - b.x) < 4) {
      const k = 18 + Math.abs(a.mid - b.mid) * 0.08;
      return `M${a.left},${a.mid} C${a.left - k},${a.mid} ${b.left - k},${b.mid} ${b.left},${b.mid}`;
    }
    const dir = b.x > a.x ? 1 : -1;
    const [sx, ex] = dir > 0 ? [a.right, b.left] : [a.left, b.right];
    const k = Math.max(24, Math.abs(ex - sx) * 0.4);
    return `M${sx},${a.mid} C${sx + dir * k},${a.mid} ${ex - dir * k},${b.mid} ${ex},${b.mid}`;
  }

  /** What unlocking needs (gamerules §4.1): the previous tier, and for an animal a habitat. */
  function needs(s: Species): string {
    const prev =
      s.tier > 1
        ? species.find((o) => o.kind === s.kind && o.family === s.family && o.tier === s.tier - 1)
        : undefined;
    const parts = prev ? [label(prev.name)] : [];
    if (s.kind === "fauna" && s.habitat.length)
      parts.push(orList(habitatPlants(s, species).map((o) => label(o.name))));
    return parts.join(" + ");
  }

  function pick(s: Species) {
    pinned = pinned === s.name ? null : s.name;
  }
</script>

<div class="page p{player}" role="dialog" aria-modal="true" aria-label="Tech tree">
  <header>
    <h1>Food web</h1>
    <p class="legend">
      <span><i class="line food"></i>feeds on</span>
      <span><i class="line threat"></i>eaten by</span>
      <span><i class="dot enemy"></i>the enemy fields it</span>
      <span><Icon name="target" size={12} /> your counter</span>
      <span><i class="eaten-key">3</i>eaten by 3 species</span>
      <span class="muted">Hover or click a species · thicker = preferred food</span>
    </p>
    <label class="toggle" title="Light only your species that eat what the enemy fields now">
      <input type="checkbox" bind:checked={countersOnly} /> Counters
    </label>
    <button class="btn" onclick={onClose}>Close (Esc)</button>
  </header>

  <div class="body">
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div
      class="web"
      bind:this={box}
      onclick={(e) => e.target === e.currentTarget && (pinned = null)}
    >
      <svg class="links" aria-hidden="true">
        {#each web as l (l.eater + ">" + l.food)}
          {@const look = linkLook(l)}
          <path d={path(l.eater, l.food)} class={look.cls} stroke-width={look.w} />
        {/each}
      </svg>
      {#each ROWS as rowName, row (rowName)}
        <span class="rowname" style:grid-row={row + 1}>{rowName}</span>
        {#each Array.from({ length: COLUMNS }, (_, i) => i) as col (col)}
          {@const g = cell(row, col)}
          <div class="slot" style:grid-row={row + 1} style:grid-column={col + 2}>
            {#if g}
              <div class="family">
                <span class="fh" title={g.name}
                  ><FamilyIcon family={g.key} size={22} />{g.name}</span
                >
                {#each g.species as s (s.name)}
                  {@const state = cardState(meta, s, unlocked)}
                  {@const eaten = eatersOf(s, species).length}
                  <button
                    class="node {state} {nodeLook(s)}"
                    bind:this={nodes[s.name]}
                    onpointerenter={() => (hover = s.name)}
                    onpointerleave={() => (hover = null)}
                    onfocus={() => (hover = s.name)}
                    onblur={() => (hover = null)}
                    onclick={() => pick(s)}
                    aria-pressed={pinned === s.name}
                  >
                    <span class="medal {MEDAL[s.tier - 1] ?? 'bronze'}"></span>
                    <span class="nm">{label(s.name)}</span>
                    {#if enemy.has(s.name)}<i class="dot enemy" title="The enemy fields it"
                      ></i>{/if}
                    {#if yours.has(s.name)}
                      <span class="ctr" title="Feeds on something the enemy fields"
                        ><Icon name="target" size={11} /></span
                      >
                    {/if}
                    {#if count(s)}<span class="n">{count(s)}</span>{/if}
                    {#if eaten}
                      <!-- D-126: how many species eat it, so counters read at a glance. -->
                      <span class="eaten" title="Eaten by {eaten} species">{eaten}</span>
                    {/if}
                    {#if state !== "unlocked"}
                      <span
                        class="lk"
                        class:ready={state === "available" && s.stats.unlock_cost <= bank}
                      >
                        <Icon name="lock" size={10} />
                      </span>
                    {/if}
                  </button>
                {/each}
              </div>
            {:else if row === LITTER[0] && col === LITTER[1]}
              <div class="family">
                <span class="fh">Dead biomass</span>
                <span class="node litter" bind:this={nodes[LITTER_ID]}>litter · carcasses</span>
              </div>
            {/if}
          </div>
        {/each}
      {/each}
    </div>

    <aside class="side">
      {#if focused && rel}
        <span class="head">
          <FamilyIcon family={focused.family} size={30} />
          <span>
            <strong>{label(focused.name)}</strong>
            <small
              ><span class="medal {MEDAL[focused.tier - 1] ?? 'bronze'}"></span> tier {focused.tier} ·
              {focused.kind === "flora" ? "plant" : roleName(focused.role)}</small
            >
          </span>
        </span>
        <span class="stats">
          {#each quickStats(focused, meta.pace) as q (q.icon)}
            <span class="stat" title={q.title}><Icon name={q.icon} size={13} />{q.value}</span>
          {/each}
        </span>
        {#if focused.kind === "fauna"}
          <h3>Feeds on</h3>
          {#if focused.role === "decomposer"}
            <p class="chips"><span class="chip">dead biomass</span></p>
          {:else}
            <p class="chips">
              {#each rel.foods as f (f.s.name)}
                <button
                  class="chip food r{f.rank}"
                  title="{RANK[f.rank]} food"
                  onclick={() => (pinned = f.s.name)}
                >
                  <FamilyIcon family={f.s.family} size={16} />{label(f.s.name)}
                </button>
              {/each}
            </p>
          {/if}
        {/if}
        <h3>{focused.kind === "flora" ? "Eaten by" : "Hunted by"}</h3>
        <p class="chips">
          {#each rel.eaters as e (e.s.name)}
            <button
              class="chip threat r{e.rank}"
              title="Its {RANK[e.rank]?.toLowerCase()} food"
              onclick={() => (pinned = e.s.name)}
            >
              <FamilyIcon family={e.s.family} size={16} />{label(e.s.name)}
            </button>
          {:else}
            <span class="muted">nothing</span>
          {/each}
        </p>
        {#if focused.kind === "fauna" && focused.habitat.length}
          <h3>Habitat</h3>
          <p class="muted">Needs {focused.habitat.map(label).join(" or ")} on your land.</p>
        {/if}
        <p class="effect">{focused.stats.effect}</p>
        {#if groundOf(focused)}<p class="muted">{groundOf(focused)}.</p>{/if}
        {@const state = cardState(meta, focused, unlocked)}
        {#if state === "unlocked"}
          <p class="muted">Unlocked · you have {count(focused)}</p>
        {:else}
          <p class="muted">
            <Icon name="lock" size={11} />
            {state === "locked"
              ? `Needs ${needs(focused)} first.`
              : `Unlock for ${focused.stats.unlock_cost}.`}
          </p>
          {#if onUnlock && state === "available"}
            <button
              class="btn buy"
              disabled={focused.stats.unlock_cost > bank}
              onclick={() => onUnlock(focused.name)}
            >
              Unlock · {focused.stats.unlock_cost}
            </button>
          {/if}
        {/if}
      {:else}
        <p class="muted">
          Plants feed grazers, grazers feed hunters. Hover a species to see what it eats and what
          hunts it; click to keep it lit. Orange marks what the enemy fields now; the target marks
          your species that feed on it.
        </p>
      {/if}
    </aside>
  </div>
</div>

<style>
  .page {
    --threat: #ff7a5c;
    --enemy: var(--p2, #e69f00);
    position: absolute;
    inset: 0;
    z-index: 10;
    display: flex;
    flex-direction: column;
    background:
      radial-gradient(ellipse at 50% 0%, rgba(216, 180, 92, 0.1), transparent 60%),
      linear-gradient(180deg, #17211b, #0b100d);
  }
  .page.p2 {
    --enemy: var(--p1, #0072b2);
  }
  header {
    display: flex;
    align-items: center;
    gap: 20px;
    padding: 12px 22px;
    border-bottom: 1px solid var(--gold-soft);
  }
  h1 {
    margin: 0;
    font-size: 1.3em;
    font-weight: 900;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--gold);
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    align-items: center;
    margin: 0;
    font-size: 0.8em;
    color: var(--ink);
  }
  .legend span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .line {
    width: 18px;
    height: 3px;
    border-radius: 2px;
  }
  .line.food {
    background: var(--gold);
  }
  .line.threat {
    background: var(--threat);
  }
  .dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .eaten-key {
    display: inline-grid;
    place-items: center;
    width: 15px;
    height: 15px;
    border: 1px solid var(--threat);
    border-radius: 999px;
    color: var(--threat);
    font-size: 0.85em;
    font-style: normal;
    font-weight: 700;
  }
  .dot.enemy {
    background: var(--enemy);
    box-shadow: 0 0 0 1.5px rgba(0, 0, 0, 0.5);
  }
  .muted {
    color: var(--ink-soft);
  }
  .toggle {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    margin-left: auto;
    font-size: 0.85em;
    cursor: var(--cursor-pointer);
  }
  .body {
    flex: 1;
    display: flex;
    min-height: 0;
  }
  .web {
    position: relative;
    flex: 1;
    display: grid;
    grid-template-columns: 22px repeat(6, minmax(0, 1fr));
    grid-template-rows: repeat(3, auto);
    align-content: space-evenly;
    gap: 26px 22px;
    padding: 18px 16px 18px 10px;
    overflow: auto;
  }
  .links {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    overflow: visible;
  }
  .links path {
    fill: none;
    stroke-linecap: round;
    transition:
      opacity 0.15s,
      stroke 0.15s;
  }
  .links .rest {
    stroke: var(--ink);
    opacity: 0.13;
  }
  .links .off {
    stroke: var(--ink);
    opacity: 0.03;
  }
  .links .food {
    stroke: var(--gold);
    opacity: 0.95;
  }
  .links .threat {
    stroke: var(--threat);
    opacity: 0.95;
  }
  .links .counter {
    stroke: var(--gold);
    opacity: 0.9;
  }
  .rowname {
    grid-column: 1;
    align-self: center;
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    font-size: 0.7em;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  .slot {
    position: relative;
    display: flex;
    justify-content: center;
  }
  .family {
    display: flex;
    flex-direction: column;
    gap: 5px;
    width: 100%;
    min-width: 0;
    max-width: 190px;
  }
  .fh {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 0.72em;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  .node {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 5px 7px;
    border: 1px solid var(--line);
    border-radius: 9px;
    background: rgba(20, 28, 22, 0.92);
    color: var(--ink);
    font-size: 0.82em;
    text-align: left;
    cursor: var(--cursor-pointer);
    transition:
      opacity 0.15s,
      border-color 0.15s,
      box-shadow 0.15s;
  }
  .node.locked {
    color: var(--ink-soft);
    background: rgba(20, 24, 22, 0.85);
  }
  .node.litter {
    cursor: var(--cursor);
    color: var(--ink-soft);
    font-style: italic;
  }
  .node.dim {
    opacity: 0.3;
  }
  .node.focus {
    border-color: var(--ink);
    box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.25);
  }
  .node.food {
    border-color: var(--gold);
    box-shadow: 0 0 10px var(--gold-soft);
  }
  .node.threat {
    border-color: var(--threat);
    box-shadow: 0 0 10px rgba(255, 122, 92, 0.35);
  }
  .node.r0 {
    border-width: 2px;
  }
  .nm {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .n {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--player-glow);
  }
  .eaten {
    display: inline-grid;
    place-items: center;
    min-width: 15px;
    height: 15px;
    padding: 0 3px;
    border: 1px solid var(--threat);
    border-radius: 999px;
    color: var(--threat);
    font-size: 0.78em;
    font-weight: 700;
  }
  .ctr {
    display: inline-grid;
    color: var(--gold);
  }
  .lk {
    display: inline-grid;
    place-items: center;
    width: 15px;
    height: 15px;
    border-radius: 50%;
    color: #fff;
    background: rgba(0, 0, 0, 0.55);
  }
  .lk.ready {
    color: #1d1a12;
    background: var(--gold);
  }
  .side {
    width: 270px;
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 18px 18px 20px;
    border-left: 1px solid var(--line);
    background: rgba(10, 14, 12, 0.5);
    overflow: auto;
    font-size: 0.88em;
  }
  .head {
    display: flex;
    gap: 10px;
    align-items: center;
  }
  .head strong {
    display: block;
    font-size: 1.2em;
    color: var(--gold);
  }
  .head small {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--ink-soft);
  }
  .stats {
    display: grid;
    grid-template-columns: auto auto;
    gap: 3px 12px;
    margin: 4px 0;
    font-weight: 700;
  }
  .stat {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  h3 {
    margin: 8px 0 0;
    font-size: 0.72em;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin: 0;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px 2px 3px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: none;
    color: var(--ink);
    font-size: 0.95em;
    cursor: var(--cursor-pointer);
  }
  .chip.food {
    border-color: var(--gold);
  }
  .chip.threat {
    border-color: var(--threat);
  }
  .chip.r0 {
    font-weight: 700;
    border-width: 2px;
  }
  .effect {
    margin: 8px 0 0;
    font-style: italic;
    color: var(--ink-soft);
  }
  p {
    margin: 0;
    line-height: 1.4;
  }
  .buy {
    align-self: flex-start;
    margin-top: 6px;
  }
</style>
