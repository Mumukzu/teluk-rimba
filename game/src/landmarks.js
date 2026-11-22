// Teluk Rimba — landmarks & street life props. All code-made, all derived
// deterministically from the shared city dataset (blocks, zones, roads), so
// they never disagree with the map. Soft pastel, never blocking roads or
// traffic: stalls sit inside the market block, vendors hug the outer edge
// of the sidewalk, the pier reaches into the sea, the lighthouse stands at
// the port tip.
import { mulberry32, range, clamp } from './rng.js';
import { ROAD_LINES, MAIN_LINES, IS_MAIN, ASPHALT_HALF, CORRIDOR_HALF, riverDistance, terrainHeight } from './city.js';
import { emptyGeom, plainBox, mat4TRS, mat4Identity } from './gl.js';

const PASTEL = [
  [0.88, 0.66, 0.6], [0.92, 0.84, 0.6], [0.64, 0.84, 0.7],
  [0.6, 0.82, 0.8], [0.78, 0.7, 0.86], [0.9, 0.74, 0.58],
  [0.68, 0.78, 0.88], [0.9, 0.72, 0.74],
];
const NEON = [
  [1, 0.45, 0.7], [0.3, 0.9, 1], [0.6, 1, 0.45],
  [1, 0.62, 0.25], [0.78, 0.5, 1], [1, 0.85, 0.3],
];

function blockAt(city, i, j) {
  return city.blocks.find((b) => b.i === i && b.j === j);
}

export function buildLandmarks(city) {
  const rand = mulberry32(20261129);
  const add = (g, part) => { g.pos.push(...part.pos); g.nrm.push(...part.nrm); g.col.push(...part.col); };

  // ---------- Night market: 14 stalls in 2 rows inside the market block ----------
  const market = blockAt(city, 6, 5);
  const stallGeom = (() => {
    const g = emptyGeom();
    const counter = plainBox(2.2, 1.0, 1.2, [1, 1, 1]);
    for (let i = 0; i < counter.pos.length; i += 3) counter.pos[i + 1] += 0.5;
    const canopy = plainBox(2.6, 0.1, 1.8, [1, 1, 1]);
    for (let i = 0; i < canopy.pos.length; i += 3) canopy.pos[i + 1] += 2.3;
    const goods1 = plainBox(0.5, 0.3, 0.4, [0.9, 0.6, 0.4]);
    for (let i = 0; i < goods1.pos.length; i += 3) { goods1.pos[i] -= 0.6; goods1.pos[i + 1] += 1.15; }
    const goods2 = plainBox(0.5, 0.3, 0.4, [0.6, 0.85, 0.6]);
    for (let i = 0; i < goods2.pos.length; i += 3) { goods2.pos[i] += 0.6; goods2.pos[i + 1] += 1.15; }
    for (const p of [counter, canopy, goods1, goods2]) add(g, p);
    // Canopy poles (dark, so the tint does not wash them out much).
    for (const [px, pz] of [[-1.2, -0.8], [1.2, -0.8], [-1.2, 0.8], [1.2, 0.8]]) {
      const pole = plainBox(0.08, 2.3, 0.08, [0.3, 0.3, 0.32]);
      for (let i = 0; i < pole.pos.length; i += 3) { pole.pos[i] += px; pole.pos[i + 1] += 1.15; pole.pos[i + 2] += pz; }
      add(g, pole);
    }
    return g;
  })();
  const stallMatrices = [], stallTints = [];
  const marketPoles = emptyGeom();
  const lightDots = { matrices: [], tints: [] };
  const LIGHT_COLS = [[1, 0.85, 0.5], [1, 0.55, 0.65], [0.5, 0.9, 1], [0.65, 1, 0.55], [0.85, 0.65, 1]];
  if (market) {
    for (let row = 0; row < 2; row++) {
      const z = market.z0 + 22 + row * 40;
      for (let k = 0; k < 7; k++) {
        const x = market.x0 + 10 + k * 11;
        stallMatrices.push(mat4TRS(x, 0, z, row === 0 ? 0 : Math.PI, 1, 1, 1));
        stallTints.push(PASTEL[(row * 7 + k) % PASTEL.length]);
      }
      // String lights between poles along each row, sagging slightly.
      for (const px of [market.x0 + 4, market.x1 - 4]) {
        const pole = plainBox(0.12, 3.4, 0.12, [0.25, 0.25, 0.28]);
        for (let i = 0; i < pole.pos.length; i += 3) { pole.pos[i] += px; pole.pos[i + 1] += 1.7; pole.pos[i + 2] += z; }
        add(marketPoles, pole);
      }
      for (let s = 0; s <= 20; s++) {
        const t = s / 20;
        const x = (market.x0 + 4) + (market.x1 - market.x0 - 8) * t;
        const y = 3.3 - Math.sin(t * Math.PI) * 0.5;
        lightDots.matrices.push(mat4TRS(x, y, z, 0, 1, 1, 1));
        lightDots.tints.push(LIGHT_COLS[s % LIGHT_COLS.length]);
      }
    }
  }
  const lightDotGeom = plainBox(0.22, 0.22, 0.22, [1, 1, 1]);

  // ---------- Lighthouse at the port tip (625, 430) ----------
  const LIGHTHOUSE = { x: 625, z: 430, lampY: 31 };
  const lighthouseGeom = (() => {
    const g = emptyGeom();
    for (let k = 0; k < 5; k++) {
      const seg = plainBox(5.4 - k * 0.5, 6, 5.4 - k * 0.5, k % 2 === 0 ? [0.95, 0.95, 0.93] : [0.9, 0.55, 0.5]);
      for (let i = 0; i < seg.pos.length; i += 3) {
        seg.pos[i] += LIGHTHOUSE.x; seg.pos[i + 1] += 3 + k * 6; seg.pos[i + 2] += LIGHTHOUSE.z;
      }
      add(g, seg);
    }
    const gallery = plainBox(6.4, 0.5, 6.4, [0.3, 0.3, 0.32]);
    for (let i = 0; i < gallery.pos.length; i += 3) { gallery.pos[i] += LIGHTHOUSE.x; gallery.pos[i + 1] += 30.2; gallery.pos[i + 2] += LIGHTHOUSE.z; }
    add(g, gallery);
    return g;
  })();
  // Lamp room (bright, unlit) goes into the glow-signs mesh below.
  const beamGeom = plainBox(60, 1.6, 3.2, [1, 0.95, 0.75]);
  for (let i = 0; i < beamGeom.pos.length; i += 3) beamGeom.pos[i] += 30; // spans 0..60 from the lamp

  // ---------- Street vendors / warung on sidewalks ----------
  const vendorGeom = emptyGeom();
  {
    const r2 = mulberry32(20261130);
    let placed = 0, tries = 0;
    while (placed < 24 && tries++ < 600) {
      const L = ROAD_LINES[Math.floor(r2() * ROAD_LINES.length)];
      if (IS_MAIN(L)) continue;
      const along = range(r2, -420, 420);
      const horiz = r2() < 0.5;
      const side = r2() < 0.5 ? -1 : 1;
      const off = ASPHALT_HALF(L) + 2.6; // outer sidewalk edge, clear of peds
      const x = horiz ? along : L + side * off;
      const z = horiz ? L + side * off : along;
      if (Math.abs(x) < 280 && Math.abs(z) < 280) continue; // keep downtown fronts clear
      let nearCross = false;
      for (const M of ROAD_LINES) {
        if (Math.abs(x - M) < 14 && Math.abs(z - M) < 14) { nearCross = true; break; }
      }
      if (nearCross || riverDistance(x, z) < 20) continue;
      const rot = horiz ? 0 : Math.PI / 2;
      const tint = PASTEL[Math.floor(r2() * PASTEL.length)];
      const cart = plainBox(1.5, 0.9, 1.0, [0.9, 0.85, 0.75]);
      const canopy = plainBox(1.9, 0.08, 1.4, tint);
      const goods = plainBox(0.5, 0.25, 0.4, [0.85, 0.6, 0.35]);
      const c = Math.cos(rot), s = Math.sin(rot);
      for (const [part, dy] of [[cart, 0.45], [canopy, 1.9], [goods, 1.05]]) {
        for (let i = 0; i < part.pos.length; i += 3) {
          const px = part.pos[i], py = part.pos[i + 1] + dy, pz = part.pos[i + 2];
          part.pos[i] = x + px * c + pz * s;
          part.pos[i + 1] = py;
          part.pos[i + 2] = z - px * s + pz * c;
        }
        add(vendorGeom, part);
      }
      placed++;
    }
  }

  // ---------- Town square / park with fountain (plaza block 5,5) ----------
  const plazaGeom = emptyGeom();
  const plaza = blockAt(city, 5, 5);
  if (plaza) {
    const cx = (plaza.x0 + plaza.x1) / 2, cz = (plaza.z0 + plaza.z1) / 2;
    // Basin ring: 12 stone blocks around a circle.
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const bx = cx + Math.cos(a) * 6, bz = cz + Math.sin(a) * 6;
      const block = plainBox(3.4, 0.9, 1.1, [0.6, 0.6, 0.58]);
      const c = Math.cos(a), s = Math.sin(a);
      for (let i = 0; i < block.pos.length; i += 3) {
        const px = block.pos[i], py = block.pos[i + 1] + 0.45, pz = block.pos[i + 2];
        block.pos[i] = bx + px * c + pz * s;
        block.pos[i + 1] = py;
        block.pos[i + 2] = bz - px * s + pz * c;
      }
      add(plazaGeom, block);
    }
    const water = plainBox(11, 0.2, 11, [0.3, 0.6, 0.85]);
    for (let i = 0; i < water.pos.length; i += 3) { water.pos[i] += cx; water.pos[i + 1] += 0.55; water.pos[i + 2] += cz; }
    add(plazaGeom, water);
    const column = plainBox(1.2, 3.2, 1.2, [0.75, 0.75, 0.72]);
    for (let i = 0; i < column.pos.length; i += 3) { column.pos[i] += cx; column.pos[i + 1] += 1.6; column.pos[i + 2] += cz; }
    add(plazaGeom, column);
    // Four water jets (thin light-blue boxes arcing out of the column).
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const jet = plainBox(0.18, 2.2, 0.18, [0.65, 0.85, 1]);
      for (let i = 0; i < jet.pos.length; i += 3) {
        const px = jet.pos[i], py = jet.pos[i + 1];
        jet.pos[i] = cx + Math.cos(a) * 1.6 + px * Math.cos(a);
        jet.pos[i + 1] = 2.6 + py;
        jet.pos[i + 2] = cz + Math.sin(a) * 1.6 + jet.pos[i + 2];
      }
      add(plazaGeom, jet);
    }
    // Benches + park trees around the square.
    for (const [bx, bz, rot] of [[cx - 12, cz, 0], [cx + 12, cz, 0], [cx, cz - 12, Math.PI / 2], [cx, cz + 12, Math.PI / 2]]) {
      const bench = plainBox(2.4, 0.5, 0.7, [0.55, 0.42, 0.28]);
      for (let i = 0; i < bench.pos.length; i += 3) { bench.pos[i] += bx; bench.pos[i + 1] += 0.25; bench.pos[i + 2] += bz; }
      add(plazaGeom, bench);
    }
    for (const [tx, tz] of [[plaza.x0 + 8, plaza.z0 + 8], [plaza.x1 - 8, plaza.z0 + 8], [plaza.x0 + 8, plaza.z1 - 8], [plaza.x1 - 8, plaza.z1 - 8]]) {
      const trunk = plainBox(0.3, 1.6, 0.3, [0.4, 0.28, 0.16]);
      for (let i = 0; i < trunk.pos.length; i += 3) { trunk.pos[i] += tx; trunk.pos[i + 1] += 0.8; trunk.pos[i + 2] += tz; }
      const canopy = plainBox(2.2, 1.6, 2.2, [0.25, 0.52, 0.24]);
      for (let i = 0; i < canopy.pos.length; i += 3) { canopy.pos[i] += tx; canopy.pos[i + 1] += 2.4; canopy.pos[i + 2] += tz; }
      add(plazaGeom, trunk); add(plazaGeom, canopy);
    }
  }

  // ---------- Bus stops: shelters on main-road sidewalks ----------
  const busStopGeom = emptyGeom();
  const busStops = [];
  {
    const stops = [];
    for (const Lx of MAIN_LINES) {
      for (const Lz of MAIN_LINES) {
        if (stops.length >= 10) break;
        stops.push([Lx, Lz]);
      }
      if (stops.length >= 10) break;
    }
    for (const [Lx, Lz] of stops) {
      const x = Lx + CORRIDOR_HALF(Lx) - 0.5, z = Lz + CORRIDOR_HALF(Lz) - 0.5;
      busStops.push({ x, z });
      const roof = plainBox(3.2, 0.15, 1.6, [0.5, 0.65, 0.85]);
      for (let i = 0; i < roof.pos.length; i += 3) { roof.pos[i] += x; roof.pos[i + 1] += 2.6; roof.pos[i + 2] += z; }
      add(busStopGeom, roof);
      for (const dx of [-1.4, 1.4]) {
        const post = plainBox(0.12, 2.6, 0.12, [0.3, 0.3, 0.32]);
        for (let i = 0; i < post.pos.length; i += 3) { post.pos[i] += x + dx; post.pos[i + 1] += 1.3; post.pos[i + 2] += z; }
        add(busStopGeom, post);
      }
      const bench = plainBox(2.6, 0.45, 0.6, [0.55, 0.42, 0.28]);
      for (let i = 0; i < bench.pos.length; i += 3) { bench.pos[i] += x; bench.pos[i + 1] += 0.22; bench.pos[i + 2] += z; }
      add(busStopGeom, bench);
      const sign = plainBox(0.5, 0.7, 0.08, [0.25, 0.45, 0.85]);
      for (let i = 0; i < sign.pos.length; i += 3) { sign.pos[i] += x - 1.7; sign.pos[i + 1] += 2.2; sign.pos[i + 2] += z; }
      add(busStopGeom, sign);
    }
  }

  // ---------- SPBU (gas station) + bengkel (repair shop) in port blocks ----------
  const stationGeom = emptyGeom();
  function openSpotInBlock(block, w, d) {
    // Find a corner of the block clear of buildings.
    const corners = [
      [block.x0 + w / 2 + 3, block.z0 + d / 2 + 3],
      [block.x1 - w / 2 - 3, block.z0 + d / 2 + 3],
      [block.x0 + w / 2 + 3, block.z1 - d / 2 - 3],
      [block.x1 - w / 2 - 3, block.z1 - d / 2 - 3],
      [(block.x0 + block.x1) / 2, (block.z0 + block.z1) / 2],
    ];
    for (const [x, z] of corners) {
      const clash = city.buildings.some((b) =>
        Math.abs(b.x - x) < (b.w + w) / 2 + 3 && Math.abs(b.z - z) < (b.d + d) / 2 + 3);
      if (!clash && riverDistance(x, z) > 25) return { x, z };
    }
    return null;
  }
  const portBlocks = city.blocks.filter((b) => b.zone === 'port');
  const gasSpot = portBlocks.length ? openSpotInBlock(portBlocks[0], 16, 12) : null;
  const shopSpot = portBlocks.length > 1 ? openSpotInBlock(portBlocks[1], 12, 10) : null;
  if (gasSpot) {
    const { x, z } = gasSpot;
    const canopy = plainBox(16, 0.4, 12, [0.9, 0.9, 0.88]);
    for (let i = 0; i < canopy.pos.length; i += 3) { canopy.pos[i] += x; canopy.pos[i + 1] += 5.2; canopy.pos[i + 2] += z; }
    add(stationGeom, canopy);
    for (const [dx, dz] of [[-7, -5], [7, -5], [-7, 5], [7, 5]]) {
      const pole = plainBox(0.3, 5, 0.3, [0.35, 0.35, 0.38]);
      for (let i = 0; i < pole.pos.length; i += 3) { pole.pos[i] += x + dx; pole.pos[i + 1] += 2.5; pole.pos[i + 2] += z + dz; }
      add(stationGeom, pole);
    }
    for (const dx of [-3, 3]) {
      const pump = plainBox(0.9, 1.5, 0.7, [0.85, 0.3, 0.25]);
      for (let i = 0; i < pump.pos.length; i += 3) { pump.pos[i] += x + dx; pump.pos[i + 1] += 0.75; pump.pos[i + 2] += z; }
      add(stationGeom, pump);
    }
    const sign = plainBox(3.2, 1.2, 0.3, [0.25, 0.6, 0.35]);
    for (let i = 0; i < sign.pos.length; i += 3) { sign.pos[i] += x; sign.pos[i + 1] += 5.9; sign.pos[i + 2] += z - 6.5; }
    add(stationGeom, sign);
  }
  if (shopSpot) {
    const { x, z } = shopSpot;
    const roof = plainBox(12, 0.4, 10, [0.6, 0.62, 0.65]);
    for (let i = 0; i < roof.pos.length; i += 3) { roof.pos[i] += x; roof.pos[i + 1] += 4.2; roof.pos[i + 2] += z; }
    add(stationGeom, roof);
    for (const [dx, dz] of [[-5.5, 0], [5.5, 0]]) {
      const wall = plainBox(0.3, 4, 9.5, [0.75, 0.72, 0.68]);
      for (let i = 0; i < wall.pos.length; i += 3) { wall.pos[i] += x + dx; wall.pos[i + 1] += 2; wall.pos[i + 2] += z + dz; }
      add(stationGeom, wall);
    }
    {
      const back = plainBox(11.5, 4, 0.3, [0.75, 0.72, 0.68]);
      for (let i = 0; i < back.pos.length; i += 3) { back.pos[i] += x; back.pos[i + 1] += 2; back.pos[i + 2] += z + 4.5; }
      add(stationGeom, back);
    }
    for (let k = 0; k < 3; k++) {
      const tire = plainBox(0.9, 0.35, 0.9, [0.12, 0.12, 0.13]);
      for (let i = 0; i < tire.pos.length; i += 3) { tire.pos[i] += x + 4; tire.pos[i + 1] += 0.2 + k * 0.36; tire.pos[i + 2] += z + 3; }
      add(stationGeom, tire);
    }
    const sign = plainBox(3.0, 1.0, 0.3, [0.9, 0.65, 0.25]);
    for (let i = 0; i < sign.pos.length; i += 3) { sign.pos[i] += x; sign.pos[i + 1] += 5.2; sign.pos[i + 2] += z - 5.5; }
    add(stationGeom, sign);
  }

  // ---------- Neon billboards downtown + freestanding ad boards ----------
  const billboardMatrices = [], billboardTints = [];
  {
    const downtown = city.buildings.filter((b) => b.zone === 'downtown').sort((a, b) => b.h - a.h).slice(0, 8);
    downtown.forEach((b, k) => {
      const y = b.h * 0.72;
      const rot = b.rot;
      // Panel on the +z face of the building.
      const fx = b.x + Math.sin(rot) * (b.d / 2 + 0.25);
      const fz = b.z + Math.cos(rot) * (b.d / 2 + 0.25);
      billboardMatrices.push(mat4TRS(fx, y, fz, rot, 1, 1, 1));
      billboardTints.push(NEON[k % NEON.length]);
    });
    for (const [x, z] of [[120, 120], [-120, -120]]) {
      const pole = plainBox(0.4, 8, 0.4, [0.3, 0.3, 0.32]);
      // Freestanding boards go into the static mesh via a second pass below.
      billboardMatrices.push(mat4TRS(x, 9.5, z, 0, 1, 1, 1));
      billboardTints.push(NEON[(x > 0 ? 2 : 4)]);
    }
  }
  const billboardGeom = plainBox(8, 4, 0.3, [1, 1, 1]);
  const billboardPoles = emptyGeom();
  for (const [x, z] of [[120, 120], [-120, -120]]) {
    const pole = plainBox(0.4, 8, 0.4, [0.3, 0.3, 0.32]);
    for (let i = 0; i < pole.pos.length; i += 3) { pole.pos[i] += x; pole.pos[i + 1] += 4; pole.pos[i + 2] += z; }
    add(billboardPoles, pole);
  }

  // ---------- Wooden fishing pier at the beach (z -150, out into the sea) ----------
  const pierGeom = emptyGeom();
  {
    const pz = -150;
    for (let k = 0; k < 12; k++) {
      const x = 638 + k * 5.8;
      const plank = plainBox(5.5, 0.15, 2.6, [0.55, 0.42, 0.28]);
      for (let i = 0; i < plank.pos.length; i += 3) { plank.pos[i] += x; plank.pos[i + 1] += 0.4; plank.pos[i + 2] += pz; }
      add(pierGeom, plank);
      if (k % 3 === 0) {
        for (const dz of [-1.1, 1.1]) {
          const post = plainBox(0.25, 1.8, 0.25, [0.45, 0.34, 0.22]);
          for (let i = 0; i < post.pos.length; i += 3) { post.pos[i] += x; post.pos[i + 1] -= 0.4; post.pos[i + 2] += pz + dz; }
          add(pierGeom, post);
        }
      }
    }
    const platform = plainBox(5, 0.2, 5, [0.55, 0.42, 0.28]);
    for (let i = 0; i < platform.pos.length; i += 3) { platform.pos[i] += 706; platform.pos[i + 1] += 0.4; platform.pos[i + 2] += pz; }
    add(pierGeom, platform);
  }

  // ---------- Landmark signs (hospital cross, police sign, school flag) + lighthouse lamp ----------
  // One unlit instanced mesh (always bright, readable at night).
  const glowGeom = emptyGeom();
  const glowMatrices = [mat4Identity()];
  const glowTints = [[1, 1, 1]];
  for (const b of city.buildings) {
    if (!b.landmark) continue;
    if (b.landmark === 'hospital') {
      const vBar = plainBox(0.8, 2.6, 0.5, [0.9, 0.15, 0.15]);
      for (let i = 0; i < vBar.pos.length; i += 3) { vBar.pos[i] += b.x; vBar.pos[i + 1] += b.h + 1.6; vBar.pos[i + 2] += b.z; }
      const hBar = plainBox(2.6, 0.8, 0.5, [0.9, 0.15, 0.15]);
      for (let i = 0; i < hBar.pos.length; i += 3) { hBar.pos[i] += b.x; hBar.pos[i + 1] += b.h + 1.6; hBar.pos[i + 2] += b.z; }
      add(glowGeom, vBar); add(glowGeom, hBar);
    } else if (b.landmark === 'police') {
      const sign = plainBox(4.5, 1.2, 0.4, [0.2, 0.35, 0.85]);
      for (let i = 0; i < sign.pos.length; i += 3) { sign.pos[i] += b.x; sign.pos[i + 1] += b.h * 0.8; sign.pos[i + 2] += b.z + b.d / 2 + 0.3; }
      add(glowGeom, sign);
    } else if (b.landmark === 'school') {
      const pole = plainBox(0.12, 6, 0.12, [0.4, 0.4, 0.42]);
      for (let i = 0; i < pole.pos.length; i += 3) { pole.pos[i] += b.x; pole.pos[i + 1] += b.h + 3; pole.pos[i + 2] += b.z; }
      const flag = plainBox(1.6, 1.0, 0.08, [0.95, 0.8, 0.25]);
      for (let i = 0; i < flag.pos.length; i += 3) { flag.pos[i] += b.x + 0.85; flag.pos[i + 1] += b.h + 5.2; flag.pos[i + 2] += b.z; }
      add(glowGeom, pole); add(glowGeom, flag);
    }
  }
  // Lighthouse lamp (bright warm box at the top of the tower).
  {
    const lamp = plainBox(2.2, 2.4, 2.2, [1, 0.9, 0.6]);
    for (let i = 0; i < lamp.pos.length; i += 3) { lamp.pos[i] += LIGHTHOUSE.x; lamp.pos[i + 1] += LIGHTHOUSE.lampY; lamp.pos[i + 2] += LIGHTHOUSE.z; }
    add(glowGeom, lamp);
  }

  return {
    stalls: { geom: stallGeom, matrices: stallMatrices, tints: stallTints },
    marketPoles,
    lightDots: { geom: lightDotGeom, matrices: lightDots.matrices, tints: lightDots.tints },
    lighthouseGeom,
    beamGeom,
    lighthouse: LIGHTHOUSE,
    vendorGeom,
    plazaGeom,
    busStopGeom,
    busStops,
    stationGeom,
    billboards: { geom: billboardGeom, matrices: billboardMatrices, tints: billboardTints },
    billboardPoles,
    pierGeom,
    glow: { geom: glowGeom, matrices: glowMatrices, tints: glowTints },
    counts: {
      stalls: stallMatrices.length,
      vendors: 24,
      busStops: busStops.length,
      billboards: billboardMatrices.length,
      gasStation: gasSpot ? 1 : 0,
      repairShop: shopSpot ? 1 : 0,
    },
  };
}
