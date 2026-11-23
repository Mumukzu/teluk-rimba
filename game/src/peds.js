// Teluk Rimba — pedestrians. 2000 NPCs walking the sidewalks, crossing at
// zebras, fleeing gunshots. Every NPC wears different clothes: shirt, pants
// and skin tones all vary per NPC, so the city feels alive. Pure logic
// (no WebGL, no DOM); geometry builders at the bottom.
import { mulberry32, range, rangeInt, clamp } from './rng.js';
import { PED_COUNT } from './config.js';
import { ROAD_LINES, RIVER_POINTS, ASPHALT_HALF, terrainHeight, riverDistance } from './city.js';
import { emptyGeom, plainBox, prismY, mat4TRS, mat4RotX, mat4Multiply } from './gl.js';

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
const HAIRS = [
  [0.12, 0.1, 0.09], [0.35, 0.22, 0.12], [0.85, 0.7, 0.4],
  [0.6, 0.6, 0.62], [0.5, 0.3, 0.15], [0.2, 0.16, 0.12],
];

export function createPeds(city, opts = {}) {
  const rand = mulberry32(opts.seed || 20261124);
  const peds = [];
  let nextId = 1;

  // Zone of a world point: the block that contains it (blocks carry the
  // zone: downtown / commercial / residential / beach / port / forest /
  // river / plaza / market). Sidewalks sit in the road corridor between
  // blocks, so a point in no block takes the NEAREST block's zone — the
  // sidewalk belongs to the block it fronts. Used for the per-zone
  // population report.
  function zoneAt(x, z) {
    for (const b of city.blocks) {
      if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) return b.zone;
    }
    let best = null, bestD = Infinity;
    for (const b of city.blocks) {
      const dx = Math.max(b.x0 - x, 0, x - b.x1), dz = Math.max(b.z0 - z, 0, z - b.z1);
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = b; }
    }
    return best ? best.zone : 'street';
  }

  // Busy hotspots (Mu: market, square, beachfront, downtown, port denser
  // than the rest, but every zone still populated). Weights sum to 1.
  const HOTSPOTS = [
    { x: 51, z: -51, r: 80, w: 0.25 },   // Rimba Market
    { x: 50, z: 50, r: 80, w: 0.20 },    // Town Square (plaza block 5,5)
    { x: 620, z: 0, r: 200, w: 0.20 },   // Beachfront
    { x: 0, z: 0, r: 150, w: 0.20 },     // Downtown core
    { x: 600, z: 400, r: 100, w: 0.15 }, // Port / lighthouse end
  ];
  function pickHotspot() {
    let roll = rand(), acc = 0;
    for (const h of HOTSPOTS) { acc += h.w; if (roll <= acc) return h; }
    return HOTSPOTS[HOTSPOTS.length - 1];
  }

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

  function hotspotSpot() {
    // A sidewalk spot near a busy hotspot: a road line within the
    // hotspot's radius, along-coordinate within the radius.
    const h = pickHotspot();
    const horiz = rand() < 0.5;
    const lines = ROAD_LINES.filter((L) => Math.abs(L - (horiz ? h.z : h.x)) <= h.r);
    if (!lines.length) return sidewalkSpot();
    const L = lines[Math.floor(rand() * lines.length)];
    const along = (horiz ? h.x : h.z) + range(rand, -h.r, h.r);
    const side = rand() < 0.5 ? -1 : 1;
    const off = ASPHALT_HALF(L) + 1.3;
    const x = horiz ? along : L + side * off;
    const z = horiz ? L + side * off : along;
    return { x, z, horiz, side, line: L };
  }

  function promenadeSpot() {
    // A walker on the riverfront promenade: a point on the river polyline,
    // offset 14.75 m (the promenade centre) to either bank, heading along
    // the river. (Mu: the riverfront reads alive too.)
    const seg = rangeInt(rand, 0, RIVER_POINTS.length - 2);
    const [ax, az] = RIVER_POINTS[seg], [bx, bz] = RIVER_POINTS[seg + 1];
    const t = range(rand, 0, 1);
    const px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
    const segLen = Math.hypot(bx - ax, bz - az);
    const nx = -(bz - az) / segLen, nz = (bx - ax) / segLen;
    const side = rand() < 0.5 ? 1 : -1;
    const x = px + nx * 14.75 * side, z = pz + nz * 14.75 * side;
    const heading = Math.atan2(bx - ax, bz - az) * (rand() < 0.5 ? 1 : -1);
    return { x, z, horiz: false, side, line: null, heading, onPromenade: true };
  }

  function spawnPed(kind = 'walk') {
    // 50% uniform sidewalk (every zone populated), 45% busy hotspot,
    // 5% riverfront promenade.
    const roll = rand();
    const spot = roll < 0.5 ? sidewalkSpot() : roll < 0.95 ? hotspotSpot() : promenadeSpot();
    if (!spot.onPromenade && riverDistance(spot.x, spot.z) < 20) return null;
    const p = {
      id: nextId++, kind,
      x: spot.x, z: spot.z,
      heading: spot.heading !== undefined ? spot.heading : (spot.horiz ? (rand() < 0.5 ? Math.PI / 2 : -Math.PI / 2) : (rand() < 0.5 ? 0 : Math.PI)),
      speed: range(rand, 1.0, 1.8),
      shirt: SHIRTS[Math.floor(rand() * SHIRTS.length)],
      pants: PANTS[Math.floor(rand() * PANTS.length)],
      skin: SKINS[Math.floor(rand() * SKINS.length)],
      hair: HAIRS[Math.floor(rand() * HAIRS.length)],
      state: 'walk', // walk | cross | flee | board | stand
      stateT: 0,
      crossCd: 0, // cooldown after a crossing, so NPCs don't ping-pong
      target: null,
      fleeX: 0, fleeZ: 0,
      line: spot.line, horiz: spot.horiz, side: spot.side,
      walkPhase: rand() * Math.PI * 2,
    };
    // Behaviour variety (Mu): ~15% jog or run, the rest walk; every NPC
    // pauses now and then to wait, chat with a neighbour, or look around.
    p.pace = rand() < 0.15 ? 'run' : 'walk';
    if (p.pace === 'run') p.speed = range(rand, 2.6, 3.4);
    p.idleIn = range(rand, 8, 40); // seconds of walking before an idle pause
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
    if (p.state === 'idle_wait' || p.state === 'idle_chat' || p.state === 'idle_look') {
      // Random street life: pause, chat with a neighbour, or look around.
      p.stateT -= dt;
      if (p.state === 'idle_look') p.heading += 0.35 * dt; // slowly look around
      if (p.stateT <= 0) { p.state = 'walk'; p.idleIn = range(rand, 15, 60); }
      return;
    }
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
        p.state = 'walk'; p.side *= -1; p.target = null; p.crossCd = 25;
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
    if (nearNode && p.crossCd <= 0 && rand() < 0.02) {
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
    if (p.crossCd > 0) p.crossCd -= dt;
    // After a while on the move, sometimes pause: wait, chat, or look around.
    p.idleIn -= dt;
    if (p.idleIn <= 0 && p.kind !== 'officer') {
      const roll = rand();
      p.state = roll < 0.4 ? 'idle_chat' : roll < 0.7 ? 'idle_wait' : 'idle_look';
      p.stateT = range(rand, 5, 15);
      if (p.state === 'idle_chat') {
        // Face the nearest NPC, like striking up a chat.
        let best = null, bestD = 5;
        for (const q of peds) {
          if (q === p) continue;
          const d = Math.hypot(q.x - p.x, q.z - p.z);
          if (d < bestD) { best = q; bestD = d; }
        }
        if (best) p.heading = Math.atan2(best.x - p.x, best.z - p.z);
        else p.heading = range(rand, 0, Math.PI * 2);
      }
    }
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
      // Keep the population at PED_COUNT (Mu: 2000 alive in the city):
      // boarded peds are replaced by fresh walkers, a few per step.
      let guard = 0;
      while (peds.length < PED_COUNT && guard++ < 4) spawnPed('walk');
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
      p.hair = [0.15, 0.2, 0.45]; // police cap, same dark blue as the uniform
      p.kind = 'officer';
      return p;
    },
    clearOfficers() {
      for (let i = peds.length - 1; i >= 0; i--) {
        if (peds[i].kind === 'officer') peds.splice(i, 1);
      }
    },
    // Live population report (Mu: per-zone counts + behaviour mix, from
    // live state, not a guess).
    zoneCounts() {
      const counts = {};
      for (const p of peds) {
        const z = zoneAt(p.x, p.z);
        counts[z] = (counts[z] || 0) + 1;
      }
      return counts;
    },
    stateMix() {
      const counts = {};
      for (const p of peds) {
        const key = (p.state === 'walk' || p.state === 'cross') ? (p.pace === 'run' ? 'run' : 'walk') : p.state;
        counts[key] = (counts[key] || 0) + 1;
      }
      return counts;
    },
    // Visible instances, culled by distance; five tintable parts so every
    // NPC is a distinct humanoid: shirt / pants (two swinging legs) /
    // skin (face + hands) / hair.
    matricesFor(camX, camZ, maxDist) {
      const torso = { matrices: [], tints: [] };
      const legsL = { matrices: [], tints: [] };
      const legsR = { matrices: [], tints: [] };
      const heads = { matrices: [], tints: [] };
      const hair = { matrices: [], tints: [] };
      const t = performance.now() / 160;
      for (const p of peds) {
        const d = Math.hypot(p.x - camX, p.z - camZ);
        if (d > maxDist) continue;
        // Limb swing (Mu: NPCs must read as walking, not statues): the two
        // legs swing in opposite phase around the hip; the bob matches the
        // same phase. Runners swing faster and wider. Idle peds stand still.
        const moving = p.state === 'walk' || p.state === 'cross' || p.state === 'flee' || p.state === 'board' || p.state === 'chase';
        const amp = moving ? (p.pace === 'run' ? 0.55 : 0.38) : 0;
        const phase = p.walkPhase + t * (p.pace === 'run' ? 1.6 : 1);
        const bob = Math.sin(phase) * 0.04 * (moving ? 1 : 0);
        const m = mat4TRS(p.x, (p.y || 0) + bob, p.z, p.heading, 1, 1, 1);
        torso.matrices.push(m); torso.tints.push(p.shirt);
        heads.matrices.push(m); heads.tints.push(p.skin);
        hair.matrices.push(m); hair.tints.push(p.hair);
        // Legs pivot at the hip (y + 0.6): T(hip) * R_y(heading) * R_x(swing).
        const hip = mat4TRS(p.x, (p.y || 0) + 0.6 + bob, p.z, p.heading, 1, 1, 1);
        const swing = Math.sin(phase) * amp;
        legsL.matrices.push(mat4Multiply(hip, mat4RotX(swing))); legsL.tints.push(p.pants);
        legsR.matrices.push(mat4Multiply(hip, mat4RotX(-swing))); legsR.tints.push(p.pants);
      }
      return { torso, legsL, legsR, heads, hair };
    },
    count() { return peds.length; },
  };
  return api;
}

// ---- geometry: three parts, each tinted per NPC ----
// Torso (white -> shirt colour) + rounded arms (not square bars).
export function pedTorsoGeom() {
  const g = emptyGeom();
  const body = plainBox(0.55, 0.85, 0.32, [1, 1, 1]);
  for (let i = 0; i < body.pos.length; i += 3) body.pos[i + 1] += 1.05;
  for (const dx of [-0.36, 0.36]) {
    const arm = prismY(6, 0.07, 0.62, [1, 1, 1]);
    for (let i = 0; i < arm.pos.length; i += 3) { arm.pos[i] += dx; arm.pos[i + 1] += 1.05; }
    g.pos.push(...arm.pos); g.nrm.push(...arm.nrm); g.col.push(...arm.col);
  }
  for (const p of [body]) { g.pos.push(...p.pos); g.nrm.push(...p.nrm); g.col.push(...p.col); }
  return g;
}
// One leg (left/right) for the limb-swing animation: built with the HIP at
// the origin, hanging down to the foot, so the instance matrix can pivot it
// at the hip (T(hip) * R_y * R_x(swing)). Tinted as pants; the shoe is dark,
// like the combined legs below.
export function pedLegGeom(side) {
  const g = emptyGeom();
  const dx = side < 0 ? -0.14 : 0.14;
  const leg = prismY(6, 0.11, 0.6, [1, 1, 1]);
  for (let i = 0; i < leg.pos.length; i += 3) { leg.pos[i] += dx; leg.pos[i + 1] -= 0.3; }
  g.pos.push(...leg.pos); g.nrm.push(...leg.nrm); g.col.push(...leg.col);
  const shoe = plainBox(0.22, 0.12, 0.36, [0.12, 0.12, 0.13]);
  for (let i = 0; i < shoe.pos.length; i += 3) { shoe.pos[i] += dx; shoe.pos[i + 1] -= 0.54; shoe.pos[i + 2] += 0.04; }
  g.pos.push(...shoe.pos); g.nrm.push(...shoe.nrm); g.col.push(...shoe.col);
  return g;
}
// Legs: two separate rounded legs (not one block, not square bars) +
// dark shoes, tinted as pants.
export function pedLegsGeom() {
  const g = emptyGeom();
  for (const dx of [-0.14, 0.14]) {
    const leg = prismY(6, 0.11, 0.6, [1, 1, 1]);
    for (let i = 0; i < leg.pos.length; i += 3) { leg.pos[i] += dx; leg.pos[i + 1] += 0.3; }
    g.pos.push(...leg.pos); g.nrm.push(...leg.nrm); g.col.push(...leg.col);
    const shoe = plainBox(0.22, 0.12, 0.36, [0.12, 0.12, 0.13]);
    for (let i = 0; i < shoe.pos.length; i += 3) { shoe.pos[i] += dx; shoe.pos[i + 1] += 0.06; shoe.pos[i + 2] += 0.04; }
    g.pos.push(...shoe.pos); g.nrm.push(...shoe.nrm); g.col.push(...shoe.col);
  }
  return g;
}
// Head with a readable human face: rounded (octagonal) head, two eyes, a
// nose that sticks out, and a mouth — not a blank box. Plus hands (skin)
// at the arm ends. Same matrix as the body, so no per-part offset needed.
export function pedHeadGeom() {
  const g = emptyGeom();
  const head = prismY(8, 0.17, 0.34, [1, 1, 1]);
  for (let i = 0; i < head.pos.length; i += 3) head.pos[i + 1] += 1.65;
  g.pos.push(...head.pos); g.nrm.push(...head.nrm); g.col.push(...head.col);
  for (const dx of [-0.08, 0.08]) {
    const eye = plainBox(0.06, 0.08, 0.04, [0.1, 0.1, 0.12]);
    for (let i = 0; i < eye.pos.length; i += 3) { eye.pos[i] += dx; eye.pos[i + 1] += 1.68; eye.pos[i + 2] += 0.17; }
    g.pos.push(...eye.pos); g.nrm.push(...eye.nrm); g.col.push(...eye.col);
  }
  // Nose: a small block sticking out of the face centre (skin tint).
  const nose = plainBox(0.05, 0.08, 0.05, [1, 1, 1]);
  for (let i = 0; i < nose.pos.length; i += 3) { nose.pos[i + 1] += 1.62; nose.pos[i + 2] += 0.18; }
  g.pos.push(...nose.pos); g.nrm.push(...nose.nrm); g.col.push(...nose.col);
  // Mouth: a thin dark line under the nose.
  const mouth = plainBox(0.12, 0.025, 0.02, [0.3, 0.14, 0.14]);
  for (let i = 0; i < mouth.pos.length; i += 3) { mouth.pos[i + 1] += 1.53; mouth.pos[i + 2] += 0.165; }
  g.pos.push(...mouth.pos); g.nrm.push(...mouth.nrm); g.col.push(...mouth.col);
  for (const dx of [-0.36, 0.36]) {
    const hand = plainBox(0.13, 0.14, 0.13, [1, 1, 1]);
    for (let i = 0; i < hand.pos.length; i += 3) { hand.pos[i] += dx; hand.pos[i + 1] += 0.68; }
    g.pos.push(...hand.pos); g.nrm.push(...hand.nrm); g.col.push(...hand.col);
  }
  return g;
}
// Hair: a rounded cap on top of the head + a back panel, tinted per NPC.
export function pedHairGeom() {
  const g = emptyGeom();
  const cap = prismY(8, 0.18, 0.12, [1, 1, 1]);
  for (let i = 0; i < cap.pos.length; i += 3) cap.pos[i + 1] += 1.86;
  const back = plainBox(0.36, 0.28, 0.08, [1, 1, 1]);
  for (let i = 0; i < back.pos.length; i += 3) { back.pos[i + 1] += 1.7; back.pos[i + 2] -= 0.15; }
  for (const p of [cap, back]) { g.pos.push(...p.pos); g.nrm.push(...p.nrm); g.col.push(...p.col); }
  return g;
}
