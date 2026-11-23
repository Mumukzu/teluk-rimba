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
const ROOF_COLORS = {
  downtown: [0.25, 0.28, 0.35],
  commercial: [0.45, 0.3, 0.22],
  residential: [0.4, 0.28, 0.26],
  beach: [0.75, 0.7, 0.6],
  port: [0.3, 0.32, 0.3],
  forest: [0.25, 0.3, 0.25],
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

  return {
    stepped: { geom: unitBox, matrices: steppedMatrices, tints: steppedTints },
    pitched: { geom: pitchedRoofGeom(), matrices: pitchedMatrices, tints: pitchedTints },
    counts: { stepped: steppedMatrices.length, pitched: pitchedMatrices.length },
  };
}
