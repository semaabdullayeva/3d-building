import * as THREE from "three";

// Sun path for Ganja (40.68° N) on a day with sunrise 06:17 and sunset 17:53.

const DEG = Math.PI / 180;
export const SUNRISE = 6 + 17 / 60;
export const SUNSET = 17 + 53 / 60;
const NOON = (SUNRISE + SUNSET) / 2;
const LAT = 40.68 * DEG;
// declination that gives that day length: cos(H0) = -tan(lat)·tan(decl)
const DECL = Math.atan(-Math.cos((SUNSET - NOON) * 15 * DEG) / Math.tan(LAT));

/** Unit vector towards the sun (world space: x east, y up, z = -north) at `hours` local solar time. */
export function sunDirection(hours: number, out = new THREE.Vector3()) {
  const H = (hours - NOON) * 15 * DEG;
  const sinAlt = Math.sin(LAT) * Math.sin(DECL) + Math.cos(LAT) * Math.cos(DECL) * Math.cos(H);
  const cosAlt = Math.sqrt(Math.max(0, 1 - sinAlt * sinAlt));
  // azimuth measured from north, clockwise (east = 90°)
  const az = Math.PI + Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(LAT) - Math.tan(DECL) * Math.cos(LAT));
  return out.set(Math.sin(az) * cosAlt, sinAlt, -Math.cos(az) * cosAlt);
}

export const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** "HH:MM" for fractional hours. */
export function formatClock(hours: number) {
  const m = Math.round(hours * 60);
  return `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

// ---------- textures ----------

let poolTexture: THREE.Texture | null = null;
/** Light falling on the ground under a lamp: bright under it, fading out smoothly with no visible rim. */
export function lightPoolTexture() {
  if (poolTexture) return poolTexture;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    // inverse-square-like falloff that reaches exactly zero at the edge
    const a = Math.pow(1 - t, 2.6) * (1 / (1 + 6 * t * t));
    grad.addColorStop(t, `rgba(255,255,255,${a.toFixed(3)})`);
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  poolTexture = new THREE.CanvasTexture(c);
  poolTexture.colorSpace = THREE.SRGBColorSpace;
  return poolTexture;
}
