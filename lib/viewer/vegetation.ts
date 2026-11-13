import * as THREE from "three";
import { Tree } from "@dgreenheck/ez-tree";

export type TreeKind = "round" | "cypress" | "bush" | "forestRound" | "forestPine";

/** ez-tree presets used for each kind of tree (several variants per kind). */
const TREE_VARIANTS: Record<TreeKind, { preset: string; seed: number; detail?: "low" }[]> = {
  round: [
    { preset: "Oak Medium", seed: 11 },
    { preset: "Ash Medium", seed: 23 },
    { preset: "Oak Small", seed: 37 },
  ],
  cypress: [
    { preset: "Pine Medium", seed: 5 },
    { preset: "Pine Small", seed: 9 },
  ],
  bush: [
    { preset: "Bush 1", seed: 3 },
    { preset: "Bush 2", seed: 4 },
  ],
  forestRound: [
    { preset: "Oak Small", seed: 51, detail: "low" },
    { preset: "Ash Small", seed: 52, detail: "low" },
  ],
  forestPine: [{ preset: "Pine Small", seed: 61, detail: "low" }],
};

const BARK_TINT = 0x6e5540;

interface TreeVariant {
  branchGeo: THREE.BufferGeometry;
  branchMat: THREE.Material;
  leafGeo: THREE.BufferGeometry;
  leafMat: THREE.MeshStandardMaterial;
  height: number;
}

export interface TreeInstance {
  x: number;
  y: number;
  tint: number;
  kind: TreeKind;
  height: number;
  base?: number;
}

/**
 * Generates and caches ez-tree geometry and places it with instancing.
 * One instance per viewer, so caches are released with the viewer.
 */
export class Vegetation {
  readonly stats = { variants: 0, triangles: {} as Record<string, number> };
  private treeCache: Partial<Record<TreeKind, TreeVariant[]>> = {};

  /** Builds one ez-tree variant and simplifies it until it fits a triangle budget. */
  private buildTree({ preset, seed, detail }: { preset: string; seed: number; detail?: "low" }): TreeVariant {
    const tree = new Tree();
    tree.loadPreset(preset);
    const o: any = tree.options;
    o.seed = seed;
    o.bark.textured = false;
    o.bark.tint = BARK_TINT;
    o.bark.flatShading = false;

    const budget = detail === "low" ? 420 : preset.startsWith("Bush") ? 900 : 3200;
    const triangles = () => (tree.branchesMesh.geometry.index.count + tree.leavesMesh.geometry.index.count) / 3;

    if (detail === "low") o.branch.levels = Math.min(o.branch.levels, 2);
    for (const k of Object.keys(o.branch.segments)) o.branch.segments[k] = Math.min(o.branch.segments[k], detail === "low" ? 3 : 5);
    tree.generate();

    for (let pass = 0; pass < 14 && triangles() > budget; pass++) {
      if (o.leaves.count > 1) {
        const count = Math.max(1, Math.floor(o.leaves.count * 0.7));
        o.leaves.size *= Math.sqrt(o.leaves.count / count);
        o.leaves.count = count;
      }
      for (const k of Object.keys(o.branch.sections)) o.branch.sections[k] = Math.max(2, Math.round(o.branch.sections[k] * 0.8));
      if (pass === 5 || pass === 9) {
        const last = String(o.branch.levels - 1);
        if (o.branch.children[last] > 2) o.branch.children[last] = Math.max(2, Math.round(o.branch.children[last] * 0.7));
      }
      tree.generate();
    }
    if (detail === "low") {
      o.leaves.size *= 1.2;
      tree.generate();
    }

    const branchGeo = tree.branchesMesh.geometry;
    const leafGeo = tree.leavesMesh.geometry;
    branchGeo.computeBoundingBox();
    leafGeo.computeBoundingBox();
    const height = Math.max(branchGeo.boundingBox.max.y, leafGeo.boundingBox.max.y || 0);

    // ez-tree's leaf shader (wind sway) does not apply instanceMatrix – patch it in.
    const leafMat = tree.leavesMesh.material as THREE.MeshStandardMaterial;
    leafMat.emissive = new THREE.Color(0x1d2b12);
    const original = leafMat.onBeforeCompile;
    leafMat.onBeforeCompile = (shader, renderer) => {
      original.call(leafMat, shader, renderer);
      shader.vertexShader = shader.vertexShader.replace(
        "mvPosition = modelViewMatrix * mvPosition;",
        `#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
#endif
  mvPosition = modelViewMatrix * mvPosition;`,
      );
    };
    leafMat.customProgramCacheKey = () => "ez-tree-leaves-instanced";

    this.stats.variants++;
    this.stats.triangles[`${preset}${detail ? " (" + detail + ")" : ""}`] = Math.round(
      (branchGeo.index.count + (leafGeo.index ? leafGeo.index.count : leafGeo.attributes.position.count)) / 3,
    );
    return { branchGeo, branchMat: tree.branchesMesh.material as THREE.Material, leafGeo, leafMat, height };
  }

  private variants(kind: TreeKind) {
    return this.treeCache[kind] || (this.treeCache[kind] = TREE_VARIANTS[kind].map((v) => this.buildTree(v)));
  }

  /**
   * Adds instanced trees to `parent`. `groundAt(x, y, tree)` returns the base height.
   */
  addTrees(
    parent: THREE.Object3D,
    trees: TreeInstance[],
    groundAt: (x: number, y: number, tree: TreeInstance) => number,
    { shadows = true } = {},
  ) {
    const byVariant = new Map<TreeVariant, TreeInstance[]>();
    trees.forEach((tr, i) => {
      const list = this.variants(tr.kind);
      const v = list[Math.floor((tr.tint * 97 + i) % list.length)];
      if (!byVariant.has(v)) byVariant.set(v, []);
      byVariant.get(v).push(tr);
    });

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const c = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    for (const [v, list] of byVariant) {
      const branches = new THREE.InstancedMesh(v.branchGeo, v.branchMat, list.length);
      const leaves = new THREE.InstancedMesh(v.leafGeo, v.leafMat, list.length);
      leaves.userData.noAO = true; // alpha-cut leaf cards would cast square occlusion
      list.forEach((tr, i) => {
        const k = tr.height / v.height;
        p.set(tr.x, groundAt(tr.x, tr.y, tr), -tr.y);
        q.setFromAxisAngle(up, tr.tint * Math.PI * 2);
        m.compose(p, q, s.set(k, k, k));
        branches.setMatrixAt(i, m);
        leaves.setMatrixAt(i, m);
        leaves.setColorAt(i, c.setHSL(0.22 + tr.tint * 0.1, 0.35, 0.82 + tr.tint * 0.14));
      });
      branches.castShadow = leaves.castShadow = shadows;
      leaves.receiveShadow = shadows;
      parent.add(branches, leaves);
    }
  }
}
