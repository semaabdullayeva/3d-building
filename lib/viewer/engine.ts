import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { FloorData, Point, SaleStatus, SiteData, UnitData } from "../types";
import { buildPodium, buildRoofGardens, buildTowers, UNIT_COLORS, UNIT_OVERLAYS, type Block, type Unit } from "./buildings";
import { smoothstep, sunDirection } from "./daylight";
import { addSky, effectsEnabled, makePipeline, type Pipeline, type SkyHandle } from "./effects";
import { buildLandscape } from "./landscape";
import { Vegetation } from "./vegetation";

export type { Block, Unit };

export interface ViewerState {
  /** id of the active block */
  block: string;
  /** room-count filter (null = all) */
  rooms: number | null;
  /** total-area filter in m², inclusive (null = all) */
  area: [number, number] | null;
  /** sale statuses to show (empty = all, no status colouring) */
  statuses: SaleStatus[];
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
const SKY = 0xdbe8f4; // background when the sky effect is off
const FOG = 0xcfdfee;
const SUN_TARGET = new THREE.Vector3(-35, 0, -45);
const DEFAULT_SUN = new THREE.Vector3(40, 190, 60).sub(SUN_TARGET).normalize();
const MOON = new THREE.Vector3(-0.35, 0.8, 0.45).normalize();
const DEG = Math.PI / 180;
// time-of-day colours: [day, low sun, night]
const TOD = {
  sun: [0xfff4e0, 0xff9b52],
  hemiSky: [0xffffff, 0xffd6b0, 0x3e5078],
  hemiGround: [0xb9c2cf, 0xb9a898, 0x141922],
  fog: [FOG, 0xf0cdaa, 0x0f1724],
  background: [SKY, 0xf2d2b0, 0x0d1626],
};
const mixTod = (out: THREE.Color, [day, low, night]: number[], lowK: number, nightK: number) =>
  out.set(day).lerp(new THREE.Color(low), lowK).lerp(new THREE.Color(night ?? low), nightK);

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
  // near plane kept far out: better depth precision on a large site
  private readonly camera = new THREE.PerspectiveCamera(32, 1, 4, 2400);
  private readonly controls: OrbitControls;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly unitByData = new Map<UnitData, Unit>();
  private readonly pipeline: Pipeline;
  private disposeSky: (() => void) | null = null;
  private readonly fx: boolean;
  private readonly sun: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;
  private readonly hemiBase: number;
  private readonly exposureBase: number;
  private readonly sky: SkyHandle | null;
  private lampMaterials: THREE.MeshStandardMaterial[] = [];
  private nightObjects: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[] = [];
  private timeOfDay: number | null = null;
  private litFraction = 0;
  private envTimer = 0;

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
    private readonly sales: Record<string, SaleStatus> = {},
  ) {
    // ---------- renderer / scene / camera ----------
    const fx = effectsEnabled(); // sky, reflections and ambient occlusion (`?fx=0` turns them off)
    this.fx = fx;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.exposureBase = fx ? 1.0 : 1.05;
    this.renderer.toneMappingExposure = this.exposureBase;

    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(FOG, 700, 2100);

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

    // with effects on, the sky environment supplies part of the ambient light
    this.hemiBase = fx ? 1.05 : 1.15;
    this.hemi = new THREE.HemisphereLight(0xffffff, 0xb9c2cf, this.hemiBase);
    this.scene.add(this.hemi);
    const sun = new THREE.DirectionalLight(0xfff4e0, 2.1);
    this.sun = sun;
    sun.position.set(40, 190, 60);
    sun.target.position.copy(SUN_TARGET);
    this.scene.add(sun.target);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    Object.assign(sun.shadow.camera, { left: -240, right: 190, top: 220, bottom: -190, near: 10, far: 800 });
    sun.shadow.bias = -4e-4;
    this.scene.add(sun);
    const sky = fx ? addSky(this.renderer, this.scene, sun) : null;
    this.sky = sky;
    const env = sky ? sky.texture : null;
    this.disposeSky = sky ? () => sky.dispose() : null;
    // redraw once textures have loaded
    THREE.DefaultLoadingManager.onLoad = () => (this.needsRender = true);

    // ---------- content ----------
    const { blocks, units } = buildTowers(site.blocks, site.windows || {}, env);
    this.blocks = blocks;
    this.units = units;
    for (const b of blocks) this.scene.add(b.group);
    for (const u of units) this.unitByData.set(u.data, u);

    const podiums = site.podiums || [];
    const towerOutlines = site.blocks.flatMap((b) => b.outlines || []);
    for (const p of podiums)
      this.scene.add(buildPodium(p, towerOutlines.concat(podiums.filter((o) => o !== p).map((o) => o.polygon)), env));
    buildRoofGardens(this.scene, podiums, towerOutlines, this.vegetation);
    buildLandscape(
      this.scene,
      towerOutlines.concat(podiums.map((p) => p.polygon)),
      blocks.map((b): Point => [b.center.x, -b.center.z]),
      this.vegetation,
    );

    // lamp heads and the light pools under them follow the time of day
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && !Array.isArray(m) && m.userData.lamp != null && !this.lampMaterials.includes(m)) this.lampMaterials.push(m);
      if (o.userData.night) this.nightObjects.push(o as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>);
    });

    this.pipeline = makePipeline(this.renderer, this.scene, this.camera, fx);

    this.state = {
      block: blocks[0].id, rooms: null, area: null, statuses: [], floor: null, selected: null, plan: null, hintHidden: false,
    };

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
  /** Sale status of a unit; null for units without apartment data. */
  statusOf(u: Unit): SaleStatus | null {
    return u.pending ? null : (this.sales[u.data.id] ?? "available");
  }
  /** Does the unit pass the room-count, area and status filters? */
  matchesFilter(u: Unit) {
    const { rooms, area, statuses } = this.state;
    if (u.pending) return rooms == null && area == null && statuses.length === 0;
    if (rooms != null && u.data.rooms !== rooms) return false;
    if (statuses.length && !statuses.includes(this.statusOf(u)!)) return false;
    const a = u.data.areaTotal;
    return area == null || (a != null && a >= area[0] && a <= area[1]);
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

  setArea = (area: [number, number] | null) => {
    this.setState({ area });
    this.updateHighlight();
  };

  setStatuses = (statuses: SaleStatus[]) => {
    this.setState({ statuses });
    this.updateHighlight();
  };

  /** Highlight a unit from outside the canvas (e.g. a list row). */
  hover = (unit: Unit | null) => {
    if (unit === this.hovered) return;
    this.hovered = unit;
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

  // ---------- time of day ----------
  /**
   * Sun position, light colours, sky and night lighting for `hours` (e.g. 17.5 = 17:30);
   * null restores the default daylight and hides the sun path.
   */
  setTimeOfDay = (hours: number | null) => {
    this.timeOfDay = hours;
    const timed = hours != null;
    const dir = timed ? sunDirection(hours) : DEFAULT_SUN.clone();
    const alt = Math.asin(dir.y) / DEG;
    const nightK = timed ? 1 - smoothstep(-7, 2, alt) : 0;
    const lowK = timed ? (1 - smoothstep(5, 28, alt)) * (1 - nightK) : 0;
    const sunK = timed ? smoothstep(-1.5, 3.5, alt) : 1;
    const moonK = timed ? 1 - smoothstep(-6, -1.5, alt) : 0;

    // sun by day, a faint blue moon at night (one light, so one shadow map)
    const sun = this.sun;
    const c = new THREE.Color();
    if (sunK > 0 || !timed) {
      sun.position.copy(SUN_TARGET).addScaledVector(dir, 420);
      sun.color.set(TOD.sun[0]).lerp(c.set(TOD.sun[1]), timed ? 1 - smoothstep(2, 30, alt) : 0);
      sun.intensity = 2.1 * sunK * (1 - 0.25 * lowK);
    } else {
      sun.position.copy(SUN_TARGET).addScaledVector(MOON, 420);
      sun.color.set(0x9db4ff);
      sun.intensity = 0.45 * moonK;
    }
    Object.assign(
      sun.shadow.camera,
      timed ? { left: -235, right: 235, top: 225, bottom: -225, far: 900 } : { left: -240, right: 190, top: 220, bottom: -190, far: 800 },
    );
    sun.shadow.camera.updateProjectionMatrix();

    mixTod(this.hemi.color, TOD.hemiSky, lowK, nightK);
    mixTod(this.hemi.groundColor, TOD.hemiGround, lowK, nightK);
    this.hemi.intensity = this.hemiBase * (1 - nightK) + 0.55 * nightK;
    if (this.scene.fog) mixTod(this.scene.fog.color, TOD.fog, lowK, nightK);
    if (this.scene.background instanceof THREE.Color) mixTod(this.scene.background, TOD.background, lowK, nightK);
    this.renderer.toneMappingExposure = this.exposureBase + 0.2 * nightK;

    // sky dome follows at once; the reflection map is re-rendered once the slider rests
    if (this.sky) {
      this.sky.setSun(dir, nightK);
      clearTimeout(this.envTimer);
      this.envTimer = window.setTimeout(() => this.refreshEnvironment(), 160);
    }

    // street and courtyard lights come on at dusk, windows light up one by one
    const lampK = timed ? 1 - smoothstep(-4, 2.5, alt) : 0;
    for (const m of this.lampMaterials) m.emissiveIntensity = m.userData.lamp + (4 - m.userData.lamp) * lampK;
    for (const o of this.nightObjects) {
      o.visible = lampK > 0.02;
      o.material.opacity = (o.userData.strength ?? 0.5) * lampK;
    }
    const lit = Math.round(0.72 * (timed ? 1 - smoothstep(-7, 3, alt) : 0) * 50) / 50;
    if (lit !== this.litFraction) {
      this.litFraction = lit;
      this.updateWindowGlow();
    }

    this.needsRender = true;
  };

  getTimeOfDay = () => this.timeOfDay;

  private refreshEnvironment() {
    if (!this.sky) return;
    const { previous, texture } = this.sky.refreshEnvironment();
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[] | undefined;
      if (!m) return;
      for (const x of Array.isArray(m) ? m : [m]) if (x.envMap === previous) x.envMap = texture;
    });
    this.needsRender = true;
  }

  /** Colours each pane's glow: lit (its apartment's seed is under the lit fraction) or black. */
  private updateWindowGlow() {
    const frac = this.litFraction;
    const c = new THREE.Color();
    for (const b of this.blocks)
      for (const g of b.glows) {
        if (frac > 0) {
          for (let i = 0; i < g.seed.length; i++) {
            if (g.seed[i] < frac) c.fromArray(g.tint, i * 3);
            else c.setRGB(0, 0, 0);
            g.mesh.setColorAt(i, c);
          }
          g.mesh.instanceColor!.needsUpdate = true;
        }
      }
    this.updateGlowVisibility();
  }

  private updateGlowVisibility() {
    for (const b of this.blocks) for (const g of b.glows) g.mesh.visible = this.litFraction > 0 && !this.isFaded(b, g.floor);
  }

  /** Escape: close the plan, else clear the selection, else leave the isolated floor. */
  private onEscape() {
    if (this.state.plan) this.closePlan();
    else if (this.state.selected) this.select(null);
    else if (this.state.floor != null) this.setFloor(null);
  }

  // ---------- highlighting ----------
  private updateHighlight() {
    const { rooms, area, statuses, selected } = this.state;
    const filtering = rooms != null || area != null || statuses.length > 0;
    for (const u of this.units) {
      const faded = this.isFaded(u.block, u.floor.floor);
      const match = this.matchesFilter(u);
      let wall = u.isTop ? UNIT_COLORS.unitTop : UNIT_COLORS.unit;
      let glass = UNIT_COLORS.glass;
      if (filtering) {
        wall = match ? UNIT_COLORS.match : UNIT_COLORS.dim;
        glass = match ? UNIT_COLORS.hover : UNIT_COLORS.dimGlass;
        // with a status filter on, matching apartments wear their status colour
        if (match && statuses.length) {
          wall = UNIT_COLORS.status[this.statusOf(u)!];
          glass = UNIT_COLORS.glass;
        }
      }
      let overlay: THREE.Material | null = null;
      if (filtering && match) overlay = statuses.length ? UNIT_OVERLAYS[this.statusOf(u)!] : UNIT_OVERLAYS.match;
      if (u === this.hovered && match) overlay = UNIT_OVERLAYS.hover;
      if (u === selected) overlay = UNIT_OVERLAYS.selected;
      if (u.overlay) {
        u.overlay.visible = !!overlay && !faded;
        if (overlay) u.overlay.material = overlay;
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
        // panes are instances of the floor's pane mesh; its opacity is set with the rest of the floor below
        const { mesh, start, count } = u.glass;
        for (let i = 0; i < count; i++) mesh.setColorAt(start + i, glass);
        mesh.instanceColor.needsUpdate = true;
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
    this.updateGlowVisibility();
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
    this.pipeline.setSize(w, h);
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
      // an isolated floor is shown among faded ones: no occlusion from those
      this.pipeline.setAO(this.state.floor == null);
      this.pipeline.render();
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
    clearTimeout(this.envTimer);
    this.disposers.forEach((d) => d());
    this.controls.dispose();
    const materials = new Set<THREE.Material>();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => materials.add(x));
    });
    materials.forEach((m) => m.dispose());
    this.pipeline.dispose();
    this.disposeSky?.();
    THREE.DefaultLoadingManager.onLoad = () => {};
    this.renderer.dispose();
    this.listeners.clear();
    this.tooltipListeners.clear();
  }
}
