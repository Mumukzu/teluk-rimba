// Phase F checks: no dead-end roads, exactly 4 bridges, one zebra per
// intersection on land, realistic vehicle geometry proportions.
import { generateCity, riverDistance, ASPHALT_HALF } from '../game/src/city.js';
import { zebraSpots } from '../game/src/roads.js';
import { buildVehicleGeoms, buildVehicleGlassGeoms } from '../game/src/vehicles.js';
import { VEHICLES } from '../game/src/config.js';
import { buildingClass, BUILDING_CLASSES, buildBuildingMeshes, buildEntranceKitGeom, buildShopfrontGeom, buildBalconyGeom, buildRoofUnitGeom } from '../game/src/buildings.js';
import { subdividedBox } from '../game/src/gl.js';

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

// Job B: realistic buildings — height classes, windows on all faces,
// zone roof colours, entrance/shopfront kits, balconies, roof clutter.
{
  const counts = { short: 0, mid: 0, tall: 0, skyscraper: 0 };
  for (const b of city.buildings) counts[buildingClass(b.h)]++;
  check('building classes: 616 short / 310 mid / 64 tall / 10 skyscraper', counts.short === 616 && counts.mid === 310 && counts.tall === 64 && counts.skyscraper === 10);
  // Window cells stay small: max cell height/width per class.
  const maxH = { short: 0, mid: 0, tall: 0, skyscraper: 0 }, maxW = { short: 0, mid: 0, tall: 0, skyscraper: 0 };
  for (const b of city.buildings) {
    const c = buildingClass(b.h);
    maxH[c] = Math.max(maxH[c], b.h); maxW[c] = Math.max(maxW[c], b.w, b.d);
  }
  let cellsOk = true;
  for (const [name, cfg] of Object.entries(BUILDING_CLASSES)) {
    if (maxH[name] / cfg.segRows > 8.5 || maxW[name] / cfg.segFront > 5.5) cellsOk = false;
  }
  check('window cells bounded (max 8.5 m tall, 5.5 m wide)', cellsOk);
  // Windows on all four faces: glass-coloured vertices with ±x and ±z normals.
  const base = subdividedBox(1, 1, 1, 8, 12, 6);
  const glassCols = new Set(['0.3,0.34,0.42', '0.7,0.8,0.95', '0.95,0.8,0.5']);
  const dirs = new Set();
  for (let i = 0; i < base.col.length; i += 3) {
    const key = base.col[i] + ',' + base.col[i + 1] + ',' + base.col[i + 2];
    if (!glassCols.has(key)) continue;
    if (base.nrm[i] === 1) dirs.add('+x');
    if (base.nrm[i] === -1) dirs.add('-x');
    if (base.nrm[i + 2] === 1) dirs.add('+z');
    if (base.nrm[i + 2] === -1) dirs.add('-z');
  }
  check('windows on all four faces', dirs.size === 4);
  // Detail meshes (buildBuildingMeshes is pure geometry — no GL calls —
  // so it runs in Node with a stubbed progs object).
  const meshes = buildBuildingMeshes(null, { litInst: 'LIT' }, city);
  // Mu 23 Nov 21:19 — CBD towers ride the glass curtain-wall bases
  // (21 towers: 11 tall + 10 skyscraper); the other 979 keep the plain
  // wall + window bases. Together they still cover all 1000 buildings.
  check('4 plain + 2 glass base geometries cover all 1000 buildings',
    meshes.bases.reduce((a, s) => a + s.matrices.length, 0)
    + meshes.glassBases.reduce((a, s) => a + s.matrices.length, 0) === 1000
    && meshes.glassBases.reduce((a, s) => a + s.matrices.length, 0) === 21);
  // Curtain-wall glass is ocean blue on every cell (not the pastel wall
  // colours): the geometry carries deep-ocean / bright-ocean / warm glass.
  {
    const curtain = subdividedBox(1, 1, 1, 8, 12, 6, true);
    const glassCols = new Set(['0.1,0.3,0.55', '0.55,0.8,1', '1,0.95,0.75']);
    let glassVerts = 0, mullionVerts = 0;
    for (let i = 0; i < curtain.col.length; i += 3) {
      const key = curtain.col[i] + ',' + curtain.col[i + 1] + ',' + curtain.col[i + 2];
      if (glassCols.has(key)) { glassVerts++; continue; }
      const [r, g, b] = [curtain.col[i], curtain.col[i + 1], curtain.col[i + 2]];
      // Dark navy mullion: blue-dominant, all channels in the dark band.
      if (b > r && r >= 0.15 && r <= 0.25 && g >= 0.18 && g <= 0.28 && b >= 0.24 && b <= 0.34) mullionVerts++;
    }
    check('curtain-wall geometry: ocean-blue glass on every cell + dark navy mullions',
      glassVerts > 0 && mullionVerts > 0, glassVerts + ' glass verts, ' + mullionVerts + ' mullion verts');
  }
  // Mu 23 Nov 21:21 — NON-CBD: exactly ONE wall colour per zone
  // (landmarks keep their own identifying colour, so they are excluded).
  {
    const want = {
      commercial: '0.96,0.88,0.72', residential: '0.97,0.97,0.96',
      beach: '0.97,0.93,0.82', port: '0.55,0.63,0.73', forest: '0.62,0.45,0.28',
    };
    let uniformOk = true;
    for (const [zone, col] of Object.entries(want)) {
      const cols = new Set(city.buildings.filter((b) => b.zone === zone && !b.landmark).map((b) => b.color.join(',')));
      if (cols.size !== 1 || !cols.has(col)) uniformOk = false;
    }
    check('non-CBD zones: one uniform wall colour each (cream / white / sand-white / blue-grey / wood-brown)', uniformOk);
    const downtownCols = new Set(city.buildings.filter((b) => b.zone === 'downtown').map((b) => b.color.join(',')));
    // Every downtown tint is ocean blue (blue channel dominant) — the
    // only exception is the white hospital landmark.
    check('downtown stays ocean blue (no pastel / warm colours left)',
      [...downtownCols].every((c) => {
        if (c === '0.95,0.95,0.95') return true; // hospital landmark
        const [r, g, bl] = c.split(',').map(Number);
        return bl > r && bl >= g;
      }));
  }
  const distinctRoofTints = new Set(meshes.roofs.tints.map((t) => t.join(','))).size;
  check('roof tints vary by zone (not one grey)', distinctRoofTints > 10);
  check('plinth + cornice on every building', meshes.plinth.matrices.length === 1000 && meshes.cornice.matrices.length === 1000);
  check('entrance kit or shopfront on every building', meshes.entrance.matrices.length + meshes.shopfront.matrices.length === 1000);
  check('balconies placed (multi-storey fronts)', meshes.balconies.matrices.length > 500);
  check('roof units on some but not all buildings', meshes.roofUnits.matrices.length > 100 && meshes.roofUnits.matrices.length < 1000);
  const tris = (g) => g.pos.length / 9;
  // Shopfront is 36 tris since Phase I: its canopy moved out to the
  // shared soft-pastel awning instanced mesh (shopsigns.js) that covers
  // every building; the entrance kit keeps 48 (canopy replaced by a
  // sign band of the same tri count).
  check('detail geometries are lean (entrance 48, shopfront 36, balcony 24, roof units 36 tris)',
    tris(buildEntranceKitGeom()) === 48 && tris(buildShopfrontGeom()) === 36 && tris(buildBalconyGeom()) === 24 && tris(buildRoofUnitGeom()) === 36);
}

if (fails) { console.error(fails + ' PHASE F CHECK(S) FAILED'); process.exit(1); }
console.log('ALL PHASE F CHECKS PASSED');
