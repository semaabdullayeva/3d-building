"use client";

import { formatArea, t } from "@/lib/i18n";
import type { UnitData } from "@/lib/types";
import type { Unit } from "@/lib/viewer/engine";
import { FloorPlanSvg } from "./FloorPlanSvg";
import { CloseIcon } from "./CloseIcon";

interface Props {
  unit: Unit;
  onClose: () => void;
  onOpenPlan: () => void;
  onSelectData: (u: UnitData) => void;
}

export function UnitPanel({ unit, onClose, onOpenPlan, onSelectData }: Props) {
  const d = unit.data;
  const f = unit.floor;
  const specs: [string, string | number][] = [
    [t.type, d.type],
    [t.roomsLabel, d.rooms],
    [t.areaTotal, `${formatArea(d.areaTotal)} ${t.m2}`],
    [t.areaLiving, `${formatArea(d.areaLiving)} ${t.m2}`],
    [t.floor, `${f.floor} / ${unit.block.data.floorsTotal}`],
    [t.level, `+${f.level.toFixed(3)} m`],
  ];
  return (
    <aside className="panel">
      <button className="icon-btn panel-close" aria-label={t.close} onClick={onClose}>
        <CloseIcon />
      </button>
      <div className="panel-eyebrow">
        {t.block(unit.block.label)} · {t.floor} {f.floor} · {t.rooms(d.rooms)}
      </div>
      <h2 className="panel-title">
        {t.apartment} {d.id}
      </h2>
      <dl className="specs">
        {specs.map(([k, v]) => (
          <div key={k} style={{ display: "contents" }}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <button className="btn" type="button" onClick={onOpenPlan}>
        {t.viewPlan}
      </button>
      <FloorPlanSvg
        className="mini-plan"
        floor={f}
        image={false}
        isSelected={(u) => u === d}
        isDimmed={() => false}
        onSelect={onSelectData}
      />
    </aside>
  );
}
