// Teluk Rimba — night sky: moon + stars. Code-made, drawn only at night.
// The moon is a pale disc with a soft glow; stars are small bright quads
// scattered on a dome overhead. Positions sit inside the fog range so the
// fog does not wash them out.
import { mulberry32 } from './rng.js';
import { emptyGeom, mat4TRS } from './gl.js';

export function buildMoonGeom() {
  // Flat disc facing +z (the camera looks at it from the city, roughly
  // north-west up). 24-segment fan, pale moon colour.
  const g = emptyGeom();
  const r = 34;
  const col = [0.96, 0.96, 0.88];
  const n = [0, 0, 1];
  for (let i = 0; i < 24; i++) {
    const a0 = (i / 24) * Math.PI * 2, a1 = ((i + 1) / 24) * Math.PI * 2;
    const p0 = [Math.cos(a0) * r, Math.sin(a0) * r, 0];
    const p1 = [Math.cos(a1) * r, Math.sin(a1) * r, 0];
    // Both windings: the moon is visible from anywhere in the city.
    g.pos.push(0, 0, 0, ...p0, ...p1, 0, 0, 0, ...p1, ...p0);
    for (let k = 0; k < 6; k++) g.nrm.push(...n);
    for (let k = 0; k < 6; k++) g.col.push(...col);
  }
  return g;
}

export function buildStarsSpec() {
  const rand = mulberry32(20261128);
  const quad = (() => {
    const g = emptyGeom();
    const col = [1, 1, 1];
    const n = [0, 0, 1];
    // CCW when viewed from +z, so the front face points at the city.
    g.pos.push(-1.2, -1.2, 0, 1.2, -1.2, 0, 1.2, 1.2, 0, -1.2, -1.2, 0, 1.2, 1.2, 0, -1.2, 1.2, 0);
    for (let k = 0; k < 6; k++) g.nrm.push(...n);
    for (let k = 0; k < 6; k++) g.col.push(...col);
    return g;
  })();
  const matrices = [], tints = [];
  for (let k = 0; k < 240; k++) {
    // Random point on the upper dome, radius 800-950, facing the origin.
    const a = rand() * Math.PI * 2;
    const el = 0.25 + rand() * 1.2; // elevation above the horizon
    const r = 820 + rand() * 120;
    const x = Math.cos(a) * Math.cos(el) * r;
    const y = 120 + Math.sin(el) * r * 0.7;
    const z = Math.sin(a) * Math.cos(el) * r;
    // Face the star toward the city centre so it is visible from anywhere.
    const yaw = Math.atan2(-x, -z);
    matrices.push(mat4TRS(x, y, z, yaw, 1, 1, 1));
    const b = 0.45 + rand() * 0.55;
    tints.push([b, b, Math.min(1, b + 0.1)]);
  }
  return { geom: quad, matrices, tints };
}
