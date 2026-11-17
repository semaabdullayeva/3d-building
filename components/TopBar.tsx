"use client";

import { t } from "@/lib/i18n";

interface Props {
  onOverview: () => void;
  dayMode: boolean;
  onDayMode: (on: boolean) => void;
}

export function TopBar({ onOverview, dayMode, onDayMode }: Props) {
  return (
    <header className="topbar">
      <button
        className="glass-btn glass-btn--icon overview-btn"
        type="button"
        aria-pressed={dayMode}
        onClick={() => onDayMode(!dayMode)}
        title="Günəşin hərəkəti, gün və gecə"
      >
        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
          <circle cx="10" cy="10" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path
            d="M10 1.8v2.4M10 15.8v2.4M1.8 10h2.4M15.8 10h2.4M4.2 4.2l1.7 1.7M14.1 14.1l1.7 1.7M4.2 15.8l1.7-1.7M14.1 5.9l1.7-1.7"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
        <span>Gün / Gecə</span>
      </button>
      <button className="glass-btn glass-btn--icon overview-btn" type="button" onClick={onOverview}>
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
