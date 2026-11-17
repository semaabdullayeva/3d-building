"use client";

import { useId } from "react";
import { apartmentLayout, TOWER_CORE, type LayoutMatch } from "@/lib/apartmentLayouts";
import { formatArea, t } from "@/lib/i18n";
import type { FloorData, Polygon, UnitData } from "@/lib/types";
import { centroid, pointInPolygon } from "@/lib/viewer/geometry";
import { HatchDef, LayoutShapes, layoutBounds } from "./ApartmentPlanDrawing";

const PAPER = "#fcf9f0";
const INK = "#24272a";

/** Soft, clearly different floor tones, one per apartment on a floor. */
export const UNIT_TONES = ["#f2dccb", "#d8e7d3", "#d3e0ef", "#efe2bd", "#e3d6ec", "#cfe7e4", "#f1d4d7", "#e4e1cf"];

const points = (poly: Polygon) => poly.map(([x, y]) => `${x},${-y}`).join(" ");

/** A spot for the unit badge inside the outline, clear of the room area labels. */
function badgeSpot(outline: Polygon, m: LayoutMatch): [number, number] {
  const [cx, cy] = centroid(outline);
  const labels = m.layout.rooms.map((r) => {
    const [x, y] = r.at ?? [(r.r[0] + r.r[2]) / 2, (r.r[1] + r.r[3]) / 2];
    return [m.mirror ? -x : x, y] as [number, number];
  });
  let best: [number, number] = [cx, cy];
  let bestGap = -1;
  for (let ring = 0; ring <= 4; ring++)
    for (let k = 0; k < (ring ? 8 : 1); k++) {
      const a = (k / 8) * Math.PI * 2;
      const x = cx + Math.cos(a) * ring * 0.9;
      const y = cy + Math.sin(a) * ring * 0.9;
      if (!pointInPolygon(x, y, outline)) continue;
      const gap = Math.min(...labels.map(([lx, ly]) => Math.hypot((lx - x) / 1.6, (ly - y) / 0.8)));
      if (gap >= 1.6) return [x, y];
      if (gap > bestGap) [best, bestGap] = [[x, y], gap];
    }
  return best;
}

/** Two stair flights with landings and the two lift shafts of the tower core (plan metres, drawn at (x, -y)). */
function CoreWells({ hatchId }: { hatchId: string }) {
  const [sx0, sy0, sx1, sy1] = TOWER_CORE.stairs;
  const mid = (sx0 + sx1) / 2;
  const landing = 1.25;
  const treads: number[] = [];
  for (let y = sy0 + landing; y <= sy1 - landing + 1e-6; y += 0.3) treads.push(y);
  return (
    <g transform="scale(1,-1)" fill="none" stroke={INK} strokeWidth={0.015}>
      <rect x={sx0} y={sy0} width={sx1 - sx0} height={sy1 - sy0} fill={PAPER} />
      {treads.map((y) => (
        <g key={y}>
          <line x1={sx0} y1={y} x2={mid - 0.08} y2={y} />
          <line x1={mid + 0.08} y1={y} x2={sx1} y2={y} />
        </g>
      ))}
      <rect x={mid - 0.08} y={sy0 + landing} width={0.16} height={sy1 - sy0 - 2 * landing} fill={`url(#${hatchId})`} strokeWidth={0.02} />
      <path d={`M ${(sx0 + mid) / 2} ${sy0 + landing + 0.2} V ${sy1 - landing - 0.1} m -0.12 -0.18 l 0.12 0.18 l 0.12 -0.18`} strokeWidth={0.02} />
      {TOWER_CORE.lifts.map(([x0, y0, x1, y1], i) => (
        <g key={i}>
          <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill={PAPER} strokeWidth={0.025} />
          <rect x={x0 + 0.2} y={y0 + 0.2} width={x1 - x0 - 0.4} height={y1 - y0 - 0.4} />
          <line x1={x0 + 0.2} y1={y0 + 0.2} x2={x1 - 0.2} y2={y1 - 0.2} />
          <line x1={x0 + 0.2} y1={y1 - 0.2} x2={x1 - 0.2} y2={y0 + 0.2} />
        </g>
      ))}
    </g>
  );
}

/** Vector layouts for every unit of the floor, or null when any unit has none (then the sheet image is used). */
export function floorLayouts(floor: FloorData): LayoutMatch[] | null {
  const matches = floor.units.map((u) => apartmentLayout(floor.plan?.image, u.type));
  return matches.length && matches.every(Boolean) ? (matches as LayoutMatch[]) : null;
}

interface Props {
  floor: FloorData;
  matches: LayoutMatch[];
  className: string;
  isSelected: (u: UnitData) => boolean;
  isDimmed: (u: UnitData) => boolean;
  onSelect: (u: UnitData) => void;
}

/** Whole floor drawn from the apartment layouts, each apartment in its own tone, with clickable units. */
export function FloorPlanDrawing({ floor, matches, className, isSelected, isDimmed, onSelect }: Props) {
  const hatchId = useId().replace(/:/g, "");
  const plate = floor.slab ?? floor.footprint;
  const cores = floor.cores?.length ? floor.cores : floor.core ? [floor.core] : [];

  const xs = plate.map((p) => p[0]);
  const ys = plate.map((p) => p[1]);
  for (const m of matches) {
    const [a, b, c, d] = layoutBounds(m.layout);
    xs.push(m.mirror ? -c : a, m.mirror ? -a : c);
    ys.push(b, d);
  }
  const M = 0.8;
  const [x0, y0, x1, y1] = [Math.min(...xs) - M, Math.min(...ys) - M, Math.max(...xs) + M, Math.max(...ys) + M];

  return (
    <svg className={`${className} floor-drawing`} viewBox={`${x0} ${-y1} ${x1 - x0} ${y1 - y0}`} preserveAspectRatio="xMidYMid meet">
      <defs>
        <HatchDef id={hatchId} />
      </defs>
      <rect x={x0} y={-y1} width={x1 - x0} height={y1 - y0} fill={PAPER} />
      <polygon points={points(plate)} fill={PAPER} stroke={INK} strokeWidth={0.04} />
      {cores.map((c, i) => (
        <g key={`core${i}`}>
          <polygon points={points(c)} fill="#e9e5dc" />
          <polygon points={points(c)} fill={`url(#${hatchId})`} stroke={INK} strokeWidth={0.05} />
        </g>
      ))}

      <CoreWells hatchId={hatchId} />

      {matches.map((m, i) => (
        <g key={floor.units[i].id}>
          <LayoutShapes match={m} hatchId={hatchId} tint={UNIT_TONES[i % UNIT_TONES.length]} outline={floor.units[i].polygon} />
        </g>
      ))}

      {floor.units.map((u, i) => {
        const [cx, cy] = badgeSpot(u.polygon, matches[i]);
        return (
          <g key={`badge${u.id}`} className="floor-badge" transform={`translate(${cx} ${-cy})`}>
            <circle r={0.82} fill="#ffffff" stroke={INK} strokeWidth={0.04} />
            <circle r={0.66} fill={UNIT_TONES[i % UNIT_TONES.length]} />
            <text y={0.2} fontSize={0.56} fontWeight={700} fill={INK} textAnchor="middle">
              {u.type}
            </text>
          </g>
        );
      })}

      {floor.units.map((u) => {
        const cls = ["u-poly"];
        if (isSelected(u)) cls.push("is-selected");
        else if (isDimmed(u)) cls.push("is-dim");
        return (
          <polygon key={`hit${u.id}`} points={points(u.polygon)} className={cls.join(" ")} onClick={() => onSelect(u)}>
            <title>{`${u.type} · ${formatArea(u.areaTotal)} ${t.m2}`}</title>
          </polygon>
        );
      })}
    </svg>
  );
}
