"use client";

import { useEffect, useState } from "react";
import type { Unit } from "@/lib/viewer/engine";
import { apartmentLayout } from "@/lib/apartmentLayouts";
import { ApartmentPlanDrawing } from "./ApartmentPlanDrawing";

const PAD_M = 0.9;        // margin around the apartment, metres
const WALL_BUF_M = 0.45;  // keep the outer wall band outside the unit polygon
const MAX_PX = 2000;      // longest side of the rendered sheet

const PAPER: [number, number, number] = [252, 249, 240];
const INK:   [number, number, number] = [36, 39, 42];
const MARK:  [number, number, number] = [222, 110, 40];

function hueOf(r: number, g: number, b: number): number {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), c = mx - mn;
  if (c === 0) return 0;
  let h = mx === r ? ((g - b) / c) % 6 : mx === g ? (b - r) / c + 2 : (r - g) / c + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

interface Marker { cx: number; cy: number; r: number }

// Room-number badges are small white discs with a warm-coloured digit inside.
function findMarkers(sp: Uint8ClampedArray, w: number, h: number, pxPerM: number): Marker[] {
  const n = w * h;
  const white = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = sp[i * 4], g = sp[i * 4 + 1], b = sp[i * 4 + 2];
    const mx = Math.max(r, g, b);
    white[i] = mx > 228 && mx - Math.min(r, g, b) < 30 ? 1 : 0;
  }
  const minD = 0.4 * pxPerM, maxD = 1.05 * pxPerM;
  const seen = new Uint8Array(n);
  const stack: number[] = [];
  const out: Marker[] = [];
  for (let s = 0; s < n; s++) {
    if (!white[s] || seen[s]) continue;
    let count = 0, x0 = w, y0 = h, x1 = 0, y1 = 0, big = false;
    seen[s] = 1; stack.push(s);
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w, y = (p / w) | 0;
      count++;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x1 - x0 > maxD || y1 - y0 > maxD) big = true;
      const nb = [p - 1, p + 1, p - w, p + w];
      for (let k = 0; k < 4; k++) {
        const q = nb[k];
        if (q < 0 || q >= n || seen[q] || !white[q]) continue;
        if ((k === 0 && x === 0) || (k === 1 && x === w - 1)) continue;
        seen[q] = 1; stack.push(q);
      }
    }
    if (big) continue;
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (bw < minD || bh < minD || Math.abs(bw - bh) > 0.3 * Math.max(bw, bh)) continue;
    const fill = count / (bw * bh);
    if (fill < 0.45 || fill > 0.9) continue;
    let warm = 0;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = (y * w + x) * 4;
        if (sp[i] > 150 && sp[i] - Math.min(sp[i + 1], sp[i + 2]) > 40) warm++;
      }
    if (warm < 3) continue;
    out.push({ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, r: Math.max(bw, bh) / 2 });
  }
  return out;
}

// Turns the coloured floor sheet into a clean black-on-paper drawing of one apartment.
function renderSheet(img: HTMLImageElement, unit: Unit): string {
  const plan = unit.floor.plan!;
  const [bx0, by0, bx1, by1] = plan.bounds;
  const sxPerM = img.width / (bx1 - bx0);
  const syPerM = img.height / (by1 - by0);
  const poly = unit.data.polygon;

  const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
  const minX = Math.min(...xs) - PAD_M, maxX = Math.max(...xs) + PAD_M;
  const minY = Math.min(...ys) - PAD_M, maxY = Math.max(...ys) + PAD_M;

  const sx = Math.max(0, Math.floor((minX - bx0) * sxPerM));
  const sy = Math.max(0, Math.floor((by1 - maxY) * syPerM));
  const sw = Math.min(img.width - sx, Math.ceil((maxX - minX) * sxPerM));
  const sh = Math.min(img.height - sy, Math.ceil((maxY - minY) * syPerM));

  // 1. At source resolution: strip the coloured fills by dividing each pixel by its local
  //    background (max-filtered luminance), since the linework is multiplied over the fills.
  const src = document.createElement("canvas");
  src.width = sw; src.height = sh;
  const sctx = src.getContext("2d", { willReadFrequently: true })!;
  sctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  const sdata = sctx.getImageData(0, 0, sw, sh);
  const sp = sdata.data;
  const n = sw * sh;
  const lum = new Float32Array(n);
  const tinted = new Float32Array(n); // luminance of coloured fill pixels, 0 elsewhere
  for (let i = 0; i < n; i++) {
    const r = sp[i * 4], g = sp[i * 4 + 1], b = sp[i * 4 + 2];
    lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    tinted[i] = sat > 22 && lum[i] > 95 ? lum[i] : 0;
  }
  // Local fill colour = separable median of the tinted pixels (lines and anti-aliased edges are a minority).
  const R = Math.max(5, Math.round(0.3 * sxPerM));
  const tmp = new Float32Array(n), bg = new Float32Array(n);
  const win: number[] = [];
  const median = (): number => {
    if (!win.length) return 0;
    win.sort((a, b) => a - b);
    return win[(win.length * 0.6) | 0];
  };
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      win.length = 0;
      for (let k = Math.max(0, x - R); k <= Math.min(sw - 1, x + R); k++) {
        const v = tinted[y * sw + k];
        if (v > 0) win.push(v);
      }
      tmp[y * sw + x] = median();
    }
  }
  for (let x = 0; x < sw; x++) {
    for (let y = 0; y < sh; y++) {
      win.length = 0;
      for (let k = Math.max(0, y - R); k <= Math.min(sh - 1, y + R); k++) {
        const v = tmp[k * sw + x];
        if (v > 0) win.push(v);
      }
      bg[y * sw + x] = median();
    }
  }
  const markers = findMarkers(sp, sw, sh, sxPerM);
  const inMarker = new Uint8Array(n);
  for (const m of markers) {
    const rr = m.r + 1.5;
    for (let y = Math.max(0, Math.floor(m.cy - rr)); y <= Math.min(sh - 1, Math.ceil(m.cy + rr)); y++)
      for (let x = Math.max(0, Math.floor(m.cx - rr)); x <= Math.min(sw - 1, Math.ceil(m.cx + rr)); x++)
        if ((x - m.cx) ** 2 + (y - m.cy) ** 2 <= rr * rr) inMarker[y * sw + x] = 1;
  }

  for (let i = 0; i < n; i++) {
    const r = sp[i * 4], g = sp[i * 4 + 1], b = sp[i * 4 + 2];
    const hue = hueOf(r, g, b);
    const warm = r > 150 && r - Math.min(g, b) > 40;
    if (inMarker[i]) {
      // room number badge: keep the digit, clear the rest (ring is redrawn crisp below)
      const digit = r > 140 && r - Math.min(g, b) > 30 && (hue <= 48 || hue >= 300);
      sp[i * 4] = digit ? MARK[0] : 255;
      sp[i * 4 + 1] = digit ? MARK[1] : 255;
      sp[i * 4 + 2] = digit ? MARK[2] : 255;
    } else if (warm && hue >= 12 && hue <= 48 && g - b > 35) {
      sp[i * 4] = MARK[0]; sp[i * 4 + 1] = MARK[1]; sp[i * 4 + 2] = MARK[2];
    } else if (
      (r > 120 && (r - Math.max(g, b)) / r > 0.45 && (hue < 9 || hue > 300)) ||
      (r - g > 18 && b >= r - 8 && hue > 265)
    ) {
      // red unit tags (code + area), also where anti-aliased into a purple fill — shown in the legend instead
      sp[i * 4] = sp[i * 4 + 1] = sp[i * 4 + 2] = 255;
    } else {
      // coloured pixels are measured against the local fill colour, neutral ones against white paper
      const ref = tinted[i] > 0 || (bg[i] > 0 && Math.max(r, g, b) - Math.min(r, g, b) > 14) ? bg[i] : 255;
      const v = Math.min(255, (lum[i] / Math.max(ref, 1)) * 255);
      sp[i * 4] = sp[i * 4 + 1] = sp[i * 4 + 2] = v;
    }
  }
  sctx.putImageData(sdata, 0, 0);

  // 2. Upscale smoothly, then tone-map to crisp ink on paper.
  const scale = Math.min(6, MAX_PX / Math.max(sw, sh));
  const cw = Math.round(sw * scale), ch = Math.round(sh * scale);
  const cnv = document.createElement("canvas");
  cnv.width = cw; cnv.height = ch;
  const ctx = cnv.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, sw, sh, 0, 0, cw, ch);

  const data = ctx.getImageData(0, 0, cw, ch);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    if (r - b > 40) {
      const t = Math.min(1, (r - b) / (MARK[0] - MARK[2]));
      px[i] = PAPER[0] + (MARK[0] - PAPER[0]) * t;
      px[i + 1] = PAPER[1] + (MARK[1] - PAPER[1]) * t;
      px[i + 2] = PAPER[2] + (MARK[2] - PAPER[2]) * t;
    } else {
      const d = Math.pow(Math.min(1, Math.max(0, (238 - g) / 150)), 0.75);
      px[i] = PAPER[0] + (INK[0] - PAPER[0]) * d;
      px[i + 1] = PAPER[1] + (INK[1] - PAPER[1]) * d;
      px[i + 2] = PAPER[2] + (INK[2] - PAPER[2]) * d;
    }
    px[i + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);

  ctx.strokeStyle = `rgb(${MARK.join(",")})`;
  ctx.lineWidth = Math.max(2, 0.035 * sxPerM * scale);
  for (const m of markers) {
    ctx.beginPath();
    ctx.arc((m.cx + 0.5) * scale, (m.cy + 0.5) * scale, m.r * scale, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Keep only the apartment (plus its outer wall band).
  const mask = document.createElement("canvas");
  mask.width = cw; mask.height = ch;
  const mctx = mask.getContext("2d")!;
  mctx.beginPath();
  poly.forEach(([x, y], i) => {
    const cx = ((x - bx0) * sxPerM - sx) * scale;
    const cy = ((by1 - y) * syPerM - sy) * scale;
    if (i === 0) mctx.moveTo(cx, cy); else mctx.lineTo(cx, cy);
  });
  mctx.closePath();
  mctx.fill();
  mctx.lineJoin = "miter";
  mctx.lineWidth = WALL_BUF_M * 2 * sxPerM * scale;
  mctx.stroke();
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(mask, 0, 0);
  ctx.globalCompositeOperation = "source-over";

  return cnv.toDataURL("image/png");
}

const fmt = (n: number | null) => (n == null ? "—" : n.toFixed(2));

// Rendering a sheet crop takes a while; hover previews revisit the same units, so keep the results.
const sheetCache = new Map<string, string>();

/** The apartment's own plan: the traced vector drawing when available, else a crop of the floor sheet. */
export function ApartmentPlanImage({ unit }: { unit: Unit }) {
  const [sheet, setSheet] = useState<{ key: string; url: string } | null>(null);
  const plan = unit.floor.plan;
  const key = `${unit.data.id}|${plan?.image ?? ""}`;
  const match = apartmentLayout(plan?.image, unit.data.type);
  const vector = !!match;
  const cached = sheetCache.get(key);

  useEffect(() => {
    if (!plan || vector || sheetCache.has(key)) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const url = renderSheet(img, unit);
      sheetCache.set(key, url);
      setSheet({ key, url });
    };
    img.src = `/plans/${plan.image}`;
    return () => { cancelled = true; };
  }, [key, plan, unit, vector]);

  const url = cached ?? (sheet?.key === key ? sheet.url : null);
  if (match) return <ApartmentPlanDrawing match={match} />;
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="apt-plan-img" src={url} alt={`Mənzil ${unit.data.type} planı`} />;
  }
  return <div className="apt-sheet-loading">{plan ? "Plan hazırlanır…" : "Bu mərtəbə üçün plan yoxdur"}</div>;
}

export function ApartmentPlanSheet({ unit }: { unit: Unit }) {
  const d = unit.data;
  const schedule = apartmentLayout(unit.floor.plan?.image, d.type)?.layout;

  return (
    <div className="apt-sheet">
      <div className="apt-sheet-drawing">
        <ApartmentPlanImage unit={unit} />
      </div>

      <aside className="apt-sheet-legend">
        <h3 className="apt-sheet-heading">Eksplikasiya</h3>

        {schedule ? (
          <>
            <ol className="apt-sheet-rooms">
              {schedule.rooms.map(r => (
                <li key={r.no}>
                  <span className="apt-sheet-no">{r.no}</span>
                  <span className="apt-sheet-name">{r.name}</span>
                  <span className="apt-sheet-area">{fmt(r.area)} m²</span>
                </li>
              ))}
            </ol>
            <div className="apt-sheet-total">
              <span>Ümumi sahə</span>
              <strong>{fmt(schedule.total)} m²</strong>
            </div>
          </>
        ) : (
          <div className="apt-sheet-rooms apt-sheet-rooms--plain">
            <div><span>Ümumi sahə</span><strong>{fmt(d.areaTotal)} m²</strong></div>
            <div><span>Yaşayış sahəsi</span><strong>{fmt(d.areaLiving)} m²</strong></div>
          </div>
        )}
      </aside>
    </div>
  );
}
