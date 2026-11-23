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
      addPart(props, parkedCarGeom(distinctColor(colorIdx++)), s.x, 0.06, s.z, range(rand, 0, Math.PI * 2));
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

  return {
    paving, props,
    counts: { blocks: dressed.length, cars, fences, flowerBeds: flowers, benches, bins, pots },
  };
}
