// Teluk Rimba — marked parking zones (Phase I, Mu).
// ADAPTIVE lots: each lot is sized to the EMPTY YARD of its own big
// building — wider yards get more bay columns, deeper yards get a second
// row, small yards get a smaller lot. Standards kept everywhere: bay
// 2.5x5 m, 6 m central lane, ONE disabled bay per lot (blue + white
// wheelchair pictogram), P symbols in empty bays, white arrows on the
// lane, parked cars nose-in (2-4+ per lot, more in bigger lots, some
// bays always left empty). All code-made, derived from the shared city
// dataset. The textured ground symbols use OPAQUE cell backgrounds (the
// textured program outputs alpha 1.0, so transparent canvas pixels would
// render black): each cell is a painted square on the pad. The atlas
// canvas is only drawn in the browser — buildParking runs in Node tests
// too, where document does not exist, so the canvas is created lazily
// (null in Node) while the panel geometry (pure positions + UVs) is
// always built.
import { mulberry32, range, rangeInt } from './rng.js';
import { riverDistance } from './city.js';
import { emptyGeom, plainBox, prismY } from './gl.js';

// Lot layout (local frame: u along the row, v along the depth).
// Width = cols * BAY_W (adaptive, 2..12 cols); depth = rows * BAY_D +
// LANE_W (2 rows = 16 m, 1 row = 11 m).
const BAY_W = 2.5, BAY_D = 5, LANE_W = 6;
const MAX_COLS = 16, MIN_COLS = 2; // 40 m max lot width — a bigger lot would eat the whole yard
const MAX_P_PER_LOT = 10; // cap P symbols per lot (bounds the atlas)
const PAD_COL = [0.32, 0.32, 0.34];   // dark asphalt pad
const LINE_COL = [0.92, 0.92, 0.9];   // white paint
const PAD_Y = 0.08, LINE_Y = 0.09, SYM_Y = 0.1;
const TARGET_LOTS = 80;
// Downtown towers get a lot on EVERY side that fits (left, right,
// behind) — Mu: CBD parking was far too scarce. Other buildings keep
// one lot each. Downtown towers are the largest buildings, so the
// largest-first order fills the CBD before the other zones.
const DOWNTOWN_LOTS_PER_BUILDING = 3;

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

// One ground symbol quad (textured, positions + UVs only): w wide (local
// u) x h tall (local v), centred at (cx, cz), yaw rot — local +v (canvas
// up) maps to world (sin rot, cos rot). Wound up-facing like quadUp.
// y defaults to SYM_Y; stadium lots on the forecourt apron pass a
// raised y so the symbols sit above the apron slab.
function addGroundSymbol(geom, cx, cz, rot, w, h, uv, y = SYM_Y) {
  const A = toWorld(cx, cz, rot, -w / 2, -h / 2), B = toWorld(cx, cz, rot, w / 2, -h / 2);
  const C = toWorld(cx, cz, rot, w / 2, h / 2), D = toWorld(cx, cz, rot, -w / 2, h / 2);
  const [u0, v0, u1, v1] = uv;
  const q = (P, u, v) => { geom.pos.push(P[0], y, P[1]); geom.uv.push(u, v); };
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
  // Separate stream for the lot-car TYPE pick only: the bay-choice stream
  // above must stay untouched so every lot count stays byte-identical.
  const typeRand = mulberry32(20261136);
  const markings = emptyGeom();
  const cars = emptyGeom();
  const symbols = { pos: [], uv: [] };
  const lots = [];
  const carSpots = []; // {x, z, heading, yBase, type, row, k} per lot car
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
    const fw = b.w, fd = b.d; // visual extents: w runs ACROSS the front
    // (local +x maps to the across direction), d runs ALONG the front
    // normal (local +z maps to the normal) — true for any rot, because
    // the building's front face is at local +z. (An earlier version
    // swapped these for rot=PI/2 and placed side lots 1 m too close
    // to the tower, failing the 1.5 m clearance check.)
    const nx = Math.sin(b.rot), nz = Math.cos(b.rot); // front normal
    const ax = Math.cos(b.rot), az = -Math.sin(b.rot); // across
    const sibs = city.buildings.filter((s) => s.x >= blk.x0 && s.x <= blk.x1 && s.z >= blk.z0 && s.z <= blk.z1);
    // Candidate lot sides: both sides (v axis along the across
    // direction, R = rot - PI/2) and behind (v axis along the front
    // normal, R = rot). Never in front of the door. The FRONT side is
    // also tried, shifted sideways clear of the door strip (door is
    // |across| < 2.2, +1 m margin): two candidates, one each side of
    // the entrance — useful on towers whose side yards are too thin.
    const sides = [
      { dir: [ax, az], gap: fw / 2, R: b.rot - Math.PI / 2 },
      { dir: [-ax, -az], gap: fw / 2, R: b.rot - Math.PI / 2 },
      { dir: [-nx, -nz], gap: fd / 2, R: b.rot },
      { dir: [nx, nz], gap: fd / 2, R: b.rot, lat: (W) => W / 2 + 3.5 },
      { dir: [nx, nz], gap: fd / 2, R: b.rot, lat: (W) => -(W / 2 + 3.5) },
    ];
    // Adaptive sizing: try the LARGEST lot first (2 rows, most columns)
    // and shrink until one fits the yard — wider yards get more bay
    // columns, deeper yards get the second row, small yards get a
    // small lot. The clearance checks below are the measuring tape.
    // A downtown tower tries EVERY side (up to 3 lots); other
    // buildings stop after their first lot.
    const maxLots = b.zone === 'downtown' ? DOWNTOWN_LOTS_PER_BUILDING : 1;
    let placedHere = 0;
    for (const s of sides) {
      if (placedHere >= maxLots) break;
      if (lots.length >= TARGET_LOTS) break;
      let placed = null;
      // Downtown lots run WIDER along the tower front (up to 60 m) so
      // one CBD lot holds far more bays; other zones keep the 40 m cap.
      const maxCols = b.zone === 'downtown' ? 24 : MAX_COLS;
      for (const rows of [2, 1]) {
        const depth = rows * BAY_D + LANE_W; // 16 m or 11 m
        for (let cols = maxCols; cols >= MIN_COLS; cols--) {
          const width = cols * BAY_W;
          // Lateral offset for front-side lots (clears the door strip);
          // 0 for side/behind lots.
          const lat = s.lat ? s.lat(width) : 0;
          const cx = b.x + s.dir[0] * (s.gap + 2 + depth / 2) + ax * lat;
          const cz = b.z + s.dir[1] * (s.gap + 2 + depth / 2) + az * lat;
          // World axis-aligned rect (rot is 0 or PI/2, so the lot is
          // axis-aligned) — computed from the lot's local corners.
          const corners = [
            toWorld(cx, cz, s.R, -width / 2, -depth / 2),
            toWorld(cx, cz, s.R, width / 2, -depth / 2),
            toWorld(cx, cz, s.R, -width / 2, depth / 2),
            toWorld(cx, cz, s.R, width / 2, depth / 2),
          ];
          const xs = corners.map((p) => p[0]), zs = corners.map((p) => p[1]);
          const rect = {
            x0: Math.min(...xs), x1: Math.max(...xs),
            z0: Math.min(...zs), z1: Math.max(...zs),
          };
          // (1) Inside the block, >= 3 m from its edges.
          if (rect.x0 < blk.x0 + 3 || rect.x1 > blk.x1 - 3 || rect.z0 < blk.z0 + 3 || rect.z1 > blk.z1 - 3) continue;
          // (2) Clear of every building in the block (+1.5 m).
          if (sibs.some((x) => rectsOverlap(rect, footprint(x), 1.5))) continue;
          // (3) Clear of every door strip in the block (+1 m).
          if (sibs.some((x) => rectsOverlap(rect, doorStripRect(x), 1))) continue;
          // (4) Clear of the river.
          const pts = [[rect.x0, rect.z0], [rect.x1, rect.z0], [rect.x0, rect.z1], [rect.x1, rect.z1], [cx, cz]];
          if (pts.some(([x, z]) => riverDistance(x, z) < 25)) continue;
          // (5) Clear of other lots (+2 m).
          if (lots.some((l) => rectsOverlap(rect, l.rect, 2))) continue;
          placed = { cx, cz, R: s.R, rect, building: b, width, depth, rows, cols };
          break;
        }
        if (placed) break;
      }
      if (placed) { lots.push(placed); placedHere++; }
    }
  }

  // --- Rimba Stadium car parks (Mu 23 Nov 23:09): 3 lots beside the
  // stadium, all explicit rects (verified against the city dataset —
  // see tests/parking.test.mjs). S1+S2 sit on the stadium forecourt
  // apron (top y 0.2, stadium.js), so their geometry is raised +0.15;
  // S3 is the big west car park across the road in block (10,7).
  // Stadium lots fill ~85% of their bays (match day) instead of the
  // usual ~30%. Each candidate is run through the same clearance
  // rules as the adaptive lots and only placed if it passes all of
  // them (deterministic — the same rects pass on every run).
  const st = city.stadium;
  if (st) {
    const stadLots = [
      // S1: south strip, 2 rows, right by the south entrance gap.
      { cx: 522.5, cz: 118, R: 0, rect: { x0: 510, x1: 535, z0: 110, z1: 126 }, width: 25, depth: 16, rows: 2, cols: 10, yBase: 0.15, fill: 0.85, stadium: true },
      // S2: south strip east, 1 row, beside S1.
      { cx: 547.25, cz: 120.5, R: 0, rect: { x0: 537, x1: 557.5, z0: 115, z1: 126 }, width: 20, depth: 11, rows: 1, cols: 8, yBase: 0.15, fill: 0.85, stadium: true },
      // S3: west car park in block (10,7), across the road from the west stand.
      { cx: 451, cz: 153, R: 0, rect: { x0: 412, x1: 490, z0: 145, z1: 161 }, width: 77.5, depth: 16, rows: 2, cols: 31, yBase: 0, fill: 0.85, stadium: true },
    ];
    for (const sl of stadLots) {
      // (1) Inside a block. (2) Clear of every building (+1.5 m).
      // (3) Clear of every door strip (+1 m). (4) River >= 25 m.
      // (5) Clear of other lots (+2 m). (6) Clear of the stadium (+1.5 m).
      const inBlock = city.blocks.some((bl) =>
        sl.rect.x0 >= bl.x0 && sl.rect.x1 <= bl.x1 && sl.rect.z0 >= bl.z0 && sl.rect.z1 <= bl.z1);
      const clearB = !city.buildings.some((b) => rectsOverlap(sl.rect, footprint(b), 1.5));
      const clearD = !city.buildings.some((b) => rectsOverlap(sl.rect, doorStripRect(b), 1));
      const clearR = [[sl.rect.x0, sl.rect.z0], [sl.rect.x1, sl.rect.z0], [sl.rect.x0, sl.rect.z1], [sl.rect.x1, sl.rect.z1], [sl.cx, sl.cz]]
        .every(([x, z]) => riverDistance(x, z) >= 25);
      const clearL = !lots.some((l) => rectsOverlap(sl.rect, l.rect, 2));
      const clearS = !(sl.rect.x0 - 1.5 < st.x1 && sl.rect.x1 + 1.5 > st.x0 && sl.rect.z0 - 1.5 < st.z1 && sl.rect.z1 + 1.5 > st.z0);
      if (inBlock && clearB && clearD && clearR && clearL && clearS) {
        lots.push({ ...sl, building: { x: st.cx, z: st.cz, zone: 'beach' } });
      }
    }
  }

  // --- Build the geometry for every placed lot. ---
  const atlasW = ATLAS_COLS * CELL, atlasH = CELL;
  const cellUV = (cell) => {
    const u0 = (cell * CELL) / atlasW, u1 = ((cell + 1) * CELL) / atlasW;
    return [u0, 0, u1, 1]; // single row: vBottom 0, vTop 1
  };
  let biggest = null;
  for (const lot of lots) {
    const { cx, cz, R, width: W, depth: D, rows, cols } = lot;
    // Stadium lots on the forecourt apron (top y 0.2) raise every
    // piece of lot geometry by yBase so nothing is buried in the slab.
    const yBase = lot.yBase || 0;
    const padY = PAD_Y + yBase, lineY = LINE_Y + yBase, symY = SYM_Y + yBase;
    if (!biggest || cols * rows > biggest.cols * biggest.rows) biggest = lot;
    // Pad (dark asphalt over the yard paving).
    quadUpRot(markings, cx, cz, R, -W / 2, -D / 2, W / 2, D / 2, padY, PAD_COL);
    // Bay long lines along u: outer edges + lane edges (deduped — on a
    // 1-row lot the far lane edge IS the outer edge).
    const laneLo = -D / 2 + BAY_D, laneHi = laneLo + LANE_W; // lane v-range
    for (const v of [...new Set([-D / 2, laneLo, laneHi, D / 2])]) {
      quadUpRot(markings, cx, cz, R, -W / 2, v - 0.06, W / 2, v + 0.06, lineY, LINE_COL);
    }
    // Divider lines along v at u = -W/2 + 2.5k, for each row.
    const rowRanges = rows === 2
      ? [[-D / 2, -D / 2 + BAY_D], [D / 2 - BAY_D, D / 2]]
      : [[-D / 2, -D / 2 + BAY_D]];
    for (let k = 0; k <= cols; k++) {
      const u = -W / 2 + k * BAY_W;
      for (const [v0, v1] of rowRanges) {
        quadUpRot(markings, cx, cz, R, u - 0.06, v0, u + 0.06, v1, lineY, LINE_COL);
      }
    }
    // Arrows on the lane (one-way, pointing +u): shaft + triangle head.
    // 2 arrows on narrow lots, 3 on wide ones (>= 20 m).
    const laneV = (laneLo + laneHi) / 2;
    const arrowUs = W >= 20 ? [-W / 3, 0, W / 3] : [-W / 4, W / 4];
    for (const au of arrowUs) {
      quadUpRot(markings, cx, cz, R, au - 0.9, laneV - 0.18, au + 0.5, laneV + 0.18, lineY, LINE_COL);
      triUpRot(markings, cx, cz, R,
        [au + 0.5, laneV + 0.45], [au + 1.4, laneV], [au + 0.5, laneV - 0.45], lineY, LINE_COL);
    }
    // Bays: row A (v < 0, disabled bay is k=0) and row B (v > 0, if any).
    // Cars nose-in: nose toward the outer edge (row A: -v, row B: +v).
    // Car yaw: forward (+x local) must map to +/-v — rotY gives
    // (cos a, -sin a) for local +x, and +v is (sin R, cos R), so
    // forward -v needs a = R + PI/2, forward +v needs a = R - PI/2
    // (verified numerically: the car's 4.1 m axis then lies along v).
    const carBays = [];
    for (let k = 0; k < cols; k++) carBays.push({ row: 'A', k });
    if (rows === 2) for (let k = 0; k < cols; k++) carBays.push({ row: 'B', k });
    const rowV = (row) => row === 'A' ? -D / 2 + BAY_D / 2 : D / 2 - BAY_D / 2;
    // Disabled bay: row A, first bay — no car, blue cell + wheelchair.
    const disabled = { row: 'A', k: 0 };
    const avail = carBays.filter((bb) => !(bb.row === disabled.row && bb.k === disabled.k));
    // Cars scale with the lot: ~30% of bays, 2..8 per lot. Stadium
    // lots fill most of their bays instead (match day, Mu).
    const fill = lot.fill || 0.3;
    const nCars = lot.stadium
      ? Math.min(avail.length, Math.round(carBays.length * fill))
      : Math.min(8, Math.max(2, Math.round(carBays.length * 0.3)));
    const chosen = [];
    for (let i = 0; i < nCars && avail.length; i++) {
      chosen.push(avail.splice(Math.floor(rand() * avail.length), 1)[0]);
    }
    const chosenKey = new Set(chosen.map((bb) => bb.row + bb.k));
    // P symbols: a random subset of the empty bays, capped per lot.
    const emptyBays = carBays.filter((bb) => !chosenKey.has(bb.row + bb.k) && !(bb.row === disabled.row && bb.k === disabled.k));
    const pBays = [];
    for (let i = 0; i < Math.min(MAX_P_PER_LOT, emptyBays.length); i++) {
      pBays.push(emptyBays.splice(Math.floor(rand() * emptyBays.length), 1)[0]);
    }
    const pKey = new Set(pBays.map((bb) => bb.row + bb.k));
    let lotCars = 0;
    for (const bay of carBays) {
      const bu = -W / 2 + bay.k * BAY_W + BAY_W / 2; // bay centre u
      const bv = rowV(bay.row);
      const key = bay.row + bay.k;
      if (bay.row === disabled.row && bay.k === disabled.k) {
        // Disabled bay: blue wheelchair cell (its background IS the blue
        // square — no separate vertex-coloured quad needed).
        const [wx, wz] = toWorld(cx, cz, R, bu, bv);
        addGroundSymbol(symbols, wx, wz, R + Math.PI, 2.2, 2.2, cellUV(WHEEL_CELL), symY);
        pSymbols++;
        bays++;
        continue;
      }
      if (chosenKey.has(key)) {
        // Parked car, nose-in toward the outer edge — recorded as a spot,
        // NOT baked as static geometry: spawnLotCars turns it into a
        // stealable parked traffic entity (Mu). Entity heading = wRot +
        // PI/2: the sculpted car's front (+X) maps to (sin h, cos h)
        // via vehicleMatrix, matching the old static yaw (verified
        // numerically — the car's long axis lies along the bay depth).
        const [wx, wz] = toWorld(cx, cz, R, bu, bv);
        const wRot = R + (bay.row === 'A' ? Math.PI / 2 : -Math.PI / 2);
        const tr = typeRand();
        const type = tr < 0.40 ? 'car' : tr < 0.70 ? 'sedan' : tr < 0.85 ? 'mpv' : 'jeep';
        carSpots.push({ x: wx, z: wz, heading: wRot + Math.PI / 2, yBase, type, row: bay.row, k: bay.k });
        parked++;
        lotCars++;
        bays++;
        continue;
      }
      if (pKey.has(key)) {
        // Empty bay with a P: top of the P toward the outer edge.
        const [wx, wz] = toWorld(cx, cz, R, bu, bv);
        addGroundSymbol(symbols, wx, wz, R + (bay.row === 'A' ? Math.PI : 0), 1.6, 1.6, cellUV(P_CELL), symY);
        pSymbols++;
      }
      bays++;
    }
    lot.cars = lotCars;
  }

  return {
    markings, cars, // cars stays EMPTY: lot cars spawn as traffic entities
    symbols: { panelGeom: symbols, atlasCanvas: drawParkingAtlas() },
    carSpots,
    lots: lots.map((l) => ({ rect: l.rect, cx: l.cx, cz: l.cz, R: l.R, width: l.width, depth: l.depth, rows: l.rows, cols: l.cols, cars: l.cars || 0, stadium: !!l.stadium, yBase: l.yBase || 0, building: { x: l.building.x, z: l.building.z, zone: l.building.zone } })),
    counts: {
      lots: lots.length, bays, cars: parked, symbols: pSymbols,
      biggest: biggest ? { width: biggest.width, depth: biggest.depth, rows: biggest.rows, cols: biggest.cols, bays: biggest.rows * biggest.cols, centre: [(biggest.rect.x0 + biggest.rect.x1) / 2, (biggest.rect.z0 + biggest.rect.z1) / 2] } : null,
    },
  };
}

// Turn parking-lot spots into stealable parked traffic entities (Mu):
// each spot spawns via the same spawnParked missions use, then gets the
// lot's ground height (stadium forecourt lots sit +0.15 on the apron,
// so those cars ride at y 0.24) and joins traffic.parked so the
// off-lanes checks cover it too. spawnParked itself only pushes to
// traffic.vehicles — the parked array is maintained by the caller.
export function spawnLotCars(traffic, spots) {
  const spawned = [];
  for (const s of spots) {
    const v = traffic.spawnParked(s.type, s.x, s.z, s.heading);
    v.y = 0.09 + (s.yBase || 0);
    traffic.parked.push(v);
    spawned.push(v);
  }
  return spawned;
}

// Turn yard + kerb spots into stealable parked traffic entities (Mu):
// same pattern as spawnLotCars — each spot spawns via the same
// spawnParked missions use, rides at y 0.09 just above the yard paving
// (top 0.07-0.08), and joins traffic.parked so the off-lanes checks
// cover it too.
export function spawnYardCars(traffic, spots) {
  const spawned = [];
  for (const s of spots) {
    const v = traffic.spawnParked(s.type, s.x, s.z, s.heading);
    v.y = 0.09;
    traffic.parked.push(v);
    spawned.push(v);
  }
  return spawned;
}
