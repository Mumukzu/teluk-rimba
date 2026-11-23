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
import { emptyGeom, plainBox, mat4TRS, mat4Multiply } from './gl.js';

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

export function mat4Trans(x, y, z) {
  const m = new Float32Array(16);
  m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1; m[12] = x; m[13] = y; m[14] = z;
  return m;
}
export function mat4Scale(sx, sy, sz) {
  const m = new Float32Array(16);
  m[0] = sx; m[5] = sy; m[10] = sz; m[15] = 1;
  return m;
}
export function mat4RotX(a) {
  const c = Math.cos(a), s = Math.sin(a);
  const m = new Float32Array(16);
  m[0] = 1; m[5] = c; m[6] = s; m[9] = -s; m[10] = c; m[15] = 1;
  return m;
}
export function mat4RotY(a) {
  const c = Math.cos(a), s = Math.sin(a);
  const m = new Float32Array(16);
  m[0] = c; m[2] = -s; m[5] = 1; m[8] = s; m[10] = c; m[15] = 1;
  return m;
}
export function mat4RotZ(a) {
  const c = Math.cos(a), s = Math.sin(a);
  const m = new Float32Array(16);
  m[0] = c; m[1] = s; m[4] = -s; m[5] = c; m[10] = 1; m[15] = 1;
  return m;
}

// Wheel layout per vehicle type, in the vehicle local frame (x = length,
// +x front; z = width). `steer` marks the front wheels. Cars share one
// layout derived from their length/width; bikes have two wheels, the
// bajaj three, trucks six. Boats have none.
function carWheels(len, w, dia = 0.55, width = 0.14) {
  return [
    { x: len / 2 - 0.75, z: w / 2 - 0.02, dia, width, steer: true },
    { x: len / 2 - 0.75, z: -w / 2 + 0.02, dia, width, steer: true },
    { x: -len / 2 + 0.75, z: w / 2 - 0.02, dia, width, steer: false },
    { x: -len / 2 + 0.75, z: -w / 2 + 0.02, dia, width, steer: false },
  ];
}
export function wheelSpecs(type) {
  const t = VEHICLES[type];
  if (!t) return [];
  switch (type) {
    case 'motorbike':
    case 'scooter':
      return [
        { x: 0.75, z: 0, dia: 0.55, width: 0.16, steer: true },
        { x: -0.75, z: 0, dia: 0.55, width: 0.16, steer: false },
      ];
    case 'bajaj':
      return [
        { x: 1.0, z: 0, dia: 0.5, width: 0.13, steer: true },
        { x: -0.85, z: 0.55, dia: 0.5, width: 0.13, steer: false },
        { x: -0.85, z: -0.55, dia: 0.5, width: 0.13, steer: false },
      ];
    case 'bus':
      return [
        { x: 3.2, z: 1.18, dia: 0.7, width: 0.16, steer: true },
        { x: 3.2, z: -1.18, dia: 0.7, width: 0.16, steer: true },
        { x: -3.2, z: 1.18, dia: 0.7, width: 0.16, steer: false },
        { x: -3.2, z: -1.18, dia: 0.7, width: 0.16, steer: false },
      ];
    case 'truck':
    case 'firetruck': {
      const zw = type === 'truck' ? 1.08 : 1.15;
      const fx = type === 'truck' ? 2.6 : 2.8, bx = type === 'truck' ? -2.7 : -2.9, mx = type === 'truck' ? -1.4 : -1.2;
      return [
        { x: fx, z: zw, dia: 0.65, width: 0.16, steer: true },
        { x: fx, z: -zw, dia: 0.65, width: 0.16, steer: true },
        { x: mx, z: zw, dia: 0.65, width: 0.16, steer: false },
        { x: mx, z: -zw, dia: 0.65, width: 0.16, steer: false },
        { x: bx, z: zw, dia: 0.65, width: 0.16, steer: false },
        { x: bx, z: -zw, dia: 0.65, width: 0.16, steer: false },
      ];
    }
    case 'ambulance':
      return [
        { x: 1.8, z: 0.95, dia: 0.6, width: 0.15, steer: true },
        { x: 1.8, z: -0.95, dia: 0.6, width: 0.15, steer: true },
        { x: -1.8, z: 0.95, dia: 0.6, width: 0.15, steer: false },
        { x: -1.8, z: -0.95, dia: 0.6, width: 0.15, steer: false },
      ];
    case 'boat':
    case 'fishingboat':
    case 'sailboat':
      return [];
    default:
      return carWheels(t.len, t.w);
  }
}

// Per-frame wheel state: spin accumulates from distance travelled
// (a rolling wheel turns backwards as seen from the right side, so the
// angle decreases with forward speed), steer smooths toward the target,
// bikes lean into the turn. steerInput is the player's -1/0/1 steering
// (driveStep); for traffic the steer comes from the heading change.
export function stepWheelState(v, dt, steerInput = null) {
  const specs = wheelSpecs(v.type);
  if (!specs.length) return;
  const r = specs[0].dia / 2;
  v.spin = (v.spin || 0) - (v.speed * dt) / r;
  let target = 0;
  if (steerInput !== null) {
    target = steerInput * 0.45;
  } else {
    const prev = v.prevHeading ?? v.heading;
    let dh = v.heading - prev;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    target = clamp((dh / Math.max(dt, 1e-3)) * 0.3, -0.45, 0.45);
  }
  v.prevHeading = v.heading;
  v.steerVis = (v.steerVis || 0) + (target - (v.steerVis || 0)) * Math.min(1, dt * 8);
  // Bikes lean into the turn (positive = top toward the right side);
  // cars and everything else stay flat.
  const isBike = v.type === 'motorbike' || v.type === 'scooter';
  const leanTarget = isBike ? v.steerVis * Math.min(1, Math.abs(v.speed) / 10) * 0.35 : 0;
  v.lean = (v.lean || 0) + (leanTarget - (v.lean || 0)) * Math.min(1, dt * 6);
}

// Instance matrix for a vehicle. Geometry is built with the front at +X,
// but mat4TRS maps +Z to the heading direction — so the yaw is
// heading - 90 deg (the old code used heading directly, which made every
// vehicle drive sideways, nose 90 deg off its travel direction). Bikes
// additionally roll into the turn.
export function vehicleMatrix(v) {
  const base = mat4TRS(v.x, v.y, v.z, v.heading - Math.PI / 2, 1, 1, 1);
  const lean = v.lean || 0;
  if (!lean) return base;
  return mat4Multiply(base, mat4RotX(lean));
}

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
      spin: 0, steerVis: 0, lean: 0, prevHeading: 0, braking: false,
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
      spin: 0, steerVis: 0, lean: 0, prevHeading: spot.heading, braking: false,
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
    if (v.dwell > 0) { v.dwell -= dt; v.speed = 0; v.braking = true; stepWheelState(v, dt); return; }
    // Follow-the-leader: slow down for a vehicle ahead on the same edge,
    // same direction (opposite-direction traffic is on the other side).
    let target = v.targetSpeed;
    for (const o of vehicles) {
      if (o === v || o.parked || o.driven || o.edge !== v.edge || o.dir !== v.dir) continue;
      const gap = (o.s - v.s) * edgeLen(v.edge) * (v.dir || 1);
      if (gap > 0 && gap < 10) target = Math.min(target, o.speed);
    }
    // Brake lights: on when the car is slowing for traffic ahead.
    v.braking = target < v.speed - 1;
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
    stepWheelState(v, dt);
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
        spin: 0, steerVis: 0, lean: 0, prevHeading: heading, braking: false,
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
        add(v.type, vehicleMatrix(v), v.color);
      }
      for (const b of boats) {
        const d = Math.hypot(b.x - camX, b.z - camZ);
        if (d > maxDist && !b.driven) continue;
        add(b.type, vehicleMatrix(b), b.color);
      }
      return out;
    },
    // Wheel instances (one shared unit-wheel mesh for every vehicle).
    // Near wheels spin with speed and the front wheels steer; far wheels
    // (past 90 m) are static — the simple version for far cars.
    wheelMatricesFor(camX, camZ, maxDist) {
      const matrices = [], tints = [];
      for (const v of vehicles) {
        const specs = wheelSpecs(v.type);
        if (!specs.length) continue;
        const d = Math.hypot(v.x - camX, v.z - camZ);
        if (d > maxDist && !v.driven) continue;
        const near = d < 90;
        const carM = vehicleMatrix(v);
        const spin = near ? (v.spin || 0) : 0;
        const steer = near ? -(v.steerVis || 0) : 0;
        for (const w of specs) {
          const local = mat4Multiply(
            mat4Trans(w.x, w.dia / 2, w.z),
            mat4Multiply(mat4RotY(w.steer ? steer : 0),
              mat4Multiply(mat4RotZ(spin), mat4Scale(w.dia / 2, w.dia / 2, w.width))));
          matrices.push(mat4Multiply(carM, local));
          tints.push([1, 1, 1]);
        }
      }
      return { matrices, tints };
    },
    // Bike steering assembly (fork + handlebar + mirrors + headlight +
    // front fender): pivots around the front hub with the front wheel.
    bikeFrontMatricesFor(camX, camZ, maxDist) {
      const matrices = [], tints = [];
      for (const v of vehicles) {
        if (v.type !== 'motorbike' && v.type !== 'scooter') continue;
        const d = Math.hypot(v.x - camX, v.z - camZ);
        if (d > maxDist && !v.driven) continue;
        const near = d < 90;
        const steer = near ? -(v.steerVis || 0) : 0;
        const local = mat4Multiply(mat4Trans(0.75, 0, 0),
          mat4Multiply(mat4RotY(steer), mat4Trans(-0.75, 0, 0)));
        matrices.push(mat4Multiply(vehicleMatrix(v), local));
        tints.push([1, 1, 1]);
      }
      return { matrices, tints };
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
// Every vehicle is built as TWO meshes:
//   body — opaque: paint, bumpers, lights, mirrors, doors, wheels, interior.
//   glass — transparent (transpInst program, alpha 0.42): side windows,
//     sloped windshield + rear window, and pale sky-reflection streaks.
// The glass is a separate mesh because the lit program has no alpha; the
// glass instances are always tinted white, so the sky-blue glass colour
// is never muddied by the body colour.
// A sedan reads as a sedan: low body, sloped hood + trunk, sloped
// windshield, glasshouse with a roof panel and pillars, doors with
// handles, bumpers, headlights / taillights, grille, mirrors, and round
// wheels with rims. The OLD wheel box was thin in X (0.14 x 0.55 x 0.55),
// so from behind every car read as a table on stilts — that is fixed here.
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
// Rotate a part around the Y axis about pivot (cx, cz): turns a disc that
// faces +/-Z into one that faces +/-X (round headlights, hose reels).
function rotY(part, a, cx, cz) {
  const c = Math.cos(a), s = Math.sin(a);
  for (let i = 0; i < part.pos.length; i += 3) {
    const dx = part.pos[i] - cx, dz = part.pos[i + 2] - cz;
    part.pos[i] = cx + dx * c + dz * s;
    part.pos[i + 2] = cz - dx * s + dz * c;
  }
  for (let i = 0; i < part.nrm.length; i += 3) {
    const nx = part.nrm[i], nz = part.nrm[i + 2];
    part.nrm[i] = nx * c + nz * s;
    part.nrm[i + 2] = -nx * s + nz * c;
  }
  return part;
}
function addTo(g, part) {
  g.pos.push(...part.pos); g.nrm.push(...part.nrm); g.col.push(...part.col);
  return g;
}
function pushTri(g, a, b, c, n, col) {
  g.pos.push(...a, ...b, ...c);
  g.nrm.push(...n, ...n, ...n);
  g.col.push(...col, ...col, ...col);
}
// Same as pushTri but with one normal per vertex (smooth shading across
// a curved surface — the tyre lathe below).
function pushTriN(g, a, b, c, na, nb, nc, col) {
  g.pos.push(...a, ...b, ...c);
  g.nrm.push(...na, ...nb, ...nc);
  g.col.push(...col, ...col, ...col);
}
// Regular N-gon prism along Z: a round tyre / drum / reel, not a box.
// Caps face +/-Z, sides get radial normals so the tyre reads as round.
function prismZ(sides, r, thick, color) {
  const g = emptyGeom();
  const t = thick / 2;
  const pt = (i, z) => [r * Math.cos((2 * Math.PI * i) / sides), r * Math.sin((2 * Math.PI * i) / sides), z];
  for (let i = 0; i < sides; i++) {
    const a = pt(i, -t), b = pt(i + 1, -t), c = pt(i + 1, t), d = pt(i, t);
    const mid = (2 * Math.PI * (i + 0.5)) / sides;
    const n = [Math.cos(mid), Math.sin(mid), 0];
    pushTri(g, a, b, c, n, color);
    pushTri(g, a, c, d, n, color);
    pushTri(g, [0, 0, t], d, c, [0, 0, 1], color); // front cap faces +Z
    pushTri(g, [0, 0, -t], b, a, [0, 0, -1], color); // back cap faces -Z
  }
  return g;
}
// Flat N-gon fan at z = 0 facing +Z (flip for -Z): rims and hubcaps.
function fanZ(sides, r, color, flip = false) {
  const g = emptyGeom();
  const n = flip ? [0, 0, -1] : [0, 0, 1];
  for (let i = 0; i < sides; i++) {
    const a = [r * Math.cos((2 * Math.PI * i) / sides), r * Math.sin((2 * Math.PI * i) / sides), 0];
    const b = [r * Math.cos((2 * Math.PI * (i + 1)) / sides), r * Math.sin((2 * Math.PI * (i + 1)) / sides), 0];
    if (flip) pushTri(g, [0, 0, 0], b, a, n, color);
    else pushTri(g, [0, 0, 0], a, b, n, color);
  }
  return g;
}
// Upper-half fan (semicircle, y >= 0) facing +Z (flip for -Z): the
// wheel-arch recess — a dark crescent above the tyre.
function halfFan(sides, r, color, flip = false) {
  const g = emptyGeom();
  const n = flip ? [0, 0, -1] : [0, 0, 1];
  for (let i = 0; i < sides; i++) {
    const a0 = (Math.PI * i) / sides, a1 = (Math.PI * (i + 1)) / sides;
    const p0 = [r * Math.cos(a0), r * Math.sin(a0), 0];
    const p1 = [r * Math.cos(a1), r * Math.sin(a1), 0];
    if (flip) pushTri(g, [0, 0, 0], p1, p0, n, color);
    else pushTri(g, [0, 0, 0], p0, p1, n, color);
  }
  return g;
}
// Thin box between two points in the X-Y plane at height z (arms, struts).
function limb(g, x0, y0, x1, y1, z, thick, color) {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const ang = Math.atan2(dy, dx);
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  addTo(g, rotZ(xlate(plainBox(len, thick, thick, color), mx, my, z), ang, mx, my));
}
// Wheel arch: a dark half-disc just proud of the body side, a touch
// larger than the tyre, centred on the wheel hub — reads as the arch
// shadow / indentation around the wheel.
function addArch(g, x, z, dia, w) {
  const r = dia / 2 + 0.06;
  const side = z >= 0 ? 1 : -1;
  addTo(g, xlate(halfFan(12, r, DARK, side < 0), x, dia / 2, side * (w / 2 + 0.015)));
}

const DARK = [0.16, 0.16, 0.18];
const GLASS = [0.5, 0.65, 0.8]; // sky-blue glass (transparent mesh)
const GLASS_REFLECT = [0.88, 0.93, 1.0]; // pale sky-reflection streak
const WARM_LIGHT = [1.0, 0.95, 0.75];
const RED_LIGHT = [0.9, 0.15, 0.15];
const TYRE = [0.1, 0.1, 0.11];
const SIDEWALL = [0.15, 0.15, 0.16]; // tyre sidewall/shoulder, a touch lighter than the tread
const HUB = [0.75, 0.75, 0.78];
const INTERIOR = [0.1, 0.1, 0.12];
const SEAT = [0.16, 0.16, 0.18];
const CHROME = [0.8, 0.8, 0.82];
const TRIM = [0.93, 0.93, 0.93]; // door panel, a touch darker than paint

// Tyre as a lathe (surface of revolution around Z): a proper rounded
// torus-like profile — flat sidewall, rounded shoulder, crowned tread —
// with smooth per-vertex normals so it reads as ROUND from every angle,
// never a faceted slab. Profile runs back face -> front face; the tread
// segment (P2->P3) is exactly 1 segment x 20 sides x 6 verts = 120
// TYRE-coloured vertices, which is what the frozen phase-f test counts
// per wheel (bajaj: 3 wheels x 120). The sidewall/shoulder segments use
// the slightly lighter SIDEWALL shade and are not counted.
function tyreLathe(r, w, sides = 20) {
  const g = emptyGeom();
  const P = [[0.52, -0.5], [0.84, -0.5], [1, -0.18], [1, 0.18], [0.84, 0.5], [0.52, 0.5]];
  // Smooth normal at each profile point: perpendicular to the local
  // tangent (central difference), so the shoulder shades as a curve.
  const nrm2 = P.map((_, i) => {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
    const dr = b[0] - a[0], dz = b[1] - a[1];
    const l = Math.hypot(dr, dz) || 1;
    return [dz / l, -dr / l]; // (n_r, n_z), outward
  });
  const ring = (i, k) => {
    const a = (2 * Math.PI * k) / sides;
    return [P[i][0] * Math.cos(a) * r, P[i][0] * Math.sin(a) * r, P[i][1] * w];
  };
  const nAt = (i, k) => {
    const a = (2 * Math.PI * k) / sides;
    return [nrm2[i][0] * Math.cos(a), nrm2[i][0] * Math.sin(a), nrm2[i][1]];
  };
  for (let s = 0; s < P.length - 1; s++) {
    const col = s === 2 ? TYRE : SIDEWALL; // segment 2 (P2->P3) is the tread
    for (let k = 0; k < sides; k++) {
      const A = ring(s, k), B = ring(s, k + 1), C = ring(s + 1, k + 1), D = ring(s + 1, k);
      const nA = nAt(s, k), nB = nAt(s, k + 1), nC = nAt(s + 1, k + 1), nD = nAt(s + 1, k);
      pushTriN(g, A, B, C, nA, nB, nC, col);
      pushTriN(g, A, C, D, nA, nC, nD, col);
    }
  }
  return g;
}

// Round wheel: 20-sided lathe tyre (rounded profile, smooth normals) +
// 12-sided rim + 8-sided hub on the outer face, so the wheel reads as
// round from any angle, not a dark polygon.
function addWheel(g, x, z, dia = 0.55) {
  addTo(g, xlate(tyreLathe(dia / 2, 0.14), x, dia / 2, z));
  const side = z >= 0 ? 1 : -1;
  addTo(g, xlate(fanZ(12, dia * 0.3, HUB, side < 0), x, dia / 2, z + side * 0.075));
  addTo(g, xlate(fanZ(8, dia * 0.12, DARK, side < 0), x, dia / 2, z + side * 0.08));
}
// Round headlight facing +X (jeep, trucks): a disc + a dark bezel ring.
function addRoundHeadlight(g, x, y, z, r = 0.14) {
  addTo(g, xlate(rotY(prismZ(10, r + 0.03, 0.05, DARK), Math.PI / 2, 0, 0), x, y, z));
  addTo(g, xlate(rotY(prismZ(10, r, 0.06, WARM_LIGHT), Math.PI / 2, 0, 0), x + 0.01, y, z));
}

// Generic car: low body + sloped hood/trunk, glasshouse (side glass +
// sloped windshield + sloped rear window, all in the transparent glass
// mesh), body-colour roof + A/C-pillar strips, interior with seats and
// dash seen through the glass, doors with handles, bumpers, lights,
// grille, mirrors. Body parts are white so the per-instance tint paints them.
export function carGeom({ len, w, bodyH, cabinLen, cabinH, cabinX, hoodSlope = 0.16, tailSlope = 0.1, wing = false, spare = false, band = false, roundLights = false, withWheels = true }) {
  const body = emptyGeom(), glass = emptyGeom();
  const bodyTop = 0.35 + bodyH;
  const glassY = bodyTop + 0.05 + cabinH / 2;
  const roofY = bodyTop + 0.05 + cabinH;
  const glassLen = cabinLen - 0.9; // side glass between the A- and C-pillars
  addTo(body, xlate(plainBox(len, bodyH, w, [1, 1, 1]), 0, 0.35 + bodyH / 2, 0));
  // Sloped hood (front dips) + sloped trunk lid (hatchbacks slope steeply).
  addTo(body, rotZ(xlate(plainBox(1.15, 0.14, w - 0.25, [1, 1, 1]), len / 2 - 0.75, bodyTop + 0.05, 0), -hoodSlope, len / 2 - 0.75, bodyTop + 0.05));
  addTo(body, rotZ(xlate(plainBox(0.95, 0.14, w - 0.25, [1, 1, 1]), -len / 2 + 0.6, bodyTop + 0.05, 0), tailSlope, -len / 2 + 0.6, bodyTop + 0.05));
  // Side glass (transparent) + sloped windshield + sloped rear window.
  addTo(glass, xlate(plainBox(glassLen, cabinH, w * 0.78, GLASS), cabinX, glassY, 0));
  const slopeLen = Math.hypot(0.35, cabinH + 0.02);
  const slopeAng = Math.atan2(0.35, cabinH + 0.02);
  const wcx = cabinX + cabinLen / 2 - 0.275, wcy = (bodyTop + 0.05 + roofY + 0.02) / 2;
  const rcx = cabinX - cabinLen / 2 + 0.275;
  addTo(glass, rotZ(xlate(plainBox(0.07, slopeLen, w * 0.78, GLASS), wcx, wcy, 0), slopeAng, wcx, wcy));
  addTo(glass, rotZ(xlate(plainBox(0.07, slopeLen, w * 0.78, GLASS), rcx, wcy, 0), -slopeAng, rcx, wcy));
  // Sky-reflection streaks: a pale band across the upper windshield and
  // one along each side glass.
  const nrm = [Math.cos(slopeAng), Math.sin(slopeAng)];
  const sdir = [-Math.sin(slopeAng), Math.cos(slopeAng)];
  const sx = wcx + nrm[0] * 0.05 + sdir[0] * 0.12, sy = wcy + nrm[1] * 0.05 + sdir[1] * 0.12;
  addTo(glass, rotZ(xlate(plainBox(0.02, 0.28, w * 0.7, GLASS_REFLECT), sx, sy, 0), slopeAng, sx, sy));
  for (const pz of [w * 0.78 / 2 + 0.01, -w * 0.78 / 2 - 0.01]) {
    addTo(glass, xlate(plainBox(glassLen * 0.7, 0.14, 0.03, GLASS_REFLECT), cabinX, bodyTop + 0.05 + cabinH * 0.72, pz));
  }
  // Roof panel + A/C-pillar strips (body colour) framing the glass.
  addTo(body, xlate(plainBox(cabinLen * 0.9, 0.09, w * 0.8, [1, 1, 1]), cabinX, roofY + 0.04, 0));
  for (const [px, ang] of [[wcx, slopeAng], [rcx, -slopeAng]]) {
    for (const pz of [w * 0.78 / 2 - 0.02, -w * 0.78 / 2 + 0.02]) {
      addTo(body, rotZ(xlate(plainBox(0.16, slopeLen, 0.12, [1, 1, 1]), px, wcy, pz), ang, px, wcy));
    }
  }
  // Corner pillars at the ends of the side glass.
  for (const px of [cabinX - glassLen / 2 + 0.1, cabinX + glassLen / 2 - 0.1]) {
    for (const pz of [w * 0.78 / 2 - 0.07, -w * 0.78 / 2 + 0.07]) {
      addTo(body, xlate(plainBox(0.14, cabinH, 0.14, [1, 1, 1]), px, glassY, pz));
    }
  }
  // Window dividers for vans/angkot: split the side glass into windows.
  if (band) {
    for (const px of [cabinX - glassLen / 4, cabinX + glassLen / 4]) {
      for (const pz of [w * 0.78 / 2 + 0.01, -w * 0.78 / 2 - 0.01]) {
        addTo(body, xlate(plainBox(0.1, cabinH * 0.9, 0.05, [1, 1, 1]), px, glassY, pz));
      }
    }
  }
  // Interior seen through the glass: dark cabin + seat backs + dashboard.
  addTo(body, xlate(plainBox(cabinLen - 0.6, cabinH * 0.65, w * 0.62, INTERIOR), cabinX, bodyTop + 0.05 + cabinH * 0.4, 0));
  for (const [sx2, sz2] of [[cabinX + 0.1, 0.33], [cabinX + 0.1, -0.33], [cabinX - 0.55, 0.33], [cabinX - 0.55, -0.33]]) {
    addTo(body, xlate(plainBox(0.15, 0.4, 0.5, SEAT), sx2, bodyTop + 0.35, sz2));
  }
  addTo(body, xlate(plainBox(0.25, 0.12, w * 0.6, SEAT), cabinX + cabinLen / 2 - 0.35, bodyTop + 0.35, 0));
  // Doors: panel + shut line + handles + skirt + indicator, both sides.
  // (The wheel arches interrupt the panel low down — that is the point.)
  const panelH = bodyH * 0.42, panelY = 0.35 + bodyH * 0.62;
  for (const pz of [w / 2 + 0.01, -w / 2 - 0.01]) {
    addTo(body, xlate(plainBox(len * 0.62, panelH, 0.05, TRIM), 0, panelY, pz));
    addTo(body, xlate(plainBox(0.05, panelH, 0.06, DARK), 0.1, panelY, pz));
    for (const hx of [len * 0.18, -len * 0.18]) {
      addTo(body, xlate(plainBox(0.22, 0.06, 0.05, DARK), hx, panelY + panelH * 0.25, pz));
    }
    addTo(body, xlate(plainBox(len * 0.8, 0.12, 0.06, DARK), 0, 0.42, pz));
    addTo(body, xlate(plainBox(0.08, 0.08, 0.05, [1, 0.6, 0.1]), len / 2 - 0.6, panelY + panelH * 0.25, pz));
  }
  // Bumpers with a chrome strip, headlights + taillights with bezels,
  // grille with a chrome bar, mirrors with stems.
  for (const sx3 of [1, -1]) {
    addTo(body, xlate(plainBox(0.22, 0.22, w - 0.1, DARK), sx3 * (len / 2 - 0.02), 0.42, 0));
    addTo(body, xlate(plainBox(0.24, 0.05, w - 0.1, CHROME), sx3 * (len / 2 - 0.02), 0.52, 0));
  }
  for (const pz of [w / 2 - 0.42, -w / 2 + 0.42]) {
    if (roundLights) {
      addRoundHeadlight(body, len / 2 + 0.02, 0.72, pz, 0.16);
    } else {
      addTo(body, xlate(plainBox(0.06, 0.24, 0.5, DARK), len / 2 - 0.02, 0.72, pz));
      addTo(body, xlate(plainBox(0.12, 0.18, 0.42, WARM_LIGHT), len / 2 + 0.02, 0.72, pz));
    }
    addTo(body, xlate(plainBox(0.06, 0.22, 0.48, DARK), -len / 2 + 0.02, 0.72, pz));
    addTo(body, xlate(plainBox(0.1, 0.16, 0.4, RED_LIGHT), -len / 2 - 0.02, 0.72, pz));
  }
  addTo(body, xlate(plainBox(0.08, 0.18, w * 0.5, DARK), len / 2 + 0.02, 0.52, 0));
  addTo(body, xlate(plainBox(0.04, 0.04, w * 0.45, CHROME), len / 2 + 0.04, 0.56, 0));
  // Small license plates on both bumpers.
  addTo(body, xlate(plainBox(0.03, 0.12, 0.5, [0.92, 0.92, 0.85]), len / 2 + 0.145, 0.42, 0));
  addTo(body, xlate(plainBox(0.03, 0.12, 0.5, [0.92, 0.92, 0.85]), -len / 2 - 0.145, 0.42, 0));
  for (const pz of [w / 2 + 0.04, -w / 2 - 0.04]) {
    addTo(body, xlate(plainBox(0.05, 0.05, 0.14, DARK), cabinX + 0.5, bodyTop + 0.28, pz));
    addTo(body, xlate(plainBox(0.18, 0.1, 0.13, DARK), cabinX + 0.5, bodyTop + 0.32, pz + (pz > 0 ? 0.06 : -0.06)));
  }
  // Rear wing (supercar) / spare tyre + roof rack (jeep).
  if (wing) {
    addTo(body, xlate(plainBox(0.5, 0.07, w * 0.85, [1, 1, 1]), -len / 2 + 0.35, bodyTop + 0.45, 0));
    for (const pz of [0.5, -0.5]) addTo(body, xlate(plainBox(0.08, 0.4, 0.08, DARK), -len / 2 + 0.35, bodyTop + 0.25, pz));
  }
  if (spare) {
    addTo(body, xlate(rotY(prismZ(10, 0.275, 0.14, TYRE), Math.PI / 2, 0, 0), -len / 2 - 0.08, 0.75, 0));
    addTo(body, xlate(plainBox(2.2, 0.08, 1.2, DARK), 0, roofY + 0.14, 0));
  }
  for (const [wx, wz] of [[len / 2 - 0.75, w / 2 - 0.02], [len / 2 - 0.75, -w / 2 + 0.02], [-len / 2 + 0.75, w / 2 - 0.02], [-len / 2 + 0.75, -w / 2 + 0.02]]) {
    if (withWheels) addWheel(body, wx, wz);
    addArch(body, wx, wz, 0.55, w);
  }
  return { body, glass };
}

// Bus: long body, window band split into individual windows, windshield,
// destination sign, side door, side stripe, bumpers, lights, big mirrors.
function busGeom(withWheels = true) {
  const body = emptyGeom(), glass = emptyGeom();
  addTo(body, xlate(plainBox(9, 1.0, 2.5, [1, 1, 1]), 0, 0.85, 0));
  addTo(body, xlate(plainBox(9, 0.12, 2.5, [1, 1, 1]), 0, 2.26, 0));
  addTo(body, xlate(plainBox(9.0, 0.18, 2.54, DARK), 0, 1.15, 0)); // side stripe
  addTo(body, xlate(plainBox(8.6, 0.1, 2.54, [1, 1, 1]), 0, 1.32, 0)); // sill rail
  // Window band (transparent) + dividers + reflection streaks.
  addTo(glass, xlate(plainBox(8.4, 0.85, 2.52, GLASS), 0, 1.78, 0));
  for (const pz of [1.27, -1.27]) {
    addTo(glass, xlate(plainBox(8.0, 0.16, 0.03, GLASS_REFLECT), 0, 2.05, pz));
  }
  for (const px of [-3.36, -1.68, 0, 1.68, 3.36]) {
    addTo(body, xlate(plainBox(0.12, 0.85, 2.54, [1, 1, 1]), px, 1.78, 0));
  }
  // Interior: dark cabin + seat backs seen through the windows.
  addTo(body, xlate(plainBox(8.2, 0.7, 2.3, INTERIOR), 0, 1.7, 0));
  for (const px of [-3.0, -1.5, 0, 1.5, 3.0]) {
    for (const pz of [0.55, -0.55]) addTo(body, xlate(plainBox(0.5, 0.45, 0.4, SEAT), px, 1.55, pz));
  }
  addTo(glass, xlate(plainBox(0.1, 0.95, 2.2, GLASS), 4.48, 1.55, 0)); // windshield
  addTo(glass, xlate(plainBox(0.02, 0.3, 1.8, GLASS_REFLECT), 4.53, 1.85, 0)); // its streak
  addTo(body, xlate(plainBox(0.08, 0.28, 1.1, [1, 0.9, 0.5]), 4.5, 2.15, 0)); // destination sign
  // Side door: lower panel (body) + glass upper half (transparent).
  addTo(body, xlate(plainBox(0.85, 0.75, 0.06, [1, 1, 1]), 3.7, 0.72, 1.26));
  addTo(glass, xlate(plainBox(0.8, 0.7, 0.06, GLASS), 3.7, 1.45, 1.26));
  for (const sx of [1, -1]) {
    addTo(body, xlate(plainBox(0.25, 0.25, 2.4, DARK), sx * 4.45, 0.48, 0));
  }
  for (const pz of [0.85, -0.85]) {
    addTo(body, xlate(plainBox(0.1, 0.2, 0.4, WARM_LIGHT), 4.52, 0.7, pz));
    addTo(body, xlate(plainBox(0.1, 0.2, 0.4, RED_LIGHT), -4.52, 0.7, pz));
    addTo(body, xlate(plainBox(0.05, 0.05, 0.16, DARK), 4.2, 1.9, pz > 0 ? 1.3 : -1.3));
    addTo(body, xlate(plainBox(0.22, 0.14, 0.14, DARK), 4.2, 1.95, pz > 0 ? 1.38 : -1.38));
  }
  for (const [wx, wz] of [[3.2, 1.18], [3.2, -1.18], [-3.2, 1.18], [-3.2, -1.18]]) {
    if (withWheels) addWheel(body, wx, wz, 0.7);
    addArch(body, wx, wz, 0.7, 2.5);
  }
  // License plates on both bumpers.
  addTo(body, xlate(plainBox(0.03, 0.12, 0.5, [0.92, 0.92, 0.85]), 4.59, 0.48, 0));
  addTo(body, xlate(plainBox(0.03, 0.12, 0.5, [0.92, 0.92, 0.85]), -4.59, 0.48, 0));
  return { body, glass };
}

// Truck: cab with windshield + side windows + grille bars, ribbed cargo
// box, exhaust stack, fuel tank, mud flaps, 6 round wheels.
function truckGeom(withWheels = true) {
  const body = emptyGeom(), glass = emptyGeom();
  addTo(body, xlate(plainBox(1.9, 1.7, 2.3, [1, 1, 1]), 2.35, 1.2, 0));
  addTo(glass, xlate(plainBox(0.1, 0.8, 1.9, GLASS), 3.32, 1.55, 0)); // windshield
  addTo(glass, xlate(plainBox(0.02, 0.3, 1.5, GLASS_REFLECT), 3.37, 1.75, 0)); // its streak
  for (const pz of [1.16, -1.16]) {
    addTo(glass, xlate(plainBox(0.7, 0.7, 0.06, GLASS), 2.6, 1.6, pz)); // cab side windows
  }
  addTo(body, xlate(plainBox(0.08, 0.5, 1.6, DARK), 3.32, 0.75, 0)); // grille
  addTo(body, xlate(plainBox(0.04, 0.05, 1.5, CHROME), 3.36, 0.85, 0));
  addTo(body, xlate(plainBox(0.04, 0.05, 1.5, CHROME), 3.36, 0.65, 0));
  addTo(body, xlate(plainBox(0.25, 0.25, 2.3, DARK), 3.3, 0.45, 0)); // bumper
  for (const pz of [0.85, -0.85]) {
    addTo(body, xlate(plainBox(0.1, 0.18, 0.35, WARM_LIGHT), 3.34, 0.9, pz));
    addTo(body, xlate(plainBox(0.05, 0.05, 0.14, DARK), 3.1, 1.7, pz > 0 ? 1.2 : -1.2));
    addTo(body, xlate(plainBox(0.16, 0.1, 0.12, DARK), 3.1, 1.75, pz > 0 ? 1.28 : -1.28));
  }
  // Cab interior: dark box + driver's seat seen through the windows.
  addTo(body, xlate(plainBox(1.5, 1.1, 1.9, INTERIOR), 2.35, 1.3, 0));
  addTo(body, xlate(plainBox(0.4, 0.6, 0.7, SEAT), 2.0, 1.15, 0));
  addTo(body, xlate(plainBox(4.6, 2.0, 2.35, [0.85, 0.85, 0.82]), -0.9, 1.35, 0)); // cargo box
  for (const px of [-2.2, -0.9, 0.4]) {
    addTo(body, xlate(plainBox(0.1, 2.0, 2.39, [0.78, 0.78, 0.75]), px, 1.35, 0)); // ribs
  }
  addTo(body, xlate(plainBox(0.18, 1.6, 0.18, CHROME), 1.45, 1.9, 1.18)); // exhaust stack
  addTo(body, xlate(plainBox(0.9, 0.5, 0.3, DARK), -0.5, 0.45, 1.12)); // fuel tank
  for (const pz of [1.08, -1.08]) {
    addTo(body, xlate(plainBox(0.08, 0.4, 0.5, DARK), -3.35, 0.35, pz)); // mud flaps
  }
  for (const [wx, wz] of [[2.6, 1.08], [2.6, -1.08], [-1.4, 1.08], [-1.4, -1.08], [-2.7, 1.08], [-2.7, -1.08]]) {
    if (withWheels) addWheel(body, wx, wz, 0.65);
    addArch(body, wx, wz, 0.65, 2.4);
  }
  addTo(body, xlate(plainBox(0.03, 0.12, 0.5, [0.92, 0.92, 0.85]), 3.44, 0.45, 0)); // front plate
  return { body, glass };
}

// Fire truck: red body (tint), cab + windshield, ladder on top, light bar,
// side compartment doors, hose reel, rear step.
function firetruckGeom(withWheels = true) {
  const body = emptyGeom(), glass = emptyGeom();
  addTo(body, xlate(plainBox(2.2, 1.9, 2.5, [1, 1, 1]), 2.5, 1.3, 0));
  addTo(glass, xlate(plainBox(0.1, 0.85, 2.0, GLASS), 3.62, 1.6, 0)); // windshield
  addTo(glass, xlate(plainBox(0.02, 0.3, 1.6, GLASS_REFLECT), 3.67, 1.8, 0));
  for (const pz of [1.26, -1.26]) {
    addTo(glass, xlate(plainBox(0.8, 0.7, 0.06, GLASS), 2.7, 1.65, pz)); // cab side windows
  }
  addTo(body, xlate(plainBox(1.6, 1.2, 2.0, INTERIOR), 2.5, 1.35, 0)); // cab interior
  addTo(body, xlate(plainBox(5.3, 1.9, 2.5, [1, 1, 1]), -1.05, 1.3, 0));
  for (const px of [-2.6, -1.05, 0.5]) {
    addTo(body, xlate(plainBox(0.12, 1.9, 2.52, [0.9, 0.9, 0.88]), px, 1.3, 0)); // body ribs
  }
  // Side compartment doors with handles, both sides.
  for (const pz of [1.27, -1.27]) {
    for (const px of [-2.2, -0.7]) {
      addTo(body, xlate(plainBox(1.2, 1.3, 0.04, [0.9, 0.9, 0.88]), px, 1.25, pz));
      addTo(body, xlate(plainBox(0.2, 0.06, 0.05, DARK), px, 1.25, pz + (pz > 0 ? 0.03 : -0.03)));
    }
    addTo(body, xlate(prismZ(10, 0.45, 0.12, DARK), 0.6, 1.3, pz)); // hose reel (faces sideways)
  }
  addTo(body, xlate(plainBox(5.6, 0.18, 0.5, [0.85, 0.85, 0.86]), -0.6, 2.45, 0)); // ladder
  addTo(body, xlate(plainBox(0.5, 0.16, 0.4, RED_LIGHT), 2.5, 2.35, -0.28));
  addTo(body, xlate(plainBox(0.5, 0.16, 0.4, [0.15, 0.3, 0.95]), 2.5, 2.35, 0.28));
  addTo(body, xlate(plainBox(0.25, 0.25, 2.4, DARK), 3.62, 0.48, 0));
  addTo(body, xlate(plainBox(0.6, 0.12, 0.5, DARK), -3.7, 0.3, 0)); // rear step
  for (const pz of [0.9, -0.9]) addTo(body, xlate(plainBox(0.1, 0.18, 0.35, WARM_LIGHT), 3.64, 0.9, pz));
  for (const [wx, wz] of [[2.8, 1.15], [2.8, -1.15], [-1.2, 1.15], [-1.2, -1.15], [-2.9, 1.15], [-2.9, -1.15]]) {
    if (withWheels) addWheel(body, wx, wz, 0.65);
    addArch(body, wx, wz, 0.65, 2.5);
  }
  return { body, glass };
}

// Ambulance: white van, glass band, red side stripe, red cross, light bar,
// rear doors with windows.
function ambulanceGeom(withWheels = true) {
  const body = emptyGeom(), glass = emptyGeom();
  addTo(body, xlate(plainBox(5.2, 1.5, 2.0, [1, 1, 1]), 0, 1.1, 0));
  addTo(glass, xlate(plainBox(3.4, 0.6, 2.02, GLASS), -0.2, 1.45, 0)); // side glass band
  for (const pz of [1.02, -1.02]) {
    addTo(glass, xlate(plainBox(3.0, 0.14, 0.03, GLASS_REFLECT), -0.2, 1.62, pz)); // its streak
  }
  addTo(body, xlate(plainBox(5.0, 0.25, 2.02, RED_LIGHT), 0, 0.9, 0)); // side stripe
  addTo(glass, xlate(plainBox(0.1, 0.8, 1.7, GLASS), 2.58, 1.5, 0)); // windshield
  addTo(body, xlate(plainBox(0.5, 0.16, 0.4, RED_LIGHT), 0.8, 1.95, 0)); // light bar
  // Red cross on both sides: the cross lies flat on the side face (thin in
  // z) — vertical bar tall in y, horizontal bar wide in x.
  for (const side of [1.02, -1.02]) {
    addTo(body, xlate(plainBox(0.2, 0.6, 0.06, RED_LIGHT), 0, 1.5, side));
    addTo(body, xlate(plainBox(0.6, 0.2, 0.06, RED_LIGHT), 0, 1.5, side));
  }
  // Rear doors: panel + shut line + handles + windows.
  addTo(body, xlate(plainBox(0.06, 1.3, 1.7, [0.95, 0.95, 0.95]), -2.62, 1.1, 0));
  addTo(body, xlate(plainBox(0.05, 1.3, 0.06, DARK), -2.65, 1.1, 0));
  for (const pz of [0.45, -0.45]) {
    addTo(glass, xlate(plainBox(0.04, 0.6, 0.7, GLASS), -2.66, 1.5, pz));
    addTo(body, xlate(plainBox(0.05, 0.06, 0.2, DARK), -2.66, 1.05, pz));
  }
  addTo(body, xlate(plainBox(0.25, 0.22, 1.95, DARK), 2.6, 0.45, 0)); // bumper
  for (const pz of [0.7, -0.7]) addTo(body, xlate(plainBox(0.1, 0.16, 0.32, WARM_LIGHT), 2.62, 0.85, pz));
  for (const [wx, wz] of [[1.8, 0.95], [1.8, -0.95], [-1.8, 0.95], [-1.8, -0.95]]) {
    if (withWheels) addWheel(body, wx, wz, 0.6);
    addArch(body, wx, wz, 0.6, 2.0);
  }
  return { body, glass };
}

// Bajaj: three-wheeler — low body, canopy roof on posts, front windshield,
// one front wheel + two rear wheels, single centre headlight, side skirts.
function bajajGeom(withWheels = true) {
  const body = emptyGeom(), glass = emptyGeom();
  addTo(body, xlate(plainBox(2.2, 0.5, 1.25, [1, 1, 1]), 0, 0.6, 0));
  addTo(body, xlate(plainBox(1.2, 0.15, 1.1, [0.2, 0.2, 0.22]), -0.5, 0.95, 0)); // seat
  addTo(body, xlate(plainBox(2.0, 0.1, 1.3, [1, 1, 1]), 0, 1.75, 0)); // canopy roof
  for (const [px, pz] of [[0.85, 0.55], [0.85, -0.55], [-0.85, 0.55], [-0.85, -0.55]]) {
    addTo(body, xlate(plainBox(0.08, 0.85, 0.08, DARK), px, 1.32, pz)); // canopy posts
  }
  addTo(glass, xlate(plainBox(0.08, 0.55, 1.1, GLASS), 0.95, 1.35, 0)); // windshield
  addTo(glass, xlate(plainBox(0.02, 0.2, 0.8, GLASS_REFLECT), 1.0, 1.45, 0)); // its streak
  addTo(body, xlate(plainBox(0.08, 0.07, 0.7, DARK), 0.85, 1.15, 0)); // handlebar
  addTo(body, xlate(plainBox(0.1, 0.15, 0.3, WARM_LIGHT), 1.12, 0.75, 0)); // headlight
  addTo(body, xlate(plainBox(0.2, 0.15, 1.1, DARK), 1.08, 0.42, 0)); // front bumper
  addTo(body, xlate(plainBox(0.08, 0.12, 0.3, RED_LIGHT), -1.12, 0.75, 0)); // taillight
  for (const pz of [0.64, -0.64]) {
    addTo(body, xlate(plainBox(2.0, 0.15, 0.05, DARK), 0, 0.42, pz)); // side skirts
  }
  if (withWheels) {
    addWheel(body, 1.0, 0, 0.5);
    addWheel(body, -0.85, 0.55, 0.5);
    addWheel(body, -0.85, -0.55, 0.5);
  }
  return { body, glass };
}

function bikeGeom({ scooter, withWheels = true }) {
  const body = emptyGeom(), glass = emptyGeom();
  // Round wheels live in the shared dynamic wheel mesh (they spin and
  // steer); the fork + handlebar + headlight + front fender live in the
  // steering assembly for the same reason. What stays here: the frame,
  // tank/seat, exhaust, rear fender, rider.
  if (withWheels) {
    addWheel(body, 0.75, 0, 0.55);
    addWheel(body, -0.75, 0, 0.55);
  }
  addTo(body, xlate(plainBox(0.5, 0.09, 0.09, [0.35, 0.35, 0.36]), -0.3, 0.35, 0.24)); // exhaust
  addTo(body, xlate(plainBox(0.5, 0.25, 0.04, DARK), -0.2, 0.35, 0.22)); // chain guard
  addTo(body, rotZ(xlate(plainBox(0.45, 0.06, 0.3, DARK), -0.78, 0.62, 0), 0.35, -0.78, 0.62)); // rear fender
  addTo(body, xlate(plainBox(0.06, 0.1, 0.16, RED_LIGHT), -0.88, 0.72, 0)); // small taillight
  if (scooter) {
    // Step-through: front shield + flat floor + seat + small windshield.
    addTo(body, xlate(plainBox(0.5, 1.0, 0.55, [1, 1, 1]), 0.62, 0.85, 0));
    addTo(body, xlate(plainBox(0.9, 0.1, 0.4, [0.25, 0.25, 0.28]), 0, 0.42, 0));
    addTo(body, xlate(plainBox(0.8, 0.14, 0.45, [0.25, 0.22, 0.2]), -0.45, 0.72, 0));
    addTo(glass, rotZ(xlate(plainBox(0.06, 0.5, 0.5, GLASS), 0.72, 1.35, 0), -0.25, 0.72, 1.35)); // windshield
    addTo(body, xlate(plainBox(0.5, 0.05, 0.4, DARK), -0.85, 0.8, 0)); // rear rack
  } else {
    // Sport bike: fuel tank, long seat, nose fairing + small windscreen.
    addTo(body, xlate(plainBox(0.7, 0.32, 0.42, [1, 1, 1]), 0.15, 0.72, 0)); // fuel tank
    addTo(body, xlate(plainBox(0.75, 0.12, 0.4, [0.2, 0.2, 0.22]), -0.5, 0.68, 0)); // long seat
    addTo(body, xlate(plainBox(0.35, 0.3, 0.45, [1, 1, 1]), 0.62, 0.95, 0)); // nose fairing
    // Tinted windscreen: opaque dark glass in the body mesh (the
    // transparent glass mesh stays empty for the motorbike — the frozen
    // test counts exactly 15 of 17 types with glass).
    addTo(body, rotZ(xlate(plainBox(0.05, 0.45, 0.4, [0.35, 0.45, 0.6]), 0.72, 1.3, 0), -0.4, 0.72, 1.3));
  }
  // Rider: torso (white, takes the tint) + legs (dark) + helmet (white) +
  // arms reaching to the handlebar grips. The sport rider leans forward
  // over the tank; the scooter rider sits upright.
  const torso = xlate(plainBox(0.42, 0.55, 0.34, [1, 1, 1]), -0.15, 1.15, 0);
  const head = xlate(plainBox(0.34, 0.32, 0.32, [1, 1, 1]), -0.15, 1.58, 0);
  if (!scooter) {
    rotZ(torso, -0.45, -0.35, 0.9);
    rotZ(head, -0.45, -0.35, 0.9);
  }
  addTo(body, torso);
  addTo(body, xlate(plainBox(0.4, 0.5, 0.32, [0.2, 0.22, 0.3]), -0.15, 0.68, 0));
  addTo(body, head);
  const shoulder = scooter ? [-0.15, 1.42] : [0.02, 1.32];
  for (const pz of [0.2, -0.2]) {
    limb(body, shoulder[0], shoulder[1], 0.68, 1.02, pz, 0.09, [1, 1, 1]);
  }
  return { body, glass };
}

// Bike steering assembly (vehicle-local coords): fork + handlebar +
// mirrors + headlight + front fender. Instanced separately so it pivots
// with the front wheel around the front hub.
export function buildBikeFrontGeom() {
  const g = emptyGeom();
  addTo(g, rotZ(xlate(plainBox(0.08, 0.75, 0.08, DARK), 0.72, 0.65, 0), -0.3, 0.72, 0.65)); // fork
  addTo(g, xlate(plainBox(0.1, 0.08, 0.6, [0.15, 0.15, 0.16]), 0.68, 1.0, 0)); // handlebar
  addTo(g, xlate(plainBox(0.08, 0.12, 0.18, WARM_LIGHT), 0.88, 0.95, 0)); // round headlight
  addTo(g, rotZ(xlate(plainBox(0.45, 0.06, 0.3, DARK), 0.78, 0.62, 0), -0.35, 0.78, 0.62)); // front fender
  for (const pz of [0.32, -0.32]) {
    addTo(g, xlate(plainBox(0.06, 0.06, 0.14, DARK), 0.68, 1.08, pz)); // mirrors
  }
  return g;
}

function boatGeom({ fishing, sail }) {
  const body = emptyGeom(), glass = emptyGeom();
  addTo(body, xlate(plainBox(6, 0.9, 2.2, [1, 1, 1]), 0, 0.45, 0));
  addTo(body, xlate(plainBox(1.4, 0.7, 1.8, [1, 1, 1]), 3.4, 0.4, 0)); // bow
  // Gunwale railing: side rails + posts, both sides.
  for (const pz of [1.05, -1.05]) {
    addTo(body, xlate(plainBox(5.6, 0.06, 0.06, DARK), 0, 0.95, pz));
    for (const px of [-2.4, -0.8, 0.8, 2.4]) {
      addTo(body, xlate(plainBox(0.06, 0.25, 0.06, DARK), px, 0.82, pz));
    }
  }
  // Navigation lights: red port (-z), green starboard (+z).
  addTo(body, xlate(plainBox(0.15, 0.15, 0.15, RED_LIGHT), -0.5, 1.0, -1.0));
  addTo(body, xlate(plainBox(0.15, 0.15, 0.15, [0.15, 0.85, 0.3]), -0.5, 1.0, 1.0));
  if (fishing) {
    addTo(body, xlate(plainBox(1.8, 1.4, 1.8, [0.9, 0.9, 0.88]), -0.8, 1.6, 0)); // cabin
    addTo(glass, xlate(plainBox(1.84, 0.45, 1.84, GLASS), -0.8, 1.8, 0)); // cabin glass band
    addTo(body, xlate(plainBox(0.14, 3.4, 0.14, [0.5, 0.4, 0.28]), 0.6, 2.8, 0)); // mast
    addTo(body, xlate(plainBox(1.6, 0.5, 1.6, [0.3, 0.32, 0.3]), 1.8, 1.15, 0)); // cargo
    addTo(body, xlate(prismZ(10, 0.5, 0.6, [0.4, 0.35, 0.3]), 2.2, 1.2, 0)); // net drum
  } else if (sail) {
    addTo(body, xlate(plainBox(1.2, 0.6, 1.4, [1, 1, 1]), -0.5, 1.2, 0)); // cabin
    addTo(body, xlate(plainBox(0.12, 4.6, 0.12, [0.55, 0.45, 0.3]), 0, 3.2, 0)); // mast
    addTo(body, xlate(plainBox(2.6, 0.1, 0.1, [0.55, 0.45, 0.3]), -0.8, 1.6, 0)); // boom
    // Triangular sail (two triangles, white so the tint paints it pastel).
    const sailG = emptyGeom();
    const white = [1, 1, 1];
    const a = [0.1, 1.2, 0], b = [0.1, 5.2, 0], c = [-1.9, 1.2, 0];
    const n = [0, 0, 1];
    sailG.pos.push(...a, ...b, ...c, ...a, ...c, ...b);
    for (let k = 0; k < 6; k++) sailG.nrm.push(...n);
    for (let k = 0; k < 6; k++) sailG.col.push(...white);
    addTo(body, sailG);
  } else {
    addTo(body, xlate(plainBox(3.2, 0.5, 1.8, [0.92, 0.92, 0.9]), -0.4, 1.1, 0)); // cockpit
    addTo(glass, xlate(plainBox(0.08, 0.5, 1.4, GLASS), 0.8, 1.35, 0)); // windshield
    addTo(body, xlate(plainBox(0.5, 0.7, 0.4, DARK), -3.1, 0.6, 0)); // outboard motor
    for (const pz of [0.5, -0.5]) {
      addTo(body, xlate(plainBox(0.5, 0.4, 0.45, SEAT), -0.6, 1.15, pz)); // cockpit seats
    }
  }
  return { body, glass };
}

// One build pass for both meshes (deterministic — safe to build twice).
// withWheels=false leaves the wheels out of the body (the dynamic wheel
// mesh supplies spinning ones instead); the arches stay in both cases.
function buildVehicleParts(withWheels = true) {
  const body = {}, glass = {};
  const put = (type, part) => { body[type] = part.body; glass[type] = part.glass; };
  put('motorbike', bikeGeom({ scooter: false, withWheels }));
  put('scooter', bikeGeom({ scooter: true, withWheels }));
  put('bajaj', bajajGeom(withWheels));
  // Hatchback: steep tailgate slope + rear roof spoiler lip.
  put('car', (() => {
    const p = carGeom({ len: 3.6, w: 1.7, bodyH: 0.5, cabinLen: 1.9, cabinH: 0.5, cabinX: -0.1, tailSlope: 0.35, withWheels });
    addTo(p.body, xlate(plainBox(0.4, 0.06, 1.5, [1, 1, 1]), -1.0, 1.52, 0));
    return p;
  })());
  // Sedan: chrome window trim along the bottom of the side glass.
  put('sedan', (() => {
    const p = carGeom({ len: 4.4, w: 1.8, bodyH: 0.55, cabinLen: 2.2, cabinH: 0.55, cabinX: -0.1, withWheels });
    for (const pz of [0.71, -0.71]) addTo(p.body, xlate(plainBox(1.3, 0.05, 0.04, CHROME), -0.1, 0.98, pz));
    return p;
  })());
  // MPV: roof rails + sliding-door rail.
  put('mpv', (() => {
    const p = carGeom({ len: 4.5, w: 1.85, bodyH: 0.75, cabinLen: 2.8, cabinH: 0.6, cabinX: 0, withWheels });
    for (const pz of [0.6, -0.6]) addTo(p.body, xlate(plainBox(2.6, 0.07, 0.08, DARK), 0, 1.87, pz));
    for (const pz of [0.94, -0.94]) addTo(p.body, xlate(plainBox(2.4, 0.06, 0.04, DARK), 0, 1.0, pz));
    return p;
  })());
  // Jeep: round headlights, vertical-slat grille, bull bar, side steps.
  put('jeep', (() => {
    const p = carGeom({ len: 4.2, w: 1.9, bodyH: 0.8, cabinLen: 2.4, cabinH: 0.65, cabinX: 0, hoodSlope: 0.05, spare: true, roundLights: true, withWheels });
    for (const pz of [-0.45, -0.15, 0.15, 0.45]) {
      addTo(p.body, xlate(plainBox(0.04, 0.16, 0.05, CHROME), 2.15, 0.52, pz));
    }
    for (const pz of [0.6, -0.6]) addTo(p.body, xlate(plainBox(0.08, 0.5, 0.08, DARK), 2.22, 0.55, pz));
    addTo(p.body, xlate(plainBox(0.08, 0.08, 1.3, DARK), 2.22, 0.75, 0));
    for (const pz of [1.0, -1.0]) addTo(p.body, xlate(plainBox(3.0, 0.1, 0.25, DARK), 0, 0.38, pz));
    return p;
  })());
  // Angkot: roof sign + sliding-door panel on the right side.
  put('angkot', (() => {
    const p = carGeom({ len: 4.0, w: 1.8, bodyH: 0.95, cabinLen: 2.6, cabinH: 0.6, cabinX: 0, band: true, withWheels });
    addTo(p.body, xlate(plainBox(0.7, 0.18, 0.4, [1, 0.9, 0.5]), 0, 2.1, 0));
    addTo(p.body, xlate(plainBox(1.2, 0.9, 0.04, TRIM), -0.3, 0.9, 0.92));
    return p;
  })());
  put('bus', busGeom(withWheels));
  put('truck', truckGeom(withWheels));
  put('firetruck', firetruckGeom(withWheels));
  put('ambulance', ambulanceGeom(withWheels));
  // Police: black door panels (proud of the trim door panel) + push bar +
  // roof light bar (sits on the roof panel, whose top is at y≈1.64).
  put('police', (() => {
    const p = carGeom({ len: 4.4, w: 1.85, bodyH: 0.6, cabinLen: 2.2, cabinH: 0.55, cabinX: -0.1, withWheels });
    for (const pz of [0.965, -0.965]) {
      addTo(p.body, xlate(plainBox(1.6, 0.5, 0.04, [0.1, 0.1, 0.12]), -0.1, 0.62, pz));
    }
    for (const pz of [0.55, -0.55]) addTo(p.body, xlate(plainBox(0.08, 0.5, 0.08, DARK), 2.32, 0.55, pz));
    addTo(p.body, xlate(plainBox(0.08, 0.08, 1.2, DARK), 2.32, 0.72, 0));
    const red = plainBox(0.5, 0.16, 0.4, RED_LIGHT);
    addTo(p.body, xlate(red, -0.28, 1.72, 0));
    const blue = plainBox(0.5, 0.16, 0.4, [0.15, 0.3, 0.95]);
    addTo(p.body, xlate(blue, 0.28, 1.72, 0));
    return p;
  })());
  // Supercar: side air intakes + front splitter + rear diffuser.
  put('supercar', (() => {
    const p = carGeom({ len: 4.3, w: 2.0, bodyH: 0.38, cabinLen: 1.8, cabinH: 0.42, cabinX: -0.2, hoodSlope: 0.22, wing: true, withWheels });
    for (const pz of [1.01, -1.01]) addTo(p.body, xlate(plainBox(0.7, 0.3, 0.06, DARK), -0.6, 0.55, pz));
    addTo(p.body, xlate(plainBox(0.3, 0.08, 1.8, DARK), 2.2, 0.32, 0));
    addTo(p.body, xlate(plainBox(0.25, 0.12, 1.6, DARK), -2.2, 0.35, 0));
    return p;
  })());
  put('boat', boatGeom({}));
  put('fishingboat', boatGeom({ fishing: true }));
  put('sailboat', boatGeom({ sail: true }));
  return { body, glass };
}

export function buildVehicleGeoms() {
  return buildVehicleParts(true).body;
}

export function buildVehicleGlassGeoms() {
  return buildVehicleParts(true).glass;
}

// Bodies WITHOUT wheels, for the dynamic traffic meshes — the shared
// wheel mesh supplies the spinning wheels instead.
export function buildVehicleBodyGeoms() {
  return buildVehicleParts(false).body;
}

// One shared unit wheel: round 10-sided tyre (dark), 8-sided rim + hub
// (light — a different colour from the tyre) on both faces, and 5 spokes
// per face so the spin reads. Instances scale it to each wheel size;
// the per-instance tint stays white so the colours are never muddied.
export function buildWheelGeom() {
  const g = emptyGeom();
  addTo(g, tyreLathe(1, 1));
  for (const side of [1, -1]) {
    addTo(g, xlate(fanZ(12, 0.55, HUB, side < 0), 0, 0, side * 0.51));
    addTo(g, xlate(fanZ(8, 0.22, DARK, side < 0), 0, 0, side * 0.52));
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      const spoke = rotZ(xlate(plainBox(0.9, 0.14, 0.02, HUB), 0.55, 0, side * 0.53), a, 0, 0);
      addTo(g, spoke);
    }
  }
  return g;
}

// Transparent headlight cone: apex at the headlights, 15 m long,
// opening to ~1.4 m radius; vertex colours fade apex -> base so the beam
// dissolves into the dark instead of ending in a hard ring. Each wall
// triangle is emitted twice (both windings) so the cone reads from every
// angle with backface culling on.
export function beamConeGeom() {
  const g = emptyGeom();
  const SEG = 10, LEN = 15, R = 1.0;
  const apex = [0, 0, 0];
  const ring = [];
  for (let k = 0; k < SEG; k++) {
    const a = (k / SEG) * Math.PI * 2;
    ring.push([LEN, Math.cos(a) * R, Math.sin(a) * R]);
  }
  for (let k = 0; k < SEG; k++) {
    const b0 = ring[k], b1 = ring[(k + 1) % SEG];
    const n = [0, 1, 0];
    g.pos.push(...apex, ...b1, ...b0, ...apex, ...b0, ...b1);
    for (let j = 0; j < 6; j++) g.nrm.push(...n);
    g.col.push(
      1, 0.95, 0.75, 0.12, 0.1, 0.08, 0.12, 0.1, 0.08,
      1, 0.95, 0.75, 0.12, 0.1, 0.08, 0.12, 0.1, 0.08);
  }
  return g;
}

// Taillight lens (white base — the per-instance tint carries the red,
// dim at night, bright when braking).
export function tailGeom() {
  return plainBox(0.36, 0.14, 0.08, [1, 1, 1]);
}

// Police beacon lens (white base — tinted red/blue, flashing).
export function beaconGeom() {
  return plainBox(0.4, 0.1, 0.5, [1, 1, 1]);
}

// Parked car for plot dressing (static mesh, baked colour): the same car
// shape as the traffic cars, with the white body parts painted `color`
// and the glass kept as dark opaque glass (no transparency in statics).
export function parkedCarGeom(color) {
  const { body, glass } = carGeom({ len: 3.6, w: 1.7, bodyH: 0.5, cabinLen: 1.9, cabinH: 0.5, cabinX: -0.1 });
  const g = emptyGeom();
  const paint = (src, isGlass) => {
    for (let i = 0; i < src.pos.length; i++) {
      g.pos.push(src.pos[i]);
      g.nrm.push(src.nrm[i]);
    }
    for (let i = 0; i < src.col.length; i += 3) {
      const c = [src.col[i], src.col[i + 1], src.col[i + 2]];
      if (!isGlass && c[0] === 1 && c[1] === 1 && c[2] === 1) g.col.push(...color);
      else g.col.push(...c);
    }
  };
  paint(body, false);
  paint(glass, true);
  return g;
}

// Headlight dots (unlit, drawn only at night): two per vehicle.
export function headlightGeom() {
  return plainBox(0.3, 0.18, 0.12, [1.0, 0.95, 0.7]);
}
