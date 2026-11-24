// Teluk Rimba — police + 3-star wanted level. Pure logic (no WebGL, no DOM).
// Heat rises on crime (gunshots, theft, police contact) and decays when the
// player lays low. Police cars spawn per star and pursue on the road graph
// (BFS from the player's node, recomputed every second); at 2+ stars,
// officers chase on foot. Get caught (police car close + slow for 2.5 s)
// and you are busted: fine, wanted reset. Escape far + long enough and the
// heat drops a star.
//
// Police SHOOT (Mu, 24 Nov 2026): officers on foot (2+ stars) fire within
// 25 m, police cars within 35 m, only while wanted >= 1 — about one shot
// per 1.2-2.0 s per shooter, hit chance 55% under 10 m falling to 15% at
// max range, 8-12 damage per hit. Accuracy stays low on purpose so the
// player can always break away by distance and missions stay winnable.
import { mulberry32 } from './rng.js';

// Police gunfire tuning (exported for tests + main.js).
export const OFFICER_RANGE = 25; // m, officers on foot
export const POLICE_CAR_RANGE = 35; // m, police cars in pursuit
export const FIRE_INTERVAL_MIN = 1.2; // s between shots, per shooter
export const FIRE_INTERVAL_MAX = 2.0;
export const DMG_MIN = 8;
export const DMG_MAX = 12;
export const SHOT_LIFE = 0.12; // s a tracer stays visible

// Hit chance vs distance: full 55% inside 10 m, then a straight fall to
// 15% at the shooter's max range.
export function hitChance(d, range) {
  if (d <= 10) return 0.55;
  if (d >= range) return 0.15;
  return 0.55 - (0.55 - 0.15) * ((d - 10) / (range - 10));
}

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
    shots: [], // tracers on screen: {fx,fy,fz, tx,ty,tz, t} (t = life left, s)
    shotEvents: [], // shots fired THIS step, drained by main.js: {fx,fy,fz, tx,ty,tz, hit, dmg}
  };

  function syncPolice() {
    // Spawn / remove police cars to match the wanted level.
    while (state.police.length < state.wanted) {
      const v = traffic.spawnPolice(state.playerX || 0, state.playerZ || 0);
      v.shootCd = FIRE_INTERVAL_MIN + rand() * (FIRE_INTERVAL_MAX - FIRE_INTERVAL_MIN);
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
      if (o) {
        o.shootCd = FIRE_INTERVAL_MIN + rand() * (FIRE_INTERVAL_MAX - FIRE_INTERVAL_MIN);
        state.officers.push(o);
      } else break;
    }
    while (state.officers.length > wantOfficers) {
      const o = state.officers.pop();
      const i = peds.peds.indexOf(o);
      if (i >= 0) peds.peds.splice(i, 1);
    }
  }

  // Clear the whole pursuit (wasted / busted / reset): no heat, no stars,
  // no police, no tracers in flight.
  function reset() {
    state.heat = 0; state.wanted = 0; state.busted = false;
    state.bustTimer = 0; state.escapeTimer = 0; state.quietTimer = 0;
    state.shots = []; state.shotEvents = [];
    syncPolice();
  }

  // One shooter takes a shot at the player if in range and off cooldown.
  // Misses still make a tracer + sound (the event carries hit=false).
  function tryShoot(dt, sx, sy, sz, range, shooter, px, py, pz) {
    const d = Math.hypot(px - sx, pz - sz);
    if (d > range) return;
    shooter.shootCd -= dt;
    if (shooter.shootCd > 0) return;
    shooter.shootCd = FIRE_INTERVAL_MIN + rand() * (FIRE_INTERVAL_MAX - FIRE_INTERVAL_MIN);
    const hit = rand() < hitChance(d, range);
    const dmg = hit ? DMG_MIN + Math.floor(rand() * (DMG_MAX - DMG_MIN + 1)) : 0;
    state.shotEvents.push({ fx: sx, fy: sy, fz: sz, tx: px, ty: py, tz: pz, hit, dmg });
    state.shots.push({ fx: sx, fy: sy, fz: sz, tx: px, ty: py, tz: pz, t: SHOT_LIFE });
  }

  function step(dt, player, opts = {}) {
    state.playerX = player.x; state.playerZ = player.z;
    state.busted = false;
    state.shotEvents = [];
    // Tracers fade fast (0.12 s); drop the expired ones every step.
    for (const s of state.shots) s.t -= dt;
    state.shots = state.shots.filter((s) => s.t > 0);
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
        state.shots = [];
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
    // Police gunfire (Mu, 24 Nov 2026): only while wanted >= 1 and the
    // caller allows it (main.js blocks it while the shop menu is open;
    // the start screen never reaches step() at all). Officers fire on
    // foot within 25 m, police cars within 35 m. Out of range they hold
    // fire, so the player can always break away by distance.
    if (opts.shooting !== false) {
      const py = (player.y || 0) + 1.2; // chest height
      for (const v of state.police) {
        if (v.parked || v.driven) continue;
        tryShoot(dt, v.x, (v.y || 0) + 1.2, v.z, POLICE_CAR_RANGE, v, player.x, py, player.z);
      }
      for (const o of state.officers) {
        tryShoot(dt, o.x, (o.y || 0) + 1.4, o.z, OFFICER_RANGE, o, player.x, py, player.z);
      }
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

  return { state, step, addHeat, reduceHeat, syncPolice, reset };
}
