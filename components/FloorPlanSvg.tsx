"use client";

import type { FloorData, Polygon, UnitData } from "@/lib/types";
import { formatArea, t } from "@/lib/i18n";
import { centroid } from "@/lib/viewer/geometry";

// SVG y axis points down, plan y points north.
const points = (poly: Polygon) => poly.map(([x, y]) => `${x},${-y}`).join(" ");

interface Props {
  floor: FloorData;
  /** true: drawing image underlay with invisible hit areas; false: schematic mini plan */
  image: boolean;
  className: string;
  isSelected: (u: UnitData) => boolean;
  isDimmed: (u: UnitData) => boolean;
  onSelect: (u: UnitData) => void;
}

export function FloorPlanSvg({ floor, image, className, isSelected, isDimmed, onSelect }: Props) {
  const withImage = image && !!floor.plan;
  let [x0, y0, x1, y1] = floor.plan?.bounds ?? [0, 0, 0, 0];
  if (!withImage) {
    const xs = floor.footprint.map((p) => p[0]);
    const ys = floor.footprint.map((p) => p[1]);
    [x0, y0, x1, y1] = [Math.min(...xs) - 0.5, Math.min(...ys) - 0.5, Math.max(...xs) + 0.5, Math.max(...ys) + 0.5];
  }

  return (
    <svg className={className} viewBox={`${x0} ${-y1} ${x1 - x0} ${y1 - y0}`}>
      {withImage ? (
        <image
          href={`/plans/${floor.plan.image}`}
          x={floor.plan.bounds[0]}
          y={-floor.plan.bounds[3]}
          width={floor.plan.bounds[2] - floor.plan.bounds[0]}
          height={floor.plan.bounds[3] - floor.plan.bounds[1]}
          preserveAspectRatio="none"
        />
      ) : (
        floor.core && <polygon points={points(floor.core)} className="mini-core" />
      )}
      {floor.units.map((u) => {
        const cls = ["u-poly"];
        if (isSelected(u)) cls.push("is-selected");
        else if (withImage && isDimmed(u)) cls.push("is-dim");
        const [lx, ly] = withImage ? [0, 0] : centroid(u.polygon);
        return (
          <g key={u.id}>
            <polygon points={points(u.polygon)} className={cls.join(" ")} onClick={() => onSelect(u)}>
              <title>{`${u.type} · ${formatArea(u.areaTotal)} ${t.m2}`}</title>
            </polygon>
            {!withImage && (
              <text x={lx} y={-ly + 0.4} className="u-label">
                {u.type}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
