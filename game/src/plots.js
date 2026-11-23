// Teluk Rimba — plot dressing. In dense zones (downtown, commercial) and
// residential blocks, empty yard space is NOT plain green: the plot is paved
// light grey, with parked cars, fences, flower beds, benches and planters.
// All code-made, all derived from the shared city dataset, deterministic.
// Pure geometry (no WebGL, no DOM) — the renderer draws it as static meshes.
import { mulberry32, range, rangeInt } from './rng.js';
import { riverDistance } from './city.js';
import { emptyGeom, plainBox } from './gl.js';
import { distinctColor, parkedCarGeom } from './vehicles.js';

const PAVE = [0.58, 0.58, 0.56]; // light grey paving — dark enough to read
// as paving in bright daylight, never a glaring white strip at the bases.
const PAVE_VAR = 0.05; // per-slab shade variation, so slabs read as tiles
const FENCE_COL = [0.85, 0.82, 0.72];
const BENCH_COL = [0.55, 0.42, 0.28];
const BIN_COL = [0.15, 0.3, 0.2]; // dark green trash bin
const POT_COL = [0.7, 0.4, 0.28]; // terracotta plant pot
const SHRUB_COL = [0.25, 0.5, 0.25]; // potted shrub
const FLOWERS = [
  [0.95, 0.45, 0.55], [0.95, 0.8, 0.25], [0.9, 0.35, 0.3],
  [0.95, 0.95, 0.9], [0.65, 0.45, 0.9], [0.95, 0.6, 0.3],
];

function quadUp(g, x0, z0, x1, z1, y, col) {
  // Up-facing winding (a,c,b / a,d,c) — the renderer culls back faces.
  const n = [0, 1, 0];
  const P = (x, z) => [x, y, z];
  g.pos.push(
    ...P(x0, z0), ...P(x1, z1), ...P(x1, z0),
    ...P(x0, z0), ...P(x0, z1), ...P(x1, z1),
  );
  for (let k = 0; k < 6; k++) g.nrm.push(...n);
  for (let k = 0; k < 6; k++) g.col.push(...col);
}

function footprint(b) {
  const w = b.rot ? b.d : b.w, d = b.rot ? b.w : b.d;
  return { x0: b.x - w / 2, x1: b.x + w / 2, z0: b.z - d / 2, z1: b.z + d / 2 };
}

function clearOfBuildings(buildings, x, z, hw, hd, margin) {
  for (const b of buildings) {
    const f = footprint(b);
    if (x + hw + margin > f.x0 && x - hw - margin < f.x1 &&
        z + hd + margin > f.z0 && z - hd - margin < f.z1) return false;
  }
  return true;
}

function addPart(g, part, x, y, z, rot) {
  const c = Math.cos(rot), s = Math.sin(rot);
  for (let i = 0; i < part.pos.length; i += 3) {
    const px = part.pos[i], py = part.pos[i + 1], pz = part.pos[i + 2];
    part.pos[i] = x + px * c + pz * s;
    part.pos[i + 1] = py + y;
    part.pos[i + 2] = z - px * s + pz * c;
  }
  // Rotate the normals the same way (yaw only).
  for (let i = 0; i < part.nrm.length; i += 3) {
    const nx = part.nrm[i], nz = part.nrm[i + 2];
    part.nrm[i] = nx * c + nz * s;
    part.nrm[i + 2] = -nx * s + nz * c;
  }
  g.pos.push(...part.pos); g.nrm.push(...part.nrm); g.col.push(...part.col);
}

// Tilt a part around the Z axis (local space): rotates positions and
// normals. Used for the yard trees' leaning branches.
function tiltZ(part, a) {
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
}

const YARD_TRUNK = [0.4, 0.28, 0.16];
const YARD_LEAF = [0.2, 0.48, 0.2];
const YARD_LEAF_LT = [0.27, 0.56, 0.25];
const YARD_STONE = [0.6, 0.6, 0.58];

// Small broadleaf yard tree (same shape as the street trees, smaller):
// trunk + two leaning branches + three overlapping crown blobs.
function yardTreeGeom() {
  const g = emptyGeom();
  const at = (part, x, y, z) => {
    for (let i = 0; i < part.pos.length; i += 3) { part.pos[i] += x; part.pos[i + 1] += y; part.pos[i + 2] += z; }
    g.pos.push(...part.pos); g.nrm.push(...part.nrm); g.col.push(...part.col);
  };
  const shift = (part, x, y, z) => {
    for (let i = 0; i < part.pos.length; i += 3) { part.pos[i] += x; part.pos[i + 1] += y; part.pos[i + 2] += z; }
    return part;
  };
  at(shift(plainBox(0.36, 2.0, 0.36, YARD_TRUNK), 0, 1.0, 0), 0, 0, 0);
  at(shift(tiltZ(shift(plainBox(0.13, 1.1, 0.13, YARD_TRUNK), 0, 0.55, 0), 0.5), 0, 1.9, 0), 0, 0, 0);
  at(shift(tiltZ(shift(plainBox(0.13, 1.1, 0.13, YARD_TRUNK), 0, 0.55, 0), -0.5), 0, 1.9, 0), 0, 0, 0);
  at(shift(plainBox(2.2, 1.2, 2.2, YARD_LEAF), 0, 2.85, 0), 0, 0, 0);
  at(shift(plainBox(1.3, 0.9, 1.3, YARD_LEAF_LT), 0.55, 2.45, 0.55), 0, 0, 0);
  at(shift(plainBox(1.3, 0.9, 1.3, YARD_LEAF_LT), -0.55, 2.45, -0.55), 0, 0, 0);
  return g;
}

// Small yard fountain: square stone basin + centre spout column. The
// water surface itself is NOT in this static mesh — it rides the existing
// 'flow' dynamic mesh (see main.js), so the water shimmers with no new
// draw call and no new system.
function yardFountainGeom() {
  const g = emptyGeom();
  const at = (part, x, y, z) => {
    for (let i = 0; i < part.pos.length; i += 3) { part.pos[i] += x; part.pos[i + 1] += y; part.pos[i + 2] += z; }
    g.pos.push(...part.pos); g.nrm.push(...part.nrm); g.col.push(...part.col);
  };
  at(plainBox(2.2, 0.1, 2.2, YARD_STONE), 0, 0.05, 0); // basin floor
  at(plainBox(2.4, 0.45, 0.15, YARD_STONE), 0, 0.28, 1.12); // rim walls
  at(plainBox(2.4, 0.45, 0.15, YARD_STONE), 0, 0.28, -1.12);
  at(plainBox(0.15, 0.45, 2.1, YARD_STONE), 1.12, 0.28, 0);
  at(plainBox(0.15, 0.45, 2.1, YARD_STONE), -1.12, 0.28, 0);
  at(plainBox(0.3, 0.9, 0.3, YARD_STONE), 0, 0.5, 0); // spout column
  at(plainBox(0.55, 0.14, 0.55, YARD_STONE), 0, 1.0, 0); // spout cap
  return g;
}

// Yard bench: seat + back, same shape as the block-pass benches.
function yardBenchGeom() {
  const g = emptyGeom();
  const at = (part, x, y, z) => {
    for (let i = 0; i < part.pos.length; i += 3) { part.pos[i] += x; part.pos[i + 1] += y; part.pos[i + 2] += z; }
    g.pos.push(...part.pos); g.nrm.push(...part.nrm); g.col.push(...part.col);
  };
  at(plainBox(2.4, 0.12, 0.7, BENCH_COL), 0, 0.5, 0);
  at(plainBox(2.4, 0.6, 0.1, BENCH_COL), 0, 0.85, -0.32);
  return g;
}

// Parked-car template: the sculpted body is identical for every parked
// car — only the paint differs. Rebuilding carGeom per car costs ~7 ms;
// 434 cars was ~3 s of load time. Build once, stamp tinted copies (same
// tint rule parkedCarGeom uses: white body parts take the paint colour).
let parkedTemplate = null;
function parkedCarStamp(color) {
  if (!parkedTemplate) parkedTemplate = parkedCarGeom([1, 1, 1]);
  const g = { pos: [...parkedTemplate.pos], nrm: [...parkedTemplate.nrm], col: [] };
  for (let i = 0; i < parkedTemplate.col.length; i += 3) {
    const r = parkedTemplate.col[i], gg = parkedTemplate.col[i + 1], b = parkedTemplate.col[i + 2];
    if (r === 1 && gg === 1 && b === 1) g.col.push(color[0], color[1], color[2]);
    else g.col.push(r, gg, b);
  }
  return g;
}

export function buildPlotDressing(city) {
  const rand = mulberry32(20261128);
  const paving = emptyGeom();
  const props = emptyGeom();
  const dressed = [];
  let cars = 0, fences = 0, flowers = 0, benches = 0, bins = 0, pots = 0;
  // Decorative parked cars get distinct colours too (same allocator as
  // the traffic fleet, continuing its sequence).
  let colorIdx = 1000;

  const blocks = city.blocks.filter((b) =>
    (b.zone === 'downtown' || b.zone === 'commercial' || b.zone === 'residential'));
  for (const b of blocks) {
    // Riverside blocks stay natural — the river cuts through them.
    const corners = [[b.x0, b.z0], [b.x1, b.z0], [b.x0, b.z1], [b.x1, b.z1], [b.cx, b.cz]];
    if (corners.some(([x, z]) => riverDistance(x, z) < 25)) continue;
    dressed.push(b);

    // Paving: 2x2 light-grey slabs with a slight shade variation.
    const mx = (b.x0 + b.x1) / 2, mz = (b.z0 + b.z1) / 2;
    for (const [x0, z0, x1, z1] of [[b.x0, b.z0, mx, mz], [mx, b.z0, b.x1, mz], [b.x0, mz, mx, b.z1], [mx, mz, b.x1, b.z1]]) {
      const v = range(rand, -PAVE_VAR, PAVE_VAR);
      quadUp(paving, x0, z0, x1, z1, 0.06, [PAVE[0] + v, PAVE[1] + v, PAVE[2] + v]);
    }

    const inBlock = (x, z, m = 3) => x > b.x0 + m && x < b.x1 - m && z > b.z0 + m && z < b.z1 - m;
    const spot = (hw, hd, tries = 12) => {
      for (let k = 0; k < tries; k++) {
        const x = range(rand, b.x0 + 4, b.x1 - 4);
        const z = range(rand, b.z0 + 4, b.z1 - 4);
        if (!inBlock(x, z)) continue;
        if (riverDistance(x, z) < 25) continue;
        if (!clearOfBuildings(city.buildings, x, z, hw, hd, 2)) continue;
        return { x, z };
      }
      return null;
    };

    // Parked cars: 1-2 downtown, 2-3 commercial, 2 residential.
    const nCars = b.zone === 'commercial' ? rangeInt(rand, 2, 3) : 2;
    for (let k = 0; k < nCars; k++) {
      const s = spot(2.2, 1.2);
      if (!s) continue;
      addPart(props, parkedCarStamp(distinctColor(colorIdx++)), s.x, 0.06, s.z, range(rand, 0, Math.PI * 2));
      cars++;
    }
    // Fences: low runs along two inner edges of the block.
    for (const [fx, fz, len, rot] of [
      [b.cx, b.z0 + 2, (b.x1 - b.x0) * 0.45, 0],
      [b.x0 + 2, b.cz, (b.z1 - b.z0) * 0.45, Math.PI / 2],
    ]) {
      if (riverDistance(fx, fz) < 25) continue;
      if (!clearOfBuildings(city.buildings, fx, fz, rot === 0 ? len / 2 : 0.5, rot === 0 ? 0.5 : len / 2, 1)) continue;
      const fence = plainBox(len, 0.9, 0.12, FENCE_COL);
      for (let i = 0; i < fence.pos.length; i += 3) fence.pos[i + 1] += 0.51;
      addPart(props, fence, fx, 0.06, fz, rot);
      fences++;
    }
    // Flower beds: 2-3 clusters of tiny bright blooms.
    for (let k = 0; k < rangeInt(rand, 2, 3); k++) {
      const s = spot(1.2, 1.2);
      if (!s) continue;
      for (let f = 0; f < 4; f++) {
        const bloom = plainBox(0.35, 0.3, 0.35, FLOWERS[Math.floor(rand() * FLOWERS.length)]);
        for (let i = 0; i < bloom.pos.length; i += 3) bloom.pos[i + 1] += 0.2;
        addPart(props, bloom, s.x + range(rand, -0.8, 0.8), 0.06, s.z + range(rand, -0.8, 0.8), 0);
      }
      flowers++;
    }
    // Benches in commercial / residential blocks.
    if (b.zone !== 'downtown' && rand() < 0.7) {
      const s = spot(1.4, 0.5);
      if (s) {
        const brot = range(rand, 0, Math.PI * 2);
        const seat = plainBox(2.4, 0.12, 0.7, BENCH_COL);
        for (let i = 0; i < seat.pos.length; i += 3) seat.pos[i + 1] += 0.5;
        const back = plainBox(2.4, 0.6, 0.1, BENCH_COL);
        for (let i = 0; i < back.pos.length; i += 3) { back.pos[i + 1] += 0.85; back.pos[i + 2] -= 0.32; }
        addPart(props, seat, s.x, 0.06, s.z, brot);
        addPart(props, back, s.x, 0.06, s.z, brot);
        benches++;
      }
    }
    // Trash bins: 1-2 dark green bins with lids, inside the block (never
    // on a road or sidewalk, never blocking movement).
    for (let k = 0; k < rangeInt(rand, 1, 2); k++) {
      const s = spot(0.6, 0.6);
      if (!s) continue;
      const brot = range(rand, 0, Math.PI * 2);
      const bin = plainBox(0.55, 0.9, 0.55, BIN_COL);
      for (let i = 0; i < bin.pos.length; i += 3) bin.pos[i + 1] += 0.51;
      const lid = plainBox(0.6, 0.08, 0.6, [0.12, 0.14, 0.12]);
      for (let i = 0; i < lid.pos.length; i += 3) lid.pos[i + 1] += 0.99;
      addPart(props, bin, s.x, 0.06, s.z, brot);
      addPart(props, lid, s.x, 0.06, s.z, brot);
      bins++;
    }
    // Plant pots: a terracotta pot + a small green shrub, along the walk.
    for (let k = 0; k < rangeInt(rand, 2, 3); k++) {
      const s = spot(0.7, 0.7);
      if (!s) continue;
      const pot = plainBox(0.6, 0.5, 0.6, POT_COL);
      for (let i = 0; i < pot.pos.length; i += 3) pot.pos[i + 1] += 0.31;
      const shrub = plainBox(0.7, 0.55, 0.7, SHRUB_COL);
      for (let i = 0; i < shrub.pos.length; i += 3) shrub.pos[i + 1] += 0.8;
      addPart(props, pot, s.x, 0.06, s.z, 0);
      addPart(props, shrub, s.x, 0.06, s.z, 0);
      pots++;
    }
  }

  // --- Yard dressing (Mu): EVERY building's yard gets random decoration —
  // small trees, benches, parked cars, flower clusters and (rarely) a small
  // fountain, mixed randomly per building, never in neat rows. Separate
  // rand stream, so the block dressing above is untouched. Nothing blocks
  // doors, roads, sidewalks or zebras: items stay inside the building's
  // own block (>= 3 m from the block edge), clear of the door strip in
  // front of every entrance/shopfront in the block, clear of the river,
  // clear of other buildings and of each other. All merged into the same
  // props mesh — zero new draw calls.
  const yardRand = mulberry32(20261131);
  const fountainSpots = [];
  let yardTrees = 0, yardBenches = 0, yardCars = 0, yardFlowers = 0, yardFountains = 0, yardDressed = 0;
  // Buildings per block, for fast local clearance checks.
  const blockOf = new Map();
  const buildingsByBlock = new Map();
  for (const b of city.buildings) {
    const blk = city.blocks.find((bl) => b.x >= bl.x0 && b.x <= bl.x1 && b.z >= bl.z0 && b.z <= bl.z1);
    if (!blk) continue;
    blockOf.set(b, blk);
    if (!buildingsByBlock.has(blk)) buildingsByBlock.set(blk, []);
    buildingsByBlock.get(blk).push(b);
  }
  const placedByBlock = new Map();
  // Door strip in front of a building's entrance/shopfront: the door sits
  // at the front-face centre (local +z after rotY, same frame as the
  // entrance kits), canopy reaching ~1 m out. An item is clear when it is
  // outside along in [-0.5-m, 3.0+m] and |across| < 2.2+m.
  const doorClear = (b, x, z, m) => {
    const nx = Math.sin(b.rot), nz = Math.cos(b.rot);
    const dx = x - (b.x + nx * b.d / 2), dz = z - (b.z + nz * b.d / 2);
    const along = dx * nx + dz * nz;
    const across = dx * Math.cos(b.rot) - dz * Math.sin(b.rot);
    return !(along > -0.5 - m && along < 3.0 + m && Math.abs(across) < 2.2 + m);
  };
  for (const b of city.buildings) {
    const blk = blockOf.get(b);
    if (!blk) continue;
    const fw = b.rot ? b.d : b.w, fd = b.rot ? b.w : b.d; // visual extents
    const sibs = buildingsByBlock.get(blk) || [];
    const placed = placedByBlock.get(blk) || [];
    placedByBlock.set(blk, placed);
    const fits = (x, z, hw, hd, m) => {
      if (x - hw < blk.x0 + 3 || x + hw > blk.x1 - 3 || z - hd < blk.z0 + 3 || z + hd > blk.z1 - 3) return false;
      if (riverDistance(x, z) < 20) return false;
      for (const s of sibs) if (!doorClear(s, x, z, Math.max(hw, hd))) return false;
      for (const s of sibs) {
        const f = footprint(s);
        if (x + hw + 1.5 > f.x0 && x - hw - 1.5 < f.x1 && z + hd + 1.5 > f.z0 && z - hd - 1.5 < f.z1) return false;
      }
      for (const p of placed) {
        if (Math.abs(p.x - x) < p.hw + hw + 0.5 && Math.abs(p.z - z) < p.hd + hd + 0.5) return false;
      }
      return true;
    };
    const tryPlace = (hw, hd, m, tries = 14) => {
      for (let k = 0; k < tries; k++) {
        // Sample in the ring around THIS building (within 8 m of its
        // footprint) so the item reads as this building's yard, not as
        // block clutter — and never in a neat row.
        const x = b.x + range(yardRand, -(fw / 2 + 8), fw / 2 + 8);
        const z = b.z + range(yardRand, -(fd / 2 + 8), fd / 2 + 8);
        if (fits(x, z, hw, hd, m)) { placed.push({ x, z, hw, hd }); return { x, z }; }
      }
      return null;
    };
    const nItems = yardRand() < 0.4 ? 2 : 1;
    let got = 0;
    for (let k = 0; k < nItems; k++) {
      const roll = yardRand();
      let kind;
      if (roll < 0.32) kind = 'tree';
      else if (roll < 0.52) kind = 'flowers';
      else if (roll < 0.68) kind = 'bench';
      else if (roll < 0.84) kind = 'car';
      else if (roll < 0.92) kind = 'fountain';
      else kind = 'tree';
      if (kind === 'fountain') {
        // Fountains are rare and need a bigger yard: only in the larger
        // zones, capped city-wide so the animated-water instances stay
        // far under the flow mesh capacity.
        const bigZone = b.zone === 'downtown' || b.zone === 'commercial' || b.zone === 'beach' || b.zone === 'port';
        if (!bigZone || yardFountains >= 24) kind = 'tree';
      }
      if (kind === 'tree') {
        const s = tryPlace(1.5, 1.5, 1.5);
        if (!s) continue;
        // Scale the tree (addPart has no scale): fresh geom per tree,
        // uniform scale keeps the normals valid as directions.
        const sc = range(yardRand, 0.8, 1.3);
        const tree = yardTreeGeom();
        for (let i = 0; i < tree.pos.length; i++) tree.pos[i] *= sc;
        addPart(props, tree, s.x, 0.06, s.z, range(yardRand, 0, Math.PI * 2));
        yardTrees++;
        got++;
      } else if (kind === 'flowers') {
        const s = tryPlace(1.0, 1.0, 1.0);
        if (!s) continue;
        for (let f = 0; f < 4; f++) {
          const bloom = plainBox(0.35, 0.3, 0.35, FLOWERS[Math.floor(yardRand() * FLOWERS.length)]);
          for (let i = 0; i < bloom.pos.length; i += 3) bloom.pos[i + 1] += 0.2;
          addPart(props, bloom, s.x + range(yardRand, -0.8, 0.8), 0.06, s.z + range(yardRand, -0.8, 0.8), 0);
        }
        yardFlowers++;
        got++;
      } else if (kind === 'bench') {
        const s = tryPlace(1.4, 1.4, 1.4);
        if (!s) continue;
        addPart(props, yardBenchGeom(), s.x, 0.06, s.z, range(yardRand, 0, Math.PI * 2));
        yardBenches++;
        got++;
      } else if (kind === 'car') {
        const s = tryPlace(2.1, 2.1, 2.1);
        if (!s) continue;
        addPart(props, parkedCarStamp(distinctColor(colorIdx++)), s.x, 0.06, s.z, range(yardRand, 0, Math.PI * 2));
        yardCars++;
        got++;
      } else if (kind === 'fountain') {
        const s = tryPlace(1.5, 1.5, 1.5);
        if (!s) continue;
        addPart(props, yardFountainGeom(), s.x, 0.06, s.z, range(yardRand, 0, Math.PI * 2));
        fountainSpots.push({ x: s.x, z: s.z });
        yardFountains++;
        got++;
      }
    }
    if (got > 0) yardDressed++;
  }

  return {
    paving, props, fountainSpots,
    counts: { blocks: dressed.length, cars, fences, flowerBeds: flowers, benches, bins, pots, yardTrees, yardBenches, yardCars, yardFlowers, yardFountains, yardDressed },
  };
}
