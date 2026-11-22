// Teluk Rimba — boot + the one loop. Fixed 1/60 s steps, a start screen that
// also enables audio, day-night cycle, HUD + minimap, screenshot/test modes.
//
// Test hooks (tests only, off in normal play):
//   ?sim=1            headless fast-sim: logic ticks, no rendering
//   ?shot=day|night   fixed time of day      &hud=0 hide the HUD
//   &cam=aerial|street  fixed camera         &spawn=x,z start position
//   &timeScale=N      faster clock/timers
import { STEP, DAY_LENGTH, START_TIME, START_POS } from './config.js';
import { generateCity, isConnected } from './city.js';
import { createInput, ACTION_CONFIRM } from './input.js';
import { createPlayer } from './player.js';
import { createHud } from './hud.js';
import { createRenderer } from './render.js';
import { parseShotParams, timeForShot } from './shots.js';
import { mat4TRS } from './gl.js';

const params = parseShotParams();
const canvas = document.getElementById('game');
const city = generateCity(params.seed);
const start = params.spawn || START_POS;

// Public test surface (read by the Playwright checks and the sim runner).
window.__CITY_STATS__ = {
  buildings: city.stats.buildings,
  nodes: city.stats.nodes,
  edges: city.stats.edges,
  bridges: city.stats.bridges,
  connected: isConnected(city),
  streetTrees: city.stats.streetTrees,
  forestTrees: city.stats.forestTrees,
  lamps: city.stats.lamps,
  trafficLights: city.stats.trafficLights,
  zones: city.stats.zones,
};

const game = {
  money: 0,
  timeHours: timeForShot(params.shot, START_TIME),
  wanted: 0,
  objective: 'Jelajahi Teluk Rimba — WASD jalan, seret mouse untuk kamera',
  elapsed: 0,
  started: false,
  speedKmh: 0,
};

const hud = createHud(city);
const player = createPlayer(city, start.x, start.z);
const input = createInput(canvas);
if (!params.hud) document.getElementById('hud').style.display = 'none';

// Start screen: click to start (also resumes the AudioContext; sounds land
// in the audio phase — for now the context is just unlocked, no sound yet).
const overlay = document.getElementById('start-screen');
let audioCtx = null;
function startGame() {
  if (game.started) return;
  game.started = true;
  overlay.style.display = 'none';
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch { /* audio is optional in Phase A */ }
  hud.showHint('WASD jalan • Shift lari • seret mouse untuk kamera • M peta (nanti)');
}
overlay.addEventListener('click', startGame);
overlay.addEventListener('keydown', (e) => { if (e.code === 'Enter' || e.code === 'Space') startGame(); });

function stepWorld(dt) {
  game.elapsed += dt;
  game.timeHours = (game.timeHours + (dt * params.timeScale * 24) / DAY_LENGTH) % 24;
  if (game.started) {
    const px = player.state.x, pz = player.state.z;
    player.step(input, dt);
    const moved = Math.hypot(player.state.x - px, player.state.z - pz);
    game.speedKmh = (moved / Math.max(dt, 1e-6)) * 3.6;
  } else if (input.takeActions() & ACTION_CONFIRM) {
    startGame();
  }
  hud.update(dt, {
    money: game.money,
    timeHours: game.timeHours,
    wanted: game.wanted,
    speedKmh: game.speedKmh,
    objective: game.objective,
  });
  hud.drawMinimap(player.state, game.timeHours);
}

// ---- headless fast-sim (tests only): no WebGL, fixed ticks, autopilot ----
// The autopilot walks the player along a loop of road nodes, so the sim
// proves movement + collision + the clock without drawing anything.
function runSim() {
  const loop = [[0, -400], [400, -400], [400, 400], [-400, 400], [-400, -400], [0, -400]];
  let target = 0;
  let steps = 0, blocked = 0;
  const fakeInput = {
    forward: false, back: false, left: false, right: false, run: true,
    takeActions: () => 0, takeDrag: () => ({ dx: 0, dy: 0 }), takeWheel: () => 0,
  };
  game.started = true;
  for (let t = 0; t < 1200; t++) {
    const [tx, tz] = loop[target];
    const dx = tx - player.state.x, dz = tz - player.state.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 6) { target = (target + 1) % loop.length; continue; }
    // Steer the camera yaw so "forward" points at the target.
    player.state.camYaw = Math.atan2(-dx, -dz);
    fakeInput.forward = true;
    const bx = player.state.x, bz = player.state.z;
    player.step(fakeInput, STEP);
    if (Math.hypot(player.state.x - bx, player.state.z - bz) < 0.001) blocked++;
    game.elapsed += STEP;
    game.timeHours = (game.timeHours + (STEP * 24) / DAY_LENGTH) % 24;
    steps++;
  }
  window.__SIM_DONE__ = {
    steps, blocked,
    player: { x: +player.state.x.toFixed(1), z: +player.state.z.toFixed(1) },
    timeHours: +game.timeHours.toFixed(2),
    connected: window.__CITY_STATS__.connected,
    buildings: window.__CITY_STATS__.buildings,
  };
  document.title = 'SIM DONE steps=' + steps + ' blocked=' + blocked;
  return window.__SIM_DONE__;
}

if (params.sim) {
  // No renderer at all: pure logic, fast.
  const result = runSim();
  console.log('[sim]', JSON.stringify(result));
} else {
  const renderer = createRenderer(canvas, city);
  const playerMesh = renderer.makePlayerMesh(player.figureGeom());
  let last = performance.now();
  let acc = 0;
  let frames = 0, fpsTime = 0, fps = 0;
  let shotReady = false;

  function cameraForFrame() {
    if (params.cam === 'aerial') {
      return { eye: [0, 680, 430], center: [0, 0, -20] };
    }
    if (params.cam === 'street') {
      const p = player.state;
      return {
        eye: [p.x + 6, p.y + 3.2, p.z + 8],
        center: [p.x, p.y + 1.5, p.z],
      };
    }
    return player.camera();
  }

  function frame(now) {
    requestAnimationFrame(frame);
    let dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    acc += dt;
    while (acc >= STEP) { stepWorld(STEP); acc -= STEP; }
    const cam = cameraForFrame();
    const model = mat4TRS(player.state.x, player.state.y, player.state.z, player.state.facing, 1, 1, 1);
    renderer.render({
      eye: cam.eye, center: cam.center,
      timeHours: game.timeHours, playerMesh, playerModel: model,
      elapsed: game.elapsed,
    });
    frames++;
    fpsTime += dt;
    if (fpsTime >= 0.5) {
      fps = frames / fpsTime;
      frames = 0; fpsTime = 0;
      window.__PERF__ = {
        fps: Math.round(fps),
        calls: renderer.calls,
        tris: renderer.tris,
        timeHours: +game.timeHours.toFixed(2),
      };
    }
    if (!shotReady) {
      shotReady = true;
      setTimeout(() => { window.__shotReady = true; }, 400);
    }
  }
  window.__PERF__ = { fps: 0, calls: 0, tris: 0, timeHours: game.timeHours };
  requestAnimationFrame(frame);
}
