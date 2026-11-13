import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { FloorData, Point, SiteData, UnitData } from "../types";
import { buildPodium, buildRoofGardens, buildTowers, UNIT_COLORS, type Block, type Unit } from "./buildings";
import { buildLandscape } from "./landscape";
import { Vegetation } from "./vegetation";

export type { Block, Unit };

export interface ViewerState {
  /** id of the active block */
  block: string;
  /** room-count filter (null = all) */
  rooms: number | null;
  /** isolated floor of the active block (null = whole building) */
  floor: number | null;
  selected: Unit | null;
  /** floor plan shown in the modal */
  plan: { block: Block; floor: FloorData } | null;
  /** the usage hint disappears after the first selection */
  hintHidden: boolean;
}

export interface TooltipState {
  unit: Unit;
  x: number;
  y: number;
}

const OVERVIEW_TARGET = new THREE.Vector3(-35, 15, -42);
const OVERVIEW_POSITION = new THREE.Vector3(70, 175, 240);
const SKY = 0xdbe8f4;

/**
 * Three.js apartment viewer. Owns the scene and the interaction state; React subscribes
 * to state changes (`subscribe` / `getState`) and calls the action methods.
 */
export class ApartmentViewer {
  readonly blocks: Block[];
  readonly units: Unit[];
  readonly vegetation = new Vegetation();

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(32, 1, 1, 2200);
  private readonly controls: OrbitControls;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly unitByData = new Map<UnitData, Unit>();

  private state: ViewerState;
  private hovered: Unit | null = null;
  private tooltip: TooltipState | null = null;
  private listeners = new Set<() => void>();
  private tooltipListeners = new Set<() => void>();

  private flight: { start: number; fromT: THREE.Vector3; toT: THREE.Vector3; fromP: THREE.Vector3; toP: THREE.Vector3 } | null = null;
  private needsRender = true;
  private frame = 0;
  private pointerDown: [number, number] | null = null;
  private disposers: (() => void)[] = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    site: SiteData,
  ) {
    // ---------- renderer / scene / camera ----------
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, 600, 1700);

    this.camera.position.copy(OVERVIEW_POSITION);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.copy(OVERVIEW_TARGET);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 35;
    this.controls.maxDistance = 720;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.04;
    this.controls.enablePan = false;
    this.controls.addEventListener("change", () => (this.needsRender = true));

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb9c2cf, 1.15));
    const sun = new THREE.DirectionalLight(0xfff4e0, 2.1);
    sun.position.set(40, 190, 60);
    sun.target.position.set(-35, 0, -45);
    this.scene.add(sun.target);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    Object.assign(sun.shadow.camera, { left: -240, right: 190, top: 220, bottom: -190, near: 10, far: 800 });
    sun.shadow.bias = -4e-4;
    this.scene.add(sun);

    // ---------- content ----------
    const { blocks, units } = buildTowers(site.blocks, site.windows || {});
    this.blocks = blocks;
    this.units = units;
    for (const b of blocks) this.scene.add(b.group);
    for (const u of units) this.unitByData.set(u.data, u);

    const podiums = site.podiums || [];
    const towerOutlines = site.blocks.flatMap((b) => b.outlines || []);
    for (const p of podiums)
      this.scene.add(buildPodium(p, towerOutlines.concat(podiums.filter((o) => o !== p).map((o) => o.polygon))));
    buildRoofGardens(this.scene, podiums, towerOutlines, site.grass, this.vegetation);
    buildLandscape(
      this.scene,
      towerOutlines.concat(podiums.map((p) => p.polygon)),
      blocks.map((b): Point => [b.center.x, -b.center.z]),
      site.grass,
      this.vegetation,
    );

    this.state = { block: blocks[0].id, rooms: null, floor: null, selected: null, plan: null, hintHidden: false };

    this.bindEvents();
    this.updateHighlight();
    this.resize();
    this.loop();
  }

  // ---------- store ----------
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getState = () => this.state;
  subscribeTooltip = (fn: () => void) => {
    this.tooltipListeners.add(fn);
    return () => this.tooltipListeners.delete(fn);
  };
  getTooltip = () => this.tooltip;

  private setState(patch: Partial<ViewerState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }
  private setTooltip(t: TooltipState | null) {
    if (t === this.tooltip) return;
    this.tooltip = t;
    this.tooltipListeners.forEach((fn) => fn());
  }

  // ---------- queries ----------
  activeBlock() {
    return this.blocks.find((b) => b.id === this.state.block);
  }
  unitFor(data: UnitData) {
    return this.unitByData.get(data) || null;
  }
  /** Does the unit pass the room-count filter? */
  matchesFilter(u: Unit) {
    const { rooms } = this.state;
    return u.pending ? rooms == null : rooms == null || u.data.rooms === rooms;
  }
  /** Is this floor of this block faded out because another floor is isolated? */
  private isFaded(block: Block, floor: number) {
    const { floor: f, block: b } = this.state;
    return f != null && block.id === b && floor !== f;
  }

  // ---------- actions ----------
  setBlock = (id: string, fly = true) => {
    this.setState({ block: id, floor: null });
    this.updateHighlight();
    if (fly) this.flyToBlock(this.activeBlock());
  };

  setFloor = (floor: number | null) => {
    const sel = this.state.selected;
    this.setState({ floor });
    if (sel && floor != null && (sel.block.id !== this.state.block || sel.floor.floor !== floor)) this.select(null);
    this.updateHighlight();
    this.flyToFloor(this.activeBlock(), floor);
  };

  setRooms = (rooms: number | null) => {
    this.setState({ rooms });
    this.updateHighlight();
  };

  overview = () => {
    this.setState({ floor: null });
    this.updateHighlight();
    this.flyTo(OVERVIEW_TARGET.clone(), OVERVIEW_POSITION.clone());
  };

  select = (unit: Unit | null) => {
    const patch: Partial<ViewerState> = { selected: unit };
    if (unit && unit.block.id !== this.state.block) this.setBlock(unit.block.id, false);
    if (unit && this.state.floor != null && this.state.floor !== unit.floor.floor) patch.floor = unit.floor.floor;
    if (unit) patch.hintHidden = true;
    // an open plan follows the selection
    if (unit && this.state.plan) patch.plan = { block: unit.block, floor: unit.floor };
    this.setState(patch);
    this.updateHighlight();
  };

  openPlan = (block: Block, floor: FloorData) => this.setState({ plan: { block, floor } });
  closePlan = () => this.setState({ plan: null });

  /** Escape: close the plan, else clear the selection, else leave the isolated floor. */
  private onEscape() {
    if (this.state.plan) this.closePlan();
    else if (this.state.selected) this.select(null);
    else if (this.state.floor != null) this.setFloor(null);
  }

  // ---------- highlighting ----------
  private updateHighlight() {
    const { rooms, selected } = this.state;
    for (const u of this.units) {
      const faded = this.isFaded(u.block, u.floor.floor);
      const match = this.matchesFilter(u);
      let wall = u.isTop ? UNIT_COLORS.unitTop : UNIT_COLORS.unit;
      let glass = UNIT_COLORS.glass;
      if (rooms != null) {
        wall = match ? UNIT_COLORS.match : UNIT_COLORS.dim;
        glass = match ? UNIT_COLORS.hover : UNIT_COLORS.dimGlass;
      }
      if (u === this.hovered && match) {
        wall = UNIT_COLORS.hover;
        glass = UNIT_COLORS.match;
      }
      if (u === selected) {
        wall = UNIT_COLORS.selected;
        glass = UNIT_COLORS.match;
      }
      const opacity = faded ? 0.08 : 1;
      u.mesh.material.color.copy(wall);
      u.mesh.material.opacity = opacity;
      u.mesh.material.depthWrite = !faded;
      u.mesh.castShadow = !faded;
      u.edges.material.opacity = faded ? 0.04 : 0.35;
      if (u.glass) {
        u.glass.material.color.copy(glass);
        u.glass.material.opacity = opacity;
        u.glass.material.depthWrite = !faded;
      }
    }
    for (const b of this.blocks) {
      for (const [floor, { slabs }] of b.floorGroups) {
        const faded = this.isFaded(b, floor);
        for (const m of slabs) {
          m.material.opacity = faded ? 0.06 : (m.userData.baseOpacity ?? 1);
          m.material.depthWrite = !faded;
          m.castShadow = !faded;
        }
      }
      const visible = !(this.state.floor != null && b.id === this.state.block);
      for (const m of b.shell) {
        m.material.opacity = visible ? 1 : 0.05;
        m.material.depthWrite = visible;
        m.castShadow = visible;
      }
    }
    this.needsRender = true;
  }

  // ---------- camera ----------
  private flyTo(target: THREE.Vector3, position: THREE.Vector3) {
    this.flight = {
      start: performance.now(),
      fromT: this.controls.target.clone(),
      toT: target,
      fromP: this.camera.position.clone(),
      toP: position,
    };
  }
  private viewDirection() {
    return this.camera.position.clone().sub(this.controls.target).setY(0).normalize();
  }
  private flyToBlock(block: Block) {
    const mid = this.blocks.reduce((s, b) => s.add(b.center), new THREE.Vector3()).multiplyScalar(1 / this.blocks.length);
    let dir = block.center.clone().sub(mid).setY(0);
    dir = dir.length() > 5 ? dir.normalize() : this.viewDirection();
    this.flyTo(block.center.clone(), block.center.clone().add(dir.multiplyScalar(150)).add(new THREE.Vector3(0, 48, 0)));
  }
  private flyToFloor(block: Block, floor: number | null) {
    if (floor == null) return this.flyToBlock(block);
    const f = block.data.floors.find((x) => x.floor === floor);
    const target = new THREE.Vector3(block.center.x, f.level + f.height / 2, block.center.z);
    this.flyTo(target, target.clone().add(this.viewDirection().multiplyScalar(82)).add(new THREE.Vector3(0, 58, 0)));
  }

  // ---------- input ----------
  private pick(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const meshes = this.units.filter((u) => !u.pending && !this.isFaded(u.block, u.floor.floor)).map((u) => u.mesh);
    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    return hit ? (hit.object.userData.unit as Unit) : null;
  }

  private bindEvents() {
    const on = <K extends keyof HTMLElementEventMap>(
      target: HTMLElement | Window,
      type: K,
      fn: (e: HTMLElementEventMap[K]) => void,
    ) => {
      target.addEventListener(type, fn as EventListener);
      this.disposers.push(() => target.removeEventListener(type, fn as EventListener));
    };
    const c = this.canvas;
    on(c, "pointerdown", (e) => {
      this.pointerDown = [e.clientX, e.clientY];
    });
    on(c, "pointermove", (e) => {
      if (e.buttons) {
        this.setTooltip(null);
        return;
      }
      const u = this.pick(e);
      if (u !== this.hovered) {
        this.hovered = u;
        this.updateHighlight();
      }
      c.style.cursor = u ? "pointer" : "grab";
      this.setTooltip(u ? { unit: u, x: e.clientX, y: e.clientY } : null);
    });
    on(c, "pointerleave", () => {
      this.setTooltip(null);
      if (this.hovered) {
        this.hovered = null;
        this.updateHighlight();
      }
    });
    on(c, "pointerup", (e) => {
      const d = this.pointerDown;
      if (!d || Math.hypot(e.clientX - d[0], e.clientY - d[1]) > 5) return; // it was a drag
      const u = this.pick(e);
      if (u) this.select(u);
    });
    on(window, "keydown", (e) => {
      if (e.key === "Escape") this.onEscape();
    });
    on(window, "resize", () => this.resize());
  }

  private resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.needsRender = true;
  }

  private loop = () => {
    if (this.flight) {
      const t = Math.min(1, (performance.now() - this.flight.start) / 900);
      const k = 1 - Math.pow(1 - t, 3); // ease-out cubic
      this.controls.target.lerpVectors(this.flight.fromT, this.flight.toT, k);
      this.camera.position.lerpVectors(this.flight.fromP, this.flight.toP, k);
      if (t >= 1) this.flight = null;
      this.needsRender = true;
    }
    this.controls.update();
    if (this.needsRender) {
      this.renderer.render(this.scene, this.camera);
      this.needsRender = false;
    }
    this.frame = requestAnimationFrame(this.loop);
  };

  /** Forces a redraw on the next frame. */
  render = () => {
    this.needsRender = true;
  };

  dispose() {
    cancelAnimationFrame(this.frame);
    this.disposers.forEach((d) => d());
    this.controls.dispose();
    const materials = new Set<THREE.Material>();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => materials.add(x));
    });
    materials.forEach((m) => m.dispose());
    this.renderer.dispose();
    this.listeners.clear();
    this.tooltipListeners.clear();
  }
}
