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

// One zebra crossing on ONE approach to an intersection: stripes run
// across the road at `dir * 10` m from the centre, with a solid stop line
// at `dir * 6.5` m (between the intersection and the zebra). One crossing
// per intersection — the old code drew four, which made an X of paint.
function zebraCrossing(g, cx, cz, alongX, dir, roadHalf) {
  const off = 10; // distance from the intersection centre
  const len = 3.2; // stripe length along the direction of travel
  const w = 0.65; // stripe width
  const gap = 1.15;
  const n = Math.floor((roadHalf * 2 - 2) / (w + gap));
  for (let i = 0; i < n; i++) {
    const across = -roadHalf + 1.4 + i * (w + gap) + w / 2;
    if (alongX) {
      const x0 = cx + dir * off - len / 2, x1 = cx + dir * off + len / 2;
      quad(g, [x0, cz + across - w / 2], [x1, cz + across - w / 2], [x1, cz + across + w / 2], [x0, cz + across + w / 2], 0.07, ZEBRA);
    } else {
      const z0 = cz + dir * off - len / 2, z1 = cz + dir * off + len / 2;
      quad(g, [cx + across - w / 2, z0], [cx + across + w / 2, z0], [cx + across + w / 2, z1], [cx + across - w / 2, z1], 0.07, ZEBRA);
    }
  }
}

function stopLine(g, cx, cz, alongX, dir, roadHalf) {
  const off = 6.5;
  if (alongX) {
    const x0 = cx + dir * off - 0.25, x1 = cx + dir * off + 0.25;
    quad(g, [x0, cz - roadHalf + 0.3], [x1, cz - roadHalf + 0.3], [x1, cz + roadHalf - 0.3], [x0, cz + roadHalf - 0.3], 0.07, ZEBRA);
  } else {
    const z0 = cz + dir * off - 0.25, z1 = cz + dir * off + 0.25;
    quad(g, [cx - roadHalf + 0.3, z0], [cx + roadHalf - 0.3, z0], [cx + roadHalf - 0.3, z1], [cx - roadHalf + 0.3, z1], 0.07, ZEBRA);
  }
}

// One zebra spot per intersection: the approach the crossing sits on.
// Prefers a non-bridge approach (a zebra on a bridge deck looks wrong),
// east first, then west, north, south. Returns a Map keyed by node id.
export function zebraSpots(city) {
  const spots = new Map();
  const nodeByIJ = new Map(city.nodes.map((n) => [n.i + ',' + n.j, n]));
  const edgeOf = new Map();
  for (const e of city.edges) {
    edgeOf.set(e.a + '|' + e.b, e);
    edgeOf.set(e.b + '|' + e.a, e);
  }
  for (const n of city.nodes) {
    // [di, dj, alongX, dir]: east, west, north, south.
    const tries = [[1, 0, true, 1], [-1, 0, true, -1], [0, -1, false, -1], [0, 1, false, 1]];
    let pick = null, pickBridge = null;
    for (const [di, dj, alongX, dir] of tries) {
      const m = nodeByIJ.get((n.i + di) + ',' + (n.j + dj));
      if (!m) continue;
      const e = edgeOf.get(n.id + '|' + m.id);
      if (!e) continue;
      if (!e.bridge) { pick = { x: n.x, z: n.z, alongX, dir }; break; }
      if (!pickBridge) pickBridge = { x: n.x, z: n.z, alongX, dir };
    }
    spots.set(n.id, pick || pickBridge || null);
  }
  return spots;
}

export function buildRoadMesh(city) {
  const g = emptyGeom();
  const N = ROAD_LINES.length;
  // Road segments from the road GRAPH (the source of truth): only edges
  // are drawn, so no grid stub can cross the river or end in the water —
  // the graph already drops non-bridge water crossings, and the city
  // prunes dead-end nodes. Only the 4 bridge edges cross the river.
  const nodeById = new Map(city.nodes.map((n) => [n.id, n]));
  const graphSegs = new Set();
  const bridgeSegs = new Set();
  for (const e of city.edges) {
    const a = nodeById.get(e.a), b = nodeById.get(e.b);
    graphSegs.add(`${a.x},${a.z}|${b.x},${b.z}`);
    graphSegs.add(`${b.x},${b.z}|${a.x},${a.z}`);
    if (!e.bridge) continue;
    bridgeSegs.add(`${a.x},${a.z}|${b.x},${b.z}`);
    bridgeSegs.add(`${b.x},${b.z}|${a.x},${a.z}`);
  }
  // One straight run of road (asphalt + sidewalks + markings) for the range
  // [from, to] along a segment. horiz: the run goes along x at fixed z.
  // Markings stay clear of intersections: dashes run from+16 to to-16
  // (the zebra sits at off 10, the stop line at 6.5, the square ends at ~6),
  // so paint never overlaps paint.
  const drawRun = (horiz, fixed, from, to, main) => {
    if (to - from < 2) return;
    const ah = ASPHALT_HALF(fixed), ch = CORRIDOR_HALF(fixed);
    if (horiz) {
      quad(g, [from, fixed - ah], [to, fixed - ah], [to, fixed + ah], [from, fixed + ah], 0.03, ASPHALT);
      quad(g, [from, fixed - ch], [to, fixed - ch], [to, fixed - ah], [from, fixed - ah], 0.1, SIDEWALK);
      quad(g, [from, fixed + ah], [to, fixed + ah], [to, fixed + ch], [from, fixed + ch], 0.1, SIDEWALK);
    } else {
      quad(g, [fixed - ah, from], [fixed + ah, from], [fixed + ah, to], [fixed - ah, to], 0.03, ASPHALT);
      quad(g, [fixed - ch, from], [fixed - ah, from], [fixed - ah, to], [fixed - ch, to], 0.1, SIDEWALK);
      quad(g, [fixed + ah, from], [fixed + ch, from], [fixed + ch, to], [fixed + ah, to], 0.1, SIDEWALK);
    }
    const m0 = from + 16, m1 = to - 16; // marking range, clear of crossings
    // Solid white edge lines on both sides of the asphalt.
    const edge = (off) => {
      if (horiz) quad(g, [m0, fixed + off - 0.075], [m1, fixed + off - 0.075], [m1, fixed + off + 0.075], [m0, fixed + off + 0.075], 0.06, DASH_MINOR);
      else quad(g, [fixed + off - 0.075, m0], [fixed + off + 0.075, m0], [fixed + off + 0.075, m1], [fixed + off - 0.075, m1], 0.06, DASH_MINOR);
    };
    edge(-ah + 0.35); edge(ah - 0.35);
    // Drain covers: dark grates on the sidewalk edge (kerb side), every
    // ~35 m, clear of intersections — same merged ground mesh, no extra
    // draw call. Offset ah+0.45 sits between the asphalt edge and the
    // lamp line (ah+0.9), so covers never sit under a lamp or a tree.
    const DRAIN = [0.16, 0.16, 0.17];
    for (let s = m0 + 8; s < m1; s += 35) {
      for (const off of [-ah - 0.45, ah + 0.45]) {
        if (horiz) quad(g, [s - 0.45, fixed + off - 0.25], [s + 0.45, fixed + off - 0.25], [s + 0.45, fixed + off + 0.25], [s - 0.45, fixed + off + 0.25], 0.11, DRAIN);
        else quad(g, [fixed + off - 0.25, s - 0.45], [fixed + off + 0.25, s - 0.45], [fixed + off + 0.25, s + 0.45], [fixed + off - 0.25, s + 0.45], 0.11, DRAIN);
      }
    }
    // Centre line: main roads get a double solid yellow line (4 lanes, 2
    // per direction), minor roads a single white dashed line.
    if (main) {
      for (const off of [-0.4, 0.4]) {
        if (horiz) quad(g, [m0, fixed + off - 0.075], [m1, fixed + off - 0.075], [m1, fixed + off + 0.075], [m0, fixed + off + 0.075], 0.06, DASH_MAIN);
        else quad(g, [fixed + off - 0.075, m0], [fixed + off + 0.075, m0], [fixed + off + 0.075, m1], [fixed + off - 0.075, m1], 0.06, DASH_MAIN);
      }
      // Thin white dashed lane dividers at +/-3 m split each direction.
      for (let s = m0; s < m1 - 3.2; s += 7) {
        for (const off of [-3, 3]) {
          if (horiz) quad(g, [s, fixed + off - 0.1], [s + 3.2, fixed + off - 0.1], [s + 3.2, fixed + off + 0.1], [s, fixed + off + 0.1], 0.06, DASH_MINOR);
          else quad(g, [fixed + off - 0.1, s], [fixed + off + 0.1, s], [fixed + off + 0.1, s + 3.2], [fixed + off - 0.1, s + 3.2], 0.06, DASH_MINOR);
        }
      }
    } else {
      for (let s = m0; s < m1 - 3.2; s += 7) {
        if (horiz) quad(g, [s, fixed - 0.1], [s + 3.2, fixed - 0.1], [s + 3.2, fixed + 0.1], [s, fixed + 0.1], 0.06, DASH_MINOR);
        else quad(g, [fixed - 0.1, s], [fixed + 0.1, s], [fixed + 0.1, s + 3.2], [fixed - 0.1, s + 3.2], 0.06, DASH_MINOR);
      }
    }
  };
  // Bridge rails + support pillars over the water span of a bridge segment.
  const RAIL = [0.85, 0.85, 0.8];
  const addBridgeDressing = (horiz, fixed, w0, w1) => {
    const ah = ASPHALT_HALF(fixed);
    const mid = (w0 + w1) / 2, len = Math.max(2, w1 - w0);
    const addBox = (box, x, y, z) => {
      for (let i = 0; i < box.pos.length; i += 3) { box.pos[i] += x; box.pos[i + 1] += y; box.pos[i + 2] += z; }
      g.pos.push(...box.pos); g.nrm.push(...box.nrm); g.col.push(...box.col);
    };
    for (const side of [-1, 1]) {
      const off = side * (ah + 0.5);
      const rail = horiz ? plainBox(len, 0.9, 0.15, RAIL) : plainBox(0.15, 0.9, len, RAIL);
      addBox(rail, horiz ? mid : fixed + off, 0.55, horiz ? fixed + off : mid);
    }
    for (const px of [w0 + 1.5, w1 - 1.5]) {
      const pillar = plainBox(1.4, 3.4, 1.4, [0.55, 0.55, 0.52]);
      addBox(pillar, horiz ? px : fixed, -1.6, horiz ? fixed : px);
    }
  };
  // Where does this segment meet the river? [t0, t1] in segment coords,
  // or null if it never comes within 14 m of the water.
  const riverSpan = (horiz, fixed, from, to) => {
    let t0 = null, t1 = null;
    for (let s = from; s <= to; s += 2) {
      const rd = horiz ? riverDistance(s, fixed) : riverDistance(fixed, s);
      if (rd < 14) { if (t0 === null) t0 = s; t1 = s; }
    }
    return t0 === null ? null : [t0, t1];
  };
  const drawSegment = (horiz, fixed, from, to, main) => {
    const key = horiz ? `${from},${fixed}|${to},${fixed}` : `${fixed},${from}|${fixed},${to}`;
    if (!graphSegs.has(key)) return; // not a graph edge: no road at all
    drawRun(horiz, fixed, from, to, main);
    if (bridgeSegs.has(key)) {
      const span = riverSpan(horiz, fixed, from, to);
      if (span) addBridgeDressing(horiz, fixed, span[0], span[1]);
    }
  };
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N - 1; i++) {
      drawSegment(true, ROAD_LINES[j], ROAD_LINES[i], ROAD_LINES[i + 1], IS_MAIN(ROAD_LINES[j]));
    }
  }
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N - 1; j++) {
      drawSegment(false, ROAD_LINES[i], ROAD_LINES[j], ROAD_LINES[j + 1], IS_MAIN(ROAD_LINES[i]));
    }
  }
  // Intersection squares, drawn as four quadrant quads so a square that
  // touches the river (the (0,-100) bridge endpoint) loses only the wet
  // quadrant instead of painting asphalt into the water. One zebra crossing
  // + one stop line per intersection, on the chosen approach.
  const spots = zebraSpots(city);
  for (const node of city.nodes) {
    const ah = Math.max(ASPHALT_HALF(node.x), ASPHALT_HALF(node.z));
    const quadAt = (sx, sz) => {
      const cx = node.x + sx * ah / 2, cz = node.z + sz * ah / 2;
      const hw = ah / 2;
      quad(g, [cx - hw, cz - hw], [cx + hw, cz - hw], [cx + hw, cz + hw], [cx - hw, cz + hw], 0.05, ASPHALT);
    };
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      // Skip a quadrant whose outer corner would sit in the water.
      const cornerRd = riverDistance(node.x + sx * ah, node.z + sz * ah);
      if (cornerRd < 12.5) continue;
      quadAt(sx, sz);
    }
    const spot = spots.get(node.id);
    if (spot) {
      zebraCrossing(g, spot.x, spot.z, spot.alongX, spot.dir, ah);
      stopLine(g, spot.x, spot.z, spot.alongX, spot.dir, ah);
    }
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
