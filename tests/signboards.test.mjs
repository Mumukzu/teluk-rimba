// Signboard checks (Mu): BIG facade name boards on every downtown +
// commercial building (337), striped awnings on all commercial
// shopfronts, wider/brighter commercial glow panels — with the counts
// the other suites pin (shop glow 327/400/11, canopies 684) intact.
// rooftopsigns.js draws its atlas on a DOM canvas, so the test stubs
// document with a no-op canvas context (same pattern as signs.test.mjs,
// plus measureText so the shrink-to-fit never throws).
const ctxStub = new Proxy({}, {
  get: (_t, k) => (k === 'canvas' ? undefined : k === 'measureText' ? () => ({ width: 0 }) : (() => {})),
  set: () => true,
});
globalThis.document = {
  createElement: () => ({ getContext: () => ctxStub, width: 0, height: 0 }),
};

import { generateCity } from '../game/src/city.js';
import { BUILDING_CLASSES, buildingClass } from '../game/src/buildings.js';
import {
  buildRooftopSigns, ROOFTOP_SLOTS, CBD_NEW_NAMES,
  COMMERCIAL_FIRST, COMMERCIAL_SECOND, FORBIDDEN_NAMES,
  ATLAS_SIZE, FACADE_GRID,
} from '../game/src/rooftopsigns.js';
import { buildShopSigns } from '../game/src/shopsigns.js';
import { buildShopGlow } from '../game/src/shopglow.js';

let fails = 0;
function check(name, ok, extra = '') {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (ok ? '' : '  [' + extra + ']'));
  if (!ok) fails++;
}
const approx = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;
const isAscii = (s) => /^[\x20-\x7e]+$/.test(s);

const city = generateCity();
const rs = buildRooftopSigns(city);
const ss = buildShopSigns(city);
const sg = buildShopGlow(city);

// --- 1. Rooftop signs untouched (9 landmarks) ---
check('rooftop signs still 9 landmarks', rs.counts.signs === 9 && rs.picks.length === 9,
  rs.counts.signs + ' signs');

// --- 2. Facade boards: exactly 337 (21 downtown + 316 commercial) ---
const boards = rs.boards;
const dtBoards = boards.filter((b) => b.zone === 'downtown');
const cmBoards = boards.filter((b) => b.zone === 'commercial');
check('337 facade boards (21 downtown + 316 commercial)',
  boards.length === 337 && dtBoards.length === 21 && cmBoards.length === 316,
  boards.length + ' boards (' + dtBoards.length + ' dt, ' + cmBoards.length + ' cm)');
check('boards count in return matches', rs.counts.boards === 337, rs.counts.boards + ' boards');

// --- 3. Names: unique per zone + global, ASCII, no forbidden/placeholder ---
const names = boards.map((b) => b.name);
check('all 337 board names unique (global)', new Set(names).size === 337,
  (337 - new Set(names).size) + ' duplicates');
check('downtown names unique', new Set(dtBoards.map((b) => b.name)).size === 21);
check('commercial names unique', new Set(cmBoards.map((b) => b.name)).size === 316);
check('all board names ASCII, non-empty', names.every((n) => n.length > 0 && isAscii(n)));
check('no forbidden reference names',
  names.every((n) => !FORBIDDEN_NAMES.some((f) => n.toUpperCase().includes(f))),
  names.filter((n) => FORBIDDEN_NAMES.some((f) => n.toUpperCase().includes(f))).join(','));
check('no placeholder names',
  names.every((n) => !/TODO|XXX|UNNAMED|PLACEHOLDER/i.test(n)));

// --- 4. Downtown names: 6 reused rooftop names + 15 new, on the right buildings ---
const reused = new Set(ROOFTOP_SLOTS.filter(([s]) => s.startsWith('tower') || s === 'hospital').map(([, n]) => n));
const dtNames = new Set(dtBoards.map((b) => b.name));
check('downtown names = 6 reused rooftop + 15 new',
  [...reused].every((n) => dtNames.has(n))
  && CBD_NEW_NAMES.every((n) => dtNames.has(n))
  && dtNames.size === 21,
  [...dtNames].filter((n) => !reused.has(n) && !CBD_NEW_NAMES.includes(n)).join(','));
const dtByHeight = [...city.buildings].filter((b) => b.zone === 'downtown').sort((a, b) => b.h - a.h);
const boardByPos = new Map(boards.map((b) => [b.x + ',' + b.z, b]));
const tallest5 = dtByHeight.filter((b) => !b.landmark).slice(0, 5);
check('5 tallest downtown towers carry the 5 rooftop tower names',
  tallest5.every((b, i) => {
    const board = boardByPos.get(+b.x.toFixed(1) + ',' + +b.z.toFixed(1));
    return board && board.name === ROOFTOP_SLOTS[i][1];
  }));
const hospital = city.buildings.find((b) => b.landmark === 'hospital');
check('hospital board reads Rimba City Hospital',
  boardByPos.get(+hospital.x.toFixed(1) + ',' + +hospital.z.toFixed(1)).name === 'Rimba City Hospital');

// --- 5. Commercial names: all FIRST x SECOND combos, 2 words ---
const combos = new Set();
for (const f of COMMERCIAL_FIRST) for (const s of COMMERCIAL_SECOND) combos.add(f + ' ' + s);
check('all commercial names are FIRST x SECOND combos',
  cmBoards.every((b) => combos.has(b.name)));
check('commercial names are 2 words, CBD names are 3 words',
  cmBoards.every((b) => b.name.split(' ').length === 2)
  && dtBoards.every((b) => b.name.split(' ').length === 3));

// --- 6. Board bounds: inside the facade, never over doors / lobby glass ---
let boundsOk = true, boundsWhy = '';
for (const b of boards) {
  const expW = b.zone === 'downtown' ? Math.min(b.buildingW * 0.72, 20) : Math.min(b.buildingW * 0.72, 12);
  const expH = expW / (384 / 72);
  if (!approx(b.w, expW) || !approx(b.h, expH)) { boundsOk = false; boundsWhy = b.name + ' size ' + b.w + 'x' + b.h; break; }
  if (b.w > b.buildingW + 0.01) { boundsOk = false; boundsWhy = b.name + ' wider than facade'; break; }
  if (b.topY > b.buildingH - 0.5) { boundsOk = false; boundsWhy = b.name + ' top above roof'; break; }
  if (b.zone === 'commercial') {
    if (!approx(b.bottomY, 3.9)) { boundsOk = false; boundsWhy = b.name + ' bottom ' + b.bottomY; break; }
    if (b.topY > 6.15 + 0.01) { boundsOk = false; boundsWhy = b.name + ' top above first balcony'; break; }
  } else {
    const lobbyH = b.buildingH / BUILDING_CLASSES[buildingClass(b.buildingH)].segRows;
    if (!approx(b.bottomY, lobbyH + 0.4)) { boundsOk = false; boundsWhy = b.name + ' bottom ' + b.bottomY + ' vs lobby ' + lobbyH.toFixed(2); break; }
  }
}
check('every board inside its facade bounds (size, bottom, top)', boundsOk, boundsWhy);

// --- 7. Atlas: combined, within limits, 337 cells fit the grid ---
check('atlas 7296x1854 (<= 8192 wide)', rs.atlasW === 7296 && rs.atlasH === 1854 && ATLAS_SIZE.w === 7296,
  rs.atlasW + 'x' + rs.atlasH);
check('facade grid 19x18 holds all 337 cells',
  FACADE_GRID.cols * FACADE_GRID.rows >= 337 && Math.max(...boards.map((b) => b.cell)) === 336);
check('board cells unique', new Set(boards.map((b) => b.cell)).size === 337);
check('atlas canvas drawn (document stub)', rs.atlasCanvas !== null);

// --- 8. Striped awnings: all 316 commercial, 8 strips, red/ivory alternating ---
check('striped awnings on all 316 commercial buildings (2528 strips)',
  rs.awnings.length === 316 && rs.counts.awnings === 2528,
  rs.awnings.length + ' awnings, ' + rs.counts.awnings + ' strips');
const RED = [0.80, 0.42, 0.38], IVORY = [0.94, 0.92, 0.88];
const sameCol = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
check('awning strips alternate soft red / ivory',
  rs.awnings.every((a) => a.colors.length === 8
    && a.colors.every((c, i) => sameCol(c, i % 2 === 0 ? RED : IVORY))));

// --- 9. Pastel canopies: commercial 0, everything else kept (684) ---
check('pastel canopies 684 (1000 - 316 commercial, downtown + others kept)',
  ss.counts.canopies === 684, ss.counts.canopies + ' canopies');
check('small shop name signs still on all 1000 buildings',
  ss.counts.signs === 1000, ss.counts.signs + ' signs');

// --- 10. Shop glow: counts unchanged, commercial panels wider + brighter ---
check('shop glow counts still 327 panels / 400 spills / 11 bands',
  sg.counts.panels === 327 && sg.counts.spills === 400 && sg.counts.bands === 11,
  sg.counts.panels + '/' + sg.counts.spills + '/' + sg.counts.bands);
const colLen = (m, c) => Math.hypot(m[c * 4], m[c * 4 + 1], m[c * 4 + 2]); // matrix column length = scale (column-major)
const commercialPanels = [];
const bands = [];
sg.matrices.forEach((m, i) => {
  if (approx(m[13], 1.45)) commercialPanels.push({ m, tint: sg.tints[i] });
  else if (approx(m[13], 3.8)) bands.push(m);
});
check('316 commercial glow panels at y 1.45, height 2.3',
  commercialPanels.length === 316 && commercialPanels.every((p) => approx(p.m[5], 2.3)),
  commercialPanels.length + ' panels');
const expWidths = city.buildings.filter((b) => b.zone === 'commercial')
  .map((b) => Math.min(b.w * 0.90, 14)).sort((a, b) => a - b);
const gotWidths = commercialPanels.map((p) => colLen(p.m, 0)).sort((a, b) => a - b);
check('commercial panel widths are min(across*0.90, 14)',
  gotWidths.length === expWidths.length
  && gotWidths.every((w, i) => approx(w, expWidths[i], 0.001)),
  'first mismatch at ' + gotWidths.findIndex((w, i) => !approx(w, expWidths[i], 0.001)));
check('some commercial panels wider than the old 10 m cap',
  gotWidths.some((w) => w > 10 + 0.001) && gotWidths.every((w) => w <= 14 + 0.001),
  'max width ' + Math.max(...gotWidths).toFixed(2));
check('commercial panel tints brighter (jitter 1.05-1.30)',
  commercialPanels.every((p) => Math.max(...p.tint) >= 1.05 - 1e-6 && Math.max(...p.tint) <= 1.31),
  'min max-tint ' + Math.min(...commercialPanels.map((p) => Math.max(...p.tint))).toFixed(2));
check('11 amber sign bands at y 3.8 (downtown unchanged)', bands.length === 11, bands.length + ' bands');
const commercialSpills = [];
const downtownSpills = [];
sg.spill.matrices.forEach((m, i) => {
  if (approx(colLen(m, 2), 4)) commercialSpills.push({ m, tint: sg.spill.tints[i] });
  else if (approx(colLen(m, 2), 7)) downtownSpills.push(m);
});
check('316 commercial spills 4 m deep, downtown 84 spills 7 m deep',
  commercialSpills.length === 316 && downtownSpills.length === 84,
  commercialSpills.length + ' cm / ' + downtownSpills.length + ' dt');
check('commercial spill red max 0.845 < 0.9 (bright-spill check stays downtown-only)',
  commercialSpills.every((s) => s.tint[0] < 0.9),
  'max r ' + Math.max(...commercialSpills.map((s) => s.tint[0])).toFixed(3));

// --- 11. Geometry is finite and non-empty ---
const finite = (g) => g.pos.length > 0 && g.pos.every(Number.isFinite)
  && g.nrm.every(Number.isFinite) && g.col.every(Number.isFinite);
check('rooftop box + panel geometry finite and non-empty',
  finite(rs.boxGeom) && rs.panelGeom.pos.length > 0
  && rs.panelGeom.pos.every(Number.isFinite) && rs.panelGeom.uv.every(Number.isFinite));
check('panel UVs consistent (2 per vertex)',
  rs.panelGeom.uv.length === (rs.panelGeom.pos.length / 3) * 2);

if (fails) { console.error(fails + ' SIGNBOARD CHECK(S) FAILED'); process.exit(1); }
console.log('ALL SIGNBOARD CHECKS PASSED');
