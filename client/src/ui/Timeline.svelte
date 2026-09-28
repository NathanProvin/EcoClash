<script lang="ts">
  // Replay playback strip: play / pause (Space), speed, scrubber. Sits above the unit bar.
  import type { Replay } from "../replay/replay";

  let {
    replay,
    tick = $bindable(),
    playing = $bindable(),
    speed = $bindable(),
    result,
  }: {
    replay: Replay;
    tick: number;
    playing: boolean;
    speed: number;
    result: string;
  } = $props();

  const speeds = [1, 2, 4, 8, 16, 32];
  const clock = (s: number) =>
    `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  function playPause() {
    if (!playing && tick >= replay.meta.ticks - 1) tick = 0; // replay from the start
    playing = !playing;
  }
</script>

<div class="strip">
  <button onclick={playPause} aria-label={playing ? "Pause" : "Play"}>
    {playing ? "❚❚" : "▶"}
  </button>
  <span class="clock"
    >{clock(tick * replay.meta.dt)} / {clock(replay.meta.ticks * replay.meta.dt)}</span
  >
  <input
    type="range"
    min="0"
    max={replay.meta.ticks - 1}
    step="1"
    bind:value={tick}
    aria-label="Match time"
  />
  <select bind:value={speed} aria-label="Playback speed">
    {#each speeds as s (s)}<option value={s}>{s}×</option>{/each}
  </select>
  {#if result}<strong class="result" role="status">{result}</strong>{/if}
</div>

<style>
  .strip {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 132px;
    height: 34px;
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 0 16px;
    background: rgba(250, 250, 247, 0.72);
    border-top: 1px solid var(--line);
  }
  input[type="range"] {
    flex: 1;
  }
  button {
    width: 32px;
    height: 24px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: white;
    cursor: pointer;
    font-size: 0.8em;
  }
  .clock {
    font-variant-numeric: tabular-nums;
    font-size: 0.85em;
    min-width: 88px;
  }
  .result {
    font-size: 0.9em;
  }
</style>
