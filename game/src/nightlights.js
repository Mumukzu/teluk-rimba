// Teluk Rimba — night light pools. Warm transparent quads laid on the
// ground under street lamps, market stalls, the plaza, bus stops, the pier,
// the port dock, the gas station / repair shop and downtown shopfronts,
// drawn ONLY at night (nightOnly + transparent, like the wet-road overlay).
// They make the street itself glow near light sources, while the sky and
// the horizon stay dark. Pure geometry (no WebGL, no DOM) — the renderer
// decides when to draw it.
import { terrainHeight } from './city.js';

const WARM = [1.0, 0.76, 0.42]; // sodium-lamp warm
const WARM_CORE = [1.0, 0.85, 0.6]; // bright core under the lamp

function quad(g, cx, cz, w, d, y, col) {
  // Triangle order a,c,b / a,d,c so the face points UP (+y) — the renderer
  // culls back faces, and the wet-overlay quads use the same order.
  const n = [0, 1, 0];
  const P = (x, z) => [x, y, z];
  g.pos.push(
    ...P(cx - w / 2, cz - d / 2), ...P(cx + w / 2, cz + d / 2), ...P(cx + w / 2, cz - d / 2),
    ...P(cx - w / 2, cz - d / 2), ...P(cx - w / 2, cz + d / 2), ...P(cx + w / 2, cz + d / 2),
  );
  for (let k = 0; k < 6; k++) g.nrm.push(...n);
  for (let k = 0; k < 6; k++) g.col.push(...col);
}

export function buildNightLightGeoms(city, landmarks) {
  const pools = { pos: [], nrm: [], col: [] };
  const yFor = (x, z) => Math.max(0, terrainHeight(x, z)) + 0.14;

  // Street lamps: wide soft pool + small bright core (171 lamps).
  for (const lamp of city.lamps) {
    const y = yFor(lamp.x, lamp.z);
    quad(pools, lamp.x, lamp.z, 11, 11, y, WARM);
    quad(pools, lamp.x, lamp.z, 5, 5, y + 0.01, WARM_CORE);
  }
  // Night market: warm wash over the whole market block + cores per stall row.
  const market = city.blocks.find((b) => b.i === 6 && b.j === 5);
  if (market) {
    quad(pools, market.cx, market.cz, 84, 84, 0.15, WARM);
    quad(pools, market.cx, market.z0 + 22, 76, 12, 0.16, WARM_CORE);
    quad(pools, market.cx, market.z0 + 62, 76, 12, 0.16, WARM_CORE);
  }
  // Town square fountain.
  const plaza = city.blocks.find((b) => b.i === 5 && b.j === 5);
  if (plaza) quad(pools, plaza.cx, plaza.cz, 22, 22, 0.15, [1.0, 0.85, 0.6]);
  // Bus stops.
  for (const s of landmarks.busStops) {
    quad(pools, s.x, s.z, 8, 8, yFor(s.x, s.z), WARM);
  }
  // Fishing pier: pools along the pier deck.
  for (const x of [650, 675, 700]) quad(pools, x, -150, 10, 6, 0.55, WARM);
  // Port dock by the lighthouse.
  quad(pools, 625, 430, 24, 24, yFor(625, 430), WARM);
  // Gas station + repair shop.
  if (landmarks.gasSpot) quad(pools, landmarks.gasSpot.x, landmarks.gasSpot.z, 18, 14, 0.15, WARM);
  if (landmarks.shopSpot) quad(pools, landmarks.shopSpot.x, landmarks.shopSpot.z, 14, 12, 0.15, WARM);
  // Downtown shopfronts: a lit patch on the sidewalk in front of the
  // 8 tallest downtown towers (the same towers that carry billboards).
  const downtown = city.buildings.filter((b) => b.zone === 'downtown').sort((a, b) => b.h - a.h).slice(0, 8);
  for (const b of downtown) {
    const fx = b.x + Math.sin(b.rot) * (b.d / 2 + 4);
    const fz = b.z + Math.cos(b.rot) * (b.d / 2 + 4);
    quad(pools, fx, fz, Math.max(10, b.w), 8, yFor(fx, fz), WARM);
  }

  return { pools, count: pools.pos.length / 18 };
}
