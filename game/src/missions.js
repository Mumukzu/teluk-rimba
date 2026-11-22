// Teluk Rimba — mission framework + 6 missions. Pure logic (no WebGL, no
// DOM): the game loop drives it, the HUD shows it, the autopilot follows it.
// All in-game text is English; the city name stays Teluk Rimba.
//
// Story: you are a new courier in Teluk Rimba. A fixer at Rimba Plaza
// hands you jobs — deliver, meet, chase, climb, sail, escape. Money is the
// reward; the shop (later phase) spends it. Each mission has a time limit
// and fail conditions (timeout, busted by the police, target escaped).
// Mission state (money, completed missions, active mission + step) is saved
// on every mission event (see save.js).
import { buildingAABBs, terrainHeight, riverDistance } from './city.js';

// Mission board at Rimba Plaza: walk up to it and the next job starts.
export const MISSION_BOARD = { x: -50, z: -50 };

// Step types:
//   drive  — be driving any vehicle
//   goto   — reach (x, z) within radius, driving or on foot
//   onfoot — reach (x, z) within radius on foot only (get out first)
//   chase  — get within 7 m of the getaway vehicle (it escapes after 2 laps)
//   board  — get into the boat (mission boat)
//   sail   — reach (x, z) while driving the boat
export const MISSIONS = [
  {
    id: 1, name: 'Parcel Run', reward: 150, timeLimit: 240, night: false, wanted: 0,
    start: { x: 0, z: 120 },
    intro: 'New courier job: pick up a parcel at Rimba Market and deliver it to Coral Beach.',
    steps: [
      { type: 'drive', label: 'Get on the scooter' },
      { type: 'goto', x: 51, z: -51, radius: 6, label: 'Pick up the parcel at Rimba Market' },
      { type: 'goto', x: 620, z: -100, radius: 8, label: 'Deliver the parcel to Coral Beach' },
    ],
  },
  {
    id: 2, name: 'Black Market', reward: 300, timeLimit: 300, night: true, wanted: 0,
    start: { x: 60, z: -60 },
    intro: 'Night job: meet the contact at Rimba Market, then run the package to Rimba Harbor.',
    steps: [
      { type: 'onfoot', x: 70, z: -70, radius: 4, label: 'Meet the contact at Rimba Market' },
      { type: 'goto', x: 400, z: 400, radius: 8, label: 'Deliver the package to Rimba Harbor', heat: 1 },
    ],
  },
  {
    id: 3, name: 'Forest Chase', reward: 400, timeLimit: 180, night: false, wanted: 0,
    start: { x: -580, z: -390 },
    intro: 'A getaway jeep is running the forest road. Catch it before it escapes.',
    steps: [
      { type: 'drive', label: 'Get in a car to chase the jeep' },
      { type: 'chase', label: 'Catch the getaway jeep' },
    ],
  },
  {
    id: 4, name: 'Glass Tower', reward: 500, timeLimit: 300, night: false, wanted: 0,
    start: { x: 0, z: 120 },
    intro: 'A briefcase waits at the top of the tallest glass tower downtown. Get it, get out.',
    steps: [
      { type: 'goto', x: null, z: null, radius: 10, label: 'Drive to the glass tower downtown', tower: true },
      { type: 'onfoot', x: null, z: null, radius: 3, label: 'Enter the tower on foot', tower: true, heat: 2 },
      { type: 'goto', x: -50, z: -50, radius: 8, label: 'Deliver the briefcase to Rimba Plaza' },
    ],
  },
  {
    id: 5, name: 'Night Port', reward: 600, timeLimit: 360, night: true, wanted: 0,
    start: { x: 600, z: 380 },
    intro: 'Night escape: reach the harbor, board the boat, sail out past the lighthouse.',
    steps: [
      { type: 'goto', x: 620, z: 380, radius: 10, label: 'Reach Rimba Harbor at night' },
      { type: 'board', label: 'Board the boat at the pier' },
      { type: 'sail', x: 820, z: 300, radius: 20, label: 'Sail to the escape point', heat: 2 },
    ],
  },
  {
    id: 6, name: 'Mountain Road', reward: 1000, timeLimit: 420, night: false, wanted: 0,
    start: { x: -390, z: -290 },
    intro: 'The final job: climb the mountain road to the summit lookout, then lose the police at the beach.',
    steps: [
      { type: 'drive', label: 'Get the jeep at the forest road' },
      { type: 'goto', x: -600, z: -600, radius: 10, label: 'Drive to the mountain base' },
      { type: 'goto', x: -780, z: -780, radius: 12, label: 'Climb to the summit lookout' },
      { type: 'goto', x: 620, z: -100, radius: 12, label: 'Escape to Coral Beach', heat: 3 },
    ],
  },
];

export function missionById(id) {
  return MISSIONS.find((m) => m.id === id) || null;
}

export function createMissions(ctx) {
  const { city, game, player, traffic, wanted, hud } = ctx;
  const onSave = ctx.onSave || (() => {});
  const aabbs = buildingAABBs(city);

  // Tallest downtown building, computed live (Mu's CBD towers move the
  // target — never hard-code the old 67 m building).
  function tallestTower() {
    let best = null;
    for (const b of city.buildings) {
      if (b.zone !== 'downtown') continue;
      if (!best || b.h > best.h) best = b;
    }
    return best;
  }
  // Tower entrance: a point just outside the footprint on the clearest side.
  function towerEntrance() {
    const b = tallestTower();
    if (!b) return { x: 25, z: 145 };
    const sides = [
      { x: b.x, z: b.z + b.d / 2 + 5 },
      { x: b.x, z: b.z - b.d / 2 - 5 },
      { x: b.x + b.w / 2 + 5, z: b.z },
      { x: b.x - b.w / 2 - 5, z: b.z },
    ];
    for (const s of sides) {
      const inside = aabbs.some((a) => s.x > a.x0 && s.x < a.x1 && s.z > a.z0 && s.z < a.z1);
      if (!inside && riverDistance(s.x, s.z) > 14) return s;
    }
    return sides[0];
  }

  const state = {
    status: 'idle', // idle | active | done | failed
    id: 0, stepIdx: 0, timeLeft: 0, failReason: '',
    lastResult: null, // {id, result: 'done'|'failed', reason} of the last finished mission
  };
  const doneIds = [];
  let chaseJeep = null; // mission 3 getaway vehicle (traffic vehicle object)
  let missionBoat = null; // mission 5 escape boat (traffic boat object)

  // The getaway jeep runs a loop of forest-road nodes; after 2 full laps it
  // is gone for good. It drives straight segments (the nodes are on roads).
  const CHASE_ROUTE = [[-600, -400], [-600, -600], [-500, -600], [-500, -400]];
  const CHASE_SPEED = 13;
  function spawnChaseJeep() {
    const [x, z] = CHASE_ROUTE[0];
    const v = {
      id: 9001, type: 'jeep', edge: null, s: 0, lane: 0,
      speed: CHASE_SPEED, targetSpeed: CHASE_SPEED, x, z,
      heading: Math.atan2(0, -1), y: Math.max(0, terrainHeight(x, z)),
      parked: false, driven: true, dwell: 0, mode: 'chase',
      color: [0.9, 0.3, 0.25], route: null, routeIdx: 0,
      wp: 1, laps: 0, escaped: false,
    };
    traffic.vehicles.push(v);
    return v;
  }
  function stepChaseJeep(dt) {
    if (!chaseJeep || chaseJeep.escaped) return;
    const [tx, tz] = CHASE_ROUTE[chaseJeep.wp];
    const dx = tx - chaseJeep.x, dz = tz - chaseJeep.z;
    const d = Math.hypot(dx, dz);
    if (d < 6) {
      chaseJeep.wp = (chaseJeep.wp + 1) % CHASE_ROUTE.length;
      if (chaseJeep.wp === 0) {
        chaseJeep.laps++;
        if (chaseJeep.laps >= 2) chaseJeep.escaped = true;
      }
      return;
    }
    chaseJeep.heading = Math.atan2(dx / d, dz / d);
    chaseJeep.x += (dx / d) * CHASE_SPEED * dt;
    chaseJeep.z += (dz / d) * CHASE_SPEED * dt;
    chaseJeep.y = Math.max(0, terrainHeight(chaseJeep.x, chaseJeep.z));
  }
  function removeChaseJeep() {
    if (!chaseJeep) return;
    const i = traffic.vehicles.indexOf(chaseJeep);
    if (i >= 0) traffic.vehicles.splice(i, 1);
    chaseJeep = null;
  }

  function currentDef() {
    return state.status === 'active' ? missionById(state.id) : null;
  }
  function currentStep() {
    const def = currentDef();
    if (!def) return null;
    return def.steps[state.stepIdx] || null;
  }
  // Resolve a step's target point (tower steps are dynamic).
  function stepTarget(step) {
    if (!step) return null;
    if (step.tower) {
      const e = towerEntrance();
      return { x: e.x, z: e.z, radius: step.radius, onFoot: step.type === 'onfoot', label: step.label };
    }
    if (step.type === 'chase') {
      if (!chaseJeep) return null;
      return { x: chaseJeep.x, z: chaseJeep.z, radius: 7, onFoot: false, label: step.label };
    }
    if (step.type === 'board') {
      if (!missionBoat) return null;
      return { x: missionBoat.x, z: missionBoat.z, radius: 6, onFoot: true, board: true, label: step.label };
    }
    if (step.type === 'drive') return null; // no point on the map
    return { x: step.x, z: step.z, radius: step.radius, onFoot: step.type === 'onfoot', label: step.label };
  }

  function applyStepHeat(step) {
    if (step && step.heat) wanted.addHeat(step.heat);
  }

  function start(id, opts = {}) {
    const def = missionById(id);
    if (!def || state.status === 'active') return false;
    if (doneIds.includes(id) && !opts.replay) return false;
    // Mission setup: night missions set the clock, vehicles spawn.
    if (def.night) game.timeHours = 21.5;
    if (def.id === 1) traffic.spawnParked('scooter', 6, 128, Math.PI);
    if (def.id === 3) {
      traffic.spawnParked('sedan', -575, -385, Math.PI / 2);
      chaseJeep = spawnChaseJeep();
    }
    if (def.id === 5) missionBoat = traffic.spawnParkedBoat(660, 430);
    if (def.id === 6) traffic.spawnParked('jeep', -390, -290, Math.PI / 4);
    state.status = 'active';
    state.id = id;
    state.stepIdx = opts.resumeStep || 0;
    state.timeLeft = def.timeLimit;
    state.failReason = '';
    applyStepHeat(def.steps[state.stepIdx]);
    hud.showHint('Mission started: ' + def.name + ' — ' + def.intro, 8);
    onSave();
    return true;
  }

  function finish(result, reason = '') {
    const def = currentDef();
    if (!def) return;
    if (result === 'done') {
      game.money += def.reward;
      doneIds.push(def.id);
      state.lastResult = { id: def.id, result: 'done', reason: '' };
      hud.showHint('Mission complete: ' + def.name + ' — earned $' + def.reward + '!', 8);
    } else {
      state.lastResult = { id: def.id, result: 'failed', reason };
      hud.showHint('Mission failed: ' + def.name + ' — ' + reason, 8);
    }
    removeChaseJeep();
    state.status = result;
    state.failReason = reason;
    onSave();
    // Back to idle after a beat (the HUD keeps the last result).
    state.status = 'idle';
    state.id = 0;
    state.stepIdx = 0;
    state.timeLeft = 0;
  }

  function fail(reason) {
    if (state.status !== 'active') return;
    finish('failed', reason);
  }

  function advanceStep() {
    const def = currentDef();
    state.stepIdx++;
    if (state.stepIdx >= def.steps.length) {
      finish('done');
      return;
    }
    applyStepHeat(def.steps[state.stepIdx]);
    hud.showHint(def.steps[state.stepIdx].label, 5);
    onSave();
  }

  function step(dt) {
    // Idle: the mission board at Rimba Plaza starts the next job.
    if (state.status === 'idle') {
      const next = MISSIONS.find((m) => !doneIds.includes(m.id));
      if (next && game.started) {
        const d = Math.hypot(player.state.x - MISSION_BOARD.x, player.state.z - MISSION_BOARD.z);
        if (d < 6) start(next.id);
      }
      return;
    }
    if (state.status !== 'active') return;
    const def = currentDef();
    if (!def) return;
    state.timeLeft -= dt;
    if (state.timeLeft <= 0) { fail('Time ran out'); return; }
    stepChaseJeep(dt);
    const s = currentStep();
    if (!s) { finish('done'); return; }
    const px = player.state.x, pz = player.state.z;
    const driving = game.driving;
    if (s.type === 'drive') {
      if (driving) advanceStep();
      return;
    }
    if (s.type === 'chase') {
      if (!chaseJeep) { fail('The getaway car is gone'); return; }
      if (chaseJeep.escaped) { fail('The getaway jeep escaped'); return; }
      if (Math.hypot(chaseJeep.x - px, chaseJeep.z - pz) < 7) advanceStep();
      return;
    }
    if (s.type === 'board') {
      if (driving && (driving.type === 'boat' || driving.type === 'fishingboat' || driving.type === 'sailboat')) {
        advanceStep();
      }
      return;
    }
    if (s.type === 'sail') {
      if (driving && (driving.type === 'boat' || driving.type === 'fishingboat' || driving.type === 'sailboat')) {
        if (Math.hypot(s.x - px, s.z - pz) < s.radius) advanceStep();
      }
      return;
    }
    // goto / onfoot
    const t = stepTarget(s);
    if (!t) return;
    if (s.type === 'onfoot' && driving) return; // must get out first
    if (Math.hypot(t.x - px, t.z - pz) < t.radius) advanceStep();
  }

  function currentTarget() {
    if (state.status !== 'active') return null;
    return stepTarget(currentStep());
  }

  function objectiveText() {
    if (state.status !== 'active') return null;
    const def = currentDef();
    const s = currentStep();
    if (!def || !s) return null;
    const mm = Math.max(0, Math.floor(state.timeLeft / 60));
    const ss = Math.max(0, Math.floor(state.timeLeft % 60));
    const clock = mm + ':' + String(ss).padStart(2, '0');
    return def.name + ' — ' + s.label + ' (' + clock + ')';
  }

  function marker() {
    if (state.status !== 'active') {
      // No mission: point at the mission board so the player finds the jobs.
      return { x: MISSION_BOARD.x, z: MISSION_BOARD.z, board: true };
    }
    const t = currentTarget();
    if (!t) return null;
    return { x: t.x, z: t.z, board: false };
  }

  // Mission 6 opens the mountain (clamp -800); mission 5 lets the player
  // wade to the boat (sea limit 650). Otherwise the normal city bounds.
  // Mission 6 opens the mountain road (x/z down to -800); mission 5 lets
  // the player wade east to the boat at x=660 (the normal +650 world bound
  // would stop the player at the shoreline — the sea limit alone is not
  // enough, the world bound clamps first).
  function worldBound() {
    if (state.status === 'active' && state.id === 6) return { min: -800, max: 650 };
    if (state.status === 'active' && state.id === 5) return { min: -650, max: 665 };
    return { min: -650, max: 650 };
  }
  function seaLimit() {
    if (state.status === 'active' && state.id === 5) return 665; // wade out to the boat
    return 640;
  }

  function saveState() {
    return state.status === 'active' ? { id: state.id, step: state.stepIdx } : null;
  }
  function doneIdsList() { return doneIds.slice(); }
  function restore(save) {
    if (!save) return;
    if (typeof save.money === 'number') game.money = save.money;
    for (const id of save.done || []) {
      if (!doneIds.includes(id) && missionById(id)) doneIds.push(id);
    }
    if (save.active && missionById(save.active.id) && !doneIds.includes(save.active.id)) {
      start(save.active.id, { resumeStep: save.active.step });
    }
  }
  function startPos(id) {
    const def = missionById(id);
    return def ? { x: def.start.x, z: def.start.z } : { x: 0, z: 120 };
  }

  return {
    state, doneIds: doneIdsList,
    start, fail, step, currentTarget, objectiveText, marker,
    worldBound, seaLimit, saveState, restore, startPos,
    tallestTower, towerEntrance,
    get active() { return state.status === 'active'; },
    get chaseJeep() { return chaseJeep; },
    get missionBoat() { return missionBoat; },
  };
}
