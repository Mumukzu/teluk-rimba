// Teluk Rimba — Rimba Stadium: a football stadium on the riverbank
// (Mu 23 Nov 22:18). Pitch 60x40 with white markings, four two-tier
// stands in varied seat colours, a canopy over the main (west) stand,
// four corner floodlights (lit at night), a scoreboard, and entrance
// gaps on the north/south sides so the player can walk onto the pitch.
// All code-made, all derived from the shared city dataset (city.stadium
// rect, block (11,7) Marina Shore) — the geometry never disagrees with
// the map, the minimap, or the collision boxes. Pure geometry (no WebGL,
// no DOM) — the renderer draws it as 1 static mesh (+1 night-only
// instanced mesh for the floodlight heads).
import { emptyGeom, plainBox } from './gl.js';

const CONCRETE = [0.75, 0.75, 0.72];
const APRON = [0.68, 0.67, 0.64]; // light-grey forecourt paving
const PITCH_A = [0.25, 0.55, 0.25];
const PITCH_B = [0.30, 0.62, 0.28];
const LINE = [0.95, 0.95, 0.93];
const POST = [0.95, 0.95, 0.95];
const DARK = [0.25, 0.25, 0.28];
const ROOF = [0.92, 0.92, 0.9];
const BOARD = [0.12, 0.12, 0.14];
const AMBER = [1, 0.75, 0.3];
// Seat colours, one per stand: west blue, east red, south yellow, north green.
const SEATS = {
  west: [0.2, 0.4, 0.9],
  east: [0.85, 0.25, 0.25],
  south: [0.95, 0.8, 0.2],
  north: [0.25, 0.6, 0.3],
};

export function buildStadium(city) {
  const st = city.stadium;
  if (!st) throw new Error('buildStadium: city.stadium is missing (generateCity must place it)');
  const { x0, x1, z0, z1, cx, cz, pitchW, pitchD, standDepth: sd } = st;
  const g = emptyGeom();
  let boxes = 0;

  // Box helper: (x, yBottom, z) is the bottom-centre; axis-aligned.
  function box(w, h, d, col, x, yBottom, z) {
    const p = plainBox(w, h, d, col);
    for (let i = 0; i < p.pos.length; i += 3) {
      p.pos[i] += x; p.pos[i + 1] += yBottom + h / 2; p.pos[i + 2] += z;
    }
    g.pos.push(...p.pos); g.nrm.push(...p.nrm); g.col.push(...p.col);
    boxes++;
  }
  // Flat line helper: a thin slab lying on the ground.
  function slab(w, d, col, x, y, z) { box(w, 0.04, d, col, x, y, z); }

  const px0 = cx - pitchW / 2, px1 = cx + pitchW / 2;
  const pz0 = cz - pitchD / 2, pz1 = cz + pitchD / 2;

  // --- Forecourt + apron: light-grey paving from the river-side edge
  // of the block (z 107) up to the stands. ---
  box(x1 - x0, 0.2, z1 - 107, APRON, cx, 0, (107 + z1) / 2);

  // --- Pitch: green with mowing stripes (6 strips along x). ---
  box(pitchW, 0.15, pitchD, PITCH_A, cx, 0.1, cz);
  for (let k = 0; k < 6; k += 2) {
    slab(pitchW / 6, pitchD, PITCH_B, px0 + (pitchW / 6) * (k + 0.5), 0.28, cz);
  }
  // --- White markings: boundary, halfway line, centre circle + spot,
  // penalty boxes (24 wide x 10 deep) and goal areas (12 x 5) at both ends.
  // Each box is drawn as 3 strips (front + 2 sides); the goal line
  // itself is the boundary line.
  slab(pitchW, 0.25, LINE, cx, 0.30, pz0);
  slab(pitchW, 0.25, LINE, cx, 0.30, pz1);
  slab(0.25, pitchD, LINE, px0, 0.30, cz);
  slab(0.25, pitchD, LINE, px1, 0.30, cz);
  slab(0.25, pitchD, LINE, cx, 0.30, cz);
  // Centre circle: ring of 24 small segments, radius 6 m.
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    slab(0.7, 0.18, LINE, cx + Math.cos(a) * 6, 0.30, cz + Math.sin(a) * 6);
  }
  slab(0.5, 0.5, LINE, cx, 0.30, cz);
  for (const [gx, dir] of [[px0, 1], [px1, -1]]) {
    // dir = +1 at the west goal (box extends east), -1 at the east goal.
    const frontX = gx + dir * 10; // front edge of the penalty box
    slab(0.25, 24, LINE, frontX, 0.30, cz);
    slab(10, 0.25, LINE, gx + dir * 5, 0.30, cz - 12);
    slab(10, 0.25, LINE, gx + dir * 5, 0.30, cz + 12);
    // Goal area: 12 wide, 5 deep.
    const frontX2 = gx + dir * 5;
    slab(0.25, 12, LINE, frontX2, 0.30, cz);
    slab(5, 0.25, LINE, gx + dir * 2.5, 0.30, cz - 6);
    slab(5, 0.25, LINE, gx + dir * 2.5, 0.30, cz + 6);
    // Penalty spot, 8 m out.
    slab(0.4, 0.4, LINE, gx + dir * 8, 0.30, cz);
  }

  // --- Goals: 6 m wide, 2.2 m tall white frames at both ends. ---
  for (const gx of [px0, px1]) {
    for (const dz of [-3, 3]) box(0.12, 2.2, 0.12, POST, gx, 0.25, cz + dz);
    box(0.12, 0.12, 6.12, POST, gx, 2.35, cz);
  }

  // --- Stands: two tiers each. Tier 1 (near the pitch) 3 m tall,
  // tier 2 (outer) 6 m tall, each with a coloured seating slab on top.
  // `side` is 'x-' (west) | 'x+' (east) | 'z-' (south) | 'z+' (north);
  // the (xa..xb, za..zb) footprint is split into an inner tier (pitch
  // side) and an outer tier.
  function stand(xa, xb, za, zb, side) {
    const seat = SEATS[side === 'x-' ? 'west' : side === 'x+' ? 'east' : side === 'z-' ? 'south' : 'north'];
    let t1, t2;
    if (side === 'x-') { t1 = [xb - 4, xb, za, zb]; t2 = [xa, xb - 4, za, zb]; }
    else if (side === 'x+') { t1 = [xa, xa + 4, za, zb]; t2 = [xa + 4, xb, za, zb]; }
    else if (side === 'z-') { t1 = [xa, xb, zb - 4, zb]; t2 = [xa, xb, za, zb - 4]; }
    else { t1 = [xa, xb, za, za + 4]; t2 = [xa, xb, za + 4, zb]; }
    const w1 = t1[1] - t1[0], d1 = t1[3] - t1[2];
    const w2 = t2[1] - t2[0], d2 = t2[3] - t2[2];
    const c1x = (t1[0] + t1[1]) / 2, c1z = (t1[2] + t1[3]) / 2;
    const c2x = (t2[0] + t2[1]) / 2, c2z = (t2[2] + t2[3]) / 2;
    box(w1, 3, d1, CONCRETE, c1x, 0.1, c1z);
    box(w1 - 0.6, 0.3, d1 - 0.6, seat, c1x, 3.1, c1z);
    box(w2, 6, d2, CONCRETE, c2x, 0.1, c2z);
    box(w2 - 0.6, 0.3, d2 - 0.6, seat, c2x, 6.1, c2z);
  }
  // West + east stands (full length, no gap).
  stand(x0, x0 + sd, z0, z1, 'x-');
  stand(x1 - sd, x1, z0, z1, 'x+');
  // South + north stands, split around the 6 m centre entrance gap.
  const gap = 3;
  stand(x0 + sd, cx - gap, z0, z0 + sd, 'z-');
  stand(cx + gap, x1 - sd, z0, z0 + sd, 'z-');
  stand(x0 + sd, cx - gap, z1 - sd, z1, 'z+');
  stand(cx + gap, x1 - sd, z1 - sd, z1, 'z+');
  // Entrance gate posts at both gaps + a small canopy over the south gap.
  for (const gz of [z0 + sd / 2, z1 - sd / 2]) {
    for (const dx of [-gap - 0.2, gap + 0.2]) box(0.4, 3, 0.4, DARK, cx + dx, 0.1, gz);
  }
  box(gap * 2 + 1.2, 0.3, sd + 0.6, ROOF, cx, 3.0, z0 + sd / 2);

  // --- Canopy over the main (west) stand: flat slab on 4 columns. ---
  box(10, 0.3, z1 - z0 - 2, ROOF, x0 + sd / 2, 7.2, cz);
  for (const dz of [z0 + 4, z1 - 4]) {
    box(0.4, 7.2, 0.4, DARK, x0 + 1, 0.1, dz);
    box(0.4, 7.2, 0.4, DARK, x0 + sd - 1, 0.1, dz);
  }

  // --- Floodlight poles at the four corners (heads are the night mesh). ---
  const headPos = [];
  for (const [fx, fz] of [[x0 + 4, z0 + 4], [x1 - 4, z0 + 4], [x0 + 4, z1 - 4], [x1 - 4, z1 - 4]]) {
    box(0.35, 14, 0.35, DARK, fx, 0.1, fz);
    box(2.2, 0.15, 1.2, DARK, fx, 14.1, fz);
    headPos.push([fx, 14.4, fz]);
  }

  // --- Scoreboard: dark board + amber strip, on posts just north of the
  // north stand (inside the block, facing the pitch). ---
  for (const dx of [-2.6, 2.6]) box(0.3, 4, 0.3, DARK, cx + dx, 0.1, z1 + 4.5);
  box(6, 3, 0.3, BOARD, cx, 4.1, z1 + 4.5);
  box(5.4, 0.5, 0.06, AMBER, cx, 5.2, z1 + 4.28);

  // Floodlight heads: one bright 2x0.9 m panel per pole, drawn only at
  // night (unlit instanced mesh, warm white tint).
  const lampGeom = (() => {
    const hg = emptyGeom();
    const lamp = plainBox(2.0, 0.9, 0.15, [1, 1, 1]);
    hg.pos.push(...lamp.pos); hg.nrm.push(...lamp.nrm); hg.col.push(...lamp.col);
    return hg;
  })();

  return {
    base: g,
    floodHeads: {
      geom: lampGeom,
      matrices: headPos.map(([x, y, z]) => {
        // Identity rotation, unit scale: a 4x4 column-major matrix.
        const m = new Float32Array(16);
        m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
        m[12] = x; m[13] = y; m[14] = z;
        return m;
      }),
      tints: headPos.map(() => [1, 0.9, 0.6]),
    },
    counts: {
      boxes,
      tris: g.pos.length / 9,
      floodlights: headPos.length,
      pitchW,
      pitchD,
    },
  };
}
