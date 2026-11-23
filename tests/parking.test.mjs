// Parking checks: CBD has far more marked lots than before (Mu 22:36),
// every lot sits in a building yard — never on a road, in a building,
// in the river, or in front of a door — and all lot markings, parked
// cars and ground symbols stay merged into the three existing meshes
// (0 new draw calls no matter how many lots).
import { generateCity, riverDistance, ROAD_LINES, ASPHALT_HALF, CORRIDOR_HALF } from '../game/src/city.js';
import { buildParking } from '../game/src/parking.js';

let fails = 0;
function check(name, ok, detail = '') {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? ' — ' + detail : ''));
  if (!ok) fails++;
}

const city = generateCity();
const p = buildParking(city);
const dt = p.lots.filter((l) => l.building.zone === 'downtown');
const dtBays = dt.reduce((s, l) => s + l.rows * l.cols, 0);
const totalBays = p.lots.reduce((s, l) => s + l.rows * l.cols, 0);

// --- Counts: CBD at least 2x the old 19 lots / 496 bays. ---
check('downtown lots at least 2x the old 19', dt.length >= 38, `${dt.length} lots`);
check('downtown bays at least 2x the old 496', dtBays >= 992, `${dtBays} bays`);
check('total lots up from 20', p.counts.lots >= 60, `${p.counts.lots} lots`);
check('counts.bays matches the lots', p.counts.bays === totalBays, `${p.counts.bays} bays`);
check('biggest lot is a downtown 60 m lot', p.counts.biggest && p.counts.biggest.width === 60 && p.counts.biggest.bays === 48,
  `${p.counts.biggest.width}x${p.counts.biggest.depth} m, ${p.counts.biggest.bays} bays`);

// --- Placement: every lot inside its own block, clear of everything. ---
const blockOf = (l) => city.blocks.find((bl) =>
  l.rect.x0 >= bl.x0 && l.rect.x1 <= bl.x1 && l.rect.z0 >= bl.z0 && l.rect.z1 <= bl.z1);
check('every lot sits inside a city block', p.lots.every((l) => !!blockOf(l)),
  `${p.lots.filter((l) => !blockOf(l)).length} outside`);
const bFoot = (b) => {
  const w = b.rot ? b.d : b.w, d = b.rot ? b.w : b.d;
  return { x0: b.x - w / 2, x1: b.x + w / 2, z0: b.z - d / 2, z1: b.z + d / 2 };
};
const ov = (a, b, m = 0) => a.x0 - m < b.x1 && a.x1 + m > b.x0 && a.z0 - m < b.z1 && a.z1 + m > b.z0;
check('no lot overlaps any building (+1.5 m)',
  p.lots.every((l) => !city.buildings.some((b) => ov(l.rect, bFoot(b), 1.5))));
check('no lot overlaps another lot (+2 m)',
  p.lots.every((a, i) => p.lots.every((b, j) => i >= j || !ov(a.rect, b.rect, 2))));
check('no lot within 25 m of the river',
  p.lots.every((l) => [[l.rect.x0, l.rect.z0], [l.rect.x1, l.rect.z0], [l.rect.x0, l.rect.z1], [l.rect.x1, l.rect.z1]]
    .every(([x, z]) => riverDistance(x, z) >= 25)));
check('no lot touches road asphalt',
  p.lots.every((l) => ROAD_LINES.every((L) => {
    const ah = ASPHALT_HALF(L);
    const onVertical = l.rect.x0 <= L + ah && l.rect.x1 >= L - ah;
    const onHorizontal = l.rect.z0 <= L + ah && l.rect.z1 >= L - ah;
    return !onVertical && !onHorizontal;
  })));
check('no lot touches a sidewalk strip',
  p.lots.every((l) => ROAD_LINES.every((L) => {
    const ch = CORRIDOR_HALF(L);
    const onVertical = l.rect.x0 <= L + ch && l.rect.x1 >= L - ch;
    const onHorizontal = l.rect.z0 <= L + ch && l.rect.z1 >= L - ch;
    return !onVertical && !onHorizontal;
  })));

// --- Standards kept on every lot: 1 disabled bay, P symbols, cars. ---
check('one disabled bay per lot (symbols >= lots)', p.counts.symbols >= p.counts.lots,
  `${p.counts.symbols} symbols, ${p.counts.lots} lots`);
check('parked cars in the lots', p.counts.cars >= 200, `${p.counts.cars} cars`);
check('every lot has 2..48 bays', p.lots.every((l) => l.rows * l.cols >= 2 && l.rows * l.cols <= 48));

// --- Draw calls: markings + cars + symbols are single merged geoms. ---
check('markings are one merged geom', p.markings.pos.length > 0 && p.markings.nrm.length === p.markings.pos.length);
check('parked cars are one merged geom', p.cars.pos.length > 0 && p.cars.col.length === p.cars.pos.length);
check('ground symbols are one merged geom', p.symbols.panelGeom.pos.length > 0);

if (fails) { console.error(fails + ' PARKING CHECK(S) FAILED'); process.exit(1); }
console.log('ALL PARKING CHECKS PASSED');
