<script lang="ts">
  // Game feel overlay (D-233, D-234): short-lived marks pinned to map cells: the income pulse's
  // floating numbers, your hunters' bites and your animals' panic, a leaf bit where grazers feed
  // on the other side's land (in the plants' owner's colour), and a springy shoot (herbs and
  // undergrowth) or sapling (shrubs and trees) where you plant, with sparkles by layer and tier.
  // The host re-projects them every frame (`follow`), so they stay put while the camera moves.
  // Each mark removes itself when its animation ends; there are never more than MAX at once.
  type At = { row: number; col: number };
  type Mark = At & { id: number; x: number; y: number; shown: boolean } & (
      | { kind: "income"; text: string; color: string; scale: number }
      | { kind: "won" | "lost" }
      | { kind: "crumb"; color: string }
      | { kind: "sprout" | "sapling"; color: string; tier: number; level: number }
    );
  /** A mark before its id and screen place: `Omit` taken over each kind of the union. */
  type Each<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
  type Draft = Each<Mark, "id" | "x" | "y" | "shown">;
  type Project = (at: At) => { x: number; y: number; inView: boolean };

  const MAX = 140;
  /** Sparkle colour by tier: bronze, silver, gold; their count by layer (D-234). */
  const TIER_COLOR = ["#d79a5a", "#e4e9ef", "#ffd75e"] as const;
  const SPARKS_PER_LAYER = 2;

  let marks: Mark[] = $state([]);
  let next = 0;
  let project: Project | null = null;

  function add(m: Draft) {
    if (marks.length >= MAX || !project) return;
    const p = project(m);
    marks = [...marks, { ...m, id: next++, x: p.x, y: p.y, shown: p.inView } as Mark];
  }

  function done(e: AnimationEvent, id: number) {
    if (e.target === e.currentTarget) marks = marks.filter((m) => m.id !== id);
  }

  /** Every frame, after the camera moved: put each mark back over its cell (D-234). */
  export function follow(p: Project) {
    project = p;
    if (!marks.length) return;
    marks = marks.map((m) => {
      const s = p(m);
      return { ...m, x: s.x, y: s.y, shown: s.inView };
    });
  }

  /** A floating income number over a patch of your land. */
  export function income(at: At, text: string, color: string, scale: number) {
    add({ kind: "income", ...at, text, color, scale });
  }
  /** Your hunter's kill ("won") or your animal caught ("lost"). */
  export function kill(kind: "won" | "lost", at: At) {
    add({ kind, ...at });
  }
  /** A leaf bit where a grazer feeds on the other side's plants, in their owner's colour. */
  export function crumb(at: At, color: string) {
    add({ kind: "crumb", ...at, color });
  }
  /** A planting: a shoot (layers 1-2) or a sapling (3-4), sparkles by layer and tier. */
  export function sprout(at: At, color: string, tier: number, level: number) {
    add({ kind: level >= 3 ? "sapling" : "sprout", ...at, color, tier, level });
  }
</script>

<div class="juice" aria-hidden="true">
  {#each marks as m (m.id)}
    <div
      class="mark {m.kind}"
      class:hidden={!m.shown}
      style:--x="{m.x}px"
      style:--y="{m.y}px"
      onanimationend={(e) => done(e, m.id)}
    >
      {#if m.kind === "income"}
        <span class="num" style:color={m.color} style:--s={m.scale}>{m.text}</span>
      {:else if m.kind === "won"}
        <span class="jaw top"></span><span class="jaw bottom"></span><span class="ring"></span>
      {:else if m.kind === "lost"}
        <span class="ring"></span><span class="bang">!</span>
      {:else if m.kind === "crumb"}
        <span class="leaf" style:background={m.color}></span>
      {:else if m.kind === "sprout" || m.kind === "sapling"}
        {#if m.kind === "sprout"}
          <span class="shoot" style:background={m.color}></span>
        {:else}
          <span class="sapling"
            ><span class="trunk"></span><span class="crown" style:background={m.color}></span></span
          >
        {/if}
        {@const sparks = SPARKS_PER_LAYER * Math.max(1, m.level)}
        {@const color = TIER_COLOR[Math.min(Math.max(m.tier, 1), 3) - 1]}
        {#each Array.from({ length: sparks }, (_, i) => i) as i (i)}
          <span
            class="star"
            style:color
            style:--a="{(i * 360) / sparks}deg"
            style:--d="{12 + 3 * m.level}px">✦</span
          >
        {/each}
      {/if}
    </div>
  {/each}
</div>

<style>
  .juice {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 2;
    overflow: hidden;
  }
  .mark {
    position: absolute;
    left: 0;
    top: 0;
    translate: var(--x) var(--y);
  }
  .mark.hidden {
    visibility: hidden;
  }
  .mark > * {
    position: absolute;
  }

  /* Income: a heartbeat pop, then it rises and fades, a dark edge so it reads on grass. The
     animation is on the number: the mark's own translate places it (D-235). */
  .income {
    animation: hold 1.4s linear forwards;
  }
  .income .num {
    animation:
      rise 1.4s ease-out forwards,
      beat 0.5s ease-out;
  }
  @keyframes beat {
    0% {
      scale: 0.6;
    }
    30% {
      scale: 1.3;
    }
    60% {
      scale: 0.95;
    }
    100% {
      scale: 1;
    }
  }
  .num {
    transform: translate(-50%, -50%) scale(var(--s));
    font-weight: 800;
    font-size: 15px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    text-shadow:
      0 0 3px rgba(0, 0, 0, 0.85),
      0 1px 2px rgba(0, 0, 0, 0.7);
  }
  @keyframes rise {
    0% {
      opacity: 0;
      translate: 0 6px;
    }
    15% {
      opacity: 1;
    }
    100% {
      opacity: 0;
      translate: 0 -34px;
    }
  }

  /* Your kill: two jaws snap shut over a golden flash. */
  .won {
    animation: hold 0.7s linear forwards;
  }
  .jaw {
    left: -9px;
    width: 18px;
    height: 9px;
    background: #fff4d6;
    clip-path: polygon(0 0, 100% 0, 83% 100%, 67% 0, 50% 100%, 33% 0, 17% 100%);
    filter: drop-shadow(0 0 3px #ffb43c);
  }
  .jaw.top {
    animation: snap-top 0.35s ease-in forwards;
  }
  .jaw.bottom {
    transform: scaleY(-1);
    animation: snap-bottom 0.35s ease-in forwards;
  }
  @keyframes snap-top {
    from {
      top: -18px;
    }
    to {
      top: -9px;
    }
  }
  @keyframes snap-bottom {
    from {
      top: 9px;
    }
    to {
      top: 0;
    }
  }
  .won .ring {
    border-color: #ffb43c;
  }
  .ring {
    left: -14px;
    top: -14px;
    width: 28px;
    height: 28px;
    border: 2px solid var(--threat);
    border-radius: 50%;
    animation: burst 0.7s ease-out forwards;
  }
  @keyframes burst {
    from {
      opacity: 1;
      scale: 0.4;
    }
    to {
      opacity: 0;
      scale: 1.6;
    }
  }
  @keyframes hold {
    to {
      opacity: 0.99;
    }
  }

  /* Your animal caught: a red ring and a shaking "!". */
  .lost {
    animation: hold 0.8s linear forwards;
  }
  .bang {
    left: -4px;
    top: -26px;
    color: #ff5a44;
    font-weight: 900;
    font-size: 18px;
    text-shadow: 0 0 4px rgba(0, 0, 0, 0.8);
    animation: panic 0.8s ease-out forwards;
  }
  @keyframes panic {
    0%,
    100% {
      opacity: 0;
    }
    10%,
    70% {
      opacity: 1;
    }
    20%,
    40%,
    60% {
      translate: -3px 0;
    }
    30%,
    50% {
      translate: 3px 0;
    }
  }

  /* Forage (D-234): one small leaf bit that lifts, turns and fades, pinned to its cell. */
  .crumb {
    animation: hold 0.7s linear forwards;
  }
  .leaf {
    left: -3px;
    top: -3px;
    width: 6px;
    height: 6px;
    border-radius: 70% 0 70% 0;
    box-shadow: 0 0 2px rgba(0, 0, 0, 0.6);
    animation: lift 0.7s ease-out forwards;
  }
  @keyframes lift {
    0% {
      opacity: 0.95;
      translate: 0 0;
      rotate: 0deg;
    }
    100% {
      opacity: 0;
      translate: 3px -12px;
      rotate: 120deg;
    }
  }

  /* Sprout: a springy pop (overshoot, settle), sparkles for the higher tiers. */
  .sprout,
  .sapling {
    animation: hold 0.9s linear forwards;
  }
  .shoot {
    left: -7px;
    top: -14px;
    width: 14px;
    height: 14px;
    border-radius: 60% 0 60% 0;
    transform-origin: 50% 100%;
    box-shadow: 0 0 6px rgba(255, 255, 255, 0.5);
    animation: spring 0.9s ease-out forwards;
  }
  @keyframes spring {
    0% {
      scale: 0;
      opacity: 1;
    }
    35% {
      scale: 1.3;
    }
    55% {
      scale: 0.9;
    }
    75% {
      scale: 1.05;
      opacity: 1;
    }
    100% {
      scale: 1;
      opacity: 0;
    }
  }
  /* Sapling (shrubs and trees, D-234): a little trunk and crown that spring up from the root. */
  .sapling .sapling {
    left: -8px;
    top: -26px;
    width: 16px;
    height: 26px;
    transform-origin: 50% 100%;
    animation: spring 0.9s ease-out forwards;
  }
  .trunk {
    position: absolute;
    left: 6.5px;
    bottom: 0;
    width: 3px;
    height: 12px;
    border-radius: 1px;
    background: #6b4a2e;
  }
  .crown {
    position: absolute;
    left: 0;
    top: 0;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    box-shadow:
      inset -2px -3px 0 rgba(0, 0, 0, 0.25),
      0 0 6px rgba(255, 255, 255, 0.4);
  }
  .star {
    left: -5px;
    top: -12px;
    font-size: 10px;
    text-shadow: 0 0 4px currentColor;
    animation: twinkle 0.9s ease-out forwards;
  }
  @keyframes twinkle {
    0% {
      opacity: 0;
      transform: rotate(var(--a)) translateY(0) rotate(calc(-1 * var(--a)));
    }
    30% {
      opacity: 1;
    }
    100% {
      opacity: 0;
      transform: rotate(var(--a)) translateY(calc(-1 * var(--d))) rotate(calc(-1 * var(--a)));
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .mark,
    .mark > * {
      animation-duration: 0.01s !important;
    }
  }
</style>
