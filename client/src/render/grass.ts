// Instanced grass (INSTRUCTIONS §7.2, D-055): the herbaceous stratum (L1) as GPU blades. One merged
// static geometry; the vertex shader reads the flora texture (RGB = owner's L1 colour, A = L1 cover)
// of the last two field frames and blends them (D-072), so blades grow and fade between frames
// at each blade's root, so density and colour follow the fields with no per-frame CPU work.

import { attribute, float, mix, positionLocal, smoothstep, texture, vec3 } from "three/tsl";
import * as THREE from "three/webgpu";
import { CELL, rand } from "./layout";

const BLADE_WIDTH = 0.14; // metres at the base
const BLADE_HEIGHT = [0.3, 0.55] as const; // shortest, tallest (below the shrub band)
export const TUFT = 3; // blades per tuft, fanned 60 degrees apart
const TUFT_SPREAD = 0.1; // metres between a tuft's blades

/** Vertex data of every blade: one triangle each (base left, base right, tip). */
export interface Blades {
  /** Blade-local positions (x, y, z), before the shader scales and moves them. */
  position: Float32Array;
  /** World x / z of the blade's base, per vertex. */
  root: Float32Array;
  /** The L1 cover above which the blade shows (0..1), per vertex: density follows cover. */
  seed: Float32Array;
}

/** Tufts of `TUFT` blades for an `n x n` map, `perCell` tufts per cell, jittered inside their cell
 *  (deterministic). A tuft's blades share its root and seed: they show and hide together. */
export function grassBlades(n: number, perCell: number): Blades {
  const count = n * n * perCell * TUFT;
  const position = new Float32Array(count * 9);
  const root = new Float32Array(count * 6);
  const seed = new Float32Array(count * 3);
  for (let c = 0; c < n * n; c++) {
    const x0 = ((c % n) - n / 2) * CELL;
    const z0 = (Math.floor(c / n) - n / 2) * CELL;
    for (let k = 0; k < perCell; k++) {
      const salt = 5000 + 8 * k;
      const [rx, rz] = [x0 + rand(c, salt) * CELL, z0 + rand(c, salt + 1) * CELL];
      const tuftSeed = rand(c, salt + 4);
      for (let t = 0; t < TUFT; t++) {
        const b = (c * perCell + k) * TUFT + t;
        const angle = rand(c, salt + 2) * Math.PI + (t * Math.PI) / TUFT;
        const h = BLADE_HEIGHT[0] + (BLADE_HEIGHT[1] - BLADE_HEIGHT[0]) * rand(c, salt + 3 + t);
        const [cx, cz] = [Math.cos(angle), Math.sin(angle)];
        const [dx, dz] = [(cx * BLADE_WIDTH) / 2, (cz * BLADE_WIDTH) / 2];
        const [ox, oz] = [-cz * TUFT_SPREAD * (t - 1), cx * TUFT_SPREAD * (t - 1)]; // fan out
        position.set([ox - dx, 0, oz - dz, ox + dx, 0, oz + dz, ox, h, oz], b * 9);
        root.set([rx, rz, rx, rz, rx, rz], b * 6);
        seed.fill(tuftSeed, b * 3, b * 3 + 3);
      }
    }
  }
  return { position, root, seed };
}

/** The grass mesh over an `n x n` map, drawn from `flora` (n x n RGBA, rows = grid rows): the
 *  previous field frame `prev` blended into the current one by `blend` (0..1). */
export function makeGrass(
  n: number,
  perCell: number,
  flora: THREE.Texture,
  prev: THREE.Texture,
  blend: THREE.UniformNode<"float", number>,
): THREE.Mesh {
  const b = grassBlades(n, perCell);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(b.position, 3));
  geometry.setAttribute("root", new THREE.BufferAttribute(b.root, 2));
  geometry.setAttribute("seed", new THREE.BufferAttribute(b.seed, 1));
  // Normals point up: grass lights like the ground under it, not like thin tilted cards.
  const up = new Float32Array(b.position.length);
  for (let i = 1; i < up.length; i += 3) up[i] = 1;
  geometry.setAttribute("normal", new THREE.BufferAttribute(up, 3));
  // Both windings, one-sided material: both faces keep the up normal (double-sided rendering
  // would flip it on the back face and darken it).
  const index = new Uint32Array((b.seed.length / 3) * 6);
  for (let v = 0, i = 0; i < index.length; v += 3, i += 6) {
    index.set([v, v + 1, v + 2, v + 2, v + 1, v], i);
  }
  geometry.setIndex(new THREE.BufferAttribute(index, 1));

  const size = n * CELL;
  const root = attribute("root", "vec2");
  const seed = attribute("seed", "float");
  const at = root.add(size / 2).div(size); // world x/z -> texel
  const texel = mix(texture(prev, at).level(float(0)), texture(flora, at).level(float(0)), blend);
  const grow = smoothstep(seed.sub(0.05), seed.add(0.05), texel.a); // 0: blade collapsed
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.9 });
  material.positionNode = vec3(root.x, 0, root.y).add(positionLocal.mul(grow));
  const shade = mix(float(0.7), float(1.15), positionLocal.y.div(BLADE_HEIGHT[1])); // dark base
  material.colorNode = texel.rgb.mul(shade);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false; // positions are made in the shader
  return mesh;
}
