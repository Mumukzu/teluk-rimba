// Rimba Stadium checks (Mu 23 Nov 22:18): a football stadium on the
// riverbank — block (11,7) Marina Shore, pitch + stands, floodlights at
// night, on the map/minimap, with stand collision and no clash with the
// river, roads, coins, missions or the rest of the city.
import { generateCity, buildingAABBs, riverDistance, ROAD_LINES, CORRIDOR_HALF, placeNameAt, TARGET_BUILDINGS } from '../game/src/city.js';
import { buildStadium } from '../game/src/stadium.js';
import { COIN_SPOTS } from '../game/src/extras.js';

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) { failures++; console.error('FAIL:', name, detail); }
  else console.log('ok:', name, detail);
}
const allFin = (m) => m.every(Number.isFinite);

const city = generateCity();
const st = city.stadium;

// --- Site: the riverbank block, proportional, clear of everything. ---
check('stadium exists and is named Rimba Stadium', !!st && st.name === 'Rimba Stadium');
check('stadium is in block (11,7) Marina Shore', st.block.i === 11 && st.block.j === 7 && st.block.name === 'Marina Shore',
  `${st.block.i},${st.block.j} ${st.block.name}`);
check('stadium footprint is 76x56 (pitch 60x40 + 8 m stands)', st.x1 - st.x0 === 76 && st.z1 - st.z0 === 56 && st.pitchW === 60 && st.pitchD === 40,
  `${st.x1 - st.x0}x${st.z1 - st.z0}, pitch ${st.pitchW}x${st.pitchD}`);
check('stadium sits inside its block with >= 3 m setback on every side', (() => {
  const b = city.blocks.find((bl) => bl.i === 11 && bl.j === 7);
  return st.x0 - b.x0 >= 3 && b.x1 - st.x1 >= 3 && st.z0 - b.z0 >= 3 && b.z1 - st.z1 >= 3;
})(), `block ${city.blocks.find((bl) => bl.i === 11 && bl.j === 7).x0}..${city.blocks.find((bl) => bl.i === 11 && bl.j === 7).x1} / ${city.blocks.find((bl) => bl.i === 11 && bl.j === 7).z0}..${city.blocks.find((bl) => bl.i === 11 && bl.j === 7).z1}`);
check('stadium clears the river by >= 32 m (clear of the rd 17-31 tree band, promenade and benches)', (() => {
  let m = Infinity;
  for (let x = st.x0; x <= st.x1; x += 4) for (let z = st.z0; z <= st.z1; z += 4) m = Math.min(m, riverDistance(x, z));
  return m >= 32;
})(), `minRd ${st.minRiverDistance} m`);
check('stadium does not touch any road corridor', ROAD_LINES.every((L) => {
  const hw = CORRIDOR_HALF(L);
  const inV = st.x0 < L + hw && st.x1 > L - hw;
  const inH = st.z0 < L + hw && st.z1 > L - hw;
  return !inV && !inH;
}));
check('stadium replaced exactly 5 beach buildings', st.removedBuildings === 5, `${st.removedBuildings} removed`);
check('no building is left inside the stadium block', city.buildings.every((b) =>
  !(b.x >= 507 && b.x <= 593 && b.z >= 107 && b.z <= 193)));
check('building count is still exactly 1000 (topped up with houses)', city.buildings.length === TARGET_BUILDINGS,
  `${city.buildings.length}`);
check('no coin sits inside the stadium', COIN_SPOTS.every((c) =>
  !(c.x > st.x0 && c.x < st.x1 && c.z > st.z0 && c.z < st.z1)));
check('HUD names the stadium when standing on it', placeNameAt(city, st.cx, st.cz) === 'Rimba Stadium',
  placeNameAt(city, st.cx, st.cz));

// --- Geometry: one merged static mesh + 4 floodlight heads. ---
const sd = buildStadium(city);
check('stadium base geometry is non-empty', sd.base.pos.length > 0 && sd.base.pos.length % 9 === 0,
  `${sd.base.pos.length / 9} tris`);
check('all stadium vertices are finite', allFin(sd.base.pos) && allFin(sd.base.nrm) && allFin(sd.base.col));
check('4 floodlight heads', sd.floodHeads.matrices.length === 4 && sd.floodHeads.tints.length === 4,
  `${sd.floodHeads.matrices.length} heads`);
check('floodlight heads stand at the four corners (14.4 m up)', sd.floodHeads.matrices.every((m) => Math.abs(m[13] - 14.4) < 0.001)
  && sd.floodHeads.matrices.map((m) => `${m[12]},${m[14]}`).sort().join('|') === '516,132|516,180|584,132|584,180');
check('floodlight tints are warm white', sd.floodHeads.tints.every((t) => t[0] === 1 && t[1] === 0.9 && t[2] === 0.6));
check('stadium counts agree', sd.counts.floodlights === 4 && sd.counts.pitchW === 60 && sd.counts.pitchD === 40,
  JSON.stringify(sd.counts));

// --- Collision: 6 stand colliders (west/east full, north/south split
// around the entrance gaps) on top of the 1000 building boxes. ---
const aabbs = buildingAABBs(city);
check('building AABBs are 1000 + 6 stand colliders', aabbs.length === 1006, `${aabbs.length}`);
{
  const standBoxes = aabbs.slice(1000);
  check('west/east stands are solid walls (no gap)', standBoxes[0].x0 === st.x0 && standBoxes[0].x1 === st.x0 + 8
    && standBoxes[1].x0 === st.x1 - 8 && standBoxes[1].x1 === st.x1);
  check('south/north stands leave a 6 m entrance gap at the centre', standBoxes[2].x1 === st.cx - 3 && standBoxes[3].x0 === st.cx + 3
    && standBoxes[4].x1 === st.cx - 3 && standBoxes[5].x0 === st.cx + 3);
  check('no coin sits inside a stand collider', COIN_SPOTS.every((c) =>
    !standBoxes.some((a) => c.x > a.x0 && c.x < a.x1 && c.z > a.z0 && c.z < a.z1)));
  check('the pitch centre is walkable (no collider covers it)', !aabbs.some((a) =>
    st.cx > a.x0 && st.cx < a.x1 && st.cz > a.z0 && st.cz < a.z1));
}

if (failures > 0) { console.error(`${failures} check(s) FAILED`); process.exit(1); }
console.log('stadium.test.mjs: all checks passed');
