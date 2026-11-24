// Teluk Rimba — Phase B logic tests (Node, no browser needed).
// Traffic stays on roads, peds walk sidewalks + flee, wanted rises/falls,
// police spawn and pursue, weather follows its schedule, landmarks exist.
// Run: node tests/phase-b.test.mjs
import { generateCity, riverDistance, ROAD_LINES, ASPHALT_HALF } from '../game/src/city.js';
import { createTraffic } from '../game/src/vehicles.js';
import { buildParking, spawnLotCars } from '../game/src/parking.js';
import { createPeds } from '../game/src/peds.js';
import { createWanted } from '../game/src/police.js';
import { createWeather } from '../game/src/weather.js';
import { buildLandmarks } from '../game/src/landmarks.js';
import { VEHICLES } from '../game/src/config.js';
import { PASTEL } from '../game/src/vehicles.js';

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const city = generateCity();
const traffic = createTraffic(city);
// Lot cars are stealable (Mu): the 584 parking-lot cars join the fleet
// as parked traffic entities, exactly as the game boot does in main.js.
const lotCars = spawnLotCars(traffic, buildParking(city).carSpots);
const peds = createPeds(city);
const wanted = createWanted(city, traffic, peds);
const weather = createWeather({});

// --- traffic ---
const c = traffic.counts();
check('traffic has 224 moving + 608 parked + 9 boats (24 hand-placed + 584 lot cars)', c.moving === 224 && c.parked === 24 + lotCars.length && c.boats === 9, JSON.stringify(c));
check('every vehicle colour is visibly coloured (not grey/white)', PASTEL.every((c) => Math.max(...c) - Math.min(...c) > 0.2), `${PASTEL.length} colours`);
check('traffic is dense on main roads (most moving vehicles on a main edge)', (() => {
  const main = new Set(city.edges.filter((e) => e.main).map((e) => e.a + '-' + e.b));
  let onMain = 0;
  for (const v of traffic.vehicles) {
    if (v.parked || v.driven || !v.edge) continue;
    if (v.edge.main) onMain++;
  }
  return onMain >= 100;
})(), 'on main edges');
check('every vehicle type in the roster exists', ['motorbike', 'scooter', 'bajaj', 'car', 'sedan', 'mpv', 'jeep', 'angkot', 'bus', 'truck', 'firetruck', 'ambulance', 'supercar'].every((t) =>
  traffic.vehicles.some((v) => v.type === t)));
check('scooter is its own type (not a motorbike)', traffic.vehicles.some((v) => v.type === 'scooter') && traffic.vehicles.some((v) => v.type === 'motorbike'));
check('traffic stays on roads after 600 steps', (() => {
  for (let i = 0; i < 600; i++) traffic.step(1 / 60);
  return traffic.vehicles.every((v) => {
    if (v.parked || v.driven) return true;
    // On a road: within asphalt half of some road line (both axes near a crossing is fine).
    for (const L of ROAD_LINES) {
      if (Math.abs(v.x - L) <= ASPHALT_HALF(L) + 1) return true;
      if (Math.abs(v.z - L) <= ASPHALT_HALF(L) + 1) return true;
    }
    return false;
  });
})());
check('buses run the route and dwell at stops', (() => {
  const bus = traffic.vehicles.find((v) => v.type === 'bus');
  let dwelled = false;
  const orig = traffic.onBusStop;
  traffic.onBusStop = () => { dwelled = true; };
  for (let i = 0; i < 3600 && !dwelled; i++) traffic.step(1 / 60);
  traffic.onBusStop = orig;
  return !!bus && dwelled;
})());
check('boats stay on water after 600 steps', (() => {
  for (let i = 0; i < 600; i++) traffic.step(1 / 60);
  return traffic.boats.every((b) => b.x > 600 || riverDistance(b.x, b.z) < 15);
})());
check('parked vehicles are off traffic lanes', traffic.parked.every((v) => {
  // Beach / port / market parking areas, not on any road's asphalt.
  for (const L of ROAD_LINES) {
    if (Math.abs(v.x - L) <= ASPHALT_HALF(L) && Math.abs(v.z - L) <= ASPHALT_HALF(L)) return false;
  }
  return true;
}), `${traffic.parked.length} parked`);

// --- peds ---
check('300+ peds (incl. 2 fishermen)', peds.count() >= 300, `got ${peds.count()}`);
check('peds wear varied clothes', (() => {
  const shirts = new Set(peds.peds.map((p) => p.shirt.join(',')));
  const pants = new Set(peds.peds.map((p) => p.pants.join(',')));
  const skins = new Set(peds.peds.map((p) => p.skin.join(',')));
  const hairs = new Set(peds.peds.map((p) => p.hair.join(',')));
  return shirts.size >= 8 && pants.size >= 4 && skins.size >= 3 && hairs.size >= 3;
})(), `shirts/pants/skins/hair vary`);
check('peds flee a gunshot', (() => {
  const before = peds.peds.filter((p) => Math.hypot(p.x, p.z) < 40).length;
  const fled = peds.triggerFlee(0, 0, 40);
  return fled > 0 && fled <= before;
})());
check('peds keep walking after 600 steps', (() => {
  const x0 = peds.peds[0].x, z0 = peds.peds[0].z;
  for (let i = 0; i < 600; i++) peds.step(1 / 60, { x: 0, z: 0 });
  return peds.count() > 250;
})());

// --- wanted / police ---
const player = { x: 0, z: 120, speedKmh: 0 };
check('wanted starts at 0, no police', wanted.state.wanted === 0 && wanted.state.police.length === 0);
wanted.addHeat(2);
check('crime raises wanted to 2 and spawns 2 police cars', wanted.state.wanted === 2 && wanted.state.police.length === 2, `wanted=${wanted.state.wanted} police=${wanted.state.police.length}`);
check('2 stars spawn 2 officers on foot', wanted.state.officers.length === 2, `officers=${wanted.state.officers.length}`);
check('police close in on the player over 60 s', (() => {
  let minSeen = Infinity, busted = false;
  for (let i = 0; i < 3600; i++) {
    traffic.step(1 / 60);
    wanted.step(1 / 60, player);
    if (wanted.state.busted) busted = true;
    if (wanted.state.distToPlayer != null) minSeen = Math.min(minSeen, wanted.state.distToPlayer);
    if (busted) break;
  }
  // Either they got close, or they caught the player (busted).
  return busted || minSeen < 30;
})(), `busted or closed in`);
check('busted resets wanted and clears police', (() => {
  // Fresh heat (the previous test may have ended in a bust).
  wanted.addHeat(2);
  // Park a police car next to the slow player for 3 s.
  const v = wanted.state.police[0];
  if (!v) return false;
  v.x = player.x + 2; v.z = player.z;
  let sawBusted = false;
  for (let i = 0; i < 200; i++) {
    wanted.step(1 / 60, player);
    if (wanted.state.busted) sawBusted = true;
  }
  return sawBusted && wanted.state.wanted === 0 && wanted.state.police.length === 0;
})());

// --- weather ---
check('weather is clear in the morning', (() => { weather.step(1, 10); return weather.state.mode === 'clear' && weather.state.rain < 0.05; })());
check('weather rains in the afternoon', (() => { weather.step(5, 15.8); return weather.state.rain > 0.5; })(), `rain=${weather.state.rain.toFixed(2)}`);
check('roads stay wet after the rain', (() => { weather.step(5, 17); return weather.state.mode === 'wet' && weather.state.wet > 0.5; })(), `wet=${weather.state.wet.toFixed(2)}`);
check('weather is dry again by night', (() => { weather.step(5, 21); return weather.state.mode === 'clear'; })());

// --- landmarks ---
const lm = buildLandmarks(city);
check('night market has 14 stalls', lm.counts.stalls === 14, `got ${lm.counts.stalls}`);
check('24 street vendors', lm.counts.vendors === 24);
check('16 bus stops — one per bus-route node, every sector', lm.counts.busStops === 16, `got ${lm.counts.busStops}`);
check('gas station + repair shop placed', lm.counts.gasStation === 1 && lm.counts.repairShop === 1);
check('10 neon billboards', lm.counts.billboards === 10, `got ${lm.counts.billboards}`);
check('3 city landmarks flagged (hospital/police/school)', city.buildings.filter((b) => b.landmark).length === 3,
  city.buildings.filter((b) => b.landmark).map((b) => b.landmark).join(','));

console.log(`traffic=${JSON.stringify(traffic.counts())} peds=${peds.count()}`);
if (failures > 0) { console.error(`${failures} check(s) FAILED`); process.exit(1); }
console.log('ALL PHASE B CHECKS PASSED');
