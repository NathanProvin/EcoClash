// Placeholder diorama over a Source (INSTRUCTIONS §6: the renderer only reads snapshots). The
// viewer holds the scene, camera and ground (tinted by territory, with solid frontier lines:
// frontier.ts, D-040, D-099), raised to the generated relief with water and rocks
// (terrain.ts, D-085); herbs are grass blades (grass.ts), shrubs and trees come from
// PlantView (plants.ts: species forms, natural colours, growth, D-067, D-072), animals from
// AnimalView (animals.ts, D-065, D-068). Light (D-086): a low warm sun with soft shadows, the
// ground tinted by slope, wetness and height, bloom and tilt-shift on High. 1 cell = CELL world
// units (4 m, D-047).

import { MapControls } from "three/addons/controls/MapControls.js";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { dof } from "three/addons/tsl/display/DepthOfFieldNode.js";
import * as THREE from "three/webgpu";
import {
  color,
  float,
  mix,
  mx_noise_float,
  normalWorld,
  pass,
  positionLocal,
  positionWorld,
  screenUV,
  smoothstep,
  texture,
  time,
  uniform,
  uv,
  vec3,
  vec4,
} from "three/tsl";
import { interpolate, type Animal, type Fields, type Source } from "../replay/replay";
import { OVERLAYS, overlayValues, paintOverlay, type OverlayId } from "../game/overlays";
import { AnimalView } from "./animals";
import { Ghost, type GhostSpec } from "./ghost";
import { SeedBurst, SEEDS } from "./seeds";
import { BAND, frontierField } from "./frontier";
import {
  groundGeometry,
  Heightfield,
  NOISE,
  noiseTexture,
  drape,
  rockPlacements,
  slabGeometry,
  stoneGeometry,
} from "./terrain";
import { makeGrass } from "./grass";
import { CELL, rand, SLAB_DEPTH, STRATA, stratumOf } from "./layout";
import {
  hexToRgb,
  OVERLAY_RAMPS,
  plantColor,
  PLAYER,
  soilColor,
  WORLD,
  type PlayerId,
} from "./palette";
import { DeadTrees, LowPolyPlants, PlantView } from "./plants";
import { QUALITY, type Quality } from "./quality";
import { WeatherFx } from "./weather";

export type Layer = "territory" | "L1" | "L2" | "L3" | "L4" | "animals";

export { CELL };
/** Share of the owner's hue in the ground of owned cells: light, the frontier line carries
 *  ownership and the plants keep their natural colours (D-067). */
const TERRITORY_TINT = 0.15;
/** A ping (alerts, D-077): rings spread from 1 to `spread` cells over `waveS`, `waves` times. */
const PING = { spread: 4, waveS: 1, waves: 3 } as const;
/** Pings float this far above the ground or water (m). */
const PING_LIFT = 0.3;
/** The drop cursor's model is at least this share of the camera distance across (readable
 *  from afar; true size up close). */
const GHOST_SIZE = 0.02;
/** Grass blends from one field frame to the next over the time between the last two frames,
 *  within these bounds (s). */
const BLEND_S = { min: 0.2, max: 2 } as const;
/** Ground tints (D-086): wet within `wet` m above the water, dry on the top `dry` share of the
 *  relief, bare rock on slopes past `rock` (1 - normal.y). */
const TINT = { wet: 1.5, dry: [0.55, 0.9], rock: [0.03, 0.1] } as const;
/** Map overlays (D-135) float this far above the ground (m). */
const OVERLAY_LIFT = 0.1;
/** The sun's shadow map is redrawn every this many frames: shadows lag one frame behind the wind,
 *  invisibly, for half the shadow-pass cost (D-090). */
const SHADOW_EVERY = 4; // D-151 (was 2): the sun barely moves
/** Share of rain and dust particles drawn below the High preset (D-151). */
const RAIN_LIGHT = 0.6;

/** Camera tilt limit (D-112): the lowest view (polar angle, rad) is `low` up to `near` metres
 *  from the target and `high` from `far` x the map size, eased in between. */
const TILT = { low: 1.2, high: 0.66, near: 8, far: 0.6 } as const; // high: the reset view's angle
/** High preset post-processing: a light bloom on highlights, and a tilt-shift blur that keeps a
 *  band around the camera's target sharp (`range`: share of the camera distance). */
const POST = { bloom: 0.12, bloomRadius: 0.4, bloomThreshold: 0.85, range: 0.45, bokeh: 1.5 };

/** Keys held by the player, read each frame for keyboard camera moves. */
export interface CameraKeys {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  rotateLeft: boolean;
  rotateRight: boolean;
}

type Covers = { species: number; cover: number }[];

export class Viewer {
  readonly backend: string;
  private readonly renderer: THREE.WebGPURenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: MapControls;
  private readonly groundData: Uint8Array;
  private readonly groundTex: THREE.DataTexture;
  private readonly frontierData: Uint8Array;
  private readonly frontierTex: THREE.DataTexture;
  private readonly frontierPrev: THREE.DataTexture; // blended into, like the grass (D-108)
  private readonly showFrontier = uniform(1);
  private readonly sun: THREE.DirectionalLight;
  private readonly weather: WeatherFx; // D-132
  /** The weather's tint on the backdrop (D-132). */
  private readonly backdropTint = uniform(new THREE.Color(1, 1, 1));
  /** High preset: the post-processing pipeline (built once, on first use; D-090), whether it is
   *  on, and the camera's distance to its target. */
  private post: THREE.RenderPipeline | null = null;
  private postOn = false;
  /** Frames drawn: the sun's shadow map is redrawn every SHADOW_EVERY frames (D-090). */
  private frames = 0;
  private readonly focus = uniform(1);
  /** The map's heights (D-085), the ground mesh (picking), the height texture (shaders). */
  private readonly field: Heightfield;
  private readonly ground: THREE.Mesh;
  /** The map overlay (D-135): one texel per cell over a lifted copy of the ground. */
  private readonly overlayData: Uint8Array;
  private readonly overlayTex: THREE.DataTexture;
  private readonly overlayMesh: THREE.Mesh;
  private overlay: OverlayId | null = null;
  private lastFields: Fields | null = null;
  private readonly heights: THREE.DataTexture;
  /** Baked tileable noise for the ground and water shaders (D-151). */
  private readonly noiseTex = noiseTexture();
  /** Seconds, for growth and blends (set once per frame). */
  private readonly now = uniform(0);
  // L1 as grass blades (grass.ts): RGB = the cell's herb colour, A = L1 cover, one texel per
  // cell; the previous field frame too, blended in by `blend`.
  private readonly floraData: Uint8Array;
  private readonly floraTex: THREE.DataTexture;
  private readonly floraPrev: THREE.DataTexture;
  // Herb shares per cell (D-150): R lichen and moss, G grasses, B wildflowers; the grass shader
  // gives each tuft one of these looks.
  private readonly mixData: Uint8Array;
  private readonly mixTex: THREE.DataTexture;
  private readonly mixPrev: THREE.DataTexture;
  private readonly blend = uniform(1);
  private blendFrom = 0;
  private blendS: number = BLEND_S.max;
  private grass: THREE.Group;
  private readonly plants: PlantView;
  private readonly deadTrees: DeadTrees; // D-127
  private readonly animals: AnimalView;
  /** Plant species indices per level (1..3); colours per player and species (sRGB bytes, and
   *  linear for instances). */
  /** Land herbs (drawn as grass), and the plant species of each model stratum (STRATA). */
  private readonly herbs: number[];
  private readonly modelled: number[][];
  private readonly plantRgb: Record<PlayerId, [number, number, number][]>;
  private readonly plantLinear: Record<PlayerId, THREE.Color[]>;
  private readonly aura: THREE.Group; // smoky ring over the selected cell
  private readonly raycaster = new THREE.Raycaster();
  private flight: { from: THREE.Vector3[]; to: THREE.Vector3[]; t: number } | undefined;
  private pings: { mesh: THREE.Mesh; start: number; r0: number; r1: number; waves: number }[] = [];
  private seeds: SeedBurst;
  private readonly ghost: Ghost;
  private ghostSpec: GhostSpec | null = null;
  private owner: Uint8Array = new Uint8Array(0); // the last field frame's owners
  private lastTime = 0;
  private lastFrame = -1;
  private lastPaint = 0;
  private showTerritory = true;
  private shown: Animal[] = [];
  private selected = new Set<number>();

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly replay: Source,
    renderer: THREE.WebGPURenderer,
    private quality: Quality,
  ) {
    const n = replay.meta.n;
    const size = n * CELL;
    this.renderer = renderer;
    this.backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend
      ? "WebGPU"
      : "WebGL2";

    const back = texture(backdrop(), screenUV.flipY());
    this.scene.backgroundNode = vec4(back.rgb.mul(this.backdropTint), 1);
    this.seeds = new SeedBurst(this.scene);
    this.scene.fog = new THREE.Fog(WORLD.horizon, size * 2.2, size * 5); // haze beyond the slab
    const hemi = new THREE.HemisphereLight(WORLD.sky, WORLD.groundLight, 1.3);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(WORLD.sun, 2.6); // one low key light (§7.1)
    sun.position.set(-size, size * 0.6, -size * 0.4);
    // Soft shadows over the whole slab (the light looks at the origin).
    const reach = size * 0.75;
    Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach });
    Object.assign(sun.shadow.camera, { near: size * 0.3, far: size * 2.6 });
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.05;
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.autoUpdate = false; // redrawn every SHADOW_EVERY frames, see render()
    this.sun = sun;
    this.scene.add(sun);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, size * 6);
    this.controls = new MapControls(this.camera, canvas);
    // RTS mouse: left = box select (handled by the UI), middle = rotate, right = pan (orders
    // take the right button in M3), wheel = zoom toward the cursor.
    this.controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
    this.controls.zoomToCursor = true;
    this.controls.enableDamping = true;
    this.controls.minPolarAngle = 0.15; // limited tilt (INSTRUCTIONS §2.4), down to a low
    this.controls.maxPolarAngle = 1.2; // diorama view that shows the trees' height (D-067)
    this.controls.minDistance = 2; // close enough to see single plant models
    this.controls.maxDistance = size * 2.2;
    this.resetView();

    // Ground: one texel per cell, linearly filtered so cells never read as pixels (§5.1), with
    // a three-scale noise (patches, clods, grit) and darker humus mottling (D-054, D-067).
    this.groundData = new Uint8Array(n * n * 4);
    this.groundTex = new THREE.DataTexture(this.groundData, n, n);
    this.groundTex.magFilter = THREE.LinearFilter;
    this.groundTex.colorSpace = THREE.SRGBColorSpace;
    const groundMat = new THREE.MeshStandardNodeMaterial({ roughness: 1 });
    // Baked noise (D-151): one texture fetch per scale instead of a Perlin noise per pixel.
    const patches = this.noise(0.16, "r"); // broad damp / dry patches
    const grain = float(1)
      .add(patches.mul(0.1))
      .add(this.noise(0.8, "g").mul(0.08))
      .add(this.noise(4.2, "b").mul(0.07)); // grit
    const earth = texture(this.groundTex, uv()).rgb;
    const humus = earth.mul(vec3(0.74, 0.68, 0.62)); // darker, warmer patches
    const mottle = smoothstep(0.05, 0.8, patches).mul(0.6);
    this.field = new Heightfield(n, replay.terrain);
    const ground = (x: number, z: number) => this.field.at(x, z);
    this.heights = this.field.texture();
    const lights = { sun, hemi };
    this.weather = new WeatherFx(this.scene, size, ground, lights, this.backdropTint, this.heights);
    // Front lines (D-108), drawn in the ground itself so they follow the relief (D-085): each
    // player's line is the band just inside its territory where its blurred ownership crosses
    // 0.5 (frontier.ts), widened by its push, gliding from the last field frame to this one.
    const field = (data: Uint8Array) => {
      const t = new THREE.DataTexture(data, n, n);
      t.magFilter = THREE.LinearFilter;
      t.minFilter = THREE.LinearFilter;
      return t;
    };
    this.frontierData = new Uint8Array(n * n * 4);
    this.frontierTex = field(this.frontierData);
    this.frontierPrev = field(new Uint8Array(n * n * 4));
    const front = mix(
      texture(this.frontierPrev, uv()),
      texture(this.frontierTex, uv()),
      this.blend,
    );
    const band = (own: THREE.Node<"float">, push: THREE.Node<"float">) => {
      const top = push.mul(BAND.max - BAND.min).add(0.5 + BAND.min);
      const aa = 0.012;
      return smoothstep(0.5, 0.5 + aa, own).mul(smoothstep(top, top.add(aa), own).oneMinus());
    };
    const [l1, l2] = [band(front.r, front.b), band(front.g, front.a)];
    const lineRgb = mix(color(PLAYER[2].base), color(PLAYER[1].base), l1.div(l1.add(l2).add(1e-4)));
    const lineA = l1.max(l2).mul(this.showFrontier);
    const soilColour = mix(earth, humus, mottle).mul(grain);
    groundMat.colorNode = mix(this.terrainTint(soilColour, grain), lineRgb, lineA);
    groundMat.emissiveNode = lineRgb.mul(lineA.mul(0.35));
    this.ground = new THREE.Mesh(groundGeometry(this.field), groundMat);
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    this.overlayData = new Uint8Array(n * n * 4);
    this.overlayTex = new THREE.DataTexture(this.overlayData, n, n);
    this.overlayTex.magFilter = THREE.LinearFilter;
    this.overlayTex.minFilter = THREE.LinearFilter; // smooth from afar too: cells never read as pixels
    this.overlayTex.colorSpace = THREE.SRGBColorSpace;
    // Drawn over the scene (no depth test), like a map mode: the canopy would hide it otherwise.
    const overlayMat = new THREE.MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    const heat = texture(this.overlayTex, uv());
    overlayMat.colorNode = heat.rgb;
    overlayMat.opacityNode = heat.a;
    this.overlayMesh = new THREE.Mesh(this.ground.geometry, overlayMat);
    this.overlayMesh.position.y = OVERLAY_LIFT;
    this.overlayMesh.renderOrder = 20;
    this.overlayMesh.visible = false;
    this.scene.add(this.overlayMesh);

    // The map as a diorama slab: an earth cross-section on its sides, topsoil to bedrock.
    const slabMat = new THREE.MeshStandardNodeMaterial({ roughness: 1 });
    const depth = positionLocal.y.negate().div(SLAB_DEPTH); // 0 at the top, 1 at the bottom
    const soil = mix(color(WORLD.earthTop), color(WORLD.earthSub), smoothstep(0.05, 0.35, depth));
    const layers = vec3(mix(soil, color(WORLD.earthStone), smoothstep(0.65, 0.85, depth)));
    slabMat.colorNode = layers.mul(float(1).add(mx_noise_float(positionWorld.mul(1.5)).mul(0.08)));
    // Walls from the ground's edge down; the bottom stays closed by the dark below.
    const bottom = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size).rotateX(Math.PI / 2).translate(0, -SLAB_DEPTH, 0),
      slabMat,
    );
    this.scene.add(new THREE.Mesh(slabGeometry(this.field, SLAB_DEPTH), slabMat), bottom);

    this.addWater(size);
    this.addRocks();

    const floraTexture = (data: Uint8Array) => {
      const t = new THREE.DataTexture(data, n, n);
      t.magFilter = THREE.LinearFilter;
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    this.floraData = new Uint8Array(n * n * 4);
    this.floraTex = floraTexture(this.floraData);
    this.floraPrev = floraTexture(new Uint8Array(n * n * 4));
    const mixTexture = (data: Uint8Array) => {
      const t = new THREE.DataTexture(data, n, n);
      t.magFilter = THREE.LinearFilter;
      return t;
    };
    this.mixData = new Uint8Array(n * n * 4);
    this.mixTex = mixTexture(this.mixData);
    this.mixPrev = mixTexture(new Uint8Array(n * n * 4));
    this.grass = this.makeGrass();
    this.scene.add(this.grass);

    const { names, level } = replay.meta.flora;
    // Aquatic herbs float as pads (D-087).
    const flora = replay.meta.species.filter((s) => s.kind === "flora");
    const stratum = (i: number) => stratumOf(level[i] ?? 1, flora[i]?.family === "W");
    this.herbs = names.flatMap((_, i) => (stratum(i) === null ? [i] : []));
    this.modelled = STRATA.map((_, s) => names.flatMap((_, i) => (stratum(i) === s ? [i] : [])));
    const colours = (p: PlayerId) => names.map((name, i) => plantColor(name, level[i] ?? 1, p));
    this.plantRgb = { 1: colours(1), 2: colours(2) };
    const linear = (p: PlayerId) =>
      this.plantRgb[p].map(([r, g, b]) =>
        new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace),
      );
    this.plantLinear = { 1: linear(1), 2: linear(2) };
    this.plants = new PlantView(this.scene, n, new LowPolyPlants(), this.now, sun.position);
    this.deadTrees = new DeadTrees(this.scene, n, this.now);
    this.animals = new AnimalView(this.scene, replay.meta, replay.maxAnimals());

    this.aura = makeAura();
    this.scene.add(this.aura);
    this.ghost = new Ghost(this.scene, this.surface);
    this.applyLight();
  }

  static async create(
    canvas: HTMLCanvasElement,
    replay: Source,
    quality: Quality,
  ): Promise<Viewer> {
    // WebGPU when available, WebGL2 otherwise (INSTRUCTIONS §3.1).
    const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
    renderer.shadowMap.enabled = true; // the presets switch the sun's shadow on and off
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Neutral tone mapping: hues stay, only highlights roll off instead of clipping.
    renderer.toneMapping = THREE.NeutralToneMapping;
    await renderer.init();
    return new Viewer(canvas, replay, renderer, quality);
  }

  private makeGrass(): THREE.Group {
    const perCell = QUALITY[this.quality].grass;
    const n = this.replay.meta.n;
    const mix = { now: this.mixTex, prev: this.mixPrev };
    const grass = makeGrass(
      n,
      perCell,
      this.floraTex,
      this.floraPrev,
      this.blend,
      this.heights,
      mix,
    );
    return grass;
  }

  resetView(): void {
    const size = this.replay.meta.n * CELL;
    // The whole slab in view, its near side above the bottom HUD: aim a little past the centre.
    this.controls.target.set(0, 0, size * 0.37);
    this.camera.position.set(0, size * 1.4, size * 1.45);
    this.controls.update();
  }

  resize(): void {
    const { clientWidth: w, clientHeight: h } = this.canvas;
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, QUALITY[this.quality].pixelRatio),
    );
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
  }

  /** The preset's light: the sun's shadow map (0: none) and the post-processing pipeline.
   *  Shadows are set once, before the first frame (D-133): the direct render and the High pass
   *  share the sun's shadow node but each caches its own bindings, so a live resize or toggle
   *  leaves one of them on a destroyed map (every submit fails, the canvas freezes) or a disposed
   *  node (crash). A new shadow setting applies from the next match. */
  private applyLight(): void {
    const { shadow, post } = QUALITY[this.quality];
    if (this.frames === 0) {
      this.sun.castShadow = shadow > 0;
      if (shadow > 0) this.sun.shadow.mapSize.set(shadow, shadow);
      this.sun.shadow.needsUpdate = true;
    }
    this.postOn = post;
    if (post) this.post ??= this.makePost();
    this.weather.setDensity(this.quality === "high" ? 1 : RAIN_LIGHT);
  }

  private makePost(): THREE.RenderPipeline {
    const scene = pass(this.scene, this.camera);
    const colour = scene.getTextureNode("output");
    const sharp = this.focus.mul(POST.range);
    const tilted = dof(colour, scene.getViewZNode(), this.focus, sharp, POST.bokeh);
    const glow = bloom(colour, POST.bloom, POST.bloomRadius, POST.bloomThreshold);
    // DepthOfFieldNode is typed without the node operators.
    return new THREE.RenderPipeline(
      this.renderer,
      glow.add(tilted as unknown as THREE.Node<"color">),
    );
  }

  /** Switch the quality preset: rebuild the grass at its density, apply its resolution. */
  setQuality(q: Quality): void {
    this.quality = q;
    this.applyLight();
    const visible = this.grass.visible;
    this.scene.remove(this.grass);
    this.grass.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    });
    this.grass = this.makeGrass();
    this.grass.visible = visible;
    this.scene.add(this.grass);
    this.resize();
  }

  setVisible(layer: Layer, on: boolean): void {
    if (layer === "territory") {
      this.showTerritory = on;
      this.showFrontier.value = on ? 1 : 0;
      this.lastFrame = -1; // repaint the ground
    } else if (layer === "animals") {
      this.animals.setVisible(on);
    } else if (layer === "L1") {
      this.grass.visible = on;
      for (const m of this.plants.meshesOf("pad")) m.visible = on;
    } else {
      const models = { L2: "low", L3: "shrub", L4: "tree" } as const;
      for (const m of this.plants.meshesOf(models[layer])) m.visible = on;
    }
  }

  setSelection(ids: Iterable<number>): void {
    this.selected = new Set(ids);
  }

  /** The grid cell under a screen point (CSS pixels of the canvas), or null off the map. */
  pickCell(x: number, y: number): { row: number; col: number } | null {
    const { clientWidth: w, clientHeight: h } = this.canvas;
    this.raycaster.setFromCamera(new THREE.Vector2((x / w) * 2 - 1, 1 - (y / h) * 2), this.camera);
    const hit = this.raycaster.intersectObject(this.ground, false)[0]?.point;
    const n = this.replay.meta.n;
    if (!hit) return null;
    const col = Math.floor(hit.x / CELL + n / 2);
    const row = Math.floor(hit.z / CELL + n / 2);
    return row >= 0 && row < n && col >= 0 && col < n ? { row, col } : null;
  }

  /** Show the aura over a cell, or hide it (null). */
  setCell(cell: { row: number; col: number } | null): void {
    this.aura.visible = cell !== null;
    if (cell) this.aura.position.copy(this.centre(cell));
  }

  /** The ground or, over water, the water surface at a world point (m): where rings lie (D-097). */
  private readonly surface = (x: number, z: number): number =>
    Math.max(this.field.at(x, z), this.field.water ?? -Infinity);

  /** A cell's centre on the ground (world metres, D-085). */
  centre(cell: { row: number; col: number }): THREE.Vector3 {
    const at = cellCenter(cell, this.replay.meta.n);
    return at.setY(this.field.at(at.x, at.z));
  }

  /** Baked noise (D-151) at `frequency` lattice cells per metre, one channel, centred on 0
   *  (about -1..1 like `mx_noise_float`), optionally drifting by `shift` (texture units). */
  private noise(
    frequency: number,
    channel: "r" | "g" | "b",
    shift?: THREE.Node<"float">,
  ): THREE.Node<"float"> {
    const uvw = positionWorld.xz.mul(frequency / NOISE.period);
    const at = shift ? uvw.add(shift) : uvw;
    return texture(this.noiseTex, at)[channel].mul(2).sub(1);
  }

  /** The soil tinted by the terrain (D-086): darker and greener near water, paler on the high
   *  ground, bare rock colour on steep slopes. */
  private terrainTint(soil: THREE.Node<"vec3">, grain: THREE.Node<"float">): THREE.Node<"vec3"> {
    const y = positionWorld.y;
    let out = soil;
    const water = this.field.water;
    if (water !== null) {
      const wet = smoothstep(water, water + TINT.wet, y).oneMinus();
      out = mix(out, out.mul(vec3(0.62, 0.7, 0.56)), wet);
    }
    const relief = this.replay.terrain?.reliefM ?? 0;
    if (relief > 0) {
      const dry = smoothstep(relief * TINT.dry[0], relief * TINT.dry[1], y);
      out = mix(out, out.mul(vec3(1.12, 1.08, 0.94)), dry.mul(0.8));
    }
    const rocky = smoothstep(TINT.rock[0], TINT.rock[1], normalWorld.y.oneMinus());
    return mix(out, color(WORLD.rock).mul(grain), rocky.mul(0.7));
  }

  /** The water surface over the valleys (D-085): transparent, tinted by depth (read from the height
   *  texture), fading at the shore, with a slow shimmer. Only when the map has water. */
  private addWater(size: number): void {
    const level = this.field.water;
    if (level === null) return;
    const material = new THREE.MeshStandardNodeMaterial({
      roughness: 0.4, // a soft sheen, no hard sun glare (D-087)
      metalness: 0.05,
      transparent: true,
      depthWrite: false,
    });
    const at = positionWorld.xz.add(size / 2).div(size); // world x/z -> height texel
    const bed = texture(this.heights, at).r;
    const depth = float(level).sub(bed);
    const shimmer = float(1).add(this.noise(0.35, "r", time.mul(0.04)).mul(0.06));
    material.colorNode = mix(
      color(WORLD.shallows),
      color(WORLD.deepWater),
      smoothstep(0.2, 2.2, depth),
    ).mul(shimmer);
    material.opacityNode = smoothstep(0.02, 0.35, depth).mul(0.82);
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2),
      material,
    );
    water.position.y = level;
    water.renderOrder = 2;
    this.scene.add(water);
  }

  /** Rock outcrops: a few rough stones per rock cell, three stone shapes, flat shaded. */
  private addRocks(): void {
    const stones = rockPlacements(this.field);
    if (!stones.length) return;
    const tint = new THREE.Color(WORLD.rock);
    const shapes = [0, 1, 2].map((v) => {
      const list = stones.filter((_, i) => i % 3 === v);
      const mesh = new THREE.InstancedMesh(
        stoneGeometry(v),
        new THREE.MeshStandardNodeMaterial({ roughness: 0.95, flatShading: true }),
        Math.max(list.length, 1),
      );
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      list.forEach((r, i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r.angle);
        m.compose(new THREE.Vector3(r.x, r.y, r.z), q, new THREE.Vector3(r.s, r.sy, r.s));
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, tint.clone().multiplyScalar(r.shade));
      });
      mesh.count = list.length;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      return mesh;
    });
    this.scene.add(...shapes);
  }

  /** The drop cursor (D-079): the armed species' model under the cursor, or none. */
  setGhost(spec: GhostSpec | null): void {
    this.ghostSpec = spec;
    this.ghost.set(spec);
  }

  /** Move the drop cursor to a screen point (null: off the canvas). Returns the cell and whether
   *  it lies off the armed player's land, or null off the map. */
  aimGhost(
    x: number | null,
    y = 0,
  ): { cell: { row: number; col: number }; offLand: boolean } | null {
    const spec = this.ghostSpec;
    const cell = spec && x !== null ? this.pickCell(x, y) : null;
    if (!spec || !cell) {
      this.ghost.aim(null, 0, "");
      return null;
    }
    const n = this.replay.meta.n;
    const offLand = this.owner[cell.row * n + cell.col] !== spec.player;
    const animal = spec.kind === "fauna";
    const disaster = spec.kind === "catastrophe"; // D-129: the disc it will hit
    // Plants: the disc planted. Animals: the landing spot at home, the drop area elsewhere.
    const cells = animal ? (offLand ? spec.radius : 0.5) : spec.radius + 0.5;
    const color = disaster || (animal && offLand) ? WORLD.alert : PLAYER[spec.player].base;
    const at = this.centre(cell);
    const least = this.camera.position.distanceTo(at) * GHOST_SIZE;
    this.ghost.aim(at, cells * CELL, color, least);
    return { cell, offLand };
  }

  /** Ping a cell: rings of `hex` spread and fade there for a few seconds (D-077). */
  /** An expanding ring at a cell: by default `PING.waves` alert waves from one cell to
   *  `PING.spread` cells; a ripple to `radius` metres, `waves` times, after `delay` seconds. */
  ping(
    cell: { row: number; col: number },
    hex: string,
    o: { radius?: number; waves?: number; delay?: number } = {},
  ): void {
    const material = new THREE.MeshBasicNodeMaterial({
      color: new THREE.Color(hex),
      transparent: true,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.86, 1, 48).rotateX(-Math.PI / 2),
      material,
    );
    const at = this.centre(cell);
    mesh.position.copy(at).setY(Math.max(at.y, this.field.water ?? -Infinity));
    mesh.renderOrder = 11;
    mesh.frustumCulled = false; // draped every frame
    this.scene.add(mesh);
    mesh.visible = !o.delay;
    const r1 = o.radius ?? CELL * PING.spread;
    this.pings.push({
      mesh,
      start: performance.now() / 1000 + (o.delay ?? 0), // the frame loop's clock
      r0: o.radius ? r1 * 0.2 : CELL,
      r1,
      waves: o.waves ?? PING.waves,
    });
  }

  /** A catastrophe's animation (D-129) on its disc (`radius` cells) for `durationS` seconds, in
   *  its tone: beetles swarm in brown puffs, a storm rolls in grey rings and blows leaves, a
   *  spill spreads a sickly ring and bubbles. Small, nothing fancy. */
  catastropheFx(
    act: string,
    cell: { row: number; col: number },
    radius: number,
    durationS: number,
    tone: string,
  ): void {
    const at = this.centre(cell);
    const r = (radius + 0.5) * CELL;
    const now = performance.now() / 1000;
    const color = new THREE.Color(tone);
    const puffs = Math.max(2, Math.round(durationS / 1.2));
    if (act === "storm") {
      this.ping(cell, tone, { radius: r, waves: 2 });
      this.ping(cell, "#5d666d", { radius: r * 0.7, waves: 2, delay: 0.5 });
      const leaf = new THREE.Color("#6f8f3c");
      for (let i = 0; i < puffs; i++) this.seeds.add(at.x, at.z, r, leaf, now + i, this.surface);
    } else if (act === "spill") {
      this.ping(cell, tone, { radius: r, waves: 3 });
      for (let i = 0; i < 3; i++) this.seeds.add(at.x, at.z, r, color, now + i * 0.4, this.surface);
    } else {
      this.ping(cell, tone, { radius: r, waves: 2 });
      const dark = new THREE.Color("#3b2a1c");
      for (let i = 0; i < puffs; i++)
        this.seeds.add(at.x, at.z, r * 0.8, dark, now + (i * durationS) / puffs, this.surface);
    }
  }

  /** Planting feedback (D-121): seeds arc out from the clicked cell onto the planting area
   *  (`radius` cells), then a ripple in the plant's colour spreads to its edge. */
  plantFeedback(
    cell: { row: number; col: number },
    radius: number,
    rgb: [number, number, number],
  ): void {
    const color = new THREE.Color().setRGB(
      rgb[0] / 255,
      rgb[1] / 255,
      rgb[2] / 255,
      THREE.SRGBColorSpace,
    );
    const at = this.centre(cell);
    const r = (radius + 0.5) * CELL;
    this.seeds.add(at.x, at.z, r, color, performance.now() / 1000, this.surface);
    this.ping(cell, `#${color.getHexString(THREE.SRGBColorSpace)}`, {
      radius: r,
      waves: 1,
      delay: SEEDS.s * 0.8,
    });
  }

  /** Fly the camera over a cell, keeping the current height and angle. */
  lookAt(cell: { row: number; col: number }): void {
    const target = this.centre(cell);
    const offset = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
    this.flight = {
      from: [this.camera.position.clone(), this.controls.target.clone()],
      to: [target.clone().add(offset), target],
      t: 0,
    };
  }

  /** Where a cell's centre is on screen (CSS pixels of the canvas), and whether it is in view. */
  screenPoint(cell: { row: number; col: number }): { x: number; y: number; inView: boolean } {
    const v = this.centre(cell).project(this.camera);
    const { clientWidth: w, clientHeight: h } = this.canvas;
    const behind = v.z > 1;
    const [x, y] = [((v.x + 1) / 2) * w, ((1 - v.y) / 2) * h];
    const inView = !behind && x >= 0 && x <= w && y >= 0 && y <= h;
    // Behind the camera the projection mirrors: flip it so arrows point the right way.
    return behind ? { x: w - x, y: h - y, inView } : { x, y, inView };
  }

  /** Fly the camera down to a cell until single plant models fill the view. */
  zoomToCell(cell: { row: number; col: number }): void {
    const target = this.centre(cell);
    const dir = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
    dir.y = 0;
    dir.normalize();
    const eye = target
      .clone()
      .addScaledVector(dir, 3.2)
      .setY(target.y + 2.6);
    this.flight = {
      from: [this.camera.position.clone(), this.controls.target.clone()],
      to: [eye, target],
      t: 0,
    };
  }

  /** Keyboard camera: pan along the ground in the view direction, rotate around the target. */
  moveCamera(keys: CameraKeys, seconds: number): void {
    const dist = this.camera.position.distanceTo(this.controls.target);
    const step = dist * 0.9 * seconds;
    const forward = new THREE.Vector3().subVectors(this.controls.target, this.camera.position);
    forward.y = 0;
    forward.normalize();
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const move = new THREE.Vector3()
      .addScaledVector(forward, (keys.forward ? 1 : 0) - (keys.back ? 1 : 0))
      .addScaledVector(right, (keys.right ? 1 : 0) - (keys.left ? 1 : 0));
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(step);
      this.camera.position.add(move);
      this.controls.target.add(move);
    }
    const turn = ((keys.rotateLeft ? 1 : 0) - (keys.rotateRight ? 1 : 0)) * 1.6 * seconds;
    if (turn) {
      const offset = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), turn);
      this.camera.position.copy(this.controls.target).add(offset);
    }
  }

  /** Show one map overlay (D-135), or none. */
  setOverlay(id: OverlayId | null): void {
    this.overlay = id;
    this.overlayMesh.visible = id !== null;
    if (this.lastFields) this.paintOverlay(this.lastFields);
  }

  private paintOverlay(fields: Fields): void {
    const o = OVERLAYS.find((x) => x.id === this.overlay);
    if (!o) return;
    const n = this.replay.meta.n;
    const values = overlayValues(o.id, fields, this.shown, n);
    // Texture row 0 is the near edge (+z); grid row 0 the far edge: flip rows, as the ground.
    const flipped = new Float32Array(n * n);
    for (let k = 0; k < n * n; k++)
      flipped[(n - 1 - Math.floor(k / n)) * n + (k % n)] = values[k] ?? 0;
    paintOverlay(flipped, OVERLAY_RAMPS[o.ramp], this.overlayData);
    this.overlayTex.needsUpdate = true;
  }

  /** The weather now (D-132): its kind (null: clear) and phase, for the light and particles. */
  setWeather(kind: string | null, phase: "clear" | "alert" | "active"): void {
    this.weather.set(kind, phase);
  }

  /** Draw the replay at a fractional tick. */
  render(tick: number): void {
    const now = performance.now() / 1000;
    const dt = Math.min(now - (this.lastTime || now), 0.1);
    this.lastTime = now;
    this.now.value = now;
    const fields = this.replay.fields(tick);
    if (fields.frame !== this.lastFrame) {
      // Moving forward blends the grass in; the first frame or a scrub back shows at once.
      const step = this.lastFrame >= 0 && fields.frame > this.lastFrame;
      this.lastFrame = fields.frame;
      this.paintFields(fields, now, step);
    }
    this.blend.value = Math.min(1, (now - this.blendFrom) / this.blendS);
    this.plants.frame(now);
    this.deadTrees.frame(now);
    this.weather.update(dt);
    const t0 = Math.floor(tick);
    this.shown = interpolate(this.replay.animals(t0), this.replay.animals(t0 + 1), tick - t0);
    const dropped = this.replay.droppedAt?.bind(this.replay);
    const ms = performance.now();
    const h = (x: number, z: number) => this.field.at(x, z);
    const { n } = this.replay.meta;
    const eye = this.camera.position;
    this.animals.update(this.shown, this.selected, tick, n, ms, dropped, h, this.field.water, eye);
    animateAura(this.aura, now, this.surface);
    this.animatePings(now);
    this.seeds.update(now, this.camera.position.distanceTo(this.controls.target));
    if (this.flight) {
      const f = this.flight;
      f.t = Math.min(f.t + dt / 0.8, 1);
      const e = 1 - (1 - f.t) ** 3; // ease out
      const [p0, t0] = f.from as [THREE.Vector3, THREE.Vector3];
      const [p1, t1] = f.to as [THREE.Vector3, THREE.Vector3];
      this.camera.position.lerpVectors(p0, p1, e);
      this.controls.target.lerpVectors(t0, t1, e);
      if (f.t >= 1) this.flight = undefined;
    }
    // The lowest tilt rises with distance (D-112): close up, a low view under the canopy; zooming
    // out lifts the camera back toward the overview angle.
    const dist = this.camera.position.distanceTo(this.controls.target);
    const far = THREE.MathUtils.smoothstep(dist, TILT.near, this.replay.meta.n * CELL * TILT.far);
    this.controls.maxPolarAngle = THREE.MathUtils.lerp(TILT.low, TILT.high, far);
    this.controls.update();
    this.sun.shadow.needsUpdate = this.frames++ % SHADOW_EVERY === 0;
    if (this.post && this.postOn) {
      this.focus.value = this.camera.position.distanceTo(this.controls.target);
      this.post.render();
    } else {
      void this.renderer.render(this.scene, this.camera);
    }
  }

  /** Ids of the player's animals inside a screen rectangle (CSS pixels of the canvas). A click
   *  (tiny rectangle) picks the single nearest animal within 14 px. */
  pick(x0: number, y0: number, x1: number, y1: number, player: number): number[] {
    const [left, right] = [Math.min(x0, x1), Math.max(x0, x1)];
    const [top, bottom] = [Math.min(y0, y1), Math.max(y0, y1)];
    const click = right - left < 4 && bottom - top < 4;
    const { clientWidth: w, clientHeight: h } = this.canvas;
    const v = new THREE.Vector3();
    let best: { id: number; d: number } | undefined;
    const hits: number[] = [];
    for (const a of this.animals.drawn) {
      if (a.owner !== player) continue;
      v.set(a.x, a.y, a.z).project(this.camera);
      if (v.z > 1) continue; // behind the camera
      const [sx, sy] = [((v.x + 1) / 2) * w, ((1 - v.y) / 2) * h];
      if (click) {
        const d = Math.hypot(sx - x0, sy - y0);
        if (d < 14 && (!best || d < best.d)) best = { id: a.id, d };
      } else if (sx >= left && sx <= right && sy >= top && sy <= bottom) {
        hits.push(a.id);
      }
    }
    return click ? (best ? [best.id] : []) : hits;
  }

  /** The animals currently drawn (interpolated), for the UI. */
  visibleAnimals(): readonly Animal[] {
    return this.shown;
  }

  private paintFields(fields: Fields, now: number, step: boolean): void {
    const { owner, soil: soilDev, species } = fields;
    this.owner = owner;
    this.lastFields = fields;
    if (this.overlay) this.paintOverlay(fields);
    const n = this.replay.meta.n;
    const tint = { 1: hexToRgb(PLAYER[1].base), 2: hexToRgb(PLAYER[2].base) };
    const herbs = this.herbs;
    const present = (list: number[], c: number): Covers =>
      list.flatMap((i) => {
        const v = species[i]?.[c] ?? 0;
        return v ? [{ species: i, cover: v / 255 }] : [];
      });
    // Grass: the frame shown so far becomes the one to blend from.
    if (step) (this.floraPrev.image.data as Uint8Array).set(this.floraData);
    if (step) (this.mixPrev.image.data as Uint8Array).set(this.mixData);
    if (step) (this.frontierPrev.image.data as Uint8Array).set(this.frontierData);
    const names = this.replay.meta.flora.names;
    const look = (i: number) =>
      names[i] === "lichen_and_moss" ? 0 : names[i] === "wildflowers" ? 2 : 1;
    for (let c = 0; c < n * n; c++) {
      const soil = soilColor(soilDev[c] ?? 0);
      const o = owner[c] ?? 0;
      const k = o && this.showTerritory ? TERRITORY_TINT : 0;
      const t = o === 1 || o === 2 ? tint[o] : soil;
      // Texture row 0 is the plane's near edge (+z); grid row 0 is the far edge (-z): flip rows.
      const texel = ((n - 1 - Math.floor(c / n)) * n + (c % n)) * 4;
      for (let j = 0; j < 3; j++) {
        this.groundData[texel + j] = Math.round((soil[j] ?? 0) * (1 - k) + (t[j] ?? 0) * k);
      }
      this.groundData[texel + 3] = 255;
      if (o !== 1 && o !== 2) {
        this.floraData.fill(0, c * 4, c * 4 + 4);
        this.mixData.fill(0, c * 4, c * 4 + 4);
        continue;
      }
      // Grass texel (rows not flipped: the grass shader maps world z to rows itself): the
      // cover-weighted colour of the cell's herbs.
      const rgb = [0, 0, 0];
      const shares = [0, 0, 0];
      let weight = 0;
      for (const h of present(herbs, c)) {
        const col = this.plantRgb[o][h.species] ?? [0, 0, 0];
        for (let j = 0; j < 3; j++) rgb[j] = (rgb[j] ?? 0) + (col[j] ?? 0) * h.cover;
        const k = look(h.species);
        shares[k] = (shares[k] ?? 0) + h.cover;
        weight += h.cover;
      }
      const w = weight || 1;
      const [lichen = 0, grass = 0, flowers = 0] = shares.map((v) => Math.round((v / w) * 255));
      this.mixData.set([lichen, grass, flowers, 255], c * 4);
      const alpha = Math.min(255, Math.round(weight * 255)); // land herbs' cover
      this.floraData.set([(rgb[0] ?? 0) / w, (rgb[1] ?? 0) / w, (rgb[2] ?? 0) / w, alpha], c * 4);
    }
    frontierField(owner, n, this.frontierData, fields.pressure);
    if (!step) (this.floraPrev.image.data as Uint8Array).set(this.floraData); // no blend
    if (!step) (this.mixPrev.image.data as Uint8Array).set(this.mixData);
    if (!step) (this.frontierPrev.image.data as Uint8Array).set(this.frontierData);
    const since = now - this.lastPaint;
    this.blendS = Math.min(BLEND_S.max, Math.max(BLEND_S.min, since));
    this.blendFrom = now;
    this.lastPaint = now;
    this.deadTrees.update(fields.deadwood, n, now, (x, z) => this.field.at(x, z));
    this.weather.flood(fields.flood, n);
    this.plants.update(
      (c) => this.modelled.map((list) => present(list, c)),
      owner,
      this.replay.meta.flora.names,
      this.plantLinear,
      now,
      (x, z) => this.field.at(x, z),
      this.field.water,
      fields.deadwood,
    );
    this.floraTex.needsUpdate = true;
    this.floraPrev.needsUpdate = true;
    this.mixTex.needsUpdate = true;
    this.mixPrev.needsUpdate = true;
    this.groundTex.needsUpdate = true;
    this.frontierTex.needsUpdate = true;
    this.frontierPrev.needsUpdate = true;
  }

  private animatePings(now: number): void {
    this.pings = this.pings.filter(({ mesh, start, r0, r1, waves }) => {
      const age = (now - start) / PING.waveS;
      mesh.visible = age >= 0;
      if (age < 0) return true; // not started yet
      if (age >= waves) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        return false;
      }
      const k = age % 1; // this wave's progress
      const r = r0 + (r1 - r0) * k;
      mesh.scale.set(r, 1, r);
      drape(mesh, this.surface, PING_LIFT);
      (mesh.material as THREE.MeshBasicNodeMaterial).opacity = 1 - k;
      return true;
    });
  }

  dispose(): void {
    this.controls.dispose();
    this.renderer.dispose();
  }
}

function cellCenter(cell: { row: number; col: number }, n: number): THREE.Vector3 {
  return new THREE.Vector3((cell.col - n / 2 + 0.5) * CELL, 0, (cell.row - n / 2 + 0.5) * CELL);
}

/** The backdrop (D-110): a calm, blurred mix of nature tones, drawn once on a small canvas. Blob
 *  places come from `rand`, so it is the same in every match. */
function backdrop(): THREE.CanvasTexture {
  const S = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = WORLD.backdropBase;
    ctx.fillRect(0, 0, S, S);
    ctx.filter = "blur(28px)";
    WORLD.backdrop.forEach((tone, i) => {
      for (let k = 0; k < 3; k++) {
        const j = i * 3 + k;
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = tone;
        ctx.beginPath();
        ctx.arc(rand(j, 9001) * S, rand(j, 9002) * S, S * (0.12 + 0.18 * rand(j, 9003)), 0, 7);
        ctx.fill();
      }
    });
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A foggy, smoky light-grey ring: three soft layers stacked through the plant height, each a
 *  radial ring with smoke puffs, drifting in opposite directions. */
function makeAura(): THREE.Group {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("2D canvas unavailable");
  // A band half as wide as before (D-093), around the same middle radius.
  const ring = g.createRadialGradient(128, 128, 64, 128, 128, 120);
  ring.addColorStop(0, "rgba(232,234,236,0)");
  ring.addColorStop(0.55, "rgba(232,234,236,0.5)");
  ring.addColorStop(0.72, "rgba(232,234,236,0.32)");
  ring.addColorStop(1, "rgba(232,234,236,0)");
  g.fillStyle = ring;
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 48; i++) {
    const [a, r, s] = [rand(i, 1) * Math.PI * 2, 86 + rand(i, 2) * 24, 6 + rand(i, 3) * 7];
    const [x, y] = [128 + Math.cos(a) * r, 128 + Math.sin(a) * r];
    const puff = g.createRadialGradient(x, y, 0, x, y, s);
    puff.addColorStop(0, "rgba(240,241,243,0.22)");
    puff.addColorStop(1, "rgba(240,241,243,0)");
    g.fillStyle = puff;
    g.fillRect(x - s, y - s, s * 2, s * 2);
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const group = new THREE.Group();
  AURA_LIFT.forEach((_, i) => {
    const material = new THREE.MeshBasicNodeMaterial({ map, transparent: true, depthWrite: false });
    material.opacity = [0.9, 0.55, 0.3][i] ?? 0.3;
    const layer = new THREE.Mesh(
      new THREE.PlaneGeometry(CELL * (2.6 + i * 0.25), CELL * (2.6 + i * 0.25), 24, 24).rotateX(
        -Math.PI / 2,
      ),
      material,
    );
    layer.frustumCulled = false; // draped over the relief every frame
    layer.renderOrder = 10;
    group.add(layer);
  });
  group.visible = false;
  return group;
}

function animateAura(
  aura: THREE.Group,
  seconds: number,
  height: (x: number, z: number) => number,
): void {
  if (!aura.visible) return;
  aura.children.forEach((layer, i) => {
    layer.rotation.y = seconds * (i % 2 ? -0.35 : 0.25);
    const breathe = 1 + Math.sin(seconds * 1.6 + i) * 0.06;
    layer.scale.set(breathe, 1, breathe);
    drape(layer as THREE.Mesh, height, AURA_LIFT[i] ?? 0); // over the relief (D-097)
  });
}

/** The aura's three fog layers float this far above the ground (m). */
const AURA_LIFT = [0.15, 0.9, 1.8] as const;
