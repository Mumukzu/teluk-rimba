// Teluk Rimba — mission / autopilot / aircraft checks (Node, no browser).
// Drives the mission state machine with a mock player (positions set
// directly — the browser play-tests below prove real driving separately).
// Run: node tests/missions.test.mjs
import { generateCity, terrainHeight } from '../game/src/city.js';
import { createTraffic } from '../game/src/vehicles.js';
import { createPeds } from '../game/src/peds.js';
import { createWanted } from '../game/src/police.js';
import { createMissions, MISSIONS, missionById } from '../game/src/missions.js';
import { createAutopilot } from '../game/src/autopilot.js';
import { createAircraft } from '../game/src/air.js';
import { ACTION_ENTER } from '../game/src/input.js';
import { saveGame, loadGame, clearSave, SAVE_KEY } from '../game/src/save.js';

// localStorage stub for Node.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const city = generateCity();
const traffic = createTraffic(city);
const peds = createPeds(city);
const wanted = createWanted(city, traffic, peds);

function freshCtx() {
  const game = { money: 0, timeHours: 10, started: true, driving: null, wanted: 0 };
  const player = { state: { x: 0, z: 120, y: 0, camYaw: 0, camPitch: 0.32, camDist: 7.5, facing: 0 } };
  const hud = { hints: [], showHint(t) { this.hints.push(t); } };
  const missions = createMissions({ city, game, player, traffic, peds, wanted, hud, onSave: () => {} });
  return { game, player, hud, missions };
}
function stepTo(missions, player, x, z, seconds = 1) {
  player.state.x = x; player.state.z = z;
  for (let i = 0; i < seconds * 60; i++) missions.step(1 / 60);
}

// --- mission definitions ---
check('6 missions defined', MISSIONS.length === 6, `${MISSIONS.length}`);
check('mission ids are 1..6', MISSIONS.every((m, i) => m.id === i + 1));
check('every mission has steps + reward + time limit',
  MISSIONS.every((m) => m.steps.length > 0 && m.reward > 0 && m.timeLimit > 0));
check('every mission has an English name + intro',
  MISSIONS.every((m) => /^[A-Za-z ]+$/.test(m.name) && m.intro.length > 10));
check('mission 2 + 5 are night missions', missionById(2).night && missionById(5).night);
check('mission 5 boat escape target is in the sea', missionById(5).steps[2].x > 640);

// --- tallest tower is dynamic (not the old hard-coded building) ---
{
  const { missions } = freshCtx();
  const t = missions.tallestTower();
  check('tallest downtown tower is 150-200 m (was 78-105 m; Mu 23 Nov 21:03: CBD 2x taller)', t.h >= 150 && t.h <= 200, `${t.h} m at (${t.x},${t.z})`);
  const e = missions.towerEntrance();
  const inside = city.buildings.some((b) =>
    e.x > b.x - b.w / 2 && e.x < b.x + b.w / 2 && e.z > b.z - b.d / 2 && e.z < b.z + b.d / 2);
  check('tower entrance is outside every building', !inside, `(${e.x.toFixed(1)},${e.z.toFixed(1)})`);
}

// --- mission 1: full play-through by walking the mock player ---
{
  const { game, player, missions } = freshCtx();
  check('mission 1 starts', missions.start(1));
  check('mission 1 is active', missions.state.status === 'active' && missions.state.id === 1);
  check('mission 1 step 0 needs driving', missions.currentTarget() === null);
  game.driving = { type: 'scooter' }; // got on the scooter
  missions.step(1 / 60);
  check('mission 1 advanced past the drive step', missions.state.stepIdx === 1);
  stepTo(missions, player, 51, -51);
  check('mission 1 pickup step done', missions.state.stepIdx === 2);
  stepTo(missions, player, 620, -100);
  check('mission 1 complete', missions.state.status === 'idle' && missions.state.lastResult.result === 'done', JSON.stringify(missions.state.lastResult));
  check('mission 1 paid $150', game.money === 150, '$' + game.money);
  check('mission 1 recorded as done', missions.doneIds().includes(1));
  check('mission 1 cannot restart once done', !missions.start(1));
}

// --- mission 2: on-foot step does not complete while driving ---
{
  const { game, player, missions } = freshCtx();
  check('mission 2 starts at night', missions.start(2) && game.timeHours === 21.5);
  game.driving = { type: 'car' };
  stepTo(missions, player, 70, -70);
  check('mission 2 meet step NOT done while driving', missions.state.stepIdx === 0);
  game.driving = null;
  stepTo(missions, player, 70, -70);
  check('mission 2 meet step done on foot', missions.state.stepIdx === 1);
  check('mission 2 step 2 adds heat (wanted)', wanted.state.wanted >= 1, 'wanted ' + wanted.state.wanted);
  game.driving = { type: 'car' };
  stepTo(missions, player, 400, 400);
  check('mission 2 complete', missions.state.lastResult && missions.state.lastResult.result === 'done');
  check('mission 2 paid $300', game.money === 300, '$' + game.money);
}

// --- mission 3: chase — jeep spawns, moves, can be caught ---
{
  const { game, player, missions } = freshCtx();
  check('mission 3 starts', missions.start(3));
  check('chase jeep spawned', !!missions.chaseJeep);
  const j0 = { x: missions.chaseJeep.x, z: missions.chaseJeep.z };
  // Path length, not displacement: the jeep runs a loop, so after 10 s it
  // can be near where it started even while driving the whole time.
  let path = 0;
  for (let i = 0; i < 600; i++) {
    const px = missions.chaseJeep.x, pz = missions.chaseJeep.z;
    missions.step(1 / 60); // 10 s
    path += Math.hypot(missions.chaseJeep.x - px, missions.chaseJeep.z - pz);
  }
  const j1 = missions.chaseJeep;
  check('chase jeep drives its route', path > 100, path.toFixed(1) + ' m in 10 s');
  check('chase jeep not escaped yet', !j1.escaped);
  game.driving = { type: 'sedan' };
  missions.step(1 / 60); // past the drive step
  player.state.x = j1.x; player.state.z = j1.z; // catch it
  missions.step(1 / 60);
  check('mission 3 complete on catch', missions.state.lastResult && missions.state.lastResult.result === 'done');
  check('chase jeep removed after mission', !missions.chaseJeep);
}

// --- mission 4: tower steps use the dynamic entrance ---
{
  const { game, player, missions } = freshCtx();
  check('mission 4 starts', missions.start(4));
  const e = missions.towerEntrance();
  game.driving = { type: 'car' };
  missions.step(1 / 60); // drive step is not mission 4 step 0 — step 0 is goto
  check('mission 4 step 0 is a goto to the tower', missions.currentTarget() && missions.currentTarget().label.includes('glass tower'));
  stepTo(missions, player, e.x, e.z);
  check('mission 4 reached the tower', missions.state.stepIdx === 1, 'step ' + missions.state.stepIdx);
  game.driving = null; // get out
  stepTo(missions, player, e.x, e.z);
  check('mission 4 entered the tower on foot', missions.state.stepIdx === 2);
  game.driving = { type: 'car' };
  stepTo(missions, player, -50, -50);
  check('mission 4 complete', missions.state.lastResult && missions.state.lastResult.result === 'done');
  check('mission 4 paid $500', game.money === 500, '$' + game.money);
}

// --- mission 5: boat spawns parked, board + sail steps ---
{
  const { game, player, missions } = freshCtx();
  check('mission 5 starts at night', missions.start(5) && game.timeHours === 21.5);
  check('mission boat spawned at (660,430)', !!missions.missionBoat
    && missions.missionBoat.x === 660 && missions.missionBoat.z === 430,
    missions.missionBoat ? `(${missions.missionBoat.x},${missions.missionBoat.z})` : 'none');
  check('mission boat is parked (does not sail away)', missions.missionBoat.parked === true);
  check('mission 5 opens the east bound to 665 (wade to the boat)', missions.worldBound().max === 665);
  check('mission 5 sea limit is 665', missions.seaLimit() === 665);
  game.driving = { type: 'car' };
  stepTo(missions, player, 620, 380);
  check('mission 5 reached the harbor', missions.state.stepIdx === 1);
  game.driving = missions.missionBoat; // boarded
  missions.step(1 / 60);
  check('mission 5 board step done', missions.state.stepIdx === 2);
  stepTo(missions, player, 820, 300);
  check('mission 5 complete', missions.state.lastResult && missions.state.lastResult.result === 'done');
  check('mission 5 paid $600', game.money === 600, '$' + game.money);
}

// --- mission 6: mountain bounds open only during the mission ---
{
  const { game, player, missions } = freshCtx();
  check('normal world bound is +-650', missions.worldBound().min === -650);
  check('mission 6 starts', missions.start(6));
  check('mission 6 opens the mountain clamp to -800', missions.worldBound().min === -800);
  check('mission 6 jeep spawned at the forest road', traffic.vehicles.some((v) => v.type === 'jeep' && Math.hypot(v.x + 390, v.z + 290) < 1));
  game.driving = { type: 'jeep' };
  missions.step(1 / 60);
  stepTo(missions, player, -600, -600);
  check('mission 6 reached the mountain base', missions.state.stepIdx === 2);
  stepTo(missions, player, -780, -780);
  check('mission 6 reached the summit', missions.state.stepIdx === 3);
  check('mission 6 final step adds 3-star heat', wanted.state.wanted === 3, 'wanted ' + wanted.state.wanted);
  stepTo(missions, player, 620, -100);
  check('mission 6 complete', missions.state.lastResult && missions.state.lastResult.result === 'done');
  check('mission 6 paid $1000', game.money === 1000, '$' + game.money);
  check('world bound back to +-650 after mission 6', missions.worldBound().min === -650);
}

// --- timeout fails a mission ---
{
  const { missions } = freshCtx();
  missions.start(1);
  for (let i = 0; i < 241 * 60; i++) missions.step(1 / 60);
  check('mission 1 fails on timeout', missions.state.lastResult && missions.state.lastResult.result === 'failed'
    && missions.state.lastResult.reason === 'Time ran out', JSON.stringify(missions.state.lastResult));
}

// --- mission board: E on foot takes the next job, never auto-starts ---
{
  const { player, missions } = freshCtx();
  player.state.x = -50; player.state.z = -50;
  missions.step(1 / 60);
  check('mission board does NOT auto-start without E', missions.state.status === 'idle');
  missions.step(1 / 60, ACTION_ENTER);
  check('mission board starts mission 1 on E', missions.state.status === 'active' && missions.state.id === 1);
}
{
  // Driving through the plaza never starts a job (E is for the vehicle).
  const { game, player, missions } = freshCtx();
  player.state.x = -50; player.state.z = -50;
  game.driving = { type: 'car' };
  missions.step(1 / 60, ACTION_ENTER);
  check('mission board does NOT start while driving', missions.state.status === 'idle');
}
{
  // Cooldown: right after finishing a mission, E at the board does nothing.
  const { game, player, missions } = freshCtx();
  missions.start(1);
  game.driving = { type: 'scooter' };
  missions.step(1 / 60); // drive step done
  stepTo(missions, player, 51, -51);
  stepTo(missions, player, 620, -100); // completes mission 1
  check('mission 1 done for cooldown test', missions.state.lastResult && missions.state.lastResult.result === 'done');
  player.state.x = -50; player.state.z = -50;
  game.driving = null;
  missions.step(1 / 60, ACTION_ENTER);
  check('mission board ignores E during the post-mission cooldown', missions.state.status === 'idle');
  for (let i = 0; i < 11 * 60; i++) missions.step(1 / 60); // 10 s cooldown expires
  missions.step(1 / 60, ACTION_ENTER);
  check('mission board takes E again after the cooldown', missions.state.status === 'active' && missions.state.id === 2);
}

// --- save / load round-trip ---
{
  clearSave();
  const { game, missions } = freshCtx();
  missions.start(1);
  game.money = 250;
  const ok = saveGame({ money: game.money, done: missions.doneIds(), active: missions.saveState() });
  check('save writes', ok === true);
  const raw = store.get(SAVE_KEY);
  check('save row exists in storage', typeof raw === 'string' && raw.includes('"money":250'));
  const loaded = loadGame();
  check('load reads money + active mission', loaded && loaded.money === 250 && loaded.active && loaded.active.id === 1, JSON.stringify(loaded));
  const ctx2 = freshCtx();
  ctx2.missions.restore(loaded);
  check('restore resumes mission 1', ctx2.missions.state.status === 'active' && ctx2.missions.state.id === 1);
  check('restore restores money', ctx2.game.money === 250);
  clearSave();
  check('clear removes the save', loadGame() === null);
}

// --- autopilot: steers toward a target, no teleport ---
{
  const ap = createAutopilot(city);
  const player = { state: { x: 0, z: 120, y: 0, camYaw: 0, camPitch: 0.32, camDist: 7.5, facing: 0 } };
  // Straight run south down the main road x=0: car on node (0,100), facing
  // the next node (0,200) — drives straight at it.
  const straight = { currentTarget: () => ({ x: 0, z: 400, radius: 8, onFoot: false }) };
  const driving = { type: 'car', x: 0, z: 100, heading: 0, speed: 10 };
  ap.update(1 / 60, { player, driving, traffic, missions: straight });
  check('autopilot drives forward toward the target', ap.drive.forward === true);
  check('autopilot does not move the player itself', player.state.x === 0 && player.state.z === 120);
  // Same run, car facing the wrong way: it steers around, never reverses.
  const drivingBack = { type: 'car', x: 0, z: 100, heading: Math.PI, speed: 10 };
  ap.route = [];
  ap.update(1 / 60, { player, driving: drivingBack, traffic, missions: straight });
  check('autopilot steers (left or right) when facing away', ap.drive.left || ap.drive.right);
  check('autopilot never reverses toward the target', ap.drive.back === false);
  // On-foot, far target, the car we got out of 20 m away: walk to it, get in.
  {
    const ap2 = createAutopilot(city);
    const player2 = { state: { x: 70, z: -70, y: 0, camYaw: 0, camPitch: 0.32, camDist: 7.5, facing: 0 } };
    const car = { type: 'car', x: 88, z: -62, heading: 0, speed: 0, parked: true, driven: false };
    const traffic2 = { nearestEnterable: () => car, vehicles: [car], boats: [] };
    const far = { currentTarget: () => ({ x: 400, z: 400, radius: 8, onFoot: false }) };
    ap2.update(1 / 60, { player: player2, driving: null, traffic: traffic2, missions: far });
    check('autopilot walks to the car it got out of', ap2.walk.forward === true && !ap2.wantEnter);
    check('autopilot walks toward the car, not the far target',
      Math.abs(player2.state.camYaw - Math.atan2(-(88 - 70), -(-62 + 70))) < 0.01);
    player2.state.x = 82.5; player2.state.z = -62; // 5.5 m from the car
    ap2.update(1 / 60, { player: player2, driving: null, traffic: traffic2, missions: far });
    check('autopilot keeps walking at 5.5 m (game enter radius is 5 m)',
      ap2.wantEnter === false && ap2.walk.forward === true);
    player2.state.x = 85; player2.state.z = -62; // 3 m from the car
    ap2.update(1 / 60, { player: player2, driving: null, traffic: traffic2, missions: far });
    check('autopilot gets back in the car when close', ap2.wantEnter === true);
    // No vehicle anywhere near: walk the road graph (never straight into
    // the river) — the first waypoint must be a road node, not the target.
    const traffic3 = { nearestEnterable: () => null, vehicles: [], boats: [] };
    const ap3 = createAutopilot(city);
    ap3.update(1 / 60, { player: player2, driving: null, traffic: traffic3, missions: far });
    check('autopilot walks the road graph when no vehicle is near',
      ap3.walk.forward === true && ap3.route.length > 2);
  }
  // Board step: the car we just left is 2 m away, the boat is at the
  // target — walk to the boat, never re-enter the car.
  {
    const ap4 = createAutopilot(city);
    const player4 = { state: { x: 641, z: 413, y: 0, camYaw: 0, camPitch: 0.32, camDist: 7.5, facing: 0 } };
    const car4 = { type: 'car', x: 640, z: 415, heading: 0, speed: 0, parked: true, driven: false };
    const traffic4 = { nearestEnterable: () => car4, vehicles: [car4], boats: [] };
    const board = { currentTarget: () => ({ x: 660, z: 430, radius: 6, onFoot: true, board: true }) };
    ap4.update(1 / 60, { player: player4, driving: null, traffic: traffic4, missions: board });
    check('board step walks to the boat, does not re-enter the car',
      ap4.wantEnter === false && ap4.walk.forward === true);
    player4.state.x = 658; player4.state.z = 428; // 2.8 m from the boat
    ap4.update(1 / 60, { player: player4, driving: null, traffic: traffic4, missions: board });
    check('board step presses E once right next to the boat', ap4.wantEnter === true);
  }
  // On-foot target: walks (camera yaw points at the target).
  const mockMissions2 = { currentTarget: () => ({ x: 50, z: -50, radius: 4, onFoot: true }) };
  ap.update(1 / 60, { player, driving: null, traffic, missions: mockMissions2 });
  check('autopilot walks to an on-foot target', ap.walk.forward === true);
  // Mountain target: off-road direct steering, no crash.
  const mockMissions3 = { currentTarget: () => ({ x: -780, z: -780, radius: 12, onFoot: false }) };
  const jeep = { type: 'jeep', x: -600, z: -600, heading: 0, speed: 10 };
  let threw = false;
  try { ap.update(1 / 60, { player, driving: jeep, traffic, missions: mockMissions3 }); } catch { threw = true; }
  check('autopilot handles the off-road mountain target', !threw && ap.drive.forward === true);
}

// --- aircraft: heli orbits, beam at night only, plane by day only ---
{
  const air = createAircraft(city, { rand: () => 0.5 });
  air.step(10, { player: { x: 0, z: 0 }, wanted: 0, isDay: true });
  const day = air.matricesFor(0, 0, true, 10);
  check('heli flies by day', day.heli.matrices.length === 1);
  check('heli has no spotlight beam by day', day.heliBeam.matrices.length === 0);
  check('plane is absent before its first crossing', day.plane.matrices.length === 0);
  air.step(60, { player: { x: 0, z: 0 }, wanted: 0, isDay: true });
  const day2 = air.matricesFor(0, 0, true, 70);
  check('plane crosses by day', day2.plane.matrices.length === 1);
  check('plane flies at 260 m (was 185 m; Mu 23 Nov 21:03: CBD towers are 150-200 m, so the plane must stay above them)', air.state.plane.y === 260);
  const tallestH = Math.max(...city.buildings.map((b) => b.h));
  check('heli orbits above the tallest tower', air.state.heliY > tallestH + 20, `heli ${air.state.heliY.toFixed(0)} m vs tallest ${tallestH} m`);
  const night = air.matricesFor(0, 0, false, 70);
  check('heli spotlight cone shines at night', night.heliBeam.matrices.length === 1);
  check('plane does not fly at night', night.plane.matrices.length === 0);
  // Wanted 2+: the heli hunts the player.
  air.step(1, { player: { x: 300, z: 300 }, wanted: 2, isDay: false });
  const d = Math.hypot(air.state.heliX - 300, air.state.heliZ - 300);
  check('heli orbits the player at wanted 2+', Math.abs(d - 130) < 2, 'orbit radius ' + d.toFixed(1));
}

if (failures > 0) { console.error(`${failures} check(s) FAILED`); process.exit(1); }
console.log('ALL MISSION CHECKS PASSED');
