<script lang="ts">
  // Playback: play / pause (Space), speed, scrubber.
  import type { Replay } from "../replay/replay";

  let {
    replay,
    tick = $bindable(),
    playing = $bindable(),
    speed = $bindable(),
  }: { replay: Replay; tick: number; playing: boolean; speed: number } = $props();

  const speeds = [1, 2, 4, 8, 16, 32];
  const clock = (s: number) =>
    `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  function playPause() {
    if (!playing && tick >= replay.meta.ticks - 1) tick = 0; // replay from the start
    playing = !playing;
  }
</script>

<footer class="panel timeline">
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
  <label>
    Speed
    <select bind:value={speed}>
      {#each speeds as s (s)}<option value={s}>{s}×</option>{/each}
    </select>
  </label>
</footer>

<style>
  .timeline {
    position: absolute;
    left: 12px;
    right: 12px;
    bottom: 12px;
    display: flex;
    gap: 12px;
    align-items: center;
  }
  input[type="range"] {
    flex: 1;
  }
  button {
    width: 40px;
    height: 32px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: white;
    cursor: pointer;
  }
  .clock {
    font-variant-numeric: tabular-nums;
    min-width: 96px;
  }
</style>
