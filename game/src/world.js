// Teluk Rimba — terrain, sea, river and sky geometry (WebGL2, own engine).
// Heights come from city.js terrainHeight so the data and the picture agree.
import { terrainHeight, riverDistance, RIVER_POINTS, SEA_LEVEL } from './city.js';
import { emptyGeom, mergeGeoms, plainBox } from './gl.js';

function groundColor(x, z, h) {
  const rd = riverDistance(x, z);
  if (h < -0.6) return [0.76, 0.7, 0.55]; // sand, under/near the waterline
  // Mountain river channel (Mu): the waterfall's bed must read as DARK
  // GREY mountain rock, not tan/brown — so the blue-white water stands
  // out against it. Flat-land banks keep the tan sand colour.
  if (rd < 15 && h > 25) return [0.42, 0.4, 0.38]; // waterfall channel rock
  if (rd < 15) return [0.72, 0.66, 0.5]; // river bank
  if (h > 60) return [0.42, 0.4, 0.38]; // volcano rock
  if (h > 25) return [0.32, 0.48, 0.26]; // forested slope
  if (x > 590) return [0.78, 0.72, 0.56]; // beach
  return [0.33, 0.5, 0.29]; // tropical grass, slightly desaturated (was 0.30, 0.52, 0.26)
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
  // Lake (Mu): a water disc over the bowl at (-440,-440), 0.05 above
  // the river ribbon so it renders on top where they overlap. CLEAR
  // BLUE (Mu: the lake must read blue, not brown) — brighter than the
  // river's [0.2,0.5,0.66] so it reads as clear still water.
  const lakeCol = [0.28, 0.62, 0.88];
  const SEG = 16, R = 40, ly = SEA_LEVEL + 0.40;
  for (let i = 0; i < SEG; i++) {
    const a0 = (i / SEG) * Math.PI * 2, a1 = ((i + 1) / SEG) * Math.PI * 2;
    const c0 = [-440, ly, -440];
    const p0 = [-440 + Math.cos(a0) * R, ly, -440 + Math.sin(a0) * R];
    const p1 = [-440 + Math.cos(a1) * R, ly, -440 + Math.sin(a1) * R];
    g.pos.push(...c0, ...p0, ...p1);
    for (let k = 0; k < 3; k++) g.nrm.push(0, 1, 0);
    for (let k = 0; k < 3; k++) g.col.push(...lakeCol);
  }
  return g;
}

// Waterfall (Mu): a cascade down the volcano flank where the river
// drops from the summit (180 m) to the city (0 m) along the segment
// (-780,-780) -> (-630,-630). Seven vertical falling-water sheets,
// each spanning the local drop, both windings so it reads from the
// city side and the mountain side, plus white foam patches at the
// base of each sheet and a big foam pool where the cascade meets
// the flat river.
// COLOUR (Mu, 23 Nov — the old near-white sheets read CREAM/BROWN in
// the sun, and the brown dirt track ran straight down the middle of
// the channel): the sheets are LIGHT BLUE [0.5,0.75,0.95] with WHITE
// foam streaks baked in as vertical bands (blue/foam/blue/foam/blue),
// 10 m wide so they cover the channel — what you see is blue-white
// water, not the rock or the track behind it. The sheets OVERLAP
// (span t±0.075 on a 0.14 step) so the cascade reads as ONE continuous
// band of falling water, never as separate triangles. The dirt track
// curves around the cascade's NE side (see buildDirtTrack), and the
// channel bed itself is dark grey rock (groundColor).
export function buildWaterfall() {
  const g = emptyGeom();
  const water = [0.5, 0.75, 0.95]; // light blue flowing water (Mu)
  const foam = [0.95, 0.97, 1.0];
  const nSE = [0.707, 0, 0.707], nNW = [-0.707, 0, -0.707];
  // Across the flow: the river runs NW->SE, so across is NE-SW.
  const ax = -0.707, az = 0.707, HALF = 5.0; // 10 m wide — covers the channel
  const at = (t) => {
    const x = -780 + t * 150, z = -780 + t * 150;
    return [x, z];
  };
  // Five vertical strips per sheet: blue / foam streak / blue / foam
  // streak / blue — the white streaks read as foam running down the
  // falling water. Strip edges as fractions of the half-width.
  const STRIPS = [[-1, -0.55, water], [-0.55, -0.25, foam], [-0.25, 0.25, water], [0.25, 0.55, foam], [0.55, 1, water]];
  for (const t of [0.08, 0.22, 0.36, 0.5, 0.64, 0.78, 0.92]) {
    const [cx, cz] = at(t);
    const [ux, uz] = at(Math.max(0, t - 0.075));
    const [dx2, dz2] = at(Math.min(1, t + 0.075));
    const topY = terrainHeight(ux, uz) + 0.5;
    const botY = terrainHeight(dx2, dz2) + 0.5;
    for (const [f0, f1, col] of STRIPS) {
      const tl = [cx + ax * HALF * f0, topY, cz + az * HALF * f0];
      const tr = [cx + ax * HALF * f1, topY, cz + az * HALF * f1];
      const br = [cx + ax * HALF * f1, botY, cz + az * HALF * f1];
      const bl = [cx + ax * HALF * f0, botY, cz + az * HALF * f0];
      // Front (faces the city, SE) + back (faces the mountain, NW).
      g.pos.push(...tl, ...bl, ...br, ...tl, ...br, ...tr);
      for (let k = 0; k < 6; k++) g.nrm.push(...nSE);
      for (let k = 0; k < 6; k++) g.col.push(...col);
      g.pos.push(...tl, ...tr, ...br, ...tl, ...br, ...bl);
      for (let k = 0; k < 6; k++) g.nrm.push(...nNW);
      for (let k = 0; k < 6; k++) g.col.push(...col);
    }
    // Foam patch at the foot of this sheet.
    const fy = terrainHeight(dx2, dz2) + 0.15;
    const f = 2.2;
    const p = [[cx - f, fy, cz - f], [cx + f, fy, cz - f], [cx + f, fy, cz + f], [cx - f, fy, cz + f]];
    g.pos.push(...p[0], ...p[1], ...p[2], ...p[0], ...p[2], ...p[3]);
    for (let k = 0; k < 6; k++) g.nrm.push(0, 1, 0);
    for (let k = 0; k < 6; k++) g.col.push(...foam);
  }
  // Big foam pool where the cascade meets the flat river.
  const fy = SEA_LEVEL + 0.5, f = 7;
  const cx = -630, cz = -630;
  const p = [[cx - f, fy, cz - f], [cx + f, fy, cz - f], [cx + f, fy, cz + f], [cx - f, fy, cz + f]];
  g.pos.push(...p[0], ...p[1], ...p[2], ...p[0], ...p[2], ...p[3]);
  for (let k = 0; k < 6; k++) g.nrm.push(0, 1, 0);
  for (let k = 0; k < 6; k++) g.col.push(...foam);
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
// ROUTE (Mu, 23 Nov — the old straight line ran down the MIDDLE of the
// waterfall channel, so the cascade read as a brown stripe): the middle
// points are offset ~40 m to the NE side of the river line, so the track
// curves WELL CLEAR of the cascade instead of hugging it. Endpoints stay
// on the mission line (base (-580,-580), summit (-800,-800)). The track is
// VISUAL ONLY (missions use coordinates, not this geometry), so the
// reroute cannot break mission 6.
export function buildDirtTrack() {
  const g = emptyGeom();
  const col = [0.5, 0.38, 0.26];
  const pts = [[-580, -580], [-688, -632], [-768, -712], [-800, -800]];
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
    waterfall: buildWaterfall(),
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
