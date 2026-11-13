"use client";

import { t } from "@/lib/i18n";
import type { Block } from "@/lib/viewer/engine";

interface Props {
  blocks: Block[];
  activeBlock: string;
  onBlock: (id: string) => void;
  onOverview: () => void;
}

export function TopBar({ blocks, activeBlock, onBlock, onOverview }: Props) {
  return (
    <header className="topbar">
      <div className="segmented" role="group" aria-label="Blocks">
        {blocks.map((b) => (
          <button key={b.id} type="button" className="seg-btn" aria-pressed={b.id === activeBlock} onClick={() => onBlock(b.id)}>
            {b.label}
          </button>
        ))}
      </div>
      <button className="ghost-btn" type="button" onClick={onOverview}>
        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
          <path
            d="M3 3h6v6H3zM11 3h6v6h-6zM3 11h6v6H3zM11 11h6v6h-6z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
        <span>{t.overview}</span>
      </button>
    </header>
  );
}
