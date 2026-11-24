// Teluk Rimba — police gunfire checks (Mu, 24 Nov 2026: the police shoot
// back). Node, no browser. Drives createWanted with the real city /
// traffic / peds; shooter positions are set directly so every check is
// deterministic (seeded RNG). Run: node tests/police.test.mjs
import { generateCity } from '../game/src/city.js';
import { createTraffic } from '../game/src/vehicles.js';
import { createPeds } from '../game/src/peds.js';
import {
  createWanted, hitChance,
  OFFICER_RANGE, POLICE_CAR_RANGE, FIRE_INTERVAL_MIN, FIRE_INTERVAL_MAX,
  DMG_MIN, DMG_MAX, SHOT_LIFE,
} from '../game/src/police.js';

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const STEP = 1 / 60;
const city = generateCity();

function freshWanted(seed = 7) {
  const traffic = createTraffic(city);
  const peds = createPeds(city);
  const wanted = createWanted(city, traffic, peds, { seed });
  return { traffic, peds, wanted };
}
function playerAt(x = 0, z = 0) {
  return { x, z, y: 0, speedKmh: 0 };
}
// Step the wanted system, collecting every shot event fired.
function collectShots(wanted, player, secs, opts) {
  const events = [];
  const n = Math.round(secs / STEP);
  for (let i = 0; i < n; i++) {
    wanted.step(STEP, player, opts);
    events.push(...wanted.state.shotEvents);
  }
  return events;
}

// --- 1. hit chance falls with distance ---
check('hitChance is 55% inside 10 m', hitChance(5, OFFICER_RANGE) === 0.55);
check('hitChance is still 55% at exactly 10 m', hitChance(10, OFFICER_RANGE) === 0.55);
check('hitChance is 15% at max range (officer)', hitChance(OFFICER_RANGE, OFFICER_RANGE) === 0.15);
check('hitChance is 15% at max range (car)', hitChance(POLICE_CAR_RANGE, POLICE_CAR_RANGE) === 0.15);
check('hitChance falls between 10 m and max range',
  hitChance(12, OFFICER_RANGE) > hitChance(20, OFFICER_RANGE)
  && hitChance(20, OFFICER_RANGE) > hitChance(OFFICER_RANGE, OFFICER_RANGE));
check('hitChance midpoint is 35% at 17.5 m',
  Math.abs(hitChance(17.5, OFFICER_RANGE) - 0.35) < 1e-9, String(hitChance(17.5, OFFICER_RANGE)));

// --- 2. no fire at wanted 0 ---
{
  const { wanted } = freshWanted();
  const events = collectShots(wanted, playerAt(), 5);
  check('police do not fire at wanted 0', events.length === 0 && wanted.state.shots.length === 0);
}

// --- 3. police car fires in range, silent out of range ---
const allHitEvents = [];
{
  const { wanted } = freshWanted();
  wanted.addHeat(1); // wanted 1 -> one police car
  check('one police car spawns at wanted 1', wanted.state.police.length === 1);
  check('no officers at wanted 1', wanted.state.officers.length === 0);
  const car = wanted.state.police[0];
  car.x = 10; car.z = 0; car.y = 0; car.parked = false; car.driven = false;
  const events = collectShots(wanted, playerAt(), 3);
  check('police car fires within 35 m', events.length >= 1, events.length + ' shots');
  check('shot events carry shooter + target positions',
    events.every((e) => Number.isFinite(e.fx) && Number.isFinite(e.tx) && typeof e.hit === 'boolean'));
  for (const e of events) if (e.hit) allHitEvents.push(e);
  // Move the same car far out of range: it must hold fire.
  car.x = 100; car.z = 0;
  const far = collectShots(wanted, playerAt(), 5);
  check('police car holds fire beyond 35 m', far.length === 0, far.length + ' shots');
}

// --- 4. officers fire at wanted 2 (cars parked far away, so only officers can shoot) ---
{
  const { wanted } = freshWanted();
  wanted.addHeat(2); // wanted 2 -> cars + 2 officers
  check('two officers spawn at wanted 2', wanted.state.officers.length === 2);
  for (const v of wanted.state.police) { v.x = 500; v.z = 500; }
  const [o1, o2] = wanted.state.officers;
  o1.x = 15; o1.z = 0; o1.y = 0;
  o2.x = -15; o2.z = 0; o2.y = 0;
  const events = collectShots(wanted, playerAt(), 3);
  check('officers fire within 25 m', events.length >= 1, events.length + ' shots');
  for (const e of events) if (e.hit) allHitEvents.push(e);
  // Officers out of range hold fire too.
  o1.x = 60; o1.z = 0; o2.x = -60; o2.z = 0;
  const far = collectShots(wanted, playerAt(), 5);
  check('officers hold fire beyond 25 m', far.length === 0, far.length + ' shots');
}

// --- 5. per-shooter cooldown respected ---
{
  const { wanted } = freshWanted();
  wanted.addHeat(1);
  const car = wanted.state.police[0];
  car.x = 6; car.z = 0; car.y = 0; car.parked = false; car.driven = false;
  const events = collectShots(wanted, playerAt(), 10);
  // One shooter, interval 1.2-2.0 s, first shot after 1.2-2.0 s:
  // 10 s holds 5-8 shots. (Loose bounds guard the arithmetic, not luck.)
  check('one car fires 4-9 times in 10 s (cooldown 1.2-2.0 s)',
    events.length >= 4 && events.length <= 9, events.length + ' shots');
  for (const e of events) if (e.hit) allHitEvents.push(e);
}

// --- 6. hits deal 8-12 damage, misses deal 0 ---
check('every hit deals 8-12 damage',
  allHitEvents.length > 0 && allHitEvents.every((e) => e.dmg >= DMG_MIN && e.dmg <= DMG_MAX),
  allHitEvents.length + ' hits, dmg ' + allHitEvents.map((e) => e.dmg).join(','));
{
  const { wanted } = freshWanted();
  wanted.addHeat(1);
  const car = wanted.state.police[0];
  car.x = 10; car.z = 0; car.y = 0; car.parked = false; car.driven = false;
  const events = collectShots(wanted, playerAt(), 3);
  check('misses deal 0 damage',
    events.filter((e) => !e.hit).every((e) => e.dmg === 0),
    events.filter((e) => !e.hit).length + ' misses');
}

// --- 7. shooting can be switched off (shop menu open) ---
{
  const { wanted } = freshWanted();
  wanted.addHeat(1);
  const car = wanted.state.police[0];
  car.x = 10; car.z = 0; car.y = 0; car.parked = false; car.driven = false;
  const events = collectShots(wanted, playerAt(), 3, { shooting: false });
  check('no shots while shooting is disabled', events.length === 0);
}

// --- 8. tracers fade (0.12 s life) ---
{
  const { wanted } = freshWanted();
  wanted.addHeat(1);
  const car = wanted.state.police[0];
  car.x = 10; car.z = 0; car.y = 0; car.parked = false; car.driven = false;
  // Tracers live only 0.12 s, so watch for one DURING the firing window
  // (checking after the window ends would race the decay).
  let maxShots = 0;
  for (let i = 0; i < Math.round(3 / STEP); i++) {
    wanted.step(STEP, playerAt());
    maxShots = Math.max(maxShots, wanted.state.shots.length);
  }
  check('a tracer is live right after a shot', maxShots > 0, 'max ' + maxShots);
  car.x = 100; car.z = 0; // out of range: no new shots while the old ones fade
  collectShots(wanted, playerAt(), 0.5);
  check('tracers are gone 0.5 s later', wanted.state.shots.length === 0);
  check('shot life is 0.12 s', SHOT_LIFE === 0.12);
}

// --- 9. reset clears the whole pursuit ---
{
  const { wanted } = freshWanted();
  wanted.addHeat(2);
  const car = wanted.state.police[0];
  car.x = 10; car.z = 0; car.y = 0; car.parked = false; car.driven = false;
  collectShots(wanted, playerAt(), 3);
  wanted.reset();
  check('reset clears wanted + heat', wanted.state.wanted === 0 && wanted.state.heat === 0);
  check('reset removes police cars + officers',
    wanted.state.police.length === 0 && wanted.state.officers.length === 0);
  check('reset clears tracers + pending events',
    wanted.state.shots.length === 0 && wanted.state.shotEvents.length === 0);
}

// --- 10. officers leave when wanted drops below 2 stars ---
{
  const { wanted } = freshWanted();
  wanted.addHeat(2);
  check('two officers at wanted 2', wanted.state.officers.length === 2);
  wanted.reduceHeat(1);
  check('officers gone at wanted 1', wanted.state.officers.length === 0 && wanted.state.police.length === 1);
}

// --- tuning constants are what the spec promises ---
check('fire interval is 1.2-2.0 s', FIRE_INTERVAL_MIN === 1.2 && FIRE_INTERVAL_MAX === 2.0);
check('damage range is 8-12', DMG_MIN === 8 && DMG_MAX === 12);
check('officer range is 25 m, car range is 35 m', OFFICER_RANGE === 25 && POLICE_CAR_RANGE === 35);

console.log(failures === 0 ? 'ALL POLICE CHECKS PASSED' : failures + ' CHECK(S) FAILED');
process.exit(failures === 0 ? 0 : 1);
