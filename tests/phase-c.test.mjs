// Teluk Rimba — Phase C checks (Node, no browser needed).
// Plot dressing, CBD towers, 4 bridges, NPC behaviour variety.
// Run: node tests/phase-c.test.mjs
import { generateCity, riverDistance } from '../game/src/city.js';
import { buildPlotDressing } from '../game/src/plots.js';
import { createPeds } from '../game/src/peds.js';

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const city = generateCity();
const s = city.stats;

// --- plot dressing: no plain green yards in dense / residential blocks ---
const plots = buildPlotDressing(city);
check('plot dressing covers most dense+residential blocks', plots.counts.blocks >= 80, `${plots.counts.blocks} blocks`);
check('dressed plots have parked cars', plots.counts.cars >= 150, `${plots.counts.cars} cars`);
check('dressed plots have fences', plots.counts.fences >= 100, `${plots.counts.fences} fences`);
check('dressed plots have flower beds', plots.counts.flowerBeds >= 150, `${plots.counts.flowerBeds} beds`);
check('dressed plots have benches', plots.counts.benches >= 30, `${plots.counts.benches} benches`);
check('paving geometry is non-empty', plots.paving.pos.length > 0, `${plots.paving.pos.length / 9} quads`);
check('props geometry is non-empty', plots.props.pos.length > 0, `${plots.props.pos.length / 9} tris`);

// --- CBD iconic towers: taller, bigger, recognisable ---
const towers = city.buildings.filter((b) => b.shape);
check('exactly 10 iconic CBD towers', towers.length === 10, `${towers.length}`);
check('tower shapes cover all 4 kinds', ['tiered', 'spire', 'crown', 'glass'].every((k) => towers.some((b) => b.shape === k)),
  [...new Set(towers.map((b) => b.shape))].join(','));
const tallest = city.buildings.reduce((a, b) => (b.h > a.h ? b : a));
check('tallest tower is 78-105 m (was 67 m)', tallest.h >= 78 && tallest.h <= 105, `${tallest.h} m at (${tallest.x},${tallest.z}) ${tallest.shape}`);
check('towers are bigger than ordinary downtown blocks', towers.every((b) => b.w >= 24 && b.d >= 24),
  `w ${Math.min(...towers.map((b) => b.w))}-${Math.max(...towers.map((b) => b.w))}`);

// --- river: exactly 4 bridges, roads stop at the bank ---
check('exactly 4 bridge edges', s.bridges === 4, `${s.bridges}`);
{
  const nodeById = new Map(city.nodes.map((n) => [n.id, n]));
  const got = new Set(city.edges.filter((e) => e.bridge).map((e) => {
    const a = nodeById.get(e.a), b = nodeById.get(e.b);
    return [a, b].map((n) => `${n.x},${n.z}`).sort().join('|');
  }));
  const want = new Set([
    '-200,-300|-300,-300', '-100,-200|-200,-200', '0,-100|0,0', '400,0|400,100',
  ]);
  check('the 4 bridges are the planned crossings', [...want].every((k) => got.has(k)), [...got].join(' ; '));
}
check('no road node sits in the river channel', city.nodes.every((n) => riverDistance(n.x, n.z) >= 11));

// --- NPC behaviour variety: runners + idle chat/wait/look ---
const peds = createPeds(city);
const runners = peds.peds.filter((p) => p.pace === 'run').length;
check('~15% of NPCs run instead of walking', runners >= 30 && runners <= 60, `${runners} runners of ${peds.count()}`);
for (let i = 0; i < 3600; i++) peds.step(1 / 60); // 60 s of street life
const states = peds.peds.reduce((m, p) => { m[p.state] = (m[p.state] || 0) + 1; return m; }, {});
const idle = (states.idle_chat || 0) + (states.idle_wait || 0) + (states.idle_look || 0);
check('NPCs pause to chat / wait / look around', idle >= 10, `${idle} idling (${JSON.stringify(states)})`);
check('NPCs do not ping-pong across one intersection', (states.cross || 0) <= 45, `${states.cross || 0} crossing`);

if (failures > 0) { console.error(`${failures} check(s) FAILED`); process.exit(1); }
console.log('ALL PHASE C CHECKS PASSED');
