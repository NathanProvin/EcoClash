// The drop cursor (D-079): while a species is armed, a see-through copy of its model follows the
// cursor over the map, on a ring showing where it will land (the plant disc, or for animals the
// landing spot on your land and the drop area elsewhere). Built from the same PlantStyle and
// animal bodies as the scene, so better models show up here too.

import * as THREE from "three/webgpu";
import type { Role } from "../replay/replay";
import { drawnLength, formOf as animalForm } from "./animals";
import { animalGeometry } from "./bodies";
import { LOW, PAD, SHRUB, STRATA, stratumOf, TREE, type Placement } from "./layout";
import { plantColor, type PlayerId } from "./palette";
import { drape } from "./terrain";
import { LowPolyPlants, type PlantStyle } from "./plants";

/** The armed species, as the cursor needs it. */
export interface GhostSpec {
  name: string;
  kind: "flora" | "fauna";
  /** Plants: height level and family (aquatic herbs float as pads, D-087). */
  level: number;
  family?: string;
  role: Role;
  player: PlayerId;
  /** Cells: the plant disc (flora) or the drop radius off your land (fauna). */
  radius: number;
}

/** How see-through the ghost model is; a herb shows as a small tuft of this size (m). */
const OPACITY = 0.6;
const TUFT = 0.3;
/** The footprint ring floats this far above the ground. */
const RING_LIFT = 0.08;

export class Ghost {
  private readonly group = new THREE.Group();
  private readonly ring: THREE.Mesh;
  private readonly model = new THREE.Group();
  private readonly style: PlantStyle = new LowPolyPlants();
  private size = 1; // the model's largest dimension (m)

  /** `height`: the ground (or water surface) under a world point, for the ring (D-097). */
  constructor(
    scene: THREE.Scene,
    private readonly height: (x: number, z: number) => number = () => 0,
  ) {
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.94, 1, 96).rotateX(-Math.PI / 2),
      new THREE.MeshBasicNodeMaterial({ transparent: true, opacity: 0.85, depthWrite: false }),
    );
    this.ring.frustumCulled = false; // its vertices move with the ground
    this.ring.renderOrder = 12;
    this.group.add(this.ring, this.model);
    this.group.visible = false;
    scene.add(this.group);
  }

  /** Show the model of `spec` (null: none). */
  set(spec: GhostSpec | null): void {
    for (const m of this.model.children as THREE.Mesh[]) (m.material as THREE.Material).dispose();
    this.model.clear();
    this.group.visible = false;
    if (!spec) return;
    const material = (hex: THREE.Color) =>
      new THREE.MeshStandardNodeMaterial({
        color: hex,
        transparent: true,
        opacity: OPACITY,
        flatShading: true,
        depthWrite: false,
      });
    if (spec.kind === "fauna") {
      const form = animalForm(spec.name, spec.role);
      const coat = material(new THREE.Color("#ffffff"));
      coat.vertexColors = true; // the species palette (D-116)
      const body = new THREE.Mesh(animalGeometry(form), coat);
      body.scale.setScalar(drawnLength(form));
      this.model.add(body);
      this.measure();
      return;
    }
    const [r, g, b] = plantColor(spec.name, spec.level, spec.player);
    const base = new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
    const s = stratumOf(spec.level, spec.family === "W");
    const stratum = s === null ? "low" : (STRATA[s] ?? "low"); // a land herb: a small tuft
    const size = s === null ? TUFT : [LOW.max, SHRUB.max, TREE.max, PAD.max][s];
    const at: Placement = {
      x: 0,
      z: 0,
      angle: 0,
      seed: 0.5,
      slot: 0,
      size: size ?? TUFT,
      species: 0,
    };
    for (const p of this.style.parts(stratum, at, 0, 0, spec.name)) {
      const geometry = this.style.meshes[p.mesh]?.geometry;
      if (!geometry) continue;
      const mesh = new THREE.Mesh(
        geometry,
        material(p.color ?? base.clone().multiplyScalar(p.shade)),
      );
      mesh.position.set(p.x, p.y, p.z);
      mesh.scale.set(p.w, p.h, p.w);
      mesh.rotation.y = p.angle;
      this.model.add(mesh);
    }
    this.measure();
  }

  private measure(): void {
    this.model.scale.setScalar(1);
    const box = new THREE.Box3().setFromObject(this.model);
    const d = box.getSize(new THREE.Vector3());
    this.size = Math.max(d.x, d.y, d.z, 0.01);
  }

  /** Put the ghost at `at` (null hides it), with a ring of `radius` metres in `color`. The model is
   *  enlarged to at least `least` metres across, so a vole still reads from far away. */
  aim(at: THREE.Vector3 | null, radius: number, color: string, least = 0): void {
    this.group.visible = at !== null && this.model.children.length > 0;
    if (!at) return;
    this.group.position.copy(at);
    this.ring.scale.set(radius, 1, radius);
    drape(this.ring, this.height, RING_LIFT);
    this.model.scale.setScalar(Math.max(1, least / this.size));
    (this.ring.material as THREE.MeshBasicNodeMaterial).color.set(color);
  }
}
