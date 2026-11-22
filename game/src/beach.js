// Teluk Rimba — beach props: umbrellas, loungers, swim rings, beach balls.
// Code-made geometry, instanced, soft pastel tints matching the city.
// Positions come from the shared city dataset (city.beachProps), so the
// props always sit on the sand near the shoreline and never on a road.
import { emptyGeom, plainBox, mat4TRS } from './gl.js';

function coneGeom(radius, height, seg) {
  const g = emptyGeom();
  const apex = [0, height, 0];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const p0 = [Math.cos(a0) * radius, 0, Math.sin(a0) * radius];
    const p1 = [Math.cos(a1) * radius, 0, Math.sin(a1) * radius];
    const mid = (a0 + a1) / 2;
    const n = [Math.cos(mid) * 0.7, 0.7, Math.sin(mid) * 0.7];
    const white = [1, 1, 1];
    g.pos.push(...apex, ...p1, ...p0);
    g.nrm.push(...n, ...n, ...n);
    g.col.push(...white, ...white, ...white);
  }
  return g;
}

function sphereGeom(r, wSeg, hSeg) {
  const g = emptyGeom();
  const white = [1, 1, 1];
  const pt = (i, j) => {
    const th = (i / wSeg) * Math.PI * 2;
    const ph = (j / hSeg) * Math.PI;
    return [r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph), r * Math.sin(ph) * Math.sin(th)];
  };
  for (let j = 0; j < hSeg; j++) {
    for (let i = 0; i < wSeg; i++) {
      const a = pt(i, j), b = pt(i + 1, j), c = pt(i + 1, j + 1), d = pt(i, j + 1);
      const n = (p) => { const l = Math.hypot(...p) || 1; return [p[0] / l, p[1] / l, p[2] / l]; };
      g.pos.push(...a, ...c, ...b, ...a, ...d, ...c);
      for (const p of [a, c, b, a, d, c]) g.nrm.push(...n(p));
      for (let k = 0; k < 6; k++) g.col.push(...white);
    }
  }
  return g;
}

function ringGeom(radius, tube) {
  // Flat swim ring: 10 small boxes around a circle, merged.
  const g = emptyGeom();
  const white = [1, 1, 1];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const box = plainBox(tube * 2.4, tube, tube, white);
    const cx = Math.cos(a) * radius, cz = Math.sin(a) * radius;
    const c = Math.cos(a), s = Math.sin(a);
    for (let k = 0; k < box.pos.length; k += 3) {
      const x = box.pos[k], y = box.pos[k + 1], z = box.pos[k + 2];
      box.pos[k] = cx + x * c + z * s;
      box.pos[k + 1] = y;
      box.pos[k + 2] = cz - x * s + z * c;
    }
    g.pos.push(...box.pos); g.nrm.push(...box.nrm); g.col.push(...box.col);
  }
  return g;
}

function loungerGeom() {
  // Sun lounger: low frame + mattress + raised backrest, merged.
  const g = emptyGeom();
  const frame = plainBox(0.7, 0.18, 1.9, [0.55, 0.55, 0.55]);
  for (let i = 0; i < frame.pos.length; i += 3) frame.pos[i + 1] += 0.28;
  const mattress = plainBox(0.62, 0.1, 1.8, [1, 1, 1]);
  for (let i = 0; i < mattress.pos.length; i += 3) mattress.pos[i + 1] += 0.42;
  const back = plainBox(0.62, 0.55, 0.1, [1, 1, 1]);
  for (let i = 0; i < back.pos.length; i += 3) {
    back.pos[i + 1] += 0.62; back.pos[i + 2] -= 0.85;
  }
  for (const p of [frame, mattress, back]) {
    g.pos.push(...p.pos); g.nrm.push(...p.nrm); g.col.push(...p.col);
  }
  return g;
}

export function buildBeachPropMeshes(city) {
  const byKind = { umbrella: [], lounger: [], ring: [], ball: [] };
  for (const p of city.beachProps) {
    if (byKind[p.kind]) byKind[p.kind].push(p);
  }
  // Umbrella poles: static, all merged into one mesh (they never move).
  const poleGeom = emptyGeom();
  for (const p of byKind.umbrella) {
    const pole = plainBox(0.09, 2.3, 0.09, [0.62, 0.52, 0.38]);
    const c = Math.cos(p.rot), s = Math.sin(p.rot);
    for (let i = 0; i < pole.pos.length; i += 3) {
      const x = pole.pos[i] * p.s, y = (pole.pos[i + 1] + 1.15) * p.s, z = pole.pos[i + 2] * p.s;
      pole.pos[i] = p.x + x * c + z * s;
      pole.pos[i + 1] = y;
      pole.pos[i + 2] = p.z - x * s + z * c;
    }
    poleGeom.pos.push(...pole.pos); poleGeom.nrm.push(...pole.nrm); poleGeom.col.push(...pole.col);
  }
  const inst = (kind, geom) => ({
    geom,
    matrices: byKind[kind].map((p) => mat4TRS(p.x, 0, p.z, p.rot, p.s, p.s, p.s)),
    tints: byKind[kind].map((p) => p.color),
  });
  // Canopy sits on top of its pole (y 2.3 * scale).
  const canopy = coneGeom(1.6, 0.55, 8);
  for (let i = 0; i < canopy.pos.length; i += 3) canopy.pos[i + 1] += 2.3;
  const ringGeomBuilt = ringGeom(0.55, 0.22);
  for (let i = 0; i < ringGeomBuilt.pos.length; i += 3) ringGeomBuilt.pos[i + 1] += 0.11;
  const ballGeomBuilt = sphereGeom(0.42, 8, 5);
  for (let i = 0; i < ballGeomBuilt.pos.length; i += 3) ballGeomBuilt.pos[i + 1] += 0.42;
  return {
    poles: poleGeom,
    umbrella: inst('umbrella', canopy),
    lounger: inst('lounger', loungerGeom()),
    ring: inst('ring', ringGeomBuilt),
    ball: inst('ball', ballGeomBuilt),
  };
}
