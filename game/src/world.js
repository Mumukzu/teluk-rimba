// Teluk Rimba — terrain, sea, river and sky geometry (WebGL2, own engine).
// Heights come from city.js terrainHeight so the data and the picture agree.
import { terrainHeight, riverDistance, RIVER_POINTS, SEA_LEVEL } from './city.js';
import { emptyGeom, mergeGeoms, plainBox } from './gl.js';

function groundColor(x, z, h) {
  const rd = riverDistance(x, z);
  if (h < -0.6) return [0.76, 0.7, 0.55]; // sand, under/near the waterline
  if (rd < 15) return [0.72, 0.66, 0.5]; // river bank
  if (h > 60) return [0.42, 0.4, 0.38]; // volcano rock
  if (h > 25) return [0.32, 0.48, 0.26]; // forested slope
  if (x > 590) return [0.78, 0.72, 0.56]; // beach
  return [0.3, 0.52, 0.26]; // tropical grass
}

export function buildTerrain() {
  const g = emptyGeom();
  const N = 110; // grid cells per side over [-850, 850]
  const SIZE = 1700, STEP = SIZE / N;
  const H = [];
  for (let j = 0; j <= N; j++) {
    H.push([]);
    for (let i = 0; i <= N; i++) {
      H[j].push(terrainHeight(-850 + i * STEP, -850 + j * STEP));
    }
  }
  const normalAt = (i, j) => {
    const hl = H[j][Math.max(0, i - 1)], hr = H[j][Math.min(N, i + 1)];
    const hd = H[Math.max(0, j - 1)][i], hu = H[Math.min(N, j + 1)][i];
    const n = [-(hr - hl) / (2 * STEP), 1, -(hu - hd) / (2 * STEP)];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    return [n[0] / l, n[1] / l, n[2] / l];
  };
  const v = (i, j) => {
    const x = -850 + i * STEP, z = -850 + j * STEP;
    return { p: [x, H[j][i], z], n: normalAt(i, j), c: groundColor(x, z, H[j][i]) };
  };
  const tri = (a, b, c) => {
    g.pos.push(...a.p, ...c.p, ...b.p);
    g.nrm.push(...a.n, ...c.n, ...b.n);
    g.col.push(...a.c, ...c.c, ...b.c);
  };
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = v(i, j), b = v(i + 1, j), c = v(i + 1, j + 1), d = v(i, j + 1);
      tri(a, b, c); tri(a, c, d);
    }
  }
  return g;
}

export function buildSea() {
  // Big flat plane east of the beach, plus strips south so the horizon is water.
  const g = emptyGeom();
  const blue = [0.13, 0.42, 0.62];
  const deep = [0.08, 0.32, 0.52];
  const quad = (x0, z0, x1, z1, col) => {
    const y = SEA_LEVEL;
    g.pos.push(x0, y, z0, x1, y, z1, x1, y, z0, x0, y, z0, x0, y, z1, x1, y, z1);
    for (let k = 0; k < 6; k++) g.nrm.push(0, 1, 0);
    for (let k = 0; k < 6; k++) g.col.push(...col);
  };
  quad(600, -900, 2200, 900, blue);
  quad(600, 900, 2200, 2200, deep);
  quad(-900, 900, 600, 2200, deep);
  return g;
}

export function buildRiver() {
  // Ribbon of water following the river polyline, slightly below street level.
  const g = emptyGeom();
  const col = [0.2, 0.5, 0.66];
  const y = SEA_LEVEL + 0.35;
  for (let i = 0; i < RIVER_POINTS.length - 1; i++) {
    const [ax, az] = RIVER_POINTS[i];
    const [bx, bz] = RIVER_POINTS[i + 1];
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz) || 1;
    const nx = (-dz / len) * 11, nz = (dx / len) * 11;
    const a = [ax + nx, y, az + nz], b = [bx + nx, y, bz + nz];
    const c = [bx - nx, y, bz - nz], d = [ax - nx, y, az - nz];
    g.pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (let k = 0; k < 6; k++) g.nrm.push(0, 1, 0);
    for (let k = 0; k < 6; k++) g.col.push(...col);
  }
  return g;
}

// A volcano cone standing behind the city, so the skyline reads
// "tropical volcano" from the street. Dark rock + a pale crater rim.
export function buildVolcano() {
  const g = emptyGeom();
  const cx = -880, cz = -880, baseR = 520, topR = 90, h = 225;
  const SEG = 24;
  const rock = [0.36, 0.33, 0.31];
  const rockDark = [0.28, 0.26, 0.25];
  const rim = [0.62, 0.6, 0.56];
  for (let i = 0; i < SEG; i++) {
    const a0 = (i / SEG) * Math.PI * 2, a1 = ((i + 1) / SEG) * Math.PI * 2;
    const p0 = [cx + Math.cos(a0) * baseR, 0, cz + Math.sin(a0) * baseR];
    const p1 = [cx + Math.cos(a1) * baseR, 0, cz + Math.sin(a1) * baseR];
    const q0 = [cx + Math.cos(a0) * topR, h, cz + Math.sin(a0) * topR];
    const q1 = [cx + Math.cos(a1) * topR, h, cz + Math.sin(a1) * topR];
    const col = i % 2 === 0 ? rock : rockDark;
    const n = [Math.cos((a0 + a1) / 2) * 0.6, 0.75, Math.sin((a0 + a1) / 2) * 0.6];
    g.pos.push(...p0, ...p1, ...q1, ...p0, ...q1, ...q0);
    for (let k = 0; k < 6; k++) g.nrm.push(...n);
    for (let k = 0; k < 6; k++) g.col.push(...col);
  }
  for (let i = 0; i < SEG; i++) {
    const a0 = (i / SEG) * Math.PI * 2, a1 = ((i + 1) / SEG) * Math.PI * 2;
    const o0 = [cx + Math.cos(a0) * topR, h, cz + Math.sin(a0) * topR];
    const o1 = [cx + Math.cos(a1) * topR, h, cz + Math.sin(a1) * topR];
    const i0 = [cx + Math.cos(a0) * topR * 0.45, h - 12, cz + Math.sin(a0) * topR * 0.45];
    const i1 = [cx + Math.cos(a1) * topR * 0.45, h - 12, cz + Math.sin(a1) * topR * 0.45];
    g.pos.push(...o0, ...o1, ...i1, ...o0, ...i1, ...i0);
    for (let k = 0; k < 6; k++) g.nrm.push(0, 1, 0);
    for (let k = 0; k < 6; k++) g.col.push(...rim);
  }
  return g;
}

// Mountain dirt track: a dirt ribbon up the volcano slope for the final
// mission (mountain road). Follows the terrain so the jeep can climb it.
export function buildDirtTrack() {
  const g = emptyGeom();
  const col = [0.5, 0.38, 0.26];
  const pts = [[-580, -580], [-660, -660], [-740, -740], [-800, -800]];
  const HALF = 3.5;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz) || 1;
    const nx = (-dz / len) * HALF, nz = (dx / len) * HALF;
    const y = (x, z) => terrainHeight(x, z) + 0.3;
    const a = [ax + nx, y(ax + nx, az + nz), az + nz];
    const b = [bx + nx, y(bx + nx, bz + nz), bz + nz];
    const c = [bx - nx, y(bx - nx, bz - nz), bz - nz];
    const d = [ax - nx, y(ax - nx, az - nz), az - nz];
    g.pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (let k = 0; k < 6; k++) g.nrm.push(0, 1, 0);
    for (let k = 0; k < 6; k++) g.col.push(...col);
  }
  return g;
}

export function buildWorldGeoms() {
  return {
    terrain: buildTerrain(),
    sea: buildSea(),
    river: buildRiver(),
    volcano: buildVolcano(),
    dirtTrack: buildDirtTrack(),
    // A few distant clouds: flat pale boxes drifting high up.
    clouds: mergeGeoms([
      plainBox(90, 8, 40, [0.96, 0.96, 0.97]),
      plainBox(70, 7, 34, [0.94, 0.94, 0.96]),
      plainBox(110, 9, 46, [0.96, 0.96, 0.97]),
    ]),
  };
}
