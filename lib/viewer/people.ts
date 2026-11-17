import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { planToWorld } from "./geometry";

/** Where a figure stands: plan position, ground height, facing (radians, plan angle) and size factor. */
export interface Placement {
  x: number;
  y: number;
  h: number;
  heading: number;
  scale: number;
}

const SHIRTS = [0xd94f45, 0x3b6ea5, 0xf2c14e, 0x2e8b57, 0xf4f1ea, 0x6c5b7b, 0xe07a5f, 0x264653, 0xa8dadc, 0x2b2d31, 0xf4a261, 0x8ab17d];
const PANTS = [0x2b2d42, 0x3d405b, 0x5c4033, 0x1d3557, 0x6b705c, 0x222222, 0xc9b79c, 0x4a5a6a];
const SKIN = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0xd9a47a];
const HAIR = [0x2c1b10, 0x4a3121, 0x111111, 0x8b5a2b, 0xb5b5b5, 0xd8b26e];
const FUR = [0xd9822b, 0x222222, 0x8a8a8a, 0xf2efe8, 0x5b4636, 0xc9a67a];

/** Low-poly figure parts in local space: feet at y = 0, facing +z. */
function personParts() {
  const at = (g: THREE.BufferGeometry, x: number, y: number, z = 0, rz = 0) => {
    if (rz) g.rotateZ(rz);
    return g.translate(x, y, z);
  };
  const legs = mergeGeometries([
    at(new THREE.CylinderGeometry(0.075, 0.065, 0.82, 7), -0.09, 0.41),
    at(new THREE.CylinderGeometry(0.075, 0.065, 0.82, 7), 0.09, 0.41),
  ]);
  const torso = new THREE.CapsuleGeometry(0.17, 0.42, 3, 8);
  torso.scale(1, 1, 0.68);
  const upper = mergeGeometries([
    at(torso, 0, 1.12),
    at(new THREE.CylinderGeometry(0.05, 0.045, 0.62, 6), -0.24, 1.08, 0, 0.09),
    at(new THREE.CylinderGeometry(0.05, 0.045, 0.62, 6), 0.24, 1.08, 0, -0.09),
  ]);
  const head = at(new THREE.SphereGeometry(0.11, 10, 8), 0, 1.6);
  const hair = at(new THREE.SphereGeometry(0.117, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), 0, 1.615, -0.01);
  return { legs, upper, head, hair };
}

/** One merged low-poly cat in local space: paws at y = 0, facing +z. */
function catGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const body = new THREE.CapsuleGeometry(0.075, 0.24, 3, 8);
  body.rotateX(Math.PI / 2);
  parts.push(body.translate(0, 0.19, 0));
  parts.push(new THREE.SphereGeometry(0.068, 10, 8).translate(0, 0.27, 0.2));
  for (const s of [-1, 1]) {
    const ear = new THREE.ConeGeometry(0.025, 0.06, 4);
    ear.rotateZ(-s * 0.25);
    parts.push(ear.translate(s * 0.035, 0.34, 0.2));
  }
  for (const [x, z] of [[-0.05, 0.12], [0.05, 0.12], [-0.05, -0.12], [0.05, -0.12]]) {
    parts.push(new THREE.CylinderGeometry(0.018, 0.016, 0.14, 5).translate(x, 0.07, z));
  }
  const tail = new THREE.CylinderGeometry(0.016, 0.012, 0.28, 5);
  tail.rotateX(-0.6);
  parts.push(tail.translate(0, 0.3, -0.27));
  return mergeGeometries(parts);
}

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const up = new THREE.Vector3(0, 1, 0);
const color = new THREE.Color();

function instanced(geo: THREE.BufferGeometry, count: number) {
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }), count);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// plan heading -> rotation about the world Y axis for a model that faces +z
const yaw = (heading: number) => Math.PI / 2 + heading;

/** Adds standing people at the given spots, each with its own clothing, skin and hair colours. */
export function addPeople(scene: THREE.Object3D, spots: Placement[], rand: () => number) {
  if (!spots.length) return;
  const parts = personParts();
  const meshes = {
    legs: instanced(parts.legs, spots.length),
    upper: instanced(parts.upper, spots.length),
    head: instanced(parts.head, spots.length),
    hair: instanced(parts.hair, spots.length),
  };
  const pick = (list: number[]) => list[Math.floor(rand() * list.length)];
  spots.forEach((s, i) => {
    const k = s.scale;
    m4.compose(planToWorld(s.x, s.y, s.h), q.setFromAxisAngle(up, yaw(s.heading)), new THREE.Vector3(k, k, k));
    for (const mesh of Object.values(meshes)) mesh.setMatrixAt(i, m4);
    meshes.legs.setColorAt(i, color.setHex(pick(PANTS)));
    meshes.upper.setColorAt(i, color.setHex(pick(SHIRTS)));
    meshes.head.setColorAt(i, color.setHex(pick(SKIN)));
    meshes.hair.setColorAt(i, color.setHex(pick(HAIR)));
  });
  for (const mesh of Object.values(meshes)) scene.add(mesh);
}

/** Adds cats at the given spots in assorted fur colours. */
export function addCats(scene: THREE.Object3D, spots: Placement[], rand: () => number) {
  if (!spots.length) return;
  const mesh = instanced(catGeometry(), spots.length);
  spots.forEach((s, i) => {
    const k = s.scale;
    m4.compose(planToWorld(s.x, s.y, s.h), q.setFromAxisAngle(up, yaw(s.heading)), new THREE.Vector3(k, k, k));
    mesh.setMatrixAt(i, m4);
    mesh.setColorAt(i, color.setHex(FUR[Math.floor(rand() * FUR.length)]));
  });
  scene.add(mesh);
}
