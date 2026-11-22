// Teluk Rimba — police + 3-star wanted level. Pure logic (no WebGL, no DOM).
// Heat rises on crime (gunshots, theft, police contact) and decays when the
// player lays low. Police cars spawn per star and pursue on the road graph
// (BFS from the player's node, recomputed every second); at 2+ stars,
// officers chase on foot. Get caught (police car close + slow for 2.5 s)
// and you are busted: fine, wanted reset. Escape far + long enough and the
// heat drops a star.
import { mulberry32 } from './rng.js';

export function createWanted(city, traffic, peds, opts = {}) {
  const rand = mulberry32(opts.seed || 20261125);
  const nodesById = new Map(city.nodes.map((n) => [n.id, n]));
  const adj = new Map();
  for (const e of city.edges) {
    if (!adj.has(e.a)) adj.set(e.a, []);
    if (!adj.has(e.b)) adj.set(e.b, []);
    adj.get(e.a).push(e.b);
    adj.get(e.b).push(e.a);
  }
  function nearestNode(x, z) {
    let best = city.nodes[0], bestD = Infinity;
    for (const n of city.nodes) {
      const d = Math.hypot(n.x - x, n.z - z);
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  }
  function bfsDist(startId) {
    const dist = new Map([[startId, 0]]);
    const q = [startId];
    while (q.length) {
      const n = q.shift();
      for (const m of adj.get(n) || []) {
        if (!dist.has(m)) { dist.set(m, dist.get(n) + 1); q.push(m); }
      }
    }
    return dist;
  }

  const state = {
    heat: 0, wanted: 0,
    police: [], // traffic vehicles in pursue mode
    officers: [],
    busted: false,
    bustTimer: 0,
    escapeTimer: 0,
    quietTimer: 0,
    lastCrimeAt: -100,
    routeTimer: 0,
    distToPlayer: null,
  };

  function syncPolice() {
    // Spawn / remove police cars to match the wanted level.
    while (state.police.length < state.wanted) {
      const v = traffic.spawnPolice(state.playerX || 0, state.playerZ || 0);
      state.police.push(v);
    }
    while (state.police.length > state.wanted) {
      const v = state.police.pop();
      traffic.removeVehicle(v);
    }
    // Officers at 2+ stars.
    const wantOfficers = state.wanted >= 2 ? 2 : 0;
    while (state.officers.length < wantOfficers) {
      const o = peds.spawnOfficer((state.playerX || 0) + (rand() - 0.5) * 30, (state.playerZ || 0) + (rand() - 0.5) * 30);
      if (o) state.officers.push(o); else break;
    }
    while (state.officers.length > wantOfficers) {
      const o = state.officers.pop();
      const i = peds.peds.indexOf(o);
      if (i >= 0) peds.peds.splice(i, 1);
    }
  }

  function step(dt, player) {
    state.playerX = player.x; state.playerZ = player.z;
    state.busted = false;
    const now = state.elapsed || 0;
    state.elapsed = now + dt;
    // Heat decays after 10 s without crime.
    if (state.elapsed - state.lastCrimeAt > 10 && state.heat > 0) {
      state.heat = Math.max(0, state.heat - 0.06 * dt);
    }
    const newWanted = Math.min(3, Math.ceil(state.heat));
    if (newWanted !== state.wanted) {
      state.wanted = newWanted;
      syncPolice();
    }
    if (state.wanted === 0) {
      state.bustTimer = 0; state.escapeTimer = 0;
      return state;
    }
    // Pursuit routing: every second, BFS from the player's node; each
    // police car then picks, at every intersection, the edge whose far node
    // is closest to the player (see pickNextEdge in vehicles.js).
    state.routeTimer -= dt;
    if (state.routeTimer <= 0) {
      state.routeTimer = 1;
      const target = nearestNode(player.x, player.z);
      const dist = bfsDist(target.id);
      for (const v of state.police) {
        v.distMap = dist;
        v.targetSpeed = 16 + state.wanted * 2;
      }
    }
    // Distance to the closest police car (for busted / escape checks).
    let minD = Infinity;
    for (const v of state.police) {
      if (v.parked || v.driven) continue;
      const d = Math.hypot(v.x - player.x, v.z - player.z);
      minD = Math.min(minD, d);
    }
    state.distToPlayer = minD === Infinity ? null : minD;
    // Busted: a police car is very close while the player is slow.
    const playerSpeed = player.speedKmh || 0;
    if (minD < 5 && playerSpeed < 8) {
      state.bustTimer += dt;
      if (state.bustTimer > 2.5) {
        state.busted = true;
        state.heat = 0; state.wanted = 0; state.bustTimer = 0;
        syncPolice();
        return state;
      }
    } else {
      state.bustTimer = 0;
    }
    // Escape: all police far away for 8 s -> lose a star.
    if (minD > 150) {
      state.escapeTimer += dt;
      if (state.escapeTimer > 8) {
        state.heat = Math.max(0, state.heat - 1);
        state.escapeTimer = 0;
      }
    } else {
      state.escapeTimer = 0;
    }
    return state;
  }

  function addHeat(n) {
    state.heat = Math.min(3, state.heat + n);
    state.lastCrimeAt = state.elapsed || 0;
    const newWanted = Math.min(3, Math.ceil(state.heat));
    if (newWanted !== state.wanted) {
      state.wanted = newWanted;
      syncPolice();
    }
  }

  // Lose heat (a medkit from the shop patches the player up): drops the
  // wanted level by whole stars and pulls the police cars off.
  function reduceHeat(n) {
    state.heat = Math.max(0, state.heat - n);
    const newWanted = Math.min(3, Math.ceil(state.heat));
    if (newWanted !== state.wanted) {
      state.wanted = newWanted;
      syncPolice();
    }
  }

  return { state, step, addHeat, reduceHeat, syncPolice };
}
