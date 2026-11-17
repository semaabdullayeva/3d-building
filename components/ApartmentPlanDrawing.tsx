"use client";

import { useId, type ReactNode, type SVGProps } from "react";
import type { FurnKind, LayoutMatch, Rect, Side } from "@/lib/apartmentLayouts";
import type { Polygon } from "@/lib/types";
import { pointInPolygon } from "@/lib/viewer/geometry";

const PAPER = "#fcf9f0";
const INK = "#24272a";
const LW = 0.014; // thin line weight, metres

// Local symbol space: width W along the back wall, depth D into the room, back edge at v = 0.
type Sym = (W: number, D: number) => ReactNode;

const box = (x: number, y: number, w: number, h: number, rx = 0) => (
  <rect x={x} y={y} width={w} height={h} rx={rx} />
);

const SYMBOLS: Record<Exclude<FurnKind, "dining">, Sym> = {
  bed: (W, D) => {
    const n = W >= 1.2 ? 2 : 1;
    const pw = (W - 0.2 - (n - 1) * 0.08) / n;
    return (
      <>
        {box(0, 0, W, D, 0.03)}
        {box(0, 0, W, 0.07)}
        {Array.from({ length: n }, (_, i) => <rect key={i} x={0.1 + i * (pw + 0.08)} y={0.13} width={pw} height={0.3} rx={0.06} />)}
        {box(0.03, 0.52, W - 0.06, D - 0.55, 0.02)}
        <path d={`M ${W - 0.03} 0.52 L ${W * 0.55} 0.52 L ${W - 0.03} ${Math.min(D - 0.05, 1.0)}`} />
        <line x1={0.03} y1={0.72} x2={W * 0.62} y2={0.72} />
      </>
    );
  },
  nightstand: (W, D) => {
    const r = Math.min(W, D) * 0.28;
    return (
      <>
        {box(0, 0, W, D)}
        <circle cx={W / 2} cy={D / 2} r={r} />
        <line x1={W / 2 - r} y1={D / 2} x2={W / 2 + r} y2={D / 2} />
        <line x1={W / 2} y1={D / 2 - r} x2={W / 2} y2={D / 2 + r} />
      </>
    );
  },
  wardrobe: (W, D) => {
    const hangers: ReactNode[] = [];
    for (let u = 0.1; u < W - 0.05; u += 0.1) {
      hangers.push(<line key={u} x1={u - 0.035} y1={0.07} x2={u + 0.035} y2={D - 0.07} />);
    }
    return (
      <>
        {box(0, 0, W, D)}
        <line x1={0.04} y1={D / 2} x2={W - 0.04} y2={D / 2} />
        {hangers}
      </>
    );
  },
  sofa: (W, D) => {
    const n = W > 1.7 ? 3 : W > 1.1 ? 2 : 1;
    const a = 0.17, sw = (W - 2 * a) / n;
    return (
      <>
        {box(0, 0, W, D, 0.05)}
        {box(0, 0, W, 0.2, 0.04)}
        {box(0, 0, a, D, 0.04)}
        {box(W - a, 0, a, D, 0.04)}
        {Array.from({ length: n }, (_, i) => <rect key={i} x={a + i * sw + 0.02} y={0.22} width={sw - 0.04} height={D - 0.26} rx={0.04} />)}
      </>
    );
  },
  armchair: (W, D) => (
    <>
      {box(0, 0, W, D, 0.05)}
      {box(0, 0, W, 0.16, 0.04)}
      {box(0, 0, 0.12, D, 0.04)}
      {box(W - 0.12, 0, 0.12, D, 0.04)}
      {box(0.14, 0.18, W - 0.28, D - 0.22, 0.04)}
    </>
  ),
  coffee: (W, D) => (
    <>
      {box(0, 0, W, D, 0.02)}
      {box(0.05, 0.05, W - 0.1, D - 0.1, 0.02)}
    </>
  ),
  roundtable: (W, D) => <circle cx={W / 2} cy={D / 2} r={Math.min(W, D) / 2} />,
  tv: (W, D) => (
    <>
      {box(0, 0, W, D)}
      <rect x={W * 0.2} y={D * 0.35} width={W * 0.6} height={Math.max(0.025, D * 0.2)} fill={INK} />
    </>
  ),
  desk: (W, D) => box(0, 0, W, D),
  chair: (W, D) => (
    <>
      {box(0.03, 0.09, W - 0.06, D - 0.09, 0.05)}
      {box(0, 0, W, 0.09, 0.03)}
    </>
  ),
  counter: (W, D) => (
    <>
      {box(0, 0, W, D)}
      <line x1={0} y1={D - 0.05} x2={W} y2={D - 0.05} />
    </>
  ),
  stove: (W, D) => {
    const r = Math.min(W, D) * 0.15;
    const pts: [number, number][] = [[0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]];
    return (
      <>
        {box(0.02, 0.02, W - 0.04, D - 0.07)}
        {pts.map(([a, b], i) => (
          <g key={i}>
            <circle cx={W * a} cy={D * b} r={r} />
            <circle cx={W * a} cy={D * b} r={r * 0.45} />
          </g>
        ))}
      </>
    );
  },
  sink: (W, D) => (
    <>
      {box(0.02, 0.02, W - 0.04, D - 0.07, 0.03)}
      {box(W * 0.14, D * 0.24, W * 0.72, D * 0.55, 0.05)}
      <circle cx={W / 2} cy={D * 0.52} r={0.025} />
      <circle cx={W / 2} cy={D * 0.12} r={0.025} />
    </>
  ),
  fridge: (W, D) => (
    <>
      {box(0, 0, W, D)}
      <line x1={0} y1={D * 0.15} x2={W} y2={D * 0.15} />
      <line x1={W * 0.25} y1={D * 0.88} x2={W * 0.75} y2={D * 0.88} />
    </>
  ),
  basin: (W, D) => (
    <>
      {box(0, 0, W, D, 0.03)}
      <ellipse cx={W / 2} cy={D * 0.56} rx={W * 0.36} ry={D * 0.3} />
      <circle cx={W / 2} cy={D * 0.12} r={0.025} />
    </>
  ),
  wc: (W, D) => {
    const t = 0.17, ry = (D - t) / 2 - 0.01;
    return (
      <>
        {box(0.04, 0, W - 0.08, t, 0.03)}
        <ellipse cx={W / 2} cy={t + (D - t) / 2} rx={W * 0.38} ry={ry} />
        <ellipse cx={W / 2} cy={t + (D - t) / 2 + 0.02} rx={W * 0.26} ry={ry * 0.68} />
      </>
    );
  },
  shower: (W, D) => (
    <>
      {box(0, 0, W, D)}
      <path d={`M ${W} 0 A ${W} ${D} 0 0 1 0 ${D}`} />
      <circle cx={W * 0.35} cy={D * 0.35} r={0.035} />
      {[0.2, 0.32, 0.44].map(k => <circle key={k} cx={W * (k + 0.1)} cy={D * (0.62 - k * 0.6)} r={0.008} fill={INK} />)}
    </>
  ),
};

// Affine map from a symbol's local space onto a world rect whose back faces `s`.
function frame(r: Rect, s: Side = "n"): { m: string; W: number; D: number } {
  const [x0, y0, x1, y1] = r;
  const w = x1 - x0, h = y1 - y0;
  switch (s) {
    case "n": return { m: `matrix(1,0,0,-1,${x0},${y1})`, W: w, D: h };
    case "s": return { m: `matrix(-1,0,0,1,${x1},${y0})`, W: w, D: h };
    case "w": return { m: `matrix(0,-1,1,0,${x0},${y1})`, W: h, D: w };
    case "e": return { m: `matrix(0,1,-1,0,${x1},${y0})`, W: h, D: w };
  }
}

function placed(kind: Exclude<FurnKind, "dining">, r: Rect, s: Side | undefined, key: string) {
  const { m, W, D } = frame(r, s);
  return <g key={key} transform={m}>{SYMBOLS[kind](W, D)}</g>;
}

function dining(r: Rect, key: string) {
  const [x0, y0, x1, y1] = r;
  const out: ReactNode[] = [<rect key="t" x={x0} y={y0} width={x1 - x0} height={y1 - y0} rx={0.02} />];
  const C = 0.22, G = 0.05, DEP = 0.42;
  const horiz = x1 - x0 >= y1 - y0;
  const len = horiz ? x1 - x0 : y1 - y0;
  const n = len >= 1.5 ? 3 : 2;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    if (horiz) {
      const cx = x0 + t * (x1 - x0);
      out.push(placed("chair", [cx - C, y1 + G, cx + C, y1 + G + DEP], "n", `a${i}`));
      out.push(placed("chair", [cx - C, y0 - G - DEP, cx + C, y0 - G], "s", `b${i}`));
    } else {
      const cy = y0 + t * (y1 - y0);
      out.push(placed("chair", [x0 - G - DEP, cy - C, x0 - G, cy + C], "w", `a${i}`));
      out.push(placed("chair", [x1 + G, cy - C, x1 + G + DEP, cy + C], "e", `b${i}`));
    }
  }
  return <g key={key}>{out}</g>;
}

const rectEl = (r: Rect, key: string | number, props: SVGProps<SVGRectElement> = {}) => (
  <rect key={key} x={r[0]} y={r[1]} width={r[2] - r[0]} height={r[3] - r[1]} {...props} />
);


// Opening drawn into a wall: floor colour over the wall band, jamb lines, and glazing lines for windows.
function opening(r: Rect, win: boolean, key: string, bg: string) {
  const [x0, y0, x1, y1] = r;
  const horiz = x1 - x0 >= y1 - y0;
  const e = 0.035;
  const cover: Rect = horiz ? [x0, y0 - e, x1, y1 + e] : [x0 - e, y0, x1 + e, y1];
  const lines: ReactNode[] = [];
  if (horiz) {
    lines.push(<line key="j0" x1={x0} y1={y0} x2={x0} y2={y1} strokeWidth={0.025} />);
    lines.push(<line key="j1" x1={x1} y1={y0} x2={x1} y2={y1} strokeWidth={0.025} />);
    if (win) for (const k of [0, 0.4, 0.6, 1]) {
      const y = y0 + k * (y1 - y0);
      lines.push(<line key={k} x1={x0} y1={y} x2={x1} y2={y} />);
    }
  } else {
    lines.push(<line key="j0" x1={x0} y1={y0} x2={x1} y2={y0} strokeWidth={0.025} />);
    lines.push(<line key="j1" x1={x0} y1={y1} x2={x1} y2={y1} strokeWidth={0.025} />);
    if (win) for (const k of [0, 0.4, 0.6, 1]) {
      const x = x0 + k * (x1 - x0);
      lines.push(<line key={k} x1={x} y1={y0} x2={x} y2={y1} />);
    }
  }
  return (
    <g key={key}>
      {rectEl(cover, "c", { fill: bg, stroke: "none" })}
      {lines}
    </g>
  );
}

function railing(r: Rect, side: Side, key: string, fill: string) {
  const [x0, y0, x1, y1] = r;
  const t = 0.06;
  const band: Rect =
    side === "n" ? [x0, y1 - t, x1, y1] :
    side === "s" ? [x0, y0, x1, y0 + t] :
    side === "w" ? [x0, y0, x0 + t, y1] : [x1 - t, y0, x1, y1];
  return (
    <g key={key}>
      {rectEl(r, "f", { fill })}
      {rectEl(band, "b", { fill })}
    </g>
  );
}

const rad = (a: number) => (a * Math.PI) / 180;

/** Plan-space bounds of a layout (A orientation). */
export function layoutBounds(L: LayoutMatch["layout"]): Rect {
  const all: Rect[] = [...L.walls, ...L.parts, ...L.rooms.map((r) => r.r), ...(L.strips ?? []).map((s) => s.r)];
  return [
    Math.min(...all.map((r) => r[0])), Math.min(...all.map((r) => r[1])),
    Math.max(...all.map((r) => r[2])), Math.max(...all.map((r) => r[3])),
  ];
}

interface ShapesProps {
  match: LayoutMatch;
  hatchId: string;
  /** colour of the open floor where nothing is tinted */
  paper?: string;
  /** apartment tone, used on the floor plan */
  tint?: string;
  /** the unit's outline from the site data (block plan metres), painted with the tint */
  outline?: Polygon;
}

/** One apartment's floor tone, walls, openings, furniture and area labels in SVG space (x, -y). */
export function LayoutShapes({ match, hatchId, paper = PAPER, tint, outline }: ShapesProps) {
  const { layout: L, mirror } = match;
  const floor = tint ?? paper;
  const solids = [...L.walls, ...L.parts, ...L.cols];
  // rooms that lie outside the outline (baths, wardrobes on some types) still take the apartment's tone
  const outside = (r: Rect) => {
    if (!outline) return false;
    const cx = (r[0] + r[2]) / 2;
    return !pointInPolygon(mirror ? -cx : cx, (r[1] + r[3]) / 2, outline);
  };

  return (
    <>
      {tint && outline && <polygon points={outline.map(([x, y]) => `${x},${-y}`).join(" ")} fill={tint} />}
      <g transform={mirror ? "scale(-1,-1)" : "scale(1,-1)"} fill="none" stroke={INK} strokeWidth={LW} strokeLinejoin="round">
        {tint && L.rooms.filter((r) => !r.rail && outside(r.r)).map((r) => rectEl(r.r, `t${r.no}`, { fill: tint, stroke: "none" }))}
        {(L.strips ?? []).map((s, i) => railing(s.r, s.rail, `st${i}`, paper))}
        {L.rooms.filter((r) => r.rail).map((r) => railing(r.r, r.rail!, `bal${r.no}`, floor))}

        <g fill={tint ? "#ffffff" : paper}>
          {L.furn.map((it, i) => (it.k === "dining" ? dining(it.r, `f${i}`) : placed(it.k, it.r, it.s, `f${i}`)))}
        </g>

        {/* Outline pass first, fills on top: overlapping wall pieces read as one solid mass. */}
        <g strokeWidth={0.05}>{solids.map((r, i) => rectEl(r, i))}</g>
        <g stroke="none">
          {L.walls.map((r, i) => (
            <g key={i}>
              {rectEl(r, "p", { fill: paper })}
              {rectEl(r, "h", { fill: `url(#${hatchId})` })}
            </g>
          ))}
          {L.parts.map((r, i) => rectEl(r, `p${i}`, { fill: "#ffffff" }))}
          {L.cols.map((r, i) => rectEl(r, `c${i}`, { fill: INK }))}
        </g>

        {L.shafts.map((r, i) => (
          <g key={`sh${i}`}>
            {rectEl(r, "o", { fill: paper, strokeWidth: 0.02 })}
            {rectEl([r[0] + 0.04, r[1] + 0.04, r[2] - 0.04, r[3] - 0.04], "i")}
          </g>
        ))}
        {L.shaftsX.map((r, i) => (
          <g key={`sx${i}`}>
            {rectEl(r, "o", { fill: paper, strokeWidth: 0.02 })}
            <line x1={r[0]} y1={r[1]} x2={r[2]} y2={r[3]} />
            <line x1={r[0]} y1={r[3]} x2={r[2]} y2={r[1]} />
          </g>
        ))}

        {L.gaps.map((r, i) => opening(r, false, `g${i}`, floor))}
        {L.windows.map((r, i) => opening(r, true, `w${i}`, floor))}

        {L.doors.map((dr, i) => {
          const [hx, hy] = dr.h;
          const cx = hx + dr.w * Math.cos(rad(dr.c)), cy = hy + dr.w * Math.sin(rad(dr.c));
          const ox = hx + dr.w * Math.cos(rad(dr.o)), oy = hy + dr.w * Math.sin(rad(dr.o));
          const sweep = (((dr.o - dr.c) % 360) + 360) % 360 === 90 ? 1 : 0;
          return (
            <g key={`d${i}`}>
              <line x1={hx} y1={hy} x2={ox} y2={oy} strokeWidth={0.03} />
              <path d={`M ${cx} ${cy} A ${dr.w} ${dr.w} 0 0 ${sweep} ${ox} ${oy}`} strokeWidth={0.012} />
            </g>
          );
        })}
      </g>

      {L.rooms.map((room) => {
        const [x0, y0, x1, y1] = room.r;
        const [px, py] = room.at ?? [(x0 + x1) / 2, (y0 + y1) / 2];
        const X = mirror ? -px : px, Y = -py;
        const k = Math.max(room.fs ?? 1, 0.75);
        const size = 0.3 * k;
        const w = 6.4 * size * 0.5;
        // Narrow rooms (baths, loggias) get the label turned along their long side, as on the reference sheet.
        const turn = x1 - x0 < w + 0.2 && y1 - y0 > w + 0.3;
        return (
          <g key={`l${room.no}`} transform={`translate(${X} ${Y})${turn ? " rotate(-90)" : ""}`}>
            <rect x={-w / 2 - 0.08} y={-size * 0.85} width={w + 0.16} height={size * 1.35} fill={floor} opacity={0.85} />
            <text y={size * 0.3} fontSize={size} fill={INK} textAnchor="middle" fontFamily="'Times New Roman', Times, serif">
              {room.area.toFixed(2)} m<tspan dy={-size * 0.4} fontSize={size * 0.6}>2</tspan>
            </text>
            <line x1={-w / 2} y1={size * 0.5} x2={w / 2} y2={size * 0.5} stroke={INK} strokeWidth={0.014} />
          </g>
        );
      })}
    </>
  );
}

/** Wall-hatch pattern shared by the drawings. */
export function HatchDef({ id }: { id: string }) {
  return (
    <pattern id={id} width={0.11} height={0.11} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1={0} y1={0} x2={0} y2={0.11} stroke={INK} strokeWidth={0.013} />
    </pattern>
  );
}

export function ApartmentPlanDrawing({ match }: { match: LayoutMatch }) {
  const hatchId = useId().replace(/:/g, "");
  const [minX, minY, maxX, maxY] = layoutBounds(match.layout);
  const M = 0.45;
  const vbX = (match.mirror ? -maxX : minX) - M;
  const vb = `${vbX} ${-maxY - M} ${maxX - minX + 2 * M} ${maxY - minY + 2 * M}`;
  return (
    <svg className="apt-drawing" viewBox={vb} preserveAspectRatio="xMidYMid meet">
      <defs>
        <HatchDef id={hatchId} />
      </defs>
      <LayoutShapes match={match} hatchId={hatchId} />
    </svg>
  );
}
