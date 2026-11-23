// Teluk Rimba — the player on foot: WASD movement, building collision,
// third-person follow camera with drag orbit + wheel zoom.
import { PLAYER, CAMERA, WORLD } from './config.js';
import { terrainHeight, buildingAABBs } from './city.js';
import { plainBox, mat4TRS, mat4RotX, mat4Multiply } from './gl.js';
import { pedTorsoGeom, pedArmGeom, pedLegGeom, pedHeadGeom, pedHairShortGeom } from './peds.js';

export function createPlayer(city, startX, startZ) {
  const aabbs = buildingAABBs(city);
  const state = {
    x: startX, z: startZ, y: 0,
    facing: 0, // radians, direction the player walks
    camYaw: Math.PI * 0.75, camPitch: 0.32, camDist: CAMERA.distance,
    moving: false,
    boost: 1, // energy-drink multiplier (1 = normal, 1.4 while boosted)
    worldMin: -WORLD.bound, worldMax: WORLD.bound, // missions may widen these
    seaX: WORLD.seaX, // missions may let the player wade further out
  };
  state.y = Math.max(0, terrainHeight(state.x, state.z));

  // Mission 6 opens the mountain (clamp -800); mission 5 lets the player
  // wade to the boat. Called every frame by main.js from mission state.
  function setWorldBound(bound) {
    state.worldMin = bound.min;
    state.worldMax = bound.max;
  }
  function setSeaLimit(limit) { state.seaX = limit; }
  // Energy-drink speed boost (shop phase): walk/run speed multiplier.
  function setBoost(mult) { state.boost = mult; }
  // Stunt ramps (shop phase): the player walks up the wedge instead of
  // clipping through it. main.js installs the ramp height function.
  let rampHeightAt = () => 0;
  function setRampFn(fn) { rampHeightAt = fn || (() => 0); }

  function collide(nx, nz) {
    const r = PLAYER.radius;
    for (const b of aabbs) {
      if (nx + r > b.x0 && nx - r < b.x1 && nz + r > b.z0 && nz - r < b.z1) return true;
    }
    return false;
  }

  function step(input, dt) {
    const fwd = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
    const strafe = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    state.moving = fwd !== 0 || strafe !== 0;
    state.running = state.moving && !!input.run;
    if (state.moving) state.phase += dt * (state.running ? 9 : 5.5);
    const drag = input.takeDrag();
    state.camYaw -= drag.dx * 0.005;
    state.camPitch += drag.dy * 0.004;
    state.camPitch = Math.max(0.08, Math.min(1.1, state.camPitch));
    state.camDist += input.takeWheel() * 0.01;
    state.camDist = Math.max(CAMERA.minDistance, Math.min(CAMERA.maxDistance, state.camDist));
    if (state.moving) {
      const speed = (input.run ? PLAYER.runSpeed : PLAYER.walkSpeed) * state.boost;
      const sin = Math.sin(state.camYaw), cos = Math.cos(state.camYaw);
      // Camera looks toward -Z rotated by yaw; forward is away from camera.
      let mx = (-sin * fwd + -cos * strafe);
      let mz = (-cos * fwd + sin * strafe);
      const len = Math.hypot(mx, mz) || 1;
      mx /= len; mz /= len;
      state.facing = Math.atan2(mx, mz);
      const nx = state.x + mx * speed * dt;
      const nz = state.z + mz * speed * dt;
      // Axis-separated movement so the player slides along walls.
      if (!collide(nx, state.z)) state.x = nx;
      if (!collide(state.x, nz)) state.z = nz;
      state.x = Math.max(state.worldMin, Math.min(state.worldMax, state.x));
      state.z = Math.max(state.worldMin, Math.min(state.worldMax, state.z));
      if (state.x > state.seaX) state.x = state.seaX;
      state.y = Math.max(0, terrainHeight(state.x, state.z)) + rampHeightAt(state.x, state.z);
    }
  }

  function camera() {
    const eye = [
      state.x + Math.sin(state.camYaw) * Math.cos(state.camPitch) * state.camDist,
      state.y + 1.6 + Math.sin(state.camPitch) * state.camDist,
      state.z + Math.cos(state.camYaw) * Math.cos(state.camPitch) * state.camDist,
    ];
    const center = [state.x, state.y + 1.6, state.z];
    return { eye, center };
  }

  // Wowok's look (Mu's reference: red jacket open over a white shirt,
  // dark navy pants, black block shoes, short black hair, ears visible).
  // Distinctive — no NPC uses this exact set.
  const WOWOK = {
    jacket: [0.85, 0.16, 0.14], shirt: [0.95, 0.93, 0.88],
    pants: [0.12, 0.14, 0.28], skin: [0.85, 0.65, 0.5],
    hair: [0.12, 0.1, 0.1],
  };
  // Walk phase (advances while moving — drives the arm/leg swing).
  state.phase = 0;

  // Driver's seat offset per vehicle type (local frame, forward = +x):
  // cars sit in the cabin, bus/truck/firetruck/ambulance at the front cab,
  // bikes on the saddle (leaning slightly forward).
  function seatOffset(type) {
    switch (type) {
      case 'bus': return { x: 3.8, y: 0.6, z: -0.6, lean: 0 };
      case 'truck': return { x: 2.8, y: 0.7, z: -0.5, lean: 0 };
      case 'firetruck': return { x: 3.0, y: 0.7, z: -0.5, lean: 0 };
      case 'ambulance': return { x: 1.9, y: 0.6, z: -0.4, lean: 0 };
      case 'motorbike': return { x: -0.1, y: 0.78, z: 0, lean: 0.15 };
      case 'scooter': return { x: -0.1, y: 0.78, z: 0, lean: 0.1 };
      default: return { x: -0.2, y: 0.55, z: -0.35, lean: 0 };
    }
  }

  // Per-part matrices for the animated player (one instance per part, 8
  // instanced draws): torso / armL / armR / legL / legR / head / hair /
  // shirtFront. Walk/run: opposite arm/leg swing + a slight run lean; idle:
  // slow breathing; driving: SEATED in the vehicle, hands forward on the
  // wheel / handlebar, thighs forward, shins down.
  function partMatrices(driving) {
    const t = performance.now() / 160;
    const moving = state.moving && !driving;
    const running = moving && state.running;
    const amp = moving ? (running ? 0.55 : 0.38) : 0;
    const swing = Math.sin(state.phase) * amp;
    const breathe = !moving && !driving ? 1 + 0.012 * Math.sin(t * 0.4) : 1;
    const bob = Math.sin(state.phase) * 0.04 * (moving ? 1 : 0);
    const s = 1;
    let base, lean = 0;
    if (driving) {
      const seat = seatOffset(driving.type);
      lean = seat.lean;
      const ch = Math.cos(driving.heading), sh = Math.sin(driving.heading);
      // Seat position in world space: the vehicle's local frame has its
      // front at +x, so the offset rotates by heading - π/2 (mat4TRS maps
      // +Z to the heading direction; +x is the vehicle's forward).
      const sx = driving.x + seat.x * sh - seat.z * ch;
      const sz = driving.z + seat.x * ch + seat.z * sh;
      base = mat4TRS(sx, driving.y + seat.y - 0.9, sz, driving.heading, s, s, s);
    } else {
      lean = running ? 0.1 : 0;
      base = mat4TRS(state.x, state.y + bob, state.z, state.facing, s, s * breathe, s);
    }
    // Lean pivots at the hips (y 0.9) so the upper body tilts without
    // sliding off the legs.
    const hip = mat4TRS(0, 0.9, 0, 0, 1, 1, 1);
    const hipInv = mat4TRS(0, -0.9, 0, 0, 1, 1, 1);
    const upper = lean !== 0
      ? mat4Multiply(mat4Multiply(base, mat4Multiply(hip, mat4RotX(lean))), hipInv)
      : base;
    const seated = !!driving;
    const torsoM = seated ? base : upper;
    const shoulderL = mat4TRS(-0.28, 1.40, 0, 0, 1, 1, 1);
    const shoulderR = mat4TRS(0.28, 1.40, 0, 0, 1, 1, 1);
    const armSwingL = seated ? -1.0 : -swing; // driving: both arms forward
    const armSwingR = seated ? -1.0 : swing;
    const armL = mat4Multiply(mat4Multiply(torsoM, shoulderL), mat4RotX(armSwingL));
    const armR = mat4Multiply(mat4Multiply(torsoM, shoulderR), mat4RotX(armSwingR));
    const hipL = mat4TRS(-0.11, 0.90, 0, 0, 1, 1, 1);
    const hipR = mat4TRS(0.11, 0.90, 0, 0, 1, 1, 1);
    const legBase = mat4TRS(
      driving ? base[12] : state.x, driving ? base[13] : state.y + bob, driving ? base[14] : state.z,
      driving ? driving.heading : state.facing, s, s, s);
    const legSwingL = seated ? 0.8 : swing;
    const legSwingR = seated ? 0.8 : -swing;
    const legL = mat4Multiply(mat4Multiply(legBase, hipL), mat4RotX(legSwingL));
    const legR = mat4Multiply(mat4Multiply(legBase, hipR), mat4RotX(legSwingR));
    // White shirt front (open red jacket): a thin panel on the chest, so
    // Wowok reads as jacket-over-shirt from the front (Mu's reference).
    // It rides on the torso matrix, so it follows the lean + breathing.
    const shirtM = mat4Multiply(torsoM, mat4TRS(0, 1.25, 0.16, 0, 1, 1, 1));
    return {
      torso: { matrices: [torsoM], tints: [WOWOK.jacket] },
      armL: { matrices: [armL], tints: [WOWOK.jacket] },
      armR: { matrices: [armR], tints: [WOWOK.jacket] },
      legL: { matrices: [legL], tints: [WOWOK.pants] },
      legR: { matrices: [legR], tints: [WOWOK.pants] },
      head: { matrices: [torsoM], tints: [WOWOK.skin] },
      hair: { matrices: [torsoM], tints: [WOWOK.hair] },
      shirtFront: { matrices: [shirtM], tints: [WOWOK.shirt] },
    };
  }

  // Player figure: a real humanoid (same ~7-head base model as the NPCs),
  // merged into ONE mesh — used as the fallback / test figure. The live
  // game draws the animated parts (partMatrices) instead.
  function figureGeom() {
    const g = { pos: [], nrm: [], col: [] };
    const tint = (part, c) => {
      for (let i = 0; i < part.col.length; i += 3) { part.col[i] *= c[0]; part.col[i + 1] *= c[1]; part.col[i + 2] *= c[2]; }
      return part;
    };
    const shift = (part, x, y, z) => {
      for (let i = 0; i < part.pos.length; i += 3) { part.pos[i] += x; part.pos[i + 1] += y; part.pos[i + 2] += z; }
      return part;
    };
    const add = (p) => { g.pos.push(...p.pos); g.nrm.push(...p.nrm); g.col.push(...p.col); };
    add(tint(pedTorsoGeom(), WOWOK.jacket));
    add(tint(shift(pedArmGeom(-1), -0.28, 1.40, 0), WOWOK.jacket));
    add(tint(shift(pedArmGeom(1), 0.28, 1.40, 0), WOWOK.jacket));
    add(tint(shift(pedLegGeom(-1), 0, 0.90, 0), WOWOK.pants));
    add(tint(shift(pedLegGeom(1), 0, 0.90, 0), WOWOK.pants));
    add(tint(pedHeadGeom(), WOWOK.skin));
    add(tint(pedHairShortGeom(), WOWOK.hair));
    add(tint(shift(plainBox(0.30, 0.45, 0.03, [1, 1, 1]), 0, 1.25, 0.16), WOWOK.shirt));
    return g;
  }

  return { state, step, camera, figureGeom, partMatrices, setWorldBound, setSeaLimit, setBoost, setRampFn };
}
