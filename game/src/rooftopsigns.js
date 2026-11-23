// Teluk Rimba — rooftop name signs (Mu, Phase I).
// A small set of landmark buildings gets a big name board on the roof:
// dark board, light bold text, mounted on the roof's front edge so it
// reads from the street and from aerial views. Code-made only: text drawn
// once onto one shared canvas atlas (same pattern as the shop signs /
// direction signs), one textured draw for all boards + one static draw
// for the dark backing boxes. Names are our own invention, from the
// city's English naming — NEVER the names from Mu's reference image
// ("Hotel Serina" / "Malun Suites" or any name from that image).
// Picks (9): the 5 tallest downtown towers, the hospital, the biggest
// port building, the 2 tallest beachfront buildings (hotels).
import { addPanelQuad } from './signs.js';
import { plainBox } from './gl.js';

// Board face: dark navy, light warm-white bold text, thin muted-gold rim.
const BOARD_BG = '#17233a';
const BOARD_TEXT = '#fff3cf';
const BOARD_RIM = '#c9a24b';
const BOX_COL = [0.09, 0.13, 0.22]; // dark backing box (same navy, lit)

const CELL_W = 1024, CELL_H = 186, ATLAS_COLS = 3, ATLAS_ROWS = 3; // 9 cells
const BOARD_ASPECT = CELL_W / CELL_H; // 5.5 — board w/h matches the cell
const BOX_T = 0.18; // backing box thickness
const QUAD_PROUD = 0.11; // text quad proud of the board centre (0.09 + 0.02)
const SINK = 0.2; // board bottom sinks this far into the roof (never floats)
const EDGE_IN = 0.6; // board centre sits this far inside the front roof edge

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

// Draw the 9 name cells onto one canvas atlas (browser only).
function drawRooftopAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_COLS * CELL_W;
  canvas.height = ATLAS_ROWS * CELL_H;
  const ctx = canvas.getContext('2d');
  ROOFTOP_SLOTS.forEach(([slot, name], idx) => {
    const col = idx % ATLAS_COLS, row = Math.floor(idx / ATLAS_COLS);
    const x0 = col * CELL_W, y0 = row * CELL_H;
    ctx.fillStyle = BOARD_BG;
    ctx.fillRect(x0, y0, CELL_W, CELL_H);
    ctx.strokeStyle = BOARD_RIM;
    ctx.lineWidth = 8;
    ctx.strokeRect(x0 + 10, y0 + 10, CELL_W - 20, CELL_H - 20);
    ctx.fillStyle = BOARD_TEXT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let px = 96;
    ctx.font = 'bold ' + px + 'px Arial, sans-serif';
    const w = ctx.measureText(name).width;
    if (w > CELL_W - 90) {
      px = Math.max(40, Math.floor(96 * (CELL_W - 90) / w));
      ctx.font = 'bold ' + px + 'px Arial, sans-serif';
    }
    ctx.fillText(name, x0 + CELL_W / 2, y0 + CELL_H / 2 + 3);
  });
  return canvas;
}

export function buildRooftopSigns(city) {
  const picks = pickRooftopSigns(city);
  const atlasCanvas = typeof document === 'undefined' ? null : drawRooftopAtlas();
  const atlasW = ATLAS_COLS * CELL_W, atlasH = ATLAS_ROWS * CELL_H;
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
    const u0 = (col * CELL_W) / atlasW;
    const u1 = ((col + 1) * CELL_W) / atlasW;
    const vTop = 1 - (row * CELL_H) / atlasH;
    const vBottom = 1 - ((row + 1) * CELL_H) / atlasH;
    addPanelQuad(
      panelGeom,
      cx + nx * QUAD_PROUD, cy, cz + nz * QUAD_PROUD,
      [nx, 0, nz], w, h, [u0, vBottom, u1, vTop],
    );
  }

  return {
    boxGeom, panelGeom, atlasCanvas,
    counts: { signs: picks.length },
    picks: picks.map(({ slot, name, building: b }) => ({
      slot, name,
      x: +b.x.toFixed(1), z: +b.z.toFixed(1),
      h: b.h, w: b.w, d: b.d, rot: +b.rot.toFixed(2), zone: b.zone,
    })),
  };
}
