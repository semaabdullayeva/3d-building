import * as THREE from "three";
import type { Point } from "../types";
import { lightPoolTexture } from "./daylight";
import { distToOutline, matte, mergedStaticMesh, planToWorld, ribbonGeometry } from "./geometry";

export interface Road {
  path: Point[];
  width: number;
  closed: boolean;
  /** sidewalks on both sides (the ring road already has its own outer sidewalk) */
  sidewalks: boolean;
  /** which side gets street lights: 1 = left of travel, -1 = right, 0 = both */
  lightSide: 1 | -1 | 0;
}

const unit = (x: number, y: number): Point => {
  const l = Math.hypot(x, y) || 1;
  return [x / l, y / l];
};

/** Direction and left normal at every vertex of a polyline. */
function frames(pts: Point[], closed: boolean) {
  const n = pts.length;
  return pts.map((p, i) => {
    const a = closed ? pts[(i + n - 1) % n] : pts[Math.max(0, i - 1)];
    const b = closed ? pts[(i + 1) % n] : pts[Math.min(n - 1, i + 1)];
    const dir = unit(b[0] - a[0], b[1] - a[1]);
    return { p, dir, nrm: [-dir[1], dir[0]] as Point };
  });
}

/** The polyline moved sideways by `d` (positive = left of travel). */
function offsetPath(pts: Point[], d: number, closed: boolean): Point[] {
  return frames(pts, closed).map(({ p, nrm }) => [p[0] + nrm[0] * d, p[1] + nrm[1] * d]);
}

/** Splits a polyline into the runs whose points are not `cut`. */
export function runs(pts: Point[], cut: (x: number, y: number) => boolean): Point[][] {
  const out: Point[][] = [];
  let cur: Point[] = [];
  for (const p of pts) {
    if (cut(p[0], p[1])) {
      if (cur.length > 1) out.push(cur);
      cur = [];
    } else cur.push(p);
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

/** Vertical face along a polyline from height y0 to y1. */
function wallStrip(pts: Point[], y0: number, y1: number) {
  const pos: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    pos.push(ax, y0, -ay, bx, y0, -by, ax, y1, -ay, bx, y0, -by, bx, y1, -by, ax, y1, -ay);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** Raised kerb: top face plus both side faces. */
function kerb(run: Point[], width: number, h: number) {
  const fr = frames(run, false);
  const left = fr.map(({ p, nrm }) => [p[0] + (nrm[0] * width) / 2, p[1] + (nrm[1] * width) / 2] as Point);
  const right = fr.map(({ p, nrm }) => [p[0] - (nrm[0] * width) / 2, p[1] - (nrm[1] * width) / 2] as Point);
  return [ribbonGeometry(run, width, h), wallStrip(left, 0.02, h), wallStrip([...right].reverse(), 0.02, h)];
}

/** Points every `step` metres along a polyline, with the local frame. */
function stations(pts: Point[], step: number, start = step / 2) {
  const out: { p: Point; dir: Point; nrm: Point }[] = [];
  let next = start;
  let run = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (run + len >= next) {
      const t = (next - run) / len;
      const dir = unit(b[0] - a[0], b[1] - a[1]);
      out.push({ p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], dir, nrm: [-dir[1], dir[0]] });
      next += step;
    }
    run += len;
  }
  return out;
}

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const up = new THREE.Vector3(0, 1, 0);
const one = new THREE.Vector3(1, 1, 1);

/**
 * Street dressing for the road network: kerbs, edge lines, sidewalks, zebra crossings,
 * street lights, benches and litter bins. Kerbs and sidewalks stop where another road joins.
 */
export function buildStreets(scene: THREE.Object3D, roads: Road[], crossings: { p: Point; dir: Point; width: number }[]) {
  const nearOtherRoad = (self: Road, x: number, y: number, pad: number) =>
    roads.some((r) => r !== self && distToOutline(x, y, r.path, r.closed) < r.width / 2 + pad);

  const kerbs: THREE.BufferGeometry[] = [];
  const lines: THREE.BufferGeometry[] = [];
  const walks: THREE.BufferGeometry[] = [];
  const lampSpots: { p: Point; towardRoad: Point }[] = [];
  const benchSpots: { p: Point; facing: Point }[] = [];
  const binSpots: Point[] = [];

  for (const road of roads) {
    for (const side of [1, -1]) {
      const kerbLine = offsetPath(road.path, side * (road.width / 2 + 0.12), road.closed);
      const kerbRun = road.closed ? kerbLine.concat([kerbLine[0]]) : kerbLine;
      for (const r of runs(kerbRun, (x, y) => nearOtherRoad(road, x, y, 0.6))) kerbs.push(...kerb(r, 0.24, 0.15));

      const edge = offsetPath(road.path, side * (road.width / 2 - 0.35), road.closed);
      const edgeRun = road.closed ? edge.concat([edge[0]]) : edge;
      for (const r of runs(edgeRun, (x, y) => nearOtherRoad(road, x, y, 0.2))) lines.push(ribbonGeometry(r, 0.13, 0.085));

      if (road.sidewalks) {
        const walk = offsetPath(road.path, side * (road.width / 2 + 1.35), road.closed);
        for (const r of runs(walk, (x, y) => nearOtherRoad(road, x, y, 1.4))) walks.push(ribbonGeometry(r, 2.2, 0.15));
      }

      // lights stand at the outer edge of the sidewalk and lean their arm over the road
      if (road.lightSide === 0 || road.lightSide === side) {
        const lampLine = offsetPath(road.path, side * (road.width / 2 + 2.25), road.closed);
        for (const s of stations(road.closed ? lampLine.concat([lampLine[0]]) : lampLine, 26, side > 0 ? 6 : 19)) {
          if (nearOtherRoad(road, s.p[0], s.p[1], 3)) continue;
          lampSpots.push({ p: s.p, towardRoad: [-s.nrm[0] * side, -s.nrm[1] * side] });
        }
      }
      // a bench and a bin between every few lights on roads with sidewalks
      if (road.sidewalks || road.closed) {
        const benchLine = offsetPath(road.path, side * (road.width / 2 + 2.25), road.closed);
        for (const s of stations(road.closed ? benchLine.concat([benchLine[0]]) : benchLine, 78, 32)) {
          if (nearOtherRoad(road, s.p[0], s.p[1], 4)) continue;
          if (road.closed && side !== road.lightSide) continue; // the ring road's inner side is the courtyard edge
          benchSpots.push({ p: s.p, facing: [-s.nrm[0] * side, -s.nrm[1] * side] });
          binSpots.push([s.p[0] + s.dir[0] * 1.6, s.p[1] + s.dir[1] * 1.6]);
        }
      }
    }
  }

  scene.add(mergedStaticMesh(kerbs, matte(0xd9d6cf), false));
  scene.add(mergedStaticMesh(lines, matte(0xf1f1ec), false));
  if (walks.length) scene.add(mergedStaticMesh(walks, matte(0xcfccc4), false));

  // zebra crossings: stripes running along the road, laid across its width
  {
    const stripes: THREE.BufferGeometry[] = [];
    for (const c of crossings) {
      const across: Point = [-c.dir[1], c.dir[0]];
      const n = Math.floor((c.width - 1) / 1.0);
      for (let i = 0; i < n; i++) {
        const o = (i - (n - 1) / 2) * 1.0;
        const g = new THREE.BoxGeometry(3, 0.02, 0.5);
        g.rotateY(Math.atan2(c.dir[1], c.dir[0]));
        g.translate(c.p[0] + across[0] * o, 0.09, -(c.p[1] + across[1] * o));
        stripes.push(g);
      }
    }
    if (stripes.length) scene.add(mergedStaticMesh(stripes, matte(0xf3f3ee), false));
  }

  addLamps(scene, lampSpots);
  addBenches(scene, benchSpots, binSpots);
}

/** Street lights: tapered pole, arm over the road and a lit lamp head. */
function addLamps(scene: THREE.Object3D, spots: { p: Point; towardRoad: Point }[]) {
  if (!spots.length) return;
  const H = 7;
  const pole = new THREE.CylinderGeometry(0.06, 0.1, H, 8).translate(0, H / 2, 0);
  const base = new THREE.CylinderGeometry(0.16, 0.2, 0.5, 8).translate(0, 0.25, 0);
  const arm = new THREE.BoxGeometry(0.07, 0.07, 1.6).translate(0, H - 0.1, 0.75);
  const poles = new THREE.InstancedMesh(mergeAll([pole, base, arm]), new THREE.MeshStandardMaterial({ color: 0x3a3d40, roughness: 0.5, metalness: 0.4 }), spots.length);
  const heads = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.28, 0.12, 0.62).translate(0, H - 0.18, 1.5),
    new THREE.MeshStandardMaterial({ color: 0xfff6dd, emissive: 0xffe2a8, emissiveIntensity: 0.9, roughness: 0.3 }),
    spots.length,
  );
  spots.forEach((s, i) => {
    // local +z must point over the road: rotate +z onto the plan direction
    const yaw = Math.atan2(s.towardRoad[0], -s.towardRoad[1]);
    m4.compose(planToWorld(s.p[0], s.p[1], 0.15), q.setFromAxisAngle(up, yaw), one);
    poles.setMatrixAt(i, m4);
    heads.setMatrixAt(i, m4);
  });
  poles.castShadow = true;
  heads.material.userData.lamp = heads.material.emissiveIntensity;
  scene.add(poles, heads);
  // the light spreads along the road more than across it
  addLightPools(
    scene,
    spots.map((s) => ({
      p: [s.p[0] + s.towardRoad[0] * 2, s.p[1] + s.towardRoad[1] * 2] as Point,
      yaw: Math.atan2(s.towardRoad[0], -s.towardRoad[1]),
    })),
    0.2,
    8,
    1.45,
    0.5,
  );
}

/**
 * Warm light on the ground under lamps: additive, softly fading patches, shown only at night
 * (the viewer finds them by `userData.night` and scales `userData.strength` with the dusk).
 */
function addLightPools(
  scene: THREE.Object3D,
  spots: { p: Point; yaw: number }[],
  h: number,
  radius: number,
  stretch: number,
  strength: number,
) {
  const pools = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(radius * 2, radius * 2).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      map: lightPoolTexture(),
      color: 0xf2b170,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }),
    spots.length,
  );
  const s = new THREE.Vector3(stretch, 1, 1);
  spots.forEach(({ p: [x, y], yaw }, i) => {
    m4.compose(planToWorld(x, y, h), q.setFromAxisAngle(up, yaw), s);
    pools.setMatrixAt(i, m4);
  });
  pools.userData.night = true;
  pools.userData.strength = strength;
  pools.userData.noAO = true;
  pools.visible = false;
  pools.renderOrder = 2;
  scene.add(pools);
}

/** Courtyard lights: short dark post with a glowing globe on top, standing at height `h`. */
export function addParkLamps(scene: THREE.Object3D, spots: Point[], h: number) {
  if (!spots.length) return;
  const H = 3.4;
  const post = new THREE.CylinderGeometry(0.045, 0.07, H, 8).translate(0, H / 2, 0);
  const foot = new THREE.CylinderGeometry(0.13, 0.16, 0.35, 8).translate(0, 0.175, 0);
  const cap = new THREE.CylinderGeometry(0.2, 0.08, 0.1, 10).translate(0, H + 0.42, 0);
  const posts = new THREE.InstancedMesh(
    mergeAll([post, foot, cap]),
    new THREE.MeshStandardMaterial({ color: 0x2f3236, roughness: 0.5, metalness: 0.4 }),
    spots.length,
  );
  const globes = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.2, 14, 10).translate(0, H + 0.18, 0),
    new THREE.MeshStandardMaterial({ color: 0xfff8e6, emissive: 0xffe0a0, emissiveIntensity: 1.1, roughness: 0.2 }),
    spots.length,
  );
  spots.forEach(([x, y], i) => {
    m4.compose(planToWorld(x, y, h), q.identity(), one);
    posts.setMatrixAt(i, m4);
    globes.setMatrixAt(i, m4);
  });
  posts.castShadow = true;
  globes.material.userData.lamp = globes.material.emissiveIntensity;
  scene.add(posts, globes);
  addLightPools(scene, spots.map((p) => ({ p, yaw: 0 })), h + 0.06, 5.5, 1, 0.55);
}

/** Park benches facing the road and small litter bins beside them. */
function addBenches(scene: THREE.Object3D, benches: { p: Point; facing: Point }[], bins: Point[]) {
  if (benches.length) {
    const seat = new THREE.BoxGeometry(1.8, 0.06, 0.45).translate(0, 0.45, 0);
    const back = new THREE.BoxGeometry(1.8, 0.45, 0.06).translate(0, 0.75, -0.2);
    const legs = [-0.75, 0.75].map((x) => new THREE.BoxGeometry(0.06, 0.45, 0.4).translate(x, 0.22, 0));
    const wood = new THREE.InstancedMesh(mergeAll([seat, back]), matte(0x8a6242), benches.length);
    const iron = new THREE.InstancedMesh(mergeAll(legs), matte(0x2f3134), benches.length);
    benches.forEach((b, i) => {
      const yaw = Math.atan2(b.facing[0], -b.facing[1]);
      m4.compose(planToWorld(b.p[0], b.p[1], 0.15), q.setFromAxisAngle(up, yaw), one);
      wood.setMatrixAt(i, m4);
      iron.setMatrixAt(i, m4);
    });
    wood.castShadow = iron.castShadow = true;
    scene.add(wood, iron);
  }
  if (bins.length) {
    const bin = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.2, 0.8, 10).translate(0, 0.4, 0), matte(0x45604f), bins.length);
    bins.forEach((p, i) => bin.setMatrixAt(i, m4.compose(planToWorld(p[0], p[1], 0.15), q.identity(), one)));
    bin.castShadow = true;
    scene.add(bin);
  }
}

function mergeAll(geos: THREE.BufferGeometry[]) {
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  for (const p of parts) for (const k of Object.keys(p.attributes)) if (k !== "position" && k !== "normal") p.deleteAttribute(k);
  const pos: number[] = [];
  const nor: number[] = [];
  for (const p of parts) {
    pos.push(...(p.attributes.position.array as Float32Array));
    nor.push(...(p.attributes.normal.array as Float32Array));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  return g;
}
