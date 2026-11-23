// Phase F checks: no dead-end roads, exactly 4 bridges, one zebra per
// intersection on land, realistic vehicle geometry proportions.
import { generateCity, riverDistance, ASPHALT_HALF } from '../game/src/city.js';
import { zebraSpots } from '../game/src/roads.js';
import { buildVehicleGeoms, buildVehicleGlassGeoms } from '../game/src/vehicles.js';
import { VEHICLES } from '../game/src/config.js';

let fails = 0;
function check(name, ok) {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name);
  if (!ok) fails++;
}

const city = generateCity();
const nodeById = new Map(city.nodes.map((n) => [n.id, n]));
const deg = new Map();
for (const e of city.edges) {
  deg.set(e.a, (deg.get(e.a) || 0) + 1);
  deg.set(e.b, (deg.get(e.b) || 0) + 1);
}
check('162 nodes after dead-end pruning (was 164)', city.nodes.length === 162);
check('286 edges after pruning (was 288)', city.edges.length === 286);
check('no dead-end nodes (every node degree >= 2)',
  city.nodes.every((n) => (deg.get(n.id) || 0) >= 2));
const bridges = city.edges.filter((e) => e.bridge);
check('exactly 4 bridge edges', bridges.length === 4);
const bridgeKeys = new Set(bridges.map((e) => {
  const a = nodeById.get(e.a), b = nodeById.get(e.b);
  return [a.x + ',' + a.z + '|' + b.x + ',' + b.z, b.x + ',' + b.z + '|' + a.x + ',' + a.z].sort()[0];
}));
const want = new Set([
  '-300,-300|-200,-300', '-200,-200|-100,-200', '0,-100|0,0', '400,0|400,100',
].map((k) => k.split('|').sort().join('|')));
check('bridges are the 4 whitelisted crossings',
  bridges.length === 4 && [...bridgeKeys].every((k) => want.has(k)));
// BFS from node 0 reaches every node (no orphaned road).
{
  const adj = new Map();
  for (const e of city.edges) {
    if (!adj.has(e.a)) adj.set(e.a, []);
    if (!adj.has(e.b)) adj.set(e.b, []);
    adj.get(e.a).push(e.b); adj.get(e.b).push(e.a);
  }
  const seen = new Set([0]);
  const q = [0];
  while (q.length) { for (const m of adj.get(q.pop()) || []) if (!seen.has(m)) { seen.add(m); q.push(m); } }
  check('all 162 nodes reachable from node 0', seen.size === city.nodes.length);
}
// Zebras: one per node, on land, not on a bridge deck.
{
  const spots = zebraSpots(city);
  let onLand = 0, onBridge = 0, missing = 0;
  const edgeOf = new Map();
  for (const e of city.edges) { edgeOf.set(e.a + '|' + e.b, e); edgeOf.set(e.b + '|' + e.a, e); }
  const nodeByIJ = new Map(city.nodes.map((n) => [n.i + ',' + n.j, n]));
  for (const n of city.nodes) {
    const s = spots.get(n.id);
    if (!s) { missing++; continue; }
    const ah = Math.max(ASPHALT_HALF(n.x), ASPHALT_HALF(n.z));
    const cx = s.alongX ? s.x + s.dir * 10 : s.x;
    const cz = s.alongX ? s.z : s.z + s.dir * 10;
    const ends = s.alongX
      ? [[cx, cz - ah + 1.4], [cx, cz + ah - 1.4]]
      : [[cx - ah + 1.4, cz], [cx + ah - 1.4, cz]];
    if ([[cx, cz], ...ends].every(([x, z]) => riverDistance(x, z) > 11)) onLand++;
    const di = s.alongX ? s.dir : 0, dj = s.alongX ? 0 : s.dir;
    const m = nodeByIJ.get((n.i + di) + ',' + (n.j + dj));
    const e = m && edgeOf.get(n.id + '|' + m.id);
    if (e && e.bridge) onBridge++;
  }
  check('one zebra spot per node (no missing)', missing === 0);
  check('every zebra crossing sits on land (rd > 11)', onLand === city.nodes.length);
  check('no zebra on a bridge deck', onBridge === 0);
}
// Vehicles: proportions match the config, sedan reads as a sedan.
{
  const geoms = buildVehicleGeoms();
  const bbox = (g) => {
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < g.pos.length; i += 3) {
      for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], g.pos[i + a]); mx[a] = Math.max(mx[a], g.pos[i + a]); }
    }
    return { len: mx[0] - mn[0], w: mx[2] - mn[2], h: mx[1] - mn[1], y0: mn[1] };
  };
  let ok = true;
  for (const [type, g] of Object.entries(geoms)) {
    const b = bbox(g);
    const tune = VEHICLES[type];
    const tol = type === 'boat' || type === 'fishingboat' || type === 'sailboat' ? 2.6 : 0.6;
    if (!tune || Math.abs(b.len - tune.len) > tol || Math.abs(b.w - tune.w) > 0.6 || b.y0 < -0.01) ok = false;
  }
  check('all 17 vehicle geometries match config proportions', ok);
  check('sedan longer than car', bbox(geoms.sedan).len > bbox(geoms.car).len);
  check('bus longest land vehicle', bbox(geoms.bus).len > bbox(geoms.truck).len && bbox(geoms.bus).len > bbox(geoms.firetruck).len);
  // Round tyre prism: 10 sides -> 120 vertices per wheel.
  let tyreVerts = 0;
  const g = geoms.bajaj;
  for (let i = 0; i < g.col.length; i += 3) if (g.col[i] === 0.1 && g.col[i + 1] === 0.1) tyreVerts++;
  check('bajaj has exactly 3 round wheels', tyreVerts / 120 === 3);
}

// Glass: transparent mesh per type (motorbike + sailboat have no glass).
{
  const glassGeoms = buildVehicleGlassGeoms();
  const withGlass = Object.entries(glassGeoms).filter(([, g]) => g.pos.length > 0).length;
  check('15 of 17 types have transparent glass (motorbike + sailboat have none)', withGlass === 15);
  // Glass never sticks out past the body silhouette.
  const bodies = buildVehicleGeoms();
  const bboxOf = (g) => {
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < g.pos.length; i += 3) {
      for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], g.pos[i + a]); mx[a] = Math.max(mx[a], g.pos[i + a]); }
    }
    return { mn, mx };
  };
  // Glass never sticks out past the body silhouette in plan view (x/z) —
  // a windshield may rise above the body in y (a boat windshield does).
  let inside = true;
  for (const [type, gg] of Object.entries(glassGeoms)) {
    if (!gg.pos.length) continue;
    const b = bboxOf(bodies[type]), gl = bboxOf(gg);
    for (const a of [0, 2]) {
      if (gl.mn[a] < b.mn[a] - 0.1 || gl.mx[a] > b.mx[a] + 0.1) inside = false;
    }
  }
  check('every glass mesh sits inside its body silhouette (plan view)', inside);
}

if (fails) { console.error(fails + ' PHASE F CHECK(S) FAILED'); process.exit(1); }
console.log('ALL PHASE F CHECKS PASSED');
