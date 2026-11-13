"use client";

import { t } from "@/lib/i18n";
import type { Block } from "@/lib/viewer/engine";

interface Props {
  block: Block;
  floor: number | null;
  rooms: number | null;
  onFloor: (floor: number | null) => void;
}

/** Vertical floor picker, top floor first. Floors without apartments (podium) are disabled. */
export function FloorNav({ block, floor, rooms, onFloor }: Props) {
  const numbers = Array.from({ length: block.data.floorsTotal }, (_, i) => block.data.floorsTotal - i);
  return (
    <nav className="floors" aria-label="Floors">
      <div className="floors-label">{t.floors}</div>
      {numbers.map((n) => {
        const f = block.data.floors.find((x) => x.floor === n);
        if (!f)
          return (
            <button key={n} className="floor-btn" disabled title={t.nonResidential}>
              {n}
            </button>
          );
        const faint = f.pending || (rooms != null && !f.units.some((u) => u.rooms === rooms));
        return (
          <button
            key={n}
            className="floor-btn"
            aria-pressed={floor === n}
            title={f.pending ? t.pendingFloor : undefined}
            style={faint ? { opacity: 0.35 } : undefined}
            onClick={() => onFloor(floor === n ? null : n)}
          >
            {n}
          </button>
        );
      })}
    </nav>
  );
}
