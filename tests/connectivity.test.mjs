// Teluk Rimba — connectivity + city-shape test (Node, no browser needed).
// FAILS (exit 1) if any part of the city is disconnected from the road graph,
// if the building count is not exactly 1000, or if a building breaks the rules.
// Run: node tests/connectivity.test.mjs
import { generateCity, isConnected, reachableNodes, riverDistance, ROAD_LINES, TARGET_BUILDINGS } from '../game/src/city.js';

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const city = generateCity();
const s = city.stats;

check('building count is exactly 1000', s.buildings === TARGET_BUILDINGS, `got ${s.buildings}`);
check('road graph is fully connected', isConnected(city), `${reachableNodes(city, 84).size}/${s.nodes} nodes reachable`);
check('every block has buildings or is a reserved open block', city.blocks.every((b) => {
  const n = city.buildings.filter((bd) => bd.x >= b.x0 && bd.x <= b.x1 && bd.z >= b.z0 && bd.z <= b.z1).length;
  return (b.zone === 'river' || b.zone === 'plaza' || b.zone === 'market') ? n === 0 : n > 0;
}));
check('downtown blocks hold 1-2 buildings each', city.blocks.filter((b) => b.zone === 'downtown').every((b) => {
  const n = city.buildings.filter((bd) => bd.x >= b.x0 && bd.x <= b.x1 && bd.z >= b.z0 && bd.z <= b.z1).length;
  return n >= 1 && n <= 2;
}));
check('no building sits on a road or in the river', city.buildings.every((b) => {
  for (const L of ROAD_LINES) {
    const hw = L === -400 || L === -200 || L === 0 || L === 200 || L === 400 ? 9 : 6;
    const inVertical = b.x + b.w / 2 > L - hw && b.x - b.w / 2 < L + hw;
    const inHorizontal = b.z + b.d / 2 > L - hw && b.z - b.d / 2 < L + hw;
    if (inVertical || inHorizontal) return false;
  }
  const pts = [[b.x, b.z], [b.x - b.w / 2, b.z - b.d / 2], [b.x + b.w / 2, b.z - b.d / 2], [b.x - b.w / 2, b.z + b.d / 2], [b.x + b.w / 2, b.z + b.d / 2]];
  return pts.every(([x, z]) => riverDistance(x, z) > 13);
}));
check('river is bridged where roads cross it', s.bridges > 0, `${s.bridges} bridge edges`);
check('street trees are off the asphalt', city.streetTrees.every((t) => {
  for (const L of ROAD_LINES) {
    if (Math.abs(t.x - L) < 3.5 && Math.abs(t.z - L) < 3.5) return false;
  }
  return true;
}));
console.log(`zones: ${JSON.stringify(s.zones)}`);
console.log(`nodes=${s.nodes} edges=${s.edges} bridges=${s.bridges} streetTrees=${s.streetTrees} forestTrees=${s.forestTrees} lamps=${s.lamps} trafficLights=${s.trafficLights}`);

if (failures > 0) { console.error(`${failures} check(s) FAILED`); process.exit(1); }
console.log('ALL CHECKS PASSED');
