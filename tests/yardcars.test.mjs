// Yard + kerb cars are stealable (Mu): every yard/kerb decoration car
// is a parked traffic entity (same spawnParked missions use), not static
// decoration. Walk up, press E, drive away — the spot stays empty.
// Measured Phase 1 (24 Nov): 888 spots — 200 block + 166 kerb + 522
// yard. The old "1,132" figure (parked.test.mjs header) was stale: the
// green-lawns pass shrank yard placement, and the true count is 888.
// Run: node tests/yardcars.test.mjs
import { generateCity, riverDistance } from '../game/src/city.js';
import { buildPlotDressing } from '../game/src/plots.js';
import { spawnLotCars, spawnYardCars } from '../game/src/parking.js';
import { createTraffic, buildVehicleBodyGeoms, buildVehicleGlassGeoms, buildWheelGeom } from '../game/src/vehicles.js';
import { VEHICLES } from '../game/src/config.js';

let fails = 0;
function check(name, ok, detail = '') {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? ' — ' + detail : ''));
  if (!ok) fails++;
}

const city = generateCity();
const d = buildPlotDressing(city);
const traffic = createTraffic(city);
const lotSpawned = spawnLotCars(traffic, d.parking.carSpots);
const spawned = spawnYardCars(traffic, d.yardCarSpots);
const spots = d.yardCarSpots;

// --- Counts: 888 spots, placement byte-identical to before. ---
const kinds = {};
for (const s of spots) kinds[s.kind] = (kinds[s.kind] || 0) + 1;
check('yardCarSpots is 888', spots.length === 888, `${spots.length} spots`);
check('kinds are 200 block / 166 kerb / 522 yard',
  kinds.block === 200 && kinds.kerb === 166 && kinds.yard === 522, JSON.stringify(kinds));
check('counts stay byte-identical (cars 200, kerbCars 166, yardCars 522, simpleCars 592)',
  d.counts.cars === 200 && d.counts.kerbCars === 166 && d.counts.yardCars === 522 && d.counts.simpleCars === 592,
  JSON.stringify({ cars: d.counts.cars, kerbCars: d.counts.kerbCars, yardCars: d.counts.yardCars, simpleCars: d.counts.simpleCars }));
check('yard dressing untouched (trees 4802, lawns 388, fountains 24)',
  d.counts.yardTrees === 4802 && d.counts.yardLawns === 388 && d.counts.yardFountains === 24,
  JSON.stringify({ yardTrees: d.counts.yardTrees, yardLawns: d.counts.yardLawns, yardFountains: d.counts.yardFountains }));

// --- Types: car 40% / sedan 30% / mpv 15% / jeep 15% (seeded stream 20261137). ---
const types = {};
for (const s of spots) types[s.type] = (types[s.type] || 0) + 1;
check('only car/sedan/mpv/jeep in the yards', Object.keys(types).every((t) => ['car', 'sedan', 'mpv', 'jeep'].includes(t)), JSON.stringify(types));
check('type mix matches the 40/30/15/15 pick (seeded, deterministic)',
  types.car === 359 && types.sedan === 264 && types.mpv === 132 && types.jeep === 133, JSON.stringify(types));

// --- Static geometry gone: the props mesh lost exactly the car stamps. ---
// Measured Phase 1: props was 1,308,980 tris with the cars baked;
// the stamps were 771,968 tris (200 sculpted x2144 + 166 simple x232 +
// 426 simple x232 + 96 sculpted x2144) — so the mesh must now be 537,012.
const propsTris = d.props.pos.length / 9;
check('props mesh lost exactly the car stamps (1,308,980 -> 537,012 tris)',
  propsTris === 537012, `${propsTris} tris`);

// --- Spots sit in real yards: inside a block, clear of the river. ---
let outside = 0, nearRiver = 0, badBbox = 0, badRot = 0;
for (const s of spots) {
  const inBlock = city.blocks.some((b) => s.x >= b.x0 + 3 && s.x <= b.x1 - 3 && s.z >= b.z0 + 3 && s.z <= b.z1 - 3);
  if (!inBlock) outside++;
  if (riverDistance(s.x, s.z) < 20) nearRiver++;
  const t = VEHICLES[s.type];
  if (!t || t.len > 5 || t.w > 2.5) badBbox++;
  if (!(s.rot >= 0 && s.rot < Math.PI * 2)) badRot++;
}
check('every spot is >=3 m inside a block', outside === 0, `${outside} outside`);
check('every spot is >=20 m from the river', nearRiver === 0, `${nearRiver} near river`);
check('every yard car fits its yard bay (len <= 5, w <= 2.5)', badBbox === 0, 'max len 4.5, max width 1.9');
check('every spot rot is in [0, 2PI)', badRot === 0, `${badRot} bad rot`);

// --- Heading: entity heading = rot + PI/2 (front +X maps to (sin h, cos h)). ---
let badHeading = 0, badKerb = 0;
for (const s of spots) {
  const fwd = [Math.sin(s.heading), Math.cos(s.heading)];
  const stat = [Math.cos(s.rot), -Math.sin(s.rot)];
  if (Math.abs(fwd[0] - stat[0]) > 1e-9 || Math.abs(fwd[1] - stat[1]) > 1e-9) badHeading++;
  if (Math.abs(s.heading - (s.rot + Math.PI / 2)) > 1e-12) badHeading++;
  if (s.kind === 'kerb') {
    // Kerb rows run parallel to the block edge: rot 0 (N/S edges) or
    // PI/2 (E/W edges) — the car axis lies along the edge.
    if (!((s.rot === 0 && s.heading === Math.PI / 2) || (s.rot === Math.PI / 2 && s.heading === Math.PI))) badKerb++;
  }
}
check('heading = rot + PI/2 (car front matches the old static yaw)', badHeading === 0, `${badHeading} misaligned`);
check('kerb cars run parallel to their block edge', badKerb === 0, `${badKerb} wrong way`);

// --- Fleet + ground height + distinct colours. ---
check('fleet is 224 moving / 1496 parked / 9 boats / 1729 total',
  (() => { const c = traffic.counts(); return c.moving === 224 && c.parked === 1496 && c.boats === 9 && c.total === 1729; })(),
  JSON.stringify(traffic.counts()));
check('traffic.parked holds all 1496 parked cars', traffic.parked.length === 1496, `${traffic.parked.length}`);
check('all 888 yard cars sit at y 0.09', spawned.every((v) => v.y === 0.09),
  `${spawned.filter((v) => v.y === 0.09).length} at y 0.09`);
check('all 888 yard cars have distinct colours',
  new Set(spawned.map((v) => v.color.join(','))).size === 888);
check('lot cars still spawn first (584 before the yard cars)',
  lotSpawned.length === 584 && traffic.vehicles.indexOf(lotSpawned[0]) < traffic.vehicles.indexOf(spawned[0]));

// --- Enter / exit flow: E within 5 m, drive away, spot reads empty. ---
const victim = spawned[0];
check('nearest yard car is enterable within 5 m', traffic.nearestEnterable(victim.x, victim.z, 5) === victim);
const before = traffic.counts().parked;
traffic.enter(victim);
check('entering a yard car un-parks it (parked 1496 -> 1495)',
  traffic.counts().parked === before - 1 && victim.parked === false && victim.driven === true,
  `parked=${traffic.counts().parked}`);
check('spot reads empty after theft (no PARKED car at that exact spot)',
  traffic.parked.filter((v) => v.parked).every((v) => v.x !== victim.x || v.z !== victim.z));
check('the stolen car is no longer enterable there', traffic.nearestEnterable(victim.x, victim.z, 5) !== victim);
traffic.exit(victim);
check('exiting re-parks the car (parked back to 1496)',
  traffic.counts().parked === before && victim.parked === true && victim.driven === false,
  `parked=${traffic.counts().parked}`);
const emptyPt = [[900, 900], [900, -900], [-900, 900], [-900, -900], [0, 700], [700, 0]]
  .find(([x, z]) => traffic.vehicles.every((v) => Math.hypot(v.x - x, v.z - z) > 6)
    && traffic.boats.every((b) => Math.hypot(b.x - x, b.z - z) > 6));
check('no car enterable at an empty point', !!emptyPt && traffic.nearestEnterable(emptyPt[0], emptyPt[1], 5) === null,
  emptyPt ? `at (${emptyPt[0]},${emptyPt[1]})` : 'no empty point found');

// --- Worst-case per-view tris (exact, from the recorded spots): ---
// for every spot, count the yard cars within the 160 m render cull and
// sum their near tris (body + glass + 4 full wheels). Phase 1 bound was
// <=128 cars / <=330,319 tris (densest-3-blocks estimate).
{
  const bodies = buildVehicleBodyGeoms();
  const glasses = buildVehicleGlassGeoms();
  const wheel = buildWheelGeom().pos.length / 9;
  const nearTris = (type) => bodies[type].pos.length / 9 + glasses[type].pos.length / 9 + 4 * wheel;
  let maxCount = 0, maxTris = 0;
  for (const a of spots) {
    let n = 0, t = 0;
    for (const b of spots) {
      if (Math.hypot(a.x - b.x, a.z - b.z) <= 160) { n++; t += nearTris(b.type); }
    }
    if (n > maxCount) { maxCount = n; maxTris = t; }
  }
  console.log(`INFO  densest 160 m view: ${maxCount} yard cars, ${Math.round(maxTris)} near tris`);
  check('densest 160 m view holds <=128 yard cars', maxCount <= 128, `${maxCount} cars`);
  check('densest 160 m view adds <=330,319 tris (net saving: 771,968 static tris gone in EVERY view)',
    maxTris <= 330319, `${Math.round(maxTris)} tris`);
}

// --- Perf budget (Node, headless): per-frame lookups stay cheap. ---
{
  const t0 = performance.now();
  for (let i = 0; i < 100; i++) traffic.matricesFor(0, 0, 160);
  const mAvg = (performance.now() - t0) / 100;
  check('matricesFor stays fast with 1729 vehicles (< 5 ms avg)', mAvg < 5, `${mAvg.toFixed(3)} ms`);
  const t1 = performance.now();
  for (let i = 0; i < 100; i++) traffic.nearestEnterable(0, 0, 5);
  const nAvg = (performance.now() - t1) / 100;
  check('nearestEnterable stays fast with 1729 vehicles (< 5 ms avg)', nAvg < 5, `${nAvg.toFixed(3)} ms`);
}

if (fails) { console.error(fails + ' YARD CHECK(S) FAILED'); process.exit(1); }
console.log('ALL YARD CHECKS PASSED');
