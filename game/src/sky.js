// Teluk Rimba — night sky: moon + stars. Code-made, drawn only at night.
// The moon is a pale disc with a soft glow; stars are small bright quads
// scattered on a dome overhead. Positions sit inside the fog range so the
// fog does not wash them out.
import { mulberry32 } from './rng.js';
import { emptyGeom, mat4TRS } from './gl.js';

// Sky dome: a unit hemisphere (y 0..1) centred on the camera, scaled to
// radius ~1600 by the model matrix. The gradient lives in the sky shader
// (uTopColor/uHorizonColor from the local Y), so no vertex colours are
// needed. Each wall triangle is emitted twice (both windings) so the dome
// reads from inside with backface culling on — same trick as the moon.
export function buildSkyDomeGeom() {
  const g = emptyGeom();
  const RINGS = 8, SEGS = 16;
  const pt = (ring, seg) => {
    const el = (ring / RINGS) * (Math.PI / 2); // 0 horizon .. PI/2 zenith
    const a = (seg / SEGS) * Math.PI * 2;
    return [Math.cos(el) * Math.cos(a), Math.sin(el), Math.cos(el) * Math.sin(a)];
  };
  const n = [0, 1, 0], c = [1, 1, 1];
  for (let r = 0; r < RINGS; r++) {
    for (let s = 0; s < SEGS; s++) {
      const a = pt(r, s), b = pt(r, s + 1), d = pt(r + 1, s + 1), e = pt(r + 1, s);
      g.pos.push(...a, ...b, ...d, ...a, ...d, ...e, ...a, ...d, ...b, ...a, ...e, ...d);
      for (let k = 0; k < 12; k++) g.nrm.push(...n);
      for (let k = 0; k < 12; k++) g.col.push(...c);
    }
  }
  return g;
}

// One cloud puff: 5 overlapping flattened low-poly spheres — real
// rounded volume from every angle, never a flat slab. Vertex colours
// shade smoothly from bright white on top to grey underneath, so the
// puff reads thick and soft. Base colour is white: the per-instance
// tint carries the time-of-day colour (day white, sunset warm, rain
// grey, night dark moonlit).
export function buildCloudPuffGeom() {
  const g = emptyGeom();
  const GREY = [0.78, 0.78, 0.81], WHITE = [1, 1, 1];
  const blob = (r, sy, cx, cy, cz) => {
    const SEGS = 8, RINGS = 5;
    const pt = (ring, seg) => {
      const el = (ring / RINGS) * Math.PI - Math.PI / 2; // -90..+90
      const a = (seg / SEGS) * Math.PI * 2;
      const ce = Math.cos(el);
      return [cx + r * ce * Math.cos(a), cy + r * Math.sin(el) * sy, cz + r * ce * Math.sin(a)];
    };
    const nAt = (ring, seg) => {
      const el = (ring / RINGS) * Math.PI - Math.PI / 2;
      const a = (seg / SEGS) * Math.PI * 2;
      return [Math.cos(el) * Math.cos(a), Math.sin(el), Math.cos(el) * Math.sin(a)];
    };
    const colAt = (ring, seg) => {
      const ny = Math.sin((ring / RINGS) * Math.PI - Math.PI / 2);
      const t = Math.min(1, Math.max(0, (ny + 0.2) / 0.7));
      return GREY.map((c, i) => c * (1 - t) + WHITE[i] * t);
    };
    for (let ri = 0; ri < RINGS; ri++) {
      for (let s = 0; s < SEGS; s++) {
        const a = pt(ri, s), b = pt(ri, s + 1), d = pt(ri + 1, s + 1), e = pt(ri + 1, s);
        const na = nAt(ri, s), nb = nAt(ri, s + 1), nd = nAt(ri + 1, s + 1), ne = nAt(ri + 1, s);
        const ca = colAt(ri, s), cb = colAt(ri, s + 1), cd = colAt(ri + 1, s + 1), ce = colAt(ri + 1, s);
        g.pos.push(...a, ...b, ...d, ...a, ...d, ...e, ...a, ...d, ...b, ...a, ...e, ...d);
        g.nrm.push(...na, ...nb, ...nd, ...na, ...nd, ...ne, ...na, ...nd, ...nb, ...na, ...ne, ...nd);
        g.col.push(...ca, ...cb, ...cd, ...ca, ...cd, ...ce, ...ca, ...cd, ...cb, ...ca, ...ce, ...cd);
      }
    }
  };
  blob(20, 0.5, 0, 0, 0);       // main body
  blob(13, 0.55, -11, 4, 1);    // left hump
  blob(12, 0.55, 11, 3.5, -1);  // right hump
  blob(9, 0.6, 1, 7, -2);       // top tuft
  blob(8, 0.5, -3, 3, 7);       // front puff
  return g;
}

// Cloud placement: 18 puffs, varied sizes/heights, spread over the whole
// map and the sea — never in neat rows, never at one height. Drift is a
// slow wind (0.3–0.8 m/s); the renderer wraps x across [-1100, 1100].
export function buildCloudSpec() {
  const rand = mulberry32(20261130);
  const clouds = [];
  for (let k = 0; k < 18; k++) {
    clouds.push({
      x: -1000 + rand() * 2000,
      y: 175 + rand() * 90,
      z: -950 + rand() * 1900,
      scale: 0.75 + rand() * 1.45,
      drift: 0.3 + rand() * 0.5,
      shade: 0.9 + rand() * 0.12, // per-cloud brightness variation
    });
  }
  return { geom: buildCloudPuffGeom(), clouds };
}

// Sky + cloud colours for a time of day (hours 0-24) and rain amount.
// Day: deep blue top, pale horizon. Low sun (morning/evening): the
// horizon and the cloud tint near the sun shift orange/pink — subtle.
// Night: dark blue, horizon stays dark. Rain: everything greys over.
export function skyColors(timeHours, rainAmt = 0) {
  const dayT = (timeHours - 6) / 12;
  const elev = Math.sin(dayT * Math.PI);
  const isDay = timeHours >= 6 && timeHours < 18;
  const warm = 1 - Math.max(0, elev); // 1 at dawn/dusk, 0 at noon
  const mix = (a, b, k) => a.map((c, i) => c * (1 - k) + b[i] * k);
  let top, horizon, cloudTint, sunGlow;
  if (isDay) {
    top = [0.2 + 0.06 * elev, 0.44 + 0.12 * elev, 0.88];
    horizon = [0.62 + 0.12 * elev, 0.76 + 0.07 * elev, 0.94];
    // Low sun warms the horizon band (and the clouds) orange-pink.
    const wk = warm * 0.55;
    horizon = mix(horizon, [0.98, 0.6, 0.42], wk);
    top = mix(top, [0.4, 0.45, 0.78], warm * 0.35);
    cloudTint = mix([1, 1, 1], [1, 0.82, 0.66], warm * 0.6);
    sunGlow = [0.9, 0.55, 0.3];
  } else {
    top = [0.02, 0.03, 0.08];
    horizon = [0.05, 0.07, 0.14];
    cloudTint = [0.14, 0.16, 0.26]; // thin dark moonlit clouds
    sunGlow = [0, 0, 0];
  }
  if (rainAmt > 0) {
    const k = rainAmt * 0.55;
    top = mix(top, [0.42, 0.45, 0.5], k);
    horizon = mix(horizon, [0.5, 0.53, 0.58], k);
    cloudTint = mix(cloudTint, [0.5, 0.53, 0.58], rainAmt * 0.7); // thicker, greyer
    sunGlow = [0, 0, 0];
  }
  // Direction TO the sun (lightFor's sun points the other way) + glow
  // strength: strong at dawn/dusk, faint at noon, none at night/rain.
  const sunDirTo = [0.45, 0.25 + 0.75 * Math.max(0, elev), 0.55];
  const sl = Math.hypot(...sunDirTo);
  const glowStrength = isDay && rainAmt < 0.05 ? 0.25 + warm * 0.75 : 0;
  return {
    top, horizon, cloudTint,
    sunDirTo: sunDirTo.map((c) => c / sl),
    sunGlow: sunGlow.map((c) => c * glowStrength),
    rainScale: 1 + rainAmt * 0.15,
  };
}

export function buildMoonGeom() {
  // Flat disc facing +z (the camera looks at it from the city, roughly
  // north-west up). 24-segment fan, pale moon colour.
  const g = emptyGeom();
  const r = 34;
  const col = [0.96, 0.96, 0.88];
  const n = [0, 0, 1];
  for (let i = 0; i < 24; i++) {
    const a0 = (i / 24) * Math.PI * 2, a1 = ((i + 1) / 24) * Math.PI * 2;
    const p0 = [Math.cos(a0) * r, Math.sin(a0) * r, 0];
    const p1 = [Math.cos(a1) * r, Math.sin(a1) * r, 0];
    // Both windings: the moon is visible from anywhere in the city.
    g.pos.push(0, 0, 0, ...p0, ...p1, 0, 0, 0, ...p1, ...p0);
    for (let k = 0; k < 6; k++) g.nrm.push(...n);
    for (let k = 0; k < 6; k++) g.col.push(...col);
  }
  return g;
}

export function buildStarsSpec() {
  const rand = mulberry32(20261128);
  const quad = (() => {
    const g = emptyGeom();
    const col = [1, 1, 1];
    const n = [0, 0, 1];
    // CCW when viewed from +z, so the front face points at the city.
    g.pos.push(-1.2, -1.2, 0, 1.2, -1.2, 0, 1.2, 1.2, 0, -1.2, -1.2, 0, 1.2, 1.2, 0, -1.2, 1.2, 0);
    for (let k = 0; k < 6; k++) g.nrm.push(...n);
    for (let k = 0; k < 6; k++) g.col.push(...col);
    return g;
  })();
  const matrices = [], tints = [];
  for (let k = 0; k < 240; k++) {
    // Random point on the upper dome, radius 800-950, facing the origin.
    const a = rand() * Math.PI * 2;
    const el = 0.25 + rand() * 1.2; // elevation above the horizon
    const r = 820 + rand() * 120;
    const x = Math.cos(a) * Math.cos(el) * r;
    const y = 120 + Math.sin(el) * r * 0.7;
    const z = Math.sin(a) * Math.cos(el) * r;
    // Face the star toward the city centre so it is visible from anywhere.
    const yaw = Math.atan2(-x, -z);
    matrices.push(mat4TRS(x, y, z, yaw, 1, 1, 1));
    const b = 0.45 + rand() * 0.55;
    tints.push([b, b, Math.min(1, b + 0.1)]);
  }
  return { geom: quad, matrices, tints };
}
