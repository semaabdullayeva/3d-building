"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { t } from "@/lib/i18n";
import type { SiteData, UnitData } from "@/lib/types";
import { ApartmentViewer, type ViewerState } from "@/lib/viewer/engine";
import { FloorNav } from "./FloorNav";
import { PlanModal } from "./PlanModal";
import { Tooltip } from "./Tooltip";
import { TopBar } from "./TopBar";
import { UnitPanel } from "./UnitPanel";

const noop = () => () => {};

export default function ApartmentViewerApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [viewer, setViewer] = useState<ApartmentViewer | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let instance: ApartmentViewer | null = null;
    fetch("/data/site.json")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<SiteData>;
      })
      .then(
        (site) =>
          // let the loading message paint before the (synchronous, heavy) scene build
          new Promise<SiteData>((resolve) => requestAnimationFrame(() => setTimeout(() => resolve(site), 0))),
      )
      .then((site) => {
        if (cancelled || !canvasRef.current) return;
        instance = new ApartmentViewer(canvasRef.current, site);
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
          <TopBar blocks={viewer.blocks} activeBlock={state.block} onBlock={(id) => viewer.setBlock(id, true)} onOverview={viewer.overview} />
          <FloorNav block={block} floor={state.floor} rooms={state.rooms} onFloor={viewer.setFloor} />
          <div className="hint" style={state.hintHidden ? { opacity: 0 } : undefined}>
            {t.hint}
          </div>
          <Tooltip viewer={viewer} />
          {state.selected && (
            <UnitPanel
              unit={state.selected}
              onClose={() => viewer.select(null)}
              onOpenPlan={() => viewer.openPlan(state.selected.block, state.selected.floor)}
              onSelectData={selectData}
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
