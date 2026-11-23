// Teluk Rimba — night shopfront glow (Mu, Phase I: night-look refs).
// Ground floors glowing bright at night: every commercial / downtown
// shopfront gets a warm-lit panel on its facade, so the street reads
// like the reference — lit shopfronts, warm light spilling onto the
// sidewalk, lit tower windows above. One instanced mesh, unlit program,
// night only (+1 draw, only at night). Warm tints vary per shop
// (warm white / pink / cool white), seeded so the street never looks
// uniform. Pure geometry (no document) — safe in Node tests.
import { plainBox, mat4TRS } from './gl.js';

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Warm shopfront tints (Mu's refs: ALL warm — yellow-white, pink, amber;
// the cool-white variant made some ground floors read cold blue instead
// of glowing warm, so it is gone) with a per-shop brightness jitter.
const GLOW_TINTS = [
  [1.0, 0.85, 0.60], // warm yellow-white
  [1.0, 0.85, 0.60],
  [1.0, 0.85, 0.60],
  [1.0, 0.72, 0.70], // warm pink
  [1.0, 0.78, 0.45], // warm amber
];

export function buildShopGlow(city) {
  const rand = mulberry32(20261123);
  const matrices = [], tints = [];
  const spillMatrices = [], spillTints = [];
  let bands = 0, dtIdx = 0;
  for (const b of city.buildings) {
    if (b.zone !== 'commercial' && b.zone !== 'downtown') continue;
    const myDt = b.zone === 'downtown' ? dtIdx++ : -1;
    // Mu 23 Nov 21:19 — CBD ground floor glows ALL AROUND at night: a
    // warm panel + spill on EVERY face of a downtown tower (front, back,
    // left, right), so the base reads lit from any angle. Commercial shops
    // keep the single front panel. One instanced mesh either way.
    // Mu 23 Nov 22:55 — downtown towers have a glass lobby now, so the
    // flat ground panel is GONE on downtown faces (it would hide the
    // clear glass + pillars); the spill + amber sign band stay, and the
    // lobby glow core (buildings.js) lights the glass from inside.
    // Mu 23 Nov 22:01 — CBD ground floor BRIGHTER + LIVELIER: the panel
    // is wider (up to 18 m) and its tint pushes past 1.0, the spill is
    // wider/deeper/stronger, and every OTHER downtown tower gets a lit
    // amber sign band above the awning on its front face — from aerial
    // night or street level the tower bases read busy and bright, not a
    // thin line. Still warm, never blinding white; daytime untouched.
    const faces = b.zone === 'downtown'
      ? [0, Math.PI / 2, Math.PI, -Math.PI / 2]
      : [0];
    for (const turn of faces) {
      const rot = b.rot + turn;
      const nx = Math.sin(rot), nz = Math.cos(rot);
      // Front/back faces span w across and sit d/2 out; side faces span d
      // across and sit w/2 out.
      const across = (turn === 0 || turn === Math.PI) ? b.w : b.d;
      const out = (turn === 0 || turn === Math.PI) ? b.d / 2 : b.w / 2;
      const w = b.zone === 'downtown' ? Math.min(across * 0.92, 18) : Math.min(across * 0.75, 10);
      // Ground floor, y 0.3–2.4 (below the sign band at 2.45+, so the shop
      // name and awning stay visible). Proud of the facade at +0.13 so it
      // sits IN FRONT of the shopfront glass (+0.12) — at +0.05 the glass
      // hid the panel's centre and only its pale edges showed. The dark
      // door (+0.17) still pokes through the glow, like a real shopfront.
      const h = 2.1;
      const fx = b.x + nx * (out + 0.13);
      const fz = b.z + nz * (out + 0.13);
      const base = GLOW_TINTS[Math.floor(rand() * GLOW_TINTS.length)];
      const j = b.zone === 'downtown' ? 1.0 + rand() * 0.15 : 0.85 + rand() * 0.15;
      const tint = [base[0] * j, base[1] * j, base[2] * j];
      // Mu 23 Nov 22:55 — downtown towers have a glass lobby now: the flat
      // warm panel would hide the clear glass + pillars, so NO ground
      // panel on downtown faces. The lobby glow core (buildings.js) lights
      // the glass from inside instead, and the spill below still washes
      // the sidewalk. Commercial shops keep their panel.
      if (b.zone !== 'downtown') {
        matrices.push(mat4TRS(fx, 1.35, fz, rot, w, h, 1));
        tints.push(tint);
      }
      // Warm spill on the ground in front of the shop (Mu's refs: warm
      // light on the sidewalk) — downtown: a wider, deeper, stronger wash
      // (7 m deep, 3.5 m out, 0.95x the tint); commercial keeps the
      // old 3 m / 2.2 m / 0.45x spill. Mu 23 Nov 23:31 — the old downtown
      // spill (0.62x the pale [1.0,0.85,0.60] tint) read washed-out on the
      // sidewalk, so downtown spills now use a deeper amber base with a
      // brighter factor, matching the lobby glow core.
      const spillOut = b.zone === 'downtown' ? out + 3.5 : out + 2.2;
      const spillW = b.zone === 'downtown' ? w : w * 0.8;
      const spillD = b.zone === 'downtown' ? 7 : 3;
      const spillF = b.zone === 'downtown' ? 0.95 : 0.45;
      spillMatrices.push(mat4TRS(b.x + nx * spillOut, 0.18, b.z + nz * spillOut, rot, spillW, 1, spillD));
      if (b.zone === 'downtown') {
        const sj = 1.0 + rand() * 0.2;
        spillTints.push([1.0 * sj * spillF, 0.62 * sj * spillF, 0.25 * sj * spillF]);
      } else {
        spillTints.push([tint[0] * spillF, tint[1] * spillF, tint[2] * spillF]);
      }
      // Lit amber sign band above the awning, front face only, on every
      // OTHER downtown tower (11 of 21) — a second warm strip so the base
      // reads as two lit layers, not one thin line.
      if (b.zone === 'downtown' && turn === 0 && myDt % 2 === 0) {
        const bw = Math.min(across * 0.55, 11);
        const bj = 1.0 + rand() * 0.1;
        matrices.push(mat4TRS(fx, 3.8, fz, rot, bw, 0.8, 1));
        tints.push([1.0 * bj, 0.8 * bj, 0.5 * bj]);
        bands++;
      }
    }
  }
  return {
    geom: plainBox(1, 1, 0.06, [1, 1, 1]),
    matrices, tints,
    spill: { geom: plainBox(1, 0.02, 1, [1, 1, 1]), matrices: spillMatrices, tints: spillTints },
    counts: { panels: matrices.length, spills: spillMatrices.length, bands },
  };
}
