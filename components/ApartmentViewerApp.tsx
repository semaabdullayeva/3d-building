"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { t } from "@/lib/i18n";
import type { SalesData, SiteData, UnitData } from "@/lib/types";
import { ApartmentViewer, type ViewerState } from "@/lib/viewer/engine";
import { ApartmentCard } from "./ApartmentCard";
import { ApartmentFinder } from "./ApartmentFinder";
import { ApartmentPlanModal } from "./ApartmentPlanModal";
import { FloorNav } from "./FloorNav";
import { PlanModal } from "./PlanModal";
import { SunControl } from "./SunControl";
import { Tooltip } from "./Tooltip";
import { TopBar } from "./TopBar";

const noop = () => () => {};

export default function ApartmentViewerApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [viewer, setViewer] = useState<ApartmentViewer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [apartmentPlanOpen, setApartmentPlanOpen] = useState(false);
  const [dayMode, setDayMode] = useState(false);
  const [hours, setHours] = useState(16.5);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    viewer?.setTimeOfDay(dayMode ? hours : null);
  }, [viewer, dayMode, hours]);

  useEffect(() => {
    let cancelled = false;
    let instance: ApartmentViewer | null = null;
    const sales = fetch("/data/sales.json")
      .then((r) => (r.ok ? (r.json() as Promise<SalesData>) : null))
      .catch(() => null);
    fetch("/data/site.json")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<SiteData>;
      })
      .then(async (site) => {
        const statuses = (await sales)?.statuses ?? {};
        // let the loading message paint before the (synchronous, heavy) scene build
        await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
        return { site, statuses };
      })
      .then(({ site, statuses }) => {
        if (cancelled || !canvasRef.current) return;
        instance = new ApartmentViewer(canvasRef.current, site, statuses);
        (window as any).__viewer = instance;
        setViewer(instance);
      })
      .catch((e) => {
        console.error(e);
        if (!cancelled) setError(t.loadError);
      });
    return () => {
      cancelled = true;
      instance?.dispose();
      if ((window as any).__viewer === instance) delete (window as any).__viewer;
    };
  }, []);

  const state = useSyncExternalStore<ViewerState | null>(
    viewer ? viewer.subscribe : noop,
    viewer ? viewer.getState : () => null,
    () => null,
  );

  const selectData = (u: UnitData) => viewer && viewer.select(viewer.unitFor(u));
  const block = viewer && state ? viewer.blocks.find((b) => b.id === state.block) : null;

  return (
    <div id="app">
      <canvas id="scene" ref={canvasRef} />

      {!viewer && <div className={error ? "loading loading-error" : "loading"}>{error || t.loading}</div>}

      {viewer && state && block && (
        <>
          <TopBar
            onOverview={viewer.overview}
            dayMode={dayMode}
            onDayMode={(on) => {
              setDayMode(on);
              setPlaying(false);
            }}
          />
          <ApartmentFinder viewer={viewer} state={state} />
          <FloorNav block={block} floor={state.floor} matches={(u) => viewer.matchesFilter(u)} onFloor={viewer.setFloor} />
          {dayMode ? (
            <SunControl
              hours={hours}
              playing={playing}
              onChange={setHours}
              onPlay={setPlaying}
              onClose={() => {
                setDayMode(false);
                setPlaying(false);
              }}
            />
          ) : (
            <div className="hint" style={state.hintHidden ? { opacity: 0 } : undefined}>
              {t.hint}
            </div>
          )}
          <Tooltip viewer={viewer} />
          {state.selected && (
            <ApartmentCard
              unit={state.selected}
              status={viewer.statusOf(state.selected)}
              onClose={() => { viewer.select(null); setApartmentPlanOpen(false); }}
              onOpenFloorPlan={() => viewer.openPlan(state.selected!.block, state.selected!.floor)}
              onOpenApartmentPlan={() => setApartmentPlanOpen(true)}
            />
          )}
          {state.selected && apartmentPlanOpen && (
            <ApartmentPlanModal
              unit={state.selected}
              isSelected={(u) => state.selected?.data === u}
              isDimmed={(u) => {
                const unit = viewer.unitFor(u);
                return !unit || !viewer.matchesFilter(unit);
              }}
              onSelect={selectData}
              onClose={() => setApartmentPlanOpen(false)}
            />
          )}
          {state.plan && (
            <PlanModal
              block={state.plan.block}
              floor={state.plan.floor}
              isSelected={(u) => state.selected?.data === u}
              isDimmed={(u) => {
                const unit = viewer.unitFor(u);
                return !unit || !viewer.matchesFilter(unit);
              }}
              onSelect={selectData}
              onClose={viewer.closePlan}
            />
          )}
        </>
      )}
    </div>
  );
}
