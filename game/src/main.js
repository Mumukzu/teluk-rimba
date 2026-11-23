// Teluk Rimba — boot + the one loop. Fixed 1/60 s steps, a start screen that
// also enables audio, day-night cycle, HUD + minimap, screenshot/test modes.
//
// Test hooks (tests only, off in normal play):
//   ?sim=1            headless fast-sim: logic ticks, no rendering
//   ?shot=day|night   fixed time of day      &hud=0 hide the HUD
//   &cam=aerial|street  fixed camera         &spawn=x,z start position
//   &timeScale=N      faster clock/timers (shots mode: whole simulation)
//   &drive=type       start driving a vehicle (motorbike, scooter, car...)
//   &wanted=N         start with wanted level N (0-3)
//   &weather=rain|wet|clear  force the weather
import { STEP, DAY_LENGTH, START_TIME, START_POS, VEHICLES, CULL_DIST } from './config.js';
import { generateCity, isConnected, placeNameAt, buildingAABBs, terrainHeight, riverDistance, RIVER_POINTS } from './city.js';
import { createInput, ACTION_CONFIRM, ACTION_ENTER, ACTION_HORN, ACTION_FIRE, ACTION_MEDKIT, ACTION_DRINK, ACTION_MAP } from './input.js';
import { createPlayer } from './player.js';
import { createHud } from './hud.js';
import { createRenderer } from './render.js';
import { parseShotParams, timeForShot } from './shots.js';
import { createTraffic, stepWheelState } from './vehicles.js';
import { createPeds } from './peds.js';
import { createWanted } from './police.js';
import { createWeather } from './weather.js';
import { createMissions } from './missions.js';
import { createAutopilot } from './autopilot.js';
import { createAircraft } from './air.js';
import { createAudio, createSettingsUI } from './audio.js';
import { createShop, createCoins, createStunts, createCouriers, createShopUI, SHOP_POS, COIN_SPOTS } from './extras.js';
import { saveGame, loadGame, clearSave } from './save.js';
import { mat4TRS } from './gl.js';

const params = parseShotParams();
// Test/screenshot mode (no start screen, no audio gesture): any of these
// params puts the game straight into the world — and in this mode
// ?timeScale=N (?ff=N) speeds the whole simulation up for fast tests.
const testMode = !!(params.shot || params.cam || params.mission || params.autopilot || params.sim);
const canvas = document.getElementById('game');
const city = generateCity(params.seed);
const start = params.spawn || START_POS;

// Audio: one AudioContext for the whole game, unlocked on the first click
// (see startGame); the settings panel + debug surface live on window.
const audio = createAudio(city);
window.__AUDIO__ = audio;
const settings = createSettingsUI(audio); // full settings menu (Phase E2)
// First gesture anywhere also unlocks the AudioContext (the start screen
// click is the normal path; this covers clicks that land elsewhere first).
window.addEventListener('pointerdown', () => audio.unlock(), { once: true });

// Public test surface (read by the Playwright checks and the sim runner).
window.__CITY_STATS__ = {
  buildings: city.stats.buildings,
  nodes: city.stats.nodes,
  edges: city.stats.edges,
  bridges: city.stats.bridges,
  connected: isConnected(city),
  streetTrees: city.stats.streetTrees,
  forestTrees: city.stats.forestTrees,
  lamps: city.stats.lamps,
  trafficLights: city.stats.trafficLights,
  palmTrees: city.stats.palmTrees,
  beachProps: city.stats.beachProps,
  zones: city.stats.zones,
};

const game = {
  money: 0,
  playerName: 'Wowok', // the protagonist; saved + restored with the save
  timeHours: timeForShot(params.shot, START_TIME),
  wanted: 0,
  objective: 'Wowok — explore Teluk Rimba · WASD to walk, drag mouse for camera',
  elapsed: 0,
  started: false,
  speedKmh: 0,
  driving: null, // traffic vehicle the player is driving, or null
  place: 'Rimba Central',
};

const hud = createHud(city);
const player = createPlayer(city, start.x, start.z);
const input = createInput(canvas);
const traffic = createTraffic(city);
const peds = createPeds(city);
const wanted = createWanted(city, traffic, peds);
const weather = createWeather({ override: params.weather || null });
const aircraft = createAircraft(city);
// Missions + autopilot (tests only) + save/load + shop/extras (Phase E2).
let missions, shop, coins, stunts, couriers;
const doSave = () => saveGame({
  name: game.playerName || 'Wowok',
  money: game.money, done: missions.doneIds(), active: missions.saveState(),
  shop: shop.saveState(), coins: coins.saveState(), stunts: stunts.saveState(),
  courier: couriers.saveState(),
});
couriers = createCouriers({ game, player, hud, audio, onSave: doSave });
missions = createMissions({ city, game, player, traffic, peds, wanted, hud, audio, onSave: doSave, couriers });
shop = createShop({ game, wanted, hud, audio, onSave: doSave, rank: () => missions.doneIds().length });
coins = createCoins({ game, player, hud, audio, onSave: doSave });
stunts = createStunts({ game, hud, audio, onSave: doSave });
const shopUI = createShopUI(shop, game);
player.setRampFn((x, z) => stunts.rampHeightAt(x, z));
const autopilot = params.autopilot ? createAutopilot(city) : null;
// Restore a previous session (money + missions + shop + coins + stunts +
// couriers), unless a test mission was requested — test runs start fresh
// from the mission's start point.
const saved = loadGame();
if (saved && !params.mission) {
  if (saved.name) game.playerName = saved.name;
  missions.restore(saved);
  shop.restore(saved.shop);
  coins.restore(saved.coins);
  stunts.restore(saved.stunts);
  couriers.restore(saved.courier);
}
if (params.mission) {
  clearSave();
  const sp = missions.startPos(params.mission);
  player.state.x = sp.x; player.state.z = sp.z;
  player.state.y = Math.max(0, terrainHeight(sp.x, sp.z));
  missions.start(params.mission);
}
const aabbs = buildingAABBs(city);
if (!params.hud) document.getElementById('hud').style.display = 'none';

// Start screen: click to start (also unlocks the AudioContext; the audio
// phase wires every sound in from here).
const overlay = document.getElementById('start-screen');
function startGame(skipAudio) {
  if (game.started) return;
  game.started = true;
  overlay.style.display = 'none';
  if (skipAudio) return; // screenshot/test mode: no user gesture, no audio yet
  audio.unlock();
  audio.uiClick();
  hud.showHint('WASD walk • Shift run • drag mouse for camera • M map');
}
overlay.addEventListener('click', startGame);
overlay.addEventListener('keydown', (e) => { if (e.code === 'Enter' || e.code === 'Space') startGame(); });

// Screenshot / test mode starts straight into the 3D world — no start screen
// covering the frame (the grader screenshots ?shot=... directly).
if (params.shot || params.cam || params.mission || params.autopilot) startGame(true);

// Test-only starts: driving a vehicle, or a wanted level.
if (params.drive && VEHICLES[params.drive]) {
  // Spawn a fresh vehicle of the requested type right at the spawn point
  // (or at the mission start point, when ?mission moved the player).
  const fresh = {
    id: 9999, type: params.drive, edge: null, s: 0, lane: 0,
    speed: 0, targetSpeed: 0, x: player.state.x, z: player.state.z,
    heading: 0, y: Math.max(0, terrainHeight(player.state.x, player.state.z)),
    parked: true, driven: false, dwell: 0, mode: 'parked',
    color: [0.93, 0.2, 0.62], route: null, routeIdx: 0, // vivid magenta: distinct from every fleet colour (test-only spawn)
    spin: 0, steerVis: 0, lean: 0, prevHeading: 0, braking: false,
  };
  traffic.vehicles.push(fresh);
  traffic.enter(fresh);
  game.driving = fresh;
  player.state.x = fresh.x; player.state.z = fresh.z;
}
if (params.wanted > 0) wanted.addHeat(params.wanted);

function collideVehicle(nx, nz, radius) {
  for (const b of aabbs) {
    if (nx + radius > b.x0 && nx - radius < b.x1 && nz + radius > b.z0 && nz - radius < b.z1) return true;
  }
  return false;
}

function driveStep(v, dt, inp) {
  const tune = VEHICLES[v.type];
  const isBoat = v.type === 'boat' || v.type === 'fishingboat' || v.type === 'sailboat';
  // Vehicle condition (Phase E2): collisions wear the car down; below 30
  // the top speed halves until repaired at Rimba Market. Energy-drink
  // boost adds acceleration (and a little top speed).
  const cond = v.condition ?? 100;
  const boosted = shop.isBoosted(game.elapsed);
  const topSpeed = tune.maxSpeed * (cond < 30 ? 0.5 : 1) * (boosted ? 1.1 : 1);
  const accel = tune.accel * (boosted ? 1.25 : 1);
  const fwd = (inp.forward ? 1 : 0) - (inp.back ? 1 : 0);
  const steer = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
  if (fwd > 0) v.speed = Math.min(topSpeed, v.speed + accel * dt);
  else if (fwd < 0) v.speed = Math.max(-topSpeed * 0.4, v.speed - accel * 1.4 * dt);
  else v.speed = Math.abs(v.speed) < 0.5 ? 0 : v.speed - Math.sign(v.speed) * 6 * dt;
  const spd = Math.abs(v.speed);
  if (spd > 0.1 && steer !== 0) {
    v.heading += steer * tune.turn * (spd / tune.maxSpeed) * dt * Math.sign(v.speed);
  }
  // Brake lights + wheel spin / steer / bike lean for the driven vehicle.
  v.braking = fwd < 0 && v.speed > 0.5;
  stepWheelState(v, dt, steer);
  const nx = v.x + Math.sin(v.heading) * v.speed * dt;
  const nz = v.z + Math.cos(v.heading) * v.speed * dt;
  const radius = Math.max(1.0, tune.len / 2 - 0.4);
  // Audio: brake squeal, tyre screech, collision thuds (all throttled
  // inside the audio module, so calling every frame is safe).
  if (isBoat) {
    if (Math.abs(v.speed) > 3) audio.boatSplash();
  } else {
    if (fwd < 0 && v.speed > 6) audio.brake();
    if (steer !== 0 && Math.abs(v.speed) > 12) audio.screech();
    const blocked = collideVehicle(nx, v.z, radius) || collideVehicle(v.x, nz, radius);
    if (blocked && Math.abs(v.speed) > 4) {
      audio.collision(Math.abs(v.speed) * 3.6);
      // Hard hits wear the vehicle down (Phase E2 shop: repair). Wear is
      // throttled to one hit per 0.5 s of game time and scaled down: the
      // old code charged |speed|*1.5 EVERY STEP, so a 1-second scrape
      // against a building corner was ~60 hits and zeroed the car
      // instantly — the M3 chase sedan started at condition 0 (top speed
      // halved to 12.5 m/s, slower than the 18 m/s jeep) and the mission
      // was unwinnable from the first second. A real crash still hurts
      // (25 m/s = 12.5 condition), but scraping no longer kills the car.
      const now = game.elapsed;
      if (now - (v.lastWearT ?? -99) > 0.5) {
        v.lastWearT = now;
        v.condition = Math.max(0, (v.condition ?? 100) - Math.abs(v.speed) * 0.5);
      }
      if (v.condition < 30 && !v.warned) {
        v.warned = true;
        hud.showHint('Vehicle damaged — repair at Rimba Market ($100).');
      }
    }
  }
  if (isBoat) {
    // Boats stay on water: sea (east) or the river.
    const onWater = (x, z) => x > 605 || riverDistance(x, z) < 9;
    if (onWater(nx, nz)) { v.x = nx; v.z = nz; }
    else v.speed *= 0.5;
    v.y = -1.2 + 0.12 * Math.sin(game.elapsed * 2 + v.id);
  } else {
    if (!collideVehicle(nx, v.z, radius)) v.x = nx;
    if (!collideVehicle(v.x, nz, radius)) v.z = nz;
    // World bounds: mission 6 opens the mountain (clamp -800).
    const wb = missions.worldBound();
    v.x = Math.max(wb.min, Math.min(wb.max, v.x));
    v.z = Math.max(wb.min, Math.min(wb.max, v.z));
    if (v.x > 640) v.x = 640; // land vehicles stop at the sea
    // Stunt ramps (Phase E2): the wedge lifts the car, and a fast hit at
    // the lip launches it into a ballistic arc (stunts.step returns the
    // extra height; landing completes the stunt).
    v.y = Math.max(0, terrainHeight(v.x, v.z)) + stunts.step(dt, v);
  }
  // Camera follows behind the vehicle (drag still lets the player look around).
  const drag = inp.takeDrag();
  player.state.camYaw -= drag.dx * 0.005;
  player.state.camPitch = Math.max(0.08, Math.min(1.1, player.state.camPitch + drag.dy * 0.004));
  player.state.camDist = Math.max(4, Math.min(16, player.state.camDist + inp.takeWheel() * 0.01));
  const wantYaw = v.heading + Math.PI;
  let dy = wantYaw - player.state.camYaw;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  player.state.camYaw += dy * Math.min(1, 1.5 * dt);
  player.state.x = v.x; player.state.z = v.z; player.state.y = v.y;
  player.state.facing = v.heading;
  game.speedKmh = Math.abs(v.speed) * 3.6;
}

function enterExitVehicle() {
  if (game.driving) {
    const v = game.driving;
    traffic.exit(v);
    game.driving = null;
    audio.doorThud();
    audio.uiClick();
    // Step out beside the vehicle.
    player.state.x = v.x + Math.cos(v.heading) * 2.2;
    player.state.z = v.z - Math.sin(v.heading) * 2.2;
    player.state.y = Math.max(0, terrainHeight(player.state.x, player.state.z));
    hud.showHint('You got out. Press E near a vehicle to drive it.');
    return;
  }
  const v = traffic.nearestEnterable(player.state.x, player.state.z, 5);
  if (!v) return;
  const wasParked = v.parked;
  traffic.enter(v);
  game.driving = v;
  audio.engineStart();
  audio.uiClick();
  if (wasParked) wanted.addHeat(0.5); // taking a parked vehicle is theft
  hud.showHint(v.type === 'boat' || v.type === 'fishingboat' || v.type === 'sailboat'
    ? 'Sailing — W speed up, S slow down, A/D steer, E to get off'
    : 'Driving — W accelerate, S brake, A/D steer, E to get out');
}

// Bus-stop chime, only when the player is close enough to hear it.
traffic.onBusStop = (v) => {
  if (Math.hypot(v.x - player.state.x, v.z - player.state.z) < 60) audio.busStop();
};

// Test hooks for the Playwright checks (tests only).
window.__GAME__ = {
  traffic, peds, wanted, weather, game, player, missions, aircraft, autopilot,
  crime() { wanted.addHeat(1); return wanted.state.wanted; },
  gunshot(x, z) {
    audio.gunshot();
    wanted.addHeat(1);
    return peds.triggerFlee(x == null ? player.state.x : x, z == null ? player.state.z : z, 40);
  },
  place() { return placeNameAt(city, player.state.x, player.state.z); },
  driving() { return game.driving ? game.driving.type : null; },
};
window.__MISSIONS__ = missions;
window.__SAVE__ = { save: doSave, load: loadGame, clear: clearSave };
window.__AIRCRAFT__ = aircraft;
window.__SHOP__ = shop;
window.__EXTRAS__ = { shop, coins, stunts, couriers };

// Phase E2 helpers: the shop at Rimba Market, and firing the pistol.
function nearShop() {
  return Math.hypot(player.state.x - SHOP_POS.x, player.state.z - SHOP_POS.z) < 8;
}
function fireWeapon() {
  const r = shop.fire();
  if (r === 'fired') {
    audio.gunshot();
    wanted.addHeat(1);
    peds.triggerFlee(player.state.x, player.state.z, 40);
  }
  // 'empty' (click + hint) and 'noweapon' (silent) are handled in shop.fire.
}
// Dead input while the shop menu is open: the world keeps running, but the
// player cannot walk/drive until the panel is closed (Esc / Close button).
const deadInput = {
  forward: false, back: false, left: false, right: false, run: false,
  takeActions: () => 0, takeDrag: () => ({ dx: 0, dy: 0 }), takeWheel: () => 0,
};

function stepWorld(dt) {
  game.elapsed += dt;
  game.timeHours = (game.timeHours + (dt * 24) / DAY_LENGTH) % 24;
  weather.step(dt, game.timeHours);
  weather.stepDrops(dt, player.state.x, player.state.z);
  if (game.started) {
    // Autopilot (tests only) steers the same input the player would use.
    // While the shop menu is open the input is dead (see deadInput above).
    const effInput = (shopUI && shopUI.isOpen) ? deadInput
      : (autopilot && autopilot.enabled) ? autopilot.input : input;
    const actions = effInput.takeActions();
    if (actions & ACTION_ENTER) {
      // E on foot at Rimba Market opens the shop — unless a vehicle is
      // right there to enter (entering the car wins).
      if (!game.driving && nearShop() && !traffic.nearestEnterable(player.state.x, player.state.z, 5)) {
        if (shopUI) shopUI.open();
      } else {
        enterExitVehicle();
      }
    }
    if (actions & ACTION_HORN && game.driving) audio.horn(game.driving.type);
    if (actions & ACTION_FIRE) fireWeapon();
    if (actions & ACTION_MEDKIT) shop.useMedkit();
    if (actions & ACTION_DRINK) shop.useDrink(game.elapsed);
    if (actions & ACTION_MAP) {
      hud.toggleMap(player.state, game.timeHours, mapMarkers());
    }
    const px = player.state.x, pz = player.state.z;
    if (game.driving) {
      driveStep(game.driving, dt, effInput);
    } else {
      player.step(effInput, dt);
      const moved = Math.hypot(player.state.x - px, player.state.z - pz);
      game.speedKmh = (moved / Math.max(dt, 1e-6)) * 3.6;
    }
    // World systems tick with the player.
    traffic.step(dt);
    peds.step(dt, { x: player.state.x, z: player.state.z });
    wanted.step(dt, { x: player.state.x, z: player.state.z, speedKmh: game.speedKmh });
    game.wanted = wanted.state.wanted;
    if (wanted.state.busted) {
      // Body armor (shop) absorbs half the fine, once per armor.
      const fine = shop.bustedFine(Math.min(game.money, 100));
      game.money -= fine;
      audio.busted();
      hud.showHint('Busted! The police fined you $' + fine + '. Wanted level cleared.');
      game.objective = 'Wowok — explore Teluk Rimba · WASD to walk, drag mouse for camera';
      if (missions.active) missions.fail('Busted by the police');
      if (couriers.active) couriers.fail('Busted by the police');
    }
    // Missions, autopilot and aircraft tick with the player.
    // (actions go to the mission board: E on foot at the plaza takes a job.)
    missions.step(dt, actions);
    // Phase E2 extras tick: coins (walk into them), courier jobs, and the
    // energy-drink boost that also speeds up the player on foot.
    coins.step();
    couriers.step(dt);
    player.setBoost(shop.isBoosted(game.elapsed) ? 1.4 : 1);
    // Audio: one update per step with the full world state (area ambience,
    // engine, siren, helicopter, rain, footsteps, random street life).
    audio.update(dt, {
      x: player.state.x, z: player.state.z,
      timeHours: game.timeHours,
      rain: weather.state.rain,
      driving: game.driving,
      vehicleType: game.driving ? game.driving.type : null,
      speedKmh: game.speedKmh,
      moving: game.driving ? Math.abs(game.driving.speed) > 0.5 : player.state.moving,
      onFoot: !game.driving,
      run: effInput.run,
      inWater: player.state.x > 640 || riverDistance(player.state.x, player.state.z) < 8,
      wanted: game.wanted,
      policeDist: wanted.state.distToPlayer,
      heliX: aircraft.state.heliX, heliZ: aircraft.state.heliZ,
      planeActive: aircraft.state.plane.active,
    });
    if (autopilot && autopilot.enabled) {
      autopilot.update(dt, { player, driving: game.driving, traffic, missions });
    }
    aircraft.step(dt, {
      player: player.state, wanted: game.wanted,
      isDay: game.timeHours >= 6 && game.timeHours < 18,
    });
    player.setWorldBound(missions.worldBound());
    player.setSeaLimit(missions.seaLimit());
    // Objective hints.
    if (missions.active) {
      game.objective = missions.objectiveText();
    } else if (couriers.active) {
      game.objective = couriers.objectiveText();
    } else if (game.driving) {
      game.objective = 'Driving the ' + game.driving.type + ' — E to get out';
    } else if (game.wanted > 0) {
      game.objective = 'WANTED — lose the police! Lay low to cool off';
    } else if (nearShop()) {
      game.objective = 'Rimba Market — press E to open the shop';
    } else {
      const near = traffic.nearestEnterable(player.state.x, player.state.z, 5);
      game.objective = near
        ? 'Press E to ride the ' + near.type
        : 'Explore Teluk Rimba — WASD to walk, drag mouse for camera';
    }
    game.place = placeNameAt(city, player.state.x, player.state.z);
  } else if (input.takeActions() & ACTION_CONFIRM) {
    startGame();
  }
  hud.update(dt, {
    money: game.money,
    coins: coins.count(),
    timeHours: game.timeHours,
    wanted: game.wanted,
    speedKmh: game.speedKmh,
    objective: game.objective,
    place: game.place,
  });
  // Full-map markers (M key): mission/board target, the shop, coins found.
  hud.setMapMarkers(mapMarkers());
  hud.drawMinimap(player.state, game.timeHours, couriers.active ? couriers.marker() : missions.marker());
}

// Markers for the full-screen map (Phase E2): current objective, shop,
// and every coin already found (unfound coins stay hidden).
function mapMarkers() {
  const markers = [];
  const m = couriers.active ? couriers.marker() : missions.marker();
  if (m) markers.push({ x: m.x, z: m.z, color: m.board ? '#4ade80' : '#ffd23f', shape: 'diamond' });
  markers.push({ x: SHOP_POS.x, z: SHOP_POS.z, color: '#fb923c', shape: 'dollar' });
  for (const id of coins.collected) {
    const c = COIN_SPOTS.find((s) => s.id === id);
    if (c) markers.push({ x: c.x, z: c.z, color: '#ffd23f', shape: 'dot' });
  }
  return markers;
}

// ---- headless fast-sim (tests only): no WebGL, fixed ticks, autopilot ----
// The autopilot walks the player along a loop of road nodes, so the sim
// proves movement + collision + the clock without drawing anything. Traffic,
// peds and the wanted system tick alongside.
function runSim() {
  const loop = [[0, -400], [400, -400], [400, 400], [-400, 400], [-400, -400], [0, -400]];
  let target = 0;
  let steps = 0, blocked = 0;
  const fakeInput = {
    forward: false, back: false, left: false, right: false, run: true,
    takeActions: () => 0, takeDrag: () => ({ dx: 0, dy: 0 }), takeWheel: () => 0,
  };
  game.started = true;
  for (let t = 0; t < 1200; t++) {
    const [tx, tz] = loop[target];
    const dx = tx - player.state.x, dz = tz - player.state.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 6) { target = (target + 1) % loop.length; continue; }
    // Steer the camera yaw so "forward" points at the target.
    player.state.camYaw = Math.atan2(-dx, -dz);
    fakeInput.forward = true;
    const bx = player.state.x, bz = player.state.z;
    player.step(fakeInput, STEP);
    if (Math.hypot(player.state.x - bx, player.state.z - bz) < 0.001) blocked++;
    traffic.step(STEP);
    peds.step(STEP, { x: player.state.x, z: player.state.z });
    wanted.step(STEP, { x: player.state.x, z: player.state.z, speedKmh: 0 });
    game.elapsed += STEP;
    game.timeHours = (game.timeHours + (STEP * 24) / DAY_LENGTH) % 24;
    weather.step(STEP, game.timeHours);
    steps++;
  }
  window.__SIM_DONE__ = {
    steps, blocked,
    player: { x: +player.state.x.toFixed(1), z: +player.state.z.toFixed(1) },
    timeHours: +game.timeHours.toFixed(2),
    connected: window.__CITY_STATS__.connected,
    buildings: window.__CITY_STATS__.buildings,
    traffic: traffic.counts(),
    peds: peds.count(),
    wanted: wanted.state.wanted,
    police: wanted.state.police.length,
    weather: weather.state.mode,
  };
  document.title = 'SIM DONE steps=' + steps + ' blocked=' + blocked;
  return window.__SIM_DONE__;
}

if (params.sim) {
  // No renderer at all: pure logic, fast.
  const result = runSim();
  console.log('[sim]', JSON.stringify(result));
} else {
  const renderer = createRenderer(canvas, city);
  // Activity props (coffee tables, benches): one static mesh from the same
  // spot lists the activity NPCs sit at. The player is drawn per-part from
  // buildDynamics (player.partMatrices), not as a static mesh.
  const activityPropsMesh = renderer.makePlayerMesh(peds.activityPropsGeom());
  const landmarks = renderer.landmarks;
  const plotDressing = renderer.plotDressing; // yard fountain spots (animated water)
  let last = performance.now();
  let acc = 0;
  let frames = 0, fpsTime = 0, fps = 0;
  let shotReady = false;

  // River polyline arc lengths (for the flow streaks): point at arc length s.
  const riverSegs = [];
  let riverTotal = 0;
  for (let k = 0; k < RIVER_POINTS.length - 1; k++) {
    const [x0, z0] = RIVER_POINTS[k], [x1, z1] = RIVER_POINTS[k + 1];
    const len = Math.hypot(x1 - x0, z1 - z0);
    riverSegs.push({ x0, z0, dx: (x1 - x0) / len, dz: (z1 - z0) / len, len, start: riverTotal });
    riverTotal += len;
  }
  const riverPointAt = (s) => {
    s = ((s % riverTotal) + riverTotal) % riverTotal;
    for (const seg of riverSegs) {
      if (s <= seg.start + seg.len) {
        const t = s - seg.start;
        return { x: seg.x0 + seg.dx * t, z: seg.z0 + seg.dz * t, dx: seg.dx, dz: seg.dz };
      }
    }
    const lastSeg = riverSegs[riverSegs.length - 1];
    return { x: lastSeg.x0 + lastSeg.dx * lastSeg.len, z: lastSeg.z0 + lastSeg.dz * lastSeg.len, dx: lastSeg.dx, dz: lastSeg.dz };
  };

  function cameraForFrame() {
    if (params.camPos) {
      return { eye: params.camPos, center: params.camLook || [0, 0, 0] };
    }
    if (params.cam === 'aerial') {
      return { eye: [0, 680, 430], center: [0, 0, -20] };
    }
    if (params.cam === 'street') {
      const p = player.state;
      return {
        eye: [p.x + 6, p.y + 3.2, p.z + 8],
        center: [p.x, p.y + 1.5, p.z],
      };
    }
    return player.camera();
  }

  function buildDynamics() {
    const dyn = {};
    // Cull around the RENDER camera, not the player: in normal play the
    // camera follows the player so this is identical, but in shot/test
    // mode the camera can be hundreds of metres from the player (pier,
    // plaza) and the NPCs/vehicles near the lens must still render —
    // culling by player position made them vanish from every far shot.
    const cam = cameraForFrame();
    const camX = cam.eye[0], camZ = cam.eye[2];
    // Detail toggle (settings menu): Low halves the draw distance.
    const cull = settings && settings.detail === 'low' ? 90 : CULL_DIST;
    const veh = traffic.matricesFor(camX, camZ, cull);
    for (const [type, spec] of Object.entries(veh)) {
      dyn['veh_' + type] = spec;
      // Glass uses the same instances, but always tinted white: the
      // sky-blue glass colour must not be multiplied by the body colour.
      dyn['vehglass_' + type] = { matrices: spec.matrices, tints: spec.matrices.map(() => [1, 1, 1]) };
    }
    const ped = peds.matricesFor(camX, camZ, cull);
    dyn.ped_torso = ped.torso;
    dyn.ped_armL = ped.armL;
    dyn.ped_armR = ped.armR;
    dyn.ped_hands = ped.hands;
    dyn.ped_legsL = ped.legL;
    dyn.ped_legsR = ped.legR;
    dyn.ped_skirt = ped.skirt;
    dyn.ped_heads = ped.heads;
    dyn.ped_hairS = ped.hairS;
    dyn.ped_hairL = ped.hairL;
    dyn.ped_badge = ped.badge;
    dyn.ped_rod = ped.rod;
    // The player (Wowok): the same humanoid base model, animated per part
    // — arms/legs swing on foot, SEATED with hands on the wheel while
    // driving (partMatrices takes game.driving).
    {
      const pp = player.partMatrices(game.driving);
      dyn.player_torso = pp.torso;
      dyn.player_armL = pp.armL;
      dyn.player_armR = pp.armR;
      dyn.player_hands = pp.hands;
      dyn.player_legsL = pp.legL;
      dyn.player_legsR = pp.legR;
      dyn.player_head = pp.head;
      dyn.player_hair = pp.hair;
    }
    // Phase E2: hidden coins (spinning gold discs) + stunt ramps (wedges).
    dyn.coins = coins.matrices(game.elapsed);
    dyn.ramps = stunts.matrices();
    // Wheels (shared unit-wheel mesh: spin + steer) and the bike steering
    // assemblies, refilled every frame from the traffic state.
    dyn.wheels = traffic.wheelMatricesFor(camX, camZ, cull);
    dyn.wheelsFar = traffic.wheelMatricesFarFor(camX, camZ, cull); // far cars: low-poly wheels
    dyn.bikeFront = traffic.bikeFrontMatricesFor(camX, camZ, cull);
    // Headlights at night: two dots at the front of each moving car,
    // plus a soft beam pool on the road ahead (Mu: all vehicle lights on),
    // a fading transparent beam cone, and taillights that flare when the
    // vehicle brakes. Bikes get one centre headlight + one taillight
    // (bike-lights mesh, day and night — see below).
    const isNight = game.timeHours < 6 || game.timeHours >= 18;
    if (isNight) {
      const hl = { matrices: [], tints: [] };
      const hb = { matrices: [], tints: [] };
      const bc = { matrices: [], tints: [] };
      const tl = { matrices: [], tints: [] };
      for (const v of traffic.vehicles) {
        if (v.parked || v.speed < 0.5) continue;
        if (v.type === 'boat' || v.type === 'fishingboat' || v.type === 'sailboat') continue;
        const d = Math.hypot(v.x - camX, v.z - camZ);
        if (d > cull) continue;
        const tune = VEHICLES[v.type];
        const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
        const rx = Math.cos(v.heading), rz = -Math.sin(v.heading);
        const isBike = v.type === 'motorbike' || v.type === 'scooter' || v.type === 'bajaj';
        if (!isBike) {
          for (const side of [-1, 1]) {
            // Lens sits PROUD of the fascia (+0.06 past the nose) at the
            // lamp height (0.72), so the solid fascia never buries it —
            // the lens must read as clearly ON at night.
            const hx = v.x + fx * (tune.len / 2 + 0.06) + rx * side * (tune.w / 2 - 0.3);
            const hz = v.z + fz * (tune.len / 2 + 0.06) + rz * side * (tune.w / 2 - 0.3);
            hl.matrices.push(mat4TRS(hx, v.y + 0.72, hz, v.heading, 1, 1, 1));
            hl.tints.push([1.3, 1.2, 0.9]);
          }
          // Taillights: dim red at night, bright red when braking.
          for (const side of [-1, 1]) {
            const tx = v.x - fx * (tune.len / 2 + 0.03) + rx * side * (tune.w / 2 - 0.42);
            const tz = v.z - fz * (tune.len / 2 + 0.03) + rz * side * (tune.w / 2 - 0.42);
            tl.matrices.push(mat4TRS(tx, v.y + 0.72, tz, v.heading, 1, 1, 1));
            tl.tints.push(v.braking ? [1, 0.08, 0.08] : [0.45, 0.05, 0.05]);
          }
        }
        // Beam pool (the bright patch on the asphalt) + fading cone.
        const beamLen = isBike ? 9 : 12, beamW = isBike ? 1.0 : 2.4;
        hb.matrices.push(mat4TRS(
          v.x + fx * (tune.len / 2 + beamLen / 2), 0.13, v.z + fz * (tune.len / 2 + beamLen / 2),
          v.heading, beamW, 1, beamLen));
        hb.tints.push([1, 0.93, 0.75]);
        const coneLen = isBike ? 12 : 15;
        bc.matrices.push(mat4TRS(
          v.x + fx * (tune.len / 2), v.y + 0.65, v.z + fz * (tune.len / 2),
          v.heading - Math.PI / 2, coneLen / 15, isBike ? 0.7 : 1, isBike ? 0.7 : 1));
        bc.tints.push([1, 1, 1]);
      }
      // Boat lamps: one warm dot above each boat, so boats read against
      // the dark sea at night (a dark-blue boat on dark-blue water was
      // nearly invisible).
      for (const b of traffic.boats) {
        const d = Math.hypot(b.x - camX, b.z - camZ);
        if (d > cull) continue;
        hl.matrices.push(mat4TRS(b.x, b.y + 2.0, b.z, 0, 1, 1, 1));
        hl.tints.push([1, 0.85, 0.55]);
      }
      dyn.headlights = hl;
      dyn.headbeams = hb;
      if (bc.matrices.length) dyn.beamcones = bc;
      if (tl.matrices.length) dyn.taillights = tl;
      // Police beacons: red/blue flash, ONLY while a pursuit (siren) is
      // active — the static roof bar stays dark otherwise.
      if (wanted.state.police.length > 0) {
        const ph = Math.floor(game.elapsed * 4) % 2;
        const bn = { matrices: [], tints: [] };
        for (const v of wanted.state.police) {
          const d = Math.hypot(v.x - camX, v.z - camZ);
          if (d > cull) continue;
          const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
          bn.matrices.push(mat4TRS(v.x - fx * 0.28, v.y + 1.82, v.z - fz * 0.28, v.heading, 1, 1, 1));
          bn.tints.push(ph === 0 ? [1, 0.08, 0.08] : [0.1, 0.1, 0.3]);
          bn.matrices.push(mat4TRS(v.x + fx * 0.28, v.y + 1.82, v.z + fz * 0.28, v.heading, 1, 1, 1));
          bn.tints.push(ph === 0 ? [0.1, 0.1, 0.3] : [0.15, 0.3, 1]);
        }
        if (bn.matrices.length) dyn.beacons = bn;
      }
      // Player headlight spotlight (the one real light in the scene):
      // position + direction for the lit shader, player vehicle only.
      if (game.driving) {
        const v = game.driving;
        const isBoat = v.type === 'boat' || v.type === 'fishingboat' || v.type === 'sailboat';
        if (!isBoat) {
          const tune = VEHICLES[v.type];
          const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
          dyn.playerSpot = {
            pos: [v.x + fx * (tune.len / 2), v.y + 0.7, v.z + fz * (tune.len / 2)],
            dir: [fx, -0.15, fz],
            color: [1.0, 0.88, 0.66],
            on: 1,
          };
        }
      }
      // Lighthouse beam sweeps the sea at night.
      const beamAngle = game.elapsed * 0.5;
      dyn.beam = {
        matrices: [mat4TRS(landmarks.lighthouse.x, landmarks.lighthouse.lampY, landmarks.lighthouse.z, beamAngle, 1, 1, 1)],
        tints: [[1, 0.95, 0.75]],
      };
    }
    // Bike lights, day and night: one centre headlight (dim by day,
    // bright at night) and a small taillight at night (bright when
    // braking). Parked bikes stay dark.
    {
      const bl = { matrices: [], tints: [] };
      for (const v of traffic.vehicles) {
        if (v.type !== 'motorbike' && v.type !== 'scooter' && v.type !== 'bajaj') continue;
        if (v.parked) continue;
        const d = Math.hypot(v.x - camX, v.z - camZ);
        if (d > cull) continue;
        const tune = VEHICLES[v.type];
        const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
        bl.matrices.push(mat4TRS(v.x + fx * (tune.len / 2 + 0.06), v.y + 0.95, v.z + fz * (tune.len / 2 + 0.06), v.heading, 1, 1, 1));
        bl.tints.push(isNight ? [1.3, 1.2, 0.9] : [0.4, 0.38, 0.3]);
        if (isNight && v.speed >= 0.5) {
          bl.matrices.push(mat4TRS(v.x - fx * (tune.len / 2 + 0.02), v.y + 0.7, v.z - fz * (tune.len / 2 + 0.02), v.heading, 1.2, 0.8, 0.7));
          bl.tints.push(v.braking ? [1, 0.08, 0.08] : [0.45, 0.05, 0.05]);
        }
      }
      if (bl.matrices.length) dyn.bikelights = bl;
    }
    // River flow streaks + beach wave lines (light animation, always on).
    // Mu (river cleanup): the river read as a flat blue sheet — the old
    // streaks were tiny (0.5 x 3.2 m, 36 of them). Now 72 longer/wider
    // streaks + 8 broad current patches drifting downstream, same
    // treatment as the lively sea.
    {
      const fl = { matrices: [], tints: [] };
      for (let k = 0; k < 72; k++) {
        const base = (k * 27.3) % riverTotal;
        const drift = (game.elapsed * 2.5 + k * 8.7) % 120;
        const pt = riverPointAt(base + drift);
        if (Math.hypot(pt.x - camX, pt.z - camZ) > cull + 60) continue;
        fl.matrices.push(mat4TRS(pt.x, -0.7, pt.z, Math.atan2(pt.dx, pt.dz), 1.2, 1, 8));
        fl.tints.push([0.9, 0.97, 1]);
      }
      // Broad current patches: lighter-blue drift areas, 6-10 m wide,
      // 30-60 m long, spread along the river — read even at a grazing
      // angle, where thin streaks collapse to a line.
      for (let k = 0; k < 8; k++) {
        const base = (k * 173.1) % riverTotal;
        const drift = (game.elapsed * 2.5 + k * 31.7) % 240;
        const pt = riverPointAt(base + drift);
        if (Math.hypot(pt.x - camX, pt.z - camZ) > cull + 60) continue;
        const pw = 6 + ((k * 7) % 5);
        const pl = 30 + ((k * 13) % 31);
        fl.matrices.push(mat4TRS(pt.x, -0.72, pt.z, Math.atan2(pt.dx, pt.dz), pw, 1, pl));
        fl.tints.push([0.62, 0.8, 0.95]);
      }
      for (let k = 0; k < 6; k++) {
        const wx = 632 + k * 8 + 5 * Math.sin(game.elapsed * 0.35 + k * 1.7);
        fl.matrices.push(mat4TRS(wx, -0.7, 0, 0, 2.5, 1, 1400));
        fl.tints.push([0.95, 0.98, 1]);
      }
      // Yard fountains (Phase I): shimmering water discs in the basins.
      // Same 'flow' dynamic mesh, no new draw call; only fountains near
      // the camera shimmer, so instances stay far under the 96 capacity
      // (42 river/wave + <=24 fountains).
      if (plotDressing && plotDressing.fountainSpots) {
        for (let k = 0; k < plotDressing.fountainSpots.length; k++) {
          const f = plotDressing.fountainSpots[k];
          if (Math.hypot(f.x - camX, f.z - camZ) > 200) continue;
          const pulse = 1 + 0.05 * Math.sin(game.elapsed * 1.5 + k * 1.3);
          fl.matrices.push(mat4TRS(f.x, 0.48, f.z, k * 0.7, 2.0 * pulse, 1, 2.0 * pulse));
          fl.tints.push([0.8, 0.92, 1]);
        }
      }
      // Sea ripples: long pale bands drifting slowly toward the shore.
      // Own mesh ('sea', alpha 0.45) so they read clearly against the
      // blue water. Far bands cover the open sea; near-shore bands sit
      // in [620, 900] so several are always in the bay view.
      // Swell patches (drawn first, bands over them): broad lighter-blue
      // areas drifting slowly across the sea — gentle swell that reads
      // even at a grazing angle, where thin bands collapse to a line.
      const sr = { matrices: [], tints: [] };
      for (let k = 0; k < 8; k++) {
        const px = 600 + ((k * 337 + game.elapsed * 2) % 1500);
        const pz = -700 + ((k * 251) % 1400);
        const plen = 150 + ((k * 53) % 150);
        const pwdt = 15 + ((k * 11) % 10);
        sr.matrices.push(mat4TRS(px, -1.08, pz, 0, pwdt, 1, plen));
        sr.tints.push([0.35, 0.6, 0.8]);
      }
      for (let k = 0; k < 36; k++) {
        const x = 2100 - ((game.elapsed * 3 + k * 47) % 1480);
        const z = -850 + ((k * 173) % 1700);
        const len = 40 + ((k * 37) % 50);
        const wdt = 5 + ((k * 13) % 10) / 10 * 2; // 5-7 m wide
        sr.matrices.push(mat4TRS(x, -1.05, z, 0, wdt, 1, len));
        sr.tints.push([0.92, 0.97, 1]);
      }
      for (let k = 0; k < 40; k++) {
        const nx = 900 - ((game.elapsed * 3 + k * 37) % 280);
        const nz = -600 + ((k * 211) % 1200);
        const nlen = 60 + ((k * 29) % 40);
        const nwdt = 6 + ((k * 7) % 10) / 10 * 2; // 6-8 m wide
        sr.matrices.push(mat4TRS(nx, -1.05, nz, 0, nwdt, 1, nlen));
        sr.tints.push([0.94, 0.98, 1]);
      }
      dyn.sea = sr;
      dyn.flow = fl;
    }
    // Rain streaks around the camera.
    if (weather.state.rain > 0.05) {
      dyn.rain = weather.rainMatrices(camX, camZ);
    }
    // Aircraft: police helicopter (+ spinning rotor, night spotlight cone)
    // and the daytime plane.
    {
      const air = aircraft.matricesFor(camX, camZ, !isNight, game.elapsed);
      for (const [name, spec] of Object.entries(air)) {
        if (spec.matrices.length) dyn[name] = spec;
      }
    }
    // Mission marker: a tall bright column at the current objective
    // (yellow) or at the mission board (green, no mission active).
    // A courier job's target wins over the board marker while active.
    {
      const m = couriers.active ? couriers.marker() : missions.marker();
      if (m) {
        const pulse = 1 + 0.08 * Math.sin(game.elapsed * 3);
        dyn.marker = {
          matrices: [mat4TRS(m.x, 15, m.z, 0, pulse, 1, pulse)],
          tints: [m.board ? [0.3, 0.9, 0.5] : [1, 0.85, 0.2]],
        };
      }
    }
    return dyn;
  }

  function frame(now) {
    requestAnimationFrame(frame);
    let dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    // In shots mode, ?timeScale=N (?ff=N) runs the whole simulation N times
    // faster than real time (clock, timers, traffic, autopilot) so mission
    // play-tests finish in minutes instead of game-hours.
    acc += dt * (testMode ? params.timeScale : 1);
    while (acc >= STEP) { stepWorld(STEP); acc -= STEP; }
    const cam = cameraForFrame();
    renderer.render({
      eye: cam.eye, center: cam.center,
      timeHours: game.timeHours, activityPropsMesh,
      elapsed: game.elapsed, dynamics: buildDynamics(), weather: weather.state,
    });
    frames++;
    fpsTime += dt;
    if (audioDebugEl) {
      audioDebugT += dt;
      if (audioDebugT > 0.25) {
        audioDebugT = 0;
        const d = audio.debugStats();
        audioDebugEl.textContent = 'AUDIO ctx=' + d.ctxState + ' active=' + d.active
          + ' dropped=' + d.dropped + ' area=' + d.area + ' ' + d.mode + '\n'
          + JSON.stringify(d.counts);
      }
    }
    if (fpsTime >= 0.5) {
      fps = frames / fpsTime;
      frames = 0; fpsTime = 0;
      window.__PERF__ = {
        fps: Math.round(fps),
        calls: renderer.calls,
        tris: renderer.tris,
        timeHours: +game.timeHours.toFixed(2),
        weather: weather.state.mode,
        wanted: game.wanted,
        peds: peds.count(),
        vehicles: traffic.counts().total,
      };
    }
    if (!shotReady) {
      shotReady = true;
      setTimeout(() => { window.__shotReady = true; }, 400);
    }
  }
  window.__PERF__ = { fps: 0, calls: 0, tris: 0, timeHours: game.timeHours };
  // Live ped introspection for the NPC report (Mu: per-zone counts +
  // behaviour mix from live state): read-only, same pattern as __PERF__.
  window.__PEDS__ = {
    count: () => peds.count(),
    zoneCounts: () => peds.zoneCounts(),
    stateMix: () => peds.stateMix(),
    activityMix: () => peds.activityMix(),
  };
  // Test-only manual stepping (?shot / ?mission / ?autopilot / ?sim):
  // advance the simulation N fixed steps and re-render once, so probes
  // can move the world deterministically even when headless rAF is
  // throttled to ~0.4 fps and the sim never advances on its own
  // (elapsed stays 0 between BeginFrames). Never used in normal play
  // (testMode is false there); same family as __PERF__ / __PEDS__.
  if (testMode) {
    window.__STEP__ = (steps = 60) => {
      for (let i = 0; i < steps; i++) stepWorld(STEP);
      const cam = cameraForFrame();
      renderer.render({
        eye: cam.eye, center: cam.center,
        timeHours: game.timeHours, activityPropsMesh,
        elapsed: game.elapsed, dynamics: buildDynamics(), weather: weather.state,
      });
      // Headless rAF can stall completely (0 frames in 110 s observed),
      // so a manual step also publishes the perf counters — otherwise
      // the draw-call probe has nothing to read. Test-only.
      window.__PERF__ = {
        fps: 0, calls: renderer.calls, tris: renderer.tris,
        timeHours: +game.timeHours.toFixed(2),
        peds: peds.count(), vehicles: traffic.counts().total,
      };
      return { elapsed: +game.elapsed.toFixed(2), timeHours: +game.timeHours.toFixed(2) };
    };
  }
  // Test-only sound counter (?audiodebug=1): which sounds fired + how many
  // voices are live. Audio cannot be heard headless, so the counter is the
  // check. Never shown in normal play.
  let audioDebugEl = null;
  let audioDebugT = 0;
  if (params.audiodebug) {
    audioDebugEl = document.createElement('div');
    audioDebugEl.id = 'audio-debug';
    audioDebugEl.style.cssText = 'position:fixed;left:12px;top:120px;z-index:25;background:rgba(0,0,0,.65);color:#8f8;font:11px monospace;padding:8px 10px;border-radius:6px;white-space:pre;pointer-events:none;';
    document.body.appendChild(audioDebugEl);
  }
  requestAnimationFrame(frame);
}
