// Teluk Rimba — renderer: owns the WebGL2 context, compiles the programs,
// uploads every mesh once, and draws the frame with a day-night light rig.
// Nothing here knows about missions or input; main.js drives it.
import { createPrograms, createMesh, createInstancedMesh, drawMesh, mat4Identity, mat4Perspective, mat4LookAt } from './gl.js';
import { buildWorldGeoms } from './world.js';
import { buildBuildingMeshes, buildTreeMesh } from './buildings.js';
import { buildRoadMesh, buildLampMeshes, buildTrafficLightMesh } from './roads.js';
import { DAY_LENGTH } from './config.js';

export function createRenderer(canvas, city) {
  const gl = canvas.getContext('webgl2', { antialias: true });
  if (!gl) throw new Error('WebGL2 is not available in this browser');
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);

  const progs = createPrograms(gl);
  const world = buildWorldGeoms();
  const buildingMeshes = buildBuildingMeshes(gl, progs, city);
  const treeMesh = buildTreeMesh(gl, progs, city);
  const lampMeshes = buildLampMeshes(city);
  const trafficMesh = buildTrafficLightMesh(city);

  const meshes = [];
  const addStatic = (prog, geom, model) => {
    const m = createMesh(gl, prog, geom);
    meshes.push({ mesh: m, prog, model });
    return m;
  };
  const addInst = (prog, spec) => {
    const m = createInstancedMesh(gl, prog, spec.geom, spec.matrices, spec.tints);
    meshes.push({ mesh: m, prog, model: mat4Identity() });
    return m;
  };

  addStatic(progs.lit, world.terrain, mat4Identity());
  addStatic(progs.lit, world.sea, mat4Identity());
  addStatic(progs.lit, world.river, mat4Identity());
  addStatic(progs.lit, world.volcano, mat4Identity());
  addStatic(progs.lit, buildRoadMesh(city), mat4Identity());
  addInst(progs.litInst, buildingMeshes.buildings);
  addInst(progs.litInst, buildingMeshes.roofs);
  addInst(progs.litInst, treeMesh);
  addInst(progs.litInst, lampMeshes.poles);
  addInst(progs.unlitInst, lampMeshes.heads);
  addInst(progs.unlitInst, trafficMesh);
  // Clouds drift: three separate static meshes sharing one geometry.
  const cloudMesh = createMesh(gl, progs.lit, world.clouds);
  const cloudModels = [
    { x: -300, y: 190, z: -200, dx: 0.6 },
    { x: 200, y: 210, z: 300, dx: 0.4 },
    { x: -100, y: 175, z: 500, dx: 0.5 },
  ];

  let calls = 0, tris = 0;

  // Sun rig for a given time of day (hours 0-24). Returns sky/fog colours.
  function lightFor(timeHours) {
    const dayT = (timeHours - 6) / 12; // 0 at 06:00, 1 at 18:00
    const elev = Math.sin(dayT * Math.PI); // 0 at dawn/dusk, 1 at noon
    const isDay = timeHours >= 6 && timeHours < 18;
    const sunDir = [-0.45, -(0.25 + 0.75 * Math.max(0, elev)), -0.55];
    const l = Math.hypot(...sunDir);
    const sun = [sunDir[0] / l, sunDir[1] / l, sunDir[2] / l];
    const warm = 1 - Math.max(0, elev); // low sun = warm
    const sunColor = isDay
      ? [0.9 + 0.1 * warm, 0.85, 0.75 + 0.15 * elev]
      : [0.12, 0.16, 0.28];
    const ambient = isDay
      ? [0.42 + 0.18 * elev, 0.42 + 0.18 * elev, 0.45 + 0.15 * elev]
      : [0.14, 0.16, 0.22];
    const sky = isDay
      ? [0.45 + 0.25 * elev - 0.25 * warm, 0.62 + 0.15 * elev - 0.2 * warm, 0.82 - 0.25 * warm]
      : [0.03, 0.05, 0.1];
    return { sun, sunColor, ambient, sky, isDay };
  }

  function render(state) {
    const { eye, center, timeHours, playerMesh, elapsed } = state;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
    const light = lightFor(timeHours);
    gl.clearColor(light.sky[0], light.sky[1], light.sky[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const proj = mat4Perspective((55 * Math.PI) / 180, canvas.width / canvas.height, 0.5, 4000);
    const view = mat4LookAt(eye, center, [0, 1, 0]);
    const common = {
      uProj: proj, uView: view,
      uSunDir: light.sun, uSunColor: light.sunColor, uAmbient: light.ambient,
      uFogColor: light.sky, uFogNear: 500, uFogFar: 2600,
    };
    calls = 0; tris = 0;
    for (const entry of meshes) {
      tris += drawMesh(gl, entry.prog, entry.mesh, { ...common, uModel: entry.model });
      calls++;
    }
    // Player figure.
    if (playerMesh) {
      tris += drawMesh(gl, progs.lit, playerMesh, { ...common, uModel: state.playerModel });
      calls++;
    }
    // Clouds drift slowly with time.
    for (const c of cloudModels) {
      const model = mat4Identity();
      model[12] = c.x + ((elapsed * c.dx) % 1400) - 700;
      model[13] = c.y; model[14] = c.z;
      tris += drawMesh(gl, progs.lit, cloudMesh, { ...common, uModel: model });
      calls++;
    }
  }

  return {
    gl, render, lightFor,
    makePlayerMesh(geom) { return createMesh(gl, progs.lit, geom); },
    get calls() { return calls; },
    get tris() { return tris; },
    dayLength: DAY_LENGTH,
  };
}
