// Placeholder diorama over a Replay (INSTRUCTIONS §6: the renderer only reads snapshots).
// Ground tinted by territory; flora as instanced dots (L1), cones (L2) and cubes (L3) scaled by
// cover; animals as spheres (herbivores), small dots (decomposers) and pyramids (predators).
// 1 cell = 1 world unit (Q-008 default).

import { MapControls } from "three/addons/controls/MapControls.js";
import * as THREE from "three/webgpu";
import { interpolate, type Replay, type Role } from "../replay/replay";
import { hexToRgb, PLAYER, WORLD, type PlayerId } from "./palette";

export type Layer = "territory" | "L1" | "L2" | "L3" | "animals";

const ROLES: Role[] = ["herbivore", "decomposer", "predator"];

export class Viewer {
  readonly backend: string;
  private readonly renderer: THREE.WebGPURenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: MapControls;
  private readonly groundData: Uint8Array;
  private readonly groundTex: THREE.DataTexture;
  private readonly strata: THREE.InstancedMesh[];
  private readonly animals: Record<Role, THREE.InstancedMesh>;
  private readonly roleOf: Role[];
  private readonly animalColor: Record<PlayerId, { animal: THREE.Color; predator: THREE.Color }> = {
    1: { animal: new THREE.Color(PLAYER[1].animal), predator: new THREE.Color(PLAYER[1].predator) },
    2: { animal: new THREE.Color(PLAYER[2].animal), predator: new THREE.Color(PLAYER[2].predator) },
  };
  private lastFrame = -1;
  private showTerritory = true;

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly replay: Replay,
    renderer: THREE.WebGPURenderer,
  ) {
    const n = replay.meta.n;
    this.renderer = renderer;
    this.backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend
      ? "WebGPU"
      : "WebGL2";
    this.roleOf = replay.meta.fauna.role;

    this.scene.background = new THREE.Color(WORLD.sky);
    this.scene.fog = new THREE.Fog(WORLD.horizon, n * 1.2, n * 3);
    this.scene.add(new THREE.HemisphereLight(WORLD.sky, WORLD.groundLight, 1.4));
    const sun = new THREE.DirectionalLight(WORLD.sun, 2.2); // one low key light (§7.1)
    sun.position.set(-n, n * 0.6, -n * 0.4);
    this.scene.add(sun);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.5, n * 6);
    this.camera.position.set(0, n * 0.85, n * 0.75);
    this.controls = new MapControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.minPolarAngle = 0.15; // limited tilt (INSTRUCTIONS §2.4)
    this.controls.maxPolarAngle = 1.05;
    this.controls.minDistance = 8;
    this.controls.maxDistance = n * 2.2;
    this.controls.target.set(0, 0, 0);

    // Ground: one texel per cell, linearly filtered so cells never read as pixels (§5.1).
    this.groundData = new Uint8Array(n * n * 4);
    this.groundTex = new THREE.DataTexture(this.groundData, n, n);
    this.groundTex.magFilter = THREE.LinearFilter;
    this.groundTex.colorSpace = THREE.SRGBColorSpace;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(n, n).rotateX(-Math.PI / 2),
      new THREE.MeshStandardNodeMaterial({ map: this.groundTex, roughness: 1 }),
    );
    this.scene.add(ground);

    const cells = n * n;
    const dot = new THREE.SphereGeometry(0.3, 6, 4).scale(1, 0.4, 1).translate(0, 0.12, 0);
    const cone = new THREE.ConeGeometry(0.45, 1.1, 7).translate(0, 0.55, 0);
    const cube = new THREE.BoxGeometry(0.85, 0.85, 0.85).translate(0, 1.6, 0);
    this.strata = [dot, cone, cube].map((g) => this.instanced(g, cells, 0.9));

    const most = replay.maxAnimals();
    // Animals are unlit and ride above the plant tops so they read at RTS zoom.
    this.animals = {
      herbivore: this.instanced(new THREE.SphereGeometry(0.6, 12, 8).translate(0, 1.3, 0), most),
      decomposer: this.instanced(new THREE.SphereGeometry(0.3, 8, 6).translate(0, 0.9, 0), most),
      predator: this.instanced(new THREE.ConeGeometry(0.9, 2.4, 3).translate(0, 2.2, 0), most),
    };
  }

  static async create(canvas: HTMLCanvasElement, replay: Replay): Promise<Viewer> {
    // WebGPU when available, WebGL2 otherwise (INSTRUCTIONS §3.1).
    const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
    await renderer.init();
    return new Viewer(canvas, replay, renderer);
  }

  /** An instanced mesh; lit with `roughness`, or unlit (animals) without it. */
  private instanced(geometry: THREE.BufferGeometry, count: number, roughness?: number) {
    const material =
      roughness === undefined
        ? new THREE.MeshBasicNodeMaterial()
        : new THREE.MeshStandardNodeMaterial({ roughness });
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

  resize(): void {
    const { clientWidth: w, clientHeight: h } = this.canvas;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
  }

  setVisible(layer: Layer, on: boolean): void {
    if (layer === "territory") {
      this.showTerritory = on;
      this.lastFrame = -1; // repaint the ground
    } else if (layer === "animals") {
      for (const m of Object.values(this.animals)) m.visible = on;
    } else {
      const mesh = this.strata[Number(layer[1]) - 1];
      if (mesh) mesh.visible = on;
    }
  }

  /** Draw the replay at a fractional tick. */
  render(tick: number): void {
    const fields = this.replay.fields(tick);
    if (fields.frame !== this.lastFrame) {
      this.lastFrame = fields.frame;
      this.paintFields(fields.owner, fields.cover);
    }
    this.placeAnimals(tick);
    this.controls.update();
    void this.renderer.render(this.scene, this.camera);
  }

  private paintFields(owner: Uint8Array, cover: Uint8Array[]): void {
    const n = this.replay.meta.n;
    const soil = hexToRgb(WORLD.soil);
    const tint = { 1: hexToRgb(PLAYER[1].base), 2: hexToRgb(PLAYER[2].base) };
    const strataColor = ([1, 2] as PlayerId[]).map((p) =>
      PLAYER[p].strata.map((hex) => new THREE.Color(hex)),
    );
    const counts: Record<0 | 1 | 2, number> = { 0: 0, 1: 0, 2: 0 };
    for (let c = 0; c < n * n; c++) {
      const p = owner[c] ?? 0;
      const t = p && this.showTerritory ? tint[p as PlayerId] : soil;
      const k = p && this.showTerritory ? 0.35 : 0;
      // Texture row 0 is the plane's near edge (+z); grid row 0 is the far edge (-z): flip rows.
      const texel = ((n - 1 - Math.floor(c / n)) * n + (c % n)) * 4;
      for (let j = 0; j < 3; j++) {
        this.groundData[texel + j] = Math.round((soil[j] ?? 0) * (1 - k) + (t[j] ?? 0) * k);
      }
      this.groundData[texel + 3] = 255;
      if (!p) continue;
      const wx = (c % n) - n / 2 + 0.5;
      const wz = Math.floor(c / n) - n / 2 + 0.5;
      for (const s of [0, 1, 2] as const) {
        const v = (cover[s]?.[c] ?? 0) / 255;
        const mesh = this.strata[s];
        const color = strataColor[p - 1]?.[s];
        if (v < 0.05 || !mesh || !color) continue;
        const scale = s === 0 ? 0.4 + 0.8 * v : 0.35 + 0.65 * v;
        writeInstance(mesh, counts[s]++, wx, wz, scale, color);
      }
    }
    this.strata.forEach((m, s) => finish(m, counts[s as 0 | 1 | 2]));
    this.groundTex.needsUpdate = true;
  }

  private placeAnimals(tick: number): void {
    const t0 = Math.floor(tick);
    const list = interpolate(this.replay.animals(t0), this.replay.animals(t0 + 1), tick - t0);
    const n = this.replay.meta.n;
    const counts: Record<Role, number> = { herbivore: 0, decomposer: 0, predator: 0 };
    for (const a of list) {
      const role = this.roleOf[a.species] ?? "herbivore";
      const colors = this.animalColor[a.owner === 2 ? 2 : 1];
      const color = role === "predator" ? colors.predator : colors.animal;
      const [x, z] = [a.x - n / 2 + 0.5, a.y - n / 2 + 0.5];
      writeInstance(this.animals[role], counts[role]++, x, z, 1, color);
    }
    for (const role of ROLES) finish(this.animals[role], counts[role]);
  }

  dispose(): void {
    this.controls.dispose();
    this.renderer.dispose();
  }
}

/** Translation + uniform scale, written straight into the instance buffers. */
function writeInstance(
  mesh: THREE.InstancedMesh,
  i: number,
  x: number,
  z: number,
  scale: number,
  color: THREE.Color, // linear, managed by THREE.Color
): void {
  const m = mesh.instanceMatrix.array as Float32Array;
  m.set([scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, scale, 0, x, 0, z, 1], i * 16);
  (mesh.instanceColor?.array as Float32Array | undefined)?.set([color.r, color.g, color.b], i * 3);
}

function finish(mesh: THREE.InstancedMesh, count: number): void {
  mesh.count = count;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}
