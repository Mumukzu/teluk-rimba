// Teluk Rimba — riverfront (Phase I, Mu).
// Everything code-made only: no external images, no downloaded textures,
// no image files — markings, pictograms and decorations are geometry and
// canvas-drawn shapes only (same rule as the parking zones).
//
// The two river sides connect ONLY via the 4 bridge edges in the road
// graph. This module dresses the banks so that reads cleanly in the world:
//   * semicircle end caps where the 7 dropped river-crossing roads end
//     (14 bank ends — a rounded cul-de-sac terminus instead of a flat cut),
//   * an embankment wall + promenade footpath + low fence along BOTH banks
//     (skipping ~14 m around each bridge crossing, where the deck rules),
//   * spur footpaths from each bank-end node down to the promenade,
//   * 2 small wooden docks + 1 set of wooden steps down to the water,
//   * small parks (benches + footpath + flowers + trees) in the empty
//     river-zone blocks, and tree clusters in the rd 18-30 buffer —
//     greener and denser near the river than elsewhere.
// No graph changes: the road graph stays ONE connected component via the
// 4 bridges. Two merged static meshes (hard + green) = +2 draw calls.
import { mulberry32, range, rangeInt } from './rng.js';
import { RIVER_POINTS, RIVER_HALF_WIDTH, riverDistance, distToSegment, IS_MAIN, ASPHALT_HALF, terrainHeight } from './city.js';
import { emptyGeom, plainBox } from './gl.js';
import { buildParking } from './parking.js';

const WALL_COL = [0.5, 0.5, 0.47];    // stone-grey embankment wall
const PROM_COL = [0.72, 0.7, 0.66];   // light paving promenade / spur paths
const FENCE_COL = [0.28, 0.28, 0.3];  // dark low fence
const CAP_COL = [0.32, 0.32, 0.34];   // asphalt cul-de-sac caps
const WOOD_COL = [0.55, 0.42, 0.28];  // wooden docks / steps / benches
const TRUNK_COL = [0.4, 0.28, 0.16];
const LEAF_COL = [0.2, 0.48, 0.2];
const LEAF_LT_COL = [0.27, 0.56, 0.25];
const FLOWER_COLS = [[0.9, 0.35, 0.45], [0.95, 0.6, 0.2], [0.95, 0.85, 0.3], [0.95, 0.95, 0.95]];

// Flat triangle, emitted BOTH windings so it reads from above with
// backface culling on regardless of corner order.
function triBoth(g, a, b, c, y, col) {
  g.pos.push(a[0], y, a[1], b[0], y, b[1], c[0], y, c[1]);
  for (let i = 0; i < 3; i++) g.nrm.push(0, 1, 0);
  for (let i = 0; i < 3; i++) g.col.push(col[0], col[1], col[2]);
  g.pos.push(a[0], y, a[1], c[0], y, c[1], b[0], y, b[1]);
  for (let i = 0; i < 3; i++) g.nrm.push(0, 1, 0);
  for (let i = 0; i < 3; i++) g.col.push(col[0], col[1], col[2]);
}

// Flat quad from four (x, z) corners, emitted BOTH windings so it reads
// from above with backface culling on regardless of corner order.
function quadBoth(g, corners, y, col) {
  const [a, b, c, d] = corners;
  triBoth(g, a, c, b, y, col);
  triBoth(g, a, d, c, y, col);
}

// Vertical wall quad between two ground points, both windings (visible
// from the water side and from the promenade side).
function wallQuad(g, ax, az, bx, bz, y0, y1, col) {
  const tri = (p, q, r) => {
    g.pos.push(...p, ...q, ...r);
    for (let i = 0; i < 3; i++) g.nrm.push(0, 0, 1);
    for (let i = 0; i < 3; i++) g.col.push(col[0], col[1], col[2]);
  };
  const A = [ax, y0, az], B = [bx, y0, bz], C = [bx, y1, bz], D = [ax, y1, az];
  tri(A, B, C); tri(A, C, D);
  tri(A, C, B); tri(A, D, C);
}

// Rotate a part geom around Y and translate it, then merge into g.
function addPart(g, part, x, y, z, rot) {
  const cos = Math.cos(rot), sin = Math.sin(rot);
  for (let i = 0; i < part.pos.length; i += 3) {
    const px = part.pos[i], py = part.pos[i + 1], pz = part.pos[i + 2];
    g.pos.push(px * cos + pz * sin + x, py + y, -px * sin + pz * cos + z);
  }
  g.nrm.push(...part.nrm);
  g.col.push(...part.col);
}

// Small riverbank tree: trunk + two crown blobs (same style as yard trees).
function riverTreeGeom(scale) {
  const g = emptyGeom();
  const at = (part, x, y, z) => {
    for (let i = 0; i < part.pos.length; i += 3) { part.pos[i] += x; part.pos[i + 1] += y; part.pos[i + 2] += z; }
    g.pos.push(...part.pos); g.nrm.push(...part.nrm); g.col.push(...part.col);
  };
  at(plainBox(0.34 * scale, 1.9 * scale, 0.34 * scale, TRUNK_COL), 0, 0.95 * scale, 0);
  at(plainBox(2.1 * scale, 1.1 * scale, 2.1 * scale, LEAF_COL), 0, 2.6 * scale, 0);
  at(plainBox(1.2 * scale, 0.8 * scale, 1.2 * scale, LEAF_LT_COL), 0.5 * scale, 2.2 * scale, 0.5 * scale);
  return g;
}

function benchGeom() {
  const g = emptyGeom();
  const at = (part, x, y, z) => {
    for (let i = 0; i < part.pos.length; i += 3) { part.pos[i] += x; part.pos[i + 1] += y; part.pos[i + 2] += z; }
    g.pos.push(...part.pos); g.nrm.push(...part.nrm); g.col.push(...part.col);
  };
  at(plainBox(2.4, 0.12, 0.7, WOOD_COL), 0, 0.5, 0);
  at(plainBox(2.4, 0.6, 0.1, WOOD_COL), 0, 0.85, -0.32);
  return g;
}

// The 7 dropped river-crossing grid edges (the graph drops them so no
// road crosses the river except the 4 bridges). Re-derived here from the
// same rule the city uses, so the caps always match the graph.
function droppedCrossings(city) {
  const kept = new Set();
  const nodeById = new Map(city.nodes.map((n) => [n.id, n]));
  for (const e of city.edges) {
    const a = nodeById.get(e.a), b = nodeById.get(e.b);
    kept.add(`${a.x},${a.z}|${b.x},${b.z}`);
    kept.add(`${b.x},${b.z}|${a.x},${a.z}`);
  }
  const segCrosses = (ax, az, bx, bz) => {
    for (let s = 0; s <= 4; s++) {
      const t = s / 4;
      if (riverDistance(ax + (bx - ax) * t, az + (bz - az) * t) < RIVER_HALF_WIDTH + 3) return true;
    }
    return false;
  };
  const out = [];
  const N = 13; // ROAD_LINES.length
  const LINES = [-600, -500, -400, -300, -200, -100, 0, 100, 200, 300, 400, 500, 600];
  for (let j = 0; j < N; j++) for (let i = 0; i < N - 1; i++) {
    const ax = LINES[i], az = LINES[j], bx = LINES[i + 1], bz = LINES[j];
    if (riverDistance(ax, az) < RIVER_HALF_WIDTH || riverDistance(bx, bz) < RIVER_HALF_WIDTH) continue;
    if (segCrosses(ax, az, bx, bz) && !kept.has(`${ax},${az}|${bx},${bz}`)) out.push({ a: [ax, az], b: [bx, bz] });
  }
  for (let i = 0; i < N; i++) for (let j = 0; j < N - 1; j++) {
    const ax = LINES[i], az = LINES[j], bx = LINES[i], bz = LINES[j + 1];
    if (riverDistance(ax, az) < RIVER_HALF_WIDTH || riverDistance(bx, bz) < RIVER_HALF_WIDTH) continue;
    if (segCrosses(ax, az, bx, bz) && !kept.has(`${ax},${az}|${bx},${bz}`)) out.push({ a: [ax, az], b: [bx, bz] });
  }
  return out;
}

// Closest point on the river polyline to (x, z), plus the segment dir.
function closestRiverPoint(x, z) {
  let best = null, bestD = Infinity;
  for (let i = 0; i < RIVER_POINTS.length - 1; i++) {
    const [ax, az] = RIVER_POINTS[i], [bx, bz] = RIVER_POINTS[i + 1];
    const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz;
    let t = len2 === 0 ? 0 : ((x - ax) * dx + (z - az) * dz) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx, cz = az + t * dz;
    const d = Math.hypot(x - cx, z - cz);
    if (d < bestD) { bestD = d; best = { x: cx, z: cz, dx, dz, len: Math.sqrt(len2) }; }
  }
  return best;
}

export function buildRiverfront(city) {
  const hard = emptyGeom();
  const green = emptyGeom();
  const counts = { caps: 0, spurPaths: 0, bridges: 0, promenadeM: 0, wallM: 0, fenceM: 0, docks: 0, steps: 0, parks: 0, clusters: 0, trees: 0, benches: 0, flowers: 0 };
  const rand = mulberry32(20261123);

  // --- road edges for clearance checks (point must stay > 10 m off asphalt)
  const nodeById = new Map(city.nodes.map((n) => [n.id, n]));
  const roadSegs = city.edges.map((e) => {
    const a = nodeById.get(e.a), b = nodeById.get(e.b);
    return [a.x, a.z, b.x, b.z];
  });
  const nearRoad = (x, z, m) => {
    for (const [ax, az, bx, bz] of roadSegs) if (distToSegment(x, z, ax, az, bx, bz) < m) return true;
    return false;
  };
  const clearOfBuildings = (x, z, m) => {
    for (const b of city.buildings) {
      if (Math.abs(x - b.x) < b.w / 2 + m && Math.abs(z - b.z) < b.d / 2 + m) return false;
    }
    return true;
  };
  const lots = buildParking(city).lots.map((l) => l.rect);
  const inLot = (x, z, m) => lots.some((r) => x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m);

  // --- bridge crossing points (where each bridge edge meets the river)
  const bridgeCrossings = [];
  for (const e of city.edges.filter((e) => e.bridge)) {
    const a = nodeById.get(e.a), b = nodeById.get(e.b);
    let best = null, bestD = Infinity;
    for (let s = 0; s <= 8; s++) {
      const t = s / 8, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      const d = riverDistance(x, z);
      if (d < bestD) { bestD = d; best = { x, z }; }
    }
    bridgeCrossings.push(best);
  }
  const nearBridge = (x, z, m) => bridgeCrossings.some((p) => Math.hypot(x - p.x, z - p.z) < m);

  // --- 1. End caps + spur footpaths at the 7 dropped crossings (14 ends)
  for (const edge of droppedCrossings(city)) {
    for (const [px, pz] of [edge.a, edge.b]) {
      const [qx, qz] = (px === edge.a[0] && pz === edge.a[1]) ? edge.b : edge.a;
      const dx = Math.sign(qx - px), dz = Math.sign(qz - pz);
      const fixed = dx !== 0 ? pz : px; // the grid line the road runs along
      const r = ASPHALT_HALF(fixed) + 1;
      // Semicircle fan: flat diameter through the node, arc bulging toward
      // the dropped edge (toward the river).
      const a0 = Math.atan2(dz, dx);
      const arc = [];
      for (let i = 0; i <= 10; i++) {
        const a = a0 - Math.PI / 2 + (i / 10) * Math.PI;
        // Mu (river cleanup): the fan bulged toward the river and its arc
        // could jut INTO the water. Pull any arc point back toward the
        // node until it sits on dry land (rd >= 14) — no paving in the
        // river.
        let cx = px + Math.cos(a) * r, cz = pz + Math.sin(a) * r;
        while (riverDistance(cx, cz) < 14 && Math.hypot(cx - px, cz - pz) > 0.5) {
          const d = Math.hypot(cx - px, cz - pz);
          cx = px + (cx - px) / d * (d - 0.5);
          cz = pz + (cz - pz) / d * (d - 0.5);
        }
        arc.push([cx, cz]);
      }
      for (let i = 0; i < arc.length - 1; i++) {
        triBoth(hard, [px, pz], arc[i], arc[i + 1], 0.05, CAP_COL);
      }
      counts.caps++;
      // Spur footpath from the node down to the promenade (if the node is
      // far enough from the water for a path to exist).
      const rd = riverDistance(px, pz);
      if (rd > 14) {
        const rp = closestRiverPoint(px, pz);
        const len = Math.min(12, rd - 14.75);
        if (len > 1) {
          const ux = (rp.x - px) / rd, uz = (rp.z - pz) / rd;
          const ex = px + ux * len, ez = pz + uz * len;
          const nx = -uz, nz = ux, hw = 1.25;
          quadBoth(hard, [
            [px + nx * hw, pz + nz * hw], [px - nx * hw, pz - nz * hw],
            [ex - nx * hw, ez - nz * hw], [ex + nx * hw, ez + nz * hw],
          ], 0.06, PROM_COL);
          counts.spurPaths++;
        }
      }
    }
  }

  // --- 1b. Bridge railings + support pillars (the 4 bridge decks).
  // The road mesh draws the deck itself; the railing (posts + top rail on
  // both sides) and the pillars under the deck close the bridge visually.
  for (const e of city.edges.filter((e) => e.bridge)) {
    const a = nodeById.get(e.a), b = nodeById.get(e.b);
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
    const ux = dx / len, uz = dz / len, nx = -uz, nz = ux;
    const ah = ASPHALT_HALF(a.x === b.x ? a.x : a.z) + 1;
    for (const side of [1, -1]) {
      const ox = nx * ah * side, oz = nz * ah * side;
      // Top rail: one long thin box along the deck edge.
      const rot = Math.atan2(-ux, uz);
      addPart(hard, plainBox(0.09, 0.09, len, FENCE_COL), (a.x + b.x) / 2 + ox, 0.95, (a.z + b.z) / 2 + oz, rot);
      // Posts every ~5 m.
      const nPosts = Math.max(2, Math.round(len / 5));
      for (let i = 0; i <= nPosts; i++) {
        const t = i / nPosts;
        addPart(hard, plainBox(0.1, 0.95, 0.1, FENCE_COL), a.x + dx * t + ox, 0.5, a.z + dz * t + oz, 0);
      }
    }
    // Two support pillars in the water under the deck.
    for (const t of [1 / 3, 2 / 3]) {
      addPart(hard, plainBox(1.6, 1.4, 1.6, WALL_COL), a.x + dx * t, -0.6, a.z + dz * t, 0);
    }
    counts.bridges++;
  }
  // Walk the river polyline in ~8 m steps; skip ~14 m around each bridge.
  const pts = [];
  for (let i = 0; i < RIVER_POINTS.length - 1; i++) {
    const [ax, az] = RIVER_POINTS[i], [bx, bz] = RIVER_POINTS[i + 1];
    const segLen = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.round(segLen / 8));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      pts.push([ax + (bx - ax) * t, az + (bz - az) * t]);
    }
  }
  pts.push([...RIVER_POINTS[RIVER_POINTS.length - 1]]);
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    if (nearBridge(mx, mz, 14)) continue;
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
    if (len < 0.01) continue;
    const nx = -dz / len, nz = dx / len; // unit normal
    const segM = len;
    for (const side of [1, -1]) {
      // Mu: a bank structure must never cross a road. The 14 m skip
      // around each bridge crossing is measured from the river centre,
      // but the wall (rd 11.5), promenade (rd 13-16.5) and fence (rd
      // 17.5) sit 15-23 m from the crossing point along the road, so
      // they used to pave/fence straight across every bridge approach
      // (51 pieces city-wide — e.g. the pale slab + fence across the
      // (0,-100) bridge road in view-08). Skip each structure whose
      // midpoint lands on or beside a road; the path meets the road
      // and resumes after it.
      const midAt = (off) => [mx + nx * off * side, mz + nz * off * side];
      // A piece is ~8 m long, so its midpoint can sit clear of the road
      // while an end still pokes onto it — test the ends (and the
      // middle) of each piece, not just its midpoint.
      const touchesRoad = (pts) => pts.some(([wx, wz]) => nearRoad(wx, wz, 11));
      const pA = [ax + nx * 11.5 * side, az + nz * 11.5 * side];
      const pB = [bx + nx * 11.5 * side, bz + nz * 11.5 * side];
      // Embankment wall: a clear stone lip (top y 0.35) so the sunken
      // channel reads as a real river, not a blue sheet on the grass.
      if (!touchesRoad([pA, pB, midAt(11.5)])) {
        wallQuad(hard, pA[0], pA[1], pB[0], pB[1], -1.0, 0.35, WALL_COL);
        counts.wallM += segM;
      }
      // Promenade: 3.5 m wide strip, rd 13-16.5.
      const prA = [ax + nx * 13 * side, az + nz * 13 * side];
      const prB = [bx + nx * 13 * side, bz + nz * 13 * side];
      const prC = [bx + nx * 16.5 * side, bz + nz * 16.5 * side];
      const prD = [ax + nx * 16.5 * side, az + nz * 16.5 * side];
      if (!touchesRoad([prA, prB, prC, prD, midAt(14.75)])) {
        quadBoth(hard, [prA, prB, prC, prD], 0.06, PROM_COL);
        counts.promenadeM += segM;
      }
      // Fence at rd 17.5: posts every ~4 m + TWO rails, so it reads as a
      // fence from the air — not one thin stray black line on the grass.
      const fA = [ax + nx * 17.5 * side, az + nz * 17.5 * side];
      const fB = [bx + nx * 17.5 * side, bz + nz * 17.5 * side];
      const rot = Math.atan2(-(fB[0] - fA[0]), fB[1] - fA[1]);
      if (!touchesRoad([fA, fB, midAt(17.5)])) {
        addPart(hard, plainBox(0.1, 0.1, len + 0.1, FENCE_COL), (fA[0] + fB[0]) / 2, 0.62, (fA[1] + fB[1]) / 2, rot);
        addPart(hard, plainBox(0.1, 0.1, len + 0.1, FENCE_COL), (fA[0] + fB[0]) / 2, 0.35, (fA[1] + fB[1]) / 2, rot);
        counts.fenceM += segM;
        // One post per step (8 m) + a midpoint post (4 m spacing).
        addPart(hard, plainBox(0.09, 0.75, 0.09, FENCE_COL), fA[0], 0.38, fA[1], 0);
        addPart(hard, plainBox(0.09, 0.75, 0.09, FENCE_COL), (fA[0] + fB[0]) / 2, 0.38, (fA[1] + fB[1]) / 2, 0);
      }
    }
  }

  // --- 3. Docks + steps (city-side bank only). Targets snapped to the river.
  const dockTargets = [
    { at: [100, -30], kind: 'dock' },
    { at: [330, 35], kind: 'dock' },
    { at: [-350, -370], kind: 'steps' },
  ];
  for (const { at, kind } of dockTargets) {
    const rp = closestRiverPoint(at[0], at[1]);
    if (!rp || nearBridge(rp.x, rp.z, 20)) continue;
    // City-side normal: the one pointing toward the city centre (0, 0).
    const nx0 = -rp.dz / rp.len, nz0 = rp.dx / rp.len;
    const side = (nx0 * (0 - rp.x) + nz0 * (0 - rp.z)) >= 0 ? 1 : -1;
    const nx = nx0 * side, nz = nz0 * side;
    const rot = Math.atan2(-nx, nz);
    if (kind === 'dock') {
      // Wooden platform, 8 m long (rd 15 -> rd 7), 3 m wide, over the water.
      const cx = rp.x + nx * 11, cz = rp.z + nz * 11;
      addPart(hard, plainBox(3, 0.16, 8, WOOD_COL), cx, 0.12, cz, rot);
      for (const [ox, oz] of [[-1.3, -3.6], [1.3, -3.6], [-1.3, 3.6], [1.3, 3.6]]) {
        const c = Math.cos(rot), s = Math.sin(rot);
        addPart(hard, plainBox(0.16, 1.3, 0.16, WOOD_COL), cx + ox * c + oz * s, -0.5, cz - ox * s + oz * c, 0);
      }
      counts.docks++;
    } else {
      // Wooden steps down from the promenade to the water. Each step sits
      // on the bank slope (terrainHeight + 0.12), so it follows the deeper
      // channel instead of floating or burying.
      for (let i = 0; i < 3; i++) {
        const rd = 14.5 - i * 1.5;
        const sx = rp.x + nx * rd, sz = rp.z + nz * rd;
        addPart(hard, plainBox(2.5, 0.3, 1.3, WOOD_COL), sx, terrainHeight(sx, sz) + 0.12, sz, rot);
      }
      counts.steps++;
    }
  }

  // --- 4. Parks in the empty river-zone blocks + tree clusters in rd 18-30.
  const parkSpots = [];
  for (const b of city.blocks) {
    if (!(b.zone === 'river' || riverDistance(b.cx, b.cz) < 26)) continue;
    let spot = null;
    for (const [ox, oz] of [[0, 0], [25, 0], [-25, 0], [0, 25], [0, -25], [25, 25], [-25, -25], [25, -25], [-25, 25]]) {
      const x = b.cx + ox, z = b.cz + oz, rd = riverDistance(x, z);
      if (rd < 13 || rd > 24) continue;
      if (nearRoad(x, z, 10) || !clearOfBuildings(x, z, 2) || inLot(x, z, 2)) continue;
      spot = { x, z };
      break;
    }
    if (spot) parkSpots.push(spot);
  }
  for (const { x, z } of parkSpots) {
    const rot = range(rand, 0, Math.PI * 2);
    quadBoth(hard, [[x - 1.5, z - 1.5], [x + 1.5, z - 1.5], [x + 1.5, z + 1.5], [x - 1.5, z + 1.5]], 0.06, PROM_COL);
    addPart(green, benchGeom(), x - 1.2, 0.06, z, rot);
    addPart(green, benchGeom(), x + 1.2, 0.06, z, rot + Math.PI);
    counts.benches += 2;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      addPart(green, plainBox(1.2, 0.3, 1.2, FLOWER_COLS[i % FLOWER_COLS.length]), x + Math.cos(a) * 3.2, 0.2, z + Math.sin(a) * 3.2, 0);
      counts.flowers++;
    }
    for (let i = 0; i < 3; i++) {
      const a = range(rand, 0, Math.PI * 2), d = range(rand, 4, 6);
      const tx = x + Math.cos(a) * d, tz = z + Math.sin(a) * d;
      if (riverDistance(tx, tz) < 13 || nearRoad(tx, tz, 8) || !clearOfBuildings(tx, tz, 2)) continue;
      addPart(green, riverTreeGeom(range(rand, 0.9, 1.2)), tx, 0.06, tz, range(rand, 0, Math.PI * 2));
      counts.trees++;
    }
    counts.parks++;
  }
  // Tree clusters in the rd 18-30 buffer: denser and greener near the river.
  // Sample ALONG the river (a random polyline point + a random offset
  // 18-30 m to either bank) — uniform city sampling almost never lands in
  // the thin buffer strip.
  let tries = 0;
  while (counts.clusters < 25 && tries < 200) {
    tries++;
    const seg = rangeInt(rand, 0, RIVER_POINTS.length - 2);
    const [ax, az] = RIVER_POINTS[seg], [bx, bz] = RIVER_POINTS[seg + 1];
    const t = range(rand, 0, 1);
    const px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
    const segLen = Math.hypot(bx - ax, bz - az);
    const nx = -(bz - az) / segLen, nz = (bx - ax) / segLen;
    const side = rand() < 0.5 ? 1 : -1;
    const off = range(rand, 18, 30);
    const x = px + nx * off * side, z = pz + nz * off * side;
    if (nearRoad(x, z, 10) || !clearOfBuildings(x, z, 2) || inLot(x, z, 2)) continue;
    const n = rangeInt(rand, 3, 6);
    let placed = 0;
    for (let i = 0; i < n; i++) {
      const a = range(rand, 0, Math.PI * 2), d = range(rand, 0, 6);
      const tx = x + Math.cos(a) * d, tz = z + Math.sin(a) * d;
      const trd = riverDistance(tx, tz);
      if (trd < 17 || trd > 31 || nearRoad(tx, tz, 8) || !clearOfBuildings(tx, tz, 2) || inLot(tx, tz, 2)) continue;
      addPart(green, riverTreeGeom(range(rand, 0.8, 1.3)), tx, 0.06, tz, range(rand, 0, Math.PI * 2));
      counts.trees++;
      placed++;
    }
    if (placed > 0) counts.clusters++;
  }

  return { hard, green, counts };
}
