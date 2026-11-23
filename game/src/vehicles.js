// Teluk Rimba — vehicles + traffic. Pure logic (no WebGL, no DOM) plus
// code-made geometry builders. Traffic drives on the shared road graph:
// right-hand lanes, follow-the-leader, buses run a route and dwell at stops.
// Motorbike is the main vehicle; scooter is its own slower step-through type.
// Full roster: motorbike, scooter, bajaj, car, sedan, mpv, jeep, angkot,
// bus, truck, firetruck, ambulance, police, supercar, boat, fishing boat,
// sailboat. Parked vehicles sit in parking areas (beach / port / market),
// never in a traffic lane or on a sidewalk.
import { mulberry32, range, rangeInt, clamp } from './rng.js';
import { VEHICLES, TRAFFIC_COUNT, PARKED_COUNT } from './config.js';
import { ROAD_LINES, MAIN_LINES, IS_MAIN, ASPHALT_HALF, terrainHeight, riverDistance, SEA_LEVEL } from './city.js';
import { emptyGeom, plainBox, mat4TRS } from './gl.js';

const SEED = 20261123;

// Bright, clearly varied colours per vehicle (Mu: colourful, not all
// grey/white) — saturated enough to read at a glance, still pleasant,
// never neon. Emergency vehicles keep their real colours below.
export const PASTEL = [
  [0.85, 0.35, 0.3], [0.95, 0.55, 0.2], [0.95, 0.8, 0.2],
  [0.35, 0.75, 0.35], [0.2, 0.7, 0.65], [0.25, 0.5, 0.9],
  [0.55, 0.4, 0.85], [0.9, 0.4, 0.6], [0.6, 0.85, 0.25],
  [0.85, 0.65, 0.25], [0.9, 0.45, 0.45], [0.4, 0.75, 0.9],
];

function adjacency(city) {
  const adj = new Map();
  for (const e of city.edges) {
    if (!adj.has(e.a)) adj.set(e.a, []);
    if (!adj.has(e.b)) adj.set(e.b, []);
    adj.get(e.a).push({ to: e.b, edge: e });
    adj.get(e.b).push({ to: e.a, edge: e });
  }
  return adj;
}

function bfsDist(adj, startId) {
  const dist = new Map([[startId, 0]]);
  const q = [startId];
  while (q.length) {
    const n = q.shift();
    for (const { to } of adj.get(n) || []) {
      if (!dist.has(to)) { dist.set(to, dist.get(n) + 1); q.push(to); }
    }
  }
  return dist;
}

// Bus route: a loop of main-road nodes (rectangle around downtown). The
// south-west corner jogs via (-400,-300): (-400,-400) sits in the river
// channel (the river is crossed by only 4 bridges), so the bus detours
// across the bridge at (-300,-300)-(-200,-300) instead.
function busRouteNodes(city) {
  const at = (x, z) => city.nodes.find((n) => n.x === x && n.z === z);
  const pts = [
    [-400, -300], [-200, -400], [0, -400], [200, -400], [400, -400],
    [400, -200], [400, 0], [400, 200], [400, 400],
    [200, 400], [0, 400], [-200, 400], [-400, 400],
    [-400, 200], [-400, 0], [-400, -200],
  ];
  return pts.map(([x, z]) => at(x, z).id);
}
const BUS_STOPS = new Set(); // filled with node ids at spawn time (every 3rd route node)

export function createTraffic(city, opts = {}) {
  const rand = mulberry32(opts.seed || SEED);
  const adj = adjacency(city);
  const nodesById = new Map(city.nodes.map((n) => [n.id, n]));
  const edgeLen = (e) => {
    const a = nodesById.get(e.a), b = nodesById.get(e.b);
    return Math.hypot(b.x - a.x, b.z - a.z);
  };
  const edgeDir = (e) => {
    const a = nodesById.get(e.a), b = nodesById.get(e.b);
    const l = edgeLen(e) || 1;
    return { dx: (b.x - a.x) / l, dz: (b.z - a.z) / l, len: l };
  };

  const vehicles = [];
  let nextId = 1;

  function spawnOnEdge(type, edge, s, lane) {
    const d = edgeDir(edge);
    const a = nodesById.get(edge.a);
    const tune = VEHICLES[type];
    // Right-hand traffic: the lane side picks the travel direction — a
    // vehicle on the right side of the a->b direction travels a->b, one on
    // the left side travels b->a. (Before this, every vehicle travelled
    // a->b only: south/west turns teleported it back, so all traffic
    // drained to the north-east perimeter and the centre looked empty.)
    const v = {
      id: nextId++, type, edge, s, lane,
      dir: lane >= 0 ? 1 : -1,
      speed: 0, targetSpeed: tune.maxSpeed * range(rand, 0.55, 0.85),
      x: 0, z: 0, heading: 0, y: 0,
      parked: false, driven: false, dwell: 0,
      mode: 'drive', color: PASTEL[Math.floor(rand() * PASTEL.length)],
      route: null, routeIdx: 0,
    };
    if (type === 'firetruck') v.color = [0.85, 0.32, 0.28];
    if (type === 'ambulance') v.color = [0.97, 0.97, 0.96];
    if (type === 'police') v.color = [0.96, 0.96, 0.96];
    if (type === 'angkot') v.color = [0.45, 0.75, 0.65];
    if (type === 'bajaj') v.color = [0.92, 0.68, 0.3];
    placeOnEdge(v);
    vehicles.push(v);
    return v;
  }

  function placeOnEdge(v) {
    const d = edgeDir(v.edge);
    const a = nodesById.get(v.edge.a);
    // Right-hand traffic: offset to the right of the direction of travel.
    // s is the fraction along a->b; a dir=-1 vehicle travels b->a.
    const dir = v.dir || 1;
    const fdx = d.dx * dir, fdz = d.dz * dir;
    const rx = fdz, rz = -fdx;
    v.x = a.x + d.dx * d.len * v.s + rx * v.lane;
    v.z = a.z + d.dz * d.len * v.s + rz * v.lane;
    v.heading = Math.atan2(fdx, fdz);
    v.y = Math.max(0, terrainHeight(v.x, v.z));
  }

  function pickNextEdge(v, atNodeId) {
    const outs = adj.get(atNodeId) || [];
    const came = v.edge;
    const options = outs.filter((o) => o.edge !== came);
    if (options.length === 0) return outs[0] || null;
    // Police pursuit: pick the edge whose far node is closest (BFS) to the
    // player node. distMap is refreshed every second by the wanted system.
    if (v.distMap) {
      let best = null, bestD = Infinity;
      for (const o of options) {
        const d = v.distMap.get(o.to);
        if (d !== undefined && d < bestD) { bestD = d; best = o; }
      }
      if (best) return best;
    }
    // Buses follow their route: pick the edge that leads toward the next
    // route waypoint (shortest BFS distance to it).
    if (v.route) {
      const target = v.route[v.routeIdx];
      let best = null, bestD = Infinity;
      for (const o of options) {
        const d = bfsDist(adj, o.to).get(target);
        if (d !== undefined && d < bestD) { bestD = d; best = o; }
      }
      if (best) {
        if (best.to === target) v.routeIdx = (v.routeIdx + 1) % v.route.length;
        return best;
      }
    }
    // Prefer going straight (smallest heading change), else random.
    // Keep main roads busy: when a main-road edge is available, take it
    // almost always — otherwise traffic diffuses over the whole graph
    // and every single street frame looks empty.
    let options2 = options;
    const mainOpts = options.filter((o) => o.edge.main);
    if (mainOpts.length && rand() < 0.9) options2 = mainOpts;
    const cur = edgeDir(v.edge);
    options2.sort((p, q) => {
      const pd = edgeDir(p.edge), qd = edgeDir(q.edge);
      const pa = Math.abs(Math.atan2(pd.dx, pd.dz) - Math.atan2(cur.dx, cur.dz));
      const qa = Math.abs(Math.atan2(qd.dx, qd.dz) - Math.atan2(cur.dx, cur.dz));
      return pa - qa;
    });
    return rand() < 0.6 ? options2[0] : options2[Math.floor(rand() * options2.length)];
  }

  // --- spawn moving traffic ---
  // Dense on MAIN roads (Mu: intersections must look busy, not empty):
  // ~85% of vehicles spawn on a main-road edge, the rest anywhere.
  const mainEdges = city.edges.filter((e) => e.main);
  const pickEdge = () => (rand() < 0.85 && mainEdges.length
    ? mainEdges[Math.floor(rand() * mainEdges.length)]
    : city.edges[Math.floor(rand() * city.edges.length)]);
  const MOVING = [
    ['motorbike', 65], ['scooter', 32], ['car', 26], ['sedan', 20],
    ['mpv', 16], ['jeep', 10], ['angkot', 14], ['bajaj', 14],
    ['truck', 8], ['bus', 8], ['firetruck', 2], ['ambulance', 3], ['supercar', 6],
  ];
  const route = busRouteNodes(city);
  route.forEach((id, k) => { if (k % 3 === 0) BUS_STOPS.add(id); });
  let moving = 0;
  for (const [type, count] of MOVING) {
    for (let k = 0; k < count && moving < TRAFFIC_COUNT; k++) {
      const edge = pickEdge();
      const main = edge.main;
      const lane = main ? (rand() < 0.6 ? 1.5 : 4.5) : 2.0;
      const dir = rand() < 0.5 ? 1 : -1;
      const v = spawnOnEdge(type, edge, rand(), dir * lane);
      if (type === 'bus') {
        // Buses start on the route: snap to a route edge.
        const startNode = route[Math.floor(rand() * route.length)];
        const outs = adj.get(startNode) || [];
        const onRoute = outs.find((o) => route.includes(o.to));
        if (onRoute) {
          v.edge = onRoute.edge;
          v.dir = onRoute.edge.a === startNode ? 1 : -1;
          v.s = v.dir === 1 ? 0 : 1;
          v.lane = v.dir === 1 ? 1.5 : -1.5;
          v.route = route;
          v.routeIdx = route.indexOf(onRoute.to);
        }
      }
      moving++;
    }
  }

  // --- parked vehicles: beach / port / market parking areas (never in a
  // traffic lane or on a sidewalk) ---
  const PARK_SPOTS = [];
  for (let k = 0; k < 10; k++) PARK_SPOTS.push({ x: 606, z: -330 + k * 52, heading: Math.PI / 2 });
  for (let k = 0; k < 8; k++) PARK_SPOTS.push({ x: 430 + (k % 4) * 8, z: 400 + Math.floor(k / 4) * 14, heading: 0 });
  for (let k = 0; k < 6; k++) PARK_SPOTS.push({ x: 86, z: -80 + k * 14, heading: Math.PI });
  const PARK_TYPES = ['motorbike', 'motorbike', 'motorbike', 'motorbike', 'scooter', 'scooter', 'car', 'car', 'sedan', 'mpv', 'jeep', 'truck'];
  const parked = [];
  for (let k = 0; k < PARKED_COUNT && k < PARK_SPOTS.length; k++) {
    const spot = PARK_SPOTS[k];
    const type = PARK_TYPES[k % PARK_TYPES.length];
    const v = {
      id: nextId++, type, edge: null, s: 0, lane: 0,
      speed: 0, targetSpeed: 0, x: spot.x, z: spot.z,
      heading: spot.heading, y: Math.max(0, terrainHeight(spot.x, spot.z)),
      parked: true, driven: false, dwell: 0, mode: 'parked',
      color: PASTEL[Math.floor(rand() * PASTEL.length)], route: null, routeIdx: 0,
    };
    vehicles.push(v);
    parked.push(v);
  }

  // --- boats: fishing boats near the port, sailboats near the beach, ---
  // --- and two motor boats at the river mouth / beach. ---
  const boats = [];
  function makeBoat(type, waypoints, speed) {
    const b = {
      id: nextId++, type, waypoints, wp: 0, speed,
      x: waypoints[0][0], z: waypoints[0][1], heading: 0, y: SEA_LEVEL,
      parked: false, driven: false, mode: 'sail',
      color: PASTEL[Math.floor(rand() * PASTEL.length)],
    };
    boats.push(b);
    return b;
  }
  makeBoat('fishingboat', [[680, 330], [780, 380], [740, 480], [670, 430]], 5);
  makeBoat('fishingboat', [[700, 500], [820, 540], [780, 620], [690, 560]], 4.5);
  makeBoat('fishingboat', [[660, 200], [760, 240], [730, 300], [670, 260]], 5);
  makeBoat('sailboat', [[700, -300], [820, -260], [790, -160], [690, -220]], 4);
  makeBoat('sailboat', [[710, -80], [830, -40], [800, 60], [700, 0]], 3.5);
  makeBoat('sailboat', [[700, 120], [810, 160], [780, 240], [690, 190]], 4);
  makeBoat('sailboat', [[720, -420], [840, -380], [810, -300], [710, -340]], 3.5);
  makeBoat('boat', [[665, 105], [720, 130], [700, 180], [660, 150]], 8);
  makeBoat('boat', [[690, -40], [760, -10], [730, 40], [680, 10]], 8);

  function stepVehicle(v, dt) {
    if (v.parked || v.driven) return;
    if (v.dwell > 0) { v.dwell -= dt; v.speed = 0; return; }
    // Follow-the-leader: slow down for a vehicle ahead on the same edge,
    // same direction (opposite-direction traffic is on the other side).
    let target = v.targetSpeed;
    for (const o of vehicles) {
      if (o === v || o.parked || o.driven || o.edge !== v.edge || o.dir !== v.dir) continue;
      const gap = (o.s - v.s) * edgeLen(v.edge) * (v.dir || 1);
      if (gap > 0 && gap < 10) target = Math.min(target, o.speed);
    }
    v.speed += clamp(target - v.speed, -14 * dt, 8 * dt);
    if (v.speed < 0.05) v.speed = 0;
    const d = edgeDir(v.edge);
    const dir = v.dir || 1;
    v.s += (dir * v.speed * dt) / d.len;
    if ((dir === 1 && v.s >= 1) || (dir === -1 && v.s <= 0)) {
      const nodeId = dir === 1 ? v.edge.b : v.edge.a;
      const next = pickNextEdge(v, nodeId);
      if (!next) { v.s = dir === 1 ? 1 : 0; v.speed = 0; return; }
      // Moving onto the next edge: travel from the node we stand on
      // toward the far node (the edge's own a->b order may point either
      // way — travelling it backwards used to teleport the vehicle back).
      const main = next.edge.main;
      v.edge = next.edge;
      v.dir = next.edge.a === nodeId ? 1 : -1;
      v.s = v.dir === 1 ? 0 : 1;
      // Lane side follows the travel direction (right-hand traffic).
      v.lane = v.dir * (main ? (Math.abs(v.lane) > 3 ? 4.5 : 1.5) : 2.0);
      // Bus stop dwell: the bus stops at marked route nodes.
      if (v.type === 'bus' && BUS_STOPS.has(nodeId)) {
        v.dwell = 3;
        if (traffic.onBusStop) traffic.onBusStop(v, nodeId);
      }
    }
    placeOnEdge(v);
  }

  function stepBoat(b, dt) {
    if (b.driven || b.parked) return;
    const [tx, tz] = b.waypoints[b.wp];
    const dx = tx - b.x, dz = tz - b.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 6) { b.wp = (b.wp + 1) % b.waypoints.length; return; }
    b.heading = Math.atan2(dx, dz);
    b.x += (dx / dist) * b.speed * dt;
    b.z += (dz / dist) * b.speed * dt;
    b.y = SEA_LEVEL + 0.12 * Math.sin(performance.now() / 900 + b.id);
  }

  const traffic = {
    vehicles, boats, parked,
    onBusStop: null,
    step(dt) {
      for (const v of vehicles) stepVehicle(v, dt);
      for (const b of boats) stepBoat(b, dt);
    },
    nearestEnterable(x, z, maxDist = 5) {
      let best = null, bestD = maxDist;
      for (const v of [...vehicles, ...boats]) {
        if (v.driven) continue;
        if (!v.parked && v.speed > 2) continue; // only parked / stopped vehicles
        const d = Math.hypot(v.x - x, v.z - z);
        if (d < bestD) { bestD = d; best = v; }
      }
      return best;
    },
    enter(v) {
      v.parked = false; v.driven = true; v.dwell = 0; v.mode = 'driven';
      if (v.type === 'bus') v.route = null;
      return v;
    },
    exit(v) {
      v.driven = false; v.parked = true; v.mode = 'parked'; v.speed = 0;
      return v;
    },
    spawnPolice(x, z) {
      // Police car spawns on the nearest road edge behind the player.
      let bestEdge = city.edges[0], bestD = Infinity;
      for (const e of city.edges) {
        const a = nodesById.get(e.a);
        const d = Math.hypot(a.x - x, a.z - z);
        if (d < bestD) { bestD = d; bestEdge = e; }
      }
      const v = spawnOnEdge('police', bestEdge, 0, 1.5);
      v.mode = 'pursue';
      return v;
    },
    // Park a vehicle of a given type at a fixed spot (missions use this to
    // place the scooter / getaway-chase car / mountain jeep). Parked vehicles
    // are enterable by the player and stay put until taken.
    spawnParked(type, x, z, heading = 0) {
      const v = {
        id: nextId++, type, edge: null, s: 0, lane: 0,
        speed: 0, targetSpeed: 0, x, z,
        heading, y: Math.max(0, terrainHeight(x, z)),
        parked: true, driven: false, dwell: 0, mode: 'parked',
        color: PASTEL[Math.floor(rand() * PASTEL.length)], route: null, routeIdx: 0,
      };
      vehicles.push(v);
      return v;
    },
    // Park a motor boat in shallow water (mission 5 escape boat). It stays
    // put (stepBoat skips parked boats) until the player boards it.
    spawnParkedBoat(x, z) {
      const b = {
        id: nextId++, type: 'boat', waypoints: [[x, z]], wp: 0, speed: 0,
        x, z, heading: Math.PI / 2, y: SEA_LEVEL,
        parked: true, driven: false, mode: 'parked',
        color: PASTEL[Math.floor(rand() * PASTEL.length)],
      };
      boats.push(b);
      return b;
    },
    removeVehicle(v) {
      const i = vehicles.indexOf(v);
      if (i >= 0) vehicles.splice(i, 1);
    },
    // Visible instances per type, culled by distance (far ones hidden).
    matricesFor(camX, camZ, maxDist) {
      const out = {};
      const add = (type, m, tint) => {
        if (!out[type]) out[type] = { matrices: [], tints: [] };
        out[type].matrices.push(m);
        out[type].tints.push(tint);
      };
      for (const v of vehicles) {
        const d = Math.hypot(v.x - camX, v.z - camZ);
        if (d > maxDist && !v.driven) continue;
        add(v.type, mat4TRS(v.x, v.y, v.z, v.heading, 1, 1, 1), v.color);
      }
      for (const b of boats) {
        const d = Math.hypot(b.x - camX, b.z - camZ);
        if (d > maxDist && !b.driven) continue;
        add(b.type, mat4TRS(b.x, b.y, b.z, b.heading, 1, 1, 1), b.color);
      }
      return out;
    },
    counts() {
      return {
        moving: vehicles.filter((v) => !v.parked).length,
        parked: vehicles.filter((v) => v.parked).length,
        boats: boats.length,
        total: vehicles.length + boats.length,
      };
    },
  };
  return traffic;
}

// ---- geometry builders (code-made, one mesh per vehicle type) ----
// Local frame: X = length (front +X), Y = up from the ground, Z = width.
// A sedan reads as a sedan: low body, sloped hood + trunk, glasshouse with
// a roof panel and pillars, bumpers, headlights / taillights, grille,
// mirrors, and wheels that are discs in the X-Y plane (thin in Z).
// The OLD wheel box was thin in X (0.14 x 0.55 x 0.55), so from behind
// every car read as a table on stilts — that is fixed here.
function xlate(part, x, y, z) {
  for (let i = 0; i < part.pos.length; i += 3) {
    part.pos[i] += x; part.pos[i + 1] += y; part.pos[i + 2] += z;
  }
  return part;
}
// Rotate a part around the Z axis (in the X-Y plane) about pivot (cx, cy):
// used for sloped hoods / trunks / windshields. Normals rotate too.
function rotZ(part, a, cx, cy) {
  const c = Math.cos(a), s = Math.sin(a);
  for (let i = 0; i < part.pos.length; i += 3) {
    const dx = part.pos[i] - cx, dy = part.pos[i + 1] - cy;
    part.pos[i] = cx + dx * c - dy * s;
    part.pos[i + 1] = cy + dx * s + dy * c;
  }
  for (let i = 0; i < part.nrm.length; i += 3) {
    const nx = part.nrm[i], ny = part.nrm[i + 1];
    part.nrm[i] = nx * c - ny * s;
    part.nrm[i + 1] = nx * s + ny * c;
  }
  return part;
}
function addTo(g, part) {
  g.pos.push(...part.pos); g.nrm.push(...part.nrm); g.col.push(...part.col);
  return g;
}

const DARK = [0.16, 0.16, 0.18];
const GLASS = [0.22, 0.28, 0.36];
const LIGHT_GLASS = [0.7, 0.85, 0.95];
const WARM_LIGHT = [1.0, 0.95, 0.75];
const RED_LIGHT = [0.9, 0.15, 0.15];
const TYRE = [0.1, 0.1, 0.11];
const HUB = [0.75, 0.75, 0.78];

function wheelGeom(dia = 0.55) {
  return plainBox(dia, dia, 0.14, TYRE);
}
// Wheel + hubcap at (x, z); dia = tyre diameter.
function addWheel(g, x, z, dia = 0.55) {
  addTo(g, xlate(wheelGeom(dia), x, dia / 2, z));
  const side = z >= 0 ? 1 : -1;
  addTo(g, xlate(plainBox(0.3, 0.3, 0.04, HUB), x, dia / 2, z + side * 0.09));
}

// Generic car: low body + sloped hood/trunk slabs, glasshouse (dark glass
// band + body-colour roof panel + pillars), bumpers, lights, grille,
// mirrors. Body parts are white so the per-instance tint paints them.
export function carGeom({ len, w, bodyH, cabinLen, cabinH, cabinX, hoodSlope = 0.16, wing = false, spare = false, band = false }) {
  const g = emptyGeom();
  const bodyTop = 0.35 + bodyH;
  const glassY = bodyTop + 0.05 + cabinH / 2;
  addTo(g, xlate(plainBox(len, bodyH, w, [1, 1, 1]), 0, 0.35 + bodyH / 2, 0));
  // Sloped hood (front dips) + sloped trunk lid.
  addTo(g, rotZ(xlate(plainBox(1.15, 0.14, w - 0.25, [1, 1, 1]), len / 2 - 0.75, bodyTop + 0.05, 0), -hoodSlope, len / 2 - 0.75, bodyTop + 0.05));
  addTo(g, rotZ(xlate(plainBox(0.95, 0.14, w - 0.25, [1, 1, 1]), -len / 2 + 0.6, bodyTop + 0.05, 0), 0.1, -len / 2 + 0.6, bodyTop + 0.05));
  // Glasshouse: dark glass band + body-colour roof + corner pillars.
  addTo(g, xlate(plainBox(cabinLen, cabinH, w * 0.78, GLASS), cabinX, glassY, 0));
  addTo(g, xlate(plainBox(cabinLen * 0.9, 0.09, w * 0.8, [1, 1, 1]), cabinX, bodyTop + 0.05 + cabinH + 0.04, 0));
  for (const px of [cabinX - cabinLen / 2 + 0.12, cabinX + cabinLen / 2 - 0.12]) {
    for (const pz of [w * 0.78 / 2 - 0.07, -w * 0.78 / 2 + 0.07]) {
      addTo(g, xlate(plainBox(0.14, cabinH, 0.14, [1, 1, 1]), px, glassY, pz));
    }
  }
  // Window dividers for vans/angkot: split the glass band into windows.
  if (band) {
    for (const px of [cabinX - cabinLen / 4, cabinX + cabinLen / 4]) {
      for (const pz of [w * 0.78 / 2 + 0.01, -w * 0.78 / 2 - 0.01]) {
        addTo(g, xlate(plainBox(0.1, cabinH * 0.9, 0.05, [1, 1, 1]), px, glassY, pz));
      }
    }
  }
  // Bumpers, headlights, taillights, grille, mirrors.
  for (const sx of [1, -1]) {
    addTo(g, xlate(plainBox(0.22, 0.2, w - 0.15, DARK), sx * (len / 2 - 0.02), 0.42, 0));
  }
  for (const pz of [w / 2 - 0.42, -w / 2 + 0.42]) {
    addTo(g, xlate(plainBox(0.1, 0.15, 0.32, WARM_LIGHT), len / 2 + 0.02, 0.72, pz));
    addTo(g, xlate(plainBox(0.1, 0.15, 0.32, RED_LIGHT), -len / 2 - 0.02, 0.72, pz));
  }
  addTo(g, xlate(plainBox(0.08, 0.16, w * 0.45, DARK), len / 2 + 0.02, 0.52, 0));
  for (const pz of [w / 2 + 0.04, -w / 2 - 0.04]) {
    addTo(g, xlate(plainBox(0.16, 0.07, 0.12, DARK), cabinX + 0.5, bodyTop + 0.25, pz));
  }
  // Rear wing (supercar) / spare tyre + roof rack (jeep).
  if (wing) {
    addTo(g, xlate(plainBox(0.5, 0.07, w * 0.85, [1, 1, 1]), -len / 2 + 0.35, bodyTop + 0.45, 0));
    for (const pz of [0.5, -0.5]) addTo(g, xlate(plainBox(0.08, 0.4, 0.08, DARK), -len / 2 + 0.35, bodyTop + 0.25, pz));
  }
  if (spare) {
    addTo(g, xlate(plainBox(0.55, 0.55, 0.14, TYRE), -len / 2 - 0.08, 0.75, 0));
    addTo(g, xlate(plainBox(2.2, 0.08, 1.2, DARK), 0, bodyTop + 0.05 + cabinH + 0.14, 0));
  }
  for (const [wx, wz] of [[len / 2 - 0.75, w / 2 - 0.02], [len / 2 - 0.75, -w / 2 + 0.02], [-len / 2 + 0.75, w / 2 - 0.02], [-len / 2 + 0.75, -w / 2 + 0.02]]) {
    addWheel(g, wx, wz);
  }
  return g;
}

// Bus: long body, window band split into individual windows, windshield,
// destination sign, side door, bumpers, lights, mirrors.
function busGeom() {
  const g = emptyGeom();
  addTo(g, xlate(plainBox(9, 1.0, 2.5, [1, 1, 1]), 0, 0.85, 0));
  addTo(g, xlate(plainBox(8.4, 0.85, 2.52, GLASS), 0, 1.78, 0));
  for (const px of [-3.36, -1.68, 0, 1.68, 3.36]) {
    addTo(g, xlate(plainBox(0.12, 0.85, 2.54, [1, 1, 1]), px, 1.78, 0));
  }
  addTo(g, xlate(plainBox(9, 0.12, 2.5, [1, 1, 1]), 0, 2.26, 0));
  addTo(g, xlate(plainBox(0.1, 0.95, 2.2, GLASS), 4.48, 1.55, 0));
  addTo(g, xlate(plainBox(0.08, 0.28, 1.1, [1, 0.9, 0.5]), 4.5, 2.15, 0));
  addTo(g, xlate(plainBox(0.06, 1.5, 0.85, [0.2, 0.22, 0.28]), 3.7, 1.1, 1.26));
  for (const sx of [1, -1]) {
    addTo(g, xlate(plainBox(0.25, 0.25, 2.4, DARK), sx * 4.45, 0.48, 0));
  }
  for (const pz of [0.85, -0.85]) {
    addTo(g, xlate(plainBox(0.1, 0.2, 0.4, WARM_LIGHT), 4.52, 0.7, pz));
    addTo(g, xlate(plainBox(0.1, 0.2, 0.4, RED_LIGHT), -4.52, 0.7, pz));
    addTo(g, xlate(plainBox(0.18, 0.1, 0.14, DARK), 4.2, 1.9, pz > 0 ? 1.32 : -1.32));
  }
  for (const [wx, wz] of [[3.2, 1.18], [3.2, -1.18], [-3.2, 1.18], [-3.2, -1.18]]) addWheel(g, wx, wz, 0.7);
  return g;
}

// Truck: cab with windshield + grille + bumper, ribbed cargo box, 6 wheels.
function truckGeom() {
  const g = emptyGeom();
  addTo(g, xlate(plainBox(1.9, 1.7, 2.3, [1, 1, 1]), 2.35, 1.2, 0));
  addTo(g, xlate(plainBox(0.1, 0.8, 1.9, GLASS), 3.32, 1.55, 0));
  addTo(g, xlate(plainBox(0.08, 0.5, 1.6, DARK), 3.32, 0.75, 0));
  addTo(g, xlate(plainBox(0.25, 0.25, 2.3, DARK), 3.3, 0.45, 0));
  for (const pz of [0.85, -0.85]) {
    addTo(g, xlate(plainBox(0.1, 0.18, 0.35, WARM_LIGHT), 3.34, 0.9, pz));
    addTo(g, xlate(plainBox(0.16, 0.08, 0.12, DARK), 3.1, 1.7, pz > 0 ? 1.22 : -1.22));
  }
  addTo(g, xlate(plainBox(4.6, 2.0, 2.35, [0.85, 0.85, 0.82]), -0.9, 1.35, 0));
  for (const px of [-2.2, -0.9, 0.4]) {
    addTo(g, xlate(plainBox(0.1, 2.0, 2.39, [0.78, 0.78, 0.75]), px, 1.35, 0));
  }
  for (const [wx, wz] of [[2.6, 1.08], [2.6, -1.08], [-1.4, 1.08], [-1.4, -1.08], [-2.7, 1.08], [-2.7, -1.08]]) addWheel(g, wx, wz, 0.65);
  return g;
}

// Fire truck: red body (tint), cab + windshield, ladder on top, light bar.
function firetruckGeom() {
  const g = emptyGeom();
  addTo(g, xlate(plainBox(2.2, 1.9, 2.5, [1, 1, 1]), 2.5, 1.3, 0));
  addTo(g, xlate(plainBox(0.1, 0.85, 2.0, GLASS), 3.62, 1.6, 0));
  addTo(g, xlate(plainBox(5.3, 1.9, 2.5, [1, 1, 1]), -1.05, 1.3, 0));
  for (const px of [-2.6, -1.05, 0.5]) {
    addTo(g, xlate(plainBox(0.12, 1.9, 2.52, [0.9, 0.9, 0.88]), px, 1.3, 0));
  }
  addTo(g, xlate(plainBox(5.6, 0.18, 0.5, [0.85, 0.85, 0.86]), -0.6, 2.45, 0));
  addTo(g, xlate(plainBox(0.5, 0.16, 0.4, RED_LIGHT), 2.5, 2.35, -0.28));
  addTo(g, xlate(plainBox(0.5, 0.16, 0.4, [0.15, 0.3, 0.95]), 2.5, 2.35, 0.28));
  addTo(g, xlate(plainBox(0.25, 0.25, 2.4, DARK), 3.62, 0.48, 0));
  for (const pz of [0.9, -0.9]) addTo(g, xlate(plainBox(0.1, 0.18, 0.35, WARM_LIGHT), 3.64, 0.9, pz));
  for (const [wx, wz] of [[2.8, 1.15], [2.8, -1.15], [-1.2, 1.15], [-1.2, -1.15], [-2.9, 1.15], [-2.9, -1.15]]) addWheel(g, wx, wz, 0.65);
  return g;
}

// Ambulance: white van, glass band, red side stripe, red cross, light bar.
function ambulanceGeom() {
  const g = emptyGeom();
  addTo(g, xlate(plainBox(5.2, 1.5, 2.0, [1, 1, 1]), 0, 1.1, 0));
  addTo(g, xlate(plainBox(3.4, 0.6, 2.02, GLASS), -0.2, 1.45, 0));
  addTo(g, xlate(plainBox(5.0, 0.25, 2.02, RED_LIGHT), 0, 0.9, 0));
  addTo(g, xlate(plainBox(0.1, 0.8, 1.7, GLASS), 2.58, 1.5, 0));
  addTo(g, xlate(plainBox(0.5, 0.16, 0.4, RED_LIGHT), 0.8, 1.95, 0));
  // Red cross on both sides: the cross lies flat on the side face (thin in
  // z) — vertical bar tall in y, horizontal bar wide in x.
  for (const side of [1.02, -1.02]) {
    addTo(g, xlate(plainBox(0.2, 0.6, 0.06, RED_LIGHT), 0, 1.5, side));
    addTo(g, xlate(plainBox(0.6, 0.2, 0.06, RED_LIGHT), 0, 1.5, side));
  }
  addTo(g, xlate(plainBox(0.25, 0.22, 1.95, DARK), 2.6, 0.45, 0));
  for (const pz of [0.7, -0.7]) addTo(g, xlate(plainBox(0.1, 0.16, 0.32, WARM_LIGHT), 2.62, 0.85, pz));
  for (const [wx, wz] of [[1.8, 0.95], [1.8, -0.95], [-1.8, 0.95], [-1.8, -0.95]]) addWheel(g, wx, wz, 0.6);
  return g;
}

// Bajaj: three-wheeler — low body, canopy roof on posts, front windshield,
// one front wheel + two rear wheels, single centre headlight.
function bajajGeom() {
  const g = emptyGeom();
  addTo(g, xlate(plainBox(2.2, 0.5, 1.25, [1, 1, 1]), 0, 0.6, 0));
  addTo(g, xlate(plainBox(1.2, 0.15, 1.1, [0.2, 0.2, 0.22]), -0.5, 0.95, 0));
  addTo(g, xlate(plainBox(2.0, 0.1, 1.3, [1, 1, 1]), 0, 1.75, 0));
  for (const [px, pz] of [[0.85, 0.55], [0.85, -0.55], [-0.85, 0.55], [-0.85, -0.55]]) {
    addTo(g, xlate(plainBox(0.08, 0.85, 0.08, DARK), px, 1.32, pz));
  }
  addTo(g, xlate(plainBox(0.08, 0.55, 1.1, LIGHT_GLASS), 0.95, 1.35, 0));
  addTo(g, xlate(plainBox(0.08, 0.07, 0.7, DARK), 0.85, 1.15, 0));
  addTo(g, xlate(plainBox(0.1, 0.15, 0.3, WARM_LIGHT), 1.12, 0.75, 0));
  addTo(g, xlate(plainBox(0.2, 0.15, 1.1, DARK), 1.08, 0.42, 0));
  addWheel(g, 1.0, 0, 0.5);
  addWheel(g, -0.85, 0.55, 0.5);
  addWheel(g, -0.85, -0.55, 0.5);
  return g;
}

function bikeGeom({ scooter }) {
  const g = emptyGeom();
  // Wheels are discs in the X-Y plane (thin in Z) — the old orientation
  // made them read as fins. Fork, headlight, exhaust, mirrors added.
  addWheel(g, 0.75, 0, 0.55);
  addWheel(g, -0.75, 0, 0.55);
  addTo(g, rotZ(xlate(plainBox(0.08, 0.75, 0.08, DARK), 0.72, 0.65, 0), -0.3, 0.72, 0.65));
  addTo(g, xlate(plainBox(0.08, 0.12, 0.18, WARM_LIGHT), 0.88, 0.95, 0));
  addTo(g, xlate(plainBox(0.5, 0.09, 0.09, [0.35, 0.35, 0.36]), -0.3, 0.35, 0.24));
  if (scooter) {
    // Step-through: front shield + flat floor + seat + small windshield.
    addTo(g, xlate(plainBox(0.5, 1.0, 0.55, [1, 1, 1]), 0.62, 0.85, 0));
    addTo(g, xlate(plainBox(0.9, 0.1, 0.4, [0.25, 0.25, 0.28]), 0, 0.42, 0));
    addTo(g, xlate(plainBox(0.8, 0.14, 0.45, [0.25, 0.22, 0.2]), -0.45, 0.72, 0));
    addTo(g, rotZ(xlate(plainBox(0.06, 0.5, 0.5, LIGHT_GLASS), 0.72, 1.35, 0), -0.25, 0.72, 1.35));
  } else {
    addTo(g, xlate(plainBox(0.7, 0.32, 0.42, [1, 1, 1]), 0.15, 0.72, 0));
    addTo(g, xlate(plainBox(0.75, 0.12, 0.4, [0.2, 0.2, 0.22]), -0.5, 0.68, 0));
    addTo(g, xlate(plainBox(0.1, 0.08, 0.6, [0.15, 0.15, 0.16]), 0.68, 1.0, 0));
  }
  // Rider: torso (white, takes the tint) + legs (dark) + helmet (white).
  addTo(g, xlate(plainBox(0.42, 0.55, 0.34, [1, 1, 1]), -0.15, 1.15, 0));
  addTo(g, xlate(plainBox(0.4, 0.5, 0.32, [0.2, 0.22, 0.3]), -0.15, 0.68, 0));
  addTo(g, xlate(plainBox(0.34, 0.32, 0.32, [1, 1, 1]), -0.15, 1.58, 0));
  for (const pz of [0.32, -0.32]) {
    addTo(g, xlate(plainBox(0.06, 0.06, 0.14, DARK), 0.68, 1.08, pz));
  }
  return g;
}

function boatGeom({ fishing, sail }) {
  const g = emptyGeom();
  addTo(g, xlate(plainBox(6, 0.9, 2.2, [1, 1, 1]), 0, 0.45, 0));
  addTo(g, xlate(plainBox(1.4, 0.7, 1.8, [1, 1, 1]), 3.4, 0.4, 0));
  if (fishing) {
    addTo(g, xlate(plainBox(1.8, 1.4, 1.8, [0.9, 0.9, 0.88]), -0.8, 1.6, 0));
    addTo(g, xlate(plainBox(1.84, 0.45, 1.84, GLASS), -0.8, 1.8, 0));
    addTo(g, xlate(plainBox(0.14, 3.4, 0.14, [0.5, 0.4, 0.28]), 0.6, 2.8, 0));
    addTo(g, xlate(plainBox(1.6, 0.5, 1.6, [0.3, 0.32, 0.3]), 1.8, 1.15, 0));
  } else if (sail) {
    addTo(g, xlate(plainBox(1.2, 0.6, 1.4, [1, 1, 1]), -0.5, 1.2, 0));
    addTo(g, xlate(plainBox(0.12, 4.6, 0.12, [0.55, 0.45, 0.3]), 0, 3.2, 0));
    // Triangular sail (two triangles, white so the tint paints it pastel).
    const sailG = emptyGeom();
    const white = [1, 1, 1];
    const a = [0.1, 1.2, 0], b = [0.1, 5.2, 0], c = [-1.9, 1.2, 0];
    const n = [0, 0, 1];
    sailG.pos.push(...a, ...b, ...c, ...a, ...c, ...b);
    for (let k = 0; k < 6; k++) sailG.nrm.push(...n);
    for (let k = 0; k < 6; k++) sailG.col.push(...white);
    addTo(g, sailG);
  } else {
    addTo(g, xlate(plainBox(3.2, 0.5, 1.8, [0.92, 0.92, 0.9]), -0.4, 1.1, 0));
    addTo(g, xlate(plainBox(0.08, 0.5, 1.4, LIGHT_GLASS), 0.8, 1.35, 0));
    addTo(g, xlate(plainBox(0.5, 0.7, 0.4, DARK), -3.1, 0.6, 0));
  }
  return g;
}

export function buildVehicleGeoms() {
  const car = (o) => carGeom(o);
  return {
    motorbike: bikeGeom({ scooter: false }),
    scooter: bikeGeom({ scooter: true }),
    bajaj: bajajGeom(),
    car: car({ len: 3.6, w: 1.7, bodyH: 0.5, cabinLen: 1.9, cabinH: 0.5, cabinX: -0.1 }),
    sedan: car({ len: 4.4, w: 1.8, bodyH: 0.55, cabinLen: 2.2, cabinH: 0.55, cabinX: -0.1 }),
    mpv: car({ len: 4.5, w: 1.85, bodyH: 0.75, cabinLen: 2.8, cabinH: 0.6, cabinX: 0 }),
    jeep: car({ len: 4.2, w: 1.9, bodyH: 0.8, cabinLen: 2.4, cabinH: 0.65, cabinX: 0, hoodSlope: 0.05, spare: true }),
    angkot: car({ len: 4.0, w: 1.8, bodyH: 0.95, cabinLen: 2.6, cabinH: 0.6, cabinX: 0, band: true }),
    bus: busGeom(),
    truck: truckGeom(),
    firetruck: firetruckGeom(),
    ambulance: ambulanceGeom(),
    police: (() => {
      const g = car({ len: 4.4, w: 1.85, bodyH: 0.6, cabinLen: 2.2, cabinH: 0.55, cabinX: -0.1 });
      // Black door panels on both sides + roof light bar (sits on the roof
      // panel, whose top is at y≈1.64 — the bar centre is 1.72).
      for (const pz of [0.935, -0.935]) {
        addTo(g, xlate(plainBox(1.6, 0.5, 0.04, [0.1, 0.1, 0.12]), -0.1, 0.62, pz));
      }
      const red = plainBox(0.5, 0.16, 0.4, RED_LIGHT);
      addTo(g, xlate(red, -0.28, 1.72, 0));
      const blue = plainBox(0.5, 0.16, 0.4, [0.15, 0.3, 0.95]);
      addTo(g, xlate(blue, 0.28, 1.72, 0));
      return g;
    })(),
    supercar: car({ len: 4.3, w: 2.0, bodyH: 0.38, cabinLen: 1.8, cabinH: 0.42, cabinX: -0.2, hoodSlope: 0.22, wing: true }),
    boat: boatGeom({}),
    fishingboat: boatGeom({ fishing: true }),
    sailboat: boatGeom({ sail: true }),
  };
}

// Headlight dots (unlit, drawn only at night): two per vehicle.
export function headlightGeom() {
  return plainBox(0.3, 0.18, 0.12, [1.0, 0.95, 0.7]);
}
