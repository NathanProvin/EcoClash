import * as THREE from "three/webgpu";
import { expect, it } from "vitest";
import { drape } from "./terrain";

it("drapes a flat mesh over the ground, wherever it is moved, turned or scaled (D-097)", () => {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2, 4, 4).rotateX(-Math.PI / 2));
  mesh.position.set(5, 2, -3);
  mesh.rotation.y = 0.7;
  mesh.scale.set(3, 1, 3);
  const ground = (x: number, z: number) => 0.5 * x - 0.2 * z;
  drape(mesh, ground, 0.1);
  mesh.updateMatrixWorld();
  const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    expect(v.y).toBeCloseTo(ground(v.x, v.z) + 0.1, 5);
  }
});
