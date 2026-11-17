"use client";

import { useEffect, useRef } from "react";
import { formatClock, SUNRISE, SUNSET } from "@/lib/viewer/daylight";
import { CloseIcon } from "./CloseIcon";

export const SUN_MIN = 5;
export const SUN_MAX = 23;
const pct = (h: number) => ((h - SUN_MIN) / (SUN_MAX - SUN_MIN)) * 100;

const MARKS: [number, string, string][] = [
  [SUNRISE, formatClock(SUNRISE), "Günəş doğuşu"],
  [12, "12:00", "Günorta"],
  [SUNSET, formatClock(SUNSET), "Günəş batması"],
  [21, "21:00", "Gecə"],
];

function phase(h: number) {
  if (h < SUNRISE - 0.4 || h > SUNSET + 0.7) return "Gecə";
  if (h < SUNRISE + 1.2) return "Səhər";
  if (h > SUNSET - 1.3) return "Gün batımı";
  return "Gündüz";
}

interface Props {
  hours: number;
  playing: boolean;
  onChange: (hours: number) => void;
  onPlay: (playing: boolean) => void;
  onClose: () => void;
}

/** Bottom panel of the day mode: time slider from early morning to night, with sun path marks. */
export function SunControl({ hours, playing, onChange, onPlay, onClose }: Props) {
  // play: the sun runs through the day (about 1.4 h per second), stopping at the end
  const latest = useRef(hours);
  latest.current = hours;
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let raf = requestAnimationFrame(function step(now) {
      const next = latest.current + ((now - last) / 1000) * 1.4;
      last = now;
      if (next >= SUN_MAX) {
        onChange(SUN_MAX);
        onPlay(false);
        return;
      }
      onChange(next);
      raf = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(raf);
  }, [playing, onChange, onPlay]);

  const night = phase(hours) === "Gecə";

  return (
    <section className="sun-panel site-panel" aria-label="Günün vaxtı">
      <div className="sun-head">
        <button
          type="button"
          className="sun-play"
          aria-label={playing ? "Dayandır" : "Günü oynat"}
          onClick={() => {
            if (!playing && hours >= SUN_MAX - 0.05) onChange(SUN_MIN);
            onPlay(!playing);
          }}
        >
          {playing ? (
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 3h3v10H4zM9 3h3v10H9z" fill="currentColor" /></svg>
          ) : (
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M5 3l8 5-8 5z" fill="currentColor" /></svg>
          )}
        </button>
        <div className="sun-time">
          <strong>{formatClock(hours)}</strong>
          <span className={night ? "sun-phase sun-phase--night" : "sun-phase"}>{phase(hours)}</span>
        </div>
        <button className="apt-close" type="button" aria-label="Bağla" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>

      <div className="sun-track">
        <input
          type="range"
          min={SUN_MIN}
          max={SUN_MAX}
          step={1 / 60}
          value={hours}
          aria-label="Günün vaxtı"
          aria-valuetext={formatClock(hours)}
          onChange={(e) => {
            onPlay(false);
            onChange(Number(e.target.value));
          }}
          style={{ "--sun-gradient": gradient() } as React.CSSProperties}
        />
        <div className="sun-marks">
          {MARKS.map(([h, time, caption]) => (
            <button
              key={caption}
              type="button"
              className="sun-mark"
              style={{ left: `${pct(h)}%` }}
              onClick={() => {
                onPlay(false);
                onChange(h);
              }}
            >
              <b>{time}</b>
              {caption}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Slider track: night blue → dawn orange → day sky → dusk orange → night blue. */
function gradient() {
  const stops: [number, string][] = [
    [SUN_MIN, "#1b2740"],
    [SUNRISE - 0.4, "#3a3f63"],
    [SUNRISE + 0.2, "#f0a052"],
    [SUNRISE + 1.6, "#f6dc8c"],
    [12, "#bfe0f2"],
    [SUNSET - 1.6, "#f6dc8c"],
    [SUNSET - 0.1, "#ee8a45"],
    [SUNSET + 0.8, "#3a3f63"],
    [SUN_MAX, "#141d33"],
  ];
  return `linear-gradient(90deg, ${stops.map(([h, c]) => `${c} ${pct(h).toFixed(1)}%`).join(", ")})`;
}
