import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

// Sky, sky reflections (PMREM environment) and ambient occlusion – all three.js add-ons.
// `?fx=0` in the page address switches the effects off on slow devices.

export const effectsEnabled = () => new URLSearchParams(globalThis.location?.search || "").get("fx") !== "0";

function makeSky(sunDirection: THREE.Vector3) {
  const sky = new Sky();
  sky.scale.setScalar(10000);
  const u = sky.material.uniforms;
  u.turbidity.value = 3.2;
  u.rayleigh.value = 0.9;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.82;
  u.sunPosition.value.copy(sunDirection);
  return sky;
}

/**
 * Adds the sky dome and an environment map made from it (PMREMGenerator), so that glass and other
 * smooth surfaces reflect the sky. Returns the environment texture.
 */
export function addSky(renderer: THREE.WebGLRenderer, scene: THREE.Scene, sun: THREE.DirectionalLight) {
  const dir = sun.position.clone().sub(sun.target.position).normalize();
  const sky = makeSky(dir);
  sky.userData.noAO = true;
  scene.add(sky);
  scene.background = null;
  // environment: the same sky above and a light grey-blue floor below, standing in for the surroundings
  // that windows reflect when seen from above (a dark floor would turn them black)
  const env = new THREE.Scene();
  env.add(makeSky(dir));
  const ground = new THREE.Mesh(new THREE.CircleGeometry(4000, 32), new THREE.MeshBasicMaterial({ color: 0x9aa7ad }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -12;
  env.add(ground);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(env, 0.02);
  scene.environment = target.texture;
  scene.environmentIntensity = 0.1; // ambient light from the sky; glass uses the map directly at full strength
  pmrem.dispose();
  return { texture: target.texture, dispose: () => target.dispose() };
}

export interface Pipeline {
  render(): void;
  setSize(w: number, h: number): void;
  /** ambient occlusion on / off (off while a single floor is isolated among faded ones) */
  setAO(on: boolean): void;
  dispose(): void;
}

/** Ambient occlusion darkens creases: under balconies, along frames, at the ground line. */
export function makePipeline(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, enabled: boolean): Pipeline {
  if (!enabled) return { render: () => renderer.render(scene, camera), setSize() {}, setAO() {}, dispose() {} };
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const ao = new GTAOPass(scene, camera, 1, 1);
  ao.updateGtaoMaterial({ radius: 3.2, distanceExponent: 1.2, thickness: 1.5, scale: 1.8, samples: 12, screenSpaceRadius: false });
  ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
  ao.blendIntensity = 1;
  // leaves are alpha-cut cards and the sky is a dome: neither should take part in the occlusion pre-pass
  const hide = ao.overrideVisibility.bind(ao);
  ao.overrideVisibility = () => {
    hide();
    scene.traverse((o) => {
      if (o.userData.noAO) o.visible = false;
    });
  };
  composer.addPass(ao);
  composer.addPass(new OutputPass());
  return {
    render: () => composer.render(),
    setSize(w, h) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(w, h);
    },
    setAO(on) {
      ao.enabled = on;
    },
    dispose() {
      ao.dispose();
      composer.dispose();
      target.dispose();
    },
  };
}
