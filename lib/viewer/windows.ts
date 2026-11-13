import * as THREE from "three";
import type { FloorData, Polygon, UnitData, WindowType } from "../types";
import { facadeBox, pointInPolygon, signedArea } from "./geometry";

const DEFAULT_WINDOW: WindowType = { w: 2, h: 2.7, panels: [1, 1], bar: 1, door: false };

/** A window snapped to a unit's façade edge. */
export interface WindowPlacement {
  cx: number;
  cy: number;
  ux: number;
  uy: number;
  nx: number;
  ny: number;
  angle: number;
  w: number;
  type: WindowType;
}

interface Edge {
  unit: UnitData;
  ax: number;
  ay: number;
  ux: number;
  uy: number;
  len: number;
  nx: number;
  ny: number;
  items: { t: number; type: WindowType; w?: number }[];
}

/**
 * Assigns each opening of the floor drawing (window marks with a position) to the closest
 * exterior edge of a unit, then spaces the windows along that edge so they do not overlap.
 */
export function placeWindows(floor: FloorData, occluders: Polygon[], types: Record<string, WindowType>) {
  const result = new Map<UnitData, WindowPlacement[]>(floor.units.map((u) => [u, []]));
  const edges: Edge[] = [];
  for (const unit of floor.units) {
    const poly = unit.polygon;
    const ccw = signedArea(poly) > 0;
    for (let i = 0; i < poly.length; i++) {
      const [ax, ay] = poly[i];
      const [bx, by] = poly[(i + 1) % poly.length];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 0.8) continue;
      const ux = (bx - ax) / len;
      const uy = (by - ay) / len;
      edges.push({ unit, ax, ay, ux, uy, len, nx: ccw ? uy : -uy, ny: ccw ? -ux : ux, items: [] });
    }
  }

  for (const op of floor.openings || []) {
    const type = types[op.mark] || DEFAULT_WINDOW;
    let best: { d: number; e: Edge; t: number } | null = null;
    for (const e of edges) {
      const t = Math.max(0, Math.min(e.len, (op.x - e.ax) * e.ux + (op.y - e.ay) * e.uy));
      const fx = e.ax + e.ux * t;
      const fy = e.ay + e.uy * t;
      const side = (op.x - fx) * e.nx + (op.y - fy) * e.ny;
      let d = Math.hypot(op.x - fx, op.y - fy);
      if (d > 3.2) continue;
      // edge is interior if the point just outside it lies in another unit / core
      if (occluders.some((p) => p !== e.unit.polygon && pointInPolygon(fx + e.nx * 0.75, fy + e.ny * 0.75, p))) continue;
      if (side < -0.2) d += 1.5;
      if (e.len < type.w * 0.6) d += 2;
      if (!best || d < best.d) best = { d, e, t };
    }
    if (best) best.e.items.push({ t: best.t, type });
  }

  for (const e of edges) {
    if (!e.items.length) continue;
    e.items.sort((a, b) => a.t - b.t);
    const need = e.items.reduce((s, it) => s + it.type.w, 0) + 0.25 * (e.items.length + 1);
    const scale = need > e.len ? e.len / need : 1;
    let min = 0.12;
    for (const it of e.items) {
      it.w = it.type.w * scale;
      it.t = Math.max(it.t, min + it.w / 2);
      min = it.t + it.w / 2 + 0.2 * scale;
    }
    let max = e.len - 0.12;
    for (let i = e.items.length - 1; i >= 0; i--) {
      const it = e.items[i];
      it.t = Math.min(it.t, max - it.w / 2);
      max = it.t - it.w / 2 - 0.2 * scale;
    }
    for (const it of e.items)
      result.get(e.unit).push({
        cx: e.ax + e.ux * it.t,
        cy: e.ay + e.uy * it.t,
        ux: e.ux,
        uy: e.uy,
        nx: e.nx,
        ny: e.ny,
        angle: Math.atan2(e.uy, e.ux),
        w: it.w,
        type: it.type,
      });
  }
  return result;
}

/** Glass pane, frame (with transom and mullions) and the two side fins of one window. */
export function buildWindow(
  win: WindowPlacement,
  base: number,
  wallHeight: number,
  glass: THREE.BufferGeometry[],
  frames: THREE.BufferGeometry[],
  fins: THREE.BufferGeometry[],
) {
  const h = Math.min(win.type.h, wallHeight - 0.05);
  const bar = 0.07;
  const along = (o: number) => [win.cx + win.ux * o, win.cy + win.uy * o];
  const frame = (o: number, w: number, y: number, fh: number) => {
    const [x, yy] = along(o);
    frames.push(facadeBox(x, yy, win.nx, win.ny, win.angle, w, fh, 0.12, y, 0.07));
  };

  glass.push(facadeBox(win.cx, win.cy, win.nx, win.ny, win.angle, win.w - bar, h - bar, 0.08, base + h / 2, 0.04));
  frame(0, win.w, base + bar / 2, bar);
  frame(0, win.w, base + h - bar / 2, bar);
  frame(0, win.w, base + Math.min(win.type.bar, h - 0.3), bar);
  frame(-win.w / 2 + bar / 2, bar, base + h / 2, h);
  frame(win.w / 2 - bar / 2, bar, base + h / 2, h);

  const total = win.type.panels.reduce((s, p) => s + p, 0);
  let o = -win.w / 2;
  for (let i = 0; i < win.type.panels.length - 1; i++) {
    o += (win.type.panels[i] / total) * win.w;
    frame(o, bar, base + h / 2, h);
  }

  for (const side of [-1, 1]) {
    const [x, y] = along(side * (win.w / 2 + 0.07));
    fins.push(facadeBox(x, y, win.nx, win.ny, win.angle, 0.14, wallHeight, 0.26, base + wallHeight / 2, 0.12));
  }
}
