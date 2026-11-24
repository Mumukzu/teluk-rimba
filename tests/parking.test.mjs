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
// Biggest lot is the stadium west car park (Mu 23 Nov 23:09): 77.5x16 m,
// 31 cols x 2 rows = 62 bays — bigger than the old downtown 60 m lot.
check('biggest lot is the stadium west car park', p.counts.biggest && p.counts.biggest.width === 77.5 && p.counts.biggest.bays === 62,
  `${p.counts.biggest.width}x${p.counts.biggest.depth} m, ${p.counts.biggest.bays} bays`);

// --- Rimba Stadium car parks (Mu 23 Nov 23:09): 3 lots beside the
// stadium, many parked cars. ---
const st = city.stadium;
const stLots = p.lots.filter((l) => l.stadium);
const stBays = stLots.reduce((s, l) => s + l.rows * l.cols, 0);
const stCars = stLots.reduce((s, l) => s + l.cars, 0);
check('3 stadium lots placed', stLots.length === 3, `${stLots.length} lots`);
check('stadium lots hold 90 bays', stBays === 90, `${stBays} bays`);
check('stadium lots hold at least 40 parked cars (Mu: BANYAK mobil)', stCars >= 40, `${stCars} cars`);
check('every stadium lot is well filled (at least 70% of its bays)',
  stLots.every((l) => l.cars >= Math.round((l.rows * l.cols - 1) * 0.7)),
  stLots.map((l) => `${l.cars}/${l.rows * l.cols}`).join(', '));
check('stadium lots: 2 on the forecourt apron (raised), 1 west at ground level',
  stLots.filter((l) => l.yBase === 0.15).length === 2 && stLots.filter((l) => l.yBase === 0).length === 1,
  stLots.map((l) => `${l.width}x${l.depth}@y+${l.yBase}`).join(', '));
check('no stadium lot overlaps the stadium (+1.5 m)',
  stLots.every((l) => !(l.rect.x0 - 1.5 < st.x1 && l.rect.x1 + 1.5 > st.x0 && l.rect.z0 - 1.5 < st.z1 && l.rect.z1 + 1.5 > st.z0)));
check('stadium lots within 25 m of the river: none',
  stLots.every((l) => [[l.rect.x0, l.rect.z0], [l.rect.x1, l.rect.z0], [l.rect.x0, l.rect.z1], [l.rect.x1, l.rect.z1]]
    .every(([x, z]) => riverDistance(x, z) >= 25)));
// South lots sit right by the south entrance gap (stadium south edge z0).
const southLots = stLots.filter((l) => l.rect.z1 <= st.z0);
check('2 stadium lots by the south entrance (within 2 m of the stadium)',
  southLots.length === 2 && southLots.every((l) => st.z0 - l.rect.z1 <= 2),
  southLots.map((l) => `z1=${l.rect.z1}`).join(', '));
// West lot sits across the road from the west stand (stadium west edge x0).
const westLots = stLots.filter((l) => l.rect.x1 < st.x0);
check('1 stadium lot west of the stadium (across the road, within 25 m)',
  westLots.length === 1 && westLots.every((l) => st.x0 - l.rect.x1 <= 25),
  westLots.map((l) => `x1=${l.rect.x1}`).join(', '));

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
check('every lot has 2..62 bays', p.lots.every((l) => l.rows * l.cols >= 2 && l.rows * l.cols <= 62)); // 62 = stadium west car park

// --- Draw calls: markings + symbols are single merged geoms. The lot
// cars are NOT baked here anymore (Mu: stealable) — they spawn as parked
// traffic entities via spawnLotCars, so the static car geom is empty
// and the props mesh loses ~135k tris.
check('markings are one merged geom', p.markings.pos.length > 0 && p.markings.nrm.length === p.markings.pos.length);
check('no static lot cars baked (they spawn as traffic)', p.cars.pos.length === 0, `${p.cars.pos.length} verts`);
check('carSpots replace the baked cars, 1 per lot car', p.carSpots.length === p.counts.cars, `${p.carSpots.length} spots, ${p.counts.cars} cars`);
check('ground symbols are one merged geom', p.symbols.panelGeom.pos.length > 0);

if (fails) { console.error(fails + ' PARKING CHECK(S) FAILED'); process.exit(1); }
console.log('ALL PARKING CHECKS PASSED');
