import * as THREE from "three";
import type { FloorData, GrassData, Polygon, Podium, SiteBlock, UnitData, WindowType } from "../types";
import {
  distToOutline,
  extrudePolygon,
  facadeBox,
  FacadeBay,
  forEachFacadeBay,
  inflate,
  matte,
  mergedMesh,
  mulberry32,
  pointInPolygon,
  signedArea,
  symmetricBox,
} from "./geometry";
import { buildWindow, placeWindows } from "./windows";
import type { GrassTuft, Vegetation } from "./vegetation";

export const PALETTE = {
  wall: 0xb57850,
  wallTop: 0x8a5438,
  fin: 0x8c5334,
  stone: 0xebe8e2,
  glass: 0x5f7f99,
  podiumStone: 0xddd3c4,
  podiumGlass: 0x4d6a82,
  louver: 0x5a3a2a,
  roof: 0xc9ccd0,
};

/** Highlight colours used by the viewer for unit walls and glazing. */
export const UNIT_COLORS = {
  unit: new THREE.Color(PALETTE.wall),
  unitTop: new THREE.Color(PALETTE.wallTop),
  glass: new THREE.Color(PALETTE.glass),
  dim: new THREE.Color(0xcfd2d6),
  dimGlass: new THREE.Color(0xaeb4bb),
  match: new THREE.Color(0x8fb0ff),
  hover: new THREE.Color(0x4f7dff),
  selected: new THREE.Color(0x2456e6),
};

const SLAB_THICKNESS = 0.3;
/** Tip-1 towers: floors from here up use the darker "top" colour and taller glazing. */
const TIP1_TOP_FLOOR = 14;

export interface Unit {
  data: UnitData;
  floor: FloorData;
  block: Block;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  edges: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  glass: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> | null;
  isTop: boolean;
  pending: boolean;
}

export interface Block {
  id: string;
  label: string;
  sub?: string;
  data: SiteBlock["data"];
  group: THREE.Group;
  units: Unit[];
  /** Per floor: its group and the non-unit meshes (slab, core, fins…) that fade with it. */
  floorGroups: Map<number, { group: THREE.Group; slabs: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[] }>;
  /** Frame / roof meshes hidden when a single floor is isolated. */
  shell: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[];
  center: THREE.Vector3;
  windows?: { floor: number; unit: string; x: number; y: number; ux: number; uy: number; w: number }[];
}

type StdMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;

function createMaterials() {
  return {
    slab: new THREE.MeshStandardMaterial({ color: PALETTE.stone, roughness: 0.85, transparent: true }),
    core: new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 0.9, transparent: true }),
    fin: new THREE.MeshStandardMaterial({ color: PALETTE.fin, roughness: 0.75, transparent: true }),
    shell: new THREE.MeshStandardMaterial({ color: PALETTE.stone, roughness: 0.85, transparent: true }),
    edges: new THREE.LineBasicMaterial({ color: 0x4a3324, transparent: true, opacity: 0.35 }),
    balconyGlass: new THREE.MeshStandardMaterial({ color: 0xe9eef2, roughness: 0.3, transparent: true, opacity: 0.45 }),
    rail: new THREE.MeshStandardMaterial({ color: 0xf3f1ec, roughness: 0.6, transparent: true }),
    windowFrame: new THREE.MeshStandardMaterial({ color: 0x3f3530, roughness: 0.6, transparent: true }),
  };
}

const shadowed = <T extends THREE.Mesh>(m: T, cast = true, receive = true) => {
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
};

const ccw = (p: Polygon) => (signedArea(p) > 0 ? p : p.slice().reverse());

/** Builds one residential tower (podium, frame, every floor with its units, roof). */
export function buildTower(
  site: SiteBlock,
  windowTypes: Record<string, WindowType>,
  materials = createMaterials(),
): { block: Block; units: Unit[] } {
  const d = site.data;
  const group = new THREE.Group();
  const [px, py] = site.position;
  const block: Block = {
    id: site.id,
    label: site.label || site.id,
    sub: site.sub,
    data: d,
    group,
    units: [],
    floorGroups: new Map(),
    shell: [],
    center: new THREE.Vector3(px, 27, -py),
  };
  const generic = d.shape === "generic";
  const topFrom = generic ? d.floorsTotal - 2 : TIP1_TOP_FLOOR;
  const box = symmetricBox(d.floors[0].footprint);
  const podiumTop = d.podium.level + d.podium.height;
  const roofLevel = d.roofLevel;
  const levelOf = (n: number) => (d.floors.find((f) => f.floor === n) || d.floors[d.floors.length - 1]).level;
  const shell = block.shell;

  // ---------- architectural frame ----------
  /** Box on side N/S/E/W of the symmetric footprint spanning [from, to] along it and [y0, y1] in height. */
  const sideBox = (side: string, from: number, to: number, y0: number, y1: number, depth: number, out = 0.2) => {
    const len = to - from;
    const h = y1 - y0;
    const mid = (from + to) / 2;
    let g: THREE.BoxGeometry;
    if (side === "N" || side === "S") {
      const s = side === "N" ? 1 : -1;
      g = new THREE.BoxGeometry(len, h, depth);
      g.translate(mid, (y0 + y1) / 2, -s * (box.y + out - depth / 2));
    } else {
      const s = side === "E" ? 1 : -1;
      g = new THREE.BoxGeometry(depth, h, len);
      g.translate(s * (box.x + out - depth / 2), (y0 + y1) / 2, -mid);
    }
    return g;
  };
  /** Two columns plus a crowning beam: a portal frame on one façade. */
  const portal = (list: THREE.BufferGeometry[], side: string, from: number, to: number, col: number, top: number, beam = 1.5, depth = 1.5) => {
    list.push(sideBox(side, from, from + col, podiumTop, top - beam, depth));
    list.push(sideBox(side, to - col, to, podiumTop, top - beam, depth));
    list.push(sideBox(side, from, to, top - beam, top, depth + 0.15, 0.3));
  };

  if (generic) {
    const parts: THREE.BufferGeometry[] = [];
    const slab = ccw(d.floors[0].slab);
    const n = slab.length;
    const top = levelOf(topFrom) + 1.3;
    for (let i = 0; i < n; i++) {
      const [ax, ay] = slab[(i + n - 1) % n];
      const [bx, by] = slab[i];
      const [cx, cy] = slab[(i + 1) % n];
      const lenIn = Math.hypot(bx - ax, by - ay);
      const lenOut = Math.hypot(cx - bx, cy - by);
      const convex = (bx - ax) * (cy - by) - (by - ay) * (cx - bx) > 0;
      const angle = Math.atan2(cy - by, cx - bx);
      if (convex && lenIn > 2.2 && lenOut > 2.2) {
        const column = new THREE.BoxGeometry(1.2, top - 1.5 - podiumTop, 1.2);
        column.rotateY(angle);
        column.translate(bx, (podiumTop + top - 1.5) / 2, -by);
        parts.push(column);
      }
      if (lenOut > 1.2) {
        const ux = (cx - bx) / lenOut;
        const uy = (cy - by) / lenOut;
        parts.push(facadeBox((bx + cx) / 2, (by + cy) / 2, uy, -ux, angle, lenOut + 0.7, 1.5, 0.9, top - 0.75, 0.1));
      }
    }
    const frame = shadowed(mergedMesh(parts, materials.shell.clone()) as StdMesh);
    group.add(frame);
    shell.push(frame);
  } else {
    const parts: THREE.BufferGeometry[] = [];
    const top = levelOf(14) + 1.3;
    const crown = levelOf(15) + 0.4;
    for (const side of ["N", "S"]) {
      portal(parts, side, -box.x - 0.15, -9.8, 1.3, top);
      portal(parts, side, 9.8, box.x + 0.15, 1.3, top);
      portal(parts, side, -4.05, 4.05, 1.35, crown);
    }
    for (const side of ["E", "W"]) {
      portal(parts, side, -box.y - 0.2, box.y + 0.2, 1, top, 1.5, 1.2);
      parts.push(sideBox(side, -0.22, 0.22, podiumTop, roofLevel + 1.5, 0.9, 0.35));
      parts.push(sideBox(side, -2.7, -2.4, podiumTop, top - 1.5, 0.7, 0.25));
      parts.push(sideBox(side, 2.4, 2.7, podiumTop, top - 1.5, 0.7, 0.25));
    }
    const frame = shadowed(mergedMesh(parts, materials.shell.clone()) as StdMesh);
    group.add(frame);
    shell.push(frame);
  }

  // ---------- podium (non-residential base) ----------
  {
    const pd = d.podium;
    const ph = pd.height;
    const outline = generic ? ccw(d.floors[0].slab) : box.poly;
    const extra = ph - 9.1; // podiums taller than the standard 9.1 m shift the bands up
    group.add(
      shadowed(
        new THREE.Mesh(
          extrudePolygon(outline, pd.level + 0.3, ph - 0.9),
          new THREE.MeshStandardMaterial({ color: PALETTE.podiumGlass, roughness: 0.3, metalness: 0.1 }),
        ),
      ),
    );
    const stone: THREE.BufferGeometry[] = [];
    const louvers: THREE.BufferGeometry[] = [];
    const mullions: THREE.BufferGeometry[] = [];
    const band = (b: FacadeBay, w: number, y0: number, y1: number, depth: number, out: number) =>
      facadeBox(b.cx, b.cy, b.nx, b.ny, b.angle, w, y1 - y0, depth, (y0 + y1) / 2, out);
    let bayCount = 0;
    forEachFacadeBay(outline, [], 4.1, (b) => {
      const endFacade = !generic && Math.abs(b.nx) > 0.9;
      const pier = (x: number, y: number) =>
        stone.push(facadeBox(x, y, b.nx, b.ny, b.angle, 0.7, ph - 0.3, 0.6, pd.level + 0.3 + (ph - 0.3) / 2, 0.25));
      pier(b.sx, b.sy);
      if (b.last) pier(b.ex, b.ey);
      if (endFacade && Math.abs(b.cy) > 3.5) {
        stone.push(band(b, b.w, pd.level + 0.3, ph, 0.3, 0.1));
        const n = Math.floor(b.w / 0.5);
        for (let i = 0; i < n; i++) {
          const f = (i + 0.5) / n - 0.5;
          mullions.push(
            facadeBox(
              b.cx + Math.cos(b.angle) * f * b.w,
              b.cy + Math.sin(b.angle) * f * b.w,
              b.nx,
              b.ny,
              b.angle,
              0.1,
              4.4,
              0.08,
              pd.level + 6.2 + extra,
              0.26,
            ),
          );
        }
        return;
      }
      stone.push(band(b, b.w, 3.4 + extra, 4 + extra, 0.4, 0.18));
      stone.push(band(b, 0.14, pd.level + 0.3, 8.5 + extra, 0.2, 0.1));
      if (!endFacade && bayCount++ % 3 === 1) {
        const n = Math.floor((b.w - 0.9) / 0.32);
        for (let i = 0; i < n; i++) {
          const f = (i + 0.5) / n - 0.5;
          louvers.push(
            facadeBox(
              b.cx + Math.cos(b.angle) * f * (b.w - 0.9),
              b.cy + Math.sin(b.angle) * f * (b.w - 0.9),
              b.nx,
              b.ny,
              b.angle,
              0.12,
              4.3,
              0.32,
              6.25 + extra,
              0.25,
            ),
          );
        }
      }
    });
    const stoneMat = new THREE.MeshStandardMaterial({ color: PALETTE.podiumStone, roughness: 0.9 });
    group.add(shadowed(mergedMesh(stone, stoneMat)));
    const mull = mergedMesh(mullions, new THREE.MeshStandardMaterial({ color: 0xc4b8a6, roughness: 1 }));
    if (mull) group.add(mull);
    const louv = mergedMesh(louvers, new THREE.MeshStandardMaterial({ color: PALETTE.louver, roughness: 0.7 }));
    if (louv) group.add(shadowed(louv, true, false));
    group.add(
      shadowed(new THREE.Mesh(extrudePolygon(generic ? outline : symmetricBox(inflate(outline, 0.45)).poly, ph - 0.6, 0.62), stoneMat)),
    );
  }

  // ---------- floors ----------
  const units: Unit[] = [];
  for (const fl of d.floors) {
    const fg = new THREE.Group();
    const slabs: StdMesh[] = [];
    const isTop = fl.floor >= topFrom;
    const wallH = fl.height - SLAB_THICKNESS;
    const base = fl.level + SLAB_THICKNESS;
    const mid = base + wallH / 2;
    const outline = generic ? ccw(fl.slab) : symmetricBox(fl.footprint).poly;
    const cores = fl.cores && fl.cores.length ? fl.cores : fl.core ? [fl.core] : [];

    const slab = shadowed(new THREE.Mesh(extrudePolygon(outline, fl.level, SLAB_THICKNESS), materials.slab.clone()));
    fg.add(slab);
    slabs.push(slab);
    for (const c of cores) {
      const m = new THREE.Mesh(extrudePolygon(c, base, wallH), materials.core.clone());
      fg.add(m);
      slabs.push(m);
    }

    const occluders = fl.units.map((u) => u.polygon).concat(cores);
    const fins: THREE.BufferGeometry[] = [];
    const frames: THREE.BufferGeometry[] = [];
    const windows = fl.openings && fl.openings.length ? placeWindows(fl, occluders, windowTypes) : null;

    for (const ud of fl.units) {
      const geo = extrudePolygon(ud.polygon, base, wallH);
      const mesh = shadowed(
        new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: PALETTE.wall, roughness: 0.8, transparent: true })),
      );
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), materials.edges.clone());
      mesh.add(edges);

      const glass: THREE.BufferGeometry[] = [];
      const glassH = isTop ? wallH * 0.84 : wallH * 0.72;
      if (windows) {
        for (const w of windows.get(ud)) {
          buildWindow(w, base, wallH, glass, frames, fins);
          (block.windows || (block.windows = [])).push({ floor: fl.floor, unit: ud.id, x: w.cx, y: w.cy, ux: w.ux, uy: w.uy, w: w.w });
        }
      } else {
        // no window data on this floor: regular ribbon glazing between fins
        forEachFacadeBay(
          ud.polygon,
          occluders.filter((p) => p !== ud.polygon),
          1.15,
          (b) => {
            if (b.w > 0.7) glass.push(facadeBox(b.cx, b.cy, b.nx, b.ny, b.angle, b.w - 0.16, glassH, 0.08, base + wallH * 0.52, 0.03));
            fins.push(facadeBox(b.sx, b.sy, b.nx, b.ny, b.angle, 0.14, wallH, 0.26, mid, 0.12));
            if (b.last) fins.push(facadeBox(b.ex, b.ey, b.nx, b.ny, b.angle, 0.14, wallH, 0.26, mid, 0.12));
          },
        );
      }
      const glassMesh = mergedMesh(
        glass,
        new THREE.MeshStandardMaterial({ color: PALETTE.glass, roughness: 0.25, metalness: 0.1, transparent: true }),
      ) as StdMesh | null;
      if (glassMesh) mesh.add(glassMesh);

      const unit: Unit = { data: ud, floor: fl, block, mesh, edges, glass: glassMesh, isTop, pending: !!ud.pending };
      mesh.userData.unit = unit;
      units.push(unit);
      block.units.push(unit);
      fg.add(mesh);
    }

    const finMesh = mergedMesh(fins, materials.fin.clone()) as StdMesh | null;
    if (finMesh) {
      finMesh.castShadow = true;
      fg.add(finMesh);
      slabs.push(finMesh);
    }
    const frameMesh = mergedMesh(frames, materials.windowFrame.clone()) as StdMesh | null;
    if (frameMesh) {
      fg.add(frameMesh);
      slabs.push(frameMesh);
    }

    // balcony glass + handrail along open slab edges
    const panels: THREE.BufferGeometry[] = [];
    const rails: THREE.BufferGeometry[] = [];
    for (let i = 0; i < outline.length; i++) {
      const [ax, ay] = outline[i];
      const [bx, by] = outline[(i + 1) % outline.length];
      const len = Math.hypot(bx - ax, by - ay);
      const ux = (bx - ax) / len;
      const uy = (by - ay) / len;
      const nx = uy;
      const ny = -ux;
      const n = Math.round(len / 0.6);
      const step = len / n;
      const angle = Math.atan2(uy, ux);
      for (let k = 0; k < n; k++) {
        const x = ax + ux * step * (k + 0.5);
        const y = ay + uy * step * (k + 0.5);
        if (occluders.some((p) => pointInPolygon(x - nx * 0.75, y - ny * 0.75, p))) continue;
        panels.push(facadeBox(x, y, nx, ny, angle, step + 0.01, 1, 0.04, base + 0.55, -0.08));
        rails.push(facadeBox(x, y, nx, ny, angle, step + 0.01, 0.07, 0.1, base + 1.08, -0.08));
      }
    }
    const panelMesh = mergedMesh(panels, materials.balconyGlass.clone()) as StdMesh | null;
    if (panelMesh) {
      panelMesh.userData.baseOpacity = 0.45;
      fg.add(panelMesh);
      slabs.push(panelMesh);
    }
    const railMesh = mergedMesh(rails, materials.rail.clone()) as StdMesh | null;
    if (railMesh) {
      fg.add(railMesh);
      slabs.push(railMesh);
    }

    block.floorGroups.set(fl.floor, { group: fg, slabs });
    group.add(fg);
  }

  // ---------- roof ----------
  const roofMat = () => new THREE.MeshStandardMaterial({ color: PALETTE.roof, roughness: 1, transparent: true });
  if (generic) {
    const last = d.floors[d.floors.length - 1];
    for (const roof of d.roofs || []) {
      const parapet = shadowed(new THREE.Mesh(extrudePolygon(inflate(roof.polygon, 0.5), roof.level - 0.5, 1.5), materials.shell.clone()));
      const surface = new THREE.Mesh(extrudePolygon(inflate(roof.polygon, -0.4), roof.level + 1, 0.05), roofMat());
      group.add(parapet, surface);
      shell.push(parapet, surface);
      const below = d.floors.filter((f) => Math.abs(f.level + f.height - roof.level) < 0.01).pop() || last;
      for (const core of below.cores || []) {
        const mx = core.reduce((s, p) => s + p[0], 0) / core.length;
        const my = core.reduce((s, p) => s + p[1], 0) / core.length;
        if (!pointInPolygon(mx, my, roof.polygon)) continue;
        const stair = new THREE.Mesh(extrudePolygon(inflate(core, -1.2), roof.level + 1, 3.2), materials.shell.clone());
        stair.castShadow = true;
        group.add(stair);
        shell.push(stair);
      }
    }
  } else {
    const last = d.floors[d.floors.length - 1];
    const fb = symmetricBox(last.footprint);
    const rect = (x0: number, x1: number, y0: number, y1: number): Polygon => [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ];
    const parts = [extrudePolygon(rect(-fb.x - 0.6, fb.x + 0.6, -fb.y - 0.5, fb.y + 0.5), roofLevel - 0.5, 1.5)];
    for (const sx of [-1, 1])
      for (const sy of [-1, 1]) {
        const x0 = sx * (fb.x + 0.6);
        const x1 = sx * (fb.x - 1.6);
        const y0 = sy * (fb.y + 0.5);
        const y1 = sy * (fb.y - 1.8);
        parts.push(extrudePolygon(rect(Math.min(x0, x1), Math.max(x0, x1), Math.min(y0, y1), Math.max(y0, y1)), roofLevel + 1, 1.1));
      }
    const parapet = shadowed(mergedMesh(parts, materials.shell.clone()) as StdMesh);
    group.add(parapet);
    shell.push(parapet);
    const surface = new THREE.Mesh(extrudePolygon(rect(-fb.x + 0.2, fb.x - 0.2, -fb.y + 0.3, fb.y - 0.3), roofLevel + 1, 0.05), roofMat());
    group.add(surface);
    shell.push(surface);
    if (last.core) {
      const stair = new THREE.Mesh(extrudePolygon(last.core, roofLevel + 1, 3.2), materials.shell.clone());
      stair.castShadow = true;
      group.add(stair);
      shell.push(stair);
    }
  }

  group.position.set(px, 0, -py);
  group.rotation.y = THREE.MathUtils.degToRad(site.rotation || 0);
  return { block, units };
}

export function buildTowers(blocks: SiteBlock[], windowTypes: Record<string, WindowType>) {
  const materials = createMaterials();
  const all = blocks.map((b) => buildTower(b, windowTypes, materials));
  return { blocks: all.map((r) => r.block), units: all.flatMap((r) => r.units) };
}

/** Low non-residential block between towers (or a flat paved deck when `flat`). */
export function buildPodium(podium: Podium, neighbours: Polygon[]) {
  const poly = podium.polygon;
  const h = podium.height;
  const group = new THREE.Group();
  if (podium.flat) {
    const body = new THREE.Mesh(extrudePolygon(poly, 0.31, h - 0.31), matte(0xc9c2b4));
    body.receiveShadow = true;
    const deck = new THREE.Mesh(extrudePolygon(inflate(poly, -1), h, 0.03), matte(0xb7b0a2));
    deck.receiveShadow = true;
    group.add(body, deck);
    return group;
  }
  group.add(
    shadowed(
      new THREE.Mesh(
        extrudePolygon(poly, 0.3, h - 0.9),
        new THREE.MeshStandardMaterial({ color: PALETTE.podiumGlass, roughness: 0.3, metalness: 0.1 }),
      ),
    ),
  );
  const stone: THREE.BufferGeometry[] = [];
  const louvers: THREE.BufferGeometry[] = [];
  let bayCount = 0;
  forEachFacadeBay(poly, neighbours, 4.1, (b) => {
    const pier = (x: number, y: number) =>
      stone.push(facadeBox(x, y, b.nx, b.ny, b.angle, 0.7, h - 0.3, 0.6, 0.3 + (h - 0.3) / 2, 0.25));
    pier(b.sx, b.sy);
    if (b.last) pier(b.ex, b.ey);
    stone.push(facadeBox(b.cx, b.cy, b.nx, b.ny, b.angle, b.w, 0.6, 0.4, h * 0.42, 0.18));
    stone.push(facadeBox(b.cx, b.cy, b.nx, b.ny, b.angle, 0.14, h - 0.9, 0.2, 0.3 + (h - 0.9) / 2, 0.1));
    if (bayCount++ % 3 === 1) {
      const n = Math.floor((b.w - 0.9) / 0.32);
      for (let i = 0; i < n; i++) {
        const f = (i + 0.5) / n - 0.5;
        louvers.push(
          facadeBox(
            b.cx + Math.cos(b.angle) * f * (b.w - 0.9),
            b.cy + Math.sin(b.angle) * f * (b.w - 0.9),
            b.nx,
            b.ny,
            b.angle,
            0.12,
            h * 0.46,
            0.32,
            h * 0.71,
            0.25,
          ),
        );
      }
    }
  });
  const stoneMat = new THREE.MeshStandardMaterial({ color: PALETTE.podiumStone, roughness: 0.9 });
  const stoneMesh = mergedMesh(stone, stoneMat);
  if (stoneMesh) group.add(shadowed(stoneMesh));
  const louverMesh = mergedMesh(louvers, new THREE.MeshStandardMaterial({ color: PALETTE.louver, roughness: 0.7 }));
  if (louverMesh) group.add(shadowed(louverMesh, true, false));
  group.add(shadowed(new THREE.Mesh(extrudePolygon(inflate(poly, 0.12), h - 0.6, 0.6), stoneMat)));
  const roof = new THREE.Mesh(
    extrudePolygon(inflate(poly, -1), h, 0.06),
    new THREE.MeshStandardMaterial({ color: podium.roof === "deck" ? PALETTE.roof : 0x86a86a, roughness: 1 }),
  );
  roof.receiveShadow = true;
  group.add(roof);
  return group;
}

/** Tree clusters and grass on the green podium roofs. */
export function buildRoofGardens(
  scene: THREE.Object3D,
  podiums: Podium[],
  towerOutlines: Polygon[],
  grass: GrassData | undefined,
  veg: Vegetation,
) {
  const rand = mulberry32(20261111);
  const area = (p: Polygon) => Math.abs(signedArea(p));
  const green = podiums.filter((p) => !p.flat && p.roof !== "deck");

  const trees: { x: number; y: number; base: number; k: number; cypress: boolean; spin: number; tint: number }[] = [];
  for (const pd of green) {
    const xs = pd.polygon.map((p) => p[0]);
    const ys = pd.polygon.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const fits = (x: number, y: number, margin: number) =>
      pointInPolygon(x, y, pd.polygon) &&
      distToOutline(x, y, pd.polygon) > margin &&
      !towerOutlines.some((t) => pointInPolygon(x, y, t) || distToOutline(x, y, t) < margin);
    const clusters = Math.max(2, Math.round(area(pd.polygon) / 170));
    for (let placed = 0, tries = 0; placed < clusters && tries < 400; tries++) {
      const x = x0 + rand() * (x1 - x0);
      const y = y0 + rand() * (y1 - y0);
      if (!fits(x, y, 4.5)) continue;
      placed++;
      const n = 4 + Math.floor(rand() * 4);
      for (let i = 0; i < n; i++) {
        const a = rand() * Math.PI * 2;
        const r = 1.5 + rand() * 5.5;
        const tx = x + Math.cos(a) * r;
        const ty = y + Math.sin(a) * r;
        if (!fits(tx, ty, 2.4) || trees.some((t) => Math.hypot(t.x - tx, t.y - ty) < 2.6)) continue;
        trees.push({
          x: tx,
          y: ty,
          base: pd.height + 0.04,
          k: 0.55 + rand() * 0.4,
          cypress: rand() < 0.35,
          spin: rand() * 6.28,
          tint: rand(),
        });
      }
    }
  }

  const tufts: GrassTuft[] = [];
  for (const pd of green) {
    const xs = pd.polygon.map((p) => p[0]);
    const ys = pd.polygon.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const target = Math.round((area(pd.polygon) / 1.1) * veg.grassDensity);
    for (let placed = 0, tries = 0; placed < target && tries < target * 6; tries++) {
      const x = x0 + rand() * (x1 - x0);
      const y = y0 + rand() * (y1 - y0);
      if (!pointInPolygon(x, y, pd.polygon) || distToOutline(x, y, pd.polygon) < 1.7) continue;
      placed++;
      tufts.push({ x, y, h: pd.height + 0.06, k: 0.8 + rand() * 0.6, tint: rand() });
    }
  }
  veg.stats.grassTufts = veg.addGrass(scene, grass, tufts);

  veg.addTrees(
    scene,
    trees.map((t) => ({
      x: t.x,
      y: t.y,
      tint: t.tint,
      base: t.base,
      kind: t.cypress ? "cypress" : "round",
      height: (t.cypress ? 9.5 : 8.5) * t.k,
    })),
    (_x, _y, t) => t.base,
  );
}
