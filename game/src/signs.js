// Teluk Rimba — direction signs. Green road signs at big intersections
// (pole signs) and over main roads (overhead gantries), with destination
// district names + arrows. Arrows point the TRUE direction: a BFS over the
// road graph from the sign's node to each district's representative node,
// and the first step of the route is classified against the travel
// direction (straight / left / right) — never guessed. Text is drawn once
// onto a single shared canvas atlas (bold white on green) and uploaded as
// one texture; every panel is one quad in a single static textured mesh.
// All code-made, all derived from the shared city dataset.
import { AREA_NAMES, MAIN_LINES, ASPHALT_HALF, CORRIDOR_HALF, riverDistance } from './city.js';
import { emptyGeom, plainBox } from './gl.js';

const CELL_W = 512, CELL_H = 256; // one atlas slot; a gantry panel takes 2
const ATLAS_COLS = 4;

// District representative points (nearest road node to each is the target).
const DISTRICT_TARGETS = [
  ['downtown', 0, 0], ['commercial', 350, -150], ['residential', -350, 350],
  ['beach', 550, -100], ['port', 450, 450], ['forest', -550, -550],
  ['river', 220, 10], ['plaza', 51, 51], ['market', 149, 51],
];

function buildAdjacency(city) {
  const adj = new Map();
  for (const e of city.edges) {
    if (!adj.has(e.a)) adj.set(e.a, []);
    if (!adj.has(e.b)) adj.set(e.b, []);
    adj.get(e.a).push(e.b);
    adj.get(e.b).push(e.a);
  }
  return adj;
}

// First step (neighbour id) on the shortest path start -> target, or null.
function bfsFirstStep(adj, startId, targetId) {
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
}

// Classify a step (axis unit vector d) against the travel direction t:
// 'up' (straight), 'left', 'right', 'back'.
function classifyStep(d, t) {
  const dot = d.x * t.x + d.z * t.z;
  if (dot > 0.5) return 'up';
  if (dot < -0.5) return 'back';
  const cross = t.z * d.x - t.x * d.z; // >0: d is to the left of t
  return cross > 0 ? 'left' : 'right';
}

function drawArrow(ctx, ax, ay, dir) {
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (dir === 'up') {
    ctx.moveTo(ax, ay + 16); ctx.lineTo(ax, ay - 6);
    ctx.moveTo(ax - 13, ay - 4); ctx.lineTo(ax + 13, ay - 4); ctx.lineTo(ax, ay - 20); ctx.closePath();
  } else if (dir === 'down') {
    ctx.moveTo(ax, ay - 16); ctx.lineTo(ax, ay + 6);
    ctx.moveTo(ax - 13, ay + 4); ctx.lineTo(ax + 13, ay + 4); ctx.lineTo(ax, ay + 20); ctx.closePath();
  } else if (dir === 'left') {
    ctx.moveTo(ax + 16, ay); ctx.lineTo(ax - 6, ay);
    ctx.moveTo(ax - 4, ay - 13); ctx.lineTo(ax - 4, ay + 13); ctx.lineTo(ax - 20, ay); ctx.closePath();
  } else { // right
    ctx.moveTo(ax - 16, ay); ctx.lineTo(ax + 6, ay);
    ctx.moveTo(ax + 4, ay - 13); ctx.lineTo(ax + 4, ay + 13); ctx.lineTo(ax + 20, ay); ctx.closePath();
  }
  ctx.stroke();
  ctx.fill();
}

function drawAtlas(signs) {
  // Greedy row fill: a pole sign takes 1 slot, a gantry sign 2 slots.
  let col = 0, row = 0;
  for (const s of signs) {
    if (col + s.slots > ATLAS_COLS) { col = 0; row++; }
    s.cell = { col, row, slots: s.slots };
    col += s.slots;
  }
  const rows = row + 1;
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_COLS * CELL_W;
  canvas.height = rows * CELL_H;
  const ctx = canvas.getContext('2d');
  for (const s of signs) {
    const x0 = s.cell.col * CELL_W, y0 = s.cell.row * CELL_H;
    const w = s.cell.slots * CELL_W;
    ctx.fillStyle = '#0a6e2e'; // highway green
    ctx.fillRect(x0, y0, w, CELL_H);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 6;
    ctx.strokeRect(x0 + 8, y0 + 8, w - 16, CELL_H - 16);
    const fontPx = s.slots === 2 ? 48 : 44;
    const lineH = 72;
    const lines = s.lines;
    const yStart = y0 + (CELL_H - lines.length * lineH) / 2 + lineH / 2;
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold ' + fontPx + 'px Arial, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    lines.forEach((ln, k) => {
      const y = yStart + k * lineH;
      drawArrow(ctx, x0 + 46, y, ln.dir);
      ctx.fillText(ln.text, x0 + 92, y);
    });
  }
  return { canvas, rows };
}

// Rotate a plainBox part by rotY (yaw) and move it to (cx, cy, cz),
// merging it into geom g (lit program: pos + nrm + col).
function addBoxAt(g, w, h, d, color, cx, cy, cz, rotY) {
  const part = plainBox(w, h, d, color);
  const c = Math.cos(rotY), s = Math.sin(rotY);
  for (let i = 0; i < part.pos.length; i += 3) {
    const px = part.pos[i], py = part.pos[i + 1], pz = part.pos[i + 2];
    part.pos[i] = cx + px * c + pz * s;
    part.pos[i + 1] = cy + py;
    part.pos[i + 2] = cz - px * s + pz * c;
  }
  for (let i = 0; i < part.nrm.length; i += 3) {
    const nx = part.nrm[i], nz = part.nrm[i + 2];
    part.nrm[i] = nx * c + nz * s;
    part.nrm[i + 2] = -nx * s + nz * c;
  }
  g.pos.push(...part.pos); g.nrm.push(...part.nrm); g.col.push(...part.col);
}

// One panel quad in world space, facing normal n (unit, horizontal),
// w wide x h tall, with atlas UV rect [u0, vBottom, u1, vTop].
function addPanelQuad(geom, cx, cy, cz, n, w, h, uv) {
  const r = [n[2], 0, -n[0]]; // panel's right vector (local +x)
  const p = (sr, sy) => [cx + r[0] * sr * w / 2, cy + sy * h / 2, cz + r[2] * sr * w / 2];
  const bl = p(-1, -1), br = p(1, -1), tr = p(1, 1), tl = p(-1, 1);
  const [u0, v0, u1, v1] = uv;
  const q = (P, u, v) => { geom.pos.push(...P); geom.uv.push(u, v); };
  q(bl, u0, v0); q(br, u1, v0); q(tr, u1, v1);
  q(bl, u0, v0); q(tr, u1, v1); q(tl, u0, v1);
}

export function buildDirectionSigns(city) {
  const adj = buildAdjacency(city);
  const nodeById = new Map(city.nodes.map((n) => [n.id, n]));
  const nearestNode = (x, z) => {
    let best = null, bd = Infinity;
    for (const n of city.nodes) {
      const d = (n.x - x) * (n.x - x) + (n.z - z) * (n.z - z);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  };
  const repNode = {};
  for (const [key, tx, tz] of DISTRICT_TARGETS) repNode[key] = nearestNode(tx, tz);
  // Graph segments, for checking a gantry's road really exists (the river
  // drops some main-road segments, e.g. (100,0)-(200,0)).
  const graphSegs = new Set();
  for (const e of city.edges) {
    const a = nodeById.get(e.a), b = nodeById.get(e.b);
    graphSegs.add(a.x + ',' + a.z + '|' + b.x + ',' + b.z);
  }

  // Destinations for a sign: BFS from startNode to each district, first
  // step classified vs the travel direction. One per direction (straight,
  // left, right), up to 3 — never a destination behind the driver.
  const destinations = (startNode, t) => {
    const byDir = {};
    for (const [key] of DISTRICT_TARGETS) {
      const target = repNode[key];
      if (!target || target.id === startNode.id) continue;
      const stepId = bfsFirstStep(adj, startNode.id, target.id);
      if (stepId === null) continue;
      const step = nodeById.get(stepId);
      const d = { x: Math.sign(step.x - startNode.x), z: Math.sign(step.z - startNode.z) };
      const dir = classifyStep(d, t);
      if (dir === 'back') continue;
      if (!byDir[dir]) byDir[dir] = AREA_NAMES[key];
    }
    const lines = [];
    for (const dir of ['up', 'left', 'right']) {
      if (byDir[dir]) lines.push({ dir, text: byDir[dir] });
    }
    return lines.slice(0, 3);
  };

  const signs = [];
  // ---- Pole signs: 12 main x main intersections (checkerboard spread),
  // panel 5 x 2.4 m on a pole at the sidewalk's outer edge, facing
  // oncoming traffic on one approach (alternating approaches).
  {
    const mains = [...MAIN_LINES].sort((a, b) => a - b);
    const picks = [];
    for (let i = 0; i < mains.length; i++) {
      for (let j = 0; j < mains.length; j++) {
        if ((i + j) % 2 === 0) picks.push([mains[i], mains[j]]);
      }
    }
    picks.slice(0, 12).forEach(([Lx, Lz], k) => {
      const o = CORRIDOR_HALF(Lx) - 0.3;
      let px = null, pz = null;
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const x = Lx + sx * o, z = Lz + sz * o;
        if (riverDistance(x, z) >= 14) { px = x; pz = z; break; }
      }
      if (px === null) return;
      const n = k % 2 === 0 ? [-1, 0, 0] : [0, 0, -1]; // faces oncoming drivers
      const t = { x: -n[0], z: -n[2] }; // travel direction
      const node = nearestNode(Lx, Lz);
      const lines = destinations(node, t);
      if (!lines.length) return;
      signs.push({ kind: 'pole', x: px, z: pz, n, panelW: 5, panelH: 2.4, panelY: 3.4, slots: 1, lines });
    });
  }
  // ---- Gantry signs: over main roads, mid-block, panel 8 x 2 m hanging
  // from a beam on two posts. Travel direction is the road direction.
  {
    const horiz = [[150, -400], [150, -200], [-150, 0], [150, 200], [150, 400]];
    for (const [gx, L] of horiz) {
      const segA = (gx > 0 ? 100 : -200) + ',' + L + '|' + (gx > 0 ? 200 : -100) + ',' + L;
      if (!graphSegs.has(segA)) continue; // road dropped (river)
      const n = [-1, 0, 0], t = { x: 1, z: 0 };
      const node = nearestNode(gx + 60, L);
      const lines = destinations(node, t);
      if (!lines.length) continue;
      signs.push({ kind: 'gantryH', x: gx, z: L, n, panelW: 8, panelH: 2, panelY: 4.6, slots: 2, lines });
    }
    for (const L of [-200, 0, 200]) {
      const segA = L + ',100|' + L + ',200';
      if (!graphSegs.has(segA)) continue;
      const n = [0, 0, -1], t = { x: 0, z: 1 };
      const node = nearestNode(L, 210);
      const lines = destinations(node, t);
      if (!lines.length) continue;
      signs.push({ kind: 'gantryV', x: L, z: 150, n, panelW: 8, panelH: 2, panelY: 4.6, slots: 2, lines });
    }
  }

  const { canvas: atlasCanvas, rows: atlasRows } = drawAtlas(signs);
  const atlasW = ATLAS_COLS * CELL_W, atlasH = atlasRows * CELL_H;
  const panelGeom = { pos: [], uv: [] };
  const poleGeom = emptyGeom();
  const POLE_COL = [0.3, 0.32, 0.34];
  const BACK_COL = [0.05, 0.35, 0.15]; // dark green backing behind the panel
  for (const s of signs) {
    const u0 = (s.cell.col * CELL_W) / atlasW;
    const u1 = ((s.cell.col + s.cell.slots) * CELL_W) / atlasW;
    const vTop = 1 - (s.cell.row * CELL_H) / atlasH;
    const vBottom = 1 - ((s.cell.row + 1) * CELL_H) / atlasH;
    const rotY = Math.atan2(s.n[0], s.n[2]);
    // Backing box behind the panel (0.12 deep, panel sits 0.02 proud).
    addBoxAt(poleGeom, s.panelW + 0.3, s.panelH + 0.3, 0.12, BACK_COL, s.x, s.panelY, s.z, rotY);
    addPanelQuad(panelGeom, s.x + s.n[0] * 0.08, s.panelY, s.z + s.n[2] * 0.08, s.n, s.panelW, s.panelH, [u0, vBottom, u1, vTop]);
    if (s.kind === 'pole') {
      addBoxAt(poleGeom, 0.25, 2.2, 0.25, POLE_COL, s.x, 1.1, s.z, 0);
    } else if (s.kind === 'gantryH') {
      const ah = ASPHALT_HALF(s.z);
      for (const side of [-1, 1]) addBoxAt(poleGeom, 0.3, 5.8, 0.3, POLE_COL, s.x, 2.9, s.z + side * (ah + 1), 0);
      addBoxAt(poleGeom, 0.3, 0.4, (ah + 1) * 2 + 0.6, POLE_COL, s.x, 5.8, s.z, 0);
    } else { // gantryV
      const ah = ASPHALT_HALF(s.x);
      for (const side of [-1, 1]) addBoxAt(poleGeom, 0.3, 5.8, 0.3, POLE_COL, s.x + side * (ah + 1), 2.9, s.z, 0);
      addBoxAt(poleGeom, (ah + 1) * 2 + 0.6, 0.4, 0.3, POLE_COL, s.x, 5.8, s.z, 0);
    }
  }

  return {
    panelGeom, poleGeom, atlasCanvas,
    signs: signs.map((s) => ({
      kind: s.kind, x: Math.round(s.x), z: Math.round(s.z),
      lines: s.lines.map((l) => l.dir + ' ' + l.text),
    })),
    counts: {
      pole: signs.filter((s) => s.kind === 'pole').length,
      gantry: signs.filter((s) => s.kind !== 'pole').length,
      total: signs.length,
    },
  };
}
