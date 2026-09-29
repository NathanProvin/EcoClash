<script lang="ts">
  // Match chart (D-059): one measure over time, one line per player, one axis. Legend above,
  // a direct label at each line's end, a recessive grid, and a hover crosshair with the values.
  // P2 is dashed so the players differ without colour.
  export interface Line {
    label: string;
    values: number[];
    color: string;
    dashed?: boolean;
  }

  let {
    title,
    t,
    lines,
    format,
  }: { title: string; t: number[]; lines: Line[]; format: (v: number) => string } = $props();

  const W = 520;
  const H = 190;
  const M = { left: 48, right: 84, top: 8, bottom: 22 };
  const [iw, ih] = [W - M.left - M.right, H - M.top - M.bottom];
  const clock = (s: number) =>
    `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  const tMax = $derived(Math.max(t.at(-1) ?? 0, 1));
  const vMax = $derived(
    Math.max(1e-9, ...lines.flatMap((l) => l.values)) * 1.08, // headroom above the top line
  );
  const x = (s: number) => M.left + (s / tMax) * iw;
  const y = (v: number) => M.top + ih - (v / vMax) * ih;
  const path = (values: number[]) =>
    values.map((v, i) => `${i ? "L" : "M"}${x(t[i] ?? 0).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const grid = $derived([0, 0.25, 0.5, 0.75, 1].map((f) => f * vMax));
  /** End-label heights, nudged apart so equal or close finishes never overlap. */
  const labelY = $derived.by(() => {
    const ys = lines.map((l, i) => ({ i, y: y(l.values.at(-1) ?? 0) + 4 }));
    ys.sort((a, b) => a.y - b.y);
    for (let k = 1; k < ys.length; k++) {
      const [prev, cur] = [ys[k - 1], ys[k]];
      if (prev && cur && cur.y - prev.y < 13) cur.y = prev.y + 13;
    }
    return lines.map((_, i) => ys.find((e) => e.i === i)?.y ?? 0);
  });

  let hover: number | null = $state(null); // index into t
  function move(e: PointerEvent) {
    const r = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    const s = ((e.clientX - r.left) / r.width) * tMax;
    let best = 0;
    t.forEach((v, i) => {
      if (Math.abs(v - s) < Math.abs((t[best] ?? 0) - s)) best = i;
    });
    hover = t.length ? best : null;
  }
</script>

<figure>
  <figcaption>
    <span class="label">{title}</span>
    <span class="legend">
      {#each lines as l (l.label)}
        <span class="key">
          <svg width="22" height="8" aria-hidden="true"
            ><line
              x1="1"
              y1="4"
              x2="21"
              y2="4"
              stroke={l.color}
              stroke-width="2"
              stroke-dasharray={l.dashed ? "5 3" : undefined}
            /></svg
          >
          {l.label}
        </span>
      {/each}
    </span>
  </figcaption>
  <div class="plot">
    <svg viewBox="0 0 {W} {H}" role="img" aria-label={title}>
      {#each grid as g, i (i)}
        <line class="grid" x1={M.left} x2={M.left + iw} y1={y(g)} y2={y(g)} />
        <text class="tick" x={M.left - 6} y={y(g) + 3} text-anchor="end">{format(g)}</text>
      {/each}
      {#each [0, tMax / 2, tMax] as s (s)}
        <text class="tick" x={x(s)} y={H - 6} text-anchor="middle">{clock(s)}</text>
      {/each}
      {#each lines as l, li (l.label)}
        <path
          d={path(l.values)}
          fill="none"
          stroke={l.color}
          stroke-width="2"
          stroke-linejoin="round"
          stroke-dasharray={l.dashed ? "6 4" : undefined}
        />
        {#if l.values.length}
          <text class="end" x={M.left + iw + 6} y={labelY[li]}
            >{l.label} {format(l.values.at(-1) ?? 0)}</text
          >
        {/if}
      {/each}
      {#if hover !== null}
        <line
          class="cross"
          x1={x(t[hover] ?? 0)}
          x2={x(t[hover] ?? 0)}
          y1={M.top}
          y2={M.top + ih}
        />
        {#each lines as l (l.label)}
          <circle
            cx={x(t[hover] ?? 0)}
            cy={y(l.values[hover] ?? 0)}
            r="4"
            fill={l.color}
            stroke="#18211c"
            stroke-width="2"
          />
        {/each}
      {/if}
      <rect
        x={M.left}
        y={M.top}
        width={iw}
        height={ih}
        fill="transparent"
        role="presentation"
        onpointermove={move}
        onpointerleave={() => (hover = null)}
      />
    </svg>
    {#if hover !== null}
      <div class="tip" style:left="{(x(t[hover] ?? 0) / W) * 100}%">
        <strong>{clock(t[hover] ?? 0)}</strong>
        {#each lines as l (l.label)}
          <span>{l.label}: {format(l.values[hover] ?? 0)}</span>
        {/each}
      </div>
    {/if}
  </div>
</figure>

<style>
  figure {
    margin: 0;
  }
  figcaption {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 4px;
  }
  .legend {
    display: flex;
    gap: 14px;
    font-size: 0.8em;
    color: var(--ink-soft);
  }
  .key {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .plot {
    position: relative;
  }
  svg {
    width: 100%;
    display: block;
  }
  .grid {
    stroke: var(--line);
  }
  .tick {
    fill: var(--ink-soft);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
  }
  .end {
    fill: var(--ink);
    font-size: 11px;
    font-weight: 700;
  }
  .cross {
    stroke: var(--ink-soft);
    stroke-dasharray: 2 3;
  }
  .tip {
    position: absolute;
    top: 0;
    transform: translateX(8px);
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 8px;
    border-radius: 8px;
    background: var(--panel-flat);
    box-shadow: var(--trim);
    font-size: 0.78em;
    pointer-events: none;
    white-space: nowrap;
  }
</style>
