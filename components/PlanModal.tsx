"use client";

import { t } from "@/lib/i18n";
import type { FloorData, UnitData } from "@/lib/types";
import type { Block } from "@/lib/viewer/engine";
import { CloseIcon } from "./CloseIcon";
import { FloorPlanSvg } from "./FloorPlanSvg";

interface Props {
  block: Block;
  floor: FloorData;
  isSelected: (u: UnitData) => boolean;
  isDimmed: (u: UnitData) => boolean;
  onSelect: (u: UnitData) => void;
  onClose: () => void;
}

export function PlanModal({ block, floor, isSelected, isDimmed, onSelect, onClose }: Props) {
  return (
    <div
      className="modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-card">
        <div className="modal-head">
          <div>
            <div className="panel-eyebrow">{t.block(block.label)}</div>
            <h2 className="panel-title">{t.floorPlan(block.label, floor.floor)}</h2>
          </div>
          <button className="icon-btn" aria-label={t.close} onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <FloorPlanSvg className="plan" floor={floor} image isSelected={isSelected} isDimmed={isDimmed} onSelect={onSelect} />
        <div className="modal-foot">{t.planFoot}</div>
      </div>
    </div>
  );
}
