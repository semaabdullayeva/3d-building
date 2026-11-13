import * as THREE from "three";
import type { Point, Polygon } from "../types";
import {
  convexHull,
  distToOutline,
  distToSegment,
  extrudePolygon,
  matte,
  mergedStaticMesh,
  mulberry32,
  offsetPolygon,
  planToWorld,
  pointInPolygon,
  ribbonGeometry,
  smoothPath,
} from "./geometry";
import type { TreeInstance, Vegetation } from "./vegetation";
import { grassMaterial, worldUV } from "./ground";

type SiteTree = { x: number; y: number; kind: "round" | "cypress" | "bush" | "palm"; k: number; tint: number };

const TREE_HEIGHT = { round: 9, cypress: 10, bush: 1.7 };

/**
 * Procedural surroundings of the complex: rolling terrain, ring road and access roads,
 * asphalt courtyard with lawns, garden paths and a playground, street trees and forest.
 *
 * @param footprints   plan outlines of every building (towers + podiums)
 * @param towerCenters plan centre of each tower (paths lead from the playground to them)
 */
export function buildLandscape(
  scene: THREE.Object3D,
  footprints: Polygon[],
  towerCenters: Point[],
  veg: Vegetation,
) {
  const rand = mulberry32(7411);
  const allPts = footprints.flat();
  const hull = convexHull(allPts);
  const xs = allPts.map((p) => p[0]);
  const ys = allPts.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const hx = (Math.max(...xs) - Math.min(...xs)) / 2;
  const hy = (Math.max(...ys) - Math.min(...ys)) / 2;

  const distToBuildings = (x: number, y: number) => {
    let d = Infinity;
    for (const f of footprints) {
      if (pointInPolygon(x, y, f)) return 0;
      d = Math.min(d, distToOutline(x, y, f));
    }
    return d;
  };

  // ---------- roads ----------
  const courtMargin = 5.5;
  const roadWidth = 8;
  const courtyard = offsetPolygon(hull, courtMargin);
  const ringRoad = smoothPath(offsetPolygon(hull, courtMargin + 1.2 + roadWidth / 2), true);
  const ringSouth = Math.min(...ringRoad.map((p) => p[1]));
  const avenueY = ringSouth - 26;
  const avenue = smoothPath(
    [
      [cx - 760, avenueY - 120],
      [cx - 430, avenueY - 44],
      [cx - 200, avenueY - 6],
      [cx - 40, avenueY],
      [cx + 120, avenueY - 4],
      [cx + 330, avenueY - 50],
      [cx + 560, avenueY - 130],
      [cx + 800, avenueY - 150],
    ],
    false,
  );
  const connectors: Point[][] = [cx - 70, cx + 55].map((x) => [
    [x, ringSouth + 2],
    [x, avenueY],
  ]);
  const westRoad = smoothPath(
    [
      [cx - hx - 40, cy - hy * 0.2],
      [cx - hx - 110, cy + 10],
      [cx - hx - 220, cy + 90],
      [cx - hx - 380, cy + 120],
      [cx - hx - 700, cy + 260],
    ],
    false,
  );
  westRoad.unshift(ringRoad.reduce((a, b) => (b[0] < a[0] ? b : a)));
  const outerRoads = [avenue, westRoad];

  // ---------- terrain: flat around the site, hills further out, valleys along roads ----------
  const rx = hx + 62;
  const ry = hy + 62;
  const terrainHeight = (x: number, y: number) => {
    const r = Math.hypot((x - cx) / rx, (y - cy) / ry);
    let k = THREE.MathUtils.smoothstep(r, 1, 2.3);
    for (const road of outerRoads) k = Math.min(k, THREE.MathUtils.smoothstep(distToOutline(x, y, road, false), 13, 75));
    const noise =
      0.5 +
      0.28 * Math.sin(x * 0.011 + 1.3) * Math.cos(y * 0.013 - 0.7) +
      0.16 * Math.sin(x * 0.023 + y * 0.017 + 2.1) +
      0.08 * Math.sin(x * 0.05 - y * 0.041);
    return Math.min(1, Math.max(0, k)) * (10 + 62 * Math.max(0, noise));
  };
  {
    const geo = new THREE.PlaneGeometry(2600, 2600, 200, 200);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + cx;
      const y = -pos.getZ(i) + cy;
      const h = terrainHeight(x, y);
      pos.setXYZ(i, x, h - 0.03, -y);
      const m = 0.5 + 0.5 * Math.sin(x * 0.031 + 0.4) * Math.sin(y * 0.027 + 1.9);
      c.setHSL(0.2, 0.08, 0.92 - Math.min(0.1, h * 0.0014)); // light tint over the grass texture, darker on the hills
      colors.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const ground = new THREE.Mesh(worldUV(geo), grassMaterial({ vertexColors: true, wild: 1 }));
    ground.receiveShadow = true;
    scene.add(ground);
  }

  const asphalt = [
    ribbonGeometry(ringRoad.concat([ringRoad[0], ringRoad[1]]), roadWidth, 0.07),
    ribbonGeometry(avenue, roadWidth + 3, 0.07),
    ribbonGeometry(westRoad, roadWidth, 0.07),
  ];
  for (const c of connectors) asphalt.push(ribbonGeometry(c, roadWidth, 0.07));
  scene.add(mergedStaticMesh(asphalt, matte(0x47494e), false));

  const sidewalk = smoothPath(offsetPolygon(hull, courtMargin + 1.2 + roadWidth + 1.3), true);
  scene.add(mergedStaticMesh([ribbonGeometry(sidewalk.concat([sidewalk[0], sidewalk[1]]), 2.2, 0.16)], matte(0xcfccc4), false));

  // light sidewalk rim around the complex; inside it the ground between the buildings is asphalt
  const pad = new THREE.Mesh(extrudePolygon(courtyard, 0, 0.3), matte(0xd8d3c8));
  pad.receiveShadow = true;
  scene.add(pad);
  const yard = new THREE.Mesh(extrudePolygon(offsetPolygon(hull, 0.4), 0.3, 0.012), matte(0x55585d));
  yard.receiveShadow = true;
  scene.add(yard);

  // dashed centre lines
  {
    const dashes: THREE.BufferGeometry[] = [];
    const addDashes = (path: Point[], every = 8) => {
      let run = 0;
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1];
        const b = path[i];
        run += Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (run < every) continue;
        run = 0;
        const g = new THREE.BoxGeometry(3.2, 0.02, 0.18);
        g.rotateY(Math.atan2(b[1] - a[1], b[0] - a[0]));
        g.translate(a[0], 0.09, -a[1]);
        dashes.push(g);
      }
    };
    addDashes(ringRoad);
    addDashes(avenue);
    addDashes(westRoad);
    scene.add(mergedStaticMesh(dashes, matte(0xf3f3ee), false));
  }

  // ---------- courtyard: plaza at the most open spot, lawns, paths to towers ----------
  let plaza = { x: cx, y: cy, r: 0 };
  for (let x = cx - hx; x <= cx + hx; x += 3)
    for (let y = cy - hy; y <= cy + hy; y += 3) {
      if (!pointInPolygon(x, y, hull)) continue;
      const r = Math.min(distToBuildings(x, y), distToOutline(x, y, hull) + 4);
      if (r > plaza.r) plaza = { x, y, r };
    }
  const plazaR = Math.max(8, Math.min(15, plaza.r - 8));
  const paths: [Point, Point][] = towerCenters.map((c) => [[plaza.x, plaza.y], c]);

  // Lawn = everything inside the complex that is not a building margin, path or the playground.
  // lawnEdge > 0 inside the lawn; its zero line runs parallel to the paths and facades.
  const lawnEdge = (x: number, y: number) => {
    if (!pointInPolygon(x, y, hull)) return -1;
    let f = Math.min(distToOutline(x, y, hull) - 2.5, distToBuildings(x, y) - 6.5, Math.hypot(x - plaza.x, y - plaza.y) - (plazaR + 3.4));
    for (const [a, b] of paths) f = Math.min(f, distToSegment(x, y, a[0], a[1], b[0], b[1]) - 2.1);
    return f;
  };

  // planting positions, kept a little inside the lawn edge
  const lawnSpots: Point[] = [];
  for (let x = cx - hx; x <= cx + hx; x += 4.2)
    for (let y = cy - hy; y <= cy + hy; y += 4.2) {
      const px = x + (rand() - 0.5) * 1.6;
      const py = y + (rand() - 0.5) * 1.6;
      if (lawnEdge(px, py) > 1.6) lawnSpots.push([px, py]);
    }

  {
    // lawn mesh: marching squares over a 1 m grid, so the edges follow the paths instead of scalloping
    const step = 1;
    const cols = Math.ceil((2 * hx) / step) + 1;
    const rows = Math.ceil((2 * hy) / step) + 1;
    const x0 = cx - hx;
    const y0 = cy - hy;
    const field = new Float32Array(cols * rows);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) field[r * cols + c] = lawnEdge(x0 + c * step, y0 + r * step);
    const pos: number[] = [];
    const corners: Point[] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    for (let r = 0; r < rows - 1; r++)
      for (let c = 0; c < cols - 1; c++) {
        const v = corners.map(([a, b]) => field[(r + b) * cols + c + a]);
        if (v.every((q) => q <= 0)) continue;
        const poly: Point[] = [];
        for (let k = 0; k < 4; k++) {
          const n = (k + 1) % 4;
          const [ax, ay] = corners[k];
          const [bx, by] = corners[n];
          if (v[k] > 0) poly.push([ax, ay]);
          if (v[k] > 0 !== v[n] > 0) {
            const t = v[k] / (v[k] - v[n]);
            poly.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
          }
        }
        for (let k = 1; k < poly.length - 1; k++)
          for (const q of [poly[0], poly[k], poly[k + 1]]) pos.push(x0 + (c + q[0]) * step, 0.33, -(y0 + (r + q[1]) * step));
      }
    if (pos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      const lawns = new THREE.Mesh(worldUV(g), grassMaterial());
      lawns.receiveShadow = true;
      scene.add(lawns);
    }

    // light garden paths from the playground towards each building, and the walk round the playground
    const walks: THREE.BufferGeometry[] = paths.map((p) => ribbonGeometry(p, 2.6, 0.318));
    const round = new THREE.RingGeometry(plazaR, plazaR + 2.6, 48);
    round.rotateX(-Math.PI / 2);
    round.translate(plaza.x, 0.318, -plaza.y);
    walks.push(round);
    scene.add(mergedStaticMesh(walks, matte(0xd8d3c8), false));

    const floor = new THREE.Mesh(new THREE.CylinderGeometry(plazaR, plazaR, 0.06, 48), matte(0xdcc594));
    floor.position.copy(planToWorld(plaza.x, plaza.y, 0.34));
    floor.receiveShadow = true;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(plazaR + 0.2, 0.22, 6, 64), matte(0xbfb7a6));
    rim.rotation.x = Math.PI / 2;
    rim.position.copy(planToWorld(plaza.x, plaza.y, 0.4));
    scene.add(floor, rim);
  }

  buildPlayground(scene, plaza, plazaR);

  // ---------- trees ----------
  const palmTrunk = new THREE.CylinderGeometry(0.16, 0.24, 1, 6);
  const palmLeafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
  const m4 = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const col = new THREE.Color();

  const plantTrees = (trees: SiteTree[], groundAt: (x: number, y: number) => number, forest = false) => {
    veg.addTrees(
      scene,
      trees
        .filter((t) => t.kind !== "palm")
        .map(
          (t): TreeInstance => ({
            x: t.x,
            y: t.y,
            tint: t.tint,
            kind: forest ? (t.kind === "cypress" ? "forestPine" : "forestRound") : (t.kind as TreeInstance["kind"]),
            height: TREE_HEIGHT[t.kind] * t.k * (forest ? 1.15 : 1),
          }),
        ),
      groundAt,
      { shadows: !forest },
    );

    const palms = trees.filter((t) => t.kind === "palm");
    if (!palms.length) return;
    const trunks = new THREE.InstancedMesh(palmTrunk, matte(0x6b4f3a), palms.length);
    const frond = new THREE.ConeGeometry(0.42, 4.2, 4);
    frond.rotateZ(-Math.PI / 2);
    frond.translate(2.1, 0, 0);
    frond.scale(1, 0.25, 1);
    const fronds = new THREE.InstancedMesh(frond, palmLeafMat, palms.length * 9);
    let fi = 0;
    palms.forEach((t, i) => {
      const g = groundAt(t.x, t.y);
      const k = t.k;
      const h = 7.5 * k;
      trunks.setMatrixAt(i, m4.compose(planToWorld(t.x, t.y, g + h / 2), quat.identity(), new THREE.Vector3(1.5 * k, h, 1.5 * k)));
      col.setHSL(0.25 + t.tint * 0.03, 0.45, 0.3);
      for (let j = 0; j < 9; j++) {
        quat.setFromEuler(new THREE.Euler(0, (j / 9) * Math.PI * 2 + t.tint, j % 2 ? -0.5 : -0.2, "YXZ"));
        fronds.setMatrixAt(fi, m4.compose(planToWorld(t.x, t.y, g + h), quat, new THREE.Vector3(k, k, k)));
        fronds.setColorAt(fi++, col);
      }
    });
    for (const mesh of [trunks, fronds]) {
      mesh.castShadow = true;
      scene.add(mesh);
    }
  };

  // courtyard trees on the lawns (bushes next to buildings, palms around the plaza)
  {
    const trees: SiteTree[] = [];
    const free = (x: number, y: number, d: number) => !trees.some((t) => Math.hypot(t.x - x, t.y - y) < d);
    for (const [x, y] of lawnSpots) {
      if (distToBuildings(x, y) < 9.5) {
        if (rand() < 0.22) trees.push({ x, y, kind: "bush", k: 0.7 + rand() * 0.6, tint: rand() });
        continue;
      }
      const r = rand();
      if (r > 0.42 || !free(x, y, 5)) continue;
      const nearPlaza = Math.hypot(x - plaza.x, y - plaza.y) < plazaR + 24;
      trees.push({
        x,
        y,
        kind: r < 0.1 && nearPlaza ? "palm" : r < 0.24 ? "cypress" : "round",
        k: 0.7 + rand() * 0.5,
        tint: rand(),
      });
    }
    plantTrees(trees, () => 0.33);
  }

  // street trees between the ring road and the avenue
  {
    const trees: SiteTree[] = [];
    for (let x = cx - hx - 20; x <= cx + hx + 20; x += 9) {
      if (connectors.some((c) => Math.abs(c[0][0] - x) < 8)) continue;
      trees.push({
        x: x + rand() * 2,
        y: (ringSouth + avenueY) / 2 + (rand() - 0.5) * 5,
        kind: rand() < 0.3 ? "cypress" : "round",
        k: 0.75 + rand() * 0.4,
        tint: rand(),
      });
    }
    plantTrees(trees, () => 0);
  }

  // patchy forest on the hills
  {
    const trees: SiteTree[] = [];
    for (let i = 0; i < 30000 && trees.length < 4200; i++) {
      const a = rand() * Math.PI * 2;
      const d = 150 + Math.pow(rand(), 1.4) * 900;
      const x = cx + Math.cos(a) * d;
      const y = cy + Math.sin(a) * d;
      if (terrainHeight(x, y) < 4) continue;
      const density = 0.5 + 0.5 * Math.sin(x * 0.019 + 0.8) * Math.sin(y * 0.023 + 2.2);
      if (rand() > density * density * 1.3) continue;
      trees.push({ x, y, kind: rand() < 0.55 ? "cypress" : "round", k: 0.9 + rand() * 0.9, tint: rand() });
    }
    plantTrees(trees, terrainHeight, true);
  }
}

/** Climbing frame, slide, rope pyramid, dome, swings and benches around the plaza. */
function buildPlayground(scene: THREE.Object3D, plaza: { x: number; y: number }, plazaR: number) {
  const wood: THREE.BufferGeometry[] = [];
  const metal: THREE.BufferGeometry[] = [];
  const rope: THREE.BufferGeometry[] = [];
  const seats: THREE.BufferGeometry[] = [];
  const W = planToWorld;

  const tube = (pts: THREE.Vector3[], r: number, seg = 24, radial = 6) =>
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), seg, r, radial, false);
  const post = (x: number, y: number, h: number, r: number, base = 0.34) => {
    const g = new THREE.CylinderGeometry(r, r, h, 8);
    g.translate(x, base + h / 2, -y);
    return g;
  };
  const bar = (a: THREE.Vector3, b: THREE.Vector3, r: number) => {
    const d = b.clone().sub(a);
    const g = new THREE.CylinderGeometry(r, r, d.length(), 6);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
    g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    return g;
  };
  /** Vase-shaped lattice tower; returns the platform height. */
  const tower = (x: number, y: number, height: number, ribs: number) => {
    const profile = [
      [0.9, 0],
      [1, 0.16],
      [1.75, 0.34],
      [2.05, 0.5],
      [1.5, 0.68],
      [0.75, 0.84],
      [0.5, 0.93],
      [0.62, 1],
    ];
    const s = height / 10;
    for (let j = 0; j < ribs; j++) {
      const a = (j / ribs) * Math.PI * 2;
      wood.push(
        tube(
          profile.map(([r, h]) => W(x + Math.cos(a) * r * s, y + Math.sin(a) * r * s, 0.34 + h * height)),
          0.09 * s + 0.03,
          28,
          5,
        ),
      );
    }
    for (const [r, h] of [
      [1.05, 0.18],
      [2.05, 0.5],
      [0.75, 0.84],
    ]) {
      const ring = new THREE.TorusGeometry(r * s, 0.06, 5, 28);
      ring.rotateX(Math.PI / 2);
      ring.translate(x, 0.34 + h * height, -y);
      wood.push(ring);
    }
    const deck = new THREE.CylinderGeometry(1.5 * s, 1.5 * s, 0.14, 20);
    deck.translate(x, 0.34 + 0.27 * height, -y);
    wood.push(deck);
    metal.push(post(x, y, 0.27 * height, 0.16));
    return 0.34 + 0.27 * height;
  };

  const u = plazaR / 14;
  const t1: Point = [plaza.x - 1.5 * u, plaza.y + 2.5 * u];
  const t2: Point = [plaza.x - 6.5 * u, plaza.y + 5.2 * u];
  const h1 = tower(t1[0], t1[1], 10 * u, 16);
  const h2 = tower(t2[0], t2[1], 6.6 * u, 12);
  wood.push(bar(W(t1[0], t1[1], h1), W(t2[0], t2[1], h2), 0.1));

  // tube slide + small slide
  metal.push(
    tube(
      [
        W(t1[0] - 0.8 * u, t1[1] - 0.8 * u, h1 + 0.5),
        W(t1[0] - 2.6 * u, t1[1] - 2.4 * u, h1 - 0.3),
        W(t1[0] - 5 * u, t1[1] - 4.6 * u, 1.5),
        W(t1[0] - 7.2 * u, t1[1] - 6.2 * u, 0.95),
        W(t1[0] - 8.6 * u, t1[1] - 7 * u, 0.9),
      ],
      0.62 * u,
      32,
      12,
    ),
  );
  metal.push(post(t1[0] - 5 * u, t1[1] - 4.6 * u, 0.9, 0.1));
  metal.push(
    tube(
      [W(t1[0] + 1.2 * u, t1[1] - 0.6 * u, h1 + 0.1), W(t1[0] + 3.4 * u, t1[1] - 1.6 * u, 1.6), W(t1[0] + 5.6 * u, t1[1] - 2.6 * u, 0.6)],
      0.34 * u,
      16,
      8,
    ),
  );

  // rope pyramid
  {
    const [x, y] = [plaza.x + 6.2 * u, plaza.y - 3.6 * u];
    const h = 5.2 * u;
    const r = 3.6 * u;
    const top = W(x, y, 0.34 + h);
    metal.push(post(x, y, h, 0.11));
    const corners = [...Array(8)].map((_, j) => W(x + Math.cos((j * Math.PI) / 4) * r, y + Math.sin((j * Math.PI) / 4) * r, 0.36));
    corners.forEach((c, j) => {
      rope.push(bar(top, c, 0.035));
      for (const f of [0.3, 0.55, 0.8]) rope.push(bar(top.clone().lerp(c, f), top.clone().lerp(corners[(j + 1) % 8], f), 0.028));
    });
  }

  // climbing dome
  {
    const [x, y] = [plaza.x + 8 * u, plaza.y + 4.4 * u];
    const r = 3.2 * u;
    for (let j = 0; j < 4; j++) {
      const arc = new THREE.TorusGeometry(r, 0.07, 6, 24, Math.PI);
      arc.rotateY((j * Math.PI) / 4);
      arc.translate(x, 0.34, -y);
      wood.push(arc);
    }
    const ring = new THREE.TorusGeometry(r * 0.72, 0.05, 5, 24);
    ring.rotateX(Math.PI / 2);
    ring.translate(x, 0.34 + r * 0.69, -y);
    wood.push(ring);
  }

  // swing set
  {
    const [x, y] = [plaza.x + 1.5 * u, plaza.y - 8.6 * u];
    const span = 5.6 * u;
    const h = 2.9 * u;
    for (const dx of [-span / 2, span / 2])
      for (const dy of [-1.1, 1.1]) wood.push(bar(W(x + dx, y + dy * u, 0.34), W(x + dx, y, 0.34 + h), 0.08));
    wood.push(bar(W(x - span / 2, y, 0.34 + h), W(x + span / 2, y, 0.34 + h), 0.08));
    for (const dx of [-span / 4, span / 4]) {
      for (const o of [-0.28, 0.28]) rope.push(bar(W(x + dx + o, y, 0.34 + h), W(x + dx + o, y + 0.35, 0.95), 0.02));
      const seat = new THREE.BoxGeometry(0.75, 0.06, 0.3);
      seat.translate(x + dx, 0.93, -(y + 0.35));
      seats.push(seat);
    }
  }

  // benches around the rim
  for (let j = 0; j < 6; j++) {
    const a = j * (Math.PI / 3) + 0.4;
    const x = plaza.x + Math.cos(a) * (plazaR - 1.4);
    const y = plaza.y + Math.sin(a) * (plazaR - 1.4);
    const seat = new THREE.BoxGeometry(2.4, 0.12, 0.6);
    seat.translate(0, 0.82, 0);
    const back = new THREE.BoxGeometry(2.4, 0.5, 0.08);
    back.translate(0, 1.15, 0.3);
    for (const g of [seat, back]) {
      g.rotateY(a + Math.PI / 2);
      g.translate(x, 0, -y);
      seats.push(g);
    }
    metal.push(post(x, y, 0.45, 0.06));
  }

  scene.add(
    mergedStaticMesh(wood, matte(0xe3cf9f, { roughness: 0.7 })),
    mergedStaticMesh(metal, matte(0xd5dbe0, { roughness: 0.3, metalness: 0.35 })),
    mergedStaticMesh(rope, matte(0x2b2f36)),
    mergedStaticMesh(seats, matte(0xa9865a, { roughness: 0.8 })),
  );
}
