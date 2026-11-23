// Teluk Rimba — aircraft: police helicopter + daytime plane. Pure logic
// (no WebGL, no DOM) plus code-made geometry builders, like vehicles.js.
// The helicopter circles downtown and, when the wanted level hits 2+,
// orbits the player instead — with a cone spotlight at night. The plane
// crosses the city at altitude now and then during the day, high enough
// never to cover the streets in a screenshot.
import { emptyGeom, plainBox, mat4TRS } from './gl.js';

export function createAircraft(city, opts = {}) {
  const rand = opts.rand || Math.random;
  const state = {
    heliAngle: 0,
    heliX: 0, heliZ: 0, heliY: 235,
    rotor: 0,
    beamAngle: 0,
    plane: {
      // Mu 23 Nov 21:03: CBD towers are 150-200 m now (tops ~225 m with
      // spires/tiers) — the plane and the heli must fly ABOVE them, or
      // they would clip straight through the towers. Plane 260 m, heli
      // 235 m; the spotlight cone is lengthened to match (baseY -230).
      active: false, x: -900, z: -150, y: 260, dir: 1,
      nextIn: 45 + rand() * 30, // first crossing ~45-75 s in
    },
  };

  function step(dt, ctx) {
    const { player, wanted, isDay } = ctx;
    // Helicopter: slow orbit (0.05 rad/s). Wanted 2+ → it hunts the player.
    state.heliAngle += 0.05 * dt;
    state.rotor += dt * 22;
    state.beamAngle += dt * 0.25;
    const cx = wanted >= 2 ? player.x : 0;
    const cz = wanted >= 2 ? player.z : 0;
    const r = wanted >= 2 ? 130 : 260;
    state.heliX = cx + Math.cos(state.heliAngle) * r;
    state.heliZ = cz + Math.sin(state.heliAngle) * r;
    state.heliY = 235 + Math.sin(state.heliAngle * 2) * 6;
    // Plane: day only, back and forth across the city at 260 m.
    const p = state.plane;
    if (!isDay) { p.active = false; return; }
    if (!p.active) {
      p.nextIn -= dt;
      if (p.nextIn <= 0) {
        p.active = true;
        p.dir = p.dir === 1 ? -1 : 1;
        p.x = p.dir === 1 ? -900 : 900;
        p.z = -150 + (rand() - 0.5) * 120;
      }
      return;
    }
    p.x += p.dir * 55 * dt;
    if ((p.dir === 1 && p.x > 950) || (p.dir === -1 && p.x < -950)) {
      p.active = false;
      p.nextIn = 90 + rand() * 60; // next crossing in 90-150 s
    }
  }

  // Dynamic instanced specs for the renderer (empty arrays = not drawn).
  // Matrices are mat4TRS rows, exactly like vehicles/peds in main.js.
  function matricesFor(camX, camZ, isDay, elapsed) {
    const empty = { matrices: [], tints: [] };
    const out = { heli: empty, heliRotor: empty, plane: empty, heliBeam: empty };
    // Helicopter body (white — tinted police blue-white) + spinning rotor.
    const heading = Math.atan2(
      Math.cos(state.heliAngle + 0.05) - Math.cos(state.heliAngle),
      Math.sin(state.heliAngle + 0.05) - Math.sin(state.heliAngle),
    );
    out.heli = {
      matrices: [mat4TRS(state.heliX, state.heliY, state.heliZ, heading, 1, 1, 1)],
      tints: [[0.92, 0.94, 0.98]],
    };
    out.heliRotor = {
      matrices: [mat4TRS(state.heliX, state.heliY + 1.5, state.heliZ, state.rotor, 1, 1, 1)],
      tints: [[0.25, 0.25, 0.28]],
    };
    // Cone spotlight at night only: a soft cone from the heli to the ground.
    if (!isDay) {
      out.heliBeam = {
        matrices: [mat4TRS(state.heliX, state.heliY - 1, state.heliZ, state.beamAngle, 1, 1, 1)],
        tints: [[1, 0.95, 0.7]],
      };
    }
    // Plane, day only.
    if (isDay && state.plane.active) {
      const p = state.plane;
      out.plane = {
        matrices: [mat4TRS(p.x, p.y, p.z, p.dir === 1 ? Math.PI / 2 : -Math.PI / 2, 1, 1, 1)],
        tints: [[0.95, 0.95, 0.96]],
      };
    }
    return out;
  }

  return { state, step, matricesFor };
}

// ---- geometry builders (code-made, one mesh per aircraft part) ----
// The renderer turns matrices into instances, so the geometry is built
// around the origin, facing +Z at yaw 0.

export function heliBodyGeom() {
  const g = emptyGeom();
  const parts = [];
  // Main cabin (white, tinted by the instance colour).
  const cabin = plainBox(4.6, 2.0, 2.2, [1, 1, 1]);
  for (let i = 0; i < cabin.pos.length; i += 3) cabin.pos[i + 1] += 0.2;
  // Glass nose.
  const nose = plainBox(1.2, 1.2, 2.0, [0.25, 0.35, 0.5]);
  for (let i = 0; i < nose.pos.length; i += 3) { nose.pos[i] += 2.6; nose.pos[i + 1] += 0.3; }
  // Tail boom + tail fin.
  const boom = plainBox(5.0, 0.7, 0.7, [1, 1, 1]);
  for (let i = 0; i < boom.pos.length; i += 3) { boom.pos[i] -= 4.6; boom.pos[i + 1] += 0.5; }
  const fin = plainBox(0.5, 1.8, 0.2, [0.2, 0.3, 0.8]);
  for (let i = 0; i < fin.pos.length; i += 3) { fin.pos[i] -= 7.0; fin.pos[i + 1] += 1.2; }
  // Skids.
  for (const dz of [-0.9, 0.9]) {
    const skid = plainBox(4.0, 0.12, 0.18, [0.2, 0.2, 0.22]);
    for (let i = 0; i < skid.pos.length; i += 3) { skid.pos[i] -= 0.2; skid.pos[i + 1] -= 1.1; skid.pos[i + 2] += dz; }
    parts.push(skid);
  }
  // Police light bar (red + blue).
  const red = plainBox(0.5, 0.16, 0.4, [0.95, 0.15, 0.15]);
  for (let i = 0; i < red.pos.length; i += 3) { red.pos[i] -= 0.28; red.pos[i + 1] += 1.35; }
  const blue = plainBox(0.5, 0.16, 0.4, [0.15, 0.3, 0.95]);
  for (let i = 0; i < blue.pos.length; i += 3) { blue.pos[i] += 0.28; blue.pos[i + 1] += 1.35; }
  parts.push(cabin, nose, boom, fin, red, blue);
  for (const p of parts) { g.pos.push(...p.pos); g.nrm.push(...p.nrm); g.col.push(...p.col); }
  return g;
}

export function heliRotorGeom() {
  const g = emptyGeom();
  // Two-blade main rotor (thin dark bar, spins via its matrix yaw).
  const blade = plainBox(11, 0.1, 0.45, [0.22, 0.22, 0.25]);
  const hub = plainBox(0.5, 0.3, 0.5, [0.3, 0.3, 0.32]);
  for (const p of [blade, hub]) { g.pos.push(...p.pos); g.nrm.push(...p.nrm); g.col.push(...p.col); }
  return g;
}

export function planeGeom() {
  const g = emptyGeom();
  const parts = [];
  // Fuselage + nose + tail cone.
  const body = plainBox(13, 1.7, 2.0, [1, 1, 1]);
  const nose = plainBox(2.0, 1.3, 1.7, [0.9, 0.9, 0.92]);
  for (let i = 0; i < nose.pos.length; i += 3) nose.pos[i] += 7.2;
  const tail = plainBox(2.5, 1.2, 1.6, [0.95, 0.95, 0.96]);
  for (let i = 0; i < tail.pos.length; i += 3) tail.pos[i] -= 7.0;
  // Wings + tailplane + fin (white so the tint paints them).
  const wing = plainBox(3.2, 0.22, 17, [1, 1, 1]);
  for (let i = 0; i < wing.pos.length; i += 3) wing.pos[i] += 0.5;
  const tailplane = plainBox(2.0, 0.18, 6.5, [1, 1, 1]);
  for (let i = 0; i < tailplane.pos.length; i += 3) tailplane.pos[i] -= 7.2;
  const fin = plainBox(2.2, 2.2, 0.25, [0.25, 0.4, 0.8]);
  for (let i = 0; i < fin.pos.length; i += 3) { fin.pos[i] -= 7.4; fin.pos[i + 1] += 1.4; }
  parts.push(body, nose, tail, wing, tailplane, fin);
  for (const p of parts) { g.pos.push(...p.pos); g.nrm.push(...p.nrm); g.col.push(...p.col); }
  return g;
}

// Spotlight cone: apex at the helicopter, base ring on the ground ~230 m
// below (the heli flies at 235 m now, above the 200 m CBD towers).
// The matrix places the apex; the cone leans slightly so the sweep
// reads as a moving searchlight.
export function heliBeamConeGeom() {
  const g = emptyGeom();
  const SEG = 12;
  const apex = [0, 0, 0];
  const baseY = -230, baseR = 26, leanX = 28;
  const ring = [];
  for (let k = 0; k < SEG; k++) {
    const a = (k / SEG) * Math.PI * 2;
    ring.push([leanX + Math.cos(a) * baseR, baseY, Math.sin(a) * baseR]);
  }
  const white = [1, 1, 1];
  for (let k = 0; k < SEG; k++) {
    const b0 = ring[k], b1 = ring[(k + 1) % SEG];
    // Outward normal (approx): radial + up.
    const n = [Math.cos((k / SEG) * Math.PI * 2) * 0.8, 0.5, Math.sin((k / SEG) * Math.PI * 2) * 0.8];
    g.pos.push(...apex, ...b1, ...b0);
    for (let j = 0; j < 3; j++) g.nrm.push(...n);
    for (let j = 0; j < 3; j++) g.col.push(...white);
  }
  return g;
}

// Mission marker: a tall bright column at the current objective.
export function markerGeom() {
  return plainBox(1.6, 30, 1.6, [1, 1, 1]);
}
