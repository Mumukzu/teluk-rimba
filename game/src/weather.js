// Teluk Rimba — afternoon weather. Pure logic (no WebGL, no DOM).
// Deterministic schedule: rain falls 15:00-16:30, the roads stay wet and
// shiny until 18:00, then dry. Rains fade in/out over ~12 game-minutes.
// ?weather=rain|wet|clear overrides the schedule (tests / screenshots only).
import { mulberry32, clamp, range } from './rng.js';
import { mat4TRS } from './gl.js';

const RAIN_START = 15.0, RAIN_END = 16.5, WET_END = 18.0;
const FADE = 0.2; // game-hours over which rain/wet fade in and out

export function createWeather(opts = {}) {
  const rand = mulberry32(opts.seed || 20261126);
  const override = opts.override || null; // 'rain' | 'wet' | 'clear' | null
  // Rain streaks: 260 thin drops falling in a box around the camera.
  const drops = [];
  for (let k = 0; k < 260; k++) {
    drops.push({
      x: range01(rand) * 70 - 35, y: range01(rand) * 40,
      z: range01(rand) * 70 - 35, speed: 24 + range01(rand) * 10,
    });
  }
  function range01(r) { return r(); }

  const state = { rain: 0, wet: 0, mode: 'clear' };

  function targetFor(timeHours) {
    if (override === 'rain') return { rain: 1, wet: 1 };
    if (override === 'wet') return { rain: 0, wet: 1 };
    if (override === 'clear') return { rain: 0, wet: 0 };
    const rainIn = clamp((timeHours - RAIN_START) / FADE, 0, 1);
    const rainOut = clamp((RAIN_END - timeHours) / FADE, 0, 1);
    const rain = (timeHours >= RAIN_START && timeHours < RAIN_END) ? Math.min(rainIn, rainOut) : 0;
    const wetIn = clamp((timeHours - RAIN_START) / FADE, 0, 1);
    const wetOut = clamp((WET_END - timeHours) / FADE, 0, 1);
    const wet = (timeHours >= RAIN_START && timeHours < WET_END) ? Math.min(wetIn, wetOut) : 0;
    return { rain, wet };
  }

  return {
    state,
    step(dt, timeHours) {
      const t = targetFor(timeHours);
      const k = Math.min(1, dt * 1.5);
      state.rain += (t.rain - state.rain) * k;
      state.wet += (t.wet - state.wet) * k;
      state.mode = state.rain > 0.5 ? 'rain' : state.wet > 0.5 ? 'wet' : 'clear';
      return state;
    },
    // Rain streak matrices around the camera (only when raining).
    rainMatrices(camX, camZ) {
      if (state.rain < 0.05) return { matrices: [], tints: [] };
      const matrices = [], tints = [];
      for (const d of drops) {
        matrices.push(mat4TRS(camX + d.x, d.y, camZ + d.z, 0, 1, 1, 1));
        tints.push([0.75, 0.82, 0.92]);
      }
      return { matrices, tints };
    },
    stepDrops(dt, camX, camZ) {
      for (const d of drops) {
        d.y -= d.speed * dt;
        d.x += 2.5 * dt; // slight wind slant
        if (d.y < 0) { d.y = 35 + range01(rand) * 5; d.x = range01(rand) * 70 - 35; d.z = range01(rand) * 70 - 35; }
        if (d.x > 35) d.x = -35;
      }
    },
  };
}

// Wet-road overlay + puddles: static transparent quads over the asphalt.
// Built from the same road lines as the road mesh, so they always match.
import { ROAD_LINES, ASPHALT_HALF } from './city.js';

export function buildWetGeoms() {
  const overlay = { pos: [], nrm: [], col: [] };
  const puddles = { pos: [], nrm: [], col: [] };
  const quad = (g, a, b, c, d, y, col) => {
    const n = [0, 1, 0];
    const P = (p) => [p[0], y, p[1]];
    g.pos.push(...P(a), ...P(c), ...P(b), ...P(a), ...P(d), ...P(c));
    for (let k = 0; k < 6; k++) g.nrm.push(...n);
    for (let k = 0; k < 6; k++) g.col.push(...col);
  };
  const WET = [0.1, 0.12, 0.16]; // dark glossy wet asphalt
  const PUDDLE = [0.4, 0.55, 0.68]; // sky-reflecting puddles
  const N = ROAD_LINES.length;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N - 1; i++) {
      const x0 = ROAD_LINES[i], x1 = ROAD_LINES[i + 1], z = ROAD_LINES[j];
      const ah = ASPHALT_HALF(z);
      quad(overlay, [x0, z - ah], [x1, z - ah], [x1, z + ah], [x0, z + ah], 0.09, WET);
    }
  }
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N - 1; j++) {
      const z0 = ROAD_LINES[j], z1 = ROAD_LINES[j + 1], x = ROAD_LINES[i];
      const ah = ASPHALT_HALF(x);
      quad(overlay, [x - ah, z0], [x + ah, z0], [x + ah, z1], [x - ah, z1], 0.09, WET);
    }
  }
  // Puddles: deterministic spots on road segments.
  const rand = mulberry32(20261127);
  for (let k = 0; k < 70; k++) {
    const L = ROAD_LINES[Math.floor(rand() * ROAD_LINES.length)];
    const along = range(rand, -580, 580);
    const horiz = rand() < 0.5;
    const w = range(rand, 2.5, 5), d = range(rand, 1.5, 3);
    const cx = horiz ? along : L, cz = horiz ? L : along;
    quad(puddles, [cx - w / 2, cz - d / 2], [cx + w / 2, cz - d / 2], [cx + w / 2, cz + d / 2], [cx - w / 2, cz + d / 2], 0.1, PUDDLE);
  }
  return { overlay, puddles };
}
