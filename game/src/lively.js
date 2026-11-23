// Teluk Rimba — lively city (Mu, Phase I): the city read as boring —
// every building a plain box, only colour/height varying. This module
// makes it ALIVE, all code-made, all derived from the shared city
// dataset (no external assets, no flags/pennants — Mu forbade them):
//   1. varied building shapes — stepped/setback tiers on tall blocks,
//      pitched roofs on low houses, balconies already exist (Phase F);
//   2. livelier facades — AC boxes, balcony planters, curtains in some
//      windows, geometric murals on a few tall walls (canvas patterns);
//   3. vertical neon name boards on commercial/CBD facades (own names,
//      bright at night, gently flickering);
//   4. street life — food carts, tent warungs, cafe tables on sidewalks;
//   5. used roofs — gardens, small pools, helipads, small courts;
//   6. small animations — chimney/warung smoke (drifting puffs), neon
//      flicker, laundry swaying in the wind (dynamic meshes, main.js).
// Pure geometry (no document at build time — the two canvas atlases are
// null in Node tests, same pattern as the rooftop signs).
import { emptyGeom, plainBox, mat4TRS, mergeGeoms, translateGeom } from './gl.js';
import { mulberry32 } from './rng.js';
import { addPanelQuad } from './signs.js';
import { ROAD_LINES, MAIN_LINES, IS_MAIN, ASPHALT_HALF, riverDistance, buildingAABBs } from './city.js';
import { BUILDING_CLASSES, buildingClass } from './buildings.js';

const hash01 = (x, z) => {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
};
const darken = (c, f) => [c[0] * f, c[1] * f, c[2] * f];

// Roof colours by zone (same table as buildings.js — pitched roofs match
// the flat roof slabs, so the skyline stays coherent).
// Mu 23 Nov: freshened with the wall palette — still darker than the walls,
// but with clear hue identity (slate blue / terracotta / brick / sand / teal / moss).
const ROOF_COLORS = {
  downtown: [0.3, 0.42, 0.6],
  commercial: [0.6, 0.32, 0.2],
  residential: [0.55, 0.3, 0.28],
  beach: [0.85, 0.72, 0.5],
  port: [0.35, 0.45, 0.42],
  forest: [0.3, 0.42, 0.3],
};

function pushTri(g, a, b, c, n, col) {
  g.pos.push(...a, ...b, ...c);
  g.nrm.push(...n, ...n, ...n);
  g.col.push(...col, ...col, ...col);
}
function pushQuad(g, a, b, c, d, n, col) {
  pushTri(g, a, b, c, n, col);
  pushTri(g, a, c, d, n, col);
}

// One box, rotated by rotY around Y and moved to (cx, cy, cz), merged
// into geom g (lit program: pos + nrm + col). Same transform as the
// direction-sign poles.
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

// One box in a BUILDING's local frame: (lx, y, lz) is local (local +z is
// the facade normal, local +x runs along the facade), (sx, sy, sz) the
// size along the local axes. Rotated by the building's rotY, translated
// to the building's world position.
function addLocalBox(g, b, lx, y, lz, sx, sy, sz, color) {
  const cr = Math.cos(b.rot), sr = Math.sin(b.rot);
  const cx = b.x + lx * cr + lz * sr;
  const cz = b.z - lx * sr + lz * cr;
  addBoxAt(g, sx, sy, sz, color, cx, y, cz, b.rot);
}

// Unit pitched roof: base y=0, ridge y=1 along local X, half-depth 0.5.
// Two sloped faces + two gable triangles; white (instance tint colours it).
// Slope normal is (0, 0.5, 1) normalised = (0, 0.447, 0.894): the roof
// rises 1 m over a 0.5 m run.
function pitchedRoofGeom() {
  const g = emptyGeom();
  const W = [1, 1, 1];
  const A = [-0.5, 0, -0.5], B = [0.5, 0, -0.5], C = [0.5, 0, 0.5], D = [-0.5, 0, 0.5];
  const R1 = [-0.5, 1, 0], R2 = [0.5, 1, 0];
  const sn = [0, 0.4472, 0.8944]; // +z slope, faces up and +z
  const sn2 = [0, 0.4472, -0.8944]; // -z slope, faces up and -z
  pushQuad(g, D, C, R2, R1, sn, W); // +z slope (CCW from outside)
  pushQuad(g, B, A, R1, R2, sn2, W); // -z slope (CCW from outside)
  pushTri(g, C, B, R2, [1, 0, 0], W); // +x gable (CCW from +x)
  pushTri(g, A, D, R1, [-1, 0, 0], W); // -x gable (CCW from -x)
  return g;
}

export function buildLivelyMeshes(city) {
  const unitBox = plainBox(1, 1, 1, [1, 1, 1]);

  // ---- Feature 1: varied building shapes ----
  const steppedMatrices = [], steppedTints = [];
  const pitchedMatrices = [], pitchedTints = [];
  for (const b of city.buildings) {
    // Stepped / setback tiers on tall blocks that are not already shaped
    // (tiered/glass/spire/crown towers keep their own crowns): one setback
    // tier at h..h+3, a second smaller one at h+3..h+6 on the tallest.
    if (b.h >= 20 && !b.shape) {
      steppedMatrices.push(mat4TRS(b.x, b.h + 1.5, b.z, b.rot, b.w * 0.66, 3, b.d * 0.66));
      steppedTints.push(darken(b.color, 0.9));
      if (b.h >= 45) {
        steppedMatrices.push(mat4TRS(b.x, b.h + 4.5, b.z, b.rot, b.w * 0.42, 3, b.d * 0.42));
        steppedTints.push(darken(b.color, 0.78));
      }
    }
    // Pitched roofs on low houses/shops (residential + commercial, h<12):
    // a prism ridge roof instead of the flat slab. Skipped where a roof
    // unit (tank + AC + antenna) already sits — same hash as buildings.js
    // — so the tank never ends up buried inside the prism.
    if (b.h < 12 && (b.zone === 'residential' || b.zone === 'commercial')
      && hash01(b.x + 11, b.z + 5) >= 0.5 && hash01(b.x + 11, b.z) < 0.45) {
      pitchedMatrices.push(mat4TRS(b.x, b.h + 0.5, b.z, b.rot, b.w + 0.5, 2.4, b.d + 0.5));
      const rc = ROOF_COLORS[b.zone] || ROOF_COLORS.residential;
      const rv = 0.92 + hash01(b.x, b.z) * 0.16;
      pitchedTints.push([rc[0] * rv, rc[1] * rv, rc[2] * rv]);
    }
  }

  // ---- Feature 2: livelier facades ----
  // Window cells: the SAME grid subdividedBox() draws (same class, same
  // cell (i,j), same centre) — copied from buildLitWindows in buildings.js
  // so curtains sit precisely inside real window frames.
  const windowCells = (cls) => {
    const cells = [];
    for (let j = 2; j < cls.segRows - 1; j += 2) {
      for (let i = 0; i < cls.segFront; i += 2) cells.push({ face: 0, i, j, nx: cls.segFront });
      for (let i = 0; i < cls.segFront; i += 2) cells.push({ face: 1, i, j, nx: cls.segFront });
      for (let i = 0; i < cls.sideCols; i += 2) cells.push({ face: 2, i, j, nx: cls.sideCols });
      for (let i = 0; i < cls.sideCols; i += 2) cells.push({ face: 3, i, j, nx: cls.sideCols });
    }
    return cells;
  };
  // Cell centre in world space (proud = fraction of the face depth the
  // quad sits in front of the wall — glass 0.005, curtains 0.008, lit
  // windows 0.012 — so the layers never z-fight).
  const cellToWorld = (b, cls, c, proud) => {
    const u = (c.i + 0.5) / c.nx - 0.5;
    const v = (c.j + 0.5) / cls.segRows - 0.5;
    const faceW = c.face < 2 ? b.w : b.d;
    const cellW = faceW / c.nx, cellH = b.h / cls.segRows;
    let lx, lz, rotY;
    if (c.face === 0) { lx = u * b.w; lz = b.d / 2 + proud * b.d; rotY = b.rot; }
    else if (c.face === 1) { lx = -u * b.w; lz = -(b.d / 2 + proud * b.d); rotY = b.rot + Math.PI; }
    else if (c.face === 2) { lx = b.w / 2 + proud * b.w; lz = -u * b.d; rotY = b.rot + Math.PI / 2; }
    else { lx = -(b.w / 2 + proud * b.w); lz = u * b.d; rotY = b.rot - Math.PI / 2; }
    const cr = Math.cos(b.rot), sr = Math.sin(b.rot);
  
  return {
      x: b.x + lx * cr + lz * sr, y: b.h / 2 + v * b.h, z: b.z - lx * sr + lz * cr,
      rotY, cellW, cellH,
    };
  };
  const CURTAIN_TINTS = [
    [0.95, 0.75, 0.7], [0.7, 0.8, 0.95], [0.95, 0.9, 0.75],
    [0.8, 0.9, 0.75], [0.9, 0.75, 0.9], [0.98, 0.95, 0.88],
  ];
  const CLOTH_TINTS = [
    [0.95, 0.7, 0.65], [0.7, 0.85, 0.95], [0.95, 0.9, 0.7],
    [0.75, 0.9, 0.75], [0.9, 0.75, 0.9], [1, 1, 1],
  ];
  const curtainQuad = (() => {
    const g = { pos: [], nrm: [], col: [] };
    const white = [1, 1, 1], n = [0, 0, 1];
    g.pos.push(-0.9, -0.65, 0, 0.9, -0.65, 0, 0.9, 0.65, 0, -0.9, -0.65, 0, 0.9, 0.65, 0, -0.9, 0.65, 0);
    for (let k = 0; k < 6; k++) g.nrm.push(...n);
    for (let k = 0; k < 6; k++) g.col.push(...white);
    return g;
  })();
  const curtainMatrices = [], curtainTints = [];
  const clutter = emptyGeom(); // AC boxes + balcony planters + laundry lines (1 merged draw)
  const laundryPieces = []; // cloth pieces (dynamic, feature 6)
  const AC_COL = [0.72, 0.72, 0.74];
  for (const b of city.buildings) {
    const cls = BUILDING_CLASSES[buildingClass(b.h)];
    // Curtains: a random SUBSET of the building's own window cells
    // (per-building seeded RNG, different seed offset from the lit
    // windows so curtains do not always coincide with lit cells),
    // drawn at 0.008 proud — between the glass (0.005) and the lit
    // quads (0.012) — 70% of the cell, inside the 78% glass frame.
    {
      const cells = windowCells(cls);
      const perZone = { residential: 6, beach: 5, commercial: 3, downtown: 2, port: 1, forest: 1 };
      const n = Math.min(perZone[b.zone] || 1, cells.length);
      const rand = mulberry32(Math.floor(Math.abs(b.x) * 131 + Math.abs(b.z) * 17 + 1009));
      for (let k = 0; k < n; k++) {
        const pick = k + Math.floor(rand() * (cells.length - k));
        const tmp = cells[k]; cells[k] = cells[pick]; cells[pick] = tmp;
      }
      for (let k = 0; k < n; k++) {
        const w = cellToWorld(b, cls, cells[k], 0.008);
        curtainMatrices.push(mat4TRS(w.x, w.y, w.z, w.rotY, 0.70 * w.cellW / 1.8, 0.70 * w.cellH / 1.3, 1));
        curtainTints.push(CURTAIN_TINTS[Math.floor(rand() * CURTAIN_TINTS.length)]);
      }
    }
    // AC boxes on a side face of mid/tall buildings (1-2 per building),
    // grey, sticking 0.22 m out of the wall.
    if (b.h >= 12) {
      const nAC = hash01(b.x + 2, b.z + 8) < 0.5 ? 2 : 1;
      for (let a = 0; a < nAC; a++) {
        const side = hash01(b.x + a * 3, b.z) < 0.5 ? 1 : -1;
        const lx = side * (b.w / 2 + 0.22);
        const lz = (hash01(b.x, b.z + a * 5) - 0.5) * b.d * 0.5;
        const y = 3.5 + hash01(b.x + a, b.z + a) * (b.h - 7);
        addLocalBox(clutter, b, lx, y, lz, 0.45, 0.5, 0.7, AC_COL);
      }
    }
    // Balconies (same placement as buildings.js): planters on half of
    // them, laundry lines on ~30% (clothes are dynamic — feature 6).
    if (b.h >= 8 && (b.zone === 'residential' || b.zone === 'commercial' || b.zone === 'downtown' || b.zone === 'beach')) {
      const nB = Math.max(0, Math.min(3, Math.floor((b.h - 1) / 3.2) - 1));
      for (let k = 0; k < nB; k++) {
        const fy = (k + 2) * 3.2;
        const along = (k % 2 === 0 ? -1 : 1) * b.w * 0.22;
        const r = hash01(b.x + k * 13, b.z + k * 7);
        if (r < 0.5) {
          // Planter box + one leaf blob on the balcony slab.
          addLocalBox(clutter, b, along - 0.6, fy + 0.18, b.d / 2 + 0.45, 0.55, 0.22, 0.3, [0.25, 0.5, 0.22]);
          addLocalBox(clutter, b, along - 0.6, fy + 0.42, b.d / 2 + 0.45, 0.35, 0.25, 0.25, [0.3, 0.58, 0.26]);
        } else if (r < 0.56 && laundryPieces.length < 180) {
          // Laundry line across the balcony + 2-3 cloth pieces.
          // Narrow band + hard cap: the dynamic laundry mesh holds 200.
          addLocalBox(clutter, b, along, fy + 1.7, b.d / 2 + 0.5, 2.0, 0.04, 0.04, [0.25, 0.25, 0.28]);
          const nCl = hash01(b.x + k, b.z) < 0.5 ? 3 : 2;
          const cr = Math.cos(b.rot), sr = Math.sin(b.rot);
          for (let c = 0; c < nCl; c++) {
            const lx = along - 0.6 + c * 0.6, lz = b.d / 2 + 0.5;
            laundryPieces.push({
              x: b.x + lx * cr + lz * sr, y: fy + 1.7, z: b.z - lx * sr + lz * cr,
              rotY: b.rot, phase: hash01(b.x + k * 3 + c, b.z) * 6.28,
              tint: CLOTH_TINTS[Math.floor(hash01(b.x + c, b.z + k) * CLOTH_TINTS.length)],
            });
          }
        }
      }
    }
  }

  // ---- Murals (feature 2): geometric wall art on 12 tall walls ----
  // Five code-made geometric patterns (stripes, chevrons, sun, waves,
  // diamonds) on one shared canvas atlas — never an outside image.
  // Panels 3 x 6 m on the side face of tall downtown/commercial/beach
  // buildings, centre y 8 m. Picks are deterministic (hash-sorted).
  const MURAL_NAMES = ['stripes', 'chevrons', 'sun', 'waves', 'diamonds'];
  const MURAL_CELL_W = 256, MURAL_CELL_H = 512;
  const drawMuralAtlas = () => {
    const canvas = document.createElement('canvas');
    canvas.width = MURAL_NAMES.length * MURAL_CELL_W;
    canvas.height = MURAL_CELL_H;
    const ctx = canvas.getContext('2d');
    const pats = [
      // diagonal stripes
      (x0, c) => { c.fillStyle = '#123f5e'; c.fillRect(x0, 0, 256, 512); c.fillStyle = '#ff9e4f'; for (let k = -4; k < 8; k++) { c.save(); c.translate(x0 + k * 64, 0); c.rotate(Math.PI / 4); c.fillRect(0, -100, 28, 800); c.restore(); } },
      // chevrons
      (x0, c) => { c.fillStyle = '#3a1c5e'; c.fillRect(x0, 0, 256, 512); c.strokeStyle = '#5fe3c0'; c.lineWidth = 18; for (let k = 0; k < 6; k++) { const y = 40 + k * 80; c.beginPath(); c.moveTo(x0 + 30, y); c.lineTo(x0 + 128, y + 36); c.lineTo(x0 + 226, y); c.stroke(); } },
      // sun / concentric circles
      (x0, c) => { c.fillStyle = '#0e4d3a'; c.fillRect(x0, 0, 256, 512); const cols = ['#ffd23e', '#ff9e4f', '#ff6b6b', '#fff3cf']; for (let k = 0; k < 4; k++) { c.fillStyle = cols[k]; c.beginPath(); c.arc(x0 + 128, 256, 150 - k * 32, 0, Math.PI * 2); c.fill(); } },
      // waves
      (x0, c) => { c.fillStyle = '#123f5e'; c.fillRect(x0, 0, 256, 512); const cols = ['#5fe3c0', '#4fb3ff', '#ffd23e']; for (let k = 0; k < 3; k++) { c.fillStyle = cols[k]; c.beginPath(); for (let x = 0; x <= 256; x += 8) { const y = 120 + k * 130 + Math.sin((x / 256) * Math.PI * 2) * 34; if (x === 0) c.moveTo(x0 + x, y); else c.lineTo(x0 + x, y); } c.lineTo(x0 + 256, 512); c.lineTo(x0, 512); c.closePath(); c.fill(); } },
      // diamonds
      (x0, c) => { c.fillStyle = '#5e1c1c'; c.fillRect(x0, 0, 256, 512); c.fillStyle = '#ffd23e'; for (let r = 0; r < 6; r++) for (let q = 0; q < 3; q++) { const cx = x0 + 42 + q * 86 + (r % 2) * 43, cy = 42 + r * 86; c.beginPath(); c.moveTo(cx, cy - 30); c.lineTo(cx + 30, cy); c.lineTo(cx, cy + 30); c.lineTo(cx - 30, cy); c.closePath(); c.fill(); } },
    ];
    MURAL_NAMES.forEach((_, i) => pats[i](i * MURAL_CELL_W, ctx));
    return canvas;
  };
  const muralGeom = { pos: [], uv: [] };
  const muralPicks = [];
  {
    // Mu 23 Nov 21:19 — NO murals on downtown towers: a solid pattern
    // panel would break the full-glass curtain wall. Murals stay on
    // commercial + beach walls only (was downtown 6 + commercial 4 +
    // beach 2 = 12, now 6).
    const want = { commercial: 4, beach: 2 };
    for (const [zone, n] of Object.entries(want)) {
      const cands = city.buildings
        .filter((b) => b.zone === zone && b.h >= 20)
        .sort((a, b2) => hash01(a.x + 21, a.z) - hash01(b2.x + 21, b2.z));
      for (const b of cands.slice(0, n)) muralPicks.push(b);
    }
    const atlasW = MURAL_NAMES.length * MURAL_CELL_W, atlasH = MURAL_CELL_H;
    muralPicks.forEach((b, k) => {
      const pat = k % MURAL_NAMES.length;
      // Side face (+w local): normal (cos rot, 0, -sin rot), centre
      // local (w/2 + 0.12, 8, 0).
      const cr = Math.cos(b.rot), sr = Math.sin(b.rot);
      const lx = b.w / 2 + 0.12, lz = 0;
      const cx = b.x + lx * cr + lz * sr, cz = b.z - lx * sr + lz * cr;
      const n = [cr, 0, -sr];
      const u0 = (pat * MURAL_CELL_W) / atlasW, u1 = ((pat + 1) * MURAL_CELL_W) / atlasW;
      addPanelQuad(muralGeom, cx, 8, cz, n, 3.0, 6.0, [u0, 0, u1, 1]);
    });
  }

  // ---- Feature 3: vertical neon name boards ----
  // Papan nama toko VERTIKAL di fasad gedung komersial/CBD (h>=12):
  // panel teks 1 x 5 m dari satu atlas (nama-nama BIKINAN SENDIRI —
  // jangan copy nama dari referensi manapun) + halo neon di belakangnya
  // yang menyala di malam hari dan berkedip halus (dynamic, feature 6).
  const NEON_NAMES = [
    'RIMBA MART', 'KOPI SENJA', 'NASI GORENG', 'BOBA TIME',
    'LAUNDRY KU', 'BARBERSHOP', 'HOTEL RIMBA', 'FOTO STUDIO',
    'APOTEK SEHAT', 'BAKSO MANTAP', 'SATE RIMBA', 'WARTEG 24',
  ];
  const NEON_COLORS = [
    [1, 0.3, 0.6], [0.2, 0.9, 1], [0.6, 1, 0.3],
    [1, 0.55, 0.15], [0.7, 0.4, 1], [1, 0.85, 0.2],
  ];
  const NEON_CELL_W = 256, NEON_CELL_H = 1024, NEON_COLS = 4, NEON_ROWS = 3;
  const css = (t) => `rgb(${Math.round(t[0] * 255)},${Math.round(t[1] * 255)},${Math.round(t[2] * 255)})`;
  const drawNeonAtlas = () => {
    const canvas = document.createElement('canvas');
    canvas.width = NEON_COLS * NEON_CELL_W;
    canvas.height = NEON_ROWS * NEON_CELL_H;
    const ctx = canvas.getContext('2d');
    NEON_NAMES.forEach((name, i) => {
      const col = i % NEON_COLS, row = Math.floor(i / NEON_COLS);
      const x0 = col * NEON_CELL_W, y0 = row * NEON_CELL_H;
      const tint = NEON_COLORS[i % NEON_COLORS.length];
      ctx.fillStyle = '#10182a';
      ctx.fillRect(x0, y0, NEON_CELL_W, NEON_CELL_H);
      ctx.strokeStyle = css(tint);
      ctx.lineWidth = 10;
      ctx.strokeRect(x0 + 10, y0 + 10, NEON_CELL_W - 20, NEON_CELL_H - 20);
      ctx.save();
      ctx.translate(x0 + NEON_CELL_W / 2, y0 + NEON_CELL_H / 2);
      ctx.rotate(-Math.PI / 2); // text reads bottom-to-top
      ctx.font = 'bold 92px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = css(tint);
      ctx.shadowBlur = 24;
      ctx.fillStyle = css(tint);
      ctx.fillText(name, 0, 0);
      ctx.restore();
    });
    return canvas;
  };
  const neonGeom = { pos: [], uv: [] };
  const neonGlowMatrices = [], neonGlowTints = [], neonGlowPhases = [];
  let neonCount = 0;
  for (const b of city.buildings) {
    if ((b.zone !== 'commercial' && b.zone !== 'downtown') || b.h < 12) continue;
    if (hash01(b.x + 7, b.z + 3) >= 0.45) continue;
    const nameIdx = neonCount % NEON_NAMES.length;
    const tint = NEON_COLORS[nameIdx % NEON_COLORS.length];
    const side = hash01(b.x + 4, b.z + 1) < 0.5 ? -1 : 1;
    const along = side * b.w * 0.28;
    const cr = Math.cos(b.rot), sr = Math.sin(b.rot);
    // Text panel: front face, centre y 6.0 (above the awning at 3.1),
    // 0.12 proud. Halo box: same centre, 0.06 proud, slightly larger
    // so it peeks out around the panel edges at night.
    const lzP = b.d / 2 + 0.12, lzH = b.d / 2 + 0.06;
    const px = b.x + along * cr + lzP * sr, pz = b.z - along * sr + lzP * cr;
    const hx = b.x + along * cr + lzH * sr, hz = b.z - along * sr + lzH * cr;
    const n = [sr, 0, cr]; // front-face normal
    const col = nameIdx % NEON_COLS, row = Math.floor(nameIdx / NEON_COLS);
    const atlasW = NEON_COLS * NEON_CELL_W, atlasH = NEON_ROWS * NEON_CELL_H;
    const u0 = (col * NEON_CELL_W) / atlasW, u1 = ((col + 1) * NEON_CELL_W) / atlasW;
    const vTop = 1 - (row * NEON_CELL_H) / atlasH;
    const vBottom = 1 - ((row + 1) * NEON_CELL_H) / atlasH;
    addPanelQuad(neonGeom, px, 6.0, pz, n, 1.0, 5.0, [u0, vBottom, u1, vTop]);
    neonGlowMatrices.push(mat4TRS(hx, 6.0, hz, b.rot, 1, 1, 1));
    neonGlowTints.push(tint);
    neonGlowPhases.push(hash01(b.x, b.z + 6) * 6.28);
    neonCount++;
  }

  // ---- Feature 4: street life (no pennant flags — forbidden by Mu) ----
  // Food carts, tent warungs, cafe tables+chairs on sidewalk edges —
  // merged into the same clutter mesh as the facade dressing (1 draw
  // total). Placement mirrors the street vendors (landmarks.js): outer
  // sidewalk edge, clear of intersections, river and buildings.
  const streetSmokeSpots = [];
  const streetCounts = { carts: 0, tents: 0, cafe: 0 };
  const streetSpots = []; // every placed street-life item (test: river clearance)
  {
    const rand = mulberry32(20261123);
    const aabbs = buildingAABBs(city);
    const placed = [];
    const clearOfBuildings = (x, z, m = 1.5) =>
      !aabbs.some((a) => x > a.x0 - m && x < a.x1 + m && z > a.z0 - m && z < a.z1 + m);
    const spot = (mainOk) => {
      for (let t = 0; t < 400; t++) {
        const L = ROAD_LINES[Math.floor(rand() * ROAD_LINES.length)];
        if (!mainOk && IS_MAIN(L)) continue;
        const along = -420 + rand() * 840;
        const horiz = rand() < 0.5;
        const side = rand() < 0.5 ? -1 : 1;
        const off = ASPHALT_HALF(L) + 2.6;
        const x = horiz ? along : L + side * off;
        const z = horiz ? L + side * off : along;
        if (riverDistance(x, z) < 20) continue;
        let nearCross = false;
        for (const M of ROAD_LINES) {
          if (Math.abs(x - M) < 14 && Math.abs(z - M) < 14) { nearCross = true; break; }
        }
        if (nearCross || !clearOfBuildings(x, z)) continue;
        if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < 8)) continue;
        placed.push({ x, z });
        streetSpots.push({ x, z });
        return { x, z, rot: horiz ? 0 : Math.PI / 2 };
      }
      return null;
    };
    const CART_TINTS = [
      [0.95, 0.55, 0.4], [0.4, 0.8, 0.6], [0.95, 0.75, 0.3],
      [0.6, 0.7, 0.95], [0.95, 0.5, 0.65],
    ];
    let nCarts = 0, nTents = 0, nCafe = 0;
    // Food carts (body + canopy + poles + wheels + goods).
    for (let k = 0; k < 20; k++) {
      const s = spot(true);
      if (!s) break;
      const tint = CART_TINTS[k % CART_TINTS.length];
      const off = (dx, dz) => {
        const c = Math.cos(s.rot), sn = Math.sin(s.rot);
        return [s.x + dx * c + dz * sn, s.z - dx * sn + dz * c];
      };
      addBoxAt(clutter, 1.6, 0.9, 1.0, [0.9, 0.85, 0.75], s.x, 0.75, s.z, s.rot);
      addBoxAt(clutter, 1.9, 0.08, 1.3, tint, s.x, 2.2, s.z, s.rot);
      for (const [px, pz] of [[-0.85, -0.55], [0.85, -0.55], [-0.85, 0.55], [0.85, 0.55]]) {
        const [wx, wz] = off(px, pz);
        addBoxAt(clutter, 0.06, 1.3, 0.06, [0.3, 0.3, 0.32], wx, 1.55, wz, s.rot);
      }
      for (const wx of [-0.7, 0.7]) {
        const [vx, vz] = off(wx, 0.55);
        addBoxAt(clutter, 0.1, 0.34, 0.34, [0.15, 0.15, 0.16], vx, 0.17, vz, s.rot);
      }
      addBoxAt(clutter, 0.5, 0.25, 0.4, [0.85, 0.6, 0.35], s.x, 1.3, s.z, s.rot);
      nCarts++;
      if (streetSmokeSpots.length < 12) streetSmokeSpots.push({ x: s.x, y: 2.6, z: s.z, phase: hash01(s.x, s.z) });
    }
    // Tent warungs (4 poles + flat canopy + ridge slab + counter + stools).
    for (let k = 0; k < 12; k++) {
      const s = spot(false);
      if (!s) break;
      const tint = CART_TINTS[(k + 2) % CART_TINTS.length];
      const off = (dx, dz) => {
        const c = Math.cos(s.rot), sn = Math.sin(s.rot);
        return [s.x + dx * c + dz * sn, s.z - dx * sn + dz * c];
      };
      for (const [px, pz] of [[-1.3, -1.0], [1.3, -1.0], [-1.3, 1.0], [1.3, 1.0]]) {
        const [wx, wz] = off(px, pz);
        addBoxAt(clutter, 0.08, 2.4, 0.08, [0.3, 0.3, 0.32], wx, 1.2, wz, s.rot);
      }
      addBoxAt(clutter, 2.8, 0.08, 2.2, tint, s.x, 2.5, s.z, s.rot);
      addBoxAt(clutter, 2.8, 0.08, 1.0, tint, s.x, 2.68, s.z, s.rot);
      addBoxAt(clutter, 2.0, 0.9, 0.8, [0.85, 0.8, 0.7], s.x, 0.45, s.z, s.rot);
      for (const sx of [-0.7, 0.7]) {
        const [wx, wz] = off(sx, 1.3);
        addBoxAt(clutter, 0.4, 0.45, 0.4, [0.7, 0.65, 0.55], wx, 0.22, wz, s.rot);
      }
      nTents++;
      if (streetSmokeSpots.length < 12) streetSmokeSpots.push({ x: s.x, y: 2.7, z: s.z, phase: hash01(s.x + 1, s.z) });
    }
    // Cafe tables + chairs on the sidewalk (table + leg + 2 chairs).
    for (let k = 0; k < 25; k++) {
      const s = spot(true);
      if (!s) break;
      const rot = s.rot + (hash01(s.x, s.z) < 0.5 ? 0 : Math.PI / 2);
      // Local offsets rotated by rot (same convention as addBoxAt).
      const off = (dx, dz) => {
        const c = Math.cos(rot), sn = Math.sin(rot);
        return [s.x + dx * c + dz * sn, s.z - dx * sn + dz * c];
      };
      addBoxAt(clutter, 0.9, 0.07, 0.9, [0.95, 0.95, 0.93], s.x, 0.72, s.z, rot);
      addBoxAt(clutter, 0.08, 0.72, 0.08, [0.3, 0.3, 0.32], s.x, 0.36, s.z, rot);
      for (const [cx, cz] of [[-0.85, 0], [0.85, 0]]) {
        const [wx, wz] = off(cx, cz);
        const [bx, bz] = off(cx, cz - 0.2);
        addBoxAt(clutter, 0.42, 0.06, 0.42, [0.8, 0.6, 0.4], wx, 0.45, wz, rot);
        addBoxAt(clutter, 0.42, 0.5, 0.06, [0.8, 0.6, 0.4], bx, 0.72, bz, rot);
        addBoxAt(clutter, 0.06, 0.45, 0.06, [0.3, 0.3, 0.32], wx, 0.22, wz, rot);
      }
      nCafe++;
    }
    streetCounts.carts = nCarts; streetCounts.tents = nTents; streetCounts.cafe = nCafe;
  }

  // ---- Feature 5: used roofs (not empty roofs) ----
  // Some roofs become gardens, small pools, helipads or small courts —
  // merged into the clutter mesh (1 draw total). Placement avoids the
  // roof unit (opposite quadrant) and the stepped/shaped tiers: on
  // mid-rise blocks the items sit on the roof deck (y h+0.75); on
  // stepped towers they sit ON TOP of the first setback tier (y h+3.1),
  // smaller. Shaped towers (spire/crown/tiered) keep their own crowns.
  let roofUseCount = 0;
  const roofUseKinds = { garden: 0, pool: 0, helipad: 0, court: 0 };
  for (const b of city.buildings) {
    if (b.h < 12 || b.shape) continue;
    if (hash01(b.x + 17, b.z + 13) >= 0.6) continue;
    const stepped = b.h >= 20; // tier1 top at h+3, footprint 0.66
    // Tallest towers (h>=45) have a SECOND tier (h+3..h+6, footprint
    // 0.42): their roof use sits on top of THAT (y h+6.1, smaller),
    // otherwise the garden would be buried inside tier2.
    const yBase = b.h >= 45 ? b.h + 6.1 : stepped ? b.h + 3.1 : b.h + 0.75;
    const sf = b.h >= 45 ? 0.4 : stepped ? 0.6 : 1.0; // size factor
    // Opposite quadrant from the roof unit (if any) so nothing collides.
    const hasUnit = hash01(b.x + 11, b.z + 5) < 0.5;
    let qx, qz;
    if (hasUnit) {
      const ox = hash01(b.x, b.z + 1) - 0.5, oz = hash01(b.x + 2, b.z) - 0.5;
      qx = (ox >= 0 ? -1 : 1) * b.w * 0.15;
      qz = (oz >= 0 ? -1 : 1) * b.d * 0.15;
    } else {
      qx = (hash01(b.x + 23, b.z) < 0.5 ? -1 : 1) * b.w * 0.15;
      qz = (hash01(b.x, b.z + 23) < 0.5 ? -1 : 1) * b.d * 0.15;
    }
    const cx = b.x + qx, cz = b.z + qz;
    const kind = hash01(b.x + 19, b.z + 3);
    if (kind < 0.4) {
      // Roof garden: green slab + 2 mini trees + bench.
      roofUseKinds.garden++;
      addBoxAt(clutter, b.w * 0.3 * sf, 0.25, b.d * 0.3 * sf, [0.3, 0.55, 0.28], cx, yBase + 0.12, cz, b.rot);
      for (const [tx, tz] of [[-0.5, -0.4], [0.5, 0.4]]) {
        addBoxAt(clutter, 0.18, 0.7, 0.18, [0.4, 0.28, 0.16], cx + tx * b.w * 0.12, yBase + 0.6, cz + tz * b.d * 0.12, b.rot);
        addBoxAt(clutter, 0.9, 0.7, 0.9, [0.25, 0.52, 0.25], cx + tx * b.w * 0.12, yBase + 1.3, cz + tz * b.d * 0.12, b.rot);
      }
      addBoxAt(clutter, 1.0, 0.08, 0.4, [0.7, 0.6, 0.45], cx, yBase + 0.35, cz + b.d * 0.1 * sf, b.rot);
    } else if (kind < 0.6) {
      // Small pool: blue slab + white rim.
      roofUseKinds.pool++;
      addBoxAt(clutter, b.w * 0.25 * sf, 0.15, b.d * 0.25 * sf, [0.3, 0.6, 0.9], cx, yBase + 0.07, cz, b.rot);
      const pw = b.w * 0.25 * sf, pd = b.d * 0.25 * sf;
      addBoxAt(clutter, pw, 0.06, 0.12, [0.95, 0.95, 0.95], cx, yBase + 0.16, cz + pd / 2, b.rot);
      addBoxAt(clutter, pw, 0.06, 0.12, [0.95, 0.95, 0.95], cx, yBase + 0.16, cz - pd / 2, b.rot);
      addBoxAt(clutter, 0.12, 0.06, pd, [0.95, 0.95, 0.95], cx + pw / 2, yBase + 0.16, cz, b.rot);
      addBoxAt(clutter, 0.12, 0.06, pd, [0.95, 0.95, 0.95], cx - pw / 2, yBase + 0.16, cz, b.rot);
    } else if (kind < 0.75) {
      // Helipad: dark slab + white H.
      roofUseKinds.helipad++;
      addBoxAt(clutter, b.w * 0.35 * sf, 0.12, b.d * 0.35 * sf, [0.25, 0.25, 0.28], cx, yBase + 0.06, cz, b.rot);
      const hw = b.w * 0.35 * sf, hd = b.d * 0.35 * sf;
      addBoxAt(clutter, 0.3, 0.03, hd * 0.6, [0.95, 0.95, 0.95], cx - hw * 0.22, yBase + 0.14, cz, b.rot);
      addBoxAt(clutter, 0.3, 0.03, hd * 0.6, [0.95, 0.95, 0.95], cx + hw * 0.22, yBase + 0.14, cz, b.rot);
      addBoxAt(clutter, hw * 0.55, 0.03, 0.3, [0.95, 0.95, 0.95], cx, yBase + 0.14, cz, b.rot);
    } else {
      // Small court: terracotta slab + white lines.
      roofUseKinds.court++;
      addBoxAt(clutter, b.w * 0.3 * sf, 0.12, b.d * 0.3 * sf, [0.7, 0.45, 0.3], cx, yBase + 0.06, cz, b.rot);
      const cw = b.w * 0.3 * sf, cd = b.d * 0.3 * sf;
      addBoxAt(clutter, 0.12, 0.03, cd * 0.9, [0.95, 0.95, 0.95], cx - cw * 0.35, yBase + 0.14, cz, b.rot);
      addBoxAt(clutter, 0.12, 0.03, cd * 0.9, [0.95, 0.95, 0.95], cx + cw * 0.35, yBase + 0.14, cz, b.rot);
      addBoxAt(clutter, cw * 0.9, 0.03, 0.12, [0.95, 0.95, 0.95], cx, yBase + 0.14, cz, b.rot);
    }
    roofUseCount++;
  }

  // ---- Feature 6 (data): smoke spots + laundry cloth geometry ----
  // Chimneys on ~15% of mid/tall roofs (a small brick stack in the
  // clutter mesh, so the smoke has something to rise from) + the 12
  // warung/cart spots from feature 4. Each spot emits 2 puffs (main.js
  // cycles them); 70 spots x 2 = 140 puffs, capacity 160.
  const smokeSpots = [...streetSmokeSpots];
  for (const b of city.buildings) {
    if (b.h < 12 || b.shape) continue;
    if (hash01(b.x + 29, b.z + 7) >= 0.15) continue;
    const cx = b.x + b.w * 0.2, cz = b.z + b.d * 0.2;
    addBoxAt(clutter, 0.5, 1.2, 0.5, [0.55, 0.35, 0.3], cx, b.h + 1.1, cz, b.rot);
    smokeSpots.push({ x: cx, y: b.h + 1.7, z: cz, phase: hash01(b.x + 31, b.z) });
  }
  // Cloth piece: a thin box with its TOP edge at y=0, so main.js can
  // swing it around the laundry line with a single rotX (feature 6).
  const clothGeom = translateGeom(plainBox(0.55, 0.75, 0.04, [1, 1, 1]), 0, -0.375, 0);

  return {
    stepped: { geom: unitBox, matrices: steppedMatrices, tints: steppedTints },
    pitched: { geom: pitchedRoofGeom(), matrices: pitchedMatrices, tints: pitchedTints },
    clutter,
    curtains: { geom: curtainQuad, matrices: curtainMatrices, tints: curtainTints },
    muralGeom, muralAtlasCanvas: typeof document === 'undefined' ? null : drawMuralAtlas(),
    neonGeom, neonAtlasCanvas: typeof document === 'undefined' ? null : drawNeonAtlas(),
    neonGlow: { matrices: neonGlowMatrices, tints: neonGlowTints, phases: neonGlowPhases },
    laundryPieces,
    streetSmokeSpots,
    streetSpots,
    smokeSpots,
    clothGeom,
    counts: {
      stepped: steppedMatrices.length, pitched: pitchedMatrices.length,
      curtains: curtainMatrices.length, laundry: laundryPieces.length,
      murals: muralPicks.length, neon: neonCount,
      carts: streetCounts.carts, tents: streetCounts.tents, cafe: streetCounts.cafe,
      roofUse: roofUseCount, roofUseKinds,
      smokeSpots: smokeSpots.length,
      clutterTris: clutter.pos.length / 9,
    },
  };
}
