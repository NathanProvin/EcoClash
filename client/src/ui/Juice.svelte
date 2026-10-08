<script lang="ts">
  // Game feel overlay (D-233): short-lived marks over the map, placed in screen pixels: the
  // income pulse's floating numbers, your hunters' bites and your animals' panic, raid crumbs in
  // the colour of the plants' owner, and a springy sprout with tier sparkles where you plant.
  // Each mark removes itself when its animation ends; there are never more than MAX at once.
  type Mark =
    | {
        id: number;
        kind: "income";
        x: number;
        y: number;
        text: string;
        color: string;
        scale: number;
      }
    | { id: number; kind: "won" | "lost"; x: number; y: number }
    | { id: number; kind: "crumb"; x: number; y: number; color: string }
    | { id: number; kind: "sprout"; x: number; y: number; color: string; tier: number };
  type Body<K extends Mark["kind"]> = Omit<Extract<Mark, { kind: K }>, "id" | "kind">;
  /** A mark before its id: `Omit` taken over each kind of the union. */
  type Each<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
  type Draft = Each<Mark, "id">;

  const MAX = 140;
  /** Star colours by tier (bronze, silver, gold) and how many stars each throws. */
  const STARS = [
    { color: "#d79a5a", count: 1 },
    { color: "#e4e9ef", count: 3 },
    { color: "#ffd75e", count: 6 },
  ] as const;

  let marks: Mark[] = $state([]);
  let next = 0;

  function add(m: Draft) {
    if (marks.length >= MAX) return;
    marks = [...marks, { ...m, id: next++ } as Mark];
  }

  function done(e: AnimationEvent, id: number) {
    if (e.target === e.currentTarget) marks = marks.filter((m) => m.id !== id);
  }

  /** A floating income number. */
  export function income(m: Body<"income">) {
    add({ kind: "income", ...m });
  }
  /** Your hunter's kill ("won") or your animal caught ("lost"). */
  export function kill(kind: "won" | "lost", x: number, y: number) {
    add({ kind, x, y });
  }
  /** Crumbs of a grazed plant, in its owner's colour. */
  export function crumb(x: number, y: number, color: string) {
    add({ kind: "crumb", x, y, color });
  }
  /** A planted shoot springing up, with sparkles for its card's tier (1..3). */
  export function sprout(x: number, y: number, color: string, tier: number) {
    add({ kind: "sprout", x, y, color, tier });
  }
</script>

<div class="juice" aria-hidden="true">
  {#each marks as m (m.id)}
    <div
      class="mark {m.kind}"
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
        {#each [0, 1, 2] as i (i)}
          <span class="bit" style:background={m.color} style:--dx="{(i - 1) * 7}px"></span>
        {/each}
      {:else if m.kind === "sprout"}
        <span class="shoot" style:background={m.color}></span>
        {#if m.tier > 1}
          {@const star = STARS[Math.min(m.tier, 3) - 1] ?? STARS[0]}
          {#each Array.from({ length: star.count }, (_, i) => i) as i (i)}
            <span
              class="star"
              style:color={star.color}
              style:--a="{(i * 360) / star.count}deg"
              style:--d="{14 + 4 * m.tier}px">✦</span
            >
          {/each}
        {/if}
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
    transform: translate(var(--x), var(--y));
  }
  .mark > * {
    position: absolute;
  }

  /* Income: rises and fades, a dark edge so it reads on grass. */
  .income {
    animation: rise 1.4s ease-out forwards;
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

  /* Crumbs: three bits thrown up and falling. */
  .crumb {
    animation: hold 0.6s linear forwards;
  }
  .bit {
    left: -2px;
    top: -2px;
    width: 4px;
    height: 4px;
    border-radius: 1px;
    box-shadow: 0 0 2px rgba(0, 0, 0, 0.6);
    animation: toss 0.6s ease-out forwards;
  }
  @keyframes toss {
    0% {
      translate: 0 0;
      opacity: 1;
    }
    40% {
      translate: var(--dx) -10px;
    }
    100% {
      translate: calc(var(--dx) * 1.6) 6px;
      opacity: 0;
    }
  }

  /* Sprout: a springy pop (overshoot, settle), sparkles for the higher tiers. */
  .sprout {
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
