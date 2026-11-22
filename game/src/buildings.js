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

export function buildPalmMesh(city) {
  // One palm: leaning trunk (4 stacked segments) + crown of 6 drooping
  // fronds + 2 coconuts, merged into one geometry, instanced along main roads.
  const geom = { pos: [], nrm: [], col: [] };
  const add = (part) => { geom.pos.push(...part.pos); geom.nrm.push(...part.nrm); geom.col.push(...part.col); };
  const trunkCol = [0.52, 0.42, 0.3];
  const segY = [0.75, 2.2, 3.65, 5.05];
  const segX = [0, 0.14, 0.3, 0.5];
  for (let k = 0; k < 4; k++) {
    const seg = plainBox(0.3, 1.5, 0.3, trunkCol);
    for (let i = 0; i < seg.pos.length; i += 3) { seg.pos[i] += segX[k]; seg.pos[i + 1] += segY[k]; }
    add(seg);
  }
  // Fronds: long thin boxes, drooping ~28 degrees, fanning around the crown.
  for (let f = 0; f < 6; f++) {
    const a = (f / 6) * Math.PI * 2;
    const frond = plainBox(2.6, 0.06, 0.32, f % 2 === 0 ? [0.22, 0.52, 0.22] : [0.27, 0.58, 0.25]);
    for (let i = 0; i < frond.pos.length; i += 3) {
      let x = frond.pos[i] + 1.3; // inner end at the crown centre
      let y = frond.pos[i + 1];
      let z = frond.pos[i + 2];
      const droop = -0.5; // radians, outer end tips down
      const cd = Math.cos(droop), sd = Math.sin(droop);
      const x2 = x * cd - y * sd, y2 = x * sd + y * cd;
      const ca = Math.cos(a), sa = Math.sin(a);
      frond.pos[i] = 0.5 + x2 * ca + z * sa;
      frond.pos[i + 1] = 5.6 + y2;
      frond.pos[i + 2] = -x2 * sa + z * ca;
    }
    // Normals stay axis-ish after the fan rotation; good enough at this scale.
    add(frond);
  }
  for (const dz of [-0.2, 0.2]) {
    const nut = plainBox(0.3, 0.25, 0.3, [0.35, 0.25, 0.15]);
    for (let i = 0; i < nut.pos.length; i += 3) { nut.pos[i] += 0.35; nut.pos[i + 1] += 5.3; nut.pos[i + 2] += dz; }
    add(nut);
  }
  const matrices = [];
  const tints = [];
  for (const t of city.palmTrees) {
    matrices.push(mat4TRS(t.x, 0, t.z, t.rot, t.s, t.s, t.s));
    const v = 0.88 + ((t.x * 7 + t.z * 11) % 10) / 60;
    tints.push([v, v, v]);
  }
  return { geom, matrices, tints, prog: null };
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
