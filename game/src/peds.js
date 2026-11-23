// Teluk Rimba — pedestrians, rebuilt as real low-poly HUMANS (Mu, 23 Nov).
// 2000 NPCs: ~7-7.5 heads tall, round head with face + ears, neck,
// shoulders, tapering torso, hips, arms WITH elbows, hands, legs WITH
// knees, shoes. One base model, instanced per part (torso / armL / armR /
// legL / legR / head / hair / badge / rod / skirt) — never per person.
// Variation via a per-NPC variant: skin / hair / clothing colours, sleeve
// length, hair style (short / long / bald / hat), skirt, body scale.
// Animation: opposite arm/leg swing, lean when running, idle breathing,
// seated pose (coffee / bench / beach), fishing rods. Police in uniform
// with cap + badge. Hitbox, physics and AI behaviour unchanged: the same
// stepPed walk / cross / flee / board / chase / idle states as before.
// Distribution (Mu): roads less crowded — only ~40% walk the sidewalks;
// the rest live in the empty spaces DOING things: coffee at warung tables,
// fishing at the river + pier, sitting on benches, chatting in small
// groups in parks/plazas, standing at market stalls, sitting on the beach.
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
  [0.15, 0.55, 0.55], [0.9, 0.85, 0.6], [0.5, 0.3, 0.6], [0.25, 0.35, 0.3],
];
const PANTS = [
  [0.15, 0.2, 0.35], [0.1, 0.1, 0.12], [0.35, 0.25, 0.18], [0.4, 0.4, 0.42],
  [0.2, 0.3, 0.5], [0.45, 0.35, 0.25], [0.25, 0.35, 0.4], [0.55, 0.55, 0.5],
  [0.3, 0.2, 0.3], [0.15, 0.25, 0.2],
];
const SKINS = [
  [0.85, 0.65, 0.5], [0.72, 0.52, 0.38], [0.6, 0.42, 0.3],
  [0.92, 0.75, 0.6], [0.78, 0.58, 0.44], [0.5, 0.35, 0.25],
];
const HAIRS = [
  [0.12, 0.1, 0.09], [0.35, 0.22, 0.12], [0.85, 0.7, 0.4],
  [0.6, 0.6, 0.62], [0.5, 0.3, 0.15], [0.2, 0.16, 0.12],
];
// Rotate a part's vertices around the X axis at a pivot height (elbows,
// knees, rod angles). pivotY is the joint height in the part's own frame.
function tiltX(part, angle, pivotY) {
  const c = Math.cos(angle), s = Math.sin(angle);
  for (let i = 0; i < part.pos.length; i += 3) {
    const y = part.pos[i + 1] - pivotY, z = part.pos[i + 2];
    part.pos[i + 1] = y * c - z * s + pivotY;
    part.pos[i + 2] = y * s + z * c;
  }
  return part;
}
function shift(part, x, y, z) {
  for (let i = 0; i < part.pos.length; i += 3) { part.pos[i] += x; part.pos[i + 1] += y; part.pos[i + 2] += z; }
  return part;
}

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

  // --- clearance helpers for activity spots (open space, not road/river/building)
  const nodeById = new Map(city.nodes.map((n) => [n.id, n]));
  const roadSegs = city.edges.map((e) => {
    const a = nodeById.get(e.a), b = nodeById.get(e.b);
    return [a.x, a.z, b.x, b.z];
  });
  const nearRoad = (x, z, m) => {
    for (const [ax, az, bx, bz] of roadSegs) {
      const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz;
      let t = len2 === 0 ? 0 : ((x - ax) * dx + (z - az) * dz) / len2;
      t = Math.max(0, Math.min(1, t));
      if (Math.hypot(x - (ax + t * dx), z - (az + t * dz)) < m) return true;
    }
    return false;
  };
  const clearOfBuildings = (x, z, m) => {
    for (const b of city.buildings) {
      if (Math.abs(x - b.x) < b.w / 2 + m && Math.abs(z - b.z) < b.d / 2 + m) return false;
    }
    return true;
  };
  const openSpot = (x, z) => riverDistance(x, z) >= 20 && !nearRoad(x, z, 8) && clearOfBuildings(x, z, 2);

  // --- activity spots (deterministic, seeded): the empty spaces where NPCs
  // DO things instead of walking the roads. Each spot: {x, z, heading}.
  // Coffee tables: 15 at the market, 15 at the town square, 10 at the beach
  // promenade. Benches: 30 along the river promenade, 15 at the square,
  // 15 in the parks. Fishing: 40 on the riverbank, 20 on the pier.
  const coffeeTables = [];
  const benchSpots = [];
  const fishSpots = [];
  const chatSpots = [];
  const marketSpots = [];
  const beachSitSpots = [];
  const yardSpots = [];
  {
    // Market stalls: block (6,5) spans x[0,100], z[-100,0]; rows z=-78,-38.
    // (The stalls themselves sit in the river — see landmarks.js; the
    // COFFEE tables go on the market's dry NE corner instead.)
    for (let i = 0; i < 15; i++) {
      const x = 55 + (i % 5) * 8, z = -22 + Math.floor(i / 5) * 8;
      coffeeTables.push({ x, z, heading: range(rand, 0, Math.PI * 2) });
    }
    // Town square (plaza block 5,5, centre 50,50): tables ring the fountain.
    for (let i = 0; i < 15; i++) {
      const a = (i / 15) * Math.PI * 2;
      coffeeTables.push({ x: 50 + Math.cos(a) * 24, z: 50 + Math.sin(a) * 24, heading: a + Math.PI });
    }
    // Beach promenade tables (x ~600, along the sand).
    for (let i = 0; i < 15; i++) {
      coffeeTables.push({ x: 598, z: -240 + i * 36, heading: Math.PI / 2 });
    }
    // Benches along the river promenade (rd 14.75, both banks, every ~90 m).
    for (let s = 0; s < RIVER_POINTS.length - 1; s++) {
      const [ax, az] = RIVER_POINTS[s], [bx, bz] = RIVER_POINTS[s + 1];
      const segLen = Math.hypot(bx - ax, bz - az);
      const steps = Math.max(1, Math.round(segLen / 90));
      for (let k = 0; k < steps; k++) {
        const t = (k + 0.5) / steps;
        const px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
        const nx = -(bz - az) / segLen, nz = (bx - ax) / segLen;
        for (const side of [1, -1]) {
          benchSpots.push({ x: px + nx * 15.5 * side, z: pz + nz * 15.5 * side, heading: Math.atan2(-nx * side, nz * side) });
        }
      }
    }
    // Square benches (ring the fountain, facing it).
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2 + 0.2;
      benchSpots.push({ x: 50 + Math.cos(a) * 16, z: 50 + Math.sin(a) * 16, heading: a + Math.PI });
    }
    // Fishing spots: riverbank promenade (rd 15, facing the water) + pier.
    for (let s = 0; s < RIVER_POINTS.length - 1; s++) {
      const [ax, az] = RIVER_POINTS[s], [bx, bz] = RIVER_POINTS[s + 1];
      const segLen = Math.hypot(bx - ax, bz - az);
      const steps = Math.max(1, Math.round(segLen / 90));
      for (let k = 0; k < steps; k++) {
        const t = (k + 0.5) / steps;
        const px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
        const nx = -(bz - az) / segLen, nz = (bx - ax) / segLen;
        for (const side of [1, -1]) {
          // Face the water: heading toward the river centre.
          fishSpots.push({ x: px + nx * 14.5 * side, z: pz + nz * 14.5 * side, heading: Math.atan2(-nx * side, -nz * side) });
        }
      }
    }
    for (let i = 0; i < 30; i++) {
      fishSpots.push({ x: 640 + (i % 5) * 3, z: -160 + Math.floor(i / 5) * 3, heading: Math.PI / 2 });
    }
    // Chat groups: squares, parks, yards — open spots, 4 NPCs per group.
    let tries = 0;
    while (chatSpots.length < 110 && tries++ < 2000) {
      const x = range(rand, -600, 600), z = range(rand, -600, 600);
      if (!openSpot(x, z)) continue;
      chatSpots.push({ x, z, heading: range(rand, 0, Math.PI * 2) });
    }
    // Market stall standers: in front of the stalls on dry land (NE rows).
    for (let k = 0; k < 7; k++) {
      const x = 10 + k * 11;
      marketSpots.push({ x, z: -30, heading: Math.PI });
      marketSpots.push({ x, z: -70, heading: 0 });
    }
    for (let i = 0; i < 70; i++) {
      marketSpots.push({ x: 20 + (i % 8) * 9, z: -15 - Math.floor(i / 8) * 7, heading: range(rand, 0, Math.PI * 2) });
    }
    // Beach sitters: on the sand near the umbrellas (x 615-645).
    for (let i = 0; i < 120; i++) {
      beachSitSpots.push({ x: range(rand, 615, 645), z: range(rand, -500, 500), heading: range(rand, 0, Math.PI * 2) });
    }
    // Yard / park standers: open spots anywhere in the city.
    tries = 0;
    while (yardSpots.length < 450 && tries++ < 4000) {
      const x = range(rand, -620, 620), z = range(rand, -620, 620);
      if (!openSpot(x, z)) continue;
      yardSpots.push({ x, z, heading: range(rand, 0, Math.PI * 2) });
    }
  }
  // The activity props (coffee tables + chairs + cups, benches) are built
  // from these same spot lists so props and sitters always agree.
  function activityPropsGeom() {
    const g = emptyGeom();
    const at = (part, x, y, z, rot = 0) => {
      const c = Math.cos(rot), s = Math.sin(rot);
      for (let i = 0; i < part.pos.length; i += 3) {
        const px = part.pos[i], py = part.pos[i + 1], pz = part.pos[i + 2];
        part.pos[i] = px * c + pz * s + x; part.pos[i + 1] = py + y; part.pos[i + 2] = -px * s + pz * c + z;
      }
      g.pos.push(...part.pos); g.nrm.push(...part.nrm); g.col.push(...part.col);
    };
    const TABLE = [0.75, 0.65, 0.6], CHAIR = [0.55, 0.42, 0.28], CUP = [0.95, 0.95, 0.95];
    for (const t of coffeeTables) {
      at(plainBox(1.4, 0.08, 1.4, TABLE), t.x, 0.72, t.z, t.heading);
      at(plainBox(0.12, 0.72, 0.12, TABLE), t.x, 0.36, t.z, t.heading);
      for (const [dx, dz] of [[-0.9, 0], [0.9, 0]]) {
        const c = Math.cos(t.heading), s = Math.sin(t.heading);
        const cx = t.x + dx * c + dz * s, cz = t.z - dx * s + dz * c;
        at(plainBox(0.5, 0.08, 0.5, CHAIR), cx, 0.45, cz, t.heading);
        at(plainBox(0.5, 0.45, 0.08, CHAIR), cx, 0.22, cz, t.heading);
      }
      at(plainBox(0.12, 0.14, 0.12, CUP), t.x - 0.3, 0.83, t.z, 0);
      at(plainBox(0.12, 0.14, 0.12, [0.85, 0.5, 0.2]), t.x + 0.3, 0.83, t.z, 0);
    }
    for (const b of benchSpots) {
      at(plainBox(2.4, 0.12, 0.7, CHAIR), b.x, 0.5, b.z, b.heading);
      at(plainBox(2.4, 0.6, 0.1, CHAIR), b.x, 0.85, b.z, b.heading);
    }
    return g;
  }

  // Busy hotspots for the walkers (Mu: market, square, beachfront,
  // downtown, port denser than the rest, but every zone still populated).
  const HOTSPOTS = [
    { x: 51, z: -51, r: 80, w: 0.25 },
    { x: 50, z: 50, r: 80, w: 0.20 },
    { x: 620, z: 0, r: 200, w: 0.20 },
    { x: 0, z: 0, r: 150, w: 0.20 },
    { x: 600, z: 400, r: 100, w: 0.15 },
  ];
  function pickHotspot() {
    let roll = rand(), acc = 0;
    for (const h of HOTSPOTS) { acc += h.w; if (roll <= acc) return h; }
    return HOTSPOTS[HOTSPOTS.length - 1];
  }

  function sidewalkSpot() {
    const L = ROAD_LINES[Math.floor(rand() * ROAD_LINES.length)];
    const along = range(rand, -580, 580);
    const side = rand() < 0.5 ? -1 : 1;
    const off = ASPHALT_HALF(L) + range(rand, 0.6, 3.0); // full sidewalk width
    const horiz = rand() < 0.5;
    const x = horiz ? along : L + side * off;
    const z = horiz ? L + side * off : along;
    return { x, z, horiz, side, line: L };
  }

  function hotspotSpot() {
    const h = pickHotspot();
    const horiz = rand() < 0.5;
    const lines = ROAD_LINES.filter((L) => Math.abs(L - (horiz ? h.z : h.x)) <= h.r);
    if (!lines.length) return sidewalkSpot();
    const L = lines[Math.floor(rand() * lines.length)];
    const along = (horiz ? h.x : h.z) + range(rand, -h.r, h.r);
    const side = rand() < 0.5 ? -1 : 1;
    const off = ASPHALT_HALF(L) + range(rand, 0.6, 3.0); // full sidewalk width
    const x = horiz ? along : L + side * off;
    const z = horiz ? L + side * off : along;
    return { x, z, horiz, side, line: L };
  }

  // Pairs walking side by side (Mu): two walkers share one stretch of
  // sidewalk, same heading and speed, ~1.0–1.4 m apart across the width.
  function walkerPairSpots() {
    const horiz = rand() < 0.5;
    const L = ROAD_LINES[Math.floor(rand() * ROAD_LINES.length)];
    const along = range(rand, -580, 580);
    const side = rand() < 0.5 ? -1 : 1;
    const off1 = ASPHALT_HALF(L) + range(rand, 0.6, 1.6);
    const off2 = off1 + range(rand, 1.0, 1.4);
    const heading = horiz ? (rand() < 0.5 ? Math.PI / 2 : -Math.PI / 2) : (rand() < 0.5 ? 0 : Math.PI);
    const mk = (off) => (horiz ? { x: along, z: L + side * off } : { x: L + side * off, z: along });
    return { a: mk(off1), b: mk(off2), horiz, side, line: L, heading };
  }

  function promenadeSpot() {
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

  // Distribution (Mu): 42% walk the sidewalks (roads less crowded than the
  // old 100%), 58% live in the spaces doing things.
  // Walkers spread across the FULL sidewalk width (Mu: never a neat single
  // file along the kerb) — the offset varies 0.6–3.0 m off the asphalt.
  const ACTIVITY_SHARE = [
    ['walk', 0.42], ['chat', 0.20], ['yard', 0.20], ['coffee', 0.04],
    ['fish', 0.03], ['bench', 0.03], ['market', 0.03], ['beachSit', 0.05],
  ];
  function pickActivity() {
    let roll = rand(), acc = 0;
    for (const [a, w] of ACTIVITY_SHARE) { acc += w; if (roll <= acc) return a; }
    return 'walk';
  }
  const spotLists = {
    coffee: coffeeTables, fish: fishSpots, bench: benchSpots,
    chat: chatSpots, market: marketSpots, beachSit: beachSitSpots, yard: yardSpots,
  };
  const spotCursor = {};
  function activitySpot(activity) {
    const list = spotLists[activity];
    if (!list || !list.length) return null;
    const i = (spotCursor[activity] = ((spotCursor[activity] || 0) + 1) % list.length);
    // Chat groups: 4 NPCs share one spot (a small circle, facing inward).
    // Coffee tables: 2 sitters (opposite sides). Others: 1 per spot.
    const per = activity === 'chat' ? 4 : activity === 'coffee' ? 2 : 1;
    const group = Math.floor(i / per);
    const member = i % per;
    const s = list[group % list.length];
    // A small per-NPC jitter so two NPCs sharing a spot (the lists wrap
    // when a count exceeds the spot count) never stand in exactly the
    // same place.
    const jx = range(rand, -0.8, 0.8), jz = range(rand, -0.8, 0.8);
    if (activity === 'chat') {
      const a = (member / 4) * Math.PI * 2;
      return { x: s.x + Math.cos(a) * 1.1 + jx, z: s.z + Math.sin(a) * 1.1 + jz, heading: a + Math.PI, spot: s };
    }
    if (activity === 'coffee') {
      const a = s.heading + (member === 0 ? 0 : Math.PI);
      return { x: s.x + Math.sin(a) * 0.9 + jx, z: s.z + Math.cos(a) * 0.9 + jz, heading: a + Math.PI, spot: s };
    }
    return { x: s.x + jx, z: s.z + jz, heading: s.heading, spot: s };
  }

  function spawnPed(kind = 'walk', forced = null) {
    const activity = forced ? 'walk' : (kind === 'officer' || kind === 'fish' ? kind : pickActivity());
    let spot, heading;
    if (forced) {
      spot = forced; heading = forced.heading;
    } else if (activity === 'walk') {
      const roll = rand();
      spot = roll < 0.55 ? sidewalkSpot() : roll < 0.95 ? hotspotSpot() : promenadeSpot();
      if (!spot.onPromenade && riverDistance(spot.x, spot.z) < 20) return null;
      heading = spot.heading !== undefined ? spot.heading : (spot.horiz ? (rand() < 0.5 ? Math.PI / 2 : -Math.PI / 2) : (rand() < 0.5 ? 0 : Math.PI));
    } else {
      const a = activitySpot(activity);
      if (!a) return null;
      spot = a; heading = a.heading;
    }
    const hairRoll = rand();
    const hairStyle = hairRoll < 0.55 ? 'short' : hairRoll < 0.8 ? 'long' : hairRoll < 0.9 ? 'bald' : 'hat';
    const p = {
      id: nextId++, kind,
      activity,
      x: spot.x, z: spot.z,
      heading,
      speed: forced && forced.speed ? forced.speed : range(rand, 1.0, 1.8),
      shirt: SHIRTS[Math.floor(rand() * SHIRTS.length)],
      pants: PANTS[Math.floor(rand() * PANTS.length)],
      skin: SKINS[Math.floor(rand() * SKINS.length)],
      hair: HAIRS[Math.floor(rand() * HAIRS.length)], // bald NPCs tint the hair mesh with their skin (see matricesFor)
      hairStyle,
      // Variant system (ONE base model): sleeves, skirt, body scale.
      sleeves: rand() < 0.5 ? 'long' : 'short',
      skirt: rand() < 0.15,
      scale: range(rand, 0.94, 1.06),
      pose: (activity === 'coffee' || activity === 'bench' || activity === 'beachSit') ? 'sit' : 'stand',
      state: activity === 'walk' ? 'walk' : 'stand',
      stateT: 0,
      crossCd: 0,
      target: null,
      fleeX: 0, fleeZ: 0,
      line: spot.line, horiz: spot.horiz, side: spot.side,
      walkPhase: rand() * Math.PI * 2,
    };
    // Behaviour variety (Mu): ~15% jog or run, the rest walk; every NPC
    // pauses now and then to wait, chat with a neighbour, or look around.
    p.pace = rand() < 0.15 ? 'run' : 'walk';
    if (p.pace === 'run') p.speed = range(rand, 2.6, 3.4);
    p.idleIn = range(rand, 8, 40);
    peds.push(p);
    return p;
  }

  let guard = 0;
  while (peds.length < PED_COUNT && guard++ < PED_COUNT * 3) {
    // ~20% of walkers go out in pairs, side by side (Mu: no single file).
    if (rand() < 0.20 && peds.length < PED_COUNT - 1) {
      const pr = walkerPairSpots();
      if (pr && riverDistance(pr.a.x, pr.a.z) >= 20 && riverDistance(pr.b.x, pr.b.z) >= 20) {
        const sp = range(rand, 1.0, 1.6);
        spawnPed('walk', { x: pr.a.x, z: pr.a.z, horiz: pr.horiz, side: pr.side, line: pr.line, heading: pr.heading, speed: sp });
        spawnPed('walk', { x: pr.b.x, z: pr.b.z, horiz: pr.horiz, side: pr.side, line: pr.line, heading: pr.heading, speed: sp });
        continue;
      }
    }
    spawnPed('walk');
  }
  // Two fishermen standing on the pier (x 635-705, z -150).
  for (const fx of [690, 700]) {
    const p = spawnPed('fish');
    if (p) { p.x = fx; p.z = -150; p.state = 'stand'; p.heading = Math.PI / 2; p.activity = 'fish'; }
  }

  function stepPed(p, dt) {
    if (p.state === 'stand') {
      // Activity NPCs stay put (sitting, fishing, chatting, at a stall).
      // Chatters slowly turn to face whoever is talking.
      if (p.activity === 'chat' && rand() < 0.002) p.heading += range(rand, -0.6, 0.6);
      if (p.activity === 'yard' && rand() < 0.001) p.heading += range(rand, -1, 1);
      return;
    }
    if (p.state === 'idle_wait' || p.state === 'idle_chat' || p.state === 'idle_look') {
      p.stateT -= dt;
      if (p.state === 'idle_look') p.heading += 0.35 * dt;
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
      const dx = p.target.x - p.x, dz = p.target.z - p.z;
      const d = Math.hypot(dx, dz) || 1;
      p.heading = Math.atan2(dx / d, dz / d);
      p.x += (dx / d) * 6.5 * dt;
      p.z += (dz / d) * 6.5 * dt;
      p.y = Math.max(0, terrainHeight(p.x, p.z));
      return;
    }
    if (p.state === 'cross' && p.target) {
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
      const acrossX = p.horiz ? nearNode.x : (p.side > 0 ? nearNode.x - ASPHALT_HALF(nearNode.x) - 2.6 : nearNode.x + ASPHALT_HALF(nearNode.x) + 2.6);
      const acrossZ = p.horiz ? (p.side > 0 ? nearNode.z - ASPHALT_HALF(nearNode.z) - 2.6 : nearNode.z + ASPHALT_HALF(nearNode.z) + 2.6) : nearNode.z;
      p.target = { x: acrossX, z: acrossZ };
      p.stateT = 6;
      return;
    }
    if (Math.abs(nx) > 630 || Math.abs(nz) > 630 || rand() < 0.001) {
      p.heading += Math.PI;
      nx = p.x; nz = p.z;
    }
    p.x = nx; p.z = nz;
    p.y = Math.max(0, terrainHeight(p.x, p.z));
    if (p.crossCd > 0) p.crossCd -= dt;
    p.idleIn -= dt;
    if (p.idleIn <= 0 && p.kind !== 'officer') {
      const roll = rand();
      p.state = roll < 0.4 ? 'idle_chat' : roll < 0.7 ? 'idle_wait' : 'idle_look';
      p.stateT = range(rand, 5, 15);
      if (p.state === 'idle_chat') {
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
      p.hairStyle = 'short';
      p.kind = 'officer';
      p.activity = 'walk';
      return p;
    },
    clearOfficers() {
      for (let i = peds.length - 1; i >= 0; i--) {
        if (peds[i].kind === 'officer') peds.splice(i, 1);
      }
    },
    // Live population report (Mu: per-zone counts + behaviour mix + the
    // activity split, from live state, not a guess).
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
    activityMix() {
      const counts = {};
      for (const p of peds) counts[p.activity] = (counts[p.activity] || 0) + 1;
      return counts;
    },
    activityPropsGeom,
    // Visible instances, culled by distance. One base model, instanced per
    // part: torso / armL / armR / legL / legR / skirt / head / hairShort /
    // hairLong / badge / rod. A part is drawn only for the NPCs that use it
    // (skirt instead of legs, hair by style, badge + rod only for police
    // and fishers), so the crowd costs ~10 instanced draws total.
    matricesFor(camX, camZ, maxDist) {
      const torso = { matrices: [], tints: [] };
      const armL = { matrices: [], tints: [] };
      const armR = { matrices: [], tints: [] };
      const legL = { matrices: [], tints: [] };
      const legR = { matrices: [], tints: [] };
      const skirt = { matrices: [], tints: [] };
      const heads = { matrices: [], tints: [] };
      const hairS = { matrices: [], tints: [] };
      const hairL = { matrices: [], tints: [] };
      const badge = { matrices: [], tints: [] };
      const rod = { matrices: [], tints: [] };
      const t = performance.now() / 160;
      const GOLD = [1, 0.85, 0.3], WHITE = [1, 1, 1];
      for (const p of peds) {
        const d = Math.hypot(p.x - camX, p.z - camZ);
        if (d > maxDist) continue;
        const moving = p.state === 'walk' || p.state === 'cross' || p.state === 'flee' || p.state === 'board' || p.state === 'chase';
        const running = moving && p.pace === 'run';
        const amp = moving ? (running ? 0.55 : 0.38) : 0;
        const phase = p.walkPhase + t * (running ? 1.6 : 1);
        const swing = Math.sin(phase) * amp;
        // Idle breathing: a slow, subtle chest rise (torso/head/hair only).
        const breathe = !moving ? 1 + 0.012 * Math.sin(t * 0.4 + p.walkPhase) : 1;
        const bob = Math.sin(phase) * 0.04 * (moving ? 1 : 0);
        const y = (p.y || 0) + bob;
        const s = p.scale;
        // Upper body: lean slightly forward when running (pivot at the hips,
        // y 0.9) so the run reads; otherwise upright with a breathing scale.
        const lean = running ? 0.1 : 0;
        const base = mat4TRS(p.x, y, p.z, p.heading, s, s * breathe, s);
        const hip = mat4TRS(0, 0.9 * s, 0, 0, 1, 1, 1);
        const hipInv = mat4TRS(0, -0.9 * s, 0, 0, 1, 1, 1);
        const upper = lean !== 0
          ? mat4Multiply(mat4Multiply(base, mat4Multiply(hip, mat4RotX(lean))), hipInv)
          : base;
        const seated = p.pose === 'sit';
        // Seated NPCs (coffee / bench / beach): hips at seat height 0.45,
        // torso upright, legs bent ~45° forward (feet near the ground).
        const seatM = seated ? mat4TRS(p.x, y - 0.45 * s, p.z, p.heading, s, s, s) : upper;
        torso.matrices.push(seatM); torso.tints.push(p.shirt);
        heads.matrices.push(seatM); heads.tints.push(p.skin);
        if (p.hairStyle === 'long') { hairL.matrices.push(seatM); hairL.tints.push(p.hair || p.skin); }
        else { hairS.matrices.push(seatM); hairS.tints.push(p.hairStyle === 'bald' ? p.skin : (p.hairStyle === 'hat' ? [0.9, 0.2, 0.2] : (p.hair || p.skin))); }
        // Arms pivot at the shoulders (±0.28, 1.40 — the wider torso): opposite swing to the
        // same-side leg. Long sleeves = shirt colour, short = bare skin.
        const armTint = p.sleeves === 'long' ? p.shirt : p.skin;
        const shoulderL = mat4TRS(-0.28 * s, 1.40 * s, 0, 0, 1, 1, 1);
        const shoulderR = mat4TRS(0.28 * s, 1.40 * s, 0, 0, 1, 1, 1);
        const armBase = seated ? seatM : upper;
        armL.matrices.push(mat4Multiply(mat4Multiply(armBase, shoulderL), mat4RotX(-swing)));
        armL.tints.push(armTint);
        armR.matrices.push(mat4Multiply(mat4Multiply(armBase, shoulderR), mat4RotX(swing)));
        armR.tints.push(armTint);
        if (p.skirt) {
          skirt.matrices.push(mat4TRS(p.x, y, p.z, p.heading, s, s, s));
          skirt.tints.push(p.pants);
        } else {
          // Legs pivot at the hips (±0.11, 0.90 standing / 0.45 seated):
          // opposite phases. Seated legs rotate ~45° forward at the hip.
          const hipY = seated ? 0.45 : 0.90;
          const hipL = mat4TRS(-0.11 * s, hipY * s, 0, 0, 1, 1, 1);
          const hipR = mat4TRS(0.11 * s, hipY * s, 0, 0, 1, 1, 1);
          const legBase = mat4TRS(p.x, y, p.z, p.heading, s, s, s);
          legL.matrices.push(mat4Multiply(mat4Multiply(legBase, hipL), mat4RotX(seated ? 0.8 : swing)));
          legL.tints.push(p.pants);
          legR.matrices.push(mat4Multiply(mat4Multiply(legBase, hipR), mat4RotX(seated ? 0.8 : -swing)));
          legR.tints.push(p.pants);
        }
        if (p.kind === 'officer') {
          // Gold badge on the left chest (front, z +0.22 in local frame).
          const chest = mat4TRS(-0.10 * s, 1.30 * s, 0.22 * s, 0, 1, 1, 1);
          badge.matrices.push(mat4Multiply(upper, chest));
          badge.tints.push(GOLD);
        }
        if (p.activity === 'fish') {
          // Fishing rod held in both hands, tip over the water. The rod
          // bobs gently (a fish tugging): a slow extra sway on top of the
          // idle sway, so the fisher reads as alive, not frozen.
          const rodSway = 0.05 * Math.sin(t * 0.7 + p.walkPhase);
          const hands = mat4TRS(0, 1.15 * s, 0.35 * s, 0, 1, 1, 1);
          rod.matrices.push(mat4Multiply(mat4Multiply(upper, hands), mat4RotX(rodSway)));
          rod.tints.push(WHITE);
        }
      }
      return { torso, armL, armR, legL, legR, skirt, heads, hairS, hairL, badge, rod };
    },
    count() { return peds.length; },
  };
  return api;
}

// ---- geometry: ONE humanoid base model (~7 heads tall, 1.75 m) ----
// All parts are white-tinted in the geometry; the per-instance tint
// (shirt / pants / skin / hair) supplies the colour. Darker details use
// a grey vertex colour so the tint reads darker there.
// Torso (feet at y=0): hips 0.90, waist 1.08, chest 1.28, shoulders 1.42,
// neck 1.46 — a WIDE taper, not a slab: the torso is broad enough to
// balance the legs (Mu: upper body too small before). Collar + placket +
// belt in grey.
export function pedTorsoGeom() {
  const g = emptyGeom();
  const at = (part, x, y, z) => { shift(part, x, y, z); g.pos.push(...part.pos); g.nrm.push(...part.nrm); g.col.push(...part.col); };
  at(plainBox(0.46, 0.18, 0.26, [1, 1, 1]), 0, 0.99, 0); // hips
  at(plainBox(0.40, 0.16, 0.23, [1, 1, 1]), 0, 1.14, 0); // waist (taper)
  at(plainBox(0.50, 0.28, 0.28, [1, 1, 1]), 0, 1.30, 0); // chest
  at(plainBox(0.54, 0.08, 0.30, [1, 1, 1]), 0, 1.44, 0); // shoulders
  at(plainBox(0.34, 0.04, 0.22, [0.75, 0.75, 0.75]), 0, 1.47, 0); // collar
  at(plainBox(0.05, 0.24, 0.02, [0.8, 0.8, 0.8]), 0, 1.28, 0.15); // placket
  at(plainBox(0.44, 0.05, 0.24, [0.6, 0.6, 0.6]), 0, 1.06, 0); // belt
  return g; // the neck lives in the head mesh (skin tint, not shirt)
}
// One arm (left/right): upper arm + forearm bent ~20° at the elbow + hand.
// LONG enough that the fingertips reach mid-thigh (Mu: arms too short
// before) and thick enough to read. Built with the SHOULDER at the origin,
// hanging down, so the instance matrix pivots it at the shoulder.
// side: -1 left, +1 right.
export function pedArmGeom(side) {
  const g = emptyGeom();
  const dx = side < 0 ? -0.25 : 0.25;
  const upper = plainBox(0.14, 0.34, 0.15, [1, 1, 1]);
  shift(upper, 0, -0.17, 0);
  const fore = plainBox(0.13, 0.32, 0.14, [1, 1, 1]);
  shift(fore, 0, -0.50, 0.02);
  tiltX(fore, 0.35, -0.34); // elbow bend, forearm slightly forward
  const hand = plainBox(0.11, 0.15, 0.12, [1, 1, 1]);
  shift(hand, 0, -0.76, 0.06);
  for (const part of [upper, fore, hand]) { g.pos.push(...part.pos); g.nrm.push(...part.nrm); g.col.push(...part.col); }
  return g;
}
// One leg (left/right): thigh + shin bent ~8° at the knee + shoe.
// THICK thighs and calves (Mu: legs were poles before) and a SHOE that is
// a visible dark block — 0.14 tall, bottom 0.02 BELOW the ground plane so
// it always reads as touching, never floating. Built with the HIP at the
// origin, hanging down to the foot at -0.90.
export function pedLegGeom(side) {
  const g = emptyGeom();
  const dx = side < 0 ? -0.11 : 0.11;
  const thigh = plainBox(0.23, 0.45, 0.21, [1, 1, 1]);
  shift(thigh, dx, -0.225, 0);
  const shin = plainBox(0.20, 0.42, 0.19, [1, 1, 1]);
  shift(shin, dx, -0.66, 0);
  tiltX(shin, 0.14, -0.45); // knee bend, shin slightly forward
  const shoe = plainBox(0.26, 0.14, 0.38, [0.12, 0.12, 0.13]);
  shift(shoe, dx, -0.85, 0.05);
  for (const part of [thigh, shin, shoe]) { g.pos.push(...part.pos); g.nrm.push(...part.nrm); g.col.push(...part.col); }
  return g;
}
// Combined legs (both, feet at y=0) — kept for compat; the renderer uses
// the per-leg meshes so each leg can swing.
export function pedLegsGeom() {
  const g = emptyGeom();
  for (const side of [-1, 1]) {
    const leg = pedLegGeom(side);
    for (let i = 0; i < leg.pos.length; i += 3) leg.pos[i + 1] += 0.9;
    g.pos.push(...leg.pos); g.nrm.push(...leg.nrm); g.col.push(...leg.col);
  }
  return g;
}
// Skirt / dress: flared, waist to knees + shoes. Replaces the legs for
// skirt-wearers (feet at y=0, tinted with the pants colour).
export function pedSkirtGeom() {
  const g = emptyGeom();
  const at = (part, x, y, z) => { shift(part, x, y, z); g.pos.push(...part.pos); g.nrm.push(...part.nrm); g.col.push(...part.col); };
  at(prismY(8, 0.20, 0.22, [1, 1, 1]), 0, 0.78, 0); // waist
  at(prismY(8, 0.28, 0.26, [1, 1, 1]), 0, 0.55, 0); // flared hem
  for (const dx of [-0.11, 0.11]) {
    at(plainBox(0.24, 0.14, 0.36, [0.12, 0.12, 0.13]), dx, 0.07, 0.05); // shoes (block, on the ground)
  }
  return g;
}
// Head (feet at y=0): oval 10-sided head, eyes + eyebrows, nose, mouth,
// ears — a readable human face, not a blank box. Skin tint; the eyes /
// brows / mouth use dark vertex colours so they read on any skin tone.
export function pedHeadGeom() {
  const g = emptyGeom();
  const at = (part, x, y, z) => { shift(part, x, y, z); g.pos.push(...part.pos); g.nrm.push(...part.nrm); g.col.push(...part.col); };
  at(prismY(10, 0.125, 0.25, [1, 1, 1]), 0, 1.62, 0); // oval head
  at(prismY(8, 0.05, 0.08, [1, 1, 1]), 0, 1.50, 0); // neck (skin)
  for (const dx of [-0.05, 0.05]) {
    at(plainBox(0.03, 0.04, 0.02, [0.1, 0.1, 0.12]), dx, 1.64, 0.12); // eyes
    at(plainBox(0.05, 0.015, 0.02, [0.12, 0.12, 0.12]), dx, 1.68, 0.12); // brows
    at(plainBox(0.03, 0.06, 0.04, [1, 1, 1]), dx * 2.6, 1.62, 0); // ears
  }
  at(plainBox(0.03, 0.05, 0.04, [1, 1, 1]), 0, 1.60, 0.13); // nose
  at(plainBox(0.07, 0.015, 0.02, [0.3, 0.14, 0.14]), 0, 1.55, 0.12); // mouth
  return g;
}
// Hair, short: cap + small back panel. (Bald = this mesh with a skin tint;
// a hat = this mesh with a bright tint.)
export function pedHairShortGeom() {
  const g = emptyGeom();
  const at = (part, x, y, z) => { shift(part, x, y, z); g.pos.push(...part.pos); g.nrm.push(...part.nrm); g.col.push(...part.col); };
  at(prismY(10, 0.13, 0.08, [1, 1, 1]), 0, 1.74, 0); // cap
  at(plainBox(0.20, 0.14, 0.05, [1, 1, 1]), 0, 1.66, -0.11); // back
  return g;
}
// Hair, long: cap + back panel down to the shoulders.
export function pedHairLongGeom() {
  const g = emptyGeom();
  const at = (part, x, y, z) => { shift(part, x, y, z); g.pos.push(...part.pos); g.nrm.push(...part.nrm); g.col.push(...part.col); };
  at(prismY(10, 0.13, 0.08, [1, 1, 1]), 0, 1.74, 0); // cap
  at(plainBox(0.22, 0.35, 0.06, [1, 1, 1]), 0, 1.55, -0.12); // long back
  return g;
}
// Police badge: a small gold square for the left chest (officers only).
export function pedBadgeGeom() {
  return plainBox(0.06, 0.06, 0.02, [1, 1, 1]);
}
// Fishing rod + line: base at the origin (the hands), rod up-forward,
// line dropping from the ROD TIP into the water. One mesh, white tint so
// the brown rod / pale line vertex colours show as-is.
export function fishingRodGeom() {
  const g = emptyGeom();
  const rod = plainBox(0.03, 0.03, 2.0, [0.5, 0.35, 0.2]);
  shift(rod, 0, 0, 1.0);
  tiltX(rod, -0.9, 0); // rod up-forward at ~50°; tip lands at (0, 1.57, 1.24)
  // Line: from the rod tip (0, 1.57, 1.24) down-forward to the water
  // (0, -0.3, 3.5) — a 2.93 m box tilted 0.69 rad from vertical.
  const line = plainBox(0.012, 0.012, 2.93, [0.9, 0.9, 0.9]);
  shift(line, 0, 0, 1.465);
  tiltX(line, 0.69, 0);
  shift(line, 0, 1.57, 1.24);
  for (const part of [rod, line]) { g.pos.push(...part.pos); g.nrm.push(...part.nrm); g.col.push(...part.col); }
  return g;
}
