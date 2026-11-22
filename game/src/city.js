// Teluk Rimba — city dataset (PURE: no WebGL, no DOM, no three.js).
// One shared dataset drives buildings, roads, markings, traffic, minimap and
// tests, so everything always matches. Deterministic: same seed -> same city.
// Importable from Node for the connectivity test and from the browser game.

import { mulberry32, range, rangeInt, clamp, smoothstep } from './rng.js';

export const SEED = 20261122;
export const TARGET_BUILDINGS = 1000;

// Road grid: 13 lines per axis, 100 m apart. Mains every other line.
export const ROAD_LINES = [-600, -500, -400, -300, -200, -100, 0, 100, 200, 300, 400, 500, 600];
export const MAIN_LINES = new Set([-400, -200, 0, 200, 400]);
export const CORRIDOR_HALF = (line) => (MAIN_LINES.has(line) ? 9 : 6); // road + sidewalks
export const ASPHALT_HALF = (line) => (MAIN_LINES.has(line) ? 6 : 3.5);
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
  // River channel.
  const rd = riverDistance(x, z);
  if (rd < 20 && x < 660) {
    h -= 3.0 * Math.pow(1 - rd / 20, 2);
  }
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

const ZONE_COUNT = {
  downtown: [1, 2],
  commercial: [6, 10],
  residential: [12, 18],
  beach: [3, 5],
  port: [2, 3],
  forest: [1, 2],
};

const ZONE_SIZE = {
  downtown: { w: [20, 32], d: [20, 32], h: [30, 68] },
  commercial: { w: [12, 20], d: [12, 20], h: [10, 26] },
  residential: { w: [8, 13], d: [8, 13], h: [4, 8] },
  beach: { w: [16, 26], d: [14, 22], h: [20, 42] },
  port: { w: [24, 38], d: [18, 30], h: [8, 12] },
  forest: { w: [8, 12], d: [8, 12], h: [4, 6] },
};

const ZONE_COLORS = {
  downtown: [[0.62, 0.72, 0.82], [0.55, 0.65, 0.78], [0.7, 0.75, 0.8], [0.5, 0.6, 0.72]],
  commercial: [[0.85, 0.78, 0.66], [0.8, 0.8, 0.78], [0.75, 0.68, 0.58], [0.88, 0.82, 0.72]],
  residential: [[0.92, 0.85, 0.72], [0.9, 0.75, 0.65], [0.7, 0.82, 0.85], [0.75, 0.88, 0.72], [0.88, 0.88, 0.8], [0.85, 0.7, 0.72]],
  beach: [[0.95, 0.93, 0.86], [0.88, 0.9, 0.88], [0.72, 0.85, 0.88], [0.93, 0.88, 0.78]],
  port: [[0.6, 0.58, 0.55], [0.65, 0.5, 0.42], [0.55, 0.6, 0.62], [0.7, 0.62, 0.5]],
  forest: [[0.55, 0.45, 0.32], [0.5, 0.52, 0.38], [0.62, 0.5, 0.38]],
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
      const h = range(rand, size.h[0], size.h[1]);
      const col = colors[Math.floor(rand() * colors.length)];
      out.push({
        x: cx, z: cz, w, d, h,
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
  const residentialBlocks = blocks.filter((b) => b.zone === 'residential');
  let topTries = 0;
  while (buildings.length < TARGET_BUILDINGS && topTries++ < 20000) {
    const blk = residentialBlocks[Math.floor(rand() * residentialBlocks.length)];
    const size = ZONE_SIZE.residential;
    const w = range(rand, size.w[0], size.w[1]);
    const d = range(rand, size.d[0], size.d[1]);
    const x = range(rand, blk.x0 + w / 2 + 3, blk.x1 - w / 2 - 3);
    const z = range(rand, blk.z0 + d / 2 + 3, blk.z1 - d / 2 - 3);
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

  // --- road graph: nodes at intersections, edges between neighbours ---
  const N = ROAD_LINES.length;
  const nodes = [];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      nodes.push({ id: j * N + i, i, j, x: ROAD_LINES[i], z: ROAD_LINES[j] });
    }
  }
  const nodeAt = (i, j) => nodes[j * N + i];
  const edges = [];
  const segmentIsBridge = (ax, az, bx, bz) => {
    for (let s = 0; s <= 4; s++) {
      const t = s / 4;
      if (riverDistance(ax + (bx - ax) * t, az + (bz - az) * t) < RIVER_HALF_WIDTH + 3) return true;
    }
    return false;
  };
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N - 1; i++) {
      const a = nodeAt(i, j), b = nodeAt(i + 1, j);
      edges.push({ a: a.id, b: b.id, main: IS_MAIN(a.z), bridge: segmentIsBridge(a.x, a.z, b.x, b.z) });
    }
  }
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N - 1; j++) {
      const a = nodeAt(i, j), b = nodeAt(i, j + 1);
      edges.push({ a: a.id, b: b.id, main: IS_MAIN(a.x), bridge: segmentIsBridge(a.x, a.z, b.x, b.z) });
    }
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

  // --- traffic lights: main x main intersections, two opposite corners ---
  const trafficLights = [];
  for (const Lx of MAIN_LINES) {
    for (const Lz of MAIN_LINES) {
      const o = CORRIDOR_HALF(Lx) + 1.2;
      trafficLights.push({ x: Lx + o, z: Lz + o });
      trafficLights.push({ x: Lx - o, z: Lz - o });
    }
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
    stats: {
      buildings: buildings.length,
      nodes: nodes.length,
      edges: edges.length,
      bridges: edges.filter((e) => e.bridge).length,
      streetTrees: streetTrees.length,
      forestTrees: forestTrees.length,
      lamps: lamps.length,
      trafficLights: trafficLights.length,
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
