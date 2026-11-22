// Teluk Rimba — autopilot (TESTS ONLY, off in normal play).
// Drives the player along the road graph (BFS) to the current mission
// objective, gets out and walks the last stretch when the step needs it on
// foot, and gets in a vehicle when one is near. The player is never
// teleported: the autopilot steers the same keys the player would press, and
// the mission system only counts a step when the player really arrives.
// Usage: ?autopilot=1 (with ?mission=N and ?drive=type for play-tests).
import { ACTION_ENTER } from './input.js';

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function createAutopilot(city) {
  const adj = new Map();
  for (const e of city.edges) {
    if (!adj.has(e.a)) adj.set(e.a, []);
    if (!adj.has(e.b)) adj.set(e.b, []);
    adj.get(e.a).push(e.b);
    adj.get(e.b).push(e.a);
  }
  const nodesById = new Map(city.nodes.map((n) => [n.id, n]));

  function nearestNode(x, z) {
    let best = city.nodes[0], bestD = Infinity;
    for (const n of city.nodes) {
      const d = Math.hypot(n.x - x, n.z - z);
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  }
  // BFS path of node coords from (x0,z0) to (x1,z1).
  function bfsPath(x0, z0, x1, z1) {
    const from = nearestNode(x0, z0), to = nearestNode(x1, z1);
    if (from.id === to.id) return [{ x: to.x, z: to.z }];
    const prev = new Map([[from.id, null]]);
    const q = [from.id];
    while (q.length) {
      const n = q.shift();
      if (n === to.id) break;
      for (const m of adj.get(n) || []) {
        if (!prev.has(m)) { prev.set(m, n); q.push(m); }
      }
    }
    if (!prev.has(to.id)) return [{ x: to.x, z: to.z }];
    const path = [];
    let cur = to.id;
    while (cur !== null) {
      const n = nodesById.get(cur);
      path.push({ x: n.x, z: n.z });
      cur = prev.get(cur);
    }
    path.reverse();
    return path;
  }

  const ap = {
    enabled: true,
    // Current driving intent (read by the fake input object).
    drive: { forward: false, back: false, left: false, right: false },
    walk: { forward: false, run: false },
    wantEnter: false, // consumed by takeActions()
    target: null,
    route: [], routeIdx: 0,
    stuckT: 0, lastX: 0, lastZ: 0, reverseT: 0,
    input: null,
  };

  function resetDrive() {
    ap.drive.forward = ap.drive.back = ap.drive.left = ap.drive.right = false;
    ap.walk.forward = false; ap.walk.run = false;
  }

  // Fake input object: main.js uses it exactly like the real keyboard input.
  ap.input = {
    get forward() { return ap.walk.forward || ap.drive.forward; },
    get back() { return ap.drive.back; },
    get left() { return ap.drive.left; },
    get right() { return ap.drive.right; },
    get run() { return ap.walk.run; },
    takeActions() {
      if (ap.wantEnter) { ap.wantEnter = false; return ACTION_ENTER; }
      return 0;
    },
    takeDrag() { return { dx: 0, dy: 0 }; },
    takeWheel() { return 0; },
  };

  ap.setTarget = function setTarget(t) {
    const same = ap.target && t && ap.target.x === t.x && ap.target.z === t.z;
    if (!same) {
      ap.target = t ? { x: t.x, z: t.z, radius: t.radius || 6, onFoot: !!t.onFoot } : null;
      ap.route = [];
      ap.routeIdx = 0;
      ap.stuckT = 0;
    }
  };

  // Steer a vehicle toward (tx, tz). Returns when close enough.
  function steerDrive(dt, v, tx, tz) {
    const dx = tx - v.x, dz = tz - v.z;
    const dist = Math.hypot(dx, dz);
    const desired = Math.atan2(dx, dz);
    const diff = wrapAngle(desired - v.heading);
    const d = ap.drive;
    if (ap.reverseT > 0) {
      ap.reverseT -= dt;
      d.forward = false; d.back = true;
      d.left = diff > 0; d.right = diff < 0;
      return dist;
    }
    d.left = diff < -0.08;
    d.right = diff > 0.08;
    // Always creep forward while steering: the car only turns while moving,
    // so a wide forward U-turn is how it turns around. (Never reverse toward
    // a waypoint — blind reversing rams traffic and earns stars.)
    d.forward = true;
    d.back = dist < 4 && Math.abs(v.speed) > 2; // brake when right on top of it
    // Stuck (pushing into a wall)? Back up and try again.
    if (Math.abs(v.speed) < 0.5 && d.forward) {
      ap.stuckT += dt;
      if (ap.stuckT > 2.5) { ap.reverseT = 1.2; ap.stuckT = 0; }
    } else {
      ap.stuckT = 0;
    }
    return dist;
  }

  ap.update = function update(dt, ctx) {
    const { player, driving, traffic, missions } = ctx;
    resetDrive();
    const t = missions ? missions.currentTarget() : null;
    ap.setTarget(t);
    if (!t) return;
    const px = player.state.x, pz = player.state.z;
    // Route-following measures from the vehicle when driving (in the real
    // game player.state tracks the vehicle, but measure from the vehicle
    // itself so a stale player position can never mis-route the car).
    const vx = driving ? driving.x : px;
    const vz = driving ? driving.z : pz;
    const dist = Math.hypot(t.x - vx, t.z - vz);
    const isBoat = driving && (driving.type === 'boat' || driving.type === 'fishingboat' || driving.type === 'sailboat');

    // --- on-foot step: get out near the target, then walk ---
    if (t.onFoot) {
      if (driving) {
        if (dist < 25) { ap.wantEnter = true; return; } // get out
        // Still far: keep driving toward it first.
      } else {
        // Board step (the mission boat): get in when close enough.
        if (t.board) {
          const v = traffic.nearestEnterable(px, pz, 6);
          if (v) { ap.wantEnter = true; return; }
        }
        // Walk: point the camera at the target and walk forward.
        player.state.camYaw = Math.atan2(-(t.x - px), -(t.z - pz));
        ap.walk.forward = true;
        ap.walk.run = dist > 15;
        return;
      }
    }

    // --- need a vehicle and there is one nearby? Get in. ---
    if (!driving && dist > 40) {
      const v = traffic.nearestEnterable(px, pz, 6);
      if (v) { ap.wantEnter = true; return; }
      // No vehicle close by: walk toward the target (slow, but honest).
      player.state.camYaw = Math.atan2(-(t.x - px), -(t.z - pz));
      ap.walk.forward = true;
      ap.walk.run = true;
      return;
    }

    // --- driving ---
    if (driving) {
      const v = driving;
      if (dist < Math.max(t.radius, 4)) { resetDrive(); return; } // arrived
      if (isBoat) {
        // Open water: steer straight at the target.
        steerDrive(dt, v, t.x, t.z);
        return;
      }
      // Off-road target (mountain summit: nearest node is far away)?
      // Drive straight at it — the mountain has no buildings to hit.
      const nearNode = nearestNode(t.x, t.z);
      const offRoad = Math.hypot(nearNode.x - t.x, nearNode.z - t.z) > 60;
      if (offRoad && dist < 320) {
        steerDrive(dt, v, t.x, t.z);
        return;
      }
      // Road route: BFS to the target node, then straight to the target.
      if (ap.route.length === 0 || ap.routeIdx >= ap.route.length) {
        ap.route = bfsPath(vx, vz, t.x, t.z);
        ap.route.push({ x: t.x, z: t.z });
        ap.routeIdx = 0;
        // The first node is the nearest one — it can sit behind the car
        // (the car already passed it). Drop leading waypoints behind us.
        const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
        while (ap.route.length > 1) {
          const w0 = ap.route[0];
          const dx = w0.x - vx, dz = w0.z - vz;
          if (dx * fx + dz * fz < 0 && Math.hypot(dx, dz) < 40) ap.route.shift();
          else break;
        }
      }
      let wp = ap.route[ap.routeIdx];
      if (wp && Math.hypot(wp.x - vx, wp.z - vz) < 12) {
        ap.routeIdx++;
        wp = ap.route[ap.routeIdx];
      }
      if (!wp) { steerDrive(dt, v, t.x, t.z); return; }
      steerDrive(dt, v, wp.x, wp.z);
      return;
    }

    // On foot, close to the target: walk the last stretch.
    player.state.camYaw = Math.atan2(-(t.x - px), -(t.z - pz));
    ap.walk.forward = true;
    ap.walk.run = dist > 15;
  };

  return ap;
}
