// Teluk Rimba — city dataset (PURE: no WebGL, no DOM, no three.js).
// One shared dataset drives buildings, roads, markings, traffic, minimap and
// tests, so everything always matches. Deterministic: same seed -> same city.
// Importable from Node for the connectivity test and from the browser game.

import { mulberry32, range, rangeInt, clamp, smoothstep, hash2 } from './rng.js';

export const SEED = 20261122;
export const TARGET_BUILDINGS = 1000;

// Mu: NO building flush against a road — every facade sits back from its
// block edge by SETBACK_M, so a sidewalk strip + trees always separate
// it from the asphalt.
export const SETBACK_M = 3;

// Road grid: 13 lines per axis, 100 m apart. Mains every other line.
export const ROAD_LINES = [-600, -500, -400, -300, -200, -100, 0, 100, 200, 300, 400, 500, 600];
export const MAIN_LINES = new Set([-400, -200, 0, 200, 400]);
export const CORRIDOR_HALF = (line) => (MAIN_LINES.has(line) ? 9 : 7); // road + sidewalks
export const ASPHALT_HALF = (line) => (MAIN_LINES.has(line) ? 6 : 4); // main: 12 m asphalt (4 lanes); minor: 8 m asphalt (2 lanes) + 3 m sidewalk each side
export const IS_MAIN = (line) => MAIN_LINES.has(line);

// River: from the volcano (NW) through the city centre to the sea (E).
export const RIVER_POINTS = [
  [-780, -780], [-480, -480], [-220, -260], [0, -80],
  [220, 10], [420, 60], [660, 110],
];
export const RIVER_HALF_WIDTH = 11;
export const SEA_LEVEL = -1.2;
export const CITY_HALF = 640;

export function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (pz - az) * dz) / len2;
  t = clamp(t, 0, 1);
  const cx = ax + t * dx, cz = az + t * dz;
  return Math.hypot(px - cx, pz - cz);
}

export function riverDistance(x, z) {
  let d = Infinity;
  for (let i = 0; i < RIVER_POINTS.length - 1; i++) {
    const [ax, az] = RIVER_POINTS[i];
    const [bx, bz] = RIVER_POINTS[i + 1];
    d = Math.min(d, distToSegment(x, z, ax, az, bx, bz));
  }
  return d;
}

// Terrain height: flat city, volcano cone behind (NW), beach slope to the sea (E),
// river channel carved through. The volcano only rises outside the city mask.
export function terrainHeight(x, z) {
  let h = 0;
  const outside = smoothstep(CITY_HALF, 780, Math.max(Math.abs(x), Math.abs(z)));
  const dv = Math.hypot(x + 880, z + 880);
  h += Math.max(0, 230 - dv * 0.32) * outside;
  // Gentle rolling ground outside the city, none inside (streets stay flat).
  h += 1.2 * Math.sin(x * 0.045) * Math.cos(z * 0.05) * outside;
  // Beach: slope down east of the city into the sea.
  h -= smoothstep(600, 800, x) * 5.0;
  // River channel: deeper + steeper (was -3.0 over rd<20) so the bridge
  // reads as a REAL bridge over a sunken river, not a road over a flat
  // blue strip. Waterline (y -0.85) now sits at rd ~8.6, banks drop 4 m.
  const rd = riverDistance(x, z);
  if (rd < 16 && x < 660) {
    h -= 4.0 * Math.pow(1 - rd / 16, 2);
  }
  // Lake basin below the waterfall (Mu): a bowl on the river at
  // (-440,-440) where the mountain river widens before the city.
  // The bowl is DEEP (6 m) and WIDE (75 m) so the whole 80 m lake disc
  // sits BELOW the surrounding ground — the old 3 m / 45 m bowl left
  // the disc's rim buried under flat ground, so the lake read as just
  // the river ribbon. Nearest building is 57 m away (the dip there is
  // only ~0.35 m); the M6 dirt track never reaches here (it stops at
  // (-580,-580)), so the bowl floods nothing.
  const ld = Math.hypot(x + 440, z + 440);
  if (ld < 75) h -= 6.0 * Math.pow(1 - ld / 75, 2);
  return h;
}

function zoneOf(cx, cz) {
  const r = Math.hypot(cx, cz);
  if (riverDistance(cx, cz) < 26) return 'river';
  if (cx >= 420) return 'beach';
  if (cx >= 300 && cz >= 300) return 'port';
  if (cx <= -380 && cz <= -380) return 'forest';
  if (r <= 260) return 'downtown';
  if (r <= 460) return 'commercial';
  return 'residential';
}

// --- Names: every block and every area has an English name (Mu's rule). ---
// Names are picked with the deterministic hash2 (NOT the rand stream), so
// naming never changes the city layout. All in-game text is English; the
// city proper name stays "Teluk Rimba".
export const AREA_NAMES = {
  downtown: 'Rimba Central',
  commercial: 'Merchant Quarter',
  residential: 'Palm Gardens',
  beach: 'Coral Beach',
  port: 'Rimba Harbor',
  forest: 'Volcano Woods',
  river: 'Rimba River',
  plaza: 'Rimba Plaza',
  market: 'Rimba Market',
  sea: 'Rimba Bay',
  volcano: 'Mount Rimba',
};

const NAME_FIRST = [
  'Coral', 'Palm', 'Jasmine', 'Harbor', 'Sunset', 'Mango', 'Coconut', 'Orchid',
  'Banyan', 'Lotus', 'Pearl', 'Amber', 'Marina', 'Lagoon', 'Breeze', 'Turtle',
  'Dolphin', 'Frangipani', 'Hibiscus', 'Kapok', 'Sandalwood', 'Nutmeg', 'Clove',
  'Papaya', 'Tamarind', 'Rattan', 'Seashell', 'Starfish', 'Moonlight', 'Sunrise',
  'Emerald', 'Jade', 'Ruby', 'Sapphire', 'Ivory', 'Opal', 'Garnet', 'Quartz',
  'Onyx', 'Willow',
];
const NAME_SUFFIX = {
  downtown: ['Tower', 'Heights', 'Plaza', 'Center', 'Square', 'Terrace'],
  commercial: ['Market', 'Row', 'Square', 'Walk', 'Court', 'Lane'],
  residential: ['Gardens', 'Court', 'Lane', 'Park', 'Terrace', 'Village'],
  beach: ['Beach', 'Bay', 'Shore', 'Cove', 'Sands', 'Point'],
  port: ['Harbor', 'Dock', 'Wharf', 'Yard', 'Pier', 'Terminal'],
  forest: ['Woods', 'Grove', 'Hill', 'Trail', 'Glade', 'Ridge'],
  river: ['Riverside', 'Bend', 'Bank', 'Reach', 'Ford', 'Creek'],
  plaza: ['Plaza'],
  market: ['Market'],
};

function blockNameFor(i, j, zone, used) {
  if (zone === 'plaza') return 'Rimba Plaza';
  if (zone === 'market') return 'Rimba Market';
  const suffixes = NAME_SUFFIX[zone] || NAME_SUFFIX.residential;
  const first = NAME_FIRST[Math.floor(hash2(i * 7 + 3, j * 11 + 5) * NAME_FIRST.length)];
  let suffix = suffixes[Math.floor(hash2(i * 13 + 1, j * 5 + 7) * suffixes.length)];
  let name = first + ' ' + suffix;
  if (!used.has(name)) { used.add(name); return name; }
  // Collision: try every other suffix, then a compass word, then a numeral.
  for (const s of suffixes) {
    const cand = first + ' ' + s;
    if (!used.has(cand)) { used.add(cand); return cand; }
  }
  for (const dir of ['North', 'South', 'East', 'West']) {
    const cand = first + ' ' + suffix + ' ' + dir;
    if (!used.has(cand)) { used.add(cand); return cand; }
  }
  let n = 2;
  while (used.has(name + ' ' + n)) n++;
  name = name + ' ' + n;
  used.add(name);
  return name;
}

// Area name at a world position: sea, river and volcano first, then the
// block the point stands in (plaza/market included), else the zone under it.
export function areaNameAt(city, x, z) {
  if (x > 640) return AREA_NAMES.sea;
  if (riverDistance(x, z) < 26) return AREA_NAMES.river;
  if (terrainHeight(x, z) > 60) return AREA_NAMES.volcano;
  const b = blockAt(city, x, z);
  if (b) return AREA_NAMES[b.zone] || AREA_NAMES.residential;
  return AREA_NAMES[zoneOf(x, z)] || AREA_NAMES.residential;
}

// The named block at a world position (null when standing on a road).
export function blockAt(city, x, z) {
  for (const b of city.blocks) {
    if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) return b;
  }
  return null;
}

// Display name for the HUD: "Area — Block" inside a block, else just the area.
export function placeNameAt(city, x, z) {
  const area = areaNameAt(city, x, z);
  const b = blockAt(city, x, z);
  if (b && b.zone !== 'plaza' && b.zone !== 'market') return area + ' — ' + b.name;
  return area;
}

const ZONE_COUNT = {
  // Mu 23 Nov 21:03: CBD towers must DIFFER from the rest — one BIG tower
  // per downtown block, using the empty space around them (was 1-2 smaller
  // buildings per block). The top-up loop still keeps the total at 1000.
  downtown: [1, 1],
  commercial: [6, 10],
  residential: [12, 18],
  beach: [3, 5],
  port: [2, 3],
  forest: [1, 2],
};

const ZONE_SIZE = {
  // Mu 23 Nov 21:03: downtown towers ~2x taller and much bigger than
  // before (was w/d 20-32, h 30-68) — modern iconic skyline, clearly
  // different from every other zone. Other zones UNCHANGED.
  downtown: { w: [30, 48], d: [30, 48], h: [60, 115] },
  commercial: { w: [12, 20], d: [12, 20], h: [10, 26] },
  residential: { w: [8, 13], d: [8, 13], h: [4, 8] },
  beach: { w: [16, 26], d: [14, 22], h: [20, 42] },
  port: { w: [24, 38], d: [18, 30], h: [8, 12] },
  forest: { w: [8, 12], d: [8, 12], h: [4, 6] },
};

// Mu 23 Nov 21:19 — CBD: FULL WINDOW GLASS. Downtown tint is the glass
// tint (multiplied by the curtain-wall glass colours in gl.js).
// Mu 23 Nov 22:01 — silver abu terang masih terasa dingin/kontras (opsi 3):
// kaca jadi BIRU LANGIT PUCAT — sangat muda, lembut, di antara silver dan
// biru langit: lebih hangat dari silver, jauh lebih lembut dari ocean blue
// gelap, nyambung dengan krem/putih sekitar + langit biru di atas.
// Mu 23 Nov 22:10 — biru langit pucat MASIH KURANG: kaca jadi PUTIH
// GADING (ivory white) — paling nyambung dengan gedung krem/putih sekitar,
// hangat, terang, tetap terbaca sebagai kaca lewat variasi selnya.
// Mu 23 Nov 22:17 — ivory KURANG: balik ke BIRU LANGIT PUCAT seperti
// a6c2f8d, tapi LEBIH MUDA lagi — nyaris putih-biru, birunya tetap terasa
// (b > g > r), nyambung dengan langit + krem sekitar.
// Mu 23 Nov 22:35 — NON-CBD: PASTEL LEMBUT per zona (opsi 1):
// tiap zona 5 varian pastel yang saling nyambung, dipilih acak per
// gedung (bukan satu warna datar lagi) — tetap SOFT, jangan gonjreng
// (aturan 22 Nov masih berlaku). Landmark overrides (hospital/police/
// school) still apply after.
const ZONE_COLORS = {
  downtown: [ // menara kaca BIRU LANGIT PUCAT — lebih muda dari a6c2f8d, nyaris putih-biru (b > g > r)
    [0.82, 0.90, 0.97], [0.85, 0.91, 0.98], [0.80, 0.89, 0.96],
    [0.88, 0.93, 0.99], [0.90, 0.94, 0.99], [0.84, 0.91, 0.98],
  ],
  commercial: [ // pastel hangat: krem, peach, kuning mentega, terakota pucat, rosé pucat
    [0.96, 0.88, 0.72], [0.97, 0.82, 0.68], [0.98, 0.92, 0.74],
    [0.93, 0.76, 0.66], [0.96, 0.84, 0.80],
  ],
  residential: [ // pastel sejuk: putih, mint, biru langit pucat, pink blush, lavender pucat
    [0.97, 0.97, 0.96], [0.88, 0.95, 0.90], [0.86, 0.92, 0.97],
    [0.97, 0.88, 0.88], [0.92, 0.90, 0.96],
  ],
  beach: [ // pastel pantai: putih pasir, aqua pucat, koral lembut, krem laut, hijau laut pucat
    [0.97, 0.93, 0.82], [0.82, 0.93, 0.92], [0.97, 0.82, 0.74],
    [0.95, 0.90, 0.80], [0.88, 0.94, 0.88],
  ],
  port: [ // pastel pelabuhan: abu-biru, slate pastel, biru dusty, abu hangat, teal pucat
    [0.55, 0.63, 0.73], [0.62, 0.68, 0.76], [0.66, 0.72, 0.82],
    [0.72, 0.70, 0.68], [0.60, 0.70, 0.72],
  ],
  forest: [ // pastel hutan: coklat kayu, sage green, lumut pucat, krem kayu, coklat muda
    [0.62, 0.45, 0.28], [0.72, 0.78, 0.62], [0.78, 0.82, 0.66],
    [0.82, 0.70, 0.52], [0.68, 0.60, 0.44],
  ],
};

function placeInBlock(rand, block, count, zone) {
  const out = [];
  const size = ZONE_SIZE[zone];
  const colors = ZONE_COLORS[zone];
  const bw = block.x1 - block.x0, bd = block.z1 - block.z0;
  const cols = Math.max(1, Math.ceil(Math.sqrt(count * (bw / bd))));
  const rows = Math.max(1, Math.ceil(count / cols));
  const cw = bw / cols, cd = bd / rows;
  let placed = 0;
  for (let r = 0; r < rows && placed < count; r++) {
    for (let c = 0; c < cols && placed < count; c++) {
      const cx = block.x0 + cw * (c + 0.5) + range(rand, -cw * 0.12, cw * 0.12);
      const cz = block.z0 + cd * (r + 0.5) + range(rand, -cd * 0.12, cd * 0.12);
      const rot90 = rand() < 0.5;
      let w = range(rand, size.w[0], size.w[1]);
      let d = range(rand, size.d[0], size.d[1]);
      w = Math.min(w, cw * 0.78); d = Math.min(d, cd * 0.78);
      if (rot90) { const t = w; w = d; d = t; }
      // Every facade sits back from its block edge by SETBACK_M (see the
      // module constant above). NOTE: the stored w/d are the box's local
      // dims — the VISUAL footprint extents are swapped when rot90, so
      // the margin is enforced on the visual extents. Shift the centre
      // inward; shrink only if the building is wider than the block
      // allows (blocks are >= 82 m wide, so this never triggers in
      // practice).
      let vw = rot90 ? d : w, vd = rot90 ? w : d; // visual footprint extents
      vw = Math.min(vw, bw - 2 * SETBACK_M);
      vd = Math.min(vd, bd - 2 * SETBACK_M);
      if (rot90) { d = vw; w = vd; } else { w = vw; d = vd; }
      const cx2 = Math.min(Math.max(cx, block.x0 + vw / 2 + SETBACK_M), block.x1 - vw / 2 - SETBACK_M);
      const cz2 = Math.min(Math.max(cz, block.z0 + vd / 2 + SETBACK_M), block.z1 - vd / 2 - SETBACK_M);
      const h = range(rand, size.h[0], size.h[1]);
      const col = colors[Math.floor(rand() * colors.length)];
      out.push({
        x: cx2, z: cz2, w, d, h,
        rot: rot90 ? Math.PI / 2 : 0,
        zone,
        color: col,
        floors: Math.max(1, Math.round(h / 3.2)),
      });
      placed++;
    }
  }
  return out;
}

export function generateCity(seed = SEED) {
  const rand = mulberry32(seed);

  // --- blocks (cells between road lines) ---
  const blocks = [];
  for (let i = 0; i < ROAD_LINES.length - 1; i++) {
    for (let j = 0; j < ROAD_LINES.length - 1; j++) {
      const x0 = ROAD_LINES[i] + CORRIDOR_HALF(ROAD_LINES[i]);
      const x1 = ROAD_LINES[i + 1] - CORRIDOR_HALF(ROAD_LINES[i + 1]);
      const z0 = ROAD_LINES[j] + CORRIDOR_HALF(ROAD_LINES[j]);
      const z1 = ROAD_LINES[j + 1] - CORRIDOR_HALF(ROAD_LINES[j + 1]);
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      let zone = zoneOf(cx, cz);
      // Reserved open blocks: central plaza + market block (shop phase later).
      if (i === 5 && j === 5) zone = 'plaza';
      if (i === 6 && j === 5) zone = 'market';
      blocks.push({ i, j, x0, x1, z0, z1, cx, cz, zone });
    }
  }
  // Every block gets a unique name (deterministic, hash-based).
  {
    const used = new Set();
    for (const b of blocks) b.name = blockNameFor(b.i, b.j, b.zone, used);
  }

  // --- buildings: per-block counts, then adjust to exactly 1000 ---
  const counts = blocks.map((b) => {
    if (b.zone === 'river' || b.zone === 'plaza' || b.zone === 'market') return 0;
    const [lo, hi] = ZONE_COUNT[b.zone];
    return rangeInt(rand, lo, hi);
  });
  const residentialIdx = blocks.map((b, k) => (b.zone === 'residential' ? k : -1)).filter((k) => k >= 0);
  let total = counts.reduce((a, b) => a + b, 0);
  let guard = 0;
  while (total > TARGET_BUILDINGS && guard++ < 5000) {
    const k = residentialIdx[Math.floor(rand() * residentialIdx.length)];
    if (counts[k] > 8) { counts[k]--; total--; }
  }
  guard = 0;
  while (total < TARGET_BUILDINGS && guard++ < 5000) {
    const k = residentialIdx[Math.floor(rand() * residentialIdx.length)];
    if (counts[k] < 20) { counts[k]++; total++; }
  }

  let buildings = [];
  blocks.forEach((b, k) => {
    if (counts[k] > 0) buildings.push(...placeInBlock(rand, b, counts[k], b.zone));
  });

  // Drop any building whose footprint reaches the river water, then top the
  // count back up to exactly 1000 with houses on valid residential plots.
  const clearOfRiver = (b) => {
    const pts = [
      [b.x, b.z],
      [b.x - b.w / 2, b.z - b.d / 2], [b.x + b.w / 2, b.z - b.d / 2],
      [b.x - b.w / 2, b.z + b.d / 2], [b.x + b.w / 2, b.z + b.d / 2],
    ];
    return pts.every(([x, z]) => riverDistance(x, z) > RIVER_HALF_WIDTH + 2);
  };
  buildings = buildings.filter(clearOfRiver);
  // Repair: a block whose only building was dropped by the river filter
  // must not stay empty (the connectivity test requires every non-river
  // block to hold a building). This bites downtown now that towers are
  // 30-48 m wide: a tower near the river can lose a corner to the water.
  // Place one building at the spot in the block farthest from the river,
  // sized to fit with the 3 m setback and >14 m river clearance.
  // Separate rand stream, so the rest of the city is unchanged.
  {
    const rrand = mulberry32(20261131);
    for (const blk of blocks) {
      if (blk.zone === 'river' || blk.zone === 'plaza' || blk.zone === 'market') continue;
      const has = buildings.some((b) => b.x >= blk.x0 && b.x <= blk.x1 && b.z >= blk.z0 && b.z <= blk.z1);
      if (has) continue;
      const size = ZONE_SIZE[blk.zone] || ZONE_SIZE.residential;
      const colors = ZONE_COLORS[blk.zone] || ZONE_COLORS.residential;
      const cands = [];
      for (let gy = 0; gy < 5; gy++) {
        for (let gx = 0; gx < 5; gx++) {
          const x = blk.x0 + (blk.x1 - blk.x0) * (gx + 0.5) / 5;
          const z = blk.z0 + (blk.z1 - blk.z0) * (gy + 0.5) / 5;
          cands.push({ x, z, rd: riverDistance(x, z) });
        }
      }
      cands.sort((a, c) => c.rd - a.rd);
      for (const c of cands) {
        let placed = false;
        for (let w = Math.min(size.w[1], 40); w >= 12; w -= 4) {
          // 0.5 m margin past the 3 m setback, so the setback never
          // lands exactly on the boundary (floating-point edge).
          if (c.x - w / 2 < blk.x0 + SETBACK_M + 0.5 || c.x + w / 2 > blk.x1 - SETBACK_M - 0.5) continue;
          if (c.z - w / 2 < blk.z0 + SETBACK_M + 0.5 || c.z + w / 2 > blk.z1 - SETBACK_M - 0.5) continue;
          const pts = [[c.x, c.z],
            [c.x - w / 2, c.z - w / 2], [c.x + w / 2, c.z - w / 2],
            [c.x - w / 2, c.z + w / 2], [c.x + w / 2, c.z + w / 2]];
          if (!pts.every(([x, z]) => riverDistance(x, z) > 14)) continue;
          const h = range(rrand, size.h[0], size.h[1]);
          buildings.push({
            x: c.x, z: c.z, w, d: w, h, rot: 0, zone: blk.zone,
            color: colors[Math.floor(rrand() * colors.length)],
            floors: Math.max(1, Math.round(h / 3.2)),
          });
          placed = true;
          break;
        }
        if (placed) break;
      }
    }
  }
  const residentialBlocks = blocks.filter((b) => b.zone === 'residential');
  let topTries = 0;
  while (buildings.length < TARGET_BUILDINGS && topTries++ < 20000) {
    const blk = residentialBlocks[Math.floor(rand() * residentialBlocks.length)];
    const size = ZONE_SIZE.residential;
    const w = range(rand, size.w[0], size.w[1]);
    const d = range(rand, size.d[0], size.d[1]);
    const x = range(rand, blk.x0 + w / 2 + SETBACK_M, blk.x1 - w / 2 - SETBACK_M);
    const z = range(rand, blk.z0 + d / 2 + SETBACK_M, blk.z1 - d / 2 - SETBACK_M);
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    const cand = { x, z, w, d, h: range(rand, size.h[0], size.h[1]), rot: 0, zone: 'residential', color: ZONE_COLORS.residential[Math.floor(rand() * ZONE_COLORS.residential.length)], floors: 1 };
    cand.floors = Math.max(1, Math.round(cand.h / 3.2));
    if (!clearOfRiver(cand)) continue;
    const clash = buildings.some((b) =>
      Math.abs(b.x - x) < (b.w + w) / 2 + 2 && Math.abs(b.z - z) < (b.d + d) / 2 + 2 &&
      b.x + b.w / 2 > blk.x0 && b.x - b.w / 2 < blk.x1 && b.z + b.d / 2 > blk.z0 && b.z - b.d / 2 < blk.z1);
    if (clash) continue;
    buildings.push(cand);
  }

  // --- CBD iconic towers (Mu): the 10 tallest downtown buildings become
  // taller, bigger, recognisable landmarks — tiered / spire / crown /
  // glass / twist / taper. Mu 23 Nov 21:03: CBD must DIFFER from every
  // other zone — bigger footprints (using the empty space around them,
  // still inside their blocks) and ~2x taller, modern + iconic.
  // Regular downtown is 60-115 m; the 10 icons are 150-200 m (was
  // 78-105 m). Shapes are assigned by height rank so all 6 shapes appear.
  // Separate rand stream, so the rest of the city is unchanged. Towers too
  // close to the river are skipped: growing the footprint must not push a
  // corner into the water (the connectivity test needs >13 m clearance).
  {
    const trand = mulberry32(20261130);
    const shapes = ['twist', 'taper', 'spire', 'glass', 'crown', 'tiered'];
    const cands = buildings
      .filter((b) => b.zone === 'downtown')
      .filter((b) => {
        const pts = [[b.x, b.z],
          [b.x - b.w / 2, b.z - b.d / 2], [b.x + b.w / 2, b.z - b.d / 2],
          [b.x - b.w / 2, b.z + b.d / 2], [b.x + b.w / 2, b.z + b.d / 2]];
        return pts.every(([x, z]) => riverDistance(x, z) > 20);
      })
      .sort((a, b) => b.h - a.h)
      .slice(0, 10);
    for (let i = 0; i < cands.length; i++) {
      const b = cands[i];
      b.h = Math.round(range(trand, 150, 200));
      b.w = Math.min(56, Math.round(b.w * 1.6));
      b.d = Math.min(56, Math.round(b.d * 1.6));
      b.floors = Math.max(1, Math.round(b.h / 3.2));
      b.shape = shapes[i % shapes.length];
      if (b.shape === 'glass') b.color = [0.84, 0.91, 0.98]; // lighter pale sky-blue glass (Mu 23 Nov 22:17)
      // No facade flush against a road — the grown tower must sit back
      // from its block edge like every other building. Shrink the
      // footprint to fit the SETBACK_M margin, centre stays: shrinking
      // keeps the two towers in one block 20+ m apart, where shifting
      // them would crowd them to a 2 m gap. (The river-clearance filter
      // ran on the pre-growth footprint, which was larger, so clearance
      // only improves.)
      const blk = blocks.find((bl) => b.x >= bl.x0 && b.x <= bl.x1 && b.z >= bl.z0 && b.z <= bl.z1);
      if (blk) {
        const fw = b.rot ? b.d : b.w, fd = b.rot ? b.w : b.d; // footprint extents
        const fw2 = Math.min(fw, 2 * Math.min(b.x - blk.x0 - SETBACK_M, blk.x1 - b.x - SETBACK_M));
        const fd2 = Math.min(fd, 2 * Math.min(b.z - blk.z0 - SETBACK_M, blk.z1 - b.z - SETBACK_M));
        if (b.rot) { b.d = fw2; b.w = fd2; } else { b.w = fw2; b.d = fd2; }
      }
      // Growing the footprint can push a corner toward the river (the
      // clearance filter above ran on the pre-growth footprint) — shrink
      // back until every corner clears the river by >16 m. (Corners are
      // sampled with the stored w/d as x/z extents, the same convention
      // the river filter and the connectivity test use.)
      for (let guard = 0; guard < 25; guard++) {
        const pts = [[b.x, b.z],
          [b.x - b.w / 2, b.z - b.d / 2], [b.x + b.w / 2, b.z - b.d / 2],
          [b.x - b.w / 2, b.z + b.d / 2], [b.x + b.w / 2, b.z + b.d / 2]];
        if (pts.every(([x, z]) => riverDistance(x, z) > 16)) break;
        b.w = Math.max(12, b.w - 2);
        b.d = Math.max(12, b.d - 2);
      }
    }
  }

  // --- road graph: nodes at intersections, edges between neighbours ---
  // Mu's rule: the river is crossed by ONLY 4 bridges. A node that sits in
  // the river channel (water) is not an intersection at all, and every
  // other road stops at the riverbank — only the 4 bridge edges cross.
  const N = ROAD_LINES.length;
  let nodes = [];
  const nodeByIJ = new Map();
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = ROAD_LINES[i], z = ROAD_LINES[j];
      if (riverDistance(x, z) < RIVER_HALF_WIDTH) continue; // in the water
      const n = { id: nodes.length, i, j, x, z };
      nodes.push(n);
      nodeByIJ.set(i + ',' + j, n);
    }
  }
  const nodeAt = (i, j) => nodeByIJ.get(i + ',' + j) || null;
  let edges = [];
  const segmentIsBridge = (ax, az, bx, bz) => {
    for (let s = 0; s <= 4; s++) {
      const t = s / 4;
      if (riverDistance(ax + (bx - ax) * t, az + (bz - az) * t) < RIVER_HALF_WIDTH + 3) return true;
    }
    return false;
  };
  // The ONLY four crossings, spread along the river so both banks stay
  // connected (the grid also wraps around the river's two ends):
  // (-300,-300)-(-200,-300), (-200,-200)-(-100,-200) [minor roads],
  // (0,-100)-(0,0), (400,0)-(400,100) [main roads].
  const BRIDGE_KEYS = new Set([
    '-300,-300|-200,-300', '-200,-200|-100,-200', '0,-100|0,0', '400,0|400,100',
  ]);
  const isKeptBridge = (a, b) =>
    BRIDGE_KEYS.has(`${a.x},${a.z}|${b.x},${b.z}`) || BRIDGE_KEYS.has(`${b.x},${b.z}|${a.x},${a.z}`);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N - 1; i++) {
      const a = nodeAt(i, j), b = nodeAt(i + 1, j);
      if (!a || !b) continue;
      const isBridge = segmentIsBridge(a.x, a.z, b.x, b.z);
      if (isBridge && !isKeptBridge(a, b)) continue; // road stops at the bank
      edges.push({ a: a.id, b: b.id, main: IS_MAIN(a.z), bridge: isBridge });
    }
  }
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N - 1; j++) {
      const a = nodeAt(i, j), b = nodeAt(i, j + 1);
      if (!a || !b) continue;
      const isBridge = segmentIsBridge(a.x, a.z, b.x, b.z);
      if (isBridge && !isKeptBridge(a, b)) continue; // road stops at the bank
      edges.push({ a: a.id, b: b.id, main: IS_MAIN(a.x), bridge: isBridge });
    }
  }

  // Prune dead ends (Mu: no dead-end roads). A node whose neighbours are
  // all in the river is a road to nowhere — the two NW corner nodes
  // (-500,-600) and (-600,-500) are cut off by the river head, so they and
  // their stubs are dropped. Pruning repeats until no leaf (degree < 2)
  // is left, then node ids are reassigned so ids stay dense.
  {
    let changed = true;
    while (changed) {
      changed = false;
      const deg = new Map();
      for (const e of edges) {
        deg.set(e.a, (deg.get(e.a) || 0) + 1);
        deg.set(e.b, (deg.get(e.b) || 0) + 1);
      }
      const leaves = new Set(nodes.filter((n) => (deg.get(n.id) || 0) < 2).map((n) => n.id));
      if (leaves.size) {
        edges = edges.filter((e) => !leaves.has(e.a) && !leaves.has(e.b));
        nodes = nodes.filter((n) => !leaves.has(n.id));
        changed = true;
      }
    }
    const remap = new Map(nodes.map((n, k) => [n.id, k]));
    for (const n of nodes) n.id = remap.get(n.id);
    for (const e of edges) { e.a = remap.get(e.a); e.b = remap.get(e.b); }
  }

  // --- street trees: small, on the kerb-side strip of minor roads only,
  // never on asphalt, never in front of downtown shop fronts. ---
  const streetTrees = [];
  const nearIntersection = (x, z) => {
    // Near ANY crossing of a vertical and a horizontal road line.
    for (const Lx of ROAD_LINES) {
      if (Math.abs(x - Lx) >= 14) continue;
      for (const Lz of ROAD_LINES) {
        if (Math.abs(z - Lz) < 14) return true;
      }
    }
    return false;
  };
  for (const L of ROAD_LINES) {
    if (IS_MAIN(L)) continue;
    for (let s = -580; s <= 580; s += 26) {
      for (const side of [-1, 1]) {
        const off = ASPHALT_HALF(L) + 1.5;
        const tx = L + side * off, tz = s + range(rand, -4, 4);
        if (Math.abs(tx) < 280 && Math.abs(tz) < 280) continue; // downtown: no street trees
        if (nearIntersection(tx, tz)) continue;
        if (riverDistance(tx, tz) < 20) continue;
        streetTrees.push({ x: tx, z: tz, s: range(rand, 0.8, 1.15) });
      }
      for (const side of [-1, 1]) {
        const off = ASPHALT_HALF(L) + 1.5;
        const tx = s + range(rand, -4, 4), tz = L + side * off;
        if (Math.abs(tx) < 280 && Math.abs(tz) < 280) continue;
        if (nearIntersection(tx, tz)) continue;
        if (riverDistance(tx, tz) < 20) continue;
        streetTrees.push({ x: tx, z: tz, s: range(rand, 0.8, 1.15) });
      }
    }
  }

  // --- forest trees: dense on the volcano slopes + forest edge ---
  const forestTrees = [];
  let tries = 0;
  while (forestTrees.length < 2400 && tries++ < 30000) {
    const x = range(rand, -880, -580);
    const z = range(rand, -880, -580);
    if (terrainHeight(x, z) < 1.0) continue;
    if (riverDistance(x, z) < 22) continue;
    forestTrees.push({ x, z, s: range(rand, 1.2, 2.4) });
  }
  // A few more inside forest-edge blocks.
  for (const b of blocks) {
    if (b.zone !== 'forest') continue;
    for (let k = 0; k < 14; k++) {
      forestTrees.push({
        x: range(rand, b.x0, b.x1), z: range(rand, b.z0, b.z1),
        s: range(rand, 1.0, 1.8),
      });
    }
  }

  // --- lamp posts: main roads, kerb edge, alternating sides ---
  const lamps = [];
  for (const L of ROAD_LINES) {
    if (!IS_MAIN(L)) continue;
    let side = 1;
    for (let s = -580; s <= 580; s += 48) {
      const off = ASPHALT_HALF(L) + 0.9;
      const lx = L + side * off, lz = s;
      if (nearIntersection(lx, lz)) continue;
      if (riverDistance(lx, lz) < 16) continue;
      lamps.push({ x: lx, z: lz, along: 'x' });
      const lx2 = s, lz2 = L + side * off;
      if (!nearIntersection(lx2, lz2) && riverDistance(lx2, lz2) >= 16) {
        lamps.push({ x: lx2, z: lz2, along: 'z' });
      }
      side *= -1;
    }
  }

  // --- traffic lights: two opposite corners at EVERY intersection ---
  // (was main x main only). On main x main corners the offset stays
  // 1.2 m past the corridor edge (the old positions, clear of the bus
  // stops at corridor-0.5); elsewhere the pole stands on the sidewalk's
  // outer edge. A corner in the river falls back to the other diagonal,
  // then to any single dry corner.
  const trafficLights = [];
  for (const n of nodes) {
    const main = IS_MAIN(n.x) && IS_MAIN(n.z);
    const o = Math.max(CORRIDOR_HALF(n.x), CORRIDOR_HALF(n.z)) + (main ? 1.2 : -0.5);
    let placed = false;
    for (const pair of [[[1, 1], [-1, -1]], [[1, -1], [-1, 1]]]) {
      const pts = pair.map(([sx, sz]) => ({ x: n.x + sx * o, z: n.z + sz * o }));
      if (pts.every((p) => riverDistance(p.x, p.z) >= 12)) {
        trafficLights.push(...pts);
        placed = true;
        break;
      }
    }
    if (!placed) {
      for (const [sx, sz] of [[1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const x = n.x + sx * o, z = n.z + sz * o;
        if (riverDistance(x, z) >= 12) { trafficLights.push({ x, z }); break; }
      }
    }
  }

  // --- beach props: umbrellas, loungers, swim rings, beach balls. ---
  // On the sand near the shoreline (x 612-645, damp sand above the water),
  // in small clusters, never on a road or in the river mouth. Appended at
  // the END of generateCity so the rand stream above (and the whole city)
  // is unchanged. Colours are VIVID (Mu: props must be visible on the sand),
  // and the umbrellas are big.
  const beachProps = [];
  const PROP_TINTS = [
    [0.95, 0.25, 0.3], [0.98, 0.75, 0.15], [0.15, 0.75, 0.9],
    [0.95, 0.45, 0.75], [0.35, 0.85, 0.35], [0.98, 0.55, 0.15],
    [0.65, 0.4, 0.95],
  ];
  let clusterTries = 0;
  while (beachProps.filter((p) => p.kind === 'umbrella').length < 36 && clusterTries++ < 800) {
    const cx = range(rand, 614, 644);
    const cz = range(rand, -480, 280);
    if (riverDistance(cx, cz) < 30) continue;
    // Keep-out around the M1/M6 finish at Coral Beach (620,-100): an
    // umbrella there fills the chase camera's frame at the finish line.
    if (Math.hypot(cx - 620, cz + 100) < 24) continue;
    const rot = range(rand, 0, Math.PI * 2);
    beachProps.push({ kind: 'umbrella', x: cx, z: cz, rot, s: range(rand, 1.25, 1.6), color: PROP_TINTS[Math.floor(rand() * PROP_TINTS.length)] });
    const nLounge = rangeInt(rand, 1, 2);
    for (let k = 0; k < nLounge; k++) {
      beachProps.push({ kind: 'lounger', x: cx + range(rand, -2.6, 2.6), z: cz + range(rand, -2.2, 2.2), rot: rot + range(rand, -0.4, 0.4), s: range(rand, 1.2, 1.5), color: PROP_TINTS[Math.floor(rand() * PROP_TINTS.length)] });
    }
    if (rand() < 0.55) {
      beachProps.push({ kind: 'ring', x: cx + range(rand, -3.5, 3.5), z: cz + range(rand, -3, 3), rot: range(rand, 0, Math.PI * 2), s: range(rand, 1.2, 1.5), color: PROP_TINTS[Math.floor(rand() * PROP_TINTS.length)] });
    }
    if (rand() < 0.4) {
      beachProps.push({ kind: 'ball', x: cx + range(rand, -4, 4), z: cz + range(rand, -3.5, 3.5), rot: 0, s: range(rand, 1.2, 1.5), color: PROP_TINTS[Math.floor(rand() * PROP_TINTS.length)] });
    }
  }
  // Dense beach cluster by the pier (Mu: props must be VISIBLE) — a row of
  // big vivid umbrellas + loungers right where the pier meets the sand.
  // Separate rand stream, so nothing above moves. The cluster stays north
  // of z=-125: the M1/M6 finish at (620,-100) needs a clear camera line.
  {
    const prand = mulberry32(20261129);
    for (let k = 0; k < 12; k++) {
      const cx = range(prand, 618, 642);
      const cz = range(prand, -215, -125);
      const rot = range(prand, 0, Math.PI * 2);
      beachProps.push({ kind: 'umbrella', x: cx, z: cz, rot, s: range(prand, 1.3, 1.7), color: PROP_TINTS[Math.floor(prand() * PROP_TINTS.length)] });
      beachProps.push({ kind: 'lounger', x: cx + range(prand, -2.5, 2.5), z: cz + range(prand, -2, 2), rot: rot + range(prand, -0.4, 0.4), s: range(prand, 1.2, 1.5), color: PROP_TINTS[Math.floor(prand() * PROP_TINTS.length)] });
      if (prand() < 0.7) beachProps.push({ kind: 'ring', x: cx + range(prand, -3, 3), z: cz + range(prand, -2.5, 2.5), rot: range(prand, 0, Math.PI * 2), s: range(prand, 1.2, 1.5), color: PROP_TINTS[Math.floor(prand() * PROP_TINTS.length)] });
      if (prand() < 0.6) beachProps.push({ kind: 'ball', x: cx + range(prand, -3.5, 3.5), z: cz + range(prand, -3, 3), rot: 0, s: range(prand, 1.2, 1.5), color: PROP_TINTS[Math.floor(prand() * PROP_TINTS.length)] });
    }
  }

  // --- palm trees: decoration along MAIN roads, in the kerb-side strip ---
  // (sidewalk, offset 7.5 m from the centre line — never on asphalt),
  // alternating sides, clear of intersections and the river. Appended at
  // the end so the rand stream above (and the whole city) is unchanged.
  const palmTrees = [];
  for (const L of ROAD_LINES) {
    if (!IS_MAIN(L)) continue;
    let side = 1;
    for (let s = -580; s <= 580; s += 52) {
      const off = ASPHALT_HALF(L) + 1.5;
      const px = L + side * off, pz = s + range(rand, -3, 3);
      if (!nearIntersection(px, pz) && riverDistance(px, pz) >= 20) {
        palmTrees.push({ x: px, z: pz, s: range(rand, 0.9, 1.25), rot: range(rand, 0, Math.PI * 2) });
      }
      const px2 = s + range(rand, -3, 3), pz2 = L + side * off;
      if (!nearIntersection(px2, pz2) && riverDistance(px2, pz2) >= 20) {
        palmTrees.push({ x: px2, z: pz2, s: range(rand, 0.9, 1.25), rot: range(rand, 0, Math.PI * 2) });
      }
      side *= -1;
    }
  }

  // --- city landmarks: 3 recognisable buildings (hospital, police ---
  // --- station, school), flagged on the nearest building of the right ---
  // --- zone, with a calm identifying colour. Signs live in landmarks.js. ---
  {
    const nearest = (zone, tx, tz) => {
      let best = null, bestD = Infinity;
      for (const b of buildings) {
        if (b.zone !== zone) continue;
        const d = Math.hypot(b.x - tx, b.z - tz);
        if (d < bestD) { bestD = d; best = b; }
      }
      return best;
    };
    const hospital = nearest('downtown', 0, -100);
    if (hospital) { hospital.landmark = 'hospital'; hospital.color = [0.95, 0.95, 0.95]; }
    const police = nearest('commercial', 100, 100);
    if (police) { police.landmark = 'police'; police.color = [0.35, 0.55, 0.95]; }
    const school = nearest('residential', -200, 200);
    if (school) { school.landmark = 'school'; school.color = [0.98, 0.82, 0.35]; }
  }

  const zoneCounts = {};
  for (const b of buildings) zoneCounts[b.zone] = (zoneCounts[b.zone] || 0) + 1;

  return {
    seed,
    buildings,
    blocks,
    nodes,
    edges,
    streetTrees,
    forestTrees,
    lamps,
    trafficLights,
    beachProps,
    palmTrees,
    stats: {
      buildings: buildings.length,
      nodes: nodes.length,
      edges: edges.length,
      bridges: edges.filter((e) => e.bridge).length,
      streetTrees: streetTrees.length,
      forestTrees: forestTrees.length,
      lamps: lamps.length,
      trafficLights: trafficLights.length,
      beachProps: beachProps.length,
      palmTrees: palmTrees.length,
      zones: zoneCounts,
    },
  };
}

// BFS over the road graph; returns the set of reachable node ids.
export function reachableNodes(city, startId) {
  const adj = new Map();
  for (const e of city.edges) {
    if (!adj.has(e.a)) adj.set(e.a, []);
    if (!adj.has(e.b)) adj.set(e.b, []);
    adj.get(e.a).push(e.b);
    adj.get(e.b).push(e.a);
  }
  const seen = new Set([startId]);
  const queue = [startId];
  while (queue.length) {
    const n = queue.pop();
    for (const m of adj.get(n) || []) {
      if (!seen.has(m)) { seen.add(m); queue.push(m); }
    }
  }
  return seen;
}

export function isConnected(city) {
  const start = city.nodes[Math.floor(city.nodes.length / 2)].id;
  return reachableNodes(city, start).size === city.nodes.length;
}

// Axis-aligned building footprints, for player collision.
export function buildingAABBs(city) {
  return city.buildings.map((b) => ({
    x0: b.x - b.w / 2, x1: b.x + b.w / 2,
    z0: b.z - b.d / 2, z1: b.z + b.d / 2,
  }));
}
