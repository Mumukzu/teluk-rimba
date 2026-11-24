// Teluk Rimba — rooftop name signs + BIG facade name boards (Mu).
// Every downtown + commercial building gets a big name board on its
// facade (dark board, light bold text), like Mu's reference image; the
// 9 landmarks keep their rooftop boards too. Commercial ground floors
// get a soft red-white STRIPED awning (replacing the pastel canopy)
// plus a wider, warmer glowing shopfront (see shopglow.js).
// Code-made only: text drawn once onto one shared canvas atlas (same
// pattern as the shop signs / direction signs), one textured draw for
// all boards + one static draw for the dark backing boxes + awnings.
// Names are our own invention, from the city's English naming — NEVER
// the names from Mu's reference image ("CORALLINE HOTEL" / "LUMEN FM
// 98.6" / "HOTEL SERINA" / "MALUN SUITES" or any real brand).
// Board name = BUILDING name; the small shop sign (shopsigns.js) stays
// as the SHOP's name inside it (a building "Amber Plaza" holds a shop
// "Rimba Cafe").
// Atlas (one texture, +0 draws): rooftop block on top (9 cells of
// 1024x186) + facade grid below (337 cells of 384x72, 19 cols x 18 rows
// = 342 slots). Canvas 7296x1854 (<= 8192).
import { addPanelQuad } from './signs.js';
import { plainBox } from './gl.js';
import { mulberry32 } from './rng.js';
import { BUILDING_CLASSES, buildingClass } from './buildings.js';

// Board face: dark navy, light warm-white bold text, thin muted-gold rim.
const BOARD_BG = '#17233a';
const BOARD_TEXT = '#fff3cf';
const BOARD_RIM = '#c9a24b';
const BOX_COL = [0.09, 0.13, 0.22]; // dark backing box (same navy, lit)

const CELL_W = 1024, CELL_H = 186, ATLAS_COLS = 3, ATLAS_ROWS = 3; // 9 cells
const BOARD_ASPECT = CELL_W / CELL_H; // 5.5 — board w/h matches the cell
const FACADE_CELL_W = 384, FACADE_CELL_H = 72, FACADE_COLS = 19, FACADE_ROWS = 18;
const FACADE_ASPECT = FACADE_CELL_W / FACADE_CELL_H; // 5.333
const ATLAS_W = Math.max(ATLAS_COLS * CELL_W, FACADE_COLS * FACADE_CELL_W); // 7296
const ATLAS_H = ATLAS_ROWS * CELL_H + FACADE_ROWS * FACADE_CELL_H; // 558 + 1296 = 1854
const FACADE_Y0 = ATLAS_ROWS * CELL_H; // 558 — facade grid starts below the rooftop block
const BOX_T = 0.18; // backing box thickness
const QUAD_PROUD = 0.11; // text quad proud of the board centre (0.09 + 0.02)
const SINK = 0.2; // board bottom sinks this far into the roof (never floats)
const EDGE_IN = 0.6; // board centre sits this far inside the front roof edge
const FACADE_BOX_PROUD = 0.25; // facade backing-box centre proud of the facade
const FACADE_QUAD_PROUD = 0.36; // facade text quad proud of the facade
const COMMERCIAL_BOARD_BOTTOM = 3.9; // above the awning (3.1) + small sign (2.7)
// Striped awning (commercial only): same geometry as the old pastel
// canopy (6.4 m, tilt 0.22, y 3.1, kitScale), 8 alternating strips.
const AWNING_Y = 3.1, AWNING_W = 6.4, AWNING_TILT = 0.22, AWNING_STRIPS = 8;
const AWNING_RED = [0.80, 0.42, 0.38]; // soft red (pastel rule: never gonjreng)
const AWNING_IVORY = [0.94, 0.92, 0.88]; // warm ivory white

// (building slot, name) — order is the pick order, so the atlas cell
// index is stable and the tallest tower always carries the city name.
export const ROOFTOP_SLOTS = [
  ['tower1', 'Teluk Rimba Tower'],
  ['tower2', 'Rimba Grand Hotel'],
  ['tower3', 'Teluk Plaza Tower'],
  ['tower4', 'Volcano View Tower'],
  ['tower5', 'Marina Bay Tower'],
  ['hospital', 'Rimba City Hospital'],
  ['port', 'Harbor View Hotel'],
  ['beach1', 'Coral Bay Suites'],
  ['beach2', 'Palm Court Hotel'],
];

// Facade-board names for the 15 downtown towers that have no rooftop
// board: original inventions, 3 words each (so they can never collide
// with the 2-word commercial names). Assigned in height order.
export const CBD_NEW_NAMES = [
  'Coral Crown Tower', 'Palm Meridian Tower', 'Golden Horizon Tower',
  'Emerald Peak Tower', 'Sunset Gateway Tower', 'Banyan Sky Tower',
  'Lotus Business Tower', 'Ocean Pearl Tower', 'Harbor Light Tower',
  'Jasmine Heights Tower', 'Crystal Bay Tower', 'Rimba Summit Tower',
  'Amber Sky Tower', 'Sapphire Point Tower', 'Teluk Meridian Tower',
];

// Commercial facade-board names: FIRST x SECOND = 324 combos, seeded
// shuffle, take 316. Two words each (never collides with the 3-word
// CBD names). All original inventions.
export const COMMERCIAL_FIRST = [
  'Amber', 'Coral', 'Golden', 'Silver', 'Emerald', 'Jade', 'Ruby',
  'Pearl', 'Lotus', 'Orchid', 'Banyan', 'Jasmine', 'Marina', 'Sunset',
  'Palm', 'Ocean', 'Crystal', 'Harbor',
];
export const COMMERCIAL_SECOND = [
  'Plaza', 'Court', 'House', 'Center', 'Arcade', 'Galleria', 'Square',
  'Point', 'Place', 'Hall', 'Corner', 'Walk', 'Tower', 'Lodge',
  'Garden', 'Bay', 'Terrace', 'Lane',
];
export const FORBIDDEN_NAMES = [
  'CORALLINE HOTEL', 'LUMEN FM 98.6', 'HOTEL SERINA', 'MALUN SUITES',
];
export const ATLAS_SIZE = { w: ATLAS_W, h: ATLAS_H };
export const FACADE_GRID = {
  cols: FACADE_COLS, rows: FACADE_ROWS,
  cellW: FACADE_CELL_W, cellH: FACADE_CELL_H, y0: FACADE_Y0,
};

// Pure (no document): pick the 9 landmark buildings. Dedupe by object —
// the hospital is a downtown building and must not also take a tower slot.
export function pickRooftopSigns(city) {
  const picked = [];
  const used = new Set();
  const take = (slot, b) => {
    if (!b || used.has(b)) return;
    used.add(b);
    picked.push({ slot, name: ROOFTOP_SLOTS.find((s) => s[0] === slot)[1], building: b });
  };
  const byHeight = (zone) => [...city.buildings]
    .filter((b) => b.zone === zone && !b.landmark)
    .sort((a, b) => b.h - a.h);
  const downtown = byHeight('downtown');
  take('tower1', downtown[0]);
  take('tower2', downtown[1]);
  take('tower3', downtown[2]);
  take('tower4', downtown[3]);
  take('tower5', downtown[4]);
  take('hospital', city.buildings.find((b) => b.landmark === 'hospital'));
  const port = byHeight('port');
  take('port', port[0]);
  const beach = byHeight('beach');
  take('beach1', beach[0]);
  take('beach2', beach[1]);
  return picked;
}

// Pure: name every downtown + commercial building for its facade board.
// Downtown (21): the 5 tallest towers + the hospital reuse their rooftop
// names (one building, one name); the other 15 take CBD_NEW_NAMES in
// height order. Commercial (316): deterministic seeded shuffle of the
// FIRST x SECOND combos, assigned in city order. Total 337, all unique.
export function assignFacadeNames(city) {
  const roof = pickRooftopSigns(city);
  const roofNameByBuilding = new Map();
  for (const p of roof) {
    if (p.slot.startsWith('tower') || p.slot === 'hospital') {
      roofNameByBuilding.set(p.building, p.name);
    }
  }
  const boards = [];
  const downtown = [...city.buildings]
    .filter((b) => b.zone === 'downtown')
    .sort((a, b) => b.h - a.h);
  let newIdx = 0;
  for (const b of downtown) {
    if (roofNameByBuilding.has(b)) {
      boards.push({ building: b, name: roofNameByBuilding.get(b), zone: 'downtown' });
    } else {
      boards.push({ building: b, name: CBD_NEW_NAMES[newIdx++], zone: 'downtown' });
    }
  }
  const combos = [];
  for (const f of COMMERCIAL_FIRST) {
    for (const s of COMMERCIAL_SECOND) combos.push(f + ' ' + s);
  }
  const rand = mulberry32(20261124);
  for (let i = combos.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = combos[i]; combos[i] = combos[j]; combos[j] = t;
  }
  const commercial = city.buildings.filter((b) => b.zone === 'commercial');
  commercial.forEach((b, i) => boards.push({ building: b, name: combos[i], zone: 'commercial' }));
  return boards;
}

// Merge one rotated box into a static geom (same transform as the
// direction-sign poles: local +x runs along the facade, local +z along
// the outward normal).
function addBoardBox(g, w, h, d, color, cx, cy, cz, rotY) {
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

// Tilt a part around the X axis (local space): rotates positions and
// normals. Same convention as shopsigns.js tiltX / plots.js tiltX.
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

// Merge one part into a static geom with a scale-x, then rotY, then
// translate transform — the same order as the instanced canopy matrix
// (mat4TRS) in shopsigns.js, so the static awning matches the old
// canopy geometry exactly.
function addTransformed(g, part, scaleX, rotY, tx, ty, tz) {
  const c = Math.cos(rotY), s = Math.sin(rotY);
  for (let i = 0; i < part.pos.length; i += 3) {
    const px = part.pos[i] * scaleX, py = part.pos[i + 1], pz = part.pos[i + 2];
    part.pos[i] = tx + px * c + pz * s;
    part.pos[i + 1] = ty + py;
    part.pos[i + 2] = tz - px * s + pz * c;
  }
  for (let i = 0; i < part.nrm.length; i += 3) {
    const nx = part.nrm[i], nz = part.nrm[i + 2];
    part.nrm[i] = nx * c + nz * s;
    part.nrm[i + 2] = -nx * s + nz * c;
  }
  g.pos.push(...part.pos); g.nrm.push(...part.nrm); g.col.push(...part.col);
}

// Striped awning over one commercial shopfront: 8 strips alternating
// soft red / ivory, same slab geometry as the old pastel canopy
// (6.4 m wide, 0.1 thick, 1.1 deep, back edge at the facade, tilt 0.22,
// y 3.1, kitScale). Merged into the static boxGeom (+0 draws).
// Returns the strip colours (for tests).
function addStripedAwning(g, b) {
  const nx = Math.sin(b.rot), nz = Math.cos(b.rot);
  const fx = b.x + nx * (b.d / 2), fz = b.z + nz * (b.d / 2);
  const kitScale = Math.min(1.6, Math.max(0.8, b.w / 14));
  const stripW = AWNING_W / AWNING_STRIPS;
  const colors = [];
  for (let i = 0; i < AWNING_STRIPS; i++) {
    const color = i % 2 === 0 ? AWNING_RED : AWNING_IVORY;
    colors.push(color);
    const strip = plainBox(stripW, 0.1, 1.1, color);
    for (let v = 0; v < strip.pos.length; v += 3) strip.pos[v + 2] += 0.55; // back edge to z=0
    tiltX(strip, AWNING_TILT);
    const lx0 = -AWNING_W / 2 + stripW / 2 + i * stripW;
    for (let v = 0; v < strip.pos.length; v += 3) strip.pos[v] += lx0;
    addTransformed(g, strip, kitScale, b.rot, fx, AWNING_Y, fz);
  }
  return colors;
}

// Draw one name cell: dark board, gold rim, bold centred text, shrunk
// to fit (same pattern as the rooftop cells).
function drawCell(ctx, x0, y0, cw, ch, name, startPx, margin, minPx, rimW, rimInset) {
  ctx.fillStyle = BOARD_BG;
  ctx.fillRect(x0, y0, cw, ch);
  ctx.strokeStyle = BOARD_RIM;
  ctx.lineWidth = rimW;
  ctx.strokeRect(x0 + rimInset, y0 + rimInset, cw - rimInset * 2, ch - rimInset * 2);
  ctx.fillStyle = BOARD_TEXT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let px = startPx;
  ctx.font = 'bold ' + px + 'px Arial, sans-serif';
  const m = ctx.measureText(name);
  const w = m ? m.width : 0;
  if (w > cw - margin) {
    px = Math.max(minPx, Math.floor(startPx * (cw - margin) / w));
    ctx.font = 'bold ' + px + 'px Arial, sans-serif';
  }
  ctx.fillText(name, x0 + cw / 2, y0 + ch / 2 + 2);
}

// Draw the combined atlas (browser only): 9 rooftop cells on top,
// 337 facade cells in the grid below.
function drawSignAtlas(facadeNames) {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_W;
  canvas.height = ATLAS_H;
  const ctx = canvas.getContext('2d');
  ROOFTOP_SLOTS.forEach(([slot, name], idx) => {
    const col = idx % ATLAS_COLS, row = Math.floor(idx / ATLAS_COLS);
    drawCell(ctx, col * CELL_W, row * CELL_H, CELL_W, CELL_H, name, 96, 90, 40, 8, 10);
  });
  facadeNames.forEach((name, j) => {
    const col = j % FACADE_COLS, row = Math.floor(j / FACADE_COLS);
    drawCell(ctx, col * FACADE_CELL_W, FACADE_Y0 + row * FACADE_CELL_H,
      FACADE_CELL_W, FACADE_CELL_H, name, 44, 28, 14, 4, 4);
  });
  return canvas;
}

// UV rect [u0, vBottom, u1, vTop] for a pixel rect in the atlas.
function cellUV(x0, y0, cw, ch) {
  return [x0 / ATLAS_W, 1 - (y0 + ch) / ATLAS_H, (x0 + cw) / ATLAS_W, 1 - y0 / ATLAS_H];
}

export function buildRooftopSigns(city) {
  const picks = pickRooftopSigns(city);
  const facadeBoards = assignFacadeNames(city);
  const atlasCanvas = typeof document === 'undefined' ? null : drawSignAtlas(facadeBoards.map((b) => b.name));
  const boxGeom = { pos: [], nrm: [], col: [] };
  const panelGeom = { pos: [], uv: [] };

  for (const { name, building: b } of picks) {
    const idx = ROOFTOP_SLOTS.findIndex((s) => s[1] === name);
    const nx = Math.sin(b.rot), nz = Math.cos(b.rot);
    // Board size follows the building: 85% of its width, capped at 20 m
    // so the sign reads from the street and from the air without
    // overhanging a narrow roof; height keeps the atlas aspect so the
    // text never stretches.
    const w = Math.min(20, Math.max(6, b.w * 0.85));
    const h = w / BOARD_ASPECT;
    const cx = b.x + nx * (b.d / 2 - EDGE_IN);
    const cz = b.z + nz * (b.d / 2 - EDGE_IN);
    const cy = b.h - SINK + h / 2; // bottom sunk into the roof, top above it
    // Dark backing box (a touch larger than the text quad: a dark rim),
    // then the text quad proud of its front face.
    addBoardBox(boxGeom, w + 0.3, h + 0.3, BOX_T, BOX_COL, cx, cy, cz, b.rot);
    const col = idx % ATLAS_COLS, row = Math.floor(idx / ATLAS_COLS);
    addPanelQuad(
      panelGeom,
      cx + nx * QUAD_PROUD, cy, cz + nz * QUAD_PROUD,
      [nx, 0, nz], w, h, cellUV(col * CELL_W, row * CELL_H, CELL_W, CELL_H),
    );
  }

  // Facade boards: one per downtown + commercial building. Commercial:
  // width 72% of the facade capped at 12 m, bottom at 3.9 m (above the
  // awning + small sign, below the first balcony at 6.4 m). Downtown:
  // width 72% capped at 20 m, bottom just above the glass lobby
  // (lobbyH + 0.4), far below the roof. The board never covers a door
  // or the lobby glass.
  const boards = [];
  const awnings = [];
  facadeBoards.forEach(({ building: b, name, zone }, j) => {
    const isDowntown = zone === 'downtown';
    const w = isDowntown ? Math.min(b.w * 0.72, 20) : Math.min(b.w * 0.72, 12);
    const h = w / FACADE_ASPECT;
    const lobbyH = isDowntown
      ? b.h / BUILDING_CLASSES[buildingClass(b.h)].segRows : 0;
    const bottomY = isDowntown ? lobbyH + 0.4 : COMMERCIAL_BOARD_BOTTOM;
    const cy = bottomY + h / 2;
    const nx = Math.sin(b.rot), nz = Math.cos(b.rot);
    const cx = b.x + nx * (b.d / 2 + FACADE_BOX_PROUD);
    const cz = b.z + nz * (b.d / 2 + FACADE_BOX_PROUD);
    addBoardBox(boxGeom, w + 0.3, h + 0.3, BOX_T, BOX_COL, cx, cy, cz, b.rot);
    const col = j % FACADE_COLS, row = Math.floor(j / FACADE_COLS);
    addPanelQuad(
      panelGeom,
      b.x + nx * (b.d / 2 + FACADE_QUAD_PROUD), cy,
      b.z + nz * (b.d / 2 + FACADE_QUAD_PROUD),
      [nx, 0, nz], w, h,
      cellUV(col * FACADE_CELL_W, FACADE_Y0 + row * FACADE_CELL_H, FACADE_CELL_W, FACADE_CELL_H),
    );
    boards.push({
      name, zone,
      x: +b.x.toFixed(1), z: +b.z.toFixed(1),
      w: +w.toFixed(2), h: +h.toFixed(2),
      bottomY: +bottomY.toFixed(2), topY: +(bottomY + h).toFixed(2),
      cell: j, buildingH: +b.h.toFixed(2), buildingW: b.w,
    });
    if (!isDowntown) {
      const colors = addStripedAwning(boxGeom, b);
      awnings.push({ x: +b.x.toFixed(1), z: +b.z.toFixed(1), rot: +b.rot.toFixed(2), colors });
    }
  });

  return {
    boxGeom, panelGeom, atlasCanvas,
    atlasW: ATLAS_W, atlasH: ATLAS_H,
    counts: {
      signs: picks.length,
      boards: boards.length,
      awnings: awnings.length * AWNING_STRIPS,
    },
    picks: picks.map(({ slot, name, building: b }) => ({
      slot, name,
      x: +b.x.toFixed(1), z: +b.z.toFixed(1),
      h: b.h, w: b.w, d: b.d, rot: +b.rot.toFixed(2), zone: b.zone,
    })),
    boards,
    awnings,
  };
}
