"use client";

import { formatArea, t } from "@/lib/i18n";
import type { SaleStatus } from "@/lib/types";
import type { Unit } from "@/lib/viewer/engine";
import { ApartmentPlanImage } from "./ApartmentPlanSheet";
import { CloseIcon } from "./CloseIcon";

interface Props {
  unit: Unit;
  status: SaleStatus | null;
  onClose: () => void;
  onOpenApartmentPlan: () => void;
  onOpenFloorPlan: () => void;
}

/** Glass card for the selected apartment: its plan, key figures and the plan actions. */
export function ApartmentCard({ unit, status, onClose, onOpenApartmentPlan, onOpenFloorPlan }: Props) {
  const d = unit.data;
  const f = unit.floor;
  const facts: [string, string][] = [
    [t.areaTotal, `${formatArea(d.areaTotal)} ${t.m2}`],
    [t.areaLiving, `${formatArea(d.areaLiving)} ${t.m2}`],
    [t.roomsLabel, String(d.rooms)],
    [t.floor, `${f.floor} / ${unit.block.data.floorsTotal}`],
  ];

  return (
    <aside className="apt-card site-panel" aria-label={`${t.apartment} ${d.id}`}>
      <header className="apt-card-head">
        <div>
          <div className="apt-kicker">
            {t.block(unit.block.label)} · {f.floor}-cü mərtəbə · {t.rooms(d.rooms)}
          </div>
          <h2 className="apt-title">Mənzil {d.type}</h2>
          {status && (
            <div className={`status-pill status-pill--${status}`}>
              <span className={`status-swatch status-swatch--${status}`} aria-hidden="true" />
              {t.status[status]}
            </div>
          )}
        </div>
        <button className="apt-close" type="button" aria-label={t.close} onClick={onClose}>
          <CloseIcon />
        </button>
      </header>

      <button className="apt-card-plan" type="button" onClick={onOpenApartmentPlan} aria-label="Planı böyüt">
        <ApartmentPlanImage unit={unit} />
      </button>

      <dl className="apt-card-facts">
        {facts.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>

      <div className="apt-card-actions">
        <button className="apt-tab apt-tab--active" type="button" onClick={onOpenApartmentPlan}>
          {t.viewApartmentPlan}
        </button>
        <button className="apt-tab" type="button" onClick={onOpenFloorPlan}>
          {t.viewPlan}
        </button>
      </div>
    </aside>
  );
}
