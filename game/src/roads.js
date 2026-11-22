// Teluk Rimba — roads, sidewalks, markings, lamps, traffic lights.
// One merged mesh for all ground paint (asphalt, sidewalks, dashes, zebras),
// built from the same city dataset as the buildings and the minimap.
import { ROAD_LINES, MAIN_LINES, IS_MAIN, CORRIDOR_HALF, ASPHALT_HALF, riverDistance } from './city.js';
import { emptyGeom, plainBox, mat4TRS } from './gl.js';

const ASPHALT = [0.29, 0.29, 0.3]; // mid-tone grey, clearly darker than sidewalk
const SIDEWALK = [0.62, 0.61, 0.58];
const DASH_MAIN = [0.85, 0.72, 0.25]; // thin yellow dashes on main roads
const DASH_MINOR = [0.88, 0.88, 0.86]; // thin white dashes on small roads
const ZEBRA = [0.92, 0.92, 0.9];

function quad(g, a, b, c, d, y, col) {
  // Winding a->c->b faces +y (up); the naive a->b->c order faces down and
  // gets culled, leaving the streets invisible.
  const n = [0, 1, 0];
  const P = (p) => [p[0], y, p[1]];
  g.pos.push(...P(a), ...P(c), ...P(b), ...P(a), ...P(d), ...P(c));
  for (let k = 0; k < 6; k++) g.nrm.push(...n);
  for (let k = 0; k < 6; k++) g.col.push(...col);
}

// One zebra crossing on one approach to an intersection: stripes run across
// the road, just before the stop line.
function zebra(g, cx, cz, alongX, roadHalf) {
  const off = 10; // distance from the intersection centre
  const len = 3.2; // stripe length along the direction of travel
  const w = 0.65; // stripe width
  const gap = 1.15;
  const n = Math.floor((roadHalf * 2 - 2) / (w + gap));
  for (let i = 0; i < n; i++) {
    const across = -roadHalf + 1.4 + i * (w + gap) + w / 2;
    if (alongX) {
      const x0 = cx + off - len / 2, x1 = cx + off + len / 2;
      quad(g, [x0, cz + across - w / 2], [x1, cz + across - w / 2], [x1, cz + across + w / 2], [x0, cz + across + w / 2], 0.07, ZEBRA);
      const x0b = cx - off - len / 2, x1b = cx - off + len / 2;
      quad(g, [x0b, cz + across - w / 2], [x1b, cz + across - w / 2], [x1b, cz + across + w / 2], [x0b, cz + across + w / 2], 0.07, ZEBRA);
    } else {
      const z0 = cz + off - len / 2, z1 = cz + off + len / 2;
      quad(g, [cx + across - w / 2, z0], [cx + across + w / 2, z0], [cx + across + w / 2, z1], [cx + across - w / 2, z1], 0.07, ZEBRA);
      const z0b = cz - off - len / 2, z1b = cz - off + len / 2;
      quad(g, [cx + across - w / 2, z0b], [cx + across + w / 2, z0b], [cx + across + w / 2, z1b], [cx + across - w / 2, z1b], 0.07, ZEBRA);
    }
  }
}

export function buildRoadMesh(city) {
  const g = emptyGeom();
  const N = ROAD_LINES.length;
  // Asphalt + sidewalks + dashes, segment by segment.
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N - 1; i++) {
      const x0 = ROAD_LINES[i], x1 = ROAD_LINES[i + 1], z = ROAD_LINES[j];
      const main = IS_MAIN(z);
      const ah = ASPHALT_HALF(z), ch = CORRIDOR_HALF(z);
      quad(g, [x0, z - ah], [x1, z - ah], [x1, z + ah], [x0, z + ah], 0.03, ASPHALT);
      quad(g, [x0, z - ch], [x1, z - ch], [x1, z - ah], [x0, z - ah], 0.1, SIDEWALK);
      quad(g, [x0, z + ah], [x1, z + ah], [x1, z + ch], [x0, z + ch], 0.1, SIDEWALK);
      const dashCol = main ? DASH_MAIN : DASH_MINOR;
      const dashW = main ? 0.28 : 0.2;
      for (let s = x0 + 4; s < x1 - 4; s += 7) {
        quad(g, [s, z - dashW / 2], [s + 3.2, z - dashW / 2], [s + 3.2, z + dashW / 2], [s, z + dashW / 2], 0.06, dashCol);
      }
      // Main roads are 4 lanes (2 per direction): thin white lane dividers
      // at +/-3 m split each direction into two lanes.
      if (main) {
        for (let s = x0 + 4; s < x1 - 4; s += 7) {
          for (const off of [-3, 3]) {
            quad(g, [s, z + off - 0.1], [s + 3.2, z + off - 0.1], [s + 3.2, z + off + 0.1], [s, z + off + 0.1], 0.06, DASH_MINOR);
          }
        }
      }
    }
  }
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N - 1; j++) {
      const z0 = ROAD_LINES[j], z1 = ROAD_LINES[j + 1], x = ROAD_LINES[i];
      const main = IS_MAIN(x);
      const ah = ASPHALT_HALF(x), ch = CORRIDOR_HALF(x);
      quad(g, [x - ah, z0], [x + ah, z0], [x + ah, z1], [x - ah, z1], 0.03, ASPHALT);
      quad(g, [x - ch, z0], [x - ah, z0], [x - ah, z1], [x - ch, z1], 0.1, SIDEWALK);
      quad(g, [x + ah, z0], [x + ch, z0], [x + ch, z1], [x + ah, z1], 0.1, SIDEWALK);
      const dashCol = main ? DASH_MAIN : DASH_MINOR;
      const dashW = main ? 0.28 : 0.2;
      for (let s = z0 + 4; s < z1 - 4; s += 7) {
        quad(g, [x - dashW / 2, s], [x + dashW / 2, s], [x + dashW / 2, s + 3.2], [x - dashW / 2, s + 3.2], 0.06, dashCol);
      }
      // Main roads are 4 lanes (2 per direction): thin white lane dividers
      // at +/-3 m split each direction into two lanes.
      if (main) {
        for (let s = z0 + 4; s < z1 - 4; s += 7) {
          for (const off of [-3, 3]) {
            quad(g, [x + off - 0.1, s], [x + off + 0.1, s], [x + off + 0.1, s + 3.2], [x + off - 0.1, s + 3.2], 0.06, DASH_MINOR);
          }
        }
      }
    }
  }
  // Intersection squares (slightly above the segments) + one zebra per approach.
  for (const node of city.nodes) {
    const ah = Math.max(ASPHALT_HALF(node.x), ASPHALT_HALF(node.z));
    quad(g, [node.x - ah, node.z - ah], [node.x + ah, node.z - ah], [node.x + ah, node.z + ah], [node.x - ah, node.z + ah], 0.05, ASPHALT);
    zebra(g, node.x, node.z, true, ah);
    zebra(g, node.x, node.z, false, ah);
  }
  return g;
}

export function buildLampMeshes(city) {
  // Poles (lit, dark) + heads (unlit, warm) — both instanced, one draw each.
  const poleGeom = (() => {
    const g = emptyGeom();
    const pole = plainBox(0.18, 6, 0.18, [0.16, 0.16, 0.18]);
    for (let i = 0; i < pole.pos.length; i += 3) pole.pos[i + 1] += 3;
    const arm = plainBox(1.6, 0.14, 0.14, [0.16, 0.16, 0.18]);
    for (let i = 0; i < arm.pos.length; i += 3) { arm.pos[i] += 0.7; arm.pos[i + 1] += 5.9; }
    g.pos.push(...pole.pos, ...arm.pos);
    g.nrm.push(...pole.nrm, ...arm.nrm);
    g.col.push(...pole.col, ...arm.col);
    return g;
  })();
  const headGeom = plainBox(0.55, 0.22, 0.3, [1.0, 0.9, 0.6]);
  const poleMatrices = [], poleTints = [], headMatrices = [], headTints = [];
  for (const L of city.lamps) {
    // Arm points toward the nearest main road line. Work out whether that
    // road runs vertically (x = M) or horizontally (z = M) first.
    let vertM = null, vertD = Infinity, horizM = null, horizD = Infinity;
    for (const M of MAIN_LINES) {
      if (Math.abs(L.x - M) < vertD) { vertD = Math.abs(L.x - M); vertM = M; }
      if (Math.abs(L.z - M) < horizD) { horizD = Math.abs(L.z - M); horizM = M; }
    }
    // Local +x maps to (cos rotY, 0, -sin rotY): rotY 0 -> +x, PI -> -x,
    // PI/2 -> -z, -PI/2 -> +z.
    let rotY;
    if (vertD <= horizD) rotY = L.x > vertM ? Math.PI : 0;
    else rotY = L.z > horizM ? Math.PI / 2 : -Math.PI / 2;
    poleMatrices.push(mat4TRS(L.x, 0, L.z, rotY, 1, 1, 1));
    poleTints.push([1, 1, 1]);
    const hx = L.x + Math.cos(rotY) * 1.5, hz = L.z - Math.sin(rotY) * 1.5;
    headMatrices.push(mat4TRS(hx, 6.0, hz, rotY, 1, 1, 1));
    headTints.push([1, 1, 1]);
  }
  return {
    poles: { geom: poleGeom, matrices: poleMatrices, tints: poleTints },
    heads: { geom: headGeom, matrices: headMatrices, tints: headTints },
  };
}

export function buildTrafficLightMesh(city) {
  // One housing + one lit green dot per light, merged into a single geometry
  // with per-vertex colours, instanced at every main intersection corner.
  const housing = plainBox(0.5, 1.1, 0.5, [0.12, 0.12, 0.13]);
  for (let i = 0; i < housing.pos.length; i += 3) housing.pos[i + 1] += 4.6;
  const pole = plainBox(0.16, 4.2, 0.16, [0.14, 0.14, 0.15]);
  for (let i = 0; i < pole.pos.length; i += 3) pole.pos[i + 1] += 2.1;
  const dot = plainBox(0.3, 0.3, 0.12, [0.1, 0.9, 0.2]);
  for (let i = 0; i < dot.pos.length; i += 3) { dot.pos[i + 1] += 4.35; dot.pos[i + 2] += 0.28; }
  const geom = emptyGeom();
  for (const p of [housing, pole, dot]) {
    geom.pos.push(...p.pos); geom.nrm.push(...p.nrm); geom.col.push(...p.col);
  }
  const matrices = [], tints = [];
  for (const t of city.trafficLights) {
    matrices.push(mat4TRS(t.x, 0, t.z, 0, 1, 1, 1));
    tints.push([1, 1, 1]);
  }
  return { geom, matrices, tints };
}
