// Riverfront guardrail checks (Mu guardrail fix, 24 Nov 2026): the
// riverbank fence must read as a clean level guardrail in every sector —
// rails run ALONG the fence line (not crossing it), posts stand on the
// ground (not floating), docks jut out over the water, steps run along
// the bank. Regression for the mirrored atan2(-dx, dz) rotation bug:
// for a Z-long box the heading is atan2(dx, dz); the mirrored sign put
// rails up to 90 deg off the fence line on diagonal stretches, and
// fixed-y posts floated up to 4 m where the bank dips (lake bowl,
// beach slope, river bends).
import { generateCity, RIVER_POINTS, terrainHeight, distToSegment } from '../game/src/city.js';
import { buildRiverfront } from '../game/src/riverfront.js';

let fails = 0;
function check(name, ok, extra = '') {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (ok ? '' : '  ' + extra));
  if (!ok) fails++;
}

const city = generateCity();
const rf = buildRiverfront(city);
const g = rf.hard;
const FENCE = [0.28, 0.28, 0.3];
const WOOD = [0.55, 0.42, 0.28];
const isCol = (i, c) => Math.abs(g.col[i * 3] - c[0]) < 0.01
  && Math.abs(g.col[i * 3 + 1] - c[1]) < 0.01 && Math.abs(g.col[i * 3 + 2] - c[2]) < 0.01;

// One plainBox = 12 triangles = 36 vertices; same-colour parts added
// consecutively merge into longer runs, so split runs into 36-vert boxes.
function boxesOf(col) {
  const runs = [];
  let cur = [];
  for (let i = 0; i < g.pos.length / 3; i++) {
    if (isCol(i, col)) cur.push(i);
    else { if (cur.length) runs.push(cur); cur = []; }
  }
  if (cur.length) runs.push(cur);
  const out = [];
  for (const r of runs) for (let s = 0; s + 36 <= r.length; s += 36) out.push(r.slice(s, s + 36));
  return out;
}
function bbox(b) {
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const i of b) {
    minX = Math.min(minX, g.pos[i * 3]); maxX = Math.max(maxX, g.pos[i * 3]);
    minY = Math.min(minY, g.pos[i * 3 + 1]); maxY = Math.max(maxY, g.pos[i * 3 + 1]);
    minZ = Math.min(minZ, g.pos[i * 3 + 2]); maxZ = Math.max(maxZ, g.pos[i * 3 + 2]);
  }
  return { minX, maxX, minY, maxY, minZ, maxZ, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, cz: (minZ + maxZ) / 2 };
}
function farthestPair(b) {
  let best = 0, p1 = b[0], p2 = b[0];
  for (let a = 0; a < b.length; a++) for (let c = a + 1; c < b.length; c++) {
    const d = Math.hypot(g.pos[b[a] * 3] - g.pos[b[c] * 3], g.pos[b[a] * 3 + 1] - g.pos[b[c] * 3 + 1], g.pos[b[a] * 3 + 2] - g.pos[b[c] * 3 + 2]);
    if (d > best) { best = d; p1 = b[a]; p2 = b[c]; }
  }
  return { len: best, ax: (g.pos[p2 * 3] - g.pos[p1 * 3]) / best, ay: (g.pos[p2 * 3 + 1] - g.pos[p1 * 3 + 1]) / best, az: (g.pos[p2 * 3 + 2] - g.pos[p1 * 3 + 2]) / best };
}

// River segment directions (for rail alignment) and bridge edge lines
// (bridge rails/posts are FENCE_COL too, but stand on the deck —
// exclude them from the riverbank checks).
const riverDirs = [];
for (let i = 0; i < RIVER_POINTS.length - 1; i++) {
  const [ax, az] = RIVER_POINTS[i], [bx, bz] = RIVER_POINTS[i + 1];
  const L = Math.hypot(bx - ax, bz - az);
  riverDirs.push([(bx - ax) / L, (bz - az) / L]);
}
const riverAngleErr = (ax, az) => {
  let best = 180;
  for (const [dx, dz] of riverDirs) {
    best = Math.min(best, Math.acos(Math.min(1, Math.abs(ax * dx + az * dz))) * 180 / Math.PI);
  }
  return best;
};
const nodeById = new Map(city.nodes.map((n) => [n.id, n]));
const bridgeSegs = city.edges.filter((e) => e.bridge).map((e) => {
  const a = nodeById.get(e.a), b = nodeById.get(e.b);
  return [a.x, a.z, b.x, b.z];
});
const nearBridgeLine = (x, z, m) => bridgeSegs.some(([ax, az, bx, bz]) => distToSegment(x, z, ax, az, bx, bz) < m);
// River normal at (x, z): normal of the nearest river segment, pointing
// toward the city centre (0, 0).
function riverNormal(x, z) {
  let best = null, bestD = Infinity;
  for (let i = 0; i < RIVER_POINTS.length - 1; i++) {
    const [ax, az] = RIVER_POINTS[i], [bx, bz] = RIVER_POINTS[i + 1];
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
    const d = distToSegment(x, z, ax, az, bx, bz);
    if (d < bestD) { bestD = d; best = { nx: -dz / L, nz: dx / L }; }
  }
  if (best.nx * (0 - x) + best.nz * (0 - z) < 0) { best.nx *= -1; best.nz *= -1; }
  return best;
}

let railCount = 0, worstRailErr = 0, worstRailH = 0;
let postCount = 0, worstPostFloat = 0;
for (const b of boxesOf(FENCE)) {
  const bb = bbox(b);
  const ex = bb.maxX - bb.minX, ey = bb.maxY - bb.minY, ez = bb.maxZ - bb.minZ;
  if (nearBridgeLine(bb.cx, bb.cz, 8)) continue; // bridge rail/post: deck, not bank
  if (Math.max(ex, ez) > 3 && ey < 0.2) {
    // Fence rail: thin box, one long horizontal extent.
    const fp = farthestPair(b);
    if (Math.abs(fp.ay) > 0.1) continue;
    railCount++;
    worstRailErr = Math.max(worstRailErr, riverAngleErr(fp.ax, fp.az));
    const hAbove = bb.cy - terrainHeight(bb.cx, bb.cz);
    worstRailH = Math.max(worstRailH, Math.abs(hAbove - 0.485));
  } else if (ey > 0.3 && ey < 1.6 && ex < 0.2 && ez < 0.2) {
    // Fence post: tall thin box standing on the bank.
    postCount++;
    worstPostFloat = Math.max(worstPostFloat, Math.abs(bb.minY - terrainHeight(bb.cx, bb.cz)));
  }
}
check('fence rails run along the fence line (max axis error < 2 deg, ' + railCount + ' rails)',
  railCount > 300 && worstRailErr < 2, 'worst ' + worstRailErr.toFixed(2) + ' deg, rails=' + railCount);
check('fence posts stand on the ground (max |float| < 0.05 m, ' + postCount + ' posts)',
  postCount > 500 && worstPostFloat < 0.05, 'worst ' + worstPostFloat.toFixed(2) + ' m, posts=' + postCount);
check('fence rails sit just above local ground (rails at +0.35/+0.62 m)',
  worstRailH < 0.3, 'worst deviation ' + worstRailH.toFixed(2) + ' m');
check('fence still covers the river (fenceM > 2500 m)',
  rf.counts.fenceM > 2500, 'fenceM=' + rf.counts.fenceM.toFixed(0));
check('2 docks + 1 steps built', rf.counts.docks === 2 && rf.counts.steps === 1,
  'docks=' + rf.counts.docks + ' steps=' + rf.counts.steps);

// Dock platforms (3 x 8 m): long axis must match the river normal at
// their centre; steps (2.5 x 1.3 m): long side must match the tangent.
// Orientation is recovered from the bbox extents (farthest-pair is the
// space diagonal for these wide boxes, so it cannot be used here).
let dockOk = 0, dockBad = 0, stepOk = 0, stepBad = 0;
for (const b of boxesOf(WOOD)) {
  const bb = bbox(b);
  const ex = bb.maxX - bb.minX, ez = bb.maxZ - bb.minZ;
  const maxExt = Math.max(ex, ez);
  if (maxExt > 5) {
    // Dock platform: 3 wide x 8 long.
    const { nx, nz } = riverNormal(bb.cx, bb.cz);
    const exExp = 3 * Math.abs(nz) + 8 * Math.abs(nx);
    const ezExp = 3 * Math.abs(nx) + 8 * Math.abs(nz);
    if (Math.abs(ex - exExp) < 0.15 && Math.abs(ez - ezExp) < 0.15) dockOk++;
    else dockBad++;
  } else if (maxExt > 2 && maxExt < 4) {
    // Step: 2.5 wide (tangent) x 1.3 deep (normal).
    const { nx, nz } = riverNormal(bb.cx, bb.cz);
    const exExp = 2.5 * Math.abs(nz) + 1.3 * Math.abs(nx);
    const ezExp = 2.5 * Math.abs(nx) + 1.3 * Math.abs(nz);
    if (Math.abs(ex - exExp) < 0.15 && Math.abs(ez - ezExp) < 0.15) stepOk++;
    else stepBad++;
  }
}
check('dock platforms jut out over the water (long axis = river normal)',
  dockOk === 2 && dockBad === 0, 'ok=' + dockOk + ' bad=' + dockBad);
check('steps run along the bank (long side = river tangent)',
  stepOk === 3 && stepBad === 0, 'ok=' + stepOk + ' bad=' + stepBad);

if (fails) { console.error(fails + ' RIVERFRONT CHECK(S) FAILED'); process.exit(1); }
console.log('ALL RIVERFRONT CHECKS PASSED');
