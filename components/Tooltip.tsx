"use client";

import { useSyncExternalStore } from "react";
import { formatArea, t } from "@/lib/i18n";
import type { ApartmentViewer } from "@/lib/viewer/engine";

/** Hover tooltip; subscribes separately so pointer moves don't re-render the rest of the UI. */
export function Tooltip({ viewer }: { viewer: ApartmentViewer }) {
  const tip = useSyncExternalStore(viewer.subscribeTooltip, viewer.getTooltip, () => null);
  if (!tip) return null;
  const { unit, x, y } = tip;
  return (
    <div className="tooltip" style={{ left: x, top: y }}>
      <b>
        {unit.data.type} · {formatArea(unit.data.areaTotal)} {t.m2}
      </b>
      {t.block(unit.block.label)} · {t.floor} {unit.floor.floor} · {t.rooms(unit.data.rooms)}
    </div>
  );
}
