import * as THREE from "three";

// Building surface materials: cast concrete, facade cladding and glass.
// Wall textures (public/textures/) are mapped by position in metres (per face, in the building's own
// axes), so they keep a true scale on every part regardless of how its geometry was made, and they are
// multiplied by the material colour, so hover / selection colours still work.

export type SurfaceKind = "concrete" | "cladding";

const KINDS: Record<SurfaceKind, { tile: number; rough: number; url: string }> = {
  concrete: { tile: 3.0, rough: 0.92, url: "/textures/concrete.jpg" },
  cladding: { tile: 2.4, rough: 0.7, url: "/textures/cladding.jpg" },
};
const cache: Partial<Record<SurfaceKind, THREE.Texture>> = {};

function texture(kind: SurfaceKind) {
  if (cache[kind]) return cache[kind];
  const t = new THREE.TextureLoader().load(KINDS[kind].url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return (cache[kind] = t);
}

/** Turns a MeshStandardMaterial into a textured surface of the given kind. Clones keep the mapping. */
export function surface<T extends THREE.MeshStandardMaterial>(material: T, kind: SurfaceKind): T {
  const k = KINDS[kind];
  material.map = texture(kind);
  material.roughness = k.rough;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vSurfPos;\nvarying vec3 vSurfNrm;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSurfPos = position;\nvSurfNrm = normal;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vSurfPos;\nvarying vec3 vSurfNrm;")
      .replace(
        "#include <map_fragment>",
        `
        vec3 surfN = abs(vSurfNrm);
        vec2 surfUv = surfN.y > 0.5 ? vSurfPos.xz : (surfN.x > surfN.z ? vSurfPos.zy : vSurfPos.xy);
        vec3 surfTex = texture2D(map, surfUv / ${k.tile.toFixed(2)}).rgb;
        float surfLum = surfTex.g / 0.57;                 // 0.57 = the textures' mean (0.78 sRGB) in linear light
        diffuseColor.rgb *= surfTex / 0.57;`,
      )
      .replace("#include <roughnessmap_fragment>", "float roughnessFactor = clamp(roughness * (1.25 - 0.3 * surfLum), 0.05, 1.0);");
  };
  material.customProgramCacheKey = () => "surface-" + kind;
  const plainClone = material.clone.bind(material);
  (material as THREE.MeshStandardMaterial).clone = function (this: THREE.MeshStandardMaterial) {
    return surface(plainClone(), kind) as unknown as typeof this;
  };
  return material;
}

/** Window glass: a smooth clear-coated physical material that mirrors the sky environment. */
export function glassMaterial(env: THREE.Texture | null, { color = 0xffffff, transparent = false } = {}) {
  if (!env) return new THREE.MeshStandardMaterial({ color, roughness: 0.25, metalness: 0.1, transparent });
  return new THREE.MeshPhysicalMaterial({
    color,
    transparent,
    metalness: 0.55,
    roughness: 0.05,
    ior: 1.52,
    reflectivity: 0.6,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    envMap: env,
    envMapIntensity: 1.0,
  });
}
