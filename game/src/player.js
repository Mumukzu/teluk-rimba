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
  };
  state.y = Math.max(0, terrainHeight(state.x, state.z));

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
      const speed = input.run ? PLAYER.runSpeed : PLAYER.walkSpeed;
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
      state.x = Math.max(-WORLD.bound, Math.min(WORLD.bound, state.x));
      state.z = Math.max(-WORLD.bound, Math.min(WORLD.bound, state.z));
      if (state.x > WORLD.seaX) state.x = WORLD.seaX;
      state.y = Math.max(0, terrainHeight(state.x, state.z));
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

  // Player figure: shirt body + head, one merged geometry with vertex colours.
  function figureGeom() {
    const body = plainBox(0.55, 0.85, 0.32, [0.85, 0.3, 0.25]);
    for (let i = 0; i < body.pos.length; i += 3) body.pos[i + 1] += 1.05;
    const head = plainBox(0.34, 0.34, 0.32, [0.85, 0.65, 0.5]);
    for (let i = 0; i < head.pos.length; i += 3) head.pos[i + 1] += 1.65;
    const legs = plainBox(0.5, 0.6, 0.3, [0.2, 0.25, 0.35]);
    for (let i = 0; i < legs.pos.length; i += 3) legs.pos[i + 1] += 0.3;
    const g = { pos: [], nrm: [], col: [] };
    for (const p of [body, head, legs]) {
      g.pos.push(...p.pos); g.nrm.push(...p.nrm); g.col.push(...p.col);
    }
    return g;
  }

  return { state, step, camera, figureGeom };
}
