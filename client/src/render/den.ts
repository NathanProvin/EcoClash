// Den models (D-245, D-251): a low-poly earth mound with a dark entrance for a land den, a stick
// lodge for a water den, ringed in the owner's colour. Every bought animal comes out there, and
// losing the land den loses the match.

import * as THREE from "three/webgpu";
import { CELL } from "./layout";

/** Mound radius and height, entrance size, lodge size (m); colours. */
const DEN = {
  mound: 0.42 * CELL,
  height: 0.22 * CELL,
  hole: 0.12 * CELL,
  lodge: 0.32 * CELL,
  earth: "#7a5a3a",
  hole_color: "#1c120a",
  sticks: "#5e4a33",
} as const;

const flat = (color: string) =>
  new THREE.MeshStandardNodeMaterial({ color, roughness: 0.95, flatShading: true });

/** One den model, its base at the origin; `tint` is the owner's colour (a ring at its foot). */
export function denModel(water: boolean, tint: string): THREE.Group {
  const g = new THREE.Group();
  if (water) {
    const lodge = new THREE.Mesh(
      new THREE.ConeGeometry(DEN.lodge, DEN.lodge * 1.1, 7, 2),
      flat(DEN.sticks),
    );
    lodge.position.y = DEN.lodge * 0.55;
    g.add(lodge);
  } else {
    const mound = new THREE.Mesh(
      new THREE.SphereGeometry(DEN.mound, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2),
      flat(DEN.earth),
    );
    mound.scale.y = DEN.height / DEN.mound;
    g.add(mound);
    const hole = new THREE.Mesh(new THREE.CircleGeometry(DEN.hole, 7), flat(DEN.hole_color));
    hole.position.set(0, DEN.height * 0.45, DEN.mound * 0.8);
    hole.rotation.x = -0.35;
    g.add(hole);
  }
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(DEN.mound * 1.05, DEN.mound * 1.2, 16),
    new THREE.MeshBasicNodeMaterial({ color: tint, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  g.add(ring);
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  return g;
}
