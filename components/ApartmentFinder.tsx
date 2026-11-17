"use client";

import { useMemo, useState } from "react";
import { formatArea, t } from "@/lib/i18n";
import type { SaleStatus } from "@/lib/types";
import type { ApartmentViewer, Unit, ViewerState } from "@/lib/viewer/engine";
import { ApartmentPlanImage } from "./ApartmentPlanSheet";

const STATUSES: SaleStatus[] = ["available", "reserved", "sold"];

interface Props {
  viewer: ApartmentViewer;
  state: ViewerState;
}

/** Left glass panel: block / rooms / area filters and the list of matching apartments. */
export function ApartmentFinder({ viewer, state }: Props) {
  const [open, setOpen] = useState(() => typeof window === "undefined" || window.innerWidth > 760);
  const [peek, setPeek] = useState<Unit | null>(null);
  const block = viewer.blocks.find((b) => b.id === state.block)!;
  const known = useMemo(() => block.units.filter((u) => !u.pending && u.data.areaTotal != null), [block]);

  const roomOptions = useMemo(() => [...new Set(known.map((u) => u.data.rooms))].sort((a, b) => a - b), [known]);
  const statusCounts = useMemo(() => {
    const c: Record<SaleStatus, number> = { available: 0, reserved: 0, sold: 0 };
    for (const u of known) c[viewer.statusOf(u)!]++;
    return c;
  }, [known, viewer]);
  const [lo, hi] = useMemo(() => {
    const areas = known.map((u) => u.data.areaTotal!);
    return [Math.floor(Math.min(...areas)), Math.ceil(Math.max(...areas))];
  }, [known]);
  const range: [number, number] = state.area ?? [lo, hi];

  const list = known
    .filter((u) => viewer.matchesFilter(u))
    .sort((a, b) => b.floor.floor - a.floor.floor || a.data.type.localeCompare(b.data.type));

  const setRange = (next: [number, number]) =>
    viewer.setArea(next[0] <= lo && next[1] >= hi ? null : next);

  const choose = (u: Unit) => {
    setPeek(null);
    viewer.select(u);
    if (state.floor !== u.floor.floor) viewer.setFloor(u.floor.floor);
  };

  const filtered = state.rooms != null || state.area != null || state.statuses.length > 0 || state.floor != null;

  return (
    <>
    <section className={`finder glass${open ? "" : " finder--closed"}`} aria-label="Mənzil seçimi">
      <button className="finder-head" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        <h2 className="glass-title">Mənzil seçimi</h2>
        <span className="finder-chevron" aria-hidden="true" />
      </button>

      {open && (
        <>
          <div className="finder-filters">
            <div className="finder-group">
              <div className="glass-label">Blok</div>
              <div className="chip-row">
                {viewer.blocks.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    className="chip"
                    aria-pressed={b.id === state.block}
                    onClick={() => viewer.setBlock(b.id, true)}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="finder-group">
              <div className="glass-label">{t.statusLabel}</div>
              <div className="status-list">
                {STATUSES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="status-toggle"
                    aria-pressed={state.statuses.includes(s)}
                    onClick={() =>
                      viewer.setStatuses(
                        state.statuses.includes(s) ? state.statuses.filter((x) => x !== s) : [...state.statuses, s],
                      )
                    }
                  >
                    <span className={`status-swatch status-swatch--${s}`} aria-hidden="true" />
                    <span className="status-name">{t.status[s]}</span>
                    <span className="status-count">{statusCounts[s]}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="finder-group">
              <div className="glass-label">Otaq sayı</div>
              <div className="chip-row">
                {roomOptions.map((n) => (
                  <button
                    key={n}
                    type="button"
                    className="chip chip--round"
                    aria-pressed={state.rooms === n}
                    onClick={() => viewer.setRooms(state.rooms === n ? null : n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <div className="finder-group">
              <div className="glass-label">
                Sahə {range[0]}–{range[1]} {t.m2}
              </div>
              <div className="range" style={{ "--a": (range[0] - lo) / (hi - lo || 1), "--b": (range[1] - lo) / (hi - lo || 1) } as React.CSSProperties}>
                <input
                  type="range" min={lo} max={hi} step={1} value={range[0]} aria-label="Minimum sahə"
                  onChange={(e) => setRange([Math.min(Number(e.target.value), range[1]), range[1]])}
                />
                <input
                  type="range" min={lo} max={hi} step={1} value={range[1]} aria-label="Maksimum sahə"
                  onChange={(e) => setRange([range[0], Math.max(Number(e.target.value), range[0])])}
                />
              </div>
            </div>

            <div className="finder-meta">
              <span>{list.length} mənzil tapıldı</span>
              {filtered && (
                <button
                  type="button"
                  className="text-btn"
                  onClick={() => {
                    viewer.setRooms(null);
                    viewer.setArea(null);
                    viewer.setStatuses([]);
                    if (state.floor != null) viewer.setFloor(null);
                  }}
                >
                  Təmizlə
                </button>
              )}
            </div>
          </div>

          <ul className="finder-list">
            {list.map((u) => (
              <li key={u.data.id}>
                <button
                  type="button"
                  className="unit-row"
                  aria-current={state.selected === u}
                  onClick={() => choose(u)}
                  onPointerEnter={(e) => {
                    viewer.hover(u);
                    if (e.pointerType === "mouse") setPeek(u);
                  }}
                  onPointerLeave={() => {
                    viewer.hover(null);
                    setPeek(null);
                  }}
                >
                  <span className="unit-row-area">
                    <small>Nº {u.data.type}</small>
                    {formatArea(u.data.areaTotal)} {t.m2}
                  </span>
                  <span className="unit-row-meta">
                    <span>{t.floor} {u.floor.floor}</span>
                    <span>{t.block(u.block.label)}</span>
                    <span>Yaşayış {formatArea(u.data.areaLiving)} {t.m2}</span>
                  </span>
                  <span className="unit-row-side">
                    <span className="unit-row-rooms">{t.rooms(u.data.rooms)}</span>
                    <span className="unit-row-status">
                      <span className={`status-swatch status-swatch--${viewer.statusOf(u)}`} aria-hidden="true" />
                      {t.status[viewer.statusOf(u)!]}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
    {peek && <PlanPeek unit={peek} status={viewer.statusOf(peek)} />}
    </>
  );
}

/** Compact plan preview beside the list, anchored to the bottom of the screen. */
function PlanPeek({ unit, status }: { unit: Unit; status: SaleStatus | null }) {
  const d = unit.data;
  return (
    <aside className="plan-peek site-panel" aria-hidden="true">
      <div className="plan-peek-head">
        <div>
          <div className="apt-kicker">
            {t.block(unit.block.label)} · {unit.floor.floor}-cü mərtəbə · {t.rooms(d.rooms)}
          </div>
          <h3 className="apt-title">Mənzil {d.type}</h3>
        </div>
        <strong className="plan-peek-area">{formatArea(d.areaTotal)} {t.m2}</strong>
      </div>
      <div className="plan-peek-plan">
        <ApartmentPlanImage unit={unit} />
      </div>
      <div className="plan-peek-foot">
        {status && (
          <span className={`status-pill status-pill--${status}`}>
            <span className={`status-swatch status-swatch--${status}`} />
            {t.status[status]}
          </span>
        )}
        <span className="plan-peek-rooms">{t.areaLiving} {formatArea(d.areaLiving)} {t.m2}</span>
      </div>
    </aside>
  );
}
