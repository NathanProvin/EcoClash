// Placeholder diorama over a Source (INSTRUCTIONS §6: the renderer only reads snapshots).
// Ground tinted by territory, with frontier lines (P1 solid, P2 dashed: frontier.ts, D-040). Herbs
// as grass blades (grass.ts); shrubs as low-poly bush blobs and trees as a trunk and crown blobs,
// each species with its own form and natural colour, lightly tinted by its owner (layout.ts,
// palette.ts, D-067). Animals as low-poly bodies per type in natural colours, on a ring of their
// owner's colour; soil life and insects as faint dots (animals.ts, D-065, D-068). 1 cell = CELL
// world units (4 m, D-047).

import { MapControls } from "three/addons/controls/MapControls.js";
import * as THREE from "three/webgpu";
import {
  color,
  float,
  mix,
  mx_noise_float,
  positionLocal,
  positionWorld,
  smoothstep,
  texture,
  uv,
  vec3,
} from "three/tsl";
import { isSwarm } from "../game/species";
import { interpolate, type Animal, type Source } from "../replay/replay";
import {
  ANIMAL_SCALE,
  BODIES,
  bodyGeometry,
  FLIGHT_Y,
  formOf as animalForm,
  RING,
  ringRadius,
  type AnimalForm,
  type Body,
} from "./animals";
import { paintFrontier, TEXELS } from "./frontier";
import { makeGrass } from "./grass";
import { QUALITY, type Quality } from "./quality";
import {
  CELL,
  formOf,
  MAX_MODELS,
  SLAB_DEPTH,
  plantLayout,
  rand,
  TREE,
  type Placement,
} from "./layout";
import { hexToRgb, plantColor, PLAYER, soilColor, WORLD, type PlayerId } from "./palette";

export type Layer = "territory" | "L1" | "L2" | "L3" | "animals";

export { CELL };
const HIGHLIGHT = new THREE.Color("#ffffff");
/** Swarm dots (soil life, insects; D-065): radius (m), height (m, in the herbs) and opacity. */
const SWARM_R = 0.06;
const SWARM_Y = 0.15;
const SWARM_OPACITY = 0.45;
/** Share of the owner's hue in the ground of owned cells: light, the frontier line carries
 *  ownership and the plants keep their natural colours (D-067). */
const TERRITORY_TINT = 0.15;
/** Birds bob this much (m) around their flight height. */
const BOB = 0.3;
/** Each animal keeps a fixed offset inside its cell (share of a cell), so animals on the same
 *  point (replays hold whole cells) do not stack. */
const ANIMAL_SPREAD = 0.3;
/** Crown and bush blobs beyond the first one: size and spread relative to the main blob. */
const BLOB = { size: 0.62, spread: 0.5 } as const;
/** Blobs per model at most (FORM in layout.ts). */
const MAX_BLOBS = 3;

/** Keys held by the player, read each frame for keyboard camera moves. */
export interface CameraKeys {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  rotateLeft: boolean;
  rotateRight: boolean;
}

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
  private readonly frontier: THREE.Mesh;
  // L1 as grass blades (grass.ts): RGB = the cell's herb colour, A = L1 cover, one texel per cell.
  private readonly floraData: Uint8Array;
  private readonly floraTex: THREE.DataTexture;
  private grass: THREE.Mesh;
  // Shrubs as bush blobs; trees as a trunk and crown blobs (D-067).
  private readonly bushes: THREE.InstancedMesh;
  private readonly trunks: THREE.InstancedMesh;
  private readonly crowns: THREE.InstancedMesh;
  // Per-cell plant layout, recomputed only when the cell's (quantized) species covers change.
  private readonly layoutKey: Int32Array;
  private readonly layouts: [Placement[], Placement[]][] = [];
  /** Plant species indices per level (1..3); colours per player and species (sRGB bytes, and
   *  linear for instances). */
  private readonly byLevel: number[][];
  private readonly plantRgb: Record<PlayerId, [number, number, number][]>;
  private readonly plantLinear: Record<PlayerId, THREE.Color[]>;
  // Animals (D-068): one mesh per body type, their ground rings, and the swarm dots.
  private readonly bodies: Record<Body, THREE.InstancedMesh>;
  private readonly rings: THREE.InstancedMesh;
  private readonly swarm: THREE.InstancedMesh;
  /** Per fauna species: form, natural colour (linear), swarm flag, predator flag. */
  private readonly animalForms: AnimalForm[];
  private readonly animalColors: THREE.Color[];
  private readonly swarmOf: boolean[];
  private readonly predatorOf: boolean[];
  /** Ring colours per owner (predators vivid); swarm dots in the owner's pale tint. */
  private readonly ringColor: Record<PlayerId, { animal: THREE.Color; predator: THREE.Color }> = {
    1: { animal: new THREE.Color(PLAYER[1].base), predator: new THREE.Color(PLAYER[1].predator) },
    2: { animal: new THREE.Color(PLAYER[2].base), predator: new THREE.Color(PLAYER[2].predator) },
  };
  private readonly dotColor: Record<PlayerId, THREE.Color> = {
    1: new THREE.Color(PLAYER[1].animal),
    2: new THREE.Color(PLAYER[2].animal),
  };
  /** Last drawn position and heading per animal id, to face the way it goes. */
  private heading = new Map<number, { x: number; z: number; a: number }>();
  private readonly aura: THREE.Group; // smoky ring over the selected cell
  private readonly raycaster = new THREE.Raycaster();
  private flight: { from: THREE.Vector3[]; to: THREE.Vector3[]; t: number } | undefined;
  private lastTime = 0;
  private lastFrame = -1;
  private showTerritory = true;
  private shown: Animal[] = [];
  private drawn: { id: number; owner: number; x: number; y: number; z: number }[] = []; // world
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
    const fauna = replay.meta.fauna;
    this.swarmOf = replay.meta.species.filter((s) => s.kind === "fauna").map(isSwarm);
    this.predatorOf = fauna.role.map((r) => r === "predator");
    this.animalForms = fauna.names.map((name, i) => animalForm(name, fauna.role[i] ?? "herbivore"));
    this.animalColors = this.animalForms.map((f) => new THREE.Color(f.color));

    this.scene.background = new THREE.Color(WORLD.sky);
    this.scene.fog = new THREE.Fog(WORLD.horizon, size * 2.2, size * 5); // haze beyond the slab
    this.scene.add(new THREE.HemisphereLight(WORLD.sky, WORLD.groundLight, 1.4));
    const sun = new THREE.DirectionalLight(WORLD.sun, 2.2); // one low key light (§7.1)
    sun.position.set(-size, size * 0.6, -size * 0.4);
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
    const patches = mx_noise_float(positionWorld.xz.mul(0.16)); // broad damp / dry patches
    const grain = float(1)
      .add(patches.mul(0.1))
      .add(mx_noise_float(positionWorld.xz.mul(0.8)).mul(0.08))
      .add(mx_noise_float(positionWorld.xz.mul(4.2)).mul(0.07)); // grit
    const earth = texture(this.groundTex, uv()).rgb;
    const humus = earth.mul(vec3(0.74, 0.68, 0.62)); // darker, warmer patches
    const mottle = smoothstep(0.05, 0.8, patches).mul(0.6);
    groundMat.colorNode = mix(earth, humus, mottle).mul(grain);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2),
      groundMat,
    );
    this.scene.add(ground);

    // The map as a diorama slab: an earth cross-section on its sides, topsoil to bedrock.
    const slabMat = new THREE.MeshStandardNodeMaterial({ roughness: 1 });
    const depth = positionLocal.y.negate().div(SLAB_DEPTH); // 0 at the top, 1 at the bottom
    const soil = mix(color(WORLD.earthTop), color(WORLD.earthSub), smoothstep(0.05, 0.35, depth));
    const layers = vec3(mix(soil, color(WORLD.earthStone), smoothstep(0.65, 0.85, depth)));
    slabMat.colorNode = layers.mul(float(1).add(mx_noise_float(positionWorld.mul(1.5)).mul(0.08)));
    // Box faces: +x, -x, +y, -y, +z, -z. No top face: the ground plane is the top, and two
    // coplanar faces would z-fight.
    const noTop = new THREE.MeshBasicNodeMaterial({ visible: false });
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(size, SLAB_DEPTH, size).translate(0, -SLAB_DEPTH / 2, 0),
      [slabMat, slabMat, noTop, slabMat, slabMat, slabMat],
    );
    this.scene.add(slab);

    // Frontier overlay, a hair above the ground, under the plants; crisp texels up close.
    const side = n * TEXELS;
    this.frontierData = new Uint8Array(side * side * 4);
    this.frontierTex = new THREE.DataTexture(this.frontierData, side, side);
    this.frontierTex.magFilter = THREE.NearestFilter;
    this.frontierTex.colorSpace = THREE.SRGBColorSpace;
    this.frontier = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2).translate(0, 0.02, 0),
      new THREE.MeshBasicNodeMaterial({
        map: this.frontierTex,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.scene.add(this.frontier);

    this.floraData = new Uint8Array(n * n * 4);
    this.floraTex = new THREE.DataTexture(this.floraData, n, n);
    this.floraTex.magFilter = THREE.LinearFilter;
    this.floraTex.colorSpace = THREE.SRGBColorSpace;
    this.grass = makeGrass(n, QUALITY[quality].grass, this.floraTex);
    this.scene.add(this.grass);

    const cells = n * n;
    this.layoutKey = new Int32Array(cells).fill(-1);
    const { names, level } = replay.meta.flora;
    this.byLevel = [1, 2, 3].map((l) => names.flatMap((_, i) => (level[i] === l ? [i] : [])));
    const colours = (p: PlayerId) => names.map((name, i) => plantColor(name, level[i] ?? 1, p));
    this.plantRgb = { 1: colours(1), 2: colours(2) };
    const linear = (p: PlayerId) =>
      this.plantRgb[p].map(([r, g, b]) =>
        new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace),
      );
    this.plantLinear = { 1: linear(1), 2: linear(2) };
    // Low-poly blobs (flat shaded facets) and tapered trunks, base on the ground; instances
    // scale and place them (layout.ts).
    const blob = new THREE.IcosahedronGeometry(1, 1);
    const trunk = new THREE.CylinderGeometry(0.65, 1, 1, 6).translate(0, 0.5, 0);
    this.bushes = this.instanced(blob, cells * MAX_MODELS[1] * MAX_BLOBS, 0.85, true);
    this.crowns = this.instanced(blob, cells * MAX_MODELS[2] * MAX_BLOBS, 0.8, true);
    this.trunks = this.instanced(trunk, cells * MAX_MODELS[2], 0.95, true);

    this.aura = makeAura();
    this.scene.add(this.aura);

    const most = replay.maxAnimals();
    const bodies = {} as Record<Body, THREE.InstancedMesh>;
    for (const b of BODIES) bodies[b] = this.instanced(bodyGeometry(b), most, 0.9, true);
    this.bodies = bodies;
    const ring = new THREE.RingGeometry(1 - RING.width, 1, 28).rotateX(-Math.PI / 2);
    this.rings = this.instanced(ring, most);
    const ringMat = this.rings.material as THREE.MeshBasicNodeMaterial;
    ringMat.transparent = true;
    ringMat.opacity = 0.85;
    ringMat.depthWrite = false;
    this.swarm = this.instanced(new THREE.SphereGeometry(1, 6, 4), most);
    const faint = this.swarm.material as THREE.MeshBasicNodeMaterial;
    faint.transparent = true;
    faint.opacity = SWARM_OPACITY;
    faint.depthWrite = false;
  }

  static async create(
    canvas: HTMLCanvasElement,
    replay: Source,
    quality: Quality,
  ): Promise<Viewer> {
    // WebGPU when available, WebGL2 otherwise (INSTRUCTIONS §3.1).
    const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
    await renderer.init();
    return new Viewer(canvas, replay, renderer, quality);
  }

  /** An instanced mesh; lit with `roughness` (flat shaded if `flat`), or unlit (animals). */
  private instanced(
    geometry: THREE.BufferGeometry,
    count: number,
    roughness?: number,
    flat = false,
  ) {
    const material =
      roughness === undefined
        ? new THREE.MeshBasicNodeMaterial()
        : new THREE.MeshStandardNodeMaterial({ roughness, flatShading: flat });
    const mesh = new THREE.InstancedMesh(geometry, material, Math.max(count, 1));
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(Math.max(count, 1) * 3),
      3,
    );
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    this.scene.add(mesh);
    return mesh;
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

  /** Switch the quality preset: rebuild the grass at its density, apply its resolution. */
  setQuality(q: Quality): void {
    this.quality = q;
    const visible = this.grass.visible;
    this.scene.remove(this.grass);
    this.grass.geometry.dispose();
    (this.grass.material as THREE.Material).dispose();
    this.grass = makeGrass(this.replay.meta.n, QUALITY[q].grass, this.floraTex);
    this.grass.visible = visible;
    this.scene.add(this.grass);
    this.resize();
  }

  setVisible(layer: Layer, on: boolean): void {
    if (layer === "territory") {
      this.showTerritory = on;
      this.frontier.visible = on;
      this.lastFrame = -1; // repaint the ground
    } else if (layer === "animals") {
      for (const m of [...Object.values(this.bodies), this.rings, this.swarm]) m.visible = on;
    } else if (layer === "L1") {
      this.grass.visible = on;
    } else if (layer === "L2") {
      this.bushes.visible = on;
    } else {
      this.trunks.visible = on;
      this.crowns.visible = on;
    }
  }

  setSelection(ids: Iterable<number>): void {
    this.selected = new Set(ids);
  }

  /** The grid cell under a screen point (CSS pixels of the canvas), or null off the map. */
  pickCell(x: number, y: number): { row: number; col: number } | null {
    const { clientWidth: w, clientHeight: h } = this.canvas;
    this.raycaster.setFromCamera(new THREE.Vector2((x / w) * 2 - 1, 1 - (y / h) * 2), this.camera);
    const hit = this.raycaster.ray.intersectPlane(
      new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
      new THREE.Vector3(),
    );
    const n = this.replay.meta.n;
    if (!hit) return null;
    const col = Math.floor(hit.x / CELL + n / 2);
    const row = Math.floor(hit.z / CELL + n / 2);
    return row >= 0 && row < n && col >= 0 && col < n ? { row, col } : null;
  }

  /** Show the aura over a cell, or hide it (null). */
  setCell(cell: { row: number; col: number } | null): void {
    this.aura.visible = cell !== null;
    if (cell) this.aura.position.copy(cellCenter(cell, this.replay.meta.n));
  }

  /** Fly the camera down to a cell until single plant models fill the view. */
  zoomToCell(cell: { row: number; col: number }): void {
    const target = cellCenter(cell, this.replay.meta.n);
    const dir = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
    dir.y = 0;
    dir.normalize();
    const eye = target.clone().addScaledVector(dir, 3.2).setY(2.6);
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

  /** Draw the replay at a fractional tick. */
  render(tick: number): void {
    const now = performance.now() / 1000;
    const dt = Math.min(now - (this.lastTime || now), 0.1);
    this.lastTime = now;
    const fields = this.replay.fields(tick);
    if (fields.frame !== this.lastFrame) {
      this.lastFrame = fields.frame;
      this.paintFields(fields.owner, fields.soil, fields.species, fields.cover);
    }
    this.placeAnimals(tick);
    animateAura(this.aura, now);
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
    this.controls.update();
    void this.renderer.render(this.scene, this.camera);
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
    for (const a of this.drawn) {
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

  private paintFields(
    owner: Uint8Array,
    soilDev: Uint8Array,
    species: Uint8Array[],
    cover: Uint8Array[],
  ): void {
    const n = this.replay.meta.n;
    const names = this.replay.meta.flora.names;
    const tint = { 1: hexToRgb(PLAYER[1].base), 2: hexToRgb(PLAYER[2].base) };
    const [herbs = [], shrubs = [], trees = []] = this.byLevel;
    const present = (list: number[], c: number) =>
      list.flatMap((i) => {
        const v = species[i]?.[c] ?? 0;
        return v ? [{ species: i, cover: v / 255 }] : [];
      });
    const trunkColor = new THREE.Color(WORLD.trunk);
    const tmp = new THREE.Color();
    const counts = { bushes: 0, trunks: 0, crowns: 0 };
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
        continue;
      }
      const p: PlayerId = o;
      // Grass texel (rows not flipped: the grass shader maps world z to rows itself): the
      // cover-weighted colour of the cell's herbs.
      const rgb = [0, 0, 0];
      let weight = 0;
      for (const h of present(herbs, c)) {
        const col = this.plantRgb[p][h.species] ?? [0, 0, 0];
        for (let j = 0; j < 3; j++) rgb[j] = (rgb[j] ?? 0) + (col[j] ?? 0) * h.cover;
        weight += h.cover;
      }
      const w = weight || 1;
      this.floraData.set(
        [(rgb[0] ?? 0) / w, (rgb[1] ?? 0) / w, (rgb[2] ?? 0) / w, cover[0]?.[c] ?? 0],
        c * 4,
      );

      const [bushList, treeList] = [present(shrubs, c), present(trees, c)];
      let key = 0x811c9dc5;
      for (const q of [...bushList, ...treeList]) {
        key = Math.imul(key ^ (q.species * 16 + Math.floor(q.cover * 15.99)), 16777619);
      }
      let layout = this.layouts[c];
      if (!layout || this.layoutKey[c] !== key) {
        layout = plantLayout(c, bushList, treeList);
        this.layouts[c] = layout;
        this.layoutKey[c] = key;
      }
      const x0 = ((c % n) - n / 2) * CELL; // cell corner in world metres
      const z0 = (Math.floor(c / n) - n / 2) * CELL;
      const [bushModels, treeModels] = layout;
      for (const m of bushModels) {
        const form = formOf(names[m.species] ?? "");
        const base = this.plantLinear[p][m.species] ?? trunkColor;
        const [x, z, r] = [x0 + m.x, z0 + m.z, m.size];
        tmp.copy(base).multiplyScalar(0.9 + 0.2 * m.seed);
        const y = r * form.h * 0.6; // sunk a little: bushes sit in the herbs
        writeInstance(this.bushes, counts.bushes++, x, y, z, r * form.w, m.angle, tmp, r * form.h);
        for (let b = 1; b < form.blobs; b++) {
          const a = m.angle + (b * Math.PI * 2) / (form.blobs - 1);
          const [d, rb] = [r * BLOB.spread, r * BLOB.size];
          const [bx, bz] = [x + Math.cos(a) * d, z + Math.sin(a) * d];
          tmp.copy(base).multiplyScalar(0.82 + 0.2 * rand(b, m.seed * 1e6));
          const by = rb * form.h * 0.5;
          writeInstance(this.bushes, counts.bushes++, bx, by, bz, rb * form.w, a, tmp, rb * form.h);
        }
      }
      for (const m of treeModels) {
        const form = formOf(names[m.species] ?? "");
        const base = this.plantLinear[p][m.species] ?? trunkColor;
        const [x, z, r] = [x0 + m.x, z0 + m.z, m.size];
        const grown = (r - TREE.min) / (TREE.max - TREE.min);
        const h = TREE.trunkMin + (TREE.trunkMax - TREE.trunkMin) * (0.6 * grown + 0.4 * m.seed);
        const crownY = h + r * form.h * 0.45;
        const trunkR = TREE.trunkR * (0.7 + 0.5 * grown);
        writeInstance(this.trunks, counts.trunks++, x, 0, z, trunkR, m.angle, trunkColor, crownY);
        tmp.copy(base).multiplyScalar(0.92 + 0.16 * m.seed);
        const [cw, ch] = [r * form.w, r * form.h];
        writeInstance(this.crowns, counts.crowns++, x, crownY, z, cw, m.angle, tmp, ch);
        for (let b = 1; b < form.blobs; b++) {
          const a = m.angle + (b * Math.PI * 2) / (form.blobs - 1);
          const [d, rb] = [cw * BLOB.spread, r * BLOB.size];
          const [bx, bz] = [x + Math.cos(a) * d, z + Math.sin(a) * d];
          const by = crownY - ch * (0.1 + 0.25 * rand(b, m.seed * 1e6));
          tmp.copy(base).multiplyScalar(0.8 + 0.15 * rand(b + 7, m.seed * 1e6)); // lower: shade
          writeInstance(this.crowns, counts.crowns++, bx, by, bz, rb * form.w, a, tmp, rb * form.h);
        }
      }
    }
    finish(this.bushes, counts.bushes);
    finish(this.trunks, counts.trunks);
    finish(this.crowns, counts.crowns);
    this.floraTex.needsUpdate = true;
    this.groundTex.needsUpdate = true;
    paintFrontier(owner, n, tint, this.frontierData);
    this.frontierTex.needsUpdate = true;
  }

  private placeAnimals(tick: number): void {
    const t0 = Math.floor(tick);
    this.shown = interpolate(this.replay.animals(t0), this.replay.animals(t0 + 1), tick - t0);
    const n = this.replay.meta.n;
    const counts = Object.fromEntries(BODIES.map((b) => [b, 0])) as Record<Body, number>;
    let [swarms, rings] = [0, 0];
    const heading = new Map<number, { x: number; z: number; a: number }>();
    this.drawn = [];
    for (const a of this.shown) {
      const owner: PlayerId = a.owner === 2 ? 2 : 1;
      // Its (interpolated) position from the cell corner, plus its own fixed offset.
      const x = (a.x - n / 2 + 0.5 + ANIMAL_SPREAD * unit(a.id, 1)) * CELL;
      const z = (a.y - n / 2 + 0.5 + ANIMAL_SPREAD * unit(a.id, 2)) * CELL;
      if (this.swarmOf[a.species]) {
        writeInstance(this.swarm, swarms++, x, SWARM_Y, z, SWARM_R, 0, this.dotColor[owner]);
        continue; // not selectable (D-065)
      }
      // Face the way it goes; keep the last heading while it stands still.
      const last = this.heading.get(a.id);
      const [dx, dz] = last ? [x - last.x, z - last.z] : [0, 0];
      const turn = Math.hypot(dx, dz) > 1e-3 ? Math.atan2(-dz, dx) : undefined;
      const angle = turn ?? last?.a ?? unit(a.id, 3) * Math.PI * 2;
      heading.set(a.id, { x, z, a: angle });
      const form = this.animalForms[a.species];
      const body = form?.body ?? "rodent";
      const size = (form?.length ?? 0.2) * ANIMAL_SCALE;
      const y = body === "bird" ? FLIGHT_Y + BOB * Math.sin(tick * 0.8 + a.id) : 0;
      const color = this.animalColors[a.species] ?? HIGHLIGHT;
      writeInstance(this.bodies[body], counts[body]++, x, y, z, size, angle, color);
      const ring = this.selected.has(a.id)
        ? HIGHLIGHT
        : this.ringColor[owner][this.predatorOf[a.species] ? "predator" : "animal"];
      const r = form ? ringRadius(form) : RING.min;
      writeInstance(this.rings, rings++, x, 0.04, z, r, 0, ring);
      this.drawn.push({ id: a.id, owner: a.owner, x, y: y + size * 0.3, z });
    }
    this.heading = heading;
    for (const b of BODIES) finish(this.bodies[b], counts[b]);
    finish(this.rings, rings);
    finish(this.swarm, swarms);
  }

  dispose(): void {
    this.controls.dispose();
    this.renderer.dispose();
  }
}

function cellCenter(cell: { row: number; col: number }, n: number): THREE.Vector3 {
  return new THREE.Vector3((cell.col - n / 2 + 0.5) * CELL, 0, (cell.row - n / 2 + 0.5) * CELL);
}

/** A foggy, smoky light-grey ring: three soft layers stacked through the plant height, each a
 *  radial ring with smoke puffs, drifting in opposite directions. */
function makeAura(): THREE.Group {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("2D canvas unavailable");
  const ring = g.createRadialGradient(128, 128, 36, 128, 128, 128);
  ring.addColorStop(0, "rgba(232,234,236,0)");
  ring.addColorStop(0.55, "rgba(232,234,236,0.5)");
  ring.addColorStop(0.72, "rgba(232,234,236,0.32)");
  ring.addColorStop(1, "rgba(232,234,236,0)");
  g.fillStyle = ring;
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 48; i++) {
    const [a, r, s] = [rand(i, 1) * Math.PI * 2, 78 + rand(i, 2) * 50, 10 + rand(i, 3) * 14];
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
  [0.08, 0.9, 1.8].forEach((height, i) => {
    const material = new THREE.MeshBasicNodeMaterial({ map, transparent: true, depthWrite: false });
    material.opacity = [0.9, 0.55, 0.3][i] ?? 0.3;
    const layer = new THREE.Mesh(
      new THREE.PlaneGeometry(CELL * (2.6 + i * 0.5), CELL * (2.6 + i * 0.5)).rotateX(-Math.PI / 2),
      material,
    );
    layer.position.y = height;
    layer.renderOrder = 10;
    group.add(layer);
  });
  group.visible = false;
  return group;
}

function animateAura(aura: THREE.Group, seconds: number): void {
  if (!aura.visible) return;
  aura.children.forEach((layer, i) => {
    layer.rotation.y = seconds * (i % 2 ? -0.35 : 0.25);
    const breathe = 1 + Math.sin(seconds * 1.6 + i) * 0.06;
    layer.scale.set(breathe, 1, breathe);
  });
}

/** Rotation about Y + scale (`scale` across, `height` up) + translation, written straight into
 *  the instance buffers. */
function writeInstance(
  mesh: THREE.InstancedMesh,
  i: number,
  x: number,
  y: number, // not scaled: the height band
  z: number,
  scale: number,
  angle: number,
  color: THREE.Color, // linear, managed by THREE.Color
  height = scale,
): void {
  const [c, s] = [Math.cos(angle) * scale, Math.sin(angle) * scale];
  const m = mesh.instanceMatrix.array as Float32Array;
  const o = i * 16; // column-major, written in place (this runs ~100k times per field frame)
  m[o] = c;
  m[o + 1] = 0;
  m[o + 2] = -s;
  m[o + 3] = 0;
  m[o + 4] = 0;
  m[o + 5] = height;
  m[o + 6] = 0;
  m[o + 7] = 0;
  m[o + 8] = s;
  m[o + 9] = 0;
  m[o + 10] = c;
  m[o + 11] = 0;
  m[o + 12] = x;
  m[o + 13] = y;
  m[o + 14] = z;
  m[o + 15] = 1;
  const col = mesh.instanceColor?.array as Float32Array | undefined;
  if (col) {
    col[i * 3] = color.r;
    col[i * 3 + 1] = color.g;
    col[i * 3 + 2] = color.b;
  }
}

/** A fixed pseudo-random value in [-0.5, 0.5) for animal `id` (multiplicative hash; `salt`
 *  picks the axis). */
function unit(id: number, salt: number): number {
  return (Math.imul(id + salt * 0x9e3779b9, 0x9e3779b1) >>> 0) / 2 ** 32 - 0.5;
}

function finish(mesh: THREE.InstancedMesh, count: number): void {
  mesh.count = count;
  // Upload only the instances in use: the buffers are sized for a full map.
  for (const [attr, size] of [
    [mesh.instanceMatrix, 16],
    [mesh.instanceColor, 3],
  ] as const) {
    if (!attr) continue;
    attr.clearUpdateRanges();
    attr.addUpdateRange(0, Math.max(1, count) * size);
    attr.needsUpdate = true;
  }
}
