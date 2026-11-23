// Teluk Rimba — buildings as instanced meshes.
// Height classes: the window grid is sized per class so the window cells
// stay ~2-3 m (not giant dark rectangles on tall towers). Cell height is
// h/segRows; the tallest tower (100 m) gets 8.3 m rows — still big, but
// that is one skyline landmark, not every building.
// Architectural detail is instanced too (one draw call per part type):
// plinth + cornice bands, entrance kits (houses) / shopfronts (shops),
// balconies on multi-storey fronts, and roof clutter (tank + AC + antenna).
import { subdividedBox, plainBox, mat4TRS, emptyGeom } from './gl.js';
import { mulberry32 } from './rng.js';

export const BUILDING_CLASSES = {
  short: { segFront: 6, segRows: 4, sideCols: 4 },
  // Mu 23 Nov 21:03: downtown towers are up to 48 m wide now — the old
  // tall grid (8 front / 6 side cols) would stretch window cells to
  // 5.9 m wide (phase-f caps at 5.5 m). 10 cols keeps them at 4.7 m.
  mid: { segFront: 8, segRows: 8, sideCols: 6 },
  tall: { segFront: 10, segRows: 12, sideCols: 10 },
  // Mu 23 Nov 21:03: CBD towers are 150-200 m now — they need their own
  // class, or the window cells would stretch to 16 m tall (the phase-f
  // test caps cells at 8.5 m tall / 5.5 m wide): 200/24 = 8.3 m rows,
  // 56/12 = 4.7 m columns.
  skyscraper: { segFront: 12, segRows: 24, sideCols: 12 },
};
export function buildingClass(h) {
  return h < 12 ? 'short' : h < 30 ? 'mid' : h < 100 ? 'tall' : 'skyscraper';
}
// Roof colours by zone (varied a touch per building by hash).
// Mu 23 Nov: freshened with the wall palette — still darker than the walls,
// but with clear hue identity (slate blue / terracotta / brick / sand / teal / moss).
const ROOF_COLORS = {
  // Mu 23 Nov 22:12 — CBD roofs read as a dark hollow hole from the
  // air (the slate slab + parapet tray looked kopong/empty). Downtown
  // roof slabs + decks are ivory now, matching the towers — the roof
  // reads as a solid finished cap, not a dark void. Other zones keep
  // their darker roof identity.
  downtown: [0.86, 0.84, 0.77],
  commercial: [0.6, 0.32, 0.2],
  residential: [0.55, 0.3, 0.28],
  beach: [0.85, 0.72, 0.5],
  port: [0.35, 0.45, 0.42],
  forest: [0.3, 0.42, 0.3],
};
const SHOP_ACCENTS = [
  [0.9, 0.3, 0.25], [0.2, 0.6, 0.9], [0.95, 0.7, 0.15], [0.3, 0.7, 0.35], [0.85, 0.4, 0.6],
];
// Ground-floor glass band tint by zone (cool glass for shops/towers,
// warm dark glass for houses).
const GLASS_BAND = {
  downtown: [0.35, 0.45, 0.55], commercial: [0.35, 0.45, 0.55],
  residential: [0.45, 0.42, 0.38], beach: [0.45, 0.42, 0.38],
  port: [0.4, 0.4, 0.38], forest: [0.4, 0.4, 0.38],
};
// Warm interior glow tints for tall buildings (Mu: ground floors must
// glow bright from INSIDE at night) — same warm palette as the shop glow.
const GLASS_GLOW_TINTS = [
  [1.0, 0.85, 0.60], [1.0, 0.85, 0.60], [1.0, 0.85, 0.60],
  [1.0, 0.72, 0.70], [1.0, 0.78, 0.45],
];
const hash01 = (x, z) => {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
};
const darken = (c, f) => [c[0] * f, c[1] * f, c[2] * f];
const lighten = (c, f) => [Math.min(1, c[0] * f), Math.min(1, c[1] * f), Math.min(1, c[2] * f)];
function addPartAt(g, part, x, y, z) {
  for (let i = 0; i < part.pos.length; i += 3) { part.pos[i] += x; part.pos[i + 1] += y; part.pos[i + 2] += z; }
  g.pos.push(...part.pos); g.nrm.push(...part.nrm); g.col.push(...part.col);
}

// Entrance kit (local space, door faces +z): sign band + 2 pillars + door.
// Instanced at each building's front face, tinted with the facade colour.
// The canopy moved out to the shared pastel awning mesh (shopsigns.js,
// Phase I) so every ground floor gets a soft-pastel awning; the band
// (3.6 m, wider than the 3.0 m name sign) carries the shop/place name.
export function buildEntranceKitGeom() {
  const g = emptyGeom();
  addPartAt(g, plainBox(3.6, 0.5, 0.14, [1, 1, 1]), 0, 2.7, 0.07); // sign band
  for (const px of [-1.4, 1.4]) addPartAt(g, plainBox(0.18, 2.6, 0.18, [0.9, 0.9, 0.88]), px, 1.3, 1.0); // pillars
  addPartAt(g, plainBox(1.2, 2.2, 0.1, [0.2, 0.2, 0.22]), 0, 1.1, 0.05); // door
  return g;
}
// Shopfront kit (local space, faces +z): wide glass band + sign band +
// door. Instanced with a per-building accent tint, so each shop
// reads as its own brand colour (the white sign band takes the tint).
// The canopy moved out to the shared pastel awning mesh (shopsigns.js,
// Phase I). (36 tris since Phase I — the phase-f test pins this.)
export function buildShopfrontGeom() {
  const g = emptyGeom();
  addPartAt(g, plainBox(6.0, 1.8, 0.12, [0.3, 0.4, 0.5]), 0, 1.5, 0.06); // shop glass
  addPartAt(g, plainBox(6.0, 0.5, 0.14, [1, 1, 1]), 0, 2.7, 0.07); // sign band
  addPartAt(g, plainBox(1.2, 2.2, 0.1, [0.2, 0.2, 0.22]), 0, 1.1, 0.12); // door
  return g;
}
// Balcony (local space, extends +z from the facade): slab + front rail.
export function buildBalconyGeom() {
  const g = emptyGeom();
  addPartAt(g, plainBox(2.2, 0.15, 0.9, [0.85, 0.85, 0.83]), 0, 0, 0.45); // slab
  addPartAt(g, plainBox(2.2, 0.9, 0.06, [0.25, 0.25, 0.28]), 0, 0.45, 0.88); // front rail
  return g;
}
// Roof clutter (local space, base at y=0): water tank + AC box + antenna.
export function buildRoofUnitGeom() {
  const g = emptyGeom();
  addPartAt(g, plainBox(1.2, 1.2, 1.2, [0.55, 0.55, 0.5]), 0, 1.1, 0); // water tank
  addPartAt(g, plainBox(0.9, 0.6, 0.9, [0.7, 0.7, 0.68]), 1.2, 0.3, 0.5); // AC box
  addPartAt(g, plainBox(0.12, 3.5, 0.12, [0.4, 0.4, 0.42]), -1.0, 1.75, -0.5); // antenna
  return g;
}

export function buildBuildingMeshes(gl, progs, city) {
  const bases = {};
  // Mu 23 Nov 21:19 — CBD full window glass: a curtain-wall variant of
  // every height class (SAME grid as the plain class, so buildLitWindows
  // still lands exactly on the glass cells). Downtown towers use the
  // curtain geometry; every other building keeps the plain one.
  const glassBases = {};
  for (const [name, cfg] of Object.entries(BUILDING_CLASSES)) {
    bases[name] = {
      geom: subdividedBox(1, 1, 1, cfg.segFront, cfg.segRows, cfg.sideCols),
      matrices: [], tints: [], prog: progs.litInst,
    };
    glassBases[name] = {
      geom: subdividedBox(1, 1, 1, cfg.segFront, cfg.segRows, cfg.sideCols, true),
      matrices: [], tints: [], prog: progs.litInst,
    };
  }
  const roofMatrices = [];
  const roofTints = [];
  // Iconic CBD towers (b.shape): stepped tiers, a spire, or a crown on top,
  // so the skyline reads as landmarks, not identical boxes.
  const tierMatrices = [], tierTints = [];
  const spireMatrices = [], spireTints = [];
  const crownMatrices = [], crownTints = [];
  // Mu 23 Nov 21:03: two more iconic shapes for the 150-200 m CBD towers —
  // 'twist' (stacked tiers rotating a little at each level) and 'taper'
  // (stacked boxes shrinking to a point, modern tapered silhouette).
  const twistMatrices = [], twistTints = [];
  const taperMatrices = [], taperTints = [];
  // Mu 23 Nov 22:12 — solid roof CAP under every shaped tower's crown:
  // a full-footprint closed box at the tower top, so the crown tiers
  // sit on a solid ivory platform instead of floating over the dark
  // roof tray (the "kopong" look). 1 m tall, so the roof units
  // (tank bottom at h+1.25) still sit clear above it.
  const capMatrices = [], capTints = [];
  const plinthMatrices = [], plinthTints = [];
  const corniceMatrices = [], corniceTints = [];
  const entranceMatrices = [], entranceTints = [];
  const shopfrontMatrices = [], shopfrontTints = [];
  const balconyMatrices = [], balconyTints = [];
  const roofUnitMatrices = [], roofUnitTints = [];
  // Phase H: ground-floor glass band on every building, roof deck +
  // parapet walls on mid/tall buildings.
  const glassBandMatrices = [], glassBandTints = [];
  // Mu (lively city): on TALL buildings (h >= 12, tower/mid-rise, every
  // zone) the ground floor is REAL glass — a transparent pale band, not
  // the dark solid panel — with a warm glowing interior core behind it
  // that lights up at night from INSIDE the glass frame.
  const glassBandTallMatrices = [], glassBandTallTints = [];
  const glassGlowMatrices = [], glassGlowTints = [];
  const roofDeckMatrices = [], roofDeckTints = [];
  const parapetNSMatrices = [], parapetNSTints = [];
  const parapetEWMatrices = [], parapetEWTints = [];
  const unitBox = plainBox(1, 1, 1, [1, 1, 1]);
  const parapetNSGeom = plainBox(1, 1, 0.15, [1, 1, 1]);
  const parapetEWGeom = plainBox(0.15, 1, 1, [1, 1, 1]);
  for (const b of city.buildings) {
    // Base box is centred; lift so its bottom sits on the ground.
    // Downtown towers ride the glass curtain-wall geometry (lighter
    // pale sky-blue since Mu 23 Nov 22:17); every other building keeps
    // the plain wall + window geometry.
    const cls = buildingClass(b.h);
    const base = b.zone === 'downtown' ? glassBases[cls] : bases[cls];
    base.matrices.push(mat4TRS(b.x, b.h / 2, b.z, b.rot, b.w, b.h, b.d));
    base.tints.push(b.color);
    // Roof slab, coloured by zone (varied a touch per building).
    roofMatrices.push(mat4TRS(b.x, b.h + 0.25, b.z, b.rot, b.w + 0.7, 0.5, b.d + 0.7));
    const rv = 0.92 + hash01(b.x, b.z) * 0.16;
    const rc = ROOF_COLORS[b.zone] || ROOF_COLORS.residential;
    roofTints.push([rc[0] * rv, rc[1] * rv, rc[2] * rv]);
    // Plinth (base band, darker facade) + cornice (top band, lighter).
    // Mu 23 Nov 22:55 — downtown towers get NO plinth: the darkened base
    // band was part of the grey strip under the glass. Their ground floor
    // is a glass lobby instead (big pillars + frames, below).
    const isDowntown = b.zone === 'downtown';
    if (!isDowntown) {
      plinthMatrices.push(mat4TRS(b.x, 0.3, b.z, b.rot, b.w + 0.6, 0.6, b.d + 0.6));
      plinthTints.push(darken(b.color, 0.7));
    }
    corniceMatrices.push(mat4TRS(b.x, b.h - 0.2, b.z, b.rot, b.w + 0.5, 0.4, b.d + 0.5));
    corniceTints.push(lighten(b.color, 1.15));
    // Ground-floor glass band: a glass strip around the base (y 0..2.2),
    // 0.06 proud of the facade (depth-safe at aerial range). The plinth
    // (0.3 proud) covers its bottom 0.6 m; the shopfront/entrance kits
    // sit proud of it, so the band reads around them, never through them.
    // Tall buildings get the transparent pale band + warm interior core
    // (drawn with the transparent / night-only programs in render.js);
    // low houses keep the dark lit band.
    if (b.h >= 12) {
      if (isDowntown) {
        // --- CBD glass lobby (Mu 23 Nov 22:55) ---
        // Root cause of the grey strip: the curtain wall's ground row
        // (j=0) is plain mullion-grey, never glass — on a 150-200 m tower
        // that row is 4-8 m tall, so the base read as one big flat grey
        // wall under the glass. The lobby covers the whole ground row:
        // bright interior core (day) + clear glass + warm glow core
        // behind the glass (night, full 360°), framed by big pillars.
        // Lobby height = the curtain's ground-row height for this class.
        const lobbyH = b.h / BUILDING_CLASSES[cls].segRows;
        // Bright warm lobby interior, just proud of the facade (+0.02) —
        // seen through the clear glass by day.
        glassBandMatrices.push(mat4TRS(b.x, lobbyH / 2, b.z, b.rot, b.w + 0.04, lobbyH, b.d + 0.04));
        glassBandTints.push([0.96, 0.94, 0.88]);
        // Clear bright glass, full lobby height (+0.08 proud).
        glassBandTallMatrices.push(mat4TRS(b.x, lobbyH / 2, b.z, b.rot, b.w + 0.16, lobbyH, b.d + 0.16));
        glassBandTallTints.push([0.93, 0.97, 1.0]);
        // Warm glow core BEHIND the glass (+0.05 proud, glass at +0.08),
        // so at night the whole lobby glows through the glass instead of
        // the core hiding it as a flat panel. Brighter than the old core
        // (jitter 1.0-1.15), full lobby height, all four faces.
        glassGlowMatrices.push(mat4TRS(b.x, lobbyH / 2, b.z, b.rot, b.w + 0.10, lobbyH, b.d + 0.10));
        const gt = GLASS_GLOW_TINTS[Math.floor(hash01(b.x + 5, b.z + 9) * GLASS_GLOW_TINTS.length)];
        const gj = 1.0 + hash01(b.x, b.z + 4) * 0.15;
        glassGlowTints.push([gt[0] * gj, gt[1] * gj, gt[2] * gj]);
        // Big pillars + dark frames on all four faces (into the plinth
        // mesh — same unitBox, same lit program, +0 draw calls).
        const pillarTint = [0.88, 0.86, 0.80]; // warm light stone
        const frameTint = [0.28, 0.30, 0.34]; // soft dark frame
        // Four square corner pillars (read on both faces).
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          const wx = b.x + Math.cos(b.rot) * (sx * b.w / 2) + Math.sin(b.rot) * (sz * b.d / 2);
          const wz = b.z - Math.sin(b.rot) * (sx * b.w / 2) + Math.cos(b.rot) * (sz * b.d / 2);
          plinthMatrices.push(mat4TRS(wx, lobbyH / 2, wz, b.rot, 1.2, lobbyH, 1.2));
          plinthTints.push(pillarTint);
        }
        for (const turn of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
          const rot = b.rot + turn;
          const nx = Math.sin(rot), nz = Math.cos(rot);
          const ax = Math.cos(rot), az = -Math.sin(rot);
          const across = (turn === 0 || turn === Math.PI) ? b.w : b.d;
          const out = (turn === 0 || turn === Math.PI) ? b.d : b.w;
          const cx = b.x + nx * (out / 2), cz = b.z + nz * (out / 2);
          // Intermediate pillars every ~6 m. The front face keeps a clear
          // 6.4 m entrance bay for the door + shop sign.
          const nSeg = Math.max(2, Math.round(across / 6));
          const kept = [-across / 2];
          for (let k = 1; k < nSeg; k++) {
            const t = -across / 2 + (k * across) / nSeg;
            if (turn === 0 && Math.abs(t) < 3.2) continue;
            kept.push(t);
            plinthMatrices.push(mat4TRS(cx + ax * t, lobbyH / 2, cz + az * t, rot, 1.2, lobbyH, 0.6));
            plinthTints.push(pillarTint);
          }
          kept.push(across / 2);
          // Slim vertical mullion mid-panel between neighbouring pillars
          // (skipped across the front door), top rail, and a segmented
          // bottom rail (no rail across the door — it would read as a bar
          // over the doorway).
          for (let i = 0; i < kept.length - 1; i++) {
            const tm = (kept[i] + kept[i + 1]) / 2;
            if (turn === 0 && Math.abs(tm) < 1.6) continue;
            plinthMatrices.push(mat4TRS(cx + ax * tm, lobbyH / 2, cz + az * tm, rot, 0.15, lobbyH - 0.52, 0.18));
            plinthTints.push(frameTint);
          }
          plinthMatrices.push(mat4TRS(cx + nx * 0.10, lobbyH - 0.13, cz + nz * 0.10, rot, across, 0.26, 0.18));
          plinthTints.push(frameTint);
          for (let i = 0; i < kept.length - 1; i++) {
            const a = kept[i], c = kept[i + 1];
            if (turn === 0 && a < 1.6 && c > -1.6) continue;
            const tm = (a + c) / 2;
            plinthMatrices.push(mat4TRS(cx + ax * tm, 0.13, cz + az * tm, rot, c - a, 0.26, 0.18));
            plinthTints.push(frameTint);
          }
        }
      } else {
        glassBandTallMatrices.push(mat4TRS(b.x, 1.1, b.z, b.rot, b.w + 0.14, 2.2, b.d + 0.14));
        glassBandTallTints.push([0.85, 0.92, 1.0]); // pale blue-white glass
        // Mu 23 Nov 21:19 — the glow core on other tall buildings sits
        // just proud of the glass band (0.01 m), so the warm band reads
        // directly instead of dimmed behind the glass.
        glassGlowMatrices.push(mat4TRS(b.x, 1.05, b.z, b.rot, b.w + 0.02, 1.9, b.d + 0.02));
        const gt = GLASS_GLOW_TINTS[Math.floor(hash01(b.x + 5, b.z + 9) * GLASS_GLOW_TINTS.length)];
        const gj = 0.85 + hash01(b.x, b.z + 4) * 0.15;
        glassGlowTints.push([gt[0] * gj, gt[1] * gj, gt[2] * gj]);
      }
    } else {
      glassBandMatrices.push(mat4TRS(b.x, 1.1, b.z, b.rot, b.w + 0.12, 2.2, b.d + 0.12));
      glassBandTints.push(GLASS_BAND[b.zone] || [0.4, 0.42, 0.4]);
    }
    // Roof deck + parapet walls on mid/tall buildings: a slab on the roof
    // (0.6 of the footprint) ringed by low walls at the roof-slab edge.
    if (b.h >= 12) {
      roofDeckMatrices.push(mat4TRS(b.x, b.h + 0.62, b.z, b.rot, b.w * 0.6, 0.25, b.d * 0.6));
      roofDeckTints.push([rc[0] * rv * 0.85, rc[1] * rv * 0.85, rc[2] * rv * 0.85]);
      const sr = Math.sin(b.rot), cr = Math.cos(b.rot);
      const parTint = darken(b.color, 0.75);
      for (const s of [-1, 1]) {
        // NS walls (local z faces): length w+0.7 along local x.
        parapetNSMatrices.push(mat4TRS(b.x + sr * s * (b.d / 2 + 0.28), b.h + 1.0, b.z + cr * s * (b.d / 2 + 0.28), b.rot, b.w + 0.7, 1.0, 1));
        parapetNSTints.push(parTint);
        // EW walls (local x faces): length d+0.7 along local z.
        parapetEWMatrices.push(mat4TRS(b.x + cr * s * (b.w / 2 + 0.28), b.h + 1.0, b.z - sr * s * (b.w / 2 + 0.28), b.rot, 1, 1.0, b.d + 0.7));
        parapetEWTints.push(parTint);
      }
    }
    // Front face centre (local +z after rotY is the outward normal).
    const fx = b.x + Math.sin(b.rot) * (b.d / 2);
    const fz = b.z + Math.cos(b.rot) * (b.d / 2);
    const kitScale = Math.min(1.6, Math.max(0.8, b.w / 14));
    if (b.zone === 'commercial' || b.zone === 'downtown') {
      shopfrontMatrices.push(mat4TRS(fx, 0, fz, b.rot, kitScale, 1, 1));
      shopfrontTints.push(SHOP_ACCENTS[Math.floor(hash01(b.x + 3, b.z) * SHOP_ACCENTS.length)]);
    } else {
      entranceMatrices.push(mat4TRS(fx, 0, fz, b.rot, kitScale, 1, 1));
      entranceTints.push(darken(b.color, 0.9));
    }
    // Balconies on the front face, floors 2..4, for multi-storey blocks —
    // only where the balcony sits below the roof (y < h - 1). NOT on
    // downtown towers (Mu 23 Nov 21:19): a glass curtain wall stays clean,
    // no balcony slabs sticking out of the glass.
    if (b.h >= 8 && b.zone !== 'downtown' && (b.zone === 'residential' || b.zone === 'commercial' || b.zone === 'beach')) {
      const nB = Math.max(0, Math.min(3, Math.floor((b.h - 1) / 3.2) - 1));
      for (let k = 0; k < nB; k++) {
        const fy = (k + 2) * 3.2;
        const along = (k % 2 === 0 ? -1 : 1) * b.w * 0.22;
        const bx = fx + Math.cos(b.rot) * along;
        const bz = fz - Math.sin(b.rot) * along;
        balconyMatrices.push(mat4TRS(bx, fy, bz, b.rot, 1, 1, 1));
        balconyTints.push(darken(b.color, 0.85));
      }
    }
    // Roof clutter on about half the buildings tall enough to carry it.
    // On decked roofs (h >= 12) the units sit ON the deck (top h+0.75),
    // not half-buried in it.
    if (b.h >= 6 && hash01(b.x + 11, b.z + 5) < 0.5) {
      const ox = (hash01(b.x, b.z + 1) - 0.5) * b.w * 0.4;
      const oz = (hash01(b.x + 2, b.z) - 0.5) * b.d * 0.4;
      roofUnitMatrices.push(mat4TRS(b.x + ox, b.h + (b.h >= 12 ? 0.75 : 0.5), b.z + oz, b.rot, 1, 1, 1));
      roofUnitTints.push([1, 1, 1]);
    }
    if (!b.shape) continue;
    // Solid roof cap (Mu 23 Nov 22:12): the crown tiers sit on this
    // full-footprint platform — no dark tray, no floating slabs.
    // Mu 23 Nov 22:17 — the cap follows the tower tint
    // (lighten(b.color, 1.05)), so after the tint change back to
    // lighter pale sky-blue it matches the tower: bright, solid, no
    // hollow. The roof SLAB underneath stays ivory (see ROOF_COLORS
    // above) — bright, never a dark hole.
    capMatrices.push(mat4TRS(b.x, b.h + 0.5, b.z, b.rot, b.w * 0.98, 1.0, b.d * 0.98));
    capTints.push(lighten(b.color, 1.05));
    if (b.shape === 'tiered' || b.shape === 'glass') {
      tierMatrices.push(mat4TRS(b.x, b.h + b.h * 0.11, b.z, b.rot, b.w * 0.68, b.h * 0.22, b.d * 0.68));
      tierTints.push(darken(b.color, 0.85));
      // Tier 2 sinks 0.01h into tier 1 (was an exact touch at 0.22h —
      // zero overlap, one rounding away from a visible slit).
      tierMatrices.push(mat4TRS(b.x, b.h + b.h * 0.27, b.z, b.rot, b.w * 0.42, b.h * 0.12, b.d * 0.42));
      tierTints.push(darken(b.color, 0.72));
    }
    if (b.shape === 'spire') {
      spireMatrices.push(mat4TRS(b.x, b.h + 9, b.z, b.rot, 2.6, 18, 2.6));
      spireTints.push([0.25, 0.28, 0.35]);
      spireMatrices.push(mat4TRS(b.x, b.h + 19, b.z, b.rot, 0.9, 5, 0.9));
      spireTints.push([0.9, 0.75, 0.4]);
    }
    if (b.shape === 'crown') {
      crownMatrices.push(mat4TRS(b.x, b.h + b.h * 0.05, b.z, b.rot + Math.PI / 4, b.w * 0.55, b.h * 0.1, b.d * 0.55));
      crownTints.push(lighten(b.color, 1.15));
      crownMatrices.push(mat4TRS(b.x, b.h + 6, b.z, b.rot, 1.6, 12, 1.6));
      crownTints.push([0.3, 0.32, 0.38]);
    }
    if (b.shape === 'twist') {
      // Three stacked tiers, each rotated a little further and smaller —
      // a modern twisted tower. Rotations are absolute (base rot + twist).
      twistMatrices.push(mat4TRS(b.x, b.h + b.h * 0.07, b.z, b.rot + 0.10, b.w * 0.72, b.h * 0.14, b.d * 0.72));
      twistTints.push(darken(b.color, 0.88));
      twistMatrices.push(mat4TRS(b.x, b.h + b.h * 0.17, b.z, b.rot + 0.22, b.w * 0.5, b.h * 0.1, b.d * 0.5));
      twistTints.push(darken(b.color, 0.76));
      twistMatrices.push(mat4TRS(b.x, b.h + b.h * 0.25, b.z, b.rot + 0.34, b.w * 0.32, b.h * 0.08, b.d * 0.32));
      twistTints.push(darken(b.color, 0.66));
      // The pole used to FLOAT: its bottom (0.32h-5) sat 0.25 m above
      // tier 3's top (0.29h) on the h=175 tower (gap = 0.03h-5 > 0 for
      // h > 167) — a real see-through slit under the pole. Now the pole
      // is longer and starts 2 m INSIDE tier 3, keeping the same top
      // (0.32h+5): height 0.03h+7, centre 0.305h+1.5.
      twistMatrices.push(mat4TRS(b.x, b.h + b.h * 0.305 + 1.5, b.z, b.rot + 0.34, 1.2, b.h * 0.03 + 7, 1.2));
      twistTints.push([0.3, 0.32, 0.38]);
    }
    if (b.shape === 'taper') {
      // Stacked boxes shrinking toward a point — a tapered modern tower.
      taperMatrices.push(mat4TRS(b.x, b.h + b.h * 0.08, b.z, b.rot, b.w * 0.8, b.h * 0.16, b.d * 0.8));
      taperTints.push(darken(b.color, 0.9));
      taperMatrices.push(mat4TRS(b.x, b.h + b.h * 0.2, b.z, b.rot, b.w * 0.55, b.h * 0.12, b.d * 0.55));
      taperTints.push(darken(b.color, 0.78));
      taperMatrices.push(mat4TRS(b.x, b.h + b.h * 0.3, b.z, b.rot, b.w * 0.32, b.h * 0.1, b.d * 0.32));
      taperTints.push(darken(b.color, 0.68));
      // Same floating-pole guard as the twist: the old pole bottom
      // (0.38h-6) only overlapped tier 3 (top 0.35h) by 6-0.03h — zero
      // at h=200. Now it starts 2 m INSIDE tier 3, same top (0.38h+6):
      // height 0.03h+8, centre 0.365h+2.
      taperMatrices.push(mat4TRS(b.x, b.h + b.h * 0.365 + 2, b.z, b.rot, 1.4, b.h * 0.03 + 8, 1.4));
      taperTints.push([0.9, 0.75, 0.4]);
    }
  }
  const part = (geom, matrices, tints) => ({ geom, matrices, tints, prog: progs.litInst });
  return {
    bases: [bases.short, bases.mid, bases.tall, bases.skyscraper],
    // CBD curtain-wall bases (only the classes downtown towers actually
    // use — tall + skyscraper — are non-empty; the rest are filtered out
    // so they cost no draw call).
    glassBases: [glassBases.short, glassBases.mid, glassBases.tall, glassBases.skyscraper]
      .filter((s) => s.matrices.length > 0),
    roofs: part(unitBox, roofMatrices, roofTints),
    tiers: part(unitBox, tierMatrices, tierTints),
    spires: part(unitBox, spireMatrices, spireTints),
    crowns: part(unitBox, crownMatrices, crownTints),
    twists: part(unitBox, twistMatrices, twistTints),
    tapers: part(unitBox, taperMatrices, taperTints),
    // Solid ivory roof caps under every shaped tower's crown (Mu 23 Nov
    // 22:12 — closes the hollow "kopong" roof). One instanced draw.
    caps: part(unitBox, capMatrices, capTints),
    plinth: part(unitBox, plinthMatrices, plinthTints),
    cornice: part(unitBox, corniceMatrices, corniceTints),
    entrance: part(buildEntranceKitGeom(), entranceMatrices, entranceTints),
    shopfront: part(buildShopfrontGeom(), shopfrontMatrices, shopfrontTints),
    balconies: part(buildBalconyGeom(), balconyMatrices, balconyTints),
    roofUnits: part(buildRoofUnitGeom(), roofUnitMatrices, roofUnitTints),
    glassBand: part(unitBox, glassBandMatrices, glassBandTints),
    // Tall-building ground-floor glass (transparent, pale) + its warm
    // interior glow core (night only). The glow is drawn BEFORE the
    // glass in render.js: glass writes depth, so the reverse order
    // would hide the core behind it.
    glassBandTall: part(unitBox, glassBandTallMatrices, glassBandTallTints),
    glassGlow: part(unitBox, glassGlowMatrices, glassGlowTints),
    roofDeck: part(unitBox, roofDeckMatrices, roofDeckTints),
    parapetNS: { geom: parapetNSGeom, matrices: parapetNSMatrices, tints: parapetNSTints, prog: progs.litInst },
    parapetEW: { geom: parapetEWGeom, matrices: parapetEWMatrices, tints: parapetEWTints, prog: progs.litInst },
  };
}

export function buildPalmMesh(city) {
  // One palm: leaning trunk (4 stacked segments) + crown of 6 drooping
  // fronds + 2 coconuts, merged into one geometry, instanced along main roads.
  const geom = { pos: [], nrm: [], col: [] };
  const add = (part) => { geom.pos.push(...part.pos); geom.nrm.push(...part.nrm); geom.col.push(...part.col); };
  const trunkCol = [0.52, 0.42, 0.3];
  const segY = [0.75, 2.2, 3.65, 5.05];
  const segX = [0, 0.14, 0.3, 0.5];
  for (let k = 0; k < 4; k++) {
    const seg = plainBox(0.3, 1.5, 0.3, trunkCol);
    for (let i = 0; i < seg.pos.length; i += 3) { seg.pos[i] += segX[k]; seg.pos[i + 1] += segY[k]; }
    add(seg);
  }
  // Fronds: long thin boxes, drooping ~28 degrees, fanning around the crown.
  // Eight fronds now (was six) so the crown reads dense, not sparse.
  for (let f = 0; f < 8; f++) {
    const a = (f / 8) * Math.PI * 2;
    const frond = plainBox(2.6, 0.06, 0.32, f % 2 === 0 ? [0.22, 0.52, 0.22] : [0.27, 0.58, 0.25]);
    for (let i = 0; i < frond.pos.length; i += 3) {
      let x = frond.pos[i] + 1.3; // inner end at the crown centre
      let y = frond.pos[i + 1];
      let z = frond.pos[i + 2];
      const droop = -0.5; // radians, outer end tips down
      const cd = Math.cos(droop), sd = Math.sin(droop);
      const x2 = x * cd - y * sd, y2 = x * sd + y * cd;
      const ca = Math.cos(a), sa = Math.sin(a);
      frond.pos[i] = 0.5 + x2 * ca + z * sa;
      frond.pos[i + 1] = 5.6 + y2;
      frond.pos[i + 2] = -x2 * sa + z * ca;
    }
    // Normals stay axis-ish after the fan rotation; good enough at this scale.
    add(frond);
  }
  for (const dz of [-0.2, 0.2]) {
    const nut = plainBox(0.3, 0.25, 0.3, [0.35, 0.25, 0.15]);
    for (let i = 0; i < nut.pos.length; i += 3) { nut.pos[i] += 0.35; nut.pos[i + 1] += 5.3; nut.pos[i + 2] += dz; }
    add(nut);
  }
  const matrices = [];
  const tints = [];
  for (const t of city.palmTrees) {
    matrices.push(mat4TRS(t.x, 0, t.z, t.rot, t.s, t.s, t.s));
    const v = 0.88 + ((t.x * 7 + t.z * 11) % 10) / 60;
    tints.push([v, v, v]);
  }
  return { geom, matrices, tints, prog: null };
}

export function buildLitWindows(city) {
  // Warm lit windows: a random SUBSET of the building's OWN dark window
  // cells — the exact same grid subdividedBox() draws (same class, same
  // segFront/segRows/sideCols, same cell (i,j), same centre). The lit quad
  // is drawn slightly INSET inside the glass quad (60% of the cell vs the
  // glass's 78%) and a touch more proud of the wall, so at night every
  // glowing square sits precisely inside a dark window frame — never
  // between windows, never outside a frame. Drawn with the unlit program
  // ONLY at night, one instanced draw call, ~10,500 windows.
  const quad = (() => {
    const g = { pos: [], nrm: [], col: [] };
    const white = [1, 1, 1];
    const n = [0, 0, 1];
    // CCW from +z: the front face points out of the building facade.
    g.pos.push(-0.9, -0.65, 0, 0.9, -0.65, 0, 0.9, 0.65, 0, -0.9, -0.65, 0, 0.9, 0.65, 0, -0.9, 0.65, 0);
    for (let k = 0; k < 6; k++) g.nrm.push(...n);
    for (let k = 0; k < 6; k++) g.col.push(...white);
    return g;
  })();
  const matrices = [], tints = [];
  const WARM = [[1, 0.85, 0.55], [1, 0.78, 0.45], [0.95, 0.9, 0.65], [1, 0.95, 0.8]];
  const COOL = [[0.7, 0.85, 1], [0.8, 0.9, 1]];
  // Mu 23 Nov 22:01 — CBD glass towers light up MUCH more at night:
  // 80 lit windows per tower (was 60, was 24), all in the two BRIGHTEST
  // warm tints and drawn BIGGER (72% of the cell vs 60%), so the pale
  // sky-blue glass reads alive after dark even from far away. Other
  // zones unchanged.
  const perZone = { downtown: 80, commercial: 15, residential: 7, beach: 12, port: 6, forest: 3 };
  // Every window cell of one building, in the SAME local frame
  // subdividedBox() uses: front/back faces nx=segFront (cell width
  // w/segFront), side faces nx=sideCols (cell width d/sideCols), all faces
  // ny=segRows (cell height h/segRows). Window cells: j>0, j<segRows-1,
  // i%2==0, j%2==0 — never the ground floor or the top floor.
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
  for (const b of city.buildings) {
    const cls = BUILDING_CLASSES[buildingClass(b.h)];
    const cells = windowCells(cls);
    const n = Math.min(perZone[b.zone] || 3, cells.length);
    // Random subset of the REAL cells (per-building seeded RNG, so the
    // pattern is stable frame to frame) — partial Fisher-Yates shuffle.
    const rand = mulberry32(Math.floor(Math.abs(b.x) * 131 + Math.abs(b.z) * 17 + 7));
    for (let k = 0; k < n; k++) {
      const pick = k + Math.floor(rand() * (cells.length - k));
      const tmp = cells[k]; cells[k] = cells[pick]; cells[pick] = tmp;
    }
    const sr = Math.sin(b.rot), cr = Math.cos(b.rot);
    for (let k = 0; k < n; k++) {
      const c = cells[k];
      const u = (c.i + 0.5) / c.nx - 0.5; // cell centre, fraction across the face
      const v = (c.j + 0.5) / cls.segRows - 0.5; // cell centre, fraction up the facade
      const faceW = c.face < 2 ? b.w : b.d; // face width in metres
      const cellW = faceW / c.nx, cellH = b.h / cls.segRows;
      // Local centre of the cell (building frame): the glass quad in
      // subdividedBox sits at this same centre, 0.005 proud; the lit quad
      // sits 0.012 proud so it renders on top of the glass, never
      // z-fighting. Back/right/left faces mirror the local x/z exactly as
      // subdividedBox builds them (the old code mirrored them wrong, so
      // lit squares landed between the dark windows).
      let lx, lz, rotY;
      if (c.face === 0) { // +d face
        lx = u * b.w; lz = b.d / 2 + 0.012 * b.d; rotY = b.rot;
      } else if (c.face === 1) { // -d face
        lx = -u * b.w; lz = -(b.d / 2 + 0.012 * b.d); rotY = b.rot + Math.PI;
      } else if (c.face === 2) { // +w face
        lx = b.w / 2 + 0.012 * b.w; lz = -u * b.d; rotY = b.rot + Math.PI / 2;
      } else { // -w face
        lx = -(b.w / 2 + 0.012 * b.w); lz = u * b.d; rotY = b.rot - Math.PI / 2;
      }
      const fx = b.x + lx * cr + lz * sr;
      const fz = b.z - lx * sr + lz * cr;
      const y = b.h / 2 + v * b.h;
      // Quad geometry is 1.8 x 1.3 m; scale it to 60% of the cell so the
      // glow sits INSIDE the 78% glass quad with a dark frame around it.
      // Downtown towers: 72% — a bigger, brighter square that still fits
      // inside the glass, so it reads from far away at night.
      const q = b.zone === 'downtown' ? 0.72 : 0.60;
      matrices.push(mat4TRS(fx, y, fz, rotY, q * cellW / 1.8, q * cellH / 1.3, 1));
      // CBD towers glow warm only (Mu 23 Nov 21:19: kuning hangat, never
      // cool white) — and only the two BRIGHTEST warm tints (Mu 23 Nov
      // 22:01: brighter, visible from afar); other zones keep the full
      // warm mix at ~80% warm / 20% cool.
      const warm = b.zone === 'downtown' ? true : rand() < 0.8;
      const pal = b.zone === 'downtown'
        ? [[1, 0.95, 0.8], [1, 0.85, 0.55]]
        : warm ? WARM : COOL;
      tints.push(pal[Math.floor(rand() * pal.length)]);
    }
  }
  return { geom: quad, matrices, tints };
}

export function buildTreeMesh(gl, progs, city) {
  // Lush broadleaf tree: a taller trunk + two visible branches spreading
  // into a dense crown of three overlapping foliage blobs (two greens),
  // instanced for street + forest. The crown is ~2.4 m wide at scale 1:
  // street trees sit 5.5 m from the road centre line (asphalt ends at
  // 4 m, buildings start at 7 m), so even at max scale 1.15 the crown
  // (radius ~1.4 m) stays clear of the asphalt and the facades, and its
  // lowest leaves (~2 m up) stay above doors, signs and sightlines.
  const geom = emptyGeom();
  const TRUNK = [0.4, 0.28, 0.16];
  const LEAF = [0.2, 0.48, 0.2];
  const LEAF_LT = [0.27, 0.56, 0.25];
  const shift = (part, x, y, z) => {
    for (let i = 0; i < part.pos.length; i += 3) { part.pos[i] += x; part.pos[i + 1] += y; part.pos[i + 2] += z; }
    return part;
  };
  const rotZ = (part, a) => {
    const c = Math.cos(a), s = Math.sin(a);
    for (let i = 0; i < part.pos.length; i += 3) {
      const x = part.pos[i], y = part.pos[i + 1];
      part.pos[i] = x * c - y * s;
      part.pos[i + 1] = x * s + y * c;
    }
    for (let i = 0; i < part.nrm.length; i += 3) {
      const nx = part.nrm[i], ny = part.nrm[i + 1];
      part.nrm[i] = nx * c - ny * s;
      part.nrm[i + 1] = nx * s + ny * c;
    }
    return part;
  };
  addPartAt(geom, plainBox(0.36, 2.0, 0.36, TRUNK), 0, 1.0, 0); // trunk
  // Two branches from the trunk top, leaning out into the crown.
  addPartAt(geom, rotZ(shift(plainBox(0.13, 1.1, 0.13, TRUNK), 0, 0.55, 0), 0.5), 0, 1.9, 0);
  addPartAt(geom, rotZ(shift(plainBox(0.13, 1.1, 0.13, TRUNK), 0, 0.55, 0), -0.5), 0, 1.9, 0);
  // Dense crown: one big central blob + two lighter side blobs.
  addPartAt(geom, plainBox(2.2, 1.2, 2.2, LEAF), 0, 2.85, 0);
  addPartAt(geom, plainBox(1.3, 0.9, 1.3, LEAF_LT), 0.55, 2.45, 0.55);
  addPartAt(geom, plainBox(1.3, 0.9, 1.3, LEAF_LT), -0.55, 2.45, -0.55);
  const matrices = [];
  const tints = [];
  const all = [...city.streetTrees, ...city.forestTrees];
  for (const t of all) {
    const rot = (t.x * 0.37 + t.z * 0.73) % (Math.PI * 2);
    matrices.push(mat4TRS(t.x, 0, t.z, rot, t.s, t.s, t.s));
    const v = 0.85 + ((t.x * 13 + t.z * 7) % 10) / 50;
    tints.push([v, v, v]);
  }
  return { geom, matrices, tints, prog: progs.litInst };
}
