// Teluk Rimba — extra random helpers on top of the seeded RNG in rng.js.
import { mulberry32 } from './rng.js';

export function createRandom(seed) {
  return mulberry32(seed);
}

// Box-Muller gaussian, mean 0, std 1 (deterministic from the same stream).
export function gauss(rand) {
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function choice(rand, arr) {
  return arr[Math.floor(rand() * arr.length)];
}
