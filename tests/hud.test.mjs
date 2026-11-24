// Neon City HUD checks (Mu 24 Nov 00:14 — option 1, English, GTA-style
// layout, zone-coloured minimap with the real 1,000 building boxes).
// hud.js draws on a DOM canvas, so the test stubs document with a recording
// canvas context (same pattern as signs.test.mjs) and exercises the pure
// helpers + createHud().update() against stub elements.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generateCity, AREA_NAMES } from '../game/src/city.js';
import { neonColor, cssColor, zoneNeonFill, formatDistance, drawCityMap, createHud, healthBarState } from '../game/src/hud.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
let fails = 0;
function check(name, ok, extra = '') {
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' — ' + extra : ''));
  if (!ok) fails++;
}

// --- Recording fake 2D context ---
function makeCtx() {
  const calls = [];
  const ctx = new Proxy({}, {
    get: (_t, k) => {
      if (k === 'canvas') return undefined;
      if (k === 'calls') return calls;
      return (...args) => { calls.push([k, ...args]); };
    },
    set: (_t, k, v) => { calls.push(['set:' + k, v]); return true; },
  });
  return ctx;
}

// --- DOM stubs for createHud ---
function stubEl() {
  const el = {
    style: {},
    textContent: '',
    innerHTML: '',
    width: 130,
    height: 130,
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener() {},
    getContext: () => makeCtx(),
    querySelector: () => stubEl(),
  };
  return el;
}
const els = {};
const createdEls = [];
globalThis.document = {
  getElementById: (id) => (els[id] ||= stubEl()),
  createElement: () => { const el = stubEl(); createdEls.push(el); return el; },
  body: { appendChild() {} },
};

const city = generateCity();
const ZONES = ['downtown', 'commercial', 'residential', 'beach', 'port', 'forest'];

// --- 1. neonColor: pastel in, saturated neon out, channels in [0,1] ---
{
  const out = neonColor([0.96, 0.88, 0.72]); // commercial cream
  check('neonColor keeps channels in [0,1]', out.every((v) => v >= 0 && v <= 1), JSON.stringify(out));
  check('neonColor brightest channel hits 1', Math.max(...out) === 1, JSON.stringify(out));
  check('neonColor saturates (r-b gap grows)', out[0] - out[2] > 0.3, JSON.stringify(out));
  const grey = neonColor([0.5, 0.5, 0.5]);
  check('neonColor leaves grey grey', grey[0] === grey[1] && grey[1] === grey[2], JSON.stringify(grey));
}

// --- 2. zoneNeonFill: one colour per zone, derived from real buildings ---
{
  const fills = {};
  for (const z of ZONES) {
    fills[z] = zoneNeonFill(city, z);
    check('zone ' + z + ' has a neon fill', Array.isArray(fills[z]) && fills[z].length === 3, JSON.stringify(fills[z]));
  }
  let minDist = Infinity;
  for (let i = 0; i < ZONES.length; i++) {
    for (let j = i + 1; j < ZONES.length; j++) {
      const a = fills[ZONES[i]], b = fills[ZONES[j]];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      minDist = Math.min(minDist, d);
    }
  }
  check('zone fills are distinct from each other', minDist > 0.15, 'min pairwise dist ' + minDist.toFixed(3));
  // Matches the palette: commercial fill is warm (r clearly above b).
  check('commercial fill is warm amber (r > b)', fills.commercial[0] - fills.commercial[2] > 0.2, JSON.stringify(fills.commercial));
  // Fallback zones (no buildings) still get a colour.
  check('plaza fallback is magenta', JSON.stringify(zoneNeonFill(city, 'plaza')) === JSON.stringify([1, 0.25, 0.85]));
  check('cssColor formats rgba', cssColor([1, 0.5, 0], 0.5) === 'rgba(255,128,0,0.5)');
}

// --- 3. formatDistance ---
check('formatDistance metres', formatDistance(128) === '128 m');
check('formatDistance kilometres', formatDistance(1500) === '1.5 km');
check('formatDistance null is empty', formatDistance(null) === '');

// --- 3b. healthBarState: pure health-bar math ---
check('healthBarState clamps above 100', healthBarState(150).pct === 100);
check('healthBarState clamps below 0', healthBarState(-5).pct === 0);
check('healthBarState rounds', healthBarState(78.4).pct === 78);
check('healthBarState is low at 30', healthBarState(30).low === true);
check('healthBarState is not low at 31', healthBarState(31).low === false);
check('healthBarState defaults to 100', healthBarState(undefined).pct === 100);

// --- 4. drawCityMap: real building boxes, zone blocks, N marker, labels ---
{
  const ctx = makeCtx();
  const player = { x: 0, z: 0, facing: 0 };
  drawCityMap(ctx, city, 200, 200, player, 10, [{ x: 100, z: -100, color: '#ffd23f', shape: 'diamond' }], { labels: false, zoneAlpha: 0.32 });
  const rects = ctx.calls.filter(([k]) => k === 'fillRect');
  const smallRects = rects.filter(([, , , w, h]) => w <= 9 && h <= 9 && w >= 1 && h >= 1);
  check('minimap draws all 1,000 building boxes', smallRects.length >= 1000, smallRects.length + ' small rects');
  const blockRects = rects.filter(([, , , w, h]) => w >= 11 && w <= 13 && h >= 11 && h <= 13);
  check('minimap draws zone blocks (144)', blockRects.length >= 144, blockRects.length + ' block rects');
  const texts = ctx.calls.filter(([k]) => k === 'fillText').map(([, t]) => t);
  check('minimap draws north marker N', texts.includes('N'), texts.join(','));
  check('minimap draws mission diamond marker', ctx.calls.some(([k]) => k === 'moveTo'));
  // Real minimap size (Mu 24 Nov 12:51 — shrunk 200px -> 130px, it read too
  // big in frame): all 1,000 boxes, the N marker and the mission diamond
  // must still draw at 130x130. Buildings are 1-4px at this scale
  // (1px ~= 10.8m), so the small-rects filter still catches every one.
  const ctx130 = makeCtx();
  drawCityMap(ctx130, city, 130, 130, player, 10, [{ x: 100, z: -100, color: '#ffd23f', shape: 'diamond' }], { labels: false, zoneAlpha: 0.32 });
  const rects130 = ctx130.calls.filter(([k]) => k === 'fillRect');
  const small130 = rects130.filter(([, , , w, h]) => w <= 9 && h <= 9 && w >= 1 && h >= 1);
  check('minimap at 130px still draws all 1,000 building boxes', small130.length >= 1000, small130.length + ' small rects');
  const texts130 = ctx130.calls.filter(([k]) => k === 'fillText').map(([, t]) => t);
  check('minimap at 130px still draws north marker N', texts130.includes('N'), texts130.join(','));
  check('minimap at 130px still draws mission diamond marker', ctx130.calls.some(([k]) => k === 'moveTo'));
  // Big map with labels: English zone names + stadium name.
  const ctx2 = makeCtx();
  drawCityMap(ctx2, city, 560, 560, player, 10, [], { labels: true, zoneAlpha: 0.5 });
  const texts2 = ctx2.calls.filter(([k]) => k === 'fillText').map(([, t]) => t);
  for (const z of ZONES) {
    check('big map labels zone ' + AREA_NAMES[z], texts2.includes(AREA_NAMES[z]));
  }
  check('big map labels the stadium', texts2.includes(city.stadium.name), city.stadium.name);
  check('big map draws N marker', texts2.includes('N'));
}

// --- 5. createHud().update() with full Neon City state ---
{
  const hud = createHud(city);
  const player = { x: 0, z: 0, facing: 0 };
  hud.update(0.016, {
    money: 1250, coins: { found: 3, total: 12 }, timeHours: 10.5, wanted: 2,
    speedKmh: 87, objective: 'Deliver the parcel to Rimba Market', place: 'Rimba Central',
    weapon: { owned: true, ammo: 12 }, armor: 1, medkits: 2, drinks: 0,
    boosted: true, missionsDone: 3, missionsTotal: 6, armed: true,
    driving: true, targetDist: 128, health: 78,
  });
  check('money formatted with $ and comma', els['hud-money'].textContent === '$1,250', els['hud-money'].textContent);
  check('coins counter', els['hud-coins'].textContent === '◉ 3/12 coins', els['hud-coins'].textContent);
  check('time formatted 10:30', els['hud-time'].textContent === '10:30', els['hud-time'].textContent);
  check('wanted stars 2/3', els['hud-stars'].textContent === '★★☆', els['hud-stars'].textContent);
  check('wanted stars turn magenta when wanted', els['hud-stars'].style.color === '#ff2e88', els['hud-stars'].style.color);
  check('missions progress chip', els['hud-missions'].textContent === 'MISSIONS 3/6', els['hud-missions'].textContent);
  check('objective text kept', els['hud-objective'].textContent === 'Deliver the parcel to Rimba Market');
  check('distance chip shows metres', els['hud-distance'].textContent === '◆ TARGET 128 m', els['hud-distance'].textContent);
  check('weapon slot shows PISTOL', els['hud-weapon-name'].textContent === 'PISTOL');
  check('ammo shows 12 RDS', els['hud-ammo'].textContent === '12 RDS', els['hud-ammo'].textContent);
  check('armor chip shows count', els['hud-armor'].textContent === 'ARMOR ×1');
  check('medkit chip shows count', els['hud-medkit'].textContent === 'MEDKIT ×2');
  check('health bar fill is 78% at health 78', els['hud-health-fill'].style.width === '78%', els['hud-health-fill'].style.width);
  check('health bar label shows HEALTH 78', els['hud-health-text'].textContent === 'HEALTH 78', els['hud-health-text'].textContent);
  check('boost chip visible while boosted', els['hud-boost'].style.display === 'inline-block');
  check('crosshair visible while armed', els['hud-crosshair'].style.display === 'block');
  check('speedometer visible while driving', els['hud-speedo'].style.display === 'block');
  check('speedometer arc set for 87 km/h', els['hud-speedo-arc'].attrs['stroke-dasharray'] === '94.3 289', els['hud-speedo-arc'].attrs['stroke-dasharray']);
  // On foot, unarmed, no weapon: speedo + crosshair hide, weapon dims.
  hud.update(0.016, {
    money: 0, coins: { found: 0, total: 12 }, timeHours: 22, wanted: 0,
    speedKmh: 0, objective: 'Explore Teluk Rimba', place: 'Palm Gardens',
    weapon: { owned: false, ammo: 0 }, armor: 0, medkits: 0,
    boosted: false, missionsDone: 0, missionsTotal: 6, armed: false,
    driving: false, targetDist: null, health: 20,
  });
  check('speedometer hidden on foot', els['hud-speedo'].style.display === 'none');
  check('health bar fill is 20% at health 20', els['hud-health-fill'].style.width === '20%', els['hud-health-fill'].style.width);
  check('health bar turns critical red at 20', els['hud-health-fill'].style.background === 'linear-gradient(90deg,#ff0033,#ff2e63)', els['hud-health-fill'].style.background);
  check('crosshair hidden while unarmed', els['hud-crosshair'].style.display === 'none');
  check('weapon slot shows NO WEAPON', els['hud-weapon-name'].textContent === 'NO WEAPON');
  check('distance chip hidden with no target', els['hud-distance'].style.display === 'none');
  check('stars empty at wanted 0', els['hud-stars'].textContent === '☆☆☆');
  // Backward compatibility: old minimal state (no new fields) must not throw.
  let threw = false;
  try {
    hud.update(0.016, { money: 5, timeHours: 9, wanted: 1, speedKmh: 0, objective: 'x', place: 'y' });
  } catch (e) { threw = true; }
  check('update() tolerates old minimal state', !threw);
  // Minimap + zone strip.
  hud.drawMinimap(player, 10, { x: 100, z: -100, board: false });
  check('zone strip shows active area', els['hud-zone'].textContent === 'RIMBA CENTRAL', els['hud-zone'].textContent);
  // Full map opens with a neon legend (English zone names).
  hud.openMap(player, 10, []);
  const overlay = createdEls.find((e) => e.id === 'full-map');
  check('full map overlay created', !!overlay);
  check('full map legend lists Rimba Central', !!overlay && overlay.innerHTML.includes('Rimba Central'), 'legend present');
  check('full map legend lists Coral Beach', !!overlay && overlay.innerHTML.includes('Coral Beach'));
  check('full map title is English', !!overlay && overlay.innerHTML.includes('TELUK RIMBA — MAP'));
}

// --- 6. index.html: English, circular minimap, all Neon City ids, neon palette ---
{
  const html = readFileSync(join(__dirname, '..', 'game', 'index.html'), 'utf8');
  check('html lang is en', html.includes('<html lang="en">'));
  check('minimap is circular (border-radius 50%)', html.includes('border-radius: 50%'));
  check('minimap is 130px (Mu: shrunk from 200px, it read too big)', html.includes('width: 130px; height: 130px'));
  check('minimap canvas is 130x130', html.includes('width="130" height="130"'));
  check('old 200px minimap is gone', !html.includes('width: 200px; height: 200px') && !html.includes('width="200" height="200"'));
  for (const id of ['hud-speedo', 'hud-speedo-arc', 'hud-speedo-text', 'hud-crosshair', 'hud-weapon', 'hud-weapon-name', 'hud-ammo', 'hud-distance', 'hud-zone', 'hud-missions', 'hud-armor', 'hud-medkit', 'hud-boost', 'hud-health', 'hud-health-text', 'hud-health-track', 'hud-health-fill']) {
    check('index.html has #' + id, html.includes('id="' + id + '"'));
  }
  check('old speed text element removed', !html.includes('id="hud-speed"'));
  check('neon cyan in CSS', html.includes('#22d3ee'));
  check('neon magenta in CSS', html.includes('#ff2e88'));
  check('neon yellow in CSS', html.includes('#ffd23f'));
  const ID_WORDS = ['Selamat', 'Misi', 'Kecepatan', 'Tutup', 'Peta', 'Nyawa', 'Senjata', 'Peluru', 'Uang', 'Tekan ', 'Cari '];
  for (const w of ID_WORDS) {
    check('no Indonesian HUD word "' + w + '"', !html.includes(w), 'found in index.html');
  }
}

console.log(fails === 0 ? 'ALL HUD TESTS PASSED' : fails + ' HUD TESTS FAILED');
process.exit(fails === 0 ? 0 : 1);
