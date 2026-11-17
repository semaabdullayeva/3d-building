"use client";

import { useState } from "react";
import { t } from "@/lib/i18n";
import type { UnitData } from "@/lib/types";
import type { Unit } from "@/lib/viewer/engine";
import { ApartmentPlanSheet } from "./ApartmentPlanSheet";
import { ApartmentView3D } from "./ApartmentView3D";
import { CloseIcon } from "./CloseIcon";
import { FloorPlanSvg } from "./FloorPlanSvg";

type Tab = "apartment" | "floor" | "3d";

const TABS: { id: Tab; label: string }[] = [
  { id: "apartment", label: "Mənzil planı" },
  { id: "floor", label: "Mərtəbə planı" },
  { id: "3d", label: "3D görünüş" },
];

const PADDING = 2;
const pts = (poly: [number, number][]) => poly.map(([x, y]) => `${x},${-y}`).join(" ");

interface Props {
  unit: Unit;
  isSelected: (u: UnitData) => boolean;
  isDimmed: (u: UnitData) => boolean;
  onSelect: (u: UnitData) => void;
  onClose: () => void;
}

export function ApartmentPlanModal({ unit, isSelected, isDimmed, onSelect, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("apartment");

  const d = unit.data;
  const f = unit.floor;
  const poly = d.polygon;
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  const x0 = Math.min(...xs) - PADDING, y0 = Math.min(...ys) - PADDING;
  const x1 = Math.max(...xs) + PADDING, y1 = Math.max(...ys) + PADDING;

  return (
    <div className="apt-modal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="apt-modal-card" role="dialog" aria-modal="true" aria-label={`Mənzil ${d.type}`}>
        <header className="apt-head">
          <div className="apt-head-text">
            <div className="apt-kicker">
              Blok {unit.block.label} · {f.floor}-cü mərtəbə · {d.rooms} otaqlı
            </div>
            <h2 className="apt-title">Mənzil {d.type}</h2>
          </div>

          <nav className="apt-tabs" aria-label="Görünüş">
            {TABS.map(({ id, label }) => (
              <button
                key={id}
                className={`apt-tab${tab === id ? " apt-tab--active" : ""}`}
                aria-pressed={tab === id}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </nav>

          <button className="apt-close" aria-label={t.close} onClick={onClose}>
            <CloseIcon />
          </button>
        </header>

        <div className={`apt-modal-view${tab === "3d" ? " apt-modal-view--3d" : ""}`}>
          {tab === "apartment" && (f.plan ? (
            <ApartmentPlanSheet unit={unit} />
          ) : (
            <svg className="apt-plan-svg" viewBox={`${x0} ${-y1} ${x1 - x0} ${y1 - y0}`}>
              <polygon points={pts(poly)} fill="rgba(107,164,58,0.1)" stroke="#45604f" strokeWidth="0.13" />
            </svg>
          ))}

          {tab === "floor" && (
            <FloorPlanSvg
              className="apt-plan-svg"
              floor={f}
              image
              isSelected={isSelected}
              isDimmed={isDimmed}
              onSelect={onSelect}
            />
          )}

          {tab === "3d" && <ApartmentView3D unit={unit} />}
        </div>
      </div>
    </div>
  );
}
