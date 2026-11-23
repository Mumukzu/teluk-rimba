// Teluk Rimba — renderer: owns the WebGL2 context, compiles the programs,
// uploads every mesh once, and draws the frame with a day-night light rig.
// Static meshes draw once; vehicles, peds, rain, headlights and the
// lighthouse beam are dynamic instanced meshes refilled every frame.
// Night-only meshes (lit windows, moon, stars, headlights) are skipped in
// daylight. Nothing here knows about missions or input; main.js drives it.
import { createPrograms, createMesh, createInstancedMesh, createDynamicInstancedMesh, updateDynamicInstancedMesh, drawMesh, mat4Identity, mat4Perspective, mat4LookAt, mat4TRS, plainBox } from './gl.js';
import { buildWorldGeoms } from './world.js';
import { buildBuildingMeshes, buildTreeMesh, buildPalmMesh, buildLitWindows } from './buildings.js';
import { buildRoadMesh, buildLampMeshes, buildTrafficLightMesh } from './roads.js';
import { buildBeachPropMeshes } from './beach.js';
import { buildLandmarks } from './landmarks.js';
import { buildMoonGeom, buildStarsSpec } from './sky.js';
import { buildVehicleGeoms, buildVehicleGlassGeoms, headlightGeom } from './vehicles.js';
import { pedTorsoGeom, pedLegsGeom, pedHeadGeom, pedHairGeom } from './peds.js';
import { buildWetGeoms } from './weather.js';
import { buildNightLightGeoms } from './nightlights.js';
import { buildPlotDressing } from './plots.js';
import { heliBodyGeom, heliRotorGeom, planeGeom, heliBeamConeGeom, markerGeom } from './air.js';
import { wedgeGeom } from './extras.js';
import { DAY_LENGTH } from './config.js';

const MOON_POS = [-420, 380, -720];

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
  const palmMesh = buildPalmMesh(city);
  const litWindows = buildLitWindows(city);
  const lampMeshes = buildLampMeshes(city);
  const trafficMesh = buildTrafficLightMesh(city);
  const beachMeshes = buildBeachPropMeshes(city);
  const landmarks = buildLandmarks(city);
  const stars = buildStarsSpec();
  const wet = buildWetGeoms();
  const nightPools = buildNightLightGeoms(city, landmarks);
  const plotDressing = buildPlotDressing(city);
  const vehicleGeoms = buildVehicleGeoms();
  const vehicleGlassGeoms = buildVehicleGlassGeoms();

  const meshes = [];
  const addStatic = (prog, geom, model, extra = {}) => {
    const m = createMesh(gl, prog, geom);
    meshes.push({ mesh: m, prog, model, ...extra });
    return m;
  };
  const addInst = (prog, spec, extra = {}) => {
    const m = createInstancedMesh(gl, prog, spec.geom, spec.matrices, spec.tints);
    meshes.push({ mesh: m, prog, model: mat4Identity(), ...extra });
    return m;
  };
  const dynamicMeshes = {};
  const addDyn = (prog, geom, capacity, name) => {
    const m = createDynamicInstancedMesh(gl, prog, geom, capacity);
    dynamicMeshes[name] = { mesh: m, prog };
    return m;
  };

  addStatic(progs.lit, world.terrain, mat4Identity());
  addStatic(progs.lit, world.sea, mat4Identity());
  addStatic(progs.lit, world.river, mat4Identity());
  addStatic(progs.lit, world.volcano, mat4Identity());
  addStatic(progs.lit, world.dirtTrack, mat4Identity()); // mountain road (mission 6)
  addStatic(progs.lit, buildRoadMesh(city), mat4Identity());
  addInst(progs.litInst, buildingMeshes.buildings);
  addInst(progs.litInst, buildingMeshes.roofs);
  addInst(progs.litInst, buildingMeshes.tiers);
  addInst(progs.litInst, buildingMeshes.spires);
  addInst(progs.litInst, buildingMeshes.crowns);
  // Plot dressing: light-grey paving + parked cars, fences, flowers,
  // benches in dense and residential blocks (Mu: no plain green yards).
  addStatic(progs.lit, plotDressing.paving, mat4Identity());
  addStatic(progs.lit, plotDressing.props, mat4Identity());
  addInst(progs.litInst, treeMesh);
  addInst(progs.litInst, palmMesh);
  addInst(progs.litInst, lampMeshes.poles);
  addInst(progs.unlitInst, lampMeshes.heads);
  addInst(progs.unlitInst, trafficMesh);
  addStatic(progs.lit, beachMeshes.poles, mat4Identity());
  addInst(progs.litInst, beachMeshes.umbrella);
  addInst(progs.litInst, beachMeshes.lounger);
  addInst(progs.litInst, beachMeshes.ring);
  addInst(progs.litInst, beachMeshes.ball);
  // Landmarks: night market, vendors, plaza, bus stops, SPBU+bengkel, pier,
  // lighthouse tower, billboard poles.
  addInst(progs.litInst, landmarks.stalls);
  addStatic(progs.lit, landmarks.marketPoles, mat4Identity());
  addInst(progs.unlitInst, landmarks.lightDots);
  addStatic(progs.lit, landmarks.vendorGeom, mat4Identity());
  addStatic(progs.lit, landmarks.plazaGeom, mat4Identity());
  addStatic(progs.lit, landmarks.busStopGeom, mat4Identity());
  addStatic(progs.lit, landmarks.stationGeom, mat4Identity());
  addStatic(progs.lit, landmarks.billboardPoles, mat4Identity());
  addInst(progs.unlitInst, landmarks.billboards);
  addStatic(progs.lit, landmarks.pierGeom, mat4Identity());
  addStatic(progs.lit, landmarks.lighthouseGeom, mat4Identity());
  addInst(progs.unlitInst, landmarks.glow);
  // Night sky: lit windows + moon + stars, drawn only at night.
  addInst(progs.unlitInst, litWindows, { nightOnly: true });
  addInst(progs.unlitInst, { geom: buildMoonGeom(), matrices: [mat4TRS(MOON_POS[0], MOON_POS[1], MOON_POS[2], 0, 1, 1, 1)], tints: [[1, 1, 1]] }, { nightOnly: true });
  addInst(progs.unlitInst, stars, { nightOnly: true });
  // Wet roads (transparent, only while wet) + puddles.
  addStatic(progs.transp, wet.overlay, mat4Identity(), { transparent: true, alpha: 0.35, wetOnly: true });
  addStatic(progs.transp, wet.puddles, mat4Identity(), { transparent: true, alpha: 0.3, wetOnly: true });
  // Night light pools (transparent, only at night): warm glow on the
  // streets around lamps, market, plaza, pier and shopfronts.
  addStatic(progs.transp, nightPools.pools, mat4Identity(), { transparent: true, alpha: 0.38, nightOnly: true });
  // Clouds drift: three separate static meshes sharing one geometry.
  const cloudMesh = createMesh(gl, progs.lit, world.clouds);
  const cloudModels = [
    { x: -300, y: 190, z: -200, dx: 0.6 },
    { x: 200, y: 210, z: 300, dx: 0.4 },
    { x: -100, y: 175, z: 500, dx: 0.5 },
  ];
  // Dynamic instanced meshes: one per vehicle type + peds (3 parts) +
  // rain streaks + headlights + the lighthouse beam.
  for (const [type, geom] of Object.entries(vehicleGeoms)) {
    addDyn(progs.litInst, geom, type === 'motorbike' ? 100 : type === 'scooter' ? 50 : type === 'car' ? 40 : 30, 'veh_' + type);
  }
  // Transparent glass per vehicle type (same instances as the bodies,
  // always tinted white — see main.js buildDynamics).
  for (const [type, geom] of Object.entries(vehicleGlassGeoms)) {
    if (!geom.pos.length) continue;
    addDyn(progs.transpInst, geom, type === 'motorbike' ? 100 : type === 'scooter' ? 50 : type === 'car' ? 40 : 30, 'vehglass_' + type);
  }
  addDyn(progs.litInst, pedTorsoGeom(), 340, 'ped_torso');
  addDyn(progs.litInst, pedLegsGeom(), 340, 'ped_legs');
  addDyn(progs.litInst, pedHeadGeom(), 340, 'ped_heads');
  addDyn(progs.litInst, pedHairGeom(), 340, 'ped_hair');
  addDyn(progs.litInst, plainBox(0.06, 1.2, 0.06, [1, 1, 1]), 260, 'rain');
  addDyn(progs.unlitInst, headlightGeom(), 240, 'headlights');
  addDyn(progs.transpInst, landmarks.beamGeom, 1, 'beam');
  // Aircraft: police helicopter (body + spinning rotor), daytime plane,
  // heli spotlight cone (night only), mission marker column.
  addDyn(progs.litInst, heliBodyGeom(), 1, 'heli');
  addDyn(progs.litInst, heliRotorGeom(), 1, 'heliRotor');
  addDyn(progs.litInst, planeGeom(), 1, 'plane');
  addDyn(progs.transpInst, heliBeamConeGeom(), 1, 'heliBeam');
  addDyn(progs.unlitInst, markerGeom(), 1, 'marker');
  // Phase E2: hidden coins (spinning gold discs) + stunt ramps (wedges).
  addDyn(progs.unlitInst, plainBox(0.9, 0.9, 0.15, [1, 0.84, 0.2]), 12, 'coins');
  addDyn(progs.litInst, wedgeGeom(), 4, 'ramps');
  // Flat 1x1 ground quad (up-facing) for headlight beams + water flow.
  const flatQuadGeom = (() => {
    const g = { pos: [], nrm: [], col: [] };
    const n = [0, 1, 0], white = [1, 1, 1];
    g.pos.push(-0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0, -0.5, -0.5, 0, -0.5, -0.5, 0, 0.5, 0.5, 0, 0.5);
    for (let k = 0; k < 6; k++) { g.nrm.push(...n); g.col.push(...white); }
    return g;
  })();
  addDyn(progs.transpInst, flatQuadGeom, 220, 'headbeams');
  addDyn(progs.transpInst, flatQuadGeom, 48, 'flow');

  let calls = 0, tris = 0;

  // Sun rig for a given time of day (hours 0-24). Returns sky/fog colours.
  // Night is dark (horizon stays dark) but alive: moonlight lifts the
  // ambient a touch, and the lit windows / lamps / neon carry the glitter.
  function lightFor(timeHours, rainAmt = 0) {
    const dayT = (timeHours - 6) / 12; // 0 at 06:00, 1 at 18:00
    const elev = Math.sin(dayT * Math.PI); // 0 at dawn/dusk, 1 at noon
    const isDay = timeHours >= 6 && timeHours < 18;
    const sunDir = [-0.45, -(0.25 + 0.75 * Math.max(0, elev)), -0.55];
    const l = Math.hypot(...sunDir);
    const sun = [sunDir[0] / l, sunDir[1] / l, sunDir[2] / l];
    const warm = 1 - Math.max(0, elev); // low sun = warm
    let sunColor = isDay
      ? [0.9 + 0.1 * warm, 0.85, 0.75 + 0.15 * elev]
      : [0.42, 0.48, 0.62]; // moonlight, cool blue — strong enough to read the streets
    let ambient = isDay
      ? [0.42 + 0.18 * elev, 0.42 + 0.18 * elev, 0.45 + 0.15 * elev]
      : [0.33, 0.35, 0.43]; // night ambient: trees, people and cars stay visible, sky stays dark
    let sky = isDay
      ? [0.3 + 0.1 * elev + 0.25 * warm, 0.55 + 0.12 * elev - 0.1 * warm, 0.92 - 0.35 * warm]
      : [0.03, 0.05, 0.1]; // day sky: clear fresh blue (Mu), not pale
    if (rainAmt > 0) {
      const k = rainAmt * 0.4;
      sunColor = sunColor.map((c) => c * (1 - k));
      ambient = ambient.map((c) => c * (1 - k * 0.5));
      sky = [sky[0] * (1 - k) + 0.45 * k, sky[1] * (1 - k) + 0.48 * k, sky[2] * (1 - k) + 0.52 * k];
    }
    return { sun, sunColor, ambient, sky, isDay };
  }

  function render(state) {
    const { eye, center, timeHours, playerMesh, elapsed } = state;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
    const rainAmt = state.weather ? state.weather.rain : 0;
    const wetAmt = state.weather ? state.weather.wet : 0;
    const light = lightFor(timeHours, rainAmt);
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
    const drawEntry = (entry) => {
      if (entry.nightOnly && light.isDay) return;
      if (entry.wetOnly && wetAmt < 0.05) return;
      const uniforms = { ...common, uModel: entry.model };
      if (entry.transparent) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        uniforms.uAlpha = entry.alpha * (entry.wetOnly ? wetAmt : 1);
        tris += drawMesh(gl, entry.prog, entry.mesh, uniforms);
        gl.disable(gl.BLEND);
      } else {
        tris += drawMesh(gl, entry.prog, entry.mesh, uniforms);
      }
      calls++;
    };
    for (const entry of meshes) drawEntry(entry);
    // Player figure.
    if (playerMesh) {
      tris += drawMesh(gl, progs.lit, playerMesh, { ...common, uModel: state.playerModel });
      calls++;
    }
    // Dynamic instanced meshes, refilled from state.dynamics.
    const dyn = state.dynamics || {};
    for (const [name, entry] of Object.entries(dynamicMeshes)) {
      const spec = dyn[name];
      if (!spec || !spec.matrices || spec.matrices.length === 0) continue;
      if (name === 'beam' && light.isDay) continue;
      if (name === 'heliBeam' && light.isDay) continue;
      if (name === 'headlights' && light.isDay) continue;
      if (name === 'headbeams' && light.isDay) continue;
      if (name === 'rain' && rainAmt < 0.05) continue;
      updateDynamicInstancedMesh(gl, entry.mesh, spec.matrices, spec.tints);
      const uniforms = { ...common, uModel: mat4Identity() };
      const blendAlpha = name.startsWith('vehglass_') ? 0.42
        : { beam: 0.12, headbeams: 0.14, flow: 0.3, heliBeam: 0.15 }[name];
      if (blendAlpha !== undefined) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        uniforms.uAlpha = blendAlpha;
        tris += drawMesh(gl, entry.prog, entry.mesh, uniforms);
        gl.disable(gl.BLEND);
      } else {
        tris += drawMesh(gl, entry.prog, entry.mesh, uniforms);
      }
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
    landmarks,
  };
}
