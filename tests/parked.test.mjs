// Parked-lot cars are stealable (Mu): every parking-lot car is a parked
// traffic entity (same spawnParked missions use), not static decoration.
// Walk up, press E, drive away — the bay stays empty. Yard + kerb cars
// (888) are stealable too — see tests/yardcars.test.mjs. The 24
// hand-placed parked cars are untouched.
// Run: node tests/parked.test.mjs
import { generateCity } from '../game/src/city.js';
import { buildParking, spawnLotCars } from '../game/src/parking.js';
import { createTraffic } from '../game/src/vehicles.js';
import { VEHICLES } from '../game/src/config.js';

let fails = 0;
function check(name, ok, detail = '') {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? ' — ' + detail : ''));
  if (!ok) fails++;
}

const city = generateCity();
const p = buildParking(city);
const traffic = createTraffic(city);
const spawned = spawnLotCars(traffic, p.carSpots);

// --- Counts: lots byte-identical, static geometry gone, fleet grown. ---
check('carSpots is 584', p.carSpots.length === 584, `${p.carSpots.length} spots`);
check('counts.cars is still 584 (byte-identical lots)', p.counts.cars === 584, `${p.counts.cars} cars`);
check('counts.bays is still 2136', p.counts.bays === 2136, `${p.counts.bays} bays`);
check('counts.lots is still 83', p.counts.lots === 83, `${p.counts.lots} lots`);
check('static car geom is empty', p.cars.pos.length === 0, `${p.cars.pos.length} verts`);
check('fleet is 224 moving / 608 parked / 9 boats / 841 total',
  (() => { const c = traffic.counts(); return c.moving === 224 && c.parked === 608 && c.boats === 9 && c.total === 841; })(),
  JSON.stringify(traffic.counts()));
check('traffic.parked holds all 608 parked cars', traffic.parked.length === 608, `${traffic.parked.length}`);

// --- Types: car 40% / sedan 30% / mpv 15% / jeep 15% (seeded stream). ---
const types = {};
for (const s of p.carSpots) types[s.type] = (types[s.type] || 0) + 1;
check('only car/sedan/mpv/jeep in the lots', Object.keys(types).every((t) => ['car', 'sedan', 'mpv', 'jeep'].includes(t)), JSON.stringify(types));
check('type mix matches the 40/30/15/15 pick (seeded, deterministic)',
  types.car === 248 && types.sedan === 170 && types.mpv === 86 && types.jeep === 80, JSON.stringify(types));

// --- Spots sit on real bays: centre is a bay centre, inside its lot. ---
const lotOf = (s) => p.lots.find((l) => s.x >= l.rect.x0 && s.x <= l.rect.x1 && s.z >= l.rect.z0 && s.z <= l.rect.z1);
const toLocal = (lot, x, z) => {
  const dx = x - lot.cx, dz = z - lot.cz;
  const c = Math.cos(lot.R), s = Math.sin(lot.R);
  return [dx * c - dz * s, dx * s + dz * c]; // inverse of parking.js toWorld
};
let outside = 0, offBay = 0, onDisabled = 0, badBbox = 0;
for (const s of p.carSpots) {
  const lot = lotOf(s);
  if (!lot) { outside++; continue; }
  const [u, v] = toLocal(lot, s.x, s.z);
  const bu = -lot.width / 2 + s.k * 2.5 + 1.25;
  const bv = s.row === 'A' ? -lot.depth / 2 + 2.5 : lot.depth / 2 - 2.5;
  if (Math.abs(u - bu) > 0.01 || Math.abs(v - bv) > 0.01) offBay++;
  if (s.row === 'A' && s.k === 0) onDisabled++;
  const t = VEHICLES[s.type];
  if (t.len > 5 || t.w > 2.5) badBbox++;
}
check('every spot is inside a lot rect', outside === 0, `${outside} outside`);
check('every spot sits on its bay centre', offBay === 0, `${offBay} off-bay`);
check('no spot on a disabled bay (row A, k 0)', onDisabled === 0, `${onDisabled} on disabled`);
check('every lot car fits its 2.5x5 m bay', badBbox === 0, 'max len 4.5, max width 1.9');

// --- Heading: the car's long axis lies along the bay depth. ---
// Entity heading = PI/2 + wRot (vehicleMatrix maps front +X to
// (sin h, cos h)); row A nose-in faces -v, row B faces +v.
let badHeading = 0, badRowDir = 0;
for (const s of p.carSpots) {
  const lot = lotOf(s);
  if (!lot) { badHeading++; badRowDir++; continue; }
  const vDir = [Math.sin(lot.R), Math.cos(lot.R)];
  const fwd = [Math.sin(s.heading), Math.cos(s.heading)];
  const dot = fwd[0] * vDir[0] + fwd[1] * vDir[1];
  if (Math.abs(dot) < 0.999) badHeading++;
  if (s.row === 'A' ? dot > -0.999 : dot < 0.999) badRowDir++;
}
check('heading = PI/2 + wRot (car axis along bay depth)', badHeading === 0, `${badHeading} misaligned`);
check('row A cars face -v, row B cars face +v', badRowDir === 0, `${badRowDir} wrong way`);

// --- Ground height: stadium forecourt cars ride on the apron. ---
const stadSpots = p.carSpots.filter((s) => s.yBase === 0.15);
check('stadium forecourt spots carry yBase 0.15', stadSpots.length === 24, `${stadSpots.length} spots`);
check('spawned stadium cars sit at y 0.24', spawned.filter((v) => v.y === 0.24).length === stadSpots.length,
  `${spawned.filter((v) => v.y === 0.24).length} at y 0.24`);
check('all other lot cars sit at y 0.09', spawned.filter((v) => v.y === 0.09).length === spawned.length - stadSpots.length);

// --- Distinct colours: no two lot cars alike (Mu). ---
check('all 584 lot cars have distinct colours',
  new Set(spawned.map((v) => v.color.join(','))).size === 584);

// --- Enter / exit flow: E within 5 m, drive away, bay reads empty. ---
const victim = spawned[0];
check('nearest lot car is enterable within 5 m', traffic.nearestEnterable(victim.x, victim.z, 5) === victim);
const before = traffic.counts().parked;
traffic.enter(victim);
check('entering a lot car un-parks it (parked 608 -> 607)',
  traffic.counts().parked === before - 1 && victim.parked === false && victim.driven === true,
  `parked=${traffic.counts().parked}`);
check('bay reads empty after theft (no PARKED car at that exact spot)',
  // traffic.parked is the registry of park-spot vehicles: enter() flips
  // the flag but leaves the object in the array (existing behaviour,
  // same for the 24 hand-placed cars) — so filter on the live flag.
  traffic.parked.filter((v) => v.parked).every((v) => v.x !== victim.x || v.z !== victim.z));
check('the stolen car is no longer enterable there', traffic.nearestEnterable(victim.x, victim.z, 5) !== victim);
traffic.exit(victim);
check('exiting re-parks the car (parked back to 608)',
  traffic.counts().parked === before && victim.parked === true && victim.driven === false,
  `parked=${traffic.counts().parked}`);
// A point with no vehicle nearby has nothing enterable.
const emptyPt = [[900, 900], [900, -900], [-900, 900], [-900, -900], [0, 700], [700, 0]]
  .find(([x, z]) => traffic.vehicles.every((v) => Math.hypot(v.x - x, v.z - z) > 6)
    && traffic.boats.every((b) => Math.hypot(b.x - x, b.z - z) > 6));
check('no car enterable at an empty point', !!emptyPt && traffic.nearestEnterable(emptyPt[0], emptyPt[1], 5) === null,
  emptyPt ? `at (${emptyPt[0]},${emptyPt[1]})` : 'no empty point found');

// --- Perf budget (Node, headless): per-frame lookups stay cheap. ---
{
  const t0 = performance.now();
  for (let i = 0; i < 100; i++) traffic.matricesFor(0, 0, 400);
  const mAvg = (performance.now() - t0) / 100;
  check('matricesFor stays fast with 841 vehicles (< 5 ms avg)', mAvg < 5, `${mAvg.toFixed(3)} ms`);
  const t1 = performance.now();
  for (let i = 0; i < 100; i++) traffic.nearestEnterable(0, 0, 5);
  const nAvg = (performance.now() - t1) / 100;
  check('nearestEnterable stays fast with 841 vehicles (< 5 ms avg)', nAvg < 5, `${nAvg.toFixed(3)} ms`);
}

if (fails) { console.error(fails + ' PARKED CHECK(S) FAILED'); process.exit(1); }
console.log('ALL PARKED CHECKS PASSED');
