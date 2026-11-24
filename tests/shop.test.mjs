// Teluk Rimba — shop / coins / stunts / courier checks (Node, no browser).
// Drives the Phase E2 extras modules with mock contexts (positions set
// directly — the browser play-tests prove real driving separately).
// Run: node tests/shop.test.mjs
import { generateCity, buildingAABBs, ROAD_LINES } from '../game/src/city.js';
import {
  SHOP_ITEMS, itemById, createShop, createShopUI,
  COIN_SPOTS, COIN_REWARD, createCoins,
  RAMPS, RAMP_LEN, RAMP_H, STUNT_REWARD, STUNT_MIN_SPEED, wedgeGeom, createStunts,
  COURIER_JOBS, courierById, createCouriers,
} from '../game/src/extras.js';
import { saveGame, loadGame, clearSave } from '../game/src/save.js';
import { createTraffic } from '../game/src/vehicles.js';
import { createPeds } from '../game/src/peds.js';
import { createWanted } from '../game/src/police.js';
import { createMissions, MISSION_BOARD } from '../game/src/missions.js';
import { ACTION_ENTER } from '../game/src/input.js';

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
const aabbs = buildingAABBs(city);

function mockGame(money = 0) {
  return { money, driving: null, elapsed: 0, started: true, wanted: 0 };
}
function mockHud() {
  return { hints: [], showHint(t) { this.hints.push(t); } };
}
function mockWanted(level = 0) {
  return {
    state: { wanted: level, heat: level },
    reduceHeat(n) { this.state.heat = Math.max(0, this.state.heat - n); this.state.wanted = Math.ceil(this.state.heat); },
  };
}
function freshShop(money = 500, rankDone = 0) {
  const game = mockGame(money);
  const shop = createShop({
    game, hud: mockHud(), audio: null, wanted: mockWanted(0),
    onSave: () => {}, rank: () => rankDone,
  });
  return { game, shop };
}

// --- shop catalog ---
check('shop has 6 items', SHOP_ITEMS.length === 6, `${SHOP_ITEMS.length}`);
check('every shop item has a price > 0 and rank 0-2',
  SHOP_ITEMS.every((i) => i.price > 0 && i.rank >= 0 && i.rank <= 2));
check('every shop item has an English name + description',
  SHOP_ITEMS.every((i) => /^[A-Za-z0-9 +()-]+$/.test(i.name) && i.desc.length > 5));
check('shop covers weapon, ammo, medkit, armor, drink, repair',
  ['weapon', 'ammo', 'medkit', 'armor', 'drink', 'repair'].every((k) => SHOP_ITEMS.some((i) => i.kind === k)));
check('createShopUI is a no-op in Node (no document)', createShopUI(freshShop().shop, mockGame()) === null);

// --- buying ---
{
  const { game, shop } = freshShop(300, 0);
  const r = shop.buy('pistol');
  check('buy pistol with $300 succeeds', r.ok && game.money === 50, `money $${game.money}`);
  check('pistol owned with 12 rounds', shop.state.pistol && shop.state.ammo === 12, `${shop.state.ammo} rounds`);
}
{
  const { game, shop } = freshShop(400, 0);
  const r = shop.buy('ammo');
  check('ammo without pistol is refused', !r.ok && game.money === 400, r.reason);
  shop.buy('pistol');
  const r2 = shop.buy('ammo');
  check('ammo with pistol refills +24', r2.ok && shop.state.ammo === 36, `${shop.state.ammo} rounds`);
}
{
  const { game, shop } = freshShop(50, 0);
  const r = shop.buy('pistol');
  check('buying without enough money fails, money unchanged', !r.ok && game.money === 50, r.reason);
}
{
  const { game, shop } = freshShop(500, 0);
  const r = shop.buy('armor');
  check('armor (rank 2) locked at rank 0', !r.ok && game.money === 500, r.reason);
  const { game: g2, shop: s2 } = freshShop(500, 2);
  check('armor (rank 2) buys at rank 2', s2.buy('armor').ok && g2.money === 350, `$${g2.money}`);
}
{
  const { game, shop } = freshShop(500, 1);
  check('medkit (rank 1) buys at rank 1', shop.buy('medkit').ok && shop.state.medkits === 1);
  check('repair without a vehicle is refused', !shop.buy('repair').ok, 'not driving');
  game.driving = { condition: 40, warned: true };
  const r = shop.buy('repair');
  check('repair fixes a damaged vehicle to 100', r.ok && game.driving.condition === 100 && game.money === 320, `$${game.money}`);
  check('repair on a full-condition vehicle is refused', !shop.buy('repair').ok);
}
{
  const { game, shop } = freshShop(500, 0);
  check('fire without pistol is noweapon', shop.fire() === 'noweapon');
  shop.buy('pistol');
  shop.state.ammo = 0;
  check('fire with no ammo is empty', shop.fire() === 'empty');
  shop.state.ammo = 5;
  check('fire spends one round', shop.fire() === 'fired' && shop.state.ammo === 4);
}
{
  const { game, shop } = freshShop(500, 2);
  shop.buy('armor');
  check('busted fine is halved with armor', shop.bustedFine(100) === 50 && shop.state.armor === 0);
  check('busted fine is full without armor', shop.bustedFine(100) === 100);
}
{
  const game = mockGame(500);
  game.health = 40;
  const wanted = mockWanted(2);
  const shop = createShop({ game, hud: mockHud(), audio: null, wanted, onSave: () => {}, rank: () => 1 });
  shop.buy('medkit');
  check('medkit use restores 50 health and consumes one', shop.useMedkit() && game.health === 90 && shop.state.medkits === 0, `health ${game.health}`);
  check('medkit does not touch the wanted level', wanted.state.wanted === 2);
  shop.buy('medkit');
  game.health = 100;
  check('medkit at full health is refused', !shop.useMedkit() && shop.state.medkits === 1);
  game.health = 80;
  check('medkit caps health at 100', shop.useMedkit() && game.health === 100 && shop.state.medkits === 0, `health ${game.health}`);
  const g2 = mockGame(500);
  g2.health = 30;
  const s2 = createShop({ game: g2, hud: mockHud(), audio: null, wanted: mockWanted(0), onSave: () => {}, rank: () => 1 });
  check('medkit with none left is refused', !s2.useMedkit());
}
{
  const game = mockGame(500);
  const shop = createShop({ game, hud: mockHud(), audio: null, wanted: mockWanted(0), onSave: () => {}, rank: () => 0 });
  shop.buy('drink');
  check('energy drink starts a 30 s boost', shop.useDrink(100) && shop.isBoosted(115) && !shop.isBoosted(131));
}

// --- coins ---
check('12 hidden coins', COIN_SPOTS.length === 12, `${COIN_SPOTS.length}`);
check('coin spots are all distinct',
  new Set(COIN_SPOTS.map((c) => c.x + ',' + c.z)).size === 12);
{
  const bad = COIN_SPOTS.filter((c) => aabbs.some((a) => c.x > a.x0 && c.x < a.x1 && c.z > a.z0 && c.z < a.z1));
  check('no coin sits inside a building', bad.length === 0, bad.map((c) => c.id).join(','));
}
{
  const game = mockGame(0);
  const player = { state: { x: 0, z: 0, y: 0 } };
  const coins = createCoins({ game, player, hud: mockHud(), audio: null, onSave: () => {} });
  player.state.x = 51; player.state.z = -51;
  coins.step();
  check('coin collected on foot (+$25)', coins.count().found === 1 && game.money === COIN_REWARD, `$${game.money}`);
  coins.step();
  check('same coin does not re-collect', coins.count().found === 1 && game.money === COIN_REWARD);
  player.state.x = 620; player.state.z = -100;
  game.driving = { type: 'car' };
  coins.step();
  check('no collection while driving', coins.count().found === 1);
  game.driving = null;
  coins.step();
  check('second coin collects on foot', coins.count().found === 2);
}
{
  const game = mockGame(0);
  const player = { state: { x: 51, z: -51, y: 0 } };
  const coins = createCoins({ game, player, hud: mockHud(), audio: null, onSave: () => {} });
  coins.step();
  player.state.x = 620; player.state.z = -100;
  coins.step();
  const saved = coins.saveState();
  const coins2 = createCoins({ game, player, hud: mockHud(), audio: null, onSave: () => {} });
  coins2.restore(saved);
  check('coins restore from save', coins2.count().found === 2);
}

// --- stunts ---
check('4 stunt ramps', RAMPS.length === 4, `${RAMPS.length}`);
{
  // Each ramp has a 40 m straight run-up along a road line.
  let ok = true, detail = '';
  for (const r of RAMPS) {
    const fx = Math.sin(r.heading), fz = Math.cos(r.heading);
    for (let t = 4; t <= 40; t += 4) {
      const x = r.x - fx * t, z = r.z - fz * t;
      const onRoad = ROAD_LINES.some((L) => Math.abs(x - L) < 1 || Math.abs(z - L) < 1);
      if (!onRoad) { ok = false; detail = `ramp ${r.id} at t=${t}`; }
    }
  }
  check('every ramp has a 40 m straight run-up on a road', ok, detail);
}
{
  const g = wedgeGeom();
  check('wedge geometry has triangles', g.pos.length > 0 && g.pos.length % 9 === 0, `${g.pos.length / 9} tris`);
}
{
  const game = mockGame(0);
  const stunts = createStunts({ game, hud: mockHud(), audio: null, onSave: () => {} });
  check('ramp height is 0 off the ramp', stunts.rampHeightAt(50, 200) === 0);
  check('ramp height is 0.75 mid-slope', Math.abs(stunts.rampHeightAt(0, 200) - 0.75) < 0.01);
  check('ramp height is 1.5 at the lip', Math.abs(stunts.rampHeightAt(0, 203) - RAMP_H) < 0.01);
  // Fast hit at the lip launches and completes on landing (+$50).
  const v = { x: 0, z: 202.6, speed: 14 };
  const h0 = stunts.step(1 / 60, v);
  check('fast hit at the lip launches', h0 > 0, `h=${h0.toFixed(2)}`);
  let landed = false;
  for (let i = 0; i < 120; i++) {
    const h = stunts.step(1 / 60, v);
    if (i > 5 && h === 0) { landed = true; break; }
  }
  check('stunt completes on landing (+$50)', landed && game.money === STUNT_REWARD && stunts.completed.has(1), `$${game.money}`);
  // Same ramp cannot pay twice.
  const v2 = { x: 0, z: 202.6, speed: 14 };
  stunts.step(1 / 60, v2);
  for (let i = 0; i < 120; i++) stunts.step(1 / 60, v2);
  check('a ramp pays only once', game.money === STUNT_REWARD, `$${game.money}`);
}
{
  const game = mockGame(0);
  const stunts = createStunts({ game, hud: mockHud(), audio: null, onSave: () => {} });
  const v = { x: 0, z: 202.6, speed: 8 }; // below the 12 m/s launch speed
  let launched = false;
  for (let i = 0; i < 120; i++) {
    const h = stunts.step(1 / 60, v);
    if (h > RAMP_H) launched = true;
  }
  check('slow hit does not launch', !launched && game.money === 0 && !stunts.completed.has(1));
}

// --- couriers ---
// Board hook: the mission board hands out courier jobs once the story is done.
{
  const city = generateCity();
  const traffic = createTraffic(city);
  const peds = createPeds(city);
  const wanted = createWanted(city, traffic, peds);
  const game = { money: 0, timeHours: 10, started: true, driving: null, wanted: 0 };
  const player = { state: { x: MISSION_BOARD.x, z: MISSION_BOARD.z, y: 0, camYaw: 0, camPitch: 0.32, camDist: 7.5, facing: 0 } };
  const hud = { hints: [], showHint(t) { this.hints.push(t); } };
  const couriers = createCouriers({ game, player, hud, audio: null, onSave: () => {} });
  const missions = createMissions({ city, game, player, traffic, peds, wanted, hud, audio: null, onSave: () => {}, couriers });
  // With a story mission still left, E at the board offers the story job.
  missions.step(1 / 60, ACTION_ENTER);
  check('board offers story mission while one remains', missions.active && !couriers.active, `mission ${missions.state.id}`);
  missions.fail('test reset');
  // With all 6 done, E at the board starts a courier job instead.
  missions.restore({ done: [1, 2, 3, 4, 5, 6] });
  check('all 6 story missions marked done', missions.doneIds().length === 6);
  // Wait out the 10 s board cooldown set by fail() above, then press E.
  for (let i = 0; i < 11 * 60; i++) missions.step(1 / 60);
  missions.step(1 / 60, ACTION_ENTER);
  check('board hands out a courier job after the story', couriers.active && couriers.state.id === 1, couriers.active ? `job ${couriers.state.id}` : 'none');
  // E while driving does not start a job.
  const c2 = createCouriers({ game, player, hud, audio: null, onSave: () => {} });
  const m2 = createMissions({ city, game, player, traffic, peds, wanted, hud, audio: null, onSave: () => {}, couriers: c2 });
  m2.restore({ done: [1, 2, 3, 4, 5, 6] });
  game.driving = { type: 'car' };
  m2.step(1 / 60, ACTION_ENTER);
  check('no courier job while driving past the board', !c2.active);
  game.driving = null;
}
check('3 courier jobs', COURIER_JOBS.length === 3, `${COURIER_JOBS.length}`);
check('courier rewards are 40/50/60', COURIER_JOBS.map((j) => j.reward).join(',') === '40,50,60');
{
  const game = mockGame(0);
  const player = { state: { x: 0, z: 0, y: 0 } };
  const couriers = createCouriers({ game, player, hud: mockHud(), audio: null, onSave: () => {} });
  const job = couriers.nextJob();
  check('first courier job is Harbor Dash', job.id === 1 && job.name === 'Harbor Dash');
  check('courier starts', couriers.start(1) && couriers.active);
  player.state.x = 51; player.state.z = -51;
  couriers.step(1 / 60);
  check('courier pickup advances to delivery', couriers.state.stepIdx === 1);
  player.state.x = 407.5; player.state.z = 407.5;
  couriers.step(1 / 60);
  check('courier completes with reward', !couriers.active && game.money === 40 && couriers.doneCount === 1, `$${game.money}`);
  check('next courier job cycles to Beach Run', couriers.nextJob().id === 2);
}
{
  const game = mockGame(0);
  const player = { state: { x: 0, z: 0, y: 0 } };
  const couriers = createCouriers({ game, player, hud: mockHud(), audio: null, onSave: () => {} });
  couriers.start(2);
  for (let i = 0; i < 150 * 60; i++) couriers.step(1 / 60);
  check('courier fails on timeout', !couriers.active && couriers.state.lastResult.result === 'failed' && game.money === 0);
}
{
  const game = mockGame(0);
  const player = { state: { x: 0, z: 0, y: 0 } };
  const couriers = createCouriers({ game, player, hud: mockHud(), audio: null, onSave: () => {} });
  couriers.start(3);
  const saved = couriers.saveState();
  const c2 = createCouriers({ game, player, hud: mockHud(), audio: null, onSave: () => {} });
  c2.restore(saved);
  check('active courier restores from save', c2.active && c2.state.id === 3);
}

// --- save/load extension ---
{
  clearSave();
  const game = mockGame(500);
  const shop = createShop({ game, hud: mockHud(), audio: null, wanted: mockWanted(0), onSave: () => {}, rank: () => 2 });
  shop.buy('pistol');
  shop.buy('armor');
  const player = { state: { x: 51, z: -51, y: 0 } };
  const coins = createCoins({ game, player, hud: mockHud(), audio: null, onSave: () => {} });
  coins.step();
  const stunts = createStunts({ game, hud: mockHud(), audio: null, onSave: () => {} });
  const v = { x: 0, z: 202.6, speed: 14 };
  stunts.step(1 / 60, v);
  for (let i = 0; i < 120; i++) stunts.step(1 / 60, v);
  saveGame({
    money: game.money, done: [1, 2], active: null,
    shop: shop.saveState(), coins: coins.saveState(), stunts: stunts.saveState(), courier: null,
  });
  const loaded = loadGame();
  check('save/load round-trips the shop', loaded.shop && loaded.shop.pistol && loaded.shop.ammo === 12 && loaded.shop.armor === 1);
  check('save/load round-trips coins + stunts', loaded.coins.length === 1 && loaded.stunts.length === 1);
  const shop2 = createShop({ game: mockGame(0), hud: mockHud(), audio: null, wanted: mockWanted(0), onSave: () => {}, rank: () => 2 });
  shop2.restore(loaded.shop);
  check('shop restores from a loaded save', shop2.state.pistol && shop2.state.ammo === 12);
  clearSave();
}
{
  clearSave();
  saveGame({ money: 100, done: [1], active: null }); // old save, no E2 fields
  const loaded = loadGame();
  check('old saves load with E2 defaults', loaded.shop === null && loaded.coins.length === 0 && loaded.stunts.length === 0 && loaded.courier === null);
  clearSave();
}
{
  clearSave();
  saveGame({ money: 100, done: [1], active: null, health: 37 });
  check('save/load round-trips health', loadGame().health === 37, String(loadGame().health));
  clearSave();
  saveGame({ money: 100, done: [1], active: null }); // old save, no health field
  check('old saves load with health defaulting to 100', loadGame().health === 100, String(loadGame().health));
  clearSave();
  saveGame({ money: 100, done: [1], active: null, health: 250 });
  check('health above 100 is clamped on load', loadGame().health === 100);
  clearSave();
  saveGame({ money: 100, done: [1], active: null, health: -20 });
  check('health below 0 is clamped on load', loadGame().health === 0);
  clearSave();
}

console.log(failures === 0 ? 'ALL SHOP CHECKS PASSED' : failures + ' CHECK(S) FAILED');
process.exit(failures === 0 ? 0 : 1);
