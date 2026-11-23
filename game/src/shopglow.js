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

// Warm shopfront tints (Mu's refs: mostly warm yellow-white, some pink,
// a few cool white) with a per-shop brightness jitter.
const GLOW_TINTS = [
  [1.0, 0.85, 0.60], // warm yellow-white
  [1.0, 0.85, 0.60],
  [1.0, 0.85, 0.60],
  [1.0, 0.72, 0.70], // warm pink
  [0.92, 0.95, 1.0], // cool white
];

export function buildShopGlow(city) {
  const rand = mulberry32(20261123);
  const matrices = [], tints = [];
  for (const b of city.buildings) {
    if (b.zone !== 'commercial' && b.zone !== 'downtown') continue;
    const nx = Math.sin(b.rot), nz = Math.cos(b.rot);
    const w = Math.min(b.w * 0.75, 10);
    const h = 2.6; // ground floor, y 0.3–2.9 (sign band + canopy above it)
    const fx = b.x + nx * (b.d / 2 + 0.05);
    const fz = b.z + nz * (b.d / 2 + 0.05);
    matrices.push(mat4TRS(fx, 1.6, fz, b.rot, w, h, 1));
    const base = GLOW_TINTS[Math.floor(rand() * GLOW_TINTS.length)];
    const j = 0.85 + rand() * 0.15;
    tints.push([base[0] * j, base[1] * j, base[2] * j]);
  }
  return {
    geom: plainBox(1, 1, 0.06, [1, 1, 1]),
    matrices, tints,
    counts: { panels: matrices.length },
  };
}
