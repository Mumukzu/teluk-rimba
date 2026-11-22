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

// Bus route: a loop of main-road nodes (rectangle around downtown).
function busRouteNodes(city) {
  const at = (x, z) => city.nodes.find((n) => n.x === x && n.z === z);
  const pts = [
    [-400, -400], [-200, -400], [0, -400], [200, -400], [400, -400],
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
    const v = {
      id: nextId++, type, edge, s, lane,
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
    const rx = d.dz, rz = -d.dx;
    v.x = a.x + d.dx * d.len * v.s + rx * v.lane;
    v.z = a.z + d.dz * d.len * v.s + rz * v.lane;
    v.heading = Math.atan2(d.dx, d.dz);
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
    const cur = edgeDir(v.edge);
    options.sort((p, q) => {
      const pd = edgeDir(p.edge), qd = edgeDir(q.edge);
      const pa = Math.abs(Math.atan2(pd.dx, pd.dz) - Math.atan2(cur.dx, cur.dz));
      const qa = Math.abs(Math.atan2(qd.dx, qd.dz) - Math.atan2(cur.dx, cur.dz));
      return pa - qa;
    });
    return rand() < 0.6 ? options[0] : options[Math.floor(rand() * options.length)];
  }

  // --- spawn moving traffic ---
  // Dense on MAIN roads (Mu: intersections must look busy, not empty):
  // ~70% of vehicles spawn on a main-road edge, the rest anywhere.
  const mainEdges = city.edges.filter((e) => e.main);
  const pickEdge = () => (rand() < 0.7 && mainEdges.length
    ? mainEdges[Math.floor(rand() * mainEdges.length)]
    : city.edges[Math.floor(rand() * city.edges.length)]);
  const MOVING = [
    ['motorbike', 55], ['scooter', 26], ['car', 20], ['sedan', 16],
    ['mpv', 12], ['jeep', 10], ['angkot', 14], ['bajaj', 14],
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
          v.edge = onRoute.edge; v.s = 0; v.lane = 1.5;
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
    // Follow-the-leader: slow down for a vehicle ahead on the same edge.
    let target = v.targetSpeed;
    for (const o of vehicles) {
      if (o === v || o.parked || o.driven || o.edge !== v.edge) continue;
      const gap = (o.s - v.s) * edgeLen(v.edge);
      if (gap > 0 && gap < 10) target = Math.min(target, o.speed);
    }
    v.speed += clamp(target - v.speed, -14 * dt, 8 * dt);
    if (v.speed < 0.05) v.speed = 0;
    const d = edgeDir(v.edge);
    v.s += (v.speed * dt) / d.len;
    if (v.s >= 1) {
      const nodeId = v.edge.b;
      const next = pickNextEdge(v, nodeId);
      if (!next) { v.s = 1; v.speed = 0; return; }
      // Moving onto the next edge: keep the same lane side (right-hand).
      const keepLane = v.lane > 0 ? 1 : -1;
      const main = next.edge.main;
      v.edge = next.edge;
      v.s = 0;
      v.lane = keepLane * (main ? (Math.abs(v.lane) > 3 ? 4.5 : 1.5) : 2.0);
      // Bus stop dwell: the bus stops at marked route nodes.
      if (v.type === 'bus' && BUS_STOPS.has(nodeId)) {
        v.dwell = 3;
        if (traffic.onBusStop) traffic.onBusStop(v, nodeId);
      }
    }
    placeOnEdge(v);
  }

  function stepBoat(b, dt) {
    if (b.driven) return;
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

function wheelGeom() {
  return plainBox(0.14, 0.55, 0.55, [0.1, 0.1, 0.11]);
}

// Generic car: body + glass cabin + 4 wheels. Body vertex colour is white
// so the per-instance tint paints it; cabin glass and wheels stay dark.
export function carGeom({ len, w, bodyH, cabinLen, cabinH, cabinX }) {
  const g = emptyGeom();
  const body = plainBox(len, bodyH, w, [1, 1, 1]);
  for (let i = 0; i < body.pos.length; i += 3) body.pos[i + 1] += bodyH / 2 + 0.35;
  const cabin = plainBox(cabinLen, cabinH, w * 0.82, [0.22, 0.28, 0.36]);
  for (let i = 0; i < cabin.pos.length; i += 3) { cabin.pos[i] += cabinX; cabin.pos[i + 1] += bodyH + 0.35 + cabinH / 2; }
  const parts = [body, cabin];
  for (const [wx, wz] of [[len / 2 - 0.7, w / 2 - 0.05], [len / 2 - 0.7, -w / 2 + 0.05], [-len / 2 + 0.7, w / 2 - 0.05], [-len / 2 + 0.7, -w / 2 + 0.05]]) {
    const wh = wheelGeom();
    for (let i = 0; i < wh.pos.length; i += 3) { wh.pos[i] += wx; wh.pos[i + 1] += 0.28; wh.pos[i + 2] += wz; }
    parts.push(wh);
  }
  for (const p of parts) { g.pos.push(...p.pos); g.nrm.push(...p.nrm); g.col.push(...p.col); }
  return g;
}

function bikeGeom({ scooter }) {
  const g = emptyGeom();
  const parts = [];
  const wheelF = wheelGeom();
  for (let i = 0; i < wheelF.pos.length; i += 3) { wheelF.pos[i] += 0.75; wheelF.pos[i + 1] += 0.3; }
  const wheelB = wheelGeom();
  for (let i = 0; i < wheelB.pos.length; i += 3) { wheelB.pos[i] -= 0.75; wheelB.pos[i + 1] += 0.3; }
  parts.push(wheelF, wheelB);
  if (scooter) {
    // Step-through: front shield + flat floor + seat.
    const shield = plainBox(0.5, 1.0, 0.55, [1, 1, 1]);
    for (let i = 0; i < shield.pos.length; i += 3) { shield.pos[i] += 0.62; shield.pos[i + 1] += 0.85; }
    const floor = plainBox(0.9, 0.1, 0.4, [0.25, 0.25, 0.28]);
    for (let i = 0; i < floor.pos.length; i += 3) { floor.pos[i + 1] += 0.42; }
    const seat = plainBox(0.8, 0.14, 0.45, [0.25, 0.22, 0.2]);
    for (let i = 0; i < seat.pos.length; i += 3) { seat.pos[i] -= 0.45; seat.pos[i + 1] += 0.72; }
    parts.push(shield, floor, seat);
  } else {
    const tank = plainBox(0.7, 0.32, 0.42, [1, 1, 1]);
    for (let i = 0; i < tank.pos.length; i += 3) { tank.pos[i] += 0.15; tank.pos[i + 1] += 0.72; }
    const seat = plainBox(0.75, 0.12, 0.4, [0.2, 0.2, 0.22]);
    for (let i = 0; i < seat.pos.length; i += 3) { seat.pos[i] -= 0.5; seat.pos[i + 1] += 0.68; }
    const bar = plainBox(0.1, 0.08, 0.6, [0.15, 0.15, 0.16]);
    for (let i = 0; i < bar.pos.length; i += 3) { bar.pos[i] += 0.68; bar.pos[i + 1] += 1.0; }
    parts.push(tank, seat, bar);
  }
  // Rider: torso (white, takes the tint) + legs (dark) + helmet (white).
  const torso = plainBox(0.42, 0.55, 0.34, [1, 1, 1]);
  for (let i = 0; i < torso.pos.length; i += 3) { torso.pos[i] -= 0.15; torso.pos[i + 1] += 1.15; }
  const legs = plainBox(0.4, 0.5, 0.32, [0.2, 0.22, 0.3]);
  for (let i = 0; i < legs.pos.length; i += 3) { legs.pos[i] -= 0.15; legs.pos[i + 1] += 0.68; }
  const helmet = plainBox(0.34, 0.32, 0.32, [1, 1, 1]);
  for (let i = 0; i < helmet.pos.length; i += 3) { helmet.pos[i] -= 0.15; helmet.pos[i + 1] += 1.58; }
  parts.push(torso, legs, helmet);
  for (const p of parts) { g.pos.push(...p.pos); g.nrm.push(...p.nrm); g.col.push(...p.col); }
  return g;
}

function boatGeom({ fishing, sail }) {
  const g = emptyGeom();
  const parts = [];
  const hull = plainBox(6, 0.9, 2.2, [1, 1, 1]);
  for (let i = 0; i < hull.pos.length; i += 3) hull.pos[i + 1] += 0.45;
  const bow = plainBox(1.4, 0.7, 1.8, [1, 1, 1]);
  for (let i = 0; i < bow.pos.length; i += 3) { bow.pos[i] += 3.4; bow.pos[i + 1] += 0.4; }
  parts.push(hull, bow);
  if (fishing) {
    const cabin = plainBox(1.8, 1.4, 1.8, [0.9, 0.9, 0.88]);
    for (let i = 0; i < cabin.pos.length; i += 3) { cabin.pos[i] -= 0.8; cabin.pos[i + 1] += 1.6; }
    const mast = plainBox(0.14, 3.4, 0.14, [0.5, 0.4, 0.28]);
    for (let i = 0; i < mast.pos.length; i += 3) { mast.pos[i] += 0.6; mast.pos[i + 1] += 2.8; }
    const nets = plainBox(1.6, 0.5, 1.6, [0.3, 0.32, 0.3]);
    for (let i = 0; i < nets.pos.length; i += 3) { nets.pos[i] += 1.8; nets.pos[i + 1] += 1.15; }
    parts.push(cabin, mast, nets);
  } else if (sail) {
    const mast = plainBox(0.12, 4.6, 0.12, [0.55, 0.45, 0.3]);
    for (let i = 0; i < mast.pos.length; i += 3) mast.pos[i + 1] += 3.2;
    parts.push(mast);
    // Triangular sail (two triangles, white so the tint paints it pastel).
    const sailG = emptyGeom();
    const white = [1, 1, 1];
    const a = [0.1, 1.2, 0], b = [0.1, 5.2, 0], c = [-1.9, 1.2, 0];
    const n = [0, 0, 1];
    sailG.pos.push(...a, ...b, ...c, ...a, ...c, ...b);
    for (let k = 0; k < 6; k++) sailG.nrm.push(...n);
    for (let k = 0; k < 6; k++) sailG.col.push(...white);
    parts.push(sailG);
  } else {
    const deck = plainBox(3.2, 0.5, 1.8, [0.92, 0.92, 0.9]);
    for (let i = 0; i < deck.pos.length; i += 3) { deck.pos[i] -= 0.4; deck.pos[i + 1] += 1.1; }
    parts.push(deck);
  }
  for (const p of parts) { g.pos.push(...p.pos); g.nrm.push(...p.nrm); g.col.push(...p.col); }
  return g;
}

export function buildVehicleGeoms() {
  const car = (o) => carGeom(o);
  return {
    motorbike: bikeGeom({ scooter: false }),
    scooter: bikeGeom({ scooter: true }),
    bajaj: (() => {
      const g = car({ len: 2.4, w: 1.3, bodyH: 0.9, cabinLen: 1.6, cabinH: 0.7, cabinX: -0.1 });
      return g;
    })(),
    car: car({ len: 3.6, w: 1.7, bodyH: 0.55, cabinLen: 1.9, cabinH: 0.5, cabinX: -0.1 }),
    sedan: car({ len: 4.4, w: 1.8, bodyH: 0.6, cabinLen: 2.2, cabinH: 0.55, cabinX: -0.1 }),
    mpv: car({ len: 4.5, w: 1.85, bodyH: 0.8, cabinLen: 2.8, cabinH: 0.6, cabinX: 0 }),
    jeep: car({ len: 4.2, w: 1.9, bodyH: 0.85, cabinLen: 2.4, cabinH: 0.65, cabinX: 0 }),
    angkot: car({ len: 4.0, w: 1.8, bodyH: 1.0, cabinLen: 2.6, cabinH: 0.6, cabinX: 0 }),
    bus: car({ len: 9.0, w: 2.5, bodyH: 1.6, cabinLen: 7.6, cabinH: 0.9, cabinX: 0 }),
    truck: (() => {
      const g = emptyGeom();
      const cab = plainBox(1.8, 1.6, 2.3, [1, 1, 1]);
      for (let i = 0; i < cab.pos.length; i += 3) { cab.pos[i] += 2.4; cab.pos[i + 1] += 1.15; }
      const box = plainBox(4.6, 2.0, 2.35, [0.85, 0.85, 0.82]);
      for (let i = 0; i < box.pos.length; i += 3) { box.pos[i] -= 0.9; box.pos[i + 1] += 1.35; }
      const parts = [cab, box];
      for (const [wx, wz] of [[2.6, 1.05], [2.6, -1.05], [-1.6, 1.05], [-1.6, -1.05], [-2.8, 1.05], [-2.8, -1.05]]) {
        const wh = wheelGeom();
        for (let i = 0; i < wh.pos.length; i += 3) { wh.pos[i] += wx; wh.pos[i + 1] += 0.28; wh.pos[i + 2] += wz; }
        parts.push(wh);
      }
      for (const p of parts) { g.pos.push(...p.pos); g.nrm.push(...p.nrm); g.col.push(...p.col); }
      return g;
    })(),
    firetruck: (() => {
      const g = car({ len: 7.5, w: 2.5, bodyH: 1.5, cabinLen: 2.0, cabinH: 0.7, cabinX: 2.2 });
      const ladder = plainBox(5.6, 0.18, 0.5, [0.85, 0.85, 0.86]);
      for (let i = 0; i < ladder.pos.length; i += 3) { ladder.pos[i] -= 0.6; ladder.pos[i + 1] += 2.3; }
      g.pos.push(...ladder.pos); g.nrm.push(...ladder.nrm); g.col.push(...ladder.col);
      return g;
    })(),
    ambulance: (() => {
      const g = car({ len: 5.2, w: 2.0, bodyH: 1.1, cabinLen: 3.2, cabinH: 0.7, cabinX: 0 });
      // Red cross on both sides: vertical + horizontal bar.
      for (const side of [1.02, -1.02]) {
        const vBar = plainBox(0.1, 0.6, 0.2, [0.9, 0.15, 0.15]);
        for (let i = 0; i < vBar.pos.length; i += 3) { vBar.pos[i + 1] += 1.5; vBar.pos[i + 2] += side; }
        const hBar = plainBox(0.1, 0.2, 0.6, [0.9, 0.15, 0.15]);
        for (let i = 0; i < hBar.pos.length; i += 3) { hBar.pos[i + 1] += 1.5; hBar.pos[i + 2] += side; }
        g.pos.push(...vBar.pos, ...hBar.pos); g.nrm.push(...vBar.nrm, ...hBar.nrm); g.col.push(...vBar.col, ...hBar.col);
      }
      return g;
    })(),
    police: (() => {
      const g = car({ len: 4.4, w: 1.85, bodyH: 0.6, cabinLen: 2.2, cabinH: 0.55, cabinX: -0.1 });
      // Light bar: red + blue boxes on the roof.
      const red = plainBox(0.5, 0.16, 0.4, [0.95, 0.15, 0.15]);
      for (let i = 0; i < red.pos.length; i += 3) { red.pos[i] -= 0.28; red.pos[i + 1] += 1.6; }
      const blue = plainBox(0.5, 0.16, 0.4, [0.15, 0.3, 0.95]);
      for (let i = 0; i < blue.pos.length; i += 3) { blue.pos[i] += 0.28; blue.pos[i + 1] += 1.6; }
      g.pos.push(...red.pos, ...blue.pos); g.nrm.push(...red.nrm, ...blue.nrm); g.col.push(...red.col, ...blue.col);
      return g;
    })(),
    supercar: car({ len: 4.3, w: 2.0, bodyH: 0.42, cabinLen: 1.8, cabinH: 0.42, cabinX: -0.2 }),
    boat: boatGeom({}),
    fishingboat: boatGeom({ fishing: true }),
    sailboat: boatGeom({ sail: true }),
  };
}

// Headlight dots (unlit, drawn only at night): two per vehicle.
export function headlightGeom() {
  return plainBox(0.3, 0.18, 0.12, [1.0, 0.95, 0.7]);
}
