// Teluk Rimba — renderer: owns the WebGL2 context, compiles the programs,
// uploads every mesh once, and draws the frame with a day-night light rig.
// Static meshes draw once; vehicles, peds, rain, headlights and the
// lighthouse beam are dynamic instanced meshes refilled every frame.
// Night-only meshes (lit windows, moon, stars, headlights) are skipped in
// daylight. Nothing here knows about missions or input; main.js drives it.
import { createPrograms, createMesh, createInstancedMesh, createDynamicInstancedMesh, updateDynamicInstancedMesh, drawMesh, createTexturedMesh, createCanvasTexture, mat4Identity, mat4Perspective, mat4LookAt, mat4TRS, plainBox } from './gl.js';
import { buildWorldGeoms } from './world.js';
import { buildBuildingMeshes, buildTreeMesh, buildPalmMesh, buildLitWindows } from './buildings.js';
import { buildRoadMesh, buildLampMeshes, buildTrafficLightMesh } from './roads.js';
import { buildDirectionSigns } from './signs.js';
import { buildShopSigns } from './shopsigns.js';
import { buildRooftopSigns } from './rooftopsigns.js';
import { buildShopGlow } from './shopglow.js';
import { buildBeachPropMeshes } from './beach.js';
import { buildLandmarks } from './landmarks.js';
import { buildMoonGeom, buildStarsSpec, buildSkyDomeGeom, buildCloudSpec, skyColors } from './sky.js';
import { buildVehicleBodyGeoms, buildVehicleGlassGeoms, headlightGeom, buildWheelGeom, buildWheelGeomFar, buildBikeFrontGeom, beamConeGeom, beamPoolGeom, tailGeom, beaconGeom } from './vehicles.js';
import { pedTorsoGeom, pedWowokTorsoGeom, pedArmGeom, pedLegGeom, pedSkirtGeom, pedHeadGeom, pedHairShortGeom, pedHairLongGeom, pedBadgeGeom, fishingRodGeom } from './peds.js';
import { buildWetGeoms } from './weather.js';
import { buildNightLightGeoms } from './nightlights.js';
import { buildPlotDressing } from './plots.js';
import { buildRiverfront } from './riverfront.js';
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
  const signs = buildDirectionSigns(city);
  const signTexture = createCanvasTexture(gl, signs.atlasCanvas);
  const shopSigns = buildShopSigns(city);
  const shopSignTexture = createCanvasTexture(gl, shopSigns.atlasCanvas);
  const rooftopSigns = buildRooftopSigns(city);
  const rooftopSignTexture = rooftopSigns.atlasCanvas
    ? createCanvasTexture(gl, rooftopSigns.atlasCanvas) : null;
  const shopGlow = buildShopGlow(city);
  const stars = buildStarsSpec();
  const wet = buildWetGeoms();
  const nightPools = buildNightLightGeoms(city, landmarks);
  const plotDressing = buildPlotDressing(city);
  const riverfront = buildRiverfront(city); // Phase I: river banks, caps, docks, parks (+2 draws)
  const vehicleGeoms = buildVehicleBodyGeoms(); // no wheels: the shared wheel mesh supplies them
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
  addStatic(progs.lit, world.waterfall, mat4Identity());
  addStatic(progs.lit, world.volcano, mat4Identity());
  addStatic(progs.lit, world.dirtTrack, mat4Identity()); // mountain road (mission 6)
  addStatic(progs.lit, buildRoadMesh(city), mat4Identity());
  for (const spec of buildingMeshes.bases) addInst(progs.litInst, spec);
  addInst(progs.litInst, buildingMeshes.roofs);
  addInst(progs.litInst, buildingMeshes.tiers);
  addInst(progs.litInst, buildingMeshes.spires);
  addInst(progs.litInst, buildingMeshes.crowns);
  // Phase F building detail: plinth + cornice bands, entrance kits,
  // shopfronts, balconies, roof clutter — one instanced draw each.
  addInst(progs.litInst, buildingMeshes.plinth);
  addInst(progs.litInst, buildingMeshes.cornice);
  addInst(progs.litInst, buildingMeshes.entrance);
  addInst(progs.litInst, buildingMeshes.shopfront);
  addInst(progs.litInst, buildingMeshes.balconies);
  addInst(progs.litInst, buildingMeshes.roofUnits);
  // Phase H building detail: ground-floor glass bands + roof decks +
  // parapet walls — one instanced draw each.
  addInst(progs.litInst, buildingMeshes.glassBand);
  addInst(progs.litInst, buildingMeshes.roofDeck);
  addInst(progs.litInst, buildingMeshes.parapetNS);
  addInst(progs.litInst, buildingMeshes.parapetEW);
  // Plot dressing: light-grey paving + parked cars, fences, flowers,
  // benches in dense and residential blocks (Mu: no plain green yards).
  addStatic(progs.lit, plotDressing.paving, mat4Identity());
  addStatic(progs.lit, plotDressing.props, mat4Identity());
  // Riverfront (Phase I): embankment wall + promenade + fence + end caps
  // + docks/steps (hard, 1 draw) and riverbank trees + park benches +
  // flowers (green, 1 draw). All code-made, no external images.
  addStatic(progs.lit, riverfront.hard, mat4Identity());
  addStatic(progs.lit, riverfront.green, mat4Identity());
  addInst(progs.litInst, treeMesh);
  addInst(progs.litInst, palmMesh);
  addInst(progs.litInst, lampMeshes.poles);
  addInst(progs.unlitInst, lampMeshes.heads);
  addInst(progs.unlitInst, trafficMesh);
  // Direction signs (Phase H): poles + gantry frames (1 static lit draw)
  // and the text panels from the shared atlas (1 textured draw).
  addStatic(progs.lit, signs.poleGeom, mat4Identity());
  {
    const panelMesh = createTexturedMesh(gl, progs.textured, signs.panelGeom);
    meshes.push({ mesh: panelMesh, prog: progs.textured, model: mat4Identity(), textured: true, texture: signTexture });
  }
  // Shop signs + canopies (Phase I): pastel awnings on every ground
  // floor (1 instanced draw) and the name boards on the sign bands
  // (1 textured draw, shared atlas).
  addInst(progs.litInst, shopSigns.canopy);
  {
    const shopPanelMesh = createTexturedMesh(gl, progs.textured, shopSigns.panelGeom);
    meshes.push({ mesh: shopPanelMesh, prog: progs.textured, model: mat4Identity(), textured: true, texture: shopSignTexture });
  }
  // Rooftop name signs (Phase I): dark backing boxes on 9 landmark roofs
  // (1 static lit draw) + the name boards from the shared atlas
  // (1 textured draw). The atlas canvas only exists in the browser
  // (Node tests get null) — skip the textured mesh there.
  addStatic(progs.lit, rooftopSigns.boxGeom, mat4Identity());
  if (rooftopSignTexture) {
    const rooftopPanelMesh = createTexturedMesh(gl, progs.textured, rooftopSigns.panelGeom);
    meshes.push({ mesh: rooftopPanelMesh, prog: progs.textured, model: mat4Identity(), textured: true, texture: rooftopSignTexture });
  }
  // Parking zone symbols (Phase I): P letters + disabled pictograms on
  // the lot pads, one shared atlas (1 textured draw). The atlas canvas
  // only exists in the browser (Node tests get null) — skip the mesh
  // there; the pad + lines + cars are already in the paving/props meshes.
  if (plotDressing.parkingSymbols.atlasCanvas) {
    const parkingTexture = createCanvasTexture(gl, plotDressing.parkingSymbols.atlasCanvas);
    const parkingMesh = createTexturedMesh(gl, progs.textured, plotDressing.parkingSymbols.panelGeom);
    meshes.push({ mesh: parkingMesh, prog: progs.textured, model: mat4Identity(), textured: true, texture: parkingTexture });
  }
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
  // Night shopfront glow (Mu's night refs): warm-lit ground floors on
  // every shop, drawn only at night (+1 draw at night, 0 by day), plus
  // the warm spill on the ground in front of each shop (+1 more at night).
  addInst(progs.unlitInst, shopGlow, { nightOnly: true });
  addInst(progs.unlitInst, shopGlow.spill, { nightOnly: true });
  addInst(progs.unlitInst, { geom: buildMoonGeom(), matrices: [mat4TRS(MOON_POS[0], MOON_POS[1], MOON_POS[2], 0, 1, 1, 1)], tints: [[1, 1, 1]] }, { nightOnly: true });
  addInst(progs.unlitInst, stars, { nightOnly: true });
  // Wet roads (transparent, only while wet) + puddles.
  addStatic(progs.transp, wet.overlay, mat4Identity(), { transparent: true, alpha: 0.35, wetOnly: true });
  addStatic(progs.transp, wet.puddles, mat4Identity(), { transparent: true, alpha: 0.3, wetOnly: true });
  // Night light pools (transparent, only at night): warm glow on the
  // streets around lamps, market, plaza, pier and shopfronts. Alpha 0.2:
  // a soft glow the road shows through — 0.38 washed the whole avenue
  // into a solid tan sheet from street level.
  addStatic(progs.transp, nightPools.pools, mat4Identity(), { transparent: true, alpha: 0.2, nightOnly: true });
  // Living sky: gradient dome (1 draw) + drifting cloud puffs, one
  // dynamic instanced mesh (1 draw) — replaces the old 3 static cloud
  // meshes. Net: 2 sky draws instead of 3.
  const skyDomeMesh = createMesh(gl, progs.sky, buildSkyDomeGeom());
  const cloudSpec = buildCloudSpec();
  const cloudMesh = createDynamicInstancedMesh(gl, progs.unlitInst, cloudSpec.geom, cloudSpec.clouds.length);
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
  // Peds: 2000 humanoid NPCs (Mu) — one base model, instanced per part
  // (torso, two swinging arms, two swinging legs, skirt, head, short/long
  // hair, police badge, fishing rod). Capacity 2000: the 160 m cull keeps
  // the visible count near ~500 in the busiest view, but the buffer must
  // never clip a crowd. A part is drawn only for the NPCs that use it, so
  // the whole crowd costs ~11 instanced draws.
  addDyn(progs.litInst, pedTorsoGeom(), 2000, 'ped_torso');
  addDyn(progs.litInst, pedArmGeom(-1), 2000, 'ped_armL');
  addDyn(progs.litInst, pedArmGeom(1), 2000, 'ped_armR');
  addDyn(progs.litInst, pedLegGeom(-1), 2000, 'ped_legsL');
  addDyn(progs.litInst, pedLegGeom(1), 2000, 'ped_legsR');
  addDyn(progs.litInst, pedSkirtGeom(), 400, 'ped_skirt');
  addDyn(progs.litInst, pedHeadGeom(), 2000, 'ped_heads');
  addDyn(progs.litInst, pedHairShortGeom(), 2000, 'ped_hairS');
  addDyn(progs.litInst, pedHairLongGeom(), 800, 'ped_hairL');
  addDyn(progs.litInst, pedBadgeGeom(), 32, 'ped_badge');
  addDyn(progs.litInst, fishingRodGeom(), 100, 'ped_rod');
  // The player (Wowok): the same humanoid base model, animated per part
  // (one instance each) so his arms/legs swing when he walks and he SITS
  // in the vehicle when driving. Capacity 1 each.
  addDyn(progs.litInst, pedWowokTorsoGeom(), 1, 'player_torso'); // baked red/white panels, tint [1,1,1]
  addDyn(progs.litInst, pedArmGeom(-1), 1, 'player_armL');
  addDyn(progs.litInst, pedArmGeom(1), 1, 'player_armR');
  addDyn(progs.litInst, pedLegGeom(-1), 1, 'player_legsL');
  addDyn(progs.litInst, pedLegGeom(1), 1, 'player_legsR');
  addDyn(progs.litInst, pedHeadGeom(), 1, 'player_head');
  addDyn(progs.litInst, pedHairShortGeom(), 1, 'player_hair');
  // (No player_shirt mesh anymore — the white shirt is a colour panel
  // baked into the torso capsule, Mu's reference.)
  addDyn(progs.litInst, plainBox(0.06, 1.2, 0.06, [1, 1, 1]), 260, 'rain');
  addDyn(progs.unlitInst, headlightGeom(), 240, 'headlights');
  // Phase F polish: shared spinning/steering wheels, bike steering
  // assemblies, live taillights, bike lights, beam cones, police beacons.
  addDyn(progs.litInst, buildWheelGeom(), 1200, 'wheels');
  addDyn(progs.litInst, buildWheelGeomFar(), 1200, 'wheelsFar'); // far cars: low-poly wheels
  addDyn(progs.litInst, buildBikeFrontGeom(), 130, 'bikeFront');
  addDyn(progs.unlitInst, tailGeom(), 320, 'taillights');
  addDyn(progs.unlitInst, headlightGeom(), 240, 'bikelights');
  addDyn(progs.transpInst, beamConeGeom(), 260, 'beamcones');
  addDyn(progs.unlitInst, beaconGeom(), 8, 'beacons');
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
  // Headlight beam pool: subdivided strip whose colours fade with
  // distance, so the pool is a soft glow — never a hard washed-out patch.
  addDyn(progs.transpInst, beamPoolGeom(), 220, 'headbeams');
  addDyn(progs.transpInst, flatQuadGeom, 128, 'flow'); // river + surf + yard fountains (86 river/wave + <=24 fountains)
  addDyn(progs.transpInst, flatQuadGeom, 96, 'sea'); // sea ripple bands + swell (own alpha)

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
    const { eye, center, timeHours, activityPropsMesh, elapsed } = state;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
    const rainAmt = state.weather ? state.weather.rain : 0;
    const wetAmt = state.weather ? state.weather.wet : 0;
    const light = lightFor(timeHours, rainAmt);
    const sky = skyColors(timeHours, rainAmt);
    gl.clearColor(light.sky[0], light.sky[1], light.sky[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const proj = mat4Perspective((55 * Math.PI) / 180, canvas.width / canvas.height, 0.5, 4000);
    const view = mat4LookAt(eye, center, [0, 1, 0]);
    const spot = state.dynamics && state.dynamics.playerSpot;
    const common = {
      uProj: proj, uView: view,
      uSunDir: light.sun, uSunColor: light.sunColor, uAmbient: light.ambient,
      uFogColor: light.sky, uFogNear: 500, uFogFar: 2600,
      // Player headlight spotlight (the one real light): off by default.
      uSpotPos: spot ? spot.pos : [0, 0, 0],
      uSpotDir: spot ? spot.dir : [0, 1, 0],
      uSpotColor: spot ? spot.color : [0, 0, 0],
      uSpotOn: spot && spot.on ? 1 : 0,
    };
    calls = 0; tris = 0;
    // Sky dome first (1 draw): a unit hemisphere centred on the camera,
    // scaled to radius 1600. It is far behind everything, so the depth
    // test lets the city draw over it normally.
    {
      const domeModel = mat4Identity();
      domeModel[0] = 1600; domeModel[5] = 1600; domeModel[10] = 1600;
      domeModel[12] = eye[0]; domeModel[13] = 0; domeModel[14] = eye[2];
      tris += drawMesh(gl, progs.sky, skyDomeMesh, {
        uProj: proj, uView: view, uModel: domeModel,
        uTopColor: sky.top, uHorizonColor: sky.horizon,
        uSunDirTo: sky.sunDirTo, uSunGlow: sky.sunGlow,
      });
      calls++;
    }
    // Clouds (1 draw): drift slowly with the wind, wrap across the map;
    // tint + size follow the time of day and the rain (thicker, greyer,
    // slightly lower when it rains; thin and dark at night).
    {
      const matrices = [], tints = [];
      for (const c of cloudSpec.clouds) {
        let x = c.x + elapsed * c.drift;
        x = ((x + 1100) % 2200 + 2200) % 2200 - 1100;
        const s = c.scale * sky.rainScale;
        matrices.push(mat4TRS(x, c.y - rainAmt * 18, c.z, 0, s, s, s));
        tints.push(sky.cloudTint.map((v) => v * c.shade));
      }
      updateDynamicInstancedMesh(gl, cloudMesh, matrices, tints);
      tris += drawMesh(gl, progs.unlitInst, cloudMesh, { uProj: proj, uView: view, uFogColor: light.sky, uFogNear: 500, uFogFar: 2600 });
      calls++;
    }
    const drawEntry = (entry) => {
      if (entry.nightOnly && light.isDay) return;
      if (entry.wetOnly && wetAmt < 0.05) return;
      const uniforms = { ...common, uModel: entry.model };
      if (entry.textured) {
        // Bind the shared sign atlas (sampler uniform, not a float).
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, entry.texture);
        gl.useProgram(entry.prog);
        gl.uniform1i(gl.getUniformLocation(entry.prog, 'uTex'), 0);
      }
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
    // Activity props (coffee tables + chairs + cups, benches): one static
    // mesh built from the same spot lists the activity NPCs use, so props
    // and sitters always agree. The player figure is drawn per-part from
    // state.dynamics (player_torso … player_hair) — see main.js.
    if (activityPropsMesh) {
      tris += drawMesh(gl, progs.lit, activityPropsMesh, { ...common, uModel: mat4Identity() });
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
      if (name === 'taillights' && light.isDay) continue;
      if (name === 'beamcones' && light.isDay) continue;
      if (name === 'beacons' && light.isDay) continue;
      if (name === 'rain' && rainAmt < 0.05) continue;
      updateDynamicInstancedMesh(gl, entry.mesh, spec.matrices, spec.tints);
      const uniforms = { ...common, uModel: mat4Identity() };
      const blendAlpha = name.startsWith('vehglass_') ? 0.42
        : { beam: 0.12, headbeams: 0.09, flow: 0.3, sea: 0.45, heliBeam: 0.15, beamcones: 0.24 }[name];
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
  }

  return {
    gl, render, lightFor,
    makePlayerMesh(geom) { return createMesh(gl, progs.lit, geom); },
    get calls() { return calls; },
    get tris() { return tris; },
    dayLength: DAY_LENGTH,
    landmarks,
    plotDressing, // yard fountain spots (animated water rides the flow mesh)
  };
}
