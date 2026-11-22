// Teluk Rimba — buildings as instanced meshes (one draw call for all 1000).
// Base geometry is a subdivided box with a window-grid pattern; per-instance
// matrices scale it to each building and tints colour it by zone.
import { subdividedBox, plainBox, mat4TRS } from './gl.js';

export function buildBuildingMeshes(gl, progs, city) {
  const base = subdividedBox(1, 1, 1, 4, 8);
  const matrices = [];
  const tints = [];
  const roofMatrices = [];
  const roofTints = [];
  for (const b of city.buildings) {
    // Base box is centred; lift so its bottom sits on the ground.
    matrices.push(mat4TRS(b.x, b.h / 2, b.z, b.rot, b.w, b.h, b.d));
    tints.push(b.color);
    roofMatrices.push(mat4TRS(b.x, b.h + 0.25, b.z, b.rot, b.w + 0.7, 0.5, b.d + 0.7));
    roofTints.push([0.32, 0.32, 0.34]);
  }
  const roofBase = plainBox(1, 1, 1, [1, 1, 1]);
  return {
    buildings: { geom: base, matrices, tints, prog: progs.litInst },
    roofs: { geom: roofBase, matrices: roofMatrices, tints: roofTints, prog: progs.litInst },
  };
}

export function buildTreeMesh(gl, progs, city) {
  // One tree geometry (trunk + two canopy boxes), instanced for street + forest.
  const trunk = plainBox(0.34, 1.4, 0.34, [0.4, 0.28, 0.16]);
  const canopy1 = plainBox(1.9, 1.3, 1.9, [0.2, 0.48, 0.2]);
  const canopy2 = plainBox(1.3, 1.0, 1.3, [0.26, 0.55, 0.24]);
  // Merge by hand: translate the parts into place.
  const parts = [trunk];
  const c1 = canopy1;
  for (let i = 0; i < c1.pos.length; i += 3) c1.pos[i + 1] += 1.9;
  parts.push(c1);
  const c2 = canopy2;
  for (let i = 0; i < c2.pos.length; i += 3) c2.pos[i + 1] += 2.9;
  parts.push(c2);
  const geom = { pos: [], nrm: [], col: [] };
  for (const p of parts) {
    geom.pos.push(...p.pos); geom.nrm.push(...p.nrm); geom.col.push(...p.col);
  }
  const matrices = [];
  const tints = [];
  const all = [...city.streetTrees, ...city.forestTrees];
  for (const t of all) {
    const rot = (t.x * 0.37 + t.z * 0.73) % (Math.PI * 2);
    matrices.push(mat4TRS(t.x, 0, t.z, rot, t.s, t.s, t.s));
    const v = 0.85 + ((t.x * 13 + t.z * 7) % 10) / 50;
    tints.push([v, v, v]);
  }
  return { geom, matrices, tints, prog: progs.litInst };
}
