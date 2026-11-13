// Data model of public/data/site.json (formerly inlined as window.__SITE__).

export type Point = [number, number];
export type Polygon = Point[];

export interface UnitData {
  id: string;
  type: string;
  rooms: number;
  areaTotal: number | null;
  areaLiving: number | null;
  areaPolygon?: number;
  polygon: Polygon;
  pending?: boolean;
}

export interface Opening {
  mark: string;
  x: number;
  y: number;
}

export interface FloorData {
  floor: number;
  level: number;
  height: number;
  plan?: { image: string; bounds: [number, number, number, number] };
  footprint: Polygon;
  slab?: Polygon;
  core?: Polygon;
  cores?: Polygon[];
  units: UnitData[];
  openings?: Opening[];
  pending?: boolean;
}

export interface BlockData {
  shape: "tip1" | "generic" | string;
  floorsTotal: number;
  roofLevel: number;
  roofs?: { level: number; polygon: Polygon }[];
  podium: { floors: number[]; level: number; height: number; use: string; footprint: Polygon };
  floors: FloorData[];
  [key: string]: unknown;
}

export interface SiteBlock {
  id: string;
  label?: string;
  sub?: string;
  file: string;
  position: Point;
  rotation?: number;
  data: BlockData;
  outlines?: Polygon[];
}

export interface Podium {
  id: string;
  label?: string;
  height: number;
  polygon: Polygon;
  roof?: "deck" | string;
  flat?: boolean;
}

export interface WindowType {
  w: number;
  h: number;
  panels: number[];
  bar: number;
  door: boolean;
}

export interface GrassData {
  height: number;
  variants: number[][];
  far: number[][];
}

export interface SiteData {
  project: string;
  note?: string;
  blocks: SiteBlock[];
  podiums?: Podium[];
  grass?: GrassData;
  windows?: Record<string, WindowType>;
}
