// Direction-sign checks: two-sided panels (Mu 23 Nov 23:31 — the old
// single-sided panel read as a blank green board from behind) and a sign
// in EVERY road sector (Mu 23 Nov 23:32 — the original 20 signs covered
// only 52 of 138 non-river blocks).
// signs.js draws its atlas on a DOM canvas, so the test stubs document
// with a no-op canvas context (same pattern as the lively-test note:
// the canvas atlas is null in Node, the geometry is fully testable).
const ctxStub = new Proxy({}, {
  get: (_t, k) => (k === 'canvas' ? undefined : (() => {})),
  set: () => true,
});
globalThis.document = {
  createElement: () => ({ getContext: () => ctxStub, width: 0, height: 0 }),
};

import { generateCity, riverDistance, AREA_NAMES } from '../game/src/city.js';
import { buildDirectionSigns, DISTRICT_TARGETS } from '../game/src/signs.js';

let fails = 0;
function check(name, ok, extra = '') {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (ok ? '' : '  [' + extra + ']'));
  if (!ok) fails++;
}

const city = generateCity();
const s = buildDirectionSigns(city);
const signs = s.signs;
const nodeById = new Map(city.nodes.map((n) => [n.id, n]));
const nearestNode = (x, z) => {
  let best = null, bd = Infinity;
  for (const n of city.nodes) {
    const d = (n.x - x) * (n.x - x) + (n.z - z) * (n.z - z);
    if (d < bd) { bd = d; best = n; }
  }
  return best;
};

// --- Independent BFS (re-implemented here, not imported from signs.js) ---
const adj = new Map();
for (const e of city.edges) {
  if (!adj.has(e.a)) adj.set(e.a, []);
  if (!adj.has(e.b)) adj.set(e.b, []);
  adj.get(e.a).push(e.b);
  adj.get(e.b).push(e.a);
}
const bfsFirstStep = (startId, targetId) => {
  if (startId === targetId) return null;
  const prev = new Map([[startId, -1]]);
  const q = [startId];
  while (q.length) {
    const n = q.shift();
    if (n === targetId) break;
    for (const m of adj.get(n) || []) {
      if (!prev.has(m)) { prev.set(m, n); q.push(m); }
    }
  }
  if (!prev.has(targetId)) return null;
  let cur = targetId;
  while (prev.get(cur) !== startId) cur = prev.get(cur);
  return cur;
};
const bfsDistances = (startId) => {
  const dist = new Map([[startId, 0]]);
  const q = [startId];
  while (q.length) {
    const n = q.shift();
    for (const m of adj.get(n) || []) {
      if (!dist.has(m)) { dist.set(m, dist.get(n) + 1); q.push(m); }
    }
  }
  return dist;
};
const classify = (d, t) => {
  const dot = d.x * t.x + d.z * t.z;
  if (dot > 0.5) return 'up';
  if (dot < -0.5) return 'back';
  const cross = t.z * d.x - t.x * d.z;
  return cross > 0 ? 'left' : 'right';
};
const repNode = {};
for (const [key, tx, tz] of DISTRICT_TARGETS) repNode[key] = nearestNode(tx, tz);
const districtKeyOf = (text) =>
  Object.entries(AREA_NAMES).find(([, v]) => v === text)?.[0] || null;

check('original pole signs: 12', s.counts.pole === 12, s.counts.pole + ' pole');
check('original gantry signs: 8', s.counts.gantry === 8, s.counts.gantry + ' gantry');
check('sector signs added: >= 50', s.counts.sector >= 50, s.counts.sector + ' sector');
check('total signs >= 70', s.counts.total >= 70, s.counts.total + ' total');

// --- Coverage: every non-river block has a sign in/near it ---
{
  let uncovered = [];
  for (const b of city.blocks) {
    if (b.zone === 'river') continue;
    const hit = signs.some((sg) =>
      sg.x >= b.x0 - 20 && sg.x <= b.x1 + 20 && sg.z >= b.z0 - 20 && sg.z <= b.z1 + 20);
    if (!hit) uncovered.push(b.i + ',' + b.j + ':' + b.zone);
  }
  check('every non-river block has a sign nearby (138 blocks)', uncovered.length === 0, uncovered.join(' '));
}

// --- Two-sided panels: exactly 2 quads per sign (front + back) ---
{
  const verts = s.panelGeom.pos.length / 3;
  check('panel geometry: 2 quads (12 verts) per sign', verts === signs.length * 12, verts + ' verts for ' + signs.length + ' signs');
  // Quad centroids: front sits +0.08 along the facing normal, back -0.08.
  // Quads are appended front-then-back per sign, in returned-sign order.
  let bad = 0;
  for (let k = 0; k < signs.length; k++) {
    const sg = signs[k];
    const cent = (qi) => {
      let x = 0, y = 0, z = 0;
      for (let v = 0; v < 6; v++) {
        const o = (k * 12 + qi * 6 + v) * 3;
        x += s.panelGeom.pos[o]; y += s.panelGeom.pos[o + 1]; z += s.panelGeom.pos[o + 2];
      }
      return [x / 6, y / 6, z / 6];
    };
    const f = cent(0), b = cent(1);
    const df = Math.hypot(f[0] - (sg.x + sg.n[0] * 0.08), f[2] - (sg.z + sg.n[1] * 0.08));
    const db = Math.hypot(b[0] - (sg.x - sg.n[0] * 0.08), b[2] - (sg.z - sg.n[1] * 0.08));
    // Front-back separation must point along the facing normal.
    const sep = [f[0] - b[0], f[2] - b[2]];
    const sepLen = Math.hypot(sep[0], sep[1]);
    const along = sepLen > 0 ? (sep[0] * sg.n[0] + sep[1] * sg.n[1]) / sepLen : 0;
    if (df > 1.5 || db > 1.5 || Math.abs(sepLen - 0.16) > 0.05 || along < 0.9) bad++;
  }
  check('every panel has a back quad 0.16 m behind the front, along its normal', bad === 0, bad + ' bad panels');
}

// --- UVs: every quad maps a real atlas cell; dedup keeps cells < faces ---
{
  let bad = 0;
  const rects = new Set();
  for (let i = 0; i < s.panelGeom.uv.length; i += 2) {
    const u = s.panelGeom.uv[i], v = s.panelGeom.uv[i + 1];
    if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) bad++;
  }
  for (let q = 0; q < signs.length * 2; q++) {
    const o = q * 12; // 6 verts * 2 uv components
    const us = [0, 1, 2, 3, 4, 5].map((k) => s.panelGeom.uv[o + k * 2]);
    const vs = [0, 1, 2, 3, 4, 5].map((k) => s.panelGeom.uv[o + k * 2 + 1]);
    const u0 = Math.min(...us), u1 = Math.max(...us), v0 = Math.min(...vs), v1 = Math.max(...vs);
    if (!(u1 > u0 && v1 > v0)) bad++;
    rects.add(u0.toFixed(4) + ',' + v0.toFixed(4) + ',' + u1.toFixed(4) + ',' + v1.toFixed(4));
  }
  check('all panel UVs inside [0,1] and non-degenerate', bad === 0, bad + ' bad UVs');
  check('atlas dedup: distinct UV rects == atlas cells (' + s.counts.atlasCells + ')', rects.size === s.counts.atlasCells, rects.size + ' rects');
  check('atlas fits a texture: <= 4096 x 4096', s.atlasCanvas.width <= 4096 && s.atlasCanvas.height <= 4096, s.atlasCanvas.width + 'x' + s.atlasCanvas.height);
}

// --- Text + arrows: only the 9 district names, valid dirs, BFS-correct ---
{
  const names = new Set(Object.values(AREA_NAMES));
  let badName = 0, badDir = 0, badArrow = 0, badBack = 0;
  for (const sg of signs) {
    for (const line of [...sg.lines, ...sg.backLines]) {
      const [dir, ...rest] = line.split(' ');
      const text = rest.join(' ');
      if (!names.has(text)) badName++;
      if (!['up', 'left', 'right'].includes(dir)) badDir++;
    }
  // Arrow correctness, re-derived with the independent BFS above.
    // The BFS starts at the sign's own node (the intersection the builder
    // used) — NOT the nearest node to the sign's position: at river
    // intersections the intersection itself has no node, and the nearest
    // node to the sign can be a different one with different first steps.
    const node = nodeById.get(sg.node);
    const checkFace = (lineList, t) => {
      for (const line of lineList) {
        const [dir, ...rest] = line.split(' ');
        const key = districtKeyOf(rest.join(' '));
        if (!key) continue;
        const stepId = bfsFirstStep(node.id, repNode[key].id);
        if (stepId === null) { badArrow++; continue; }
        const step = nodeById.get(stepId);
        const d = { x: Math.sign(step.x - node.x), z: Math.sign(step.z - node.z) };
        if (classify(d, t) !== dir) badArrow++;
      }
    };
    // Front face: travel is opposite the facing normal.
    checkFace(sg.lines, { x: -sg.n[0], z: -sg.n[1] });
    // Back face: travel is along the facing normal.
    checkFace(sg.backLines, { x: sg.n[0], z: sg.n[1] });
    if (!sg.backLines.length) badBack++;
  }
  // No sign copies its front lines onto the back face. A genuine back
  // face can never be string-identical to the front: an 'up' first step
  // from one side is 'back' (undrawable) from the other, and a left/right
  // step swaps sides. Identical lines == the empty-back fallback copy,
  // whose arrows point backwards for the drivers behind the panel.
  check(
    'no sign copies its front lines onto the back face',
    signs.every((x) => JSON.stringify(x.lines) !== JSON.stringify(x.backLines)),
    signs.filter((x) => JSON.stringify(x.lines) === JSON.stringify(x.backLines)).length + ' copied backs',
  );
  check('all sign texts are the 9 district names', badName === 0, badName + ' bad names');
  check('all arrows are up/left/right (never back — undrawable)', badDir === 0, badDir + ' bad dirs');
  check('every arrow matches an independent BFS from the sign node', badArrow === 0, badArrow + ' wrong arrows');
  check('no sign has an empty back face', badBack === 0, badBack + ' blank backs');
}

// --- Sector signs: exactly the 2 nearest districts, front and back ---
{
  let badCount = 0, badNearest = 0;
  for (const sg of signs.filter((x) => x.kind === 'sector')) {
    if (sg.lines.length !== 2 || sg.backLines.length !== 2) { badCount++; continue; }
    const node = nodeById.get(sg.node);
    const dist = bfsDistances(node.id);
    // The 2 nearest non-back districts for each travel direction; the
    // sign must show one of the two sets (front faces one way, back the
    // other — the builder flips the panel when one way has <2).
    const nearestFor = (t) => {
      const out = [];
      const ranked = DISTRICT_TARGETS
        .map(([key]) => ({ key, d: dist.get(repNode[key].id) }))
        .filter((e) => e.d !== undefined && repNode[e.key].id !== node.id)
        .sort((a, b) => a.d - b.d);
      for (const { key } of ranked) {
        if (out.length >= 2) break;
        const stepId = bfsFirstStep(node.id, repNode[key].id);
        if (stepId === null) continue;
        const step = nodeById.get(stepId);
        const d = { x: Math.sign(step.x - node.x), z: Math.sign(step.z - node.z) };
        if (classify(d, t) === 'back') continue;
        out.push(AREA_NAMES[key]);
      }
      return out.sort().join('|');
    };
    const frontTexts = sg.lines.map((l) => l.split(' ').slice(1).join(' ')).sort().join('|');
    const backTexts = sg.backLines.map((l) => l.split(' ').slice(1).join(' ')).sort().join('|');
    const fwd = nearestFor({ x: -sg.n[0], z: -sg.n[1] });
    const bwd = nearestFor({ x: sg.n[0], z: sg.n[1] });
    if (frontTexts !== fwd && frontTexts !== bwd) badNearest++;
    if (backTexts !== fwd && backTexts !== bwd) badNearest++;
  }
  check('every sector sign shows exactly 2 destinations per face', badCount === 0, badCount + ' wrong counts');
  check('sector signs show the 2 nearest districts for their facing', badNearest === 0, badNearest + ' wrong sets');
}

// --- Placement: clear of river, buildings, stadium ---
{
  let inRiver = 0, inBldg = 0, inStad = 0;
  for (const sg of signs) {
    if (riverDistance(sg.x, sg.z) < 14) inRiver++;
    for (const b of city.buildings) {
      if (Math.abs(sg.x - b.x) < b.w / 2 + 0.5 && Math.abs(sg.z - b.z) < b.d / 2 + 0.5) { inBldg++; break; }
    }
    const st = city.stadium;
    if (st && sg.x >= st.x0 - 1 && sg.x <= st.x1 + 1 && sg.z >= st.z0 - 1 && sg.z <= st.z1 + 1) inStad++;
  }
  check('no sign stands in the river (<14 m)', inRiver === 0, inRiver + ' in river');
  check('no sign stands inside a building footprint', inBldg === 0, inBldg + ' in buildings');
  check('no sign stands inside the stadium', inStad === 0, inStad + ' in stadium');
}

console.log(fails === 0 ? 'ALL SIGNS TESTS PASSED' : fails + ' SIGNS TESTS FAILED');
process.exit(fails === 0 ? 0 : 1);
