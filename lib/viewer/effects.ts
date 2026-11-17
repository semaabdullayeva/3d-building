import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

// Sky, sky reflections (PMREM environment) and ambient occlusion – all three.js add-ons.
// `?fx=0` in the page address switches the effects off on slow devices.

export const effectsEnabled = () => new URLSearchParams(globalThis.location?.search || "").get("fx") !== "0";

/** Atmospheric sky with an extra `uNight` blend towards a dark blue, starry night sky. */
function makeSky(sunDirection: THREE.Vector3) {
  const sky = new Sky();
  sky.scale.setScalar(10000);
  const m = sky.material;
  const u = m.uniforms;
  u.turbidity.value = 3.2;
  u.rayleigh.value = 0.9;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.82;
  u.sunPosition.value.copy(sunDirection);
  u.uNight = { value: 0 };
  m.fragmentShader = m.fragmentShader
    .replace("uniform vec3 up;", "uniform vec3 up;\nuniform float uNight;")
    .replace(
      "gl_FragColor = vec4( retColor, 1.0 );",
      `float nh = clamp( direction.y * 2.2, 0.0, 1.0 );
      vec3 night = mix( vec3( 0.075, 0.1, 0.17 ), vec3( 0.012, 0.02, 0.05 ), nh );
      vec3 sd = floor( direction * 420.0 );
      float star = step( 0.9975, fract( sin( dot( sd, vec3( 12.9898, 78.233, 37.719 ) ) ) * 43758.5453 ) );
      night += star * smoothstep( 0.05, 0.3, direction.y ) * vec3( 0.75, 0.78, 0.9 );
      gl_FragColor = vec4( mix( retColor, night, uNight ), 1.0 );`,
    );
  return sky;
}

export interface SkyHandle {
  /** current environment texture (replaced on every `update`) */
  texture: THREE.Texture;
  /** moves the sun in the sky dome; `night` 0..1 darkens it towards the night sky */
  setSun(direction: THREE.Vector3, night: number): void;
  /** re-renders the reflection environment from the current sky; returns the new texture */
  refreshEnvironment(): { previous: THREE.Texture; texture: THREE.Texture };
  dispose(): void;
}

/**
 * Adds the sky dome and an environment map made from it (PMREMGenerator), so that glass and other
 * smooth surfaces reflect the sky.
 */
export function addSky(renderer: THREE.WebGLRenderer, scene: THREE.Scene, sun: THREE.DirectionalLight): SkyHandle {
  const dir = sun.position.clone().sub(sun.target.position).normalize();
  const sky = makeSky(dir);
  sky.userData.noAO = true;
  scene.add(sky);
  scene.background = null;
  // environment: the same sky above and a light grey-blue floor below, standing in for the surroundings
  // that windows reflect when seen from above (a dark floor would turn them black)
  const env = new THREE.Scene();
  const envSky = makeSky(dir);
  env.add(envSky);
  const groundMat = new THREE.MeshBasicMaterial({ color: 0x9aa7ad });
  const ground = new THREE.Mesh(new THREE.CircleGeometry(4000, 32), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -12;
  env.add(ground);
  const dayGround = new THREE.Color(0x9aa7ad);
  const nightGround = new THREE.Color(0x1c2330);

  const render = () => {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const t = pmrem.fromScene(env, 0.02);
    pmrem.dispose();
    return t;
  };
  let target = render();
  scene.environment = target.texture;
  scene.environmentIntensity = 0.1; // ambient light from the sky; glass uses the map directly at full strength

  return {
    get texture() {
      return target.texture;
    },
    setSun(direction, night) {
      for (const s of [sky, envSky]) {
        s.material.uniforms.sunPosition.value.copy(direction);
        s.material.uniforms.uNight.value = night;
      }
      groundMat.color.copy(dayGround).lerp(nightGround, night);
    },
    refreshEnvironment() {
      const old = target;
      target = render();
      scene.environment = target.texture;
      const previous = old.texture;
      // the caller swaps materials over before the old one goes
      queueMicrotask(() => old.dispose());
      return { previous, texture: target.texture };
    },
    dispose: () => target.dispose(),
  };
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
