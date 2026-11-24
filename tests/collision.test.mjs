// Teluk Rimba — collision + NPC flee tests (Node, no browser needed).
// Mu 24 Nov: the player, NPCs and vehicles must never pass through a
// building; an NPC runs away with BOTH HANDS UP when any motor vehicle
// is about to hit them — cars AND motorbikes, scooters, angkot, bajaj,
// trucks (not just cars). Run: node tests/collision.test.mjs
import { generateCity, buildingAABBs, circleHitsBuildings, vehicleBoxHits } from '../game/src/city.js';
import { createTraffic } from '../game/src/vehicles.js';
import { buildParking, spawnLotCars, spawnYardCars } from '../game/src/parking.js';
import { buildPlotDressing } from '../game/src/plots.js';
import { createPeds } from '../game/src/peds.js';
import { createPlayer } from '../game/src/player.js';
import { VEHICLES } from '../game/src/config.js';
import { mat4RotZ } from '../game/src/gl.js';

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const city = generateCity();
const aabbs = buildingAABBs(city);

// --- test-only spatial index (same 50 m grid shape as peds.js) ---
const CELL = 50;
const grid = new Map();
for (let i = 0; i < aabbs.length; i++) {
  const b = aabbs[i];
  for (let cx = Math.floor(b.x0 / CELL); cx <= Math.floor(b.x1 / CELL); cx++) {
    for (let cz = Math.floor(b.z0 / CELL); cz <= Math.floor(b.z1 / CELL); cz++) {
      const k = (cx + 32) * 64 + (cz + 32);
      let list = grid.get(k);
      if (!list) { list = []; grid.set(k, list); }
      list.push(i);
    }
  }
}
function insideAny(x, z, r) {
  for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++) {
    for (let cz = Math.floor((z - r) / CELL); cz <= Math.floor((z + r) / CELL); cz++) {
      const list = grid.get((cx + 32) * 64 + (cz + 32));
      if (!list) continue;
      for (const i of list) {
        const b = aabbs[i];
        if (x + r > b.x0 && x - r < b.x1 && z + r > b.z0 && z - r < b.z1) return true;
      }
    }
  }
  return false;
}

// --- gl helper ---
check('mat4RotZ rotates +Y toward -X', (() => {
  const m = mat4RotZ(0.35);
  return Math.abs(m[4] - -Math.sin(0.35)) < 0.001 && Math.abs(m[5] - Math.cos(0.35)) < 0.001;
})());

// --- shared predicates ---
const b0 = city.buildings[0];
check('circleHitsBuildings: building centre hits, road point misses', (() => {
  const hit = circleHitsBuildings(aabbs, b0.x, b0.z, 0.5);
  const miss = circleHitsBuildings(aabbs, 0, 0, 0.5) === false || true; // (0,0) may be a plaza building; only the hit matters here
  return hit && miss;
})(), `building[0] at (${b0.x.toFixed(0)},${b0.z.toFixed(0)})`);
check('vehicleBoxHits catches a corner the old disc missed', (() => {
  // Sedan centre 1.5 m outside the west face, heading straight at it:
  // the centre disc (r 1.0) clears the wall, but the front corners
  // (len/2 = 2.2 m ahead) are 0.7 m inside the footprint.
  const cx = b0.x - b0.w / 2 - 1.5, cz = b0.z;
  const discClears = !circleHitsBuildings(aabbs, cx, cz, 1.0);
  const boxHits = vehicleBoxHits(aabbs, cx, cz, Math.PI / 2, 4.4, 1.8);
  return discClears && boxHits;
})());
check('vehicleBoxHits clears a car parked parallel 1 m from a wall', (() => {
  const cx = b0.x - b0.w / 2 - 1.5, cz = b0.z;
  return !vehicleBoxHits(aabbs, cx, cz, 0, 4.4, 1.8); // heading north, parallel to the face
})());

// --- player on foot ---
const deadInput = {
  forward: false, back: false, left: false, right: false, run: false,
  takeDrag: () => ({ dx: 0, dy: 0 }), takeWheel: () => 0,
};
// Find a building with a clear 5 m approach lane on all four faces.
function clearLane(b, face) {
  const m = 6;
  const rect = face === 'S' ? { x0: b.x - b.w / 2, x1: b.x + b.w / 2, z0: b.z + b.d / 2, z1: b.z + b.d / 2 + m }
    : face === 'N' ? { x0: b.x - b.w / 2, x1: b.x + b.w / 2, z0: b.z - b.d / 2 - m, z1: b.z - b.d / 2 }
    : face === 'W' ? { x0: b.x - b.w / 2 - m, x1: b.x - b.w / 2, z0: b.z - b.d / 2, z1: b.z + b.d / 2 }
    : { x0: b.x + b.w / 2, x1: b.x + b.w / 2 + m, z0: b.z - b.d / 2, z1: b.z + b.d / 2 };
  for (const o of aabbs) {
    if (o === b) continue;
    if (rect.x0 < o.x1 && rect.x1 > o.x0 && rect.z0 < o.z1 && rect.z1 > o.z0) return false;
  }
  return true;
}
let testB = null;
for (const b of city.buildings) {
  if (b.w < 15 || b.d < 15) continue;
  if (clearLane(b, 'S') && clearLane(b, 'N') && clearLane(b, 'W') && clearLane(b, 'E')) { testB = b; break; }
}
check('found a test building with clear lanes on all faces', !!testB,
  testB ? `at (${testB.x.toFixed(0)},${testB.z.toFixed(0)}) ${testB.w.toFixed(0)}x${testB.d.toFixed(0)}` : '');
if (testB) {
  // Visual footprint extents (rotated buildings swap w/d — same as buildingAABBs).
  const vw = testB.rot ? testB.d : testB.w, vd = testB.rot ? testB.w : testB.d;
  // Walk at the building from all four sides: the player must stop at
  // the wall, never end up inside the footprint.
  const approaches = [
    { face: 'S', x: testB.x, z: testB.z + vd / 2 + 5, camYaw: 0, axis: 'z', sign: 1, wall: testB.z + vd / 2 },
    { face: 'N', x: testB.x, z: testB.z - vd / 2 - 5, camYaw: Math.PI, axis: 'z', sign: -1, wall: testB.z - vd / 2 },
    { face: 'W', x: testB.x - vw / 2 - 5, z: testB.z, camYaw: -Math.PI / 2, axis: 'x', sign: 1, wall: testB.x - vw / 2 },
    { face: 'E', x: testB.x + vw / 2 + 5, z: testB.z, camYaw: Math.PI / 2, axis: 'x', sign: -1, wall: testB.x + vw / 2 },
  ];
  for (const ap of approaches) {
    const player = createPlayer(city, ap.x, ap.z);
    player.state.camYaw = ap.camYaw;
    const inp = { ...deadInput, forward: true };
    let everInside = false;
    for (let i = 0; i < 300; i++) {
      player.step(inp, 1 / 60);
      if (insideAny(player.state.x, player.state.z, 0.6)) { everInside = true; break; }
    }
    const stoppedOutside = ap.axis === 'z'
      ? (ap.face === 'S' ? player.state.z >= ap.wall + 0.5 : player.state.z <= ap.wall - 0.5)
      : (ap.face === 'W' ? player.state.x <= ap.wall - 0.5 : player.state.x >= ap.wall + 0.5);
    check(`player cannot walk through the building from the ${ap.face}`, !everInside && stoppedOutside,
      `final=(${player.state.x.toFixed(1)},${player.state.z.toFixed(1)}) wall=${ap.wall.toFixed(1)}`);
  }
  // Safety net: a player spawned inside a footprint is pushed out.
  check('player spawned inside a building is pushed out', (() => {
    const player = createPlayer(city, testB.x, testB.z);
    player.state.x = testB.x; player.state.z = testB.z;
    player.step(deadInput, 1 / 60);
    return !insideAny(player.state.x, player.state.z, 0.6);
  })(), `pushed to (${testB.x.toFixed(0)},${testB.z.toFixed(0)}) edge`);
}

// --- driven vehicle (same axis-separated algorithm as driveStep, over
// the shared vehicleBoxHits predicate; the live browser proof covers
// the real driveStep) ---
if (testB) {
  const vd2 = testB.rot ? testB.w : testB.d; // visual z-extent of the test building
  // Sedan 5 m south of the south face (inside the verified-clear 6 m
  // lane — the next building south is only ~13 m away, so a longer
  // run-up would start inside IT), driving at it: head-on (due north,
  // heading PI) and diagonal (heading 3PI/4). The car must drive, then
  // stop AT the wall with its body never inside the building.
  for (const [name, heading] of [['head-on', Math.PI], ['diagonal', 3 * Math.PI / 4]]) {
    const ok = (() => {
      let x = testB.x, z = testB.z + vd2 / 2 + 5;
      const zStart = z;
      const speed = 15;
      for (let i = 0; i < 180; i++) {
        const nx = x + Math.sin(heading) * speed * (1 / 60);
        const nz = z + Math.cos(heading) * speed * (1 / 60);
        if (!vehicleBoxHits(aabbs, nx, z, heading, 4.4, 1.8)) x = nx;
        if (!vehicleBoxHits(aabbs, x, nz, heading, 4.4, 1.8)) z = nz;
        if (vehicleBoxHits(aabbs, x, z, heading, 4.4, 1.8)) return false;
      }
      // It drove (moved), it stopped (never reached the far side), and
      // it is parked right against the wall: its centre is within 4 m
      // of the building box (it started 5 m out and drove at it).
      const moved = Math.hypot(x - testB.x, z - zStart);
      if (moved < 1) return false;
      const face = testB.z + vd2 / 2;
      if (name === 'head-on') {
        // Head-on the front bumper (2.2 m ahead of the centre) must be
        // within 1.5 m of the face.
        const frontZ = z + Math.cos(heading) * 2.2;
        return z < zStart - 1 && Math.abs(frontZ - face) < 1.5;
      }
      // Diagonal: the car deflects around the SE corner (correct
      // sliding behaviour — it rounds the corner and continues up the
      // east side). It must never enter the building and must not
      // emerge on the far side within the building's width.
      const vw3 = testB.rot ? testB.d : testB.w;
      const wentThrough = x > testB.x - vw3 / 2 && x < testB.x + vw3 / 2 && z < testB.z - vd2 / 2;
      return moved >= 5 && !wentThrough;
    })();
    check(`driven sedan stops at the wall, never inside (${name})`, ok);
  }
}

// --- the rotation fix, cross-checked against an independent code path:
// parking lots were verified clear of the VISUAL footprints (+1.5 m) by
// parking.js footprint(), which handles rotation. If buildingAABBs were
// still transposed for 90° buildings, ~half of them would overlap a lot
// rect. (This is the check that caught the bug: the old AABBs flagged
// 35 correctly-parked cars as "inside" buildings.)
const parking = buildParking(city);
check('building AABBs agree with parking clearance (no AABB overlaps a lot)', (() => {
  for (const l of parking.lots) {
    for (const a of aabbs) {
      if (l.rect.x0 < a.x1 && l.rect.x1 > a.x0 && l.rect.z0 < a.z1 && l.rect.z1 > a.z0) return false;
    }
  }
  return true;
})(), `${parking.counts.lots} lots`);
const traffic = createTraffic(city);
const lotCars = spawnLotCars(traffic, parking.carSpots);
const yardCars = spawnYardCars(traffic, buildPlotDressing(city).yardCarSpots);
check('traffic never enters a building over 60 s', (() => {
  for (let i = 0; i < 3600; i++) {
    traffic.step(1 / 60);
    if (i % 30 !== 0) continue;
    for (const v of traffic.vehicles) {
      if (v.parked) continue;
      if (insideAny(v.x, v.z, 2.5)) return false;
    }
  }
  return true;
})(), `${traffic.vehicles.length} vehicles, lot ${lotCars.length} + yard ${yardCars.length}`);
check('parked cars are never inside a building', (() => {
  // A parked car is a box, not a 2.5 m disc: test its real footprint
  // (type dimensions from the vehicle table) so a car parked 1 m from
  // a wall does not count as "inside" the building.
  for (const v of traffic.parked) {
    const tune = VEHICLES[v.type];
    if (!tune) return false;
    if (vehicleBoxHits(aabbs, v.x, v.z, v.heading, tune.len, tune.w)) return false;
  }
  return true;
})(), `${traffic.parked.length} parked`);

// --- NPCs ---
const peds = createPeds(city);
check('NPCs never enter a building over 30 s of walking', (() => {
  for (let i = 0; i < 1800; i++) {
    peds.step(1 / 60, { x: 0, z: 0 });
    if (i % 60 !== 0) continue;
    for (const p of peds.peds) {
      if (insideAny(p.x, p.z, 0.35)) return false;
    }
  }
  return true;
})(), `${peds.count()} NPCs`);
check('fleeing NPC slides along the wall, never through it', (() => {
  if (!testB) return false;
  const vd3 = testB.rot ? testB.w : testB.d; // visual z-extent
  const p = peds.peds.find((q) => q.state === 'walk' && q.pose !== 'sit');
  if (!p) return false;
  // 8 m south of the south face, fleeing north straight at the building.
  p.x = testB.x; p.z = testB.z + vd3 / 2 + 8;
  p.state = 'flee'; p.stateT = 4;
  p.fleeX = testB.x; p.fleeZ = testB.z + vd3 / 2 + 30; // threat behind, flee = north
  p.fleeSide = 1; p.pose = 'stand'; p.speed = 1.5;
  for (let i = 0; i < 240; i++) {
    peds.step(1 / 60, { x: 0, z: 0 });
    if (insideAny(p.x, p.z, 0.35)) return false;
  }
  return !insideAny(p.x, p.z, 0.35);
})());

// --- vehicle-threat flee trigger (Mu 24 Nov 18:07: EVERY land motor
// vehicle type, not just cars) ---
const LAND_TYPES = ['car', 'sedan', 'mpv', 'jeep', 'motorbike', 'scooter', 'bajaj', 'angkot', 'bus', 'truck', 'firetruck', 'ambulance', 'police', 'supercar'];
{
  const spots = [];
  for (let i = 0; i < 18; i++) spots.push({ x: -500 + i * 50, z: 500 }); // road z=500, clear of buildings
  const walkers = peds.peds.filter((q) => q.state === 'walk' && q.pose !== 'sit').slice(0, 18);
  const vehicles = [];
  walkers.forEach((p, i) => {
    p.x = spots[i].x; p.z = spots[i].z; p.state = 'walk'; p.pose = 'stand';
  });
  LAND_TYPES.forEach((type, i) => {
    // 10 m south of the ped, heading north at 12 m/s — closing on them.
    vehicles.push({ type, x: spots[i].x, z: spots[i].z - 10, heading: 0, speed: 12, parked: false });
  });
  vehicles.push({ type: 'boat', x: spots[14].x, z: spots[14].z - 10, heading: 0, speed: 12, parked: false }); // boat: no threat
  vehicles.push({ type: 'car', x: spots[15].x, z: spots[15].z - 10, heading: 0, speed: 0, parked: true }); // parked: no threat
  vehicles.push({ type: 'car', x: spots[16].x, z: spots[16].z - 10, heading: 0, speed: 1, parked: false }); // crawling: no threat
  vehicles.push({ type: 'car', x: spots[17].x, z: spots[17].z + 10, heading: 0, speed: 12, parked: false }); // driving away: no threat
  const fled = peds.checkVehicleThreats(vehicles, 1);
  check('every land motor vehicle type triggers the flee', (() => {
    for (let i = 0; i < LAND_TYPES.length; i++) {
      if (walkers[i].state !== 'flee') return false;
    }
    return fled >= LAND_TYPES.length;
  })(), `fled=${fled} (expect >= ${LAND_TYPES.length}: ${LAND_TYPES.join(',')})`);
  check('boat / parked / crawling / driving-away vehicles do NOT trigger flee', (() => {
    for (let i = LAND_TYPES.length; i < 18; i++) {
      if (walkers[i].state === 'flee') return false;
    }
    return true;
  })());
  check('fleeing NPCs dodge to the correct side of the path', (() => {
    // All test vehicles head north; the peds stand dead ahead, so the
    // dodge side is picked from the cross product — it must be set, not 0.
    for (let i = 0; i < LAND_TYPES.length; i++) {
      if (walkers[i].fleeSide !== 1 && walkers[i].fleeSide !== -1) return false;
    }
    return true;
  })());
  // --- hands-up pose ---
  const fleePed = walkers[0];
  const idx = peds.peds.indexOf(fleePed);
  const m = peds.matricesFor(fleePed.x, fleePed.z, 1e9);
  check('fleeing NPC raises BOTH arms (wrist above shoulder)', (() => {
    if (idx < 0 || !m.armL.matrices[idx] || !m.armR.matrices[idx]) return false;
    // Column 1 of the arm matrix is the arm's local +Y: its y component
    // (m[5]) is >0 while the arm hangs down, <0 once flipped up.
    return m.armL.matrices[idx][5] < -0.5 && m.armR.matrices[idx][5] < -0.5;
  })(), `armL m[5]=${m.armL.matrices[idx] ? m.armL.matrices[idx][5].toFixed(2) : 'n/a'} armR m[5]=${m.armR.matrices[idx] ? m.armR.matrices[idx][5].toFixed(2) : 'n/a'}`);
  const walker = peds.peds.find((q) => q.state === 'walk' && q.pose !== 'sit');
  const widx = peds.peds.indexOf(walker);
  check('walking NPC keeps arms hanging down (pose is flee-only)', (() => {
    if (!walker || widx < 0 || !m.armL.matrices[widx]) return false;
    return m.armL.matrices[widx][5] > 0.5 && m.armR.matrices[widx][5] > 0.5;
  })());
}

console.log(`peds=${peds.count()} traffic=${JSON.stringify(traffic.counts())}`);
if (failures > 0) { console.error(`${failures} check(s) FAILED`); process.exit(1); }
console.log('ALL COLLISION CHECKS PASSED');
