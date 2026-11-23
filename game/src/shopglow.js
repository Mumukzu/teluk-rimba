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
  for (const b of city.buildings) {
    if (b.zone !== 'commercial' && b.zone !== 'downtown') continue;
    // Mu 23 Nov 21:19 — CBD ground floor glows ALL AROUND at night: a
    // warm panel + spill on EVERY face of a downtown tower (front, back,
    // left, right), so the base reads lit from any angle. Commercial shops
    // keep the single front panel. One instanced mesh either way.
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
      const w = Math.min(across * 0.75, 10);
      // Ground floor, y 0.3–2.4 (below the sign band at 2.45+, so the shop
      // name and awning stay visible). Proud of the facade at +0.13 so it
      // sits IN FRONT of the shopfront glass (+0.12) — at +0.05 the glass
      // hid the panel's centre and only its pale edges showed. The dark
      // door (+0.17) still pokes through the glow, like a real shopfront.
      const h = 2.1;
      const fx = b.x + nx * (out + 0.13);
      const fz = b.z + nz * (out + 0.13);
      matrices.push(mat4TRS(fx, 1.35, fz, rot, w, h, 1));
      const base = GLOW_TINTS[Math.floor(rand() * GLOW_TINTS.length)];
      const j = 0.85 + rand() * 0.15;
      const tint = [base[0] * j, base[1] * j, base[2] * j];
      tints.push(tint);
      // Warm spill on the ground in front of the shop (Mu's refs: warm
      // light on the sidewalk) — a flat wash 2.2 m out from the facade,
      // dimmer than the panel, same warm tint.
      spillMatrices.push(mat4TRS(b.x + nx * (out + 2.2), 0.18, b.z + nz * (out + 2.2), rot, w * 0.8, 1, 3));
      spillTints.push([tint[0] * 0.45, tint[1] * 0.45, tint[2] * 0.45]);
    }
  }
  return {
    geom: plainBox(1, 1, 0.06, [1, 1, 1]),
    matrices, tints,
    spill: { geom: plainBox(1, 0.02, 1, [1, 1, 1]), matrices: spillMatrices, tints: spillTints },
    counts: { panels: matrices.length, spills: spillMatrices.length },
  };
}
