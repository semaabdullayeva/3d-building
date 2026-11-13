import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Point, Polygon } from "../types";

// Plan coordinates are (x east, y north); the scene uses (x, height, -y).
export const planToWorld = (x: number, y: number, h = 0) => new THREE.Vector3(x, h, -y);

/** mulberry32 – small deterministic PRNG so the generated landscape is stable. */
export function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pointInPolygon(x: number, y: number, poly: Polygon) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / len2)) : 0;
  return Math.hypot(px - ax - t * (bx - ax), py - ay - t * (by - ay));
}

/** Distance from a point to a polygon outline (closed) or polyline (open). */
export function distToOutline(x: number, y: number, pts: Point[], closed = true) {
  let d = Infinity;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    d = Math.min(d, distToSegment(x, y, a[0], a[1], b[0], b[1]));
  }
  return d;
}

/** Signed area (positive = counter-clockwise). */
export function signedArea(poly: Polygon) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

export function centroid(poly: Polygon): Point {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    const c = x1 * y2 - x2 * y1;
    a += c;
    cx += (x1 + x2) * c;
    cy += (y1 + y2) * c;
  }
  return [cx / (3 * a), cy / (3 * a)];
}

/** Andrew's monotone chain convex hull. */
export function convexHull(points: Point[]): Point[] {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Point[] = [];
  const upper: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  for (const p of pts.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

export const normalize2 = (v: Point): Point => {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
};

/** Offsets a (convex, CCW) polygon outward by `dist`, dropping very short edges first. */
export function offsetPolygon(poly: Polygon, dist: number): Polygon {
  const pts = poly.filter((p, i) => {
    const q = poly[(i + 1) % poly.length];
    return Math.hypot(p[0] - q[0], p[1] - q[1]) > 2;
  });
  const n = pts.length;
  const out: Polygon = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[(i + n - 1) % n];
    const cur = pts[i];
    const next = pts[(i + 1) % n];
    const n1 = normalize2([cur[1] - prev[1], -(cur[0] - prev[0])]);
    const n2 = normalize2([next[1] - cur[1], -(next[0] - cur[0])]);
    const bis = normalize2([n1[0] + n2[0], n1[1] + n2[1]]);
    const k = dist / Math.max(0.5, bis[0] * n1[0] + bis[1] * n1[1]);
    out.push([cur[0] + bis[0] * k, cur[1] + bis[1] * k]);
  }
  return out;
}

/** Resamples a polyline as a smooth Catmull-Rom curve with roughly `step` metre spacing. */
export function smoothPath(pts: Point[], closed: boolean, step = 2.5): Point[] {
  const curve = new THREE.CatmullRomCurve3(
    pts.map((p) => new THREE.Vector3(p[0], 0, p[1])),
    closed,
    "centripetal",
  );
  return curve.getSpacedPoints(Math.max(8, Math.round(curve.getLength() / step))).map((v) => [v.x, v.z] as Point);
}

/** Flat ribbon (road, path, kerb) of width `width` along a plan polyline at height `h`. */
export function ribbonGeometry(pts: Point[], width: number, h: number) {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const dir = normalize2([b[0] - a[0], b[1] - a[1]]);
    const ox = (-dir[1] * width) / 2;
    const oy = (dir[0] * width) / 2;
    pos.push(pts[i][0] + ox, h, -(pts[i][1] + oy), pts[i][0] - ox, h, -(pts[i][1] - oy));
    if (i) {
      const k = i * 2;
      idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g.toNonIndexed();
}

/** Extrudes a plan polygon upward from `base` by `depth` metres. */
export function extrudePolygon(poly: Polygon, base: number, depth: number) {
  const shape = new THREE.Shape(poly.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  g.translate(0, base, 0);
  return g;
}

/** Radially grows (or shrinks with negative `d`) a polygon around its vertex mean. */
export function inflate(poly: Polygon, d: number): Polygon {
  const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
  const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
  return poly.map(([x, y]) => {
    const l = Math.hypot(x - cx, y - cy) || 1;
    return [x + ((x - cx) / l) * d, y + ((y - cy) / l) * d] as Point;
  });
}

/** Symmetric bounding box of a polygon around the local origin. */
export function symmetricBox(poly: Polygon) {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  const x = Math.max(Math.max(...xs), -Math.min(...xs));
  const y = Math.max(Math.max(...ys), -Math.min(...ys));
  return {
    x,
    y,
    poly: [
      [-x, -y],
      [x, -y],
      [x, y],
      [-x, y],
    ] as Polygon,
  };
}

/**
 * Box placed on a façade: centre (x, y) in plan, pushed out along the façade normal
 * (nx, ny) by `out`, rotated to `angle`, with size (w, h, d) and vertical centre `cy`.
 */
export function facadeBox(
  x: number,
  y: number,
  nx: number,
  ny: number,
  angle: number,
  w: number,
  h: number,
  d: number,
  cy: number,
  out: number,
) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.rotateY(angle);
  g.translate(x + nx * out, cy, -(y + ny * out));
  return g;
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);

/** Same placement as facadeBox(), but as a matrix for an instance of a unit box (see instancedBoxes). */
export function facadeBoxMatrix(
  px: number,
  py: number,
  nx: number,
  ny: number,
  angle: number,
  along: number,
  height: number,
  depth: number,
  yCenter: number,
  out: number,
) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(px + nx * out, yCenter, -(py + ny * out)),
    new THREE.Quaternion().setFromAxisAngle(Y_AXIS, angle),
    new THREE.Vector3(along, height, depth),
  );
}

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

/** One InstancedMesh of unit boxes: window panes, frame bars… – one draw call for all of them. */
export function instancedBoxes<M extends THREE.Material>(matrices: THREE.Matrix4[], material: M) {
  const mesh = new THREE.InstancedMesh(UNIT_BOX, material, matrices.length);
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  return mesh;
}

export interface FacadeBay {
  cx: number;
  cy: number;
  sx: number;
  sy: number;
  ex: number;
  ey: number;
  nx: number;
  ny: number;
  angle: number;
  w: number;
  index: number;
  count: number;
  first: boolean;
  last: boolean;
  edgeLength: number;
}

/**
 * Splits every exterior edge of `poly` into bays of about `bayWidth` metres and calls `cb`
 * for each bay that is not covered by one of the `neighbours` polygons.
 */
export function forEachFacadeBay(poly: Polygon, neighbours: Polygon[], bayWidth: number, cb: (bay: FacadeBay) => void) {
  const ccw = signedArea(poly) > 0;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[(i + 1) % poly.length];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < 0.9) continue;
    const ux = dx / len;
    const uy = dy / len;
    const nx = ccw ? uy : -uy;
    const ny = ccw ? -ux : ux;
    const angle = Math.atan2(uy, ux);
    const count = Math.max(1, Math.round(len / bayWidth));
    const w = len / count;
    const open: boolean[] = [];
    for (let k = 0; k < count; k++) {
      const px = ax + ux * w * (k + 0.5) + nx * 0.75;
      const py = ay + uy * w * (k + 0.5) + ny * 0.75;
      open.push(!neighbours.some((p) => pointInPolygon(px, py, p)));
    }
    for (let k = 0; k < count; k++) {
      if (!open[k]) continue;
      cb({
        cx: ax + ux * w * (k + 0.5),
        cy: ay + uy * w * (k + 0.5),
        sx: ax + ux * w * k,
        sy: ay + uy * w * k,
        ex: ax + ux * w * (k + 1),
        ey: ay + uy * w * (k + 1),
        nx,
        ny,
        angle,
        w,
        index: k,
        count,
        first: k === 0 || !open[k - 1],
        last: k === count - 1 || !open[k + 1],
        edgeLength: len,
      });
    }
  }
}

/** Merges geometries into a single mesh and disposes the parts. Returns null for an empty list. */
export function mergedMesh(geos: THREE.BufferGeometry[], material: THREE.Material) {
  if (!geos.length) return null;
  const mesh = new THREE.Mesh(mergeGeometries(geos, false), material);
  geos.forEach((g) => g.dispose());
  return mesh;
}

/** Like mergedMesh but converts indexed parts first and turns on shadows. */
export function mergedStaticMesh(geos: THREE.BufferGeometry[], material: THREE.Material, castShadow = true) {
  // plain-coloured parts: keep only position and normal so that shapes from different sources can be merged
  const parts = geos.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (k !== "position" && k !== "normal") n.deleteAttribute(k);
    return n;
  });
  const mesh = new THREE.Mesh(mergeGeometries(parts, false), material);
  if (castShadow) mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export const matte = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 1, ...extra });
