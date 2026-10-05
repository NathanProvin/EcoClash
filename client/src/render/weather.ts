// Weather ambience (D-132): the light eases toward the weather's sky (sun, sky light, haze, a tint
// on the backdrop), rain streaks or drifting dust fill the air, and flooded cells get a water
// tile. The sky starts to turn during the alert, so the change is felt before it hits. The
// particles move on the GPU (D-151): a static buffer of seeds, positions made from `time` in
// the vertex shader, so a downpour costs no CPU work and no upload per frame.

import {
  attribute,
  float,
  fract,
  mix,
  mod,
  sin,
  cos,
  texture,
  time,
  uniform,
  vec2,
  vec3,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { CELL } from "./layout";
import { SKY, WORLD, type Sky } from "./palette";

/** Most particles drawn (at amount 1). */
const MOTES = 2400;
/** Rain: fall speed (m/s), streak length (m), the wind's slant (m per m of fall). */
const RAIN = { fall: 18, length: 2.4, slant: 0.35 } as const;
/** Dust: drift speed (m/s), mote length (m), height band above the ground (m). */
const DUST = { drift: 1.4, length: 0.4, low: 0.3, high: 7 } as const;
/** Particles start this high above the ground (m). */
const TOP = 26;
/** Seconds for the light to get most of the way to its new sky. */
const EASE_S = 3;
/** Share of the weather's look shown during its alert. */
const ALERT_SHARE = 0.35;
/** Flood tiles float this far above the highest corner of their cell (m). */
const FLOOD_LIFT = 0.06;

export class WeatherFx {
  private readonly motes: THREE.LineSegments;
  private readonly material = new THREE.LineBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
  });
  /** 1: rain, 0: dust (shader uniform). */
  private readonly rain = uniform(1);
  /** Share of MOTES drawn at full weather (the quality preset; D-151). */
  private density = 1;
  /** The sky last blended to, and for which target and share (blend once per change). */
  private to: Sky = SKY.clear as Sky;
  private blended: [Sky | null, number] = [null, -1];
  private readonly colour = new THREE.Color();
  private readonly sky: Sky = { ...SKY.clear } as Sky;
  private readonly tile: THREE.InstancedMesh;
  private target: Sky = SKY.clear as Sky;
  private share = 0;
  private flooded = "";

  constructor(
    private readonly scene: THREE.Scene,
    private readonly size: number,
    private readonly height: (x: number, z: number) => number,
    private readonly lights: { sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight },
    private readonly tint: { value: THREE.Color },
    heights: THREE.Texture,
  ) {
    // Per vertex: the mote's start x, z (m), its phase (0..1) and which end of its streak (0
    // bottom, 1 top). Fixed seeds: the same downpour every match.
    const seeds = new Float32Array(MOTES * 8);
    for (let i = 0; i < MOTES; i++) {
      const [x, z] = [(rand01(i, 1) * 2 - 1) * (size / 2), (rand01(i, 2) * 2 - 1) * (size / 2)];
      const phase = rand01(i, 3);
      seeds.set([x, z, phase, 0, x, z, phase, 1], i * 8);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MOTES * 6), 3));
    geometry.setAttribute("mote", new THREE.BufferAttribute(seeds, 4));
    geometry.setDrawRange(0, 0);
    this.material.positionNode = this.moteNode(heights);
    this.motes = new THREE.LineSegments(geometry, this.material);
    this.motes.frustumCulled = false;
    this.motes.renderOrder = 3;
    scene.add(this.motes);
    const water = new THREE.MeshStandardNodeMaterial({
      color: WORLD.shallows,
      roughness: 0.35,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
    });
    const plane = new THREE.PlaneGeometry(CELL * 1.04, CELL * 1.04).rotateX(-Math.PI / 2);
    const cells = Math.round(size / CELL) ** 2;
    this.tile = new THREE.InstancedMesh(plane, water, cells);
    this.tile.count = 0;
    this.tile.renderOrder = 2;
    scene.add(this.tile);
  }

  /** The weather now: its kind (null: clear) and phase. */
  set(kind: string | null, phase: "clear" | "alert" | "active"): void {
    this.target = (kind && SKY[kind]) || (SKY.clear as Sky);
    this.share = phase === "active" ? 1 : phase === "alert" ? ALERT_SHARE : 0;
  }

  /** Water tiles over the flooded cells (row-major indices on an `n x n` grid). */
  flood(cells: readonly number[] | undefined, n: number): void {
    const key = (cells ?? []).join(",");
    if (key === this.flooded) return;
    this.flooded = key;
    const m = new THREE.Matrix4();
    (cells ?? []).forEach((c, i) => {
      const [x, z] = [(c % n) * CELL - this.size / 2, Math.floor(c / n) * CELL - this.size / 2];
      const h = Math.max(
        this.height(x, z),
        this.height(x + CELL, z),
        this.height(x, z + CELL),
        this.height(x + CELL, z + CELL),
      );
      this.tile.setMatrixAt(i, m.makeTranslation(x + CELL / 2, h + FLOOD_LIFT, z + CELL / 2));
    });
    this.tile.count = cells?.length ?? 0;
    this.tile.instanceMatrix.needsUpdate = true;
  }

  /** The share of particles drawn (1 on High, less on lighter presets). */
  setDensity(share: number): void {
    this.density = share;
  }

  /** A mote's world position from its seed and `time`: rain falls from TOP to the ground,
   *  slanted by the wind, and starts again at the top; dust drifts across the map in a band
   *  above the ground. Both wrap around the map. */
  private moteNode(heights: THREE.Texture) {
    const size = this.size;
    const half = size / 2;
    const m = attribute("mote", "vec4");
    // Rain: one fall from TOP takes TOP / fall seconds; x wraps around the map.
    const t = fract(time.mul(RAIN.fall / TOP).add(m.z));
    const rx = mod(m.x.add(t.mul(TOP * RAIN.slant)).add(half), size).sub(half);
    const rGround = texture(heights, vec2(rx, m.y).add(half).div(size)).level(float(0)).r;
    const ry = rGround.add(float(TOP).mul(t.oneMinus())).add(m.w.mul(RAIN.length));
    const rain = vec3(rx.sub(m.w.mul(RAIN.length * RAIN.slant)), ry, m.y);
    // Dust: drifts along x, bobbing, in its height band.
    const drift = m.x.add(time.mul(DUST.drift)).add(m.w.mul(DUST.length));
    const dx = mod(drift.add(half), size).sub(half);
    const bob = sin(time.mul(0.7).add(m.z.mul(40))).mul(0.3);
    const dz = m.y.add(cos(time.mul(0.5).add(m.z.mul(60))).mul(0.4));
    const dGround = texture(heights, vec2(dx, dz).add(half).div(size)).level(float(0)).r;
    const dy = dGround.add(m.z.mul(DUST.high - DUST.low).add(DUST.low)).add(bob);
    return mix(vec3(dx, dy, dz), rain, this.rain);
  }

  /** One frame: ease the light, show the particles. */
  update(dt: number): void {
    const k = 1 - Math.exp(-dt / (EASE_S / 3));
    if (this.blended[0] !== this.target || this.blended[1] !== this.share) {
      this.to = blend(SKY.clear as Sky, this.target, this.share);
      this.blended = [this.target, this.share];
    }
    const to = this.to;
    const s = this.sky;
    s.sunI += (to.sunI - s.sunI) * k;
    s.hemi += (to.hemi - s.hemi) * k;
    s.amount += (to.amount - s.amount) * k;
    s.particles = this.target.particles;
    this.lights.sun.color.lerp(this.colour.set(to.sun), k);
    this.lights.sun.intensity = s.sunI;
    this.lights.hemi.intensity = s.hemi;
    (this.scene.fog as THREE.Fog).color.lerp(this.colour.set(to.fog), k);
    this.tint.value.lerp(this.colour.set(to.tint), k);
    this.material.color.lerp(this.colour.set(this.target.mote), k);
    this.rain.value = s.particles === "rain" ? 1 : 0;
    this.material.opacity = s.particles === "rain" ? 0.3 : 0.6;
    const live = s.particles ? Math.round(MOTES * this.density * s.amount * this.share ** 2) : 0;
    this.motes.geometry.setDrawRange(0, live * 2);
  }
}

/** A fixed random number in [0, 1) for mote `i` (a small integer hash). */
function rand01(i: number, salt: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 0x632be5ab, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** The look `share` of the way from `a` to `b` (colours as hex strings). */
function blend(a: Sky, b: Sky, share: number): Sky {
  const mixHex = (x: string, y: string) =>
    `#${new THREE.Color(x).lerp(new THREE.Color(y), share).getHexString()}`;
  return {
    sun: mixHex(a.sun, b.sun),
    sunI: a.sunI + (b.sunI - a.sunI) * share,
    hemi: a.hemi + (b.hemi - a.hemi) * share,
    fog: mixHex(a.fog, b.fog),
    tint: mixHex(a.tint, b.tint),
    particles: b.particles,
    amount: b.amount,
    mote: b.mote,
  };
}
