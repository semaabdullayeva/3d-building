"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Unit } from "@/lib/viewer/engine";
import { distToSegment, centroid } from "@/lib/viewer/geometry";
import type { Polygon } from "@/lib/types";

const WALL_T   = 0.30;
const INT_T    = 0.17;   // interior wall thickness
const CAP_H    = 0.10;
const WIN_W    = 1.40;
const WIN_H    = 1.40;
const WIN_SILL = 0.55;

// Ray-casting point-in-polygon
function pointInPoly(px: number, py: number, poly: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]; const [xj, yj] = poly[j];
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi))
      inside = !inside;
  }
  return inside;
}

// Distance from point to nearest polygon edge
function polyEdgeDist(px: number, py: number, poly: Polygon): number {
  let minD = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length];
    minD = Math.min(minD, distToSegment(px, py, ax, ay, bx, by));
  }
  return minD;
}

export function ApartmentView3D({ unit }: { unit: Unit }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    // ── renderer ──────────────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = false;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xbdd0e8);

    const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 300);

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 3;
    controls.maxDistance = 100;
    controls.minPolarAngle = 0.05;
    controls.maxPolarAngle = Math.PI * 0.75;
    controls.enablePan = true;

    // ── materials ─────────────────────────────────────────────────────────
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0xe2ddd5, roughness: 0.88, metalness: 0.0,
      transparent: true, opacity: 0.82,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const capMat = new THREE.MeshStandardMaterial({ color: 0x1a1612, roughness: 0.75 });
    const intWallMat = new THREE.MeshStandardMaterial({ color: 0x3a3632, roughness: 0.80 });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x88c4e8,
      emissive: new THREE.Color(0x2e6a9e), emissiveIntensity: 0.50,
      transparent: true, opacity: 0.48,
      roughness: 0.03, metalness: 0.20,
      side: THREE.DoubleSide,
    });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x1e1a16, roughness: 0.70 });

    // ── data ──────────────────────────────────────────────────────────────
    const poly  = unit.data.polygon as Polygon;
    const fh    = Math.max(unit.floor.height ?? 2.85, 2.6);
    const ops   = unit.floor.openings ?? [];
    const [cxP, cyP] = centroid(poly);
    const planInfo = unit.floor.plan;

    const disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];

    // ── floor (UV-mapped floor plan image) ────────────────────────────────
    const floorShape = new THREE.Shape(poly.map(([x, y]) => new THREE.Vector2(x, y)));
    const floorGeo = new THREE.ShapeGeometry(floorShape, 4);
    floorGeo.rotateX(-Math.PI / 2);
    disposables.push(floorGeo);

    let floorMat: THREE.MeshStandardMaterial;

    if (planInfo) {
      const posArr = floorGeo.attributes.position.array as Float32Array;
      const uvArr  = new Float32Array((posArr.length / 3) * 2);
      const [bx0, by0, bx1, by1] = planInfo.bounds;
      const bw = bx1 - bx0 || 1, bh = by1 - by0 || 1;
      for (let i = 0; i < posArr.length / 3; i++) {
        uvArr[i * 2]     = (posArr[i * 3]     - bx0) / bw;
        uvArr[i * 2 + 1] = (-posArr[i * 3 + 2] - by0) / bh;
      }
      floorGeo.setAttribute("uv", new THREE.BufferAttribute(uvArr, 2));
      const loader = new THREE.TextureLoader();
      const planTex = loader.load(`/plans/${planInfo.image}`);
      planTex.flipY = true;
      disposables.push(planTex);
      floorMat = new THREE.MeshStandardMaterial({ map: planTex, roughness: 0.95, side: THREE.DoubleSide });
    } else {
      floorMat = new THREE.MeshStandardMaterial({ color: 0xece7da, roughness: 0.95, side: THREE.DoubleSide });
    }
    disposables.push(floorMat);

    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.position.y = 0.001;
    floorMesh.renderOrder = 0;
    scene.add(floorMesh);

    // ── dark bottom slab ──────────────────────────────────────────────────
    const bottomGeo = floorGeo.clone();
    disposables.push(bottomGeo);
    const idx = bottomGeo.index;
    if (idx) {
      for (let i = 0; i < idx.count; i += 3) {
        const a = idx.getX(i), c = idx.getX(i + 2);
        idx.setX(i, c); idx.setX(i + 2, a);
      }
    }
    scene.add(new THREE.Mesh(bottomGeo, capMat));

    // ── opening → edge map ────────────────────────────────────────────────
    const edgeWindows = new Map<number, number[]>();
    for (const op of ops) {
      let minD = Infinity, nearI = 0;
      for (let i = 0; i < poly.length; i++) {
        const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length];
        const d = distToSegment(op.x, op.y, ax, ay, bx, by);
        if (d < minD) { minD = d; nearI = i; }
      }
      if (minD > 1.0) continue;
      const [ax, ay] = poly[nearI], [bx, by] = poly[(nearI + 1) % poly.length];
      const eLen = Math.hypot(bx - ax, by - ay);
      const t = Math.max(0.1, Math.min(0.9,
        ((op.x - ax) * (bx - ax) + (op.y - ay) * (by - ay)) / (eLen * eLen)));
      if (!edgeWindows.has(nearI)) edgeWindows.set(nearI, []);
      edgeWindows.get(nearI)!.push(t);
    }

    // ── outer walls ───────────────────────────────────────────────────────
    for (let i = 0; i < poly.length; i++) {
      const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length];
      const edgeDX = bx - ax, edgeDY = by - ay;
      const edgeLen = Math.hypot(edgeDX, edgeDY);
      if (edgeLen < 0.1) continue;

      const hLen = edgeLen / 2;
      const winTs = edgeWindows.get(i) ?? [];

      const wallShape = new THREE.Shape();
      wallShape.moveTo(-hLen, 0); wallShape.lineTo(hLen, 0);
      wallShape.lineTo(hLen, fh); wallShape.lineTo(-hLen, fh);
      wallShape.closePath();

      const group = new THREE.Group();

      for (const t of winTs) {
        const wx = t * edgeLen - hLen, hw = WIN_W / 2;
        if (wx - hw < -hLen + 0.15 || wx + hw > hLen - 0.15) continue;
        if (WIN_SILL + WIN_H > fh - 0.15) continue;

        const hole = new THREE.Path();
        hole.moveTo(wx - hw, WIN_SILL); hole.lineTo(wx - hw, WIN_SILL + WIN_H);
        hole.lineTo(wx + hw, WIN_SILL + WIN_H); hole.lineTo(wx + hw, WIN_SILL);
        hole.closePath();
        wallShape.holes.push(hole);

        const glassGeo = new THREE.PlaneGeometry(WIN_W, WIN_H);
        disposables.push(glassGeo);
        const glassMesh = new THREE.Mesh(glassGeo, glassMat);
        glassMesh.position.set(wx, WIN_SILL + WIN_H / 2, 0);
        glassMesh.renderOrder = 2;
        group.add(glassMesh);

        const FT = 0.04;
        const makeBar = (w: number, h: number, px: number, py: number) => {
          const geo = new THREE.BoxGeometry(w, h, 0.04);
          disposables.push(geo);
          const m = new THREE.Mesh(geo, frameMat);
          m.position.set(wx + px, WIN_SILL + WIN_H / 2 + py, WALL_T / 2 + 0.001);
          return m;
        };
        const FW = WIN_W + FT * 2;
        group.add(makeBar(FW, FT, 0, WIN_H / 2 + FT / 2));
        group.add(makeBar(FW, FT, 0, -(WIN_H / 2 + FT / 2)));
        group.add(makeBar(FT, WIN_H, -(WIN_W / 2 + FT / 2), 0));
        group.add(makeBar(FT, WIN_H,  (WIN_W / 2 + FT / 2), 0));
      }

      const extGeo = new THREE.ExtrudeGeometry(wallShape, { depth: WALL_T, bevelEnabled: false });
      extGeo.translate(0, 0, -WALL_T / 2);
      disposables.push(extGeo);
      const wallMesh = new THREE.Mesh(extGeo, wallMat);
      wallMesh.renderOrder = 1;
      group.add(wallMesh);

      const capGeo = new THREE.BoxGeometry(edgeLen + 0.02, CAP_H, WALL_T + 0.02);
      disposables.push(capGeo);
      const capMesh = new THREE.Mesh(capGeo, capMat);
      capMesh.position.set(0, fh + CAP_H / 2, 0);
      group.add(capMesh);

      const baseCapGeo = new THREE.BoxGeometry(edgeLen + 0.02, 0.06, WALL_T + 0.02);
      disposables.push(baseCapGeo);
      const baseCap = new THREE.Mesh(baseCapGeo, capMat);
      baseCap.position.set(0, -0.03, 0);
      group.add(baseCap);

      const edgeDir = new THREE.Vector3(edgeDX / edgeLen, 0, -edgeDY / edgeLen);
      group.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), edgeDir);
      group.position.set((ax + bx) / 2, 0, -(ay + by) / 2);
      scene.add(group);
    }

    // ── interior walls (detected from floor plan image) ───────────────────
    let cancelled = false;
    const intObjects: THREE.Object3D[] = [];
    const intGeos:    THREE.BufferGeometry[] = [];

    if (planInfo) {
      const img = new Image();
      img.onload = () => {
        if (cancelled) return;

        const W = img.width, H = img.height;
        const cnv = document.createElement("canvas");
        cnv.width = W; cnv.height = H;
        const ctx = cnv.getContext("2d")!;
        ctx.drawImage(img, 0, 0);
        const pix = ctx.getImageData(0, 0, W, H).data;

        const [bx0, , bx1, by1] = planInfo.bounds;
        const bw = bx1 - bx0 || 1;
        const bh = by1 - planInfo.bounds[1] || 1;

        const polyXs = poly.map(p => p[0]), polyYs = poly.map(p => p[1]);
        const minX = Math.min(...polyXs), maxX = Math.max(...polyXs);
        const minY = Math.min(...polyYs), maxY = Math.max(...polyYs);

        const BORDER     = 0.52;   // ignore pixels this close to outer wall
        const SCAN_STEP  = 0.13;   // distance between parallel scan lines (m)
        const INNER_STEP = 0.025;  // step along each scan line (m)
        const MIN_LEN    = 0.38;   // minimum wall segment length (m)
        const DARK       = 82;     // brightness threshold (0-255)

        const isDark = (planX: number, planY: number): boolean => {
          const px = Math.round((planX - planInfo.bounds[0]) / bw * W);
          const py = Math.round((by1 - planY) / bh * H);
          if (px < 0 || px >= W || py < 0 || py >= H) return false;
          const i = (py * W + px) * 4;
          return (pix[i] + pix[i + 1] + pix[i + 2]) / 3 < DARK;
        };

        type Seg = { ax: number; ay: number; bx: number; by: number; horiz: boolean };
        const segs: Seg[] = [];

        // Horizontal scans
        for (let gy = minY + BORDER; gy <= maxY - BORDER; gy += SCAN_STEP) {
          let segAx = -Infinity;
          let inSeg = false;
          for (let gx = minX; gx <= maxX + INNER_STEP; gx += INNER_STEP) {
            const inside = pointInPoly(gx, gy, poly) && polyEdgeDist(gx, gy, poly) > BORDER;
            const dark   = inside && isDark(gx, gy);
            if (dark && !inSeg)   { segAx = gx; inSeg = true; }
            else if (!dark && inSeg) {
              const len = gx - segAx;
              if (len >= MIN_LEN) {
                const dup = segs.some(s =>
                  s.horiz && Math.abs(s.ay - gy) < SCAN_STEP * 1.3 &&
                  s.ax < gx - 0.1 && s.bx > segAx + 0.1);
                if (!dup) segs.push({ ax: segAx, ay: gy, bx: gx, by: gy, horiz: true });
              }
              inSeg = false;
            }
          }
        }

        // Vertical scans
        for (let gx = minX + BORDER; gx <= maxX - BORDER; gx += SCAN_STEP) {
          let segAy = -Infinity;
          let inSeg = false;
          for (let gy = minY; gy <= maxY + INNER_STEP; gy += INNER_STEP) {
            const inside = pointInPoly(gx, gy, poly) && polyEdgeDist(gx, gy, poly) > BORDER;
            const dark   = inside && isDark(gx, gy);
            if (dark && !inSeg)   { segAy = gy; inSeg = true; }
            else if (!dark && inSeg) {
              const len = gy - segAy;
              if (len >= MIN_LEN) {
                const dup = segs.some(s =>
                  !s.horiz && Math.abs(s.ax - gx) < SCAN_STEP * 1.3 &&
                  s.ay < gy - 0.1 && s.by > segAy + 0.1);
                if (!dup) segs.push({ ax: gx, ay: segAy, bx: gx, by: gy, horiz: false });
              }
              inSeg = false;
            }
          }
        }

        // Build geometry for each detected interior wall segment
        for (const seg of segs) {
          if (cancelled) break;
          const len = seg.horiz ? (seg.bx - seg.ax) : (seg.by - seg.ay);
          const wallH = fh * 0.93;

          const geo = new THREE.BoxGeometry(
            seg.horiz ? len  : INT_T,
            wallH,
            seg.horiz ? INT_T : len,
          );
          intGeos.push(geo);
          const mesh = new THREE.Mesh(geo, intWallMat);
          mesh.position.set(
            seg.horiz ? (seg.ax + seg.bx) / 2 : seg.ax,
            wallH / 2,
            -(seg.horiz ? seg.ay : (seg.ay + seg.by) / 2),
          );
          scene.add(mesh);
          intObjects.push(mesh);

          // Dark top cap on each interior wall
          const capG = new THREE.BoxGeometry(
            seg.horiz ? len + 0.01 : INT_T + 0.01,
            CAP_H * 0.75,
            seg.horiz ? INT_T + 0.01 : len + 0.01,
          );
          intGeos.push(capG);
          const capM = new THREE.Mesh(capG, capMat);
          capM.position.copy(mesh.position);
          capM.position.y = wallH + CAP_H * 0.375;
          scene.add(capM);
          intObjects.push(capM);
        }
      };
      img.src = `/plans/${planInfo.image}`;
    }

    // ── lighting ──────────────────────────────────────────────────────────
    scene.add(new THREE.AmbientLight(0xffffff, 2.0));
    const sun = new THREE.DirectionalLight(0xfff8ee, 1.3);
    sun.position.set(cxP + 22, 30, -cyP + 18);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xd0e4f8, 0.55);
    fill.position.set(cxP - 18, 12, -cyP - 12);
    scene.add(fill);
    scene.add(new THREE.HemisphereLight(0xcce0f8, 0xe0dbd0, 0.65));

    // ── aerial camera ─────────────────────────────────────────────────────
    const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
    const spanX = Math.max(...xs) - Math.min(...xs);
    const spanY = Math.max(...ys) - Math.min(...ys);
    const maxSpan = Math.max(spanX, spanY);

    camera.position.set(cxP + maxSpan * 0.75, maxSpan * 1.20, -cyP + maxSpan * 0.75);
    controls.target.set(cxP, fh * 0.4, -cyP);
    camera.updateProjectionMatrix();
    controls.update();

    // ── resize ────────────────────────────────────────────────────────────
    const container = canvas.parentElement ?? canvas;
    const resize = () => {
      const w = container.clientWidth || 400, h = container.clientHeight || 300;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();

    // ── render loop ───────────────────────────────────────────────────────
    let alive = true;
    const animate = () => {
      if (!alive) return;
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      alive = false;
      cancelled = true;
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      disposables.forEach(d => d.dispose());
      intGeos.forEach(g => g.dispose());
      intObjects.forEach(o => scene.remove(o));
      [wallMat, capMat, intWallMat, glassMat, frameMat].forEach(m => m.dispose());
    };
  }, [unit]);

  return (
    <canvas
      ref={ref}
      style={{ width: "100%", height: "100%", display: "block", borderRadius: "0 0 20px 20px" }}
    />
  );
}
