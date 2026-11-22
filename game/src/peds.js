// Teluk Rimba — pedestrians. 300 NPCs walking the sidewalks, crossing at
// zebras, fleeing gunshots. Every NPC wears different clothes: shirt, pants
// and skin tones all vary per NPC, so the city feels alive. Pure logic
// (no WebGL, no DOM); geometry builders at the bottom.
import { mulberry32, range, rangeInt, clamp } from './rng.js';
import { PED_COUNT } from './config.js';
import { ROAD_LINES, ASPHALT_HALF, terrainHeight, riverDistance } from './city.js';
import { emptyGeom, plainBox, mat4TRS } from './gl.js';

// Any colour goes for shirts — bright and varied, not just pastels.
const SHIRTS = [
  [0.85, 0.3, 0.25], [0.25, 0.45, 0.85], [0.25, 0.65, 0.3], [0.95, 0.75, 0.2],
  [0.7, 0.35, 0.8], [0.95, 0.5, 0.2], [0.9, 0.4, 0.55], [0.2, 0.7, 0.7],
  [0.95, 0.95, 0.9], [0.35, 0.35, 0.4], [0.6, 0.8, 0.25], [0.85, 0.6, 0.9],
  [0.3, 0.55, 0.95], [0.95, 0.65, 0.35], [0.45, 0.75, 0.45], [0.8, 0.25, 0.45],
];
const PANTS = [
  [0.15, 0.2, 0.35], [0.1, 0.1, 0.12], [0.35, 0.25, 0.18], [0.4, 0.4, 0.42],
  [0.2, 0.3, 0.5], [0.45, 0.35, 0.25], [0.25, 0.35, 0.4], [0.55, 0.55, 0.5],
];
const SKINS = [
  [0.85, 0.65, 0.5], [0.72, 0.52, 0.38], [0.6, 0.42, 0.3],
  [0.92, 0.75, 0.6], [0.78, 0.58, 0.44], [0.5, 0.35, 0.25],
];

export function createPeds(city, opts = {}) {
  const rand = mulberry32(opts.seed || 20261124);
  const peds = [];
  let nextId = 1;

  function sidewalkSpot() {
    // A point on a sidewalk: next to a road line, on the kerb-side strip.
    const L = ROAD_LINES[Math.floor(rand() * ROAD_LINES.length)];
    const along = range(rand, -580, 580);
    const side = rand() < 0.5 ? -1 : 1;
    const off = ASPHALT_HALF(L) + 1.3;
    const horiz = rand() < 0.5;
    const x = horiz ? along : L + side * off;
    const z = horiz ? L + side * off : along;
    return { x, z, horiz, side, line: L };
  }

  function spawnPed(kind = 'walk') {
    const spot = sidewalkSpot();
    if (riverDistance(spot.x, spot.z) < 20) return null;
    const p = {
      id: nextId++, kind,
      x: spot.x, z: spot.z,
      heading: spot.horiz ? (rand() < 0.5 ? Math.PI / 2 : -Math.PI / 2) : (rand() < 0.5 ? 0 : Math.PI),
      speed: range(rand, 1.0, 1.8),
      shirt: SHIRTS[Math.floor(rand() * SHIRTS.length)],
      pants: PANTS[Math.floor(rand() * PANTS.length)],
      skin: SKINS[Math.floor(rand() * SKINS.length)],
      state: 'walk', // walk | cross | flee | board | stand
      stateT: 0,
      target: null,
      fleeX: 0, fleeZ: 0,
      line: spot.line, horiz: spot.horiz, side: spot.side,
      walkPhase: rand() * Math.PI * 2,
    };
    peds.push(p);
    return p;
  }

  let guard = 0;
  while (peds.length < PED_COUNT && guard++ < PED_COUNT * 3) spawnPed('walk');
  // Two fishermen standing on the pier (x 635-705, z -150).
  for (const fx of [690, 700]) {
    const p = spawnPed('fish');
    if (p) { p.x = fx; p.z = -150; p.state = 'stand'; p.heading = Math.PI / 2; }
  }

  function stepPed(p, dt) {
    if (p.state === 'stand') return;
    if (p.state === 'flee') {
      p.stateT -= dt;
      const dx = p.x - p.fleeX, dz = p.z - p.fleeZ;
      const d = Math.hypot(dx, dz) || 1;
      p.heading = Math.atan2(dx / d, dz / d);
      p.x += (dx / d) * p.speed * 2.4 * dt;
      p.z += (dz / d) * p.speed * 2.4 * dt;
      if (p.stateT <= 0) p.state = 'walk';
      p.x = clamp(p.x, -640, 640); p.z = clamp(p.z, -640, 640);
      return;
    }
    if (p.state === 'board' && p.target) {
      const dx = p.target.x - p.x, dz = p.target.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 1.5) { p.boarded = true; return; }
      p.heading = Math.atan2(dx / d, dz / d);
      p.x += (dx / d) * p.speed * 1.6 * dt;
      p.z += (dz / d) * p.speed * 1.6 * dt;
      return;
    }
    if (p.state === 'chase' && p.target) {
      // Police officer chasing the player on foot.
      const dx = p.target.x - p.x, dz = p.target.z - p.z;
      const d = Math.hypot(dx, dz) || 1;
      p.heading = Math.atan2(dx / d, dz / d);
      p.x += (dx / d) * 6.5 * dt;
      p.z += (dz / d) * 6.5 * dt;
      p.y = Math.max(0, terrainHeight(p.x, p.z));
      return;
    }
    if (p.state === 'cross' && p.target) {
      // Crossing the road on the zebra to the opposite sidewalk.
      const dx = p.target.x - p.x, dz = p.target.z - p.z;
      const d = Math.hypot(dx, dz);
      p.stateT -= dt;
      if (d < 1 || p.stateT <= 0) {
        p.state = 'walk'; p.side *= -1; p.target = null;
        return;
      }
      p.heading = Math.atan2(dx / d, dz / d);
      p.x += (dx / d) * p.speed * 1.4 * dt;
      p.z += (dz / d) * p.speed * 1.4 * dt;
      p.y = Math.max(0, terrainHeight(p.x, p.z));
      return;
    }
    // Walk along the sidewalk; at an intersection, sometimes cross at the zebra.
    const fwd = p.speed * dt;
    let nx = p.x + Math.sin(p.heading) * fwd;
    let nz = p.z + Math.cos(p.heading) * fwd;
    // Near an intersection? Chance to cross the road on the zebra.
    let nearNode = null;
    for (const Lx of ROAD_LINES) {
      if (Math.abs(nx - Lx) > 14) continue;
      for (const Lz of ROAD_LINES) {
        if (Math.abs(nz - Lz) < 14) { nearNode = { x: Lx, z: Lz }; break; }
      }
      if (nearNode) break;
    }
    if (nearNode && rand() < 0.02) {
      p.state = 'cross';
      // Cross to the opposite sidewalk: target across the road.
      const acrossX = p.horiz ? nearNode.x : (p.side > 0 ? nearNode.x - ASPHALT_HALF(nearNode.x) - 2.6 : nearNode.x + ASPHALT_HALF(nearNode.x) + 2.6);
      const acrossZ = p.horiz ? (p.side > 0 ? nearNode.z - ASPHALT_HALF(nearNode.z) - 2.6 : nearNode.z + ASPHALT_HALF(nearNode.z) + 2.6) : nearNode.z;
      p.target = { x: acrossX, z: acrossZ };
      p.stateT = 6;
      return;
    }
    // Turn around at the city edge or after a long walk.
    if (Math.abs(nx) > 630 || Math.abs(nz) > 630 || rand() < 0.001) {
      p.heading += Math.PI;
      nx = p.x; nz = p.z;
    }
    p.x = nx; p.z = nz;
    p.y = Math.max(0, terrainHeight(p.x, p.z));
  }

  const api = {
    peds,
    step(dt, target) {
      for (const p of peds) {
        if (p.state === 'chase' && target) p.target = target;
        stepPed(p, dt);
      }
      // Remove peds who boarded a bus.
      for (let i = peds.length - 1; i >= 0; i--) {
        if (peds[i].boarded) peds.splice(i, 1);
      }
    },
    triggerFlee(x, z, radius = 40) {
      let n = 0;
      for (const p of peds) {
        if (p.state === 'stand' || p.state === 'chase') continue;
        if (Math.hypot(p.x - x, p.z - z) < radius) {
          p.state = 'flee'; p.stateT = 4; p.fleeX = x; p.fleeZ = z;
          n++;
        }
      }
      return n;
    },
    // Bus boarding: peds near the stop walk to the bus door.
    boardBus(busX, busZ, count = 2) {
      let n = 0;
      for (const p of peds) {
        if (n >= count) break;
        if (p.state !== 'walk') continue;
        if (Math.hypot(p.x - busX, p.z - busZ) < 14) {
          p.state = 'board'; p.target = { x: busX, z: busZ };
          n++;
        }
      }
      return n;
    },
    alightBus(busX, busZ) {
      const p = spawnPed('walk');
      if (!p) return null;
      p.x = busX + range(rand, -2, 2); p.z = busZ + range(rand, -2, 2);
      return p;
    },
    spawnOfficer(x, z) {
      const p = spawnPed('walk');
      if (!p) return null;
      p.x = x; p.z = z;
      p.state = 'chase';
      p.shirt = [0.15, 0.2, 0.45];
      p.pants = [0.1, 0.12, 0.25];
      p.kind = 'officer';
      return p;
    },
    clearOfficers() {
      for (let i = peds.length - 1; i >= 0; i--) {
        if (peds[i].kind === 'officer') peds.splice(i, 1);
      }
    },
    // Visible instances, culled by distance; three tintable parts so every
    // NPC wears different clothes (shirt / pants / skin).
    matricesFor(camX, camZ, maxDist) {
      const torso = { matrices: [], tints: [] };
      const legs = { matrices: [], tints: [] };
      const heads = { matrices: [], tints: [] };
      for (const p of peds) {
        const d = Math.hypot(p.x - camX, p.z - camZ);
        if (d > maxDist) continue;
        const bob = Math.sin(p.walkPhase + performance.now() / 160) * 0.04;
        const m = mat4TRS(p.x, (p.y || 0) + bob, p.z, p.heading, 1, 1, 1);
        torso.matrices.push(m); torso.tints.push(p.shirt);
        legs.matrices.push(m); legs.tints.push(p.pants);
        heads.matrices.push(m); heads.tints.push(p.skin);
      }
      return { torso, legs, heads };
    },
    count() { return peds.length; },
  };
  return api;
}

// ---- geometry: three parts, each tinted per NPC ----
// Torso (white -> shirt colour) + arms.
export function pedTorsoGeom() {
  const g = emptyGeom();
  const body = plainBox(0.55, 0.85, 0.32, [1, 1, 1]);
  for (let i = 0; i < body.pos.length; i += 3) body.pos[i + 1] += 1.05;
  const armL = plainBox(0.14, 0.7, 0.14, [1, 1, 1]);
  for (let i = 0; i < armL.pos.length; i += 3) { armL.pos[i] -= 0.36; armL.pos[i + 1] += 1.05; }
  const armR = plainBox(0.14, 0.7, 0.14, [1, 1, 1]);
  for (let i = 0; i < armR.pos.length; i += 3) { armR.pos[i] += 0.36; armR.pos[i + 1] += 1.05; }
  for (const p of [body, armL, armR]) { g.pos.push(...p.pos); g.nrm.push(...p.nrm); g.col.push(...p.col); }
  return g;
}
// Legs (dark -> pants colour).
export function pedLegsGeom() {
  const g = emptyGeom();
  const legs = plainBox(0.5, 0.6, 0.3, [1, 1, 1]);
  for (let i = 0; i < legs.pos.length; i += 3) legs.pos[i + 1] += 0.3;
  g.pos.push(...legs.pos); g.nrm.push(...legs.nrm); g.col.push(...legs.col);
  return g;
}
// Head (skin tone). Same matrix as the body, so no per-part offset needed.
export function pedHeadGeom() {
  const g = emptyGeom();
  const head = plainBox(0.34, 0.34, 0.32, [1, 1, 1]);
  for (let i = 0; i < head.pos.length; i += 3) head.pos[i + 1] += 1.65;
  g.pos.push(...head.pos); g.nrm.push(...head.nrm); g.col.push(...head.col);
  return g;
}
