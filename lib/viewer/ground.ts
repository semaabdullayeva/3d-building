import * as THREE from "three";

// Grass ground material. One seamless colour tile and its normal map (public/textures/) are mapped in
// world metres, so terrain, courtyard lawns and roof lawns line up. On top of the tile the shader adds
// what keeps real grass from looking like carpet: a second, larger layer that hides the repeat, and
// patchy variation across the site (lusher, drier and darker areas).
// UVs must be the site (x, y) in metres – see worldUV().

const TILE = 2.5; // metres covered by one repeat of the tile
const textures: Record<string, THREE.Texture> = {};

function load(url: string, srgb: boolean) {
  if (textures[url]) return textures[url];
  const t = new THREE.TextureLoader().load(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / TILE, 1 / TILE);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return (textures[url] = t);
}

const NOISE = /* glsl */ `
float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), f.x), mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float gFbm(vec2 p) { return 0.5 * gNoise(p) + 0.3 * gNoise(p * 2.13 + 4.7) + 0.2 * gNoise(p * 4.31 + 9.2); }
`;

const COLOUR = /* glsl */ `
#ifdef USE_MAP
  vec2 gMetres = vMapUv * ${TILE.toFixed(2)};
  vec3 gNear = texture2D(map, vMapUv).rgb;
  // the same tile again, 4.3x larger and rotated: breaks up the visible repeat and gives mid-scale mottling
  vec3 gWide = texture2D(map, mat2(0.8, -0.6, 0.6, 0.8) * vMapUv * 0.23 + 0.37).rgb;
  vec3 gCol = gNear * mix(vec3(1.0), gWide / 0.13, 0.55);
  float gLush = gFbm(gMetres * 0.045);                 // patches a few tens of metres across
  float gDry = smoothstep(0.52, 0.8, gFbm(gMetres * 0.021 + 13.0)) * GRASS_WILD;
  float gShade = gFbm(gMetres * 0.22 + 31.0);          // small-scale unevenness
  gCol *= mix(vec3(0.8, 0.86, 0.72), vec3(1.05, 1.08, 0.95), gLush);
  gCol = mix(gCol, dot(gCol, vec3(0.4, 0.5, 0.1)) * vec3(1.35, 1.2, 0.62), gDry * 0.65); // straw-coloured dry patches
  gCol *= 0.72 + 0.5 * gShade;
  gCol = mix(vec3(dot(gCol, vec3(0.3, 0.6, 0.1))), gCol, 0.6) * vec3(0.8, 0.74, 0.7);     // slightly muted, like a photo
  diffuseColor.rgb *= gCol;
#endif
`;

/** wild: 0 = kept lawn (even colour), 1 = open ground with dry patches. */
export function grassMaterial({ vertexColors = false, wild = 0 }: { vertexColors?: boolean; wild?: number } = {}) {
  const map = load("/textures/grass.jpg", true);
  const m = new THREE.MeshStandardMaterial({
    map,
    normalMap: load("/textures/grass_normal.jpg", false),
    normalScale: new THREE.Vector2(1.6, 1.6),
    roughness: 0.95,
    vertexColors,
  });
  m.defines = { ...m.defines, GRASS_WILD: wild.toFixed(2) };
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", NOISE + "void main() {")
      .replace("#include <map_fragment>", COLOUR);
  };
  m.customProgramCacheKey = () => "grass-ground-" + wild.toFixed(2);
  return m;
}

/** World-metre UVs for any geometry that lies flat (x east, z = -north). */
export function worldUV<T extends THREE.BufferGeometry>(geometry: T) {
  const p = geometry.attributes.position;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) uv.set([p.getX(i), -p.getZ(i)], i * 2);
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return geometry;
}
