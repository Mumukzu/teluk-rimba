// Teluk Rimba — marked parking zones (Phase I, Mu).
// For LARGE buildings whose yard has space: a paved parking lot with
// 2 rows of 5 bays (2.5x5 m) facing a 6 m central lane, white bay lines,
// P symbols in the empty bays, ONE disabled bay per lot (blue + white
// wheelchair pictogram), white arrows on the lane, 2-4 parked cars
// nose-in. All code-made, derived from the shared city dataset.
// The textured ground symbols use OPAQUE cell backgrounds (the textured
// program outputs alpha 1.0, so transparent canvas pixels would render
// black): each cell is a painted square on the pad. The atlas canvas is
// only drawn in the browser — buildParking runs in Node tests too, where
// document does not exist, so the canvas is created lazily (null in Node)
// while the panel geometry (pure positions + UVs) is always built.
import { mulberry32, range, rangeInt } from './rng.js';
import { riverDistance } from './city.js';
import { emptyGeom, plainBox, prismY } from './gl.js';
import { distinctColor } from './vehicles.js';

// Lot layout (local frame: u along the row, v along the depth).
const LOT_U = 12.5; // 5 bays x 2.5 m
const LOT_V = 16;   // 5 m bay + 6 m lane + 5 m bay
const BAY_W = 2.5, BAY_D = 5, LANE_W = 6;
const PAD_COL = [0.32, 0.32, 0.34];   // dark asphalt pad
const LINE_COL = [0.92, 0.92, 0.9];   // white paint
const PAD_Y = 0.08, LINE_Y = 0.09, SYM_Y = 0.1;
const TARGET_LOTS = 20;

// Atlas: 2 cells of 256x256 — "P" (pad-dark bg, white letter) and the
// wheelchair pictogram (blue bg, white icon drawn with canvas paths).
const CELL = 256, ATLAS_COLS = 2;
const P_CELL = 0, WHEEL_CELL = 1;

const SIMPLE_TYRE = [0.07, 0.07, 0.08];
const SIMPLE_GLASS = [0.12, 0.16, 0.22];
const SIMPLE_LAMP = [1.0, 0.95, 0.75];
const SIMPLE_TAIL = [0.8, 0.15, 0.1];

// Tilt a part around the X axis (local space). Used for the simple parked
// cars' wheels (prismY axis -> Z). Moved here from plots.js with the
// simple parked car geometry (plots.js imports it from here).
function tiltX(part, a) {
  const c = Math.cos(a), s = Math.sin(a);
  for (let i = 0; i < part.pos.length; i += 3) {
    const y = part.pos[i + 1], z = part.pos[i + 2];
    part.pos[i + 1] = y * c - z * s;
    part.pos[i + 2] = y * s + z * c;
  }
  for (let i = 0; i < part.nrm.length; i += 3) {
    const ny = part.nrm[i + 1], nz = part.nrm[i + 2];
    part.nrm[i + 1] = ny * c - nz * s;
    part.nrm[i + 2] = ny * s + nz * c;
  }
  return part;
}

// Low-poly parked car (~230 tris vs ~2,100 for the sculpted one): body +
// glass cabin + 10-sided ROUND wheels (never square tyres) + lamps.
// Built fresh per car (plainBox is trivial, no template cache needed).
export function simpleParkedCarGeom(color) {
  const g = emptyGeom();
  const at = (part, x, y, z) => {
    for (let i = 0; i < part.pos.length; i += 3) { part.pos[i] += x; part.pos[i + 1] += y; part.pos[i + 2] += z; }
    g.pos.push(...part.pos); g.nrm.push(...part.nrm); g.col.push(...part.col);
  };
  at(plainBox(4.0, 0.5, 1.85, color), 0, 0.55, 0); // body
  at(plainBox(2.0, 0.45, 1.6, SIMPLE_GLASS), -0.15, 1.0, 0); // cabin
  for (const [wx, wz] of [[1.35, 0.82], [1.35, -0.82], [-1.35, 0.82], [-1.35, -0.82]]) {
    at(tiltX(prismY(10, 0.32, 0.24, SIMPLE_TYRE), -Math.PI / 2), wx, 0.32, wz);
  }
  at(plainBox(0.1, 0.12, 0.3, SIMPLE_LAMP), 2.0, 0.55, 0.6); // headlights
  at(plainBox(0.1, 0.12, 0.3, SIMPLE_LAMP), 2.0, 0.55, -0.6);
  at(plainBox(0.1, 0.12, 0.3, SIMPLE_TAIL), -2.0, 0.55, 0.6); // taillights
  at(plainBox(0.1, 0.12, 0.3, SIMPLE_TAIL), -2.0, 0.55, -0.6);
  return g;
}

// Yaw transform (same convention as plots.js addPart): local (u, v) ->
// world (x, z): x = cx + u*c + v*s, z = cz - u*s + v*c.
function toWorld(cx, cz, rot, u, v) {
  const c = Math.cos(rot), s = Math.sin(rot);
  return [cx + u * c + v * s, cz - u * s + v * c];
}

// Up-facing quad in the lot's local frame (u0,v0)-(u1,v1), wound like
// plots.js quadUp (A,C,B / A,D,C) so the front face points up.
function quadUpRot(g, cx, cz, rot, u0, v0, u1, v1, y, col) {
  const A = toWorld(cx, cz, rot, u0, v0), B = toWorld(cx, cz, rot, u1, v0);
  const C = toWorld(cx, cz, rot, u1, v1), D = toWorld(cx, cz, rot, u0, v1);
  const P = ([x, z]) => [x, y, z];
  const n = [0, 1, 0];
  g.pos.push(...P(A), ...P(C), ...P(B), ...P(A), ...P(D), ...P(C));
  for (let k = 0; k < 6; k++) { g.nrm.push(...n); g.col.push(...col); }
}

// Up-facing triangle in the lot's local frame. The three points must be
// given in an order whose 2D cross product in (u, v) is negative (the
// same winding quadUp uses) so the front face points up.
function triUpRot(g, cx, cz, rot, p1, p2, p3, y, col) {
  const P = ([u, v]) => { const [x, z] = toWorld(cx, cz, rot, u, v); return [x, y, z]; };
  const n = [0, 1, 0];
  g.pos.push(...P(p1), ...P(p2), ...P(p3));
  for (let k = 0; k < 3; k++) { g.nrm.push(...n); g.col.push(...col); }
}

// Rotate a part by yaw and move it to (x, y, z), merging into geom g
// (same convention as plots.js addPart).
function addPart(g, part, x, y, z, rot) {
  const c = Math.cos(rot), s = Math.sin(rot);
  for (let i = 0; i < part.pos.length; i += 3) {
    const px = part.pos[i], py = part.pos[i + 1], pz = part.pos[i + 2];
    part.pos[i] = x + px * c + pz * s;
    part.pos[i + 1] = py + y;
    part.pos[i + 2] = z - px * s + pz * c;
  }
  for (let i = 0; i < part.nrm.length; i += 3) {
    const nx = part.nrm[i], nz = part.nrm[i + 2];
    part.nrm[i] = nx * c + nz * s;
    part.nrm[i + 2] = -nx * s + nz * c;
  }
  g.pos.push(...part.pos); g.nrm.push(...part.nrm); g.col.push(...part.col);
}

// One ground symbol quad (textured, positions + UVs only): w wide (local
// u) x h tall (local v), centred at (cx, cz), yaw rot — local +v (canvas
// up) maps to world (sin rot, cos rot). Wound up-facing like quadUp.
function addGroundSymbol(geom, cx, cz, rot, w, h, uv) {
  const A = toWorld(cx, cz, rot, -w / 2, -h / 2), B = toWorld(cx, cz, rot, w / 2, -h / 2);
  const C = toWorld(cx, cz, rot, w / 2, h / 2), D = toWorld(cx, cz, rot, -w / 2, h / 2);
  const [u0, v0, u1, v1] = uv;
  const q = (P, u, v) => { geom.pos.push(P[0], SYM_Y, P[1]); geom.uv.push(u, v); };
  q(A, u0, v0); q(C, u1, v1); q(B, u1, v0);
  q(A, u0, v0); q(D, u0, v1); q(C, u1, v1);
}

// Wheelchair pictogram, drawn with canvas paths (never a Unicode glyph):
// head + seated figure + big wheel, all white on the blue cell.
function drawWheelchair(ctx, x0, y0, s) {
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#ffffff';
  ctx.lineWidth = 13 * s;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Big wheel.
  ctx.beginPath();
  ctx.arc(x0 + 105 * s, y0 + 178 * s, 52 * s, 0, Math.PI * 2);
  ctx.stroke();
  // Seat + back + leg.
  ctx.beginPath();
  ctx.moveTo(x0 + 105 * s, y0 + 122 * s);
  ctx.lineTo(x0 + 105 * s, y0 + 72 * s); // backrest up
  ctx.moveTo(x0 + 105 * s, y0 + 122 * s);
  ctx.lineTo(x0 + 168 * s, y0 + 122 * s); // seat
  ctx.lineTo(x0 + 168 * s, y0 + 178 * s); // leg down
  ctx.lineTo(x0 + 196 * s, y0 + 178 * s); // foot
  ctx.stroke();
  // Head.
  ctx.beginPath();
  ctx.arc(x0 + 152 * s, y0 + 52 * s, 16 * s, 0, Math.PI * 2);
  ctx.fill();
}

// Draw the 2-cell atlas (browser only; null in Node tests).
function drawParkingAtlas() {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_COLS * CELL;
  canvas.height = CELL;
  const ctx = canvas.getContext('2d');
  // Cell 0: "P" — pad-dark background, white letter.
  ctx.fillStyle = '#515154';
  ctx.fillRect(0, 0, CELL, CELL);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 180px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('P', CELL / 2, CELL / 2 + 8);
  // Cell 1: disabled — blue background, white wheelchair pictogram.
  ctx.fillStyle = '#1d4ed8';
  ctx.fillRect(CELL, 0, CELL, CELL);
  drawWheelchair(ctx, CELL, 0, 1);
  return canvas;
}

function footprint(b) {
  const w = b.rot ? b.d : b.w, d = b.rot ? b.w : b.d;
  return { x0: b.x - w / 2, x1: b.x + w / 2, z0: b.z - d / 2, z1: b.z + d / 2 };
}

function rectsOverlap(a, b, m = 0) {
  return a.x0 - m < b.x1 && a.x1 + m > b.x0 && a.z0 - m < b.z1 && a.z1 + m > b.z0;
}

// Door strip in front of a building (world axis-aligned rect): the door
// sits at the front-face centre, canopy reaching ~1 m out; the strip is
// along in [-0.5, 3.0] and |across| < 2.2.
function doorStripRect(b) {
  const nx = Math.sin(b.rot), nz = Math.cos(b.rot);
  const fx = b.x + nx * (b.d / 2), fz = b.z + nz * (b.d / 2);
  const cx = fx + nx * 1.25, cz = fz + nz * 1.25;
  const hn = 1.75, ha = 2.2; // half-extents along normal / across
  if (Math.abs(nz) > 0.5) return { x0: cx - ha, x1: cx + ha, z0: cz - hn, z1: cz + hn };
  return { x0: cx - hn, x1: cx + hn, z0: cz - ha, z1: cz + ha };
}

export function buildParking(city) {
  const rand = mulberry32(20261135);
  const markings = emptyGeom();
  const cars = emptyGeom();
  const symbols = { pos: [], uv: [] };
  const lots = [];
  let colorIdx = 5000; // own range of the distinct-colour allocator
  let parked = 0, bays = 0, pSymbols = 0;

  // Big buildings, largest first (deterministic tie-break by position).
  const big = city.buildings
    .filter((b) => (b.zone === 'downtown' || b.zone === 'port' || b.zone === 'beach' || b.zone === 'commercial')
      && Math.max(b.w, b.d) >= 20)
    .sort((a, b) => Math.max(b.w, b.d) - Math.max(a.w, a.d) || a.x - b.x || a.z - b.z);
  const blockOf = new Map();
  for (const b of city.buildings) {
    const blk = city.blocks.find((bl) => b.x >= bl.x0 && b.x <= bl.x1 && b.z >= bl.z0 && b.z <= bl.z1);
    if (blk) blockOf.set(b, blk);
  }

  for (const b of big) {
    if (lots.length >= TARGET_LOTS) break;
    const blk = blockOf.get(b);
    if (!blk) continue;
    const fw = b.rot ? b.d : b.w, fd = b.rot ? b.w : b.d; // visual extents
    const nx = Math.sin(b.rot), nz = Math.cos(b.rot); // front normal
    const ax = Math.cos(b.rot), az = -Math.sin(b.rot); // across
    const sibs = city.buildings.filter((s) => s.x >= blk.x0 && s.x <= blk.x1 && s.z >= blk.z0 && s.z <= blk.z1);
    // Candidate lot centres: both sides (v axis along the across
    // direction, R = rot - PI/2) and behind (v axis along the front
    // normal, R = rot). Never in front of the door.
    const cands = [];
    for (const side of [1, -1]) {
      cands.push({
        cx: b.x + ax * side * (fw / 2 + 2 + LOT_V / 2),
        cz: b.z + az * side * (fw / 2 + 2 + LOT_V / 2),
        R: b.rot - Math.PI / 2,
      });
    }
    cands.push({
      cx: b.x - nx * (fd / 2 + 2 + LOT_V / 2),
      cz: b.z - nz * (fd / 2 + 2 + LOT_V / 2),
      R: b.rot,
    });
    let placed = null;
    for (const c of cands) {
      // World axis-aligned rect of the lot (rot is 0 or PI/2, so the
      // lot is axis-aligned) — computed from the lot's local corners.
      const corners = [
        toWorld(c.cx, c.cz, c.R, -LOT_U / 2, -LOT_V / 2),
        toWorld(c.cx, c.cz, c.R, LOT_U / 2, -LOT_V / 2),
        toWorld(c.cx, c.cz, c.R, -LOT_U / 2, LOT_V / 2),
        toWorld(c.cx, c.cz, c.R, LOT_U / 2, LOT_V / 2),
      ];
      const xs = corners.map((p) => p[0]), zs = corners.map((p) => p[1]);
      const rect = {
        x0: Math.min(...xs), x1: Math.max(...xs),
        z0: Math.min(...zs), z1: Math.max(...zs),
      };
      // (1) Inside the block, >= 3 m from its edges.
      if (rect.x0 < blk.x0 + 3 || rect.x1 > blk.x1 - 3 || rect.z0 < blk.z0 + 3 || rect.z1 > blk.z1 - 3) continue;
      // (2) Clear of every building in the block (+1.5 m).
      if (sibs.some((s) => rectsOverlap(rect, footprint(s), 1.5))) continue;
      // (3) Clear of every door strip in the block (+1 m).
      if (sibs.some((s) => rectsOverlap(rect, doorStripRect(s), 1))) continue;
      // (4) Clear of the river.
      const pts = [[rect.x0, rect.z0], [rect.x1, rect.z0], [rect.x0, rect.z1], [rect.x1, rect.z1], [c.cx, c.cz]];
      if (pts.some(([x, z]) => riverDistance(x, z) < 25)) continue;
      // (5) Clear of other lots (+2 m).
      if (lots.some((l) => rectsOverlap(rect, l.rect, 2))) continue;
      placed = { ...c, rect, building: b };
      break;
    }
    if (!placed) continue;
    lots.push(placed);
  }

  // --- Build the geometry for every placed lot. ---
  const atlasW = ATLAS_COLS * CELL, atlasH = CELL;
  const cellUV = (cell) => {
    const u0 = (cell * CELL) / atlasW, u1 = ((cell + 1) * CELL) / atlasW;
    return [u0, 0, u1, 1]; // single row: vBottom 0, vTop 1
  };
  for (const lot of lots) {
    const { cx, cz, R } = lot;
    // Pad (dark asphalt over the yard paving).
    quadUpRot(markings, cx, cz, R, -LOT_U / 2, -LOT_V / 2, LOT_U / 2, LOT_V / 2, PAD_Y, PAD_COL);
    // Bay lines: long lines along u at v = -8, -3, +3, +8.
    for (const v of [-LOT_V / 2, -LANE_W / 2, LANE_W / 2, LOT_V / 2]) {
      quadUpRot(markings, cx, cz, R, -LOT_U / 2, v - 0.06, LOT_U / 2, v + 0.06, LINE_Y, LINE_COL);
    }
    // Divider lines along v at u = -6.25 + 2.5k, both rows.
    for (let k = 0; k <= 5; k++) {
      const u = -LOT_U / 2 + k * BAY_W;
      quadUpRot(markings, cx, cz, R, u - 0.06, -LOT_V / 2, u + 0.06, -LANE_W / 2, LINE_Y, LINE_COL);
      quadUpRot(markings, cx, cz, R, u - 0.06, LANE_W / 2, u + 0.06, LOT_V / 2, LINE_Y, LINE_COL);
    }
    // Arrows on the lane (one-way, pointing +u): shaft + triangle head.
    for (const au of [-3, 3]) {
      quadUpRot(markings, cx, cz, R, au - 0.9, -0.18, au + 0.5, 0.18, LINE_Y, LINE_COL);
      triUpRot(markings, cx, cz, R,
        [au + 0.5, 0.45], [au + 1.4, 0], [au + 0.5, -0.45], LINE_Y, LINE_COL);
    }
    // Bays: row A (v < 0, disabled bay is k=0) and row B (v > 0).
    // Cars nose-in: nose toward the outer edge (row A: -v, row B: +v).
    const carBays = [];
    for (let k = 0; k < 5; k++) carBays.push({ row: 'A', k });
    for (let k = 0; k < 5; k++) carBays.push({ row: 'B', k });
    // Disabled bay: row A, first bay — no car, blue cell + wheelchair.
    const disabled = { row: 'A', k: 0 };
    const avail = carBays.filter((b) => !(b.row === disabled.row && b.k === disabled.k));
    const nCars = rangeInt(rand, 2, 4);
    const chosen = [];
    for (let i = 0; i < nCars && avail.length; i++) {
      chosen.push(avail.splice(Math.floor(rand() * avail.length), 1)[0]);
    }
    const chosenKey = new Set(chosen.map((b) => b.row + b.k));
    for (const bay of carBays) {
      const bu = -LOT_U / 2 + bay.k * BAY_W + BAY_W / 2; // bay centre u
      const bv = bay.row === 'A' ? -(LANE_W / 2 + BAY_D / 2) : (LANE_W / 2 + BAY_D / 2);
      const key = bay.row + bay.k;
      if (bay.row === disabled.row && bay.k === disabled.k) {
        // Disabled bay: blue wheelchair cell (its background IS the blue
        // square — no separate vertex-coloured quad needed).
        const [wx, wz] = toWorld(cx, cz, R, bu, bv);
        addGroundSymbol(symbols, wx, wz, R + Math.PI, 2.2, 2.2, cellUV(WHEEL_CELL));
        pSymbols++;
        bays++;
        continue;
      }
      if (chosenKey.has(key)) {
        // Parked car, nose-in toward the outer edge.
        const [wx, wz] = toWorld(cx, cz, R, bu, bv);
        const wRot = R + (bay.row === 'A' ? Math.PI / 2 : -Math.PI / 2);
        addPart(cars, simpleParkedCarGeom(distinctColor(colorIdx++)), wx, 0.09, wz, wRot);
        parked++;
        bays++;
        continue;
      }
      // Empty bay: white P on the pad (top of the P toward the outer edge).
      const [wx, wz] = toWorld(cx, cz, R, bu, bv);
      addGroundSymbol(symbols, wx, wz, R + (bay.row === 'A' ? Math.PI : 0), 1.6, 1.6, cellUV(P_CELL));
      pSymbols++;
      bays++;
    }
  }

  return {
    markings, cars,
    symbols: { panelGeom: symbols, atlasCanvas: drawParkingAtlas() },
    lots: lots.map((l) => ({ rect: l.rect, building: { x: l.building.x, z: l.building.z, zone: l.building.zone } })),
    counts: { lots: lots.length, bays, cars: parked, symbols: pSymbols },
  };
}
