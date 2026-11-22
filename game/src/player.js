// Teluk Rimba — the player on foot: WASD movement, building collision,
// third-person follow camera with drag orbit + wheel zoom.
import { PLAYER, CAMERA, WORLD } from './config.js';
import { terrainHeight, buildingAABBs } from './city.js';
import { plainBox } from './gl.js';

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

  // Player figure: shirt body + head with a face (eyes + hair) + legs,
  // one merged geometry with vertex colours.
  function figureGeom() {
    const body = plainBox(0.55, 0.85, 0.32, [0.85, 0.3, 0.25]);
    for (let i = 0; i < body.pos.length; i += 3) body.pos[i + 1] += 1.05;
    const head = plainBox(0.34, 0.34, 0.32, [0.85, 0.65, 0.5]);
    for (let i = 0; i < head.pos.length; i += 3) head.pos[i + 1] += 1.65;
    const hair = plainBox(0.36, 0.12, 0.34, [0.15, 0.12, 0.1]);
    for (let i = 0; i < hair.pos.length; i += 3) hair.pos[i + 1] += 1.86;
    const legs = plainBox(0.5, 0.6, 0.3, [0.2, 0.25, 0.35]);
    for (let i = 0; i < legs.pos.length; i += 3) legs.pos[i + 1] += 0.3;
    const g = { pos: [], nrm: [], col: [] };
    for (const p of [body, head, hair, legs]) {
      g.pos.push(...p.pos); g.nrm.push(...p.nrm); g.col.push(...p.col);
    }
    for (const dx of [-0.08, 0.08]) {
      const eye = plainBox(0.06, 0.08, 0.04, [0.1, 0.1, 0.12]);
      for (let i = 0; i < eye.pos.length; i += 3) { eye.pos[i] += dx; eye.pos[i + 1] += 1.68; eye.pos[i + 2] += 0.17; }
      g.pos.push(...eye.pos); g.nrm.push(...eye.nrm); g.col.push(...eye.col);
    }
    return g;
  }

  return { state, step, camera, figureGeom, setWorldBound, setSeaLimit, setBoost, setRampFn };
}
