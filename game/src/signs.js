// Teluk Rimba — direction signs. Green road signs at big intersections
// (pole signs) and over main roads (overhead gantries), with destination
// district names + arrows. Arrows point the TRUE direction: a BFS over the
// road graph from the sign's node to each district's representative node,
// and the first step of the route is classified against the travel
// direction (straight / left / right) — never guessed. Text is drawn once
// onto a single shared canvas atlas (bold white on green) and uploaded as
// one texture; every panel is one quad in a single static textured mesh.
// All code-made, all derived from the shared city dataset.
//
// Mu 23 Nov 23:31: a sign panel must read from BOTH sides — the old panel
// was a single textured quad in front of a dark-green backing box, so from
// behind you saw a blank green board. Every panel now carries a second
// textured quad on its back face (same atlas, own cell: the arrows are
// recomputed for traffic coming from the opposite direction, so they stay
// true from either side, and the text is never mirrored).
//
// Mu 23 Nov 23:32: coverage — a sign in EVERY road sector (block). The
// original 20 signs only covered 52 of 138 non-river blocks, so one pole
// sign is added at a corner of every block that has none yet, showing its
// 2 nearest districts. Atlas cells are deduplicated by content (many signs
// share the same two destinations), so the atlas stays one texture and the
// panels stay one draw call.
import { AREA_NAMES, MAIN_LINES, ROAD_LINES, ASPHALT_HALF, CORRIDOR_HALF, riverDistance } from './city.js';
import { emptyGeom, plainBox } from './gl.js';

const CELL_W = 512, CELL_H = 256; // one atlas slot; a gantry panel takes 2
const ATLAS_COLS = 8;

// District representative points (nearest road node to each is the target).
// Exported for tests (arrow correctness is re-checked independently).
export const DISTRICT_TARGETS = [
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
  // One atlas cell per UNIQUE face content (front and back faces are
  // separate cells — the back face shows different arrows). Signs with
  // identical lines share a cell, which is what keeps the atlas small
  // when there are ~100 signs: only the distinct texts are drawn.
  const cellOf = new Map();
  let col = 0, row = 0;
  const takeCell = (lines, slots) => {
    const key = JSON.stringify(lines) + '|' + slots;
    if (cellOf.has(key)) return cellOf.get(key);
    if (col + slots > ATLAS_COLS) { col = 0; row++; }
    const cell = { col, row, slots, lines };
    cellOf.set(key, cell);
    col += slots;
    return cell;
  };
  for (const s of signs) {
    s.frontCell = takeCell(s.lines, s.slots);
    s.backCell = takeCell(s.backLines, s.slots);
  }
  const rows = row + 1;
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_COLS * CELL_W;
  canvas.height = rows * CELL_H;
  const ctx = canvas.getContext('2d');
  const drawCell = (cell) => {
    const x0 = cell.col * CELL_W, y0 = cell.row * CELL_H;
    const w = cell.slots * CELL_W;
    ctx.fillStyle = '#0a6e2e'; // highway green
    ctx.fillRect(x0, y0, w, CELL_H);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 6;
    ctx.strokeRect(x0 + 8, y0 + 8, w - 16, CELL_H - 16);
    const fontPx = cell.slots === 2 ? 48 : 44;
    const lineH = 72;
    const lines = cell.lines;
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
  };
  for (const cell of cellOf.values()) drawCell(cell);
  return { canvas, rows, cells: cellOf.size };
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
// Exported: the shop signs (shopsigns.js) reuse it for their name boards.
export function addPanelQuad(geom, cx, cy, cz, n, w, h, uv) {
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
      // Back face: arrows for traffic coming from the opposite direction.
      // (Never blank: if the reversed view somehow has no line, reuse the
      // front lines rather than leaving a green board.)
      const backLines = destinations(node, { x: -t.x, z: -t.z });
      signs.push({ kind: 'pole', node: node.id, x: px, z: pz, n, panelW: 5, panelH: 2.4, panelY: 3.4, slots: 1, lines, backLines: backLines.length ? backLines : lines });
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
      const backLines = destinations(node, { x: -t.x, z: -t.z });
      signs.push({ kind: 'gantryH', node: node.id, x: gx, z: L, n, panelW: 8, panelH: 2, panelY: 4.6, slots: 2, lines, backLines: backLines.length ? backLines : lines });
    }
    for (const L of [-200, 0, 200]) {
      const segA = L + ',100|' + L + ',200';
      if (!graphSegs.has(segA)) continue;
      const n = [0, 0, -1], t = { x: 0, z: 1 };
      const node = nearestNode(L, 210);
      const lines = destinations(node, t);
      if (!lines.length) continue;
      const backLines = destinations(node, { x: -t.x, z: -t.z });
      signs.push({ kind: 'gantryV', node: node.id, x: L, z: 150, n, panelW: 8, panelH: 2, panelY: 4.6, slots: 2, lines, backLines: backLines.length ? backLines : lines });
    }
  }

  // ---- Sector signs (Mu 23 Nov 23:32): one pole sign in EVERY road
  // sector (block) that has no sign yet, showing its 2 nearest districts.
  // The original 20 signs only covered 52 of 138 non-river blocks.
  let sectorAdded = 0;
  {
    const nodeByIJ = new Map(city.nodes.map((n) => [n.i + ',' + n.j, n]));
    // BFS hop distance from a node to every other node.
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
    // The 2 nearest districts (by BFS hops), with arrows classified
    // against the travel direction t. 'back' steps are skipped — the
    // next-nearest district takes their place, so a sign always shows
    // exactly 2 readable destinations.
    const nearestTwo = (startNode, t) => {
      const dist = bfsDistances(startNode.id);
      const ranked = DISTRICT_TARGETS
        .map(([key]) => ({ key, d: dist.get(repNode[key].id) }))
        .filter((e) => e.d !== undefined && repNode[e.key].id !== startNode.id)
        .sort((a, b) => a.d - b.d);
      const lines = [];
      for (const { key } of ranked) {
        if (lines.length >= 2) break;
        const target = repNode[key];
        const stepId = bfsFirstStep(adj, startNode.id, target.id);
        if (stepId === null) continue;
        const step = nodeById.get(stepId);
        const d = { x: Math.sign(step.x - startNode.x), z: Math.sign(step.z - startNode.z) };
        const dir = classifyStep(d, t);
        if (dir === 'back') continue;
        lines.push({ dir, text: AREA_NAMES[key] });
      }
      const order = { up: 0, left: 1, right: 2, back: 3 };
      lines.sort((a, b) => order[a.dir] - order[b.dir]);
      return lines;
    };
    const clearOfBuildings = (x, z) => {
      for (const b of city.buildings) {
        if (Math.abs(x - b.x) < b.w / 2 + 0.5 && Math.abs(z - b.z) < b.d / 2 + 0.5) return false;
      }
      return true;
    };
    const clearOfStadium = (x, z) => {
      const st = city.stadium;
      if (!st) return true;
      return !(x >= st.x0 - 1 && x <= st.x1 + 1 && z >= st.z0 - 1 && z <= st.z1 + 1);
    };
    const nearOtherSign = (x, z) => signs.some((s) => Math.hypot(s.x - x, s.z - z) < 12);
    const blockCovered = (b) => signs.some((s) =>
      s.x >= b.x0 - 20 && s.x <= b.x1 + 20 && s.z >= b.z0 - 20 && s.z <= b.z1 + 20);
    for (const b of city.blocks) {
      if (b.zone === 'river') continue; // water — no road sector to sign
      if (blockCovered(b)) continue;
      // Try the block's corners (rotated order, so neighbouring blocks
      // don't all pile their sign on the same intersection).
      const corners = [[b.i, b.j], [b.i + 1, b.j + 1], [b.i + 1, b.j], [b.i, b.j + 1]];
      const rot = (b.i + b.j) % 4;
      // Prefer a corner whose sign is readable from BOTH sides (2 front +
      // 2 back destinations). A funnel intersection — e.g. node 23, where
      // every district's first step is 'back' from one side — yields an
      // empty back face, and copying the front lines there would print
      // arrows that point backwards for the drivers behind the panel.
      let placed = null; // first corner with >= 2 front destinations
      let best = null;   // first corner with >= 2 front AND >= 2 back
      for (let k = 0; k < 4; k++) {
        const [ci, cj] = corners[(rot + k) % 4];
        const node = nodeByIJ.get(ci + ',' + cj);
        if (!node) continue; // pruned / in the river
        const Lx = ROAD_LINES[ci], Lz = ROAD_LINES[cj];
        const sx = Math.sign(b.cx - Lx) || 1, sz = Math.sign(b.cz - Lz) || 1;
        const px = Lx + sx * (CORRIDOR_HALF(Lx) - 0.3);
        const pz = Lz + sz * (CORRIDOR_HALF(Lz) - 0.3);
        if (riverDistance(px, pz) < 14) continue;
        if (!clearOfBuildings(px, pz) || !clearOfStadium(px, pz)) continue;
        if (nearOtherSign(px, pz)) continue;
        // Try both panel facings (parity facing first, so facing variety
        // across blocks is kept). A facing whose back side looks out to
        // the map edge — or into a funnel — has no destinations behind
        // it, so its back face would be empty; the other facing is
        // readable from both sides (e.g. node 35: [-1,0,0] gives back 0,
        // [0,0,-1] gives front 2 + back 2).
        const facings = (b.i + b.j) % 2 === 0
          ? [[-1, 0, 0], [0, 0, -1]]
          : [[0, 0, -1], [-1, 0, 0]];
        for (const n0 of facings) {
          let n = n0;
          let t = { x: -n[0], z: -n[2] };
          let lines = nearestTwo(node, t);
          if (lines.length < 2) {
            // This approach has <2 destinations ahead — e.g. at a river
            // crossing every route starts by going back — so face the sign
            // to the opposite approach instead, where destinations lie ahead.
            n = [-n[0], 0, -n[2]];
            t = { x: -n[0], z: -n[2] };
            const flipped = nearestTwo(node, t);
            if (flipped.length > lines.length) lines = flipped;
          }
          if (!lines.length) continue;
          const backLines = nearestTwo(node, { x: -t.x, z: -t.z });
          const cand = { node, px, pz, n, lines, backLines };
          if (!placed && lines.length >= 2) placed = cand;
          if (lines.length >= 2 && backLines.length >= 2) { best = cand; break; }
        }
        if (best) break;
      }
      const chosen = best || placed;
      if (!chosen) continue;
      signs.push({ kind: 'sector', node: chosen.node.id, x: chosen.px, z: chosen.pz, n: chosen.n, panelW: 5, panelH: 2.4, panelY: 3.4, slots: 1, lines: chosen.lines, backLines: chosen.backLines.length ? chosen.backLines : chosen.lines });
      sectorAdded++;
    }
  }

  const { canvas: atlasCanvas, rows: atlasRows, cells: atlasCells } = drawAtlas(signs);
  const atlasW = ATLAS_COLS * CELL_W, atlasH = atlasRows * CELL_H;
  const panelGeom = { pos: [], uv: [] };
  const poleGeom = emptyGeom();
  const POLE_COL = [0.3, 0.32, 0.34];
  const BACK_COL = [0.05, 0.35, 0.15]; // dark green backing behind the panel
  const uvFor = (cell) => {
    const u0 = (cell.col * CELL_W) / atlasW;
    const u1 = ((cell.col + cell.slots) * CELL_W) / atlasW;
    const vTop = 1 - (cell.row * CELL_H) / atlasH;
    const vBottom = 1 - ((cell.row + 1) * CELL_H) / atlasH;
    return [u0, vBottom, u1, vTop];
  };
  for (const s of signs) {
    const rotY = Math.atan2(s.n[0], s.n[2]);
    // Backing box behind the panel (0.12 deep, each quad sits 0.02 proud
    // of its face — front quad at +0.08, back quad at -0.08).
    addBoxAt(poleGeom, s.panelW + 0.3, s.panelH + 0.3, 0.12, BACK_COL, s.x, s.panelY, s.z, rotY);
    addPanelQuad(panelGeom, s.x + s.n[0] * 0.08, s.panelY, s.z + s.n[2] * 0.08, s.n, s.panelW, s.panelH, uvFor(s.frontCell));
    // Back face: same panel, opposite normal — addPanelQuad's right vector
    // flips with the normal, so the text reads correctly (not mirrored)
    // for drivers coming from the other direction.
    addPanelQuad(panelGeom, s.x - s.n[0] * 0.08, s.panelY, s.z - s.n[2] * 0.08, [-s.n[0], 0, -s.n[2]], s.panelW, s.panelH, uvFor(s.backCell));
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
      kind: s.kind, node: s.node, x: Math.round(s.x), z: Math.round(s.z),
      n: [s.n[0], s.n[2]],
      lines: s.lines.map((l) => l.dir + ' ' + l.text),
      backLines: s.backLines.map((l) => l.dir + ' ' + l.text),
    })),
    counts: {
      pole: signs.filter((s) => s.kind === 'pole').length,
      gantry: signs.filter((s) => s.kind !== 'pole' && s.kind !== 'sector').length,
      sector: sectorAdded,
      total: signs.length,
      atlasCells,
      atlasRows,
    },
  };
}
