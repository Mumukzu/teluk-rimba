// Teluk Rimba — roads, sidewalks, markings, lamps, traffic lights.
// One merged mesh for all ground paint (asphalt, sidewalks, dashes, zebras),
// built from the same city dataset as the buildings and the minimap.
import { ROAD_LINES, MAIN_LINES, IS_MAIN, CORRIDOR_HALF, ASPHALT_HALF, riverDistance } from './city.js';
import { emptyGeom, plainBox, mat4TRS } from './gl.js';

const ASPHALT = [0.29, 0.29, 0.3]; // mid-tone grey, clearly darker than sidewalk
// Sidewalks: mid grey, clearly darker than the old near-white so the road
// edge reads; alternate 8 m tile shades for a paver read. Kerb: a darker
// raised lip (0.19) along the asphalt edge.
// Sidewalk tiles (Mu): two CLEARLY distinct tones (0.28 apart) in a
// 2 m x 1.5 m checker + thin dark grout lines, so the pattern reads
// from street level and from the air. The old 8 m slabs were only 0.07
// apart and read as flat. SIDEWALK is the light tile (also the rounded
// corner fans at intersections).
const SIDEWALK = [0.72, 0.71, 0.67];
const TILE_DARK = [0.44, 0.43, 0.4];
const TILE_GROUT = [0.32, 0.31, 0.29];
const KERB = [0.42, 0.41, 0.39];
const DASH_MAIN = [0.85, 0.72, 0.25]; // thin yellow dashes on main roads
const DASH_MINOR = [0.88, 0.88, 0.86]; // thin white dashes on small roads
const ZEBRA = [0.92, 0.92, 0.9];

function tri(g, a, b, c, y, col) {
  // Single up-facing triangle (a,c,b winding, same as quad()).
  const n = [0, 1, 0];
  const P = (p) => [p[0], y, p[1]];
  g.pos.push(...P(a), ...P(c), ...P(b));
  for (let k = 0; k < 3; k++) g.nrm.push(...n);
  for (let k = 0; k < 3; k++) g.col.push(...col);
}

function quad(g, a, b, c, d, y, col) {
  // Winding a->c->b faces +y (up); the naive a->b->c order faces down and
  // gets culled, leaving the streets invisible.
  const n = [0, 1, 0];
  const P = (p) => [p[0], y, p[1]];
  g.pos.push(...P(a), ...P(c), ...P(b), ...P(a), ...P(d), ...P(c));
  for (let k = 0; k < 6; k++) g.nrm.push(...n);
  for (let k = 0; k < 6; k++) g.col.push(...col);
}

function vquad(g, a, b, c, d, n, col) {
  // Vertical quad from four 3D points [x, y, z]; points must be ordered
  // counter-clockwise as seen from the normal side (a->b->c->d).
  g.pos.push(...a, ...b, ...c, ...a, ...c, ...d);
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

// Zebra on EVERY leg of an intersection (not just one approach): a leg is
// kept only if the edge exists, is not a bridge deck, and the crossing sits
// on land. Returns a Map keyed by node id -> array of {x, z, alongX, dir}.
// (zebraSpots stays as-is: the frozen phase-f test asserts one spot per
// node through it.)
export function zebraLegs(city) {
  const legs = new Map();
  const nodeByIJ = new Map(city.nodes.map((n) => [n.i + ',' + n.j, n]));
  const edgeOf = new Map();
  for (const e of city.edges) {
    edgeOf.set(e.a + '|' + e.b, e);
    edgeOf.set(e.b + '|' + e.a, e);
  }
  for (const n of city.nodes) {
    const arr = [];
    const ah = Math.max(ASPHALT_HALF(n.x), ASPHALT_HALF(n.z));
    for (const [di, dj, alongX, dir] of [[1, 0, true, 1], [-1, 0, true, -1], [0, -1, false, -1], [0, 1, false, 1]]) {
      const m = nodeByIJ.get((n.i + di) + ',' + (n.j + dj));
      if (!m) continue;
      const e = edgeOf.get(n.id + '|' + m.id);
      if (!e || e.bridge) continue; // no zebra on a bridge deck
      const cx = alongX ? n.x + dir * 10 : n.x;
      const cz = alongX ? n.z : n.z + dir * 10;
      const ends = alongX
        ? [[cx, cz - ah + 1.4], [cx, cz + ah - 1.4]]
        : [[cx - ah + 1.4, cz], [cx + ah - 1.4, cz]];
      if (![[cx, cz], ...ends].every(([x, z]) => riverDistance(x, z) > 11)) continue;
      arr.push({ x: n.x, z: n.z, alongX, dir });
    }
    legs.set(n.id, arr);
  }
  return legs;
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
    // Asphalt runs the full segment (under the intersection squares too).
    if (horiz) {
      quad(g, [from, fixed - ah], [to, fixed - ah], [to, fixed + ah], [from, fixed + ah], 0.03, ASPHALT);
    } else {
      quad(g, [fixed - ah, from], [fixed + ah, from], [fixed + ah, to], [fixed - ah, to], 0.03, ASPHALT);
    }
    // Sidewalk strip on one side (side = -1 | +1): 8 m tile segments in
    // alternating shades, raised to 0.16 (above the asphalt), plus a
    // darker raised kerb lip (0.19) at the asphalt edge. Clipped to
    // [from+ah, to-ah] so the strip never crosses a road mouth — the
    // intersection corners are closed by rounded fans (see buildRoadMesh).
    // Corner order is normalised (a,b on the low edge) so the winding
    // always faces +y on both sides and both orientations.
    const sidewalkStrip = (side) => {
      // Clip to the intersection square's edge at each end (the square
      // spans ±max(ah, crossing ah) around the node), so the strip never
      // crosses a road mouth.
      const s0 = from + Math.max(ah, ASPHALT_HALF(from)), s1 = to - Math.max(ah, ASPHALT_HALF(to));
      if (s1 - s0 < 2) return;
      const inner = fixed + side * ah, outer = fixed + side * ch;
      const lo = Math.min(inner, outer), hi = Math.max(inner, outer);
      // Tile pattern: 2 m long x 1.5 m wide checker (2 rows), tones
      // alternating by (column + row) parity, so the grid reads from
      // street level and from the air.
      const TILE = 2, ROWS = 2, rowW = (hi - lo) / ROWS;
      let col = 0;
      for (let s = s0; s < s1; s += TILE, col++) {
        const e = Math.min(s + TILE, s1);
        for (let r = 0; r < ROWS; r++) {
          const rlo = lo + r * rowW, rhi = rlo + rowW;
          const tone = (col + r) % 2 === 0 ? SIDEWALK : TILE_DARK;
          if (horiz) quad(g, [s, rlo], [e, rlo], [e, rhi], [s, rhi], 0.16, tone);
          else quad(g, [rlo, s], [rhi, s], [rhi, e], [rlo, e], 0.16, tone);
        }
      }
      // Grout: thin dark transverse lines at each tile boundary + one
      // longitudinal line down the middle of the strip (y 0.17, above
      // the tiles, below the kerb lip).
      for (let s = s0 + TILE; s < s1; s += TILE) {
        if (horiz) quad(g, [s - 0.06, lo], [s + 0.06, lo], [s + 0.06, hi], [s - 0.06, hi], 0.17, TILE_GROUT);
        else quad(g, [lo, s - 0.06], [hi, s - 0.06], [hi, s + 0.06], [lo, s + 0.06], 0.17, TILE_GROUT);
      }
      const mid = (lo + hi) / 2;
      if (horiz) quad(g, [s0, mid - 0.06], [s1, mid - 0.06], [s1, mid + 0.06], [s0, mid + 0.06], 0.17, TILE_GROUT);
      else quad(g, [mid - 0.06, s0], [mid + 0.06, s0], [mid + 0.06, s1], [mid - 0.06, s1], 0.17, TILE_GROUT);
      const kLo = Math.min(inner, inner + side * 0.45), kHi = Math.max(inner, inner + side * 0.45);
      if (horiz) quad(g, [s0, kLo], [s1, kLo], [s1, kHi], [s0, kHi], 0.19, KERB);
      else quad(g, [kLo, s0], [kHi, s0], [kHi, s1], [kLo, s1], 0.19, KERB);
      // Vertical kerb face: closes the slit between the asphalt (y 0.03)
      // and the raised kerb lip (y 0.19) — without it the grass terrain
      // shows through as a bright green strip along every road edge.
      const riser = (sd) => {
        const inn = fixed + sd * ah, y0 = 0.03, y1 = 0.19;
        if (horiz) {
          if (sd < 0) vquad(g, [s0, y0, inn], [s1, y0, inn], [s1, y1, inn], [s0, y1, inn], [0, 0, 1], KERB);
          else vquad(g, [s1, y0, inn], [s0, y0, inn], [s0, y1, inn], [s1, y1, inn], [0, 0, -1], KERB);
        } else {
          if (sd < 0) vquad(g, [inn, y0, s1], [inn, y0, s0], [inn, y1, s0], [inn, y1, s1], [1, 0, 0], KERB);
          else vquad(g, [inn, y0, s0], [inn, y0, s1], [inn, y1, s1], [inn, y1, s0], [-1, 0, 0], KERB);
        }
      };
      riser(-1); riser(1);
    };
    sidewalkStrip(-1);
    sidewalkStrip(1);
    const m0 = from + 16, m1 = to - 16; // marking range, clear of crossings
    // Solid white edge lines on both sides of the asphalt.
    const edge = (off) => {
      if (horiz) quad(g, [m0, fixed + off - 0.075], [m1, fixed + off - 0.075], [m1, fixed + off + 0.075], [m0, fixed + off + 0.075], 0.06, DASH_MINOR);
      else quad(g, [fixed + off - 0.075, m0], [fixed + off + 0.075, m0], [fixed + off + 0.075, m1], [fixed + off - 0.075, m1], 0.06, DASH_MINOR);
    };
    edge(-ah + 0.35); edge(ah - 0.35);
    // Drain covers: dark grates on the sidewalk (clear of the kerb lip and
    // the lamp line), every ~35 m, clear of intersections — same merged
    // ground mesh, no extra draw call. At y 0.18, above the tile grout
    // lines (0.17), so a drain never z-fights a grout line.
    const DRAIN = [0.16, 0.16, 0.17];
    for (let s = m0 + 8; s < m1; s += 35) {
      for (const off of [-ah - 0.75, ah + 0.75]) {
        if (horiz) quad(g, [s - 0.45, fixed + off - 0.25], [s + 0.45, fixed + off - 0.25], [s + 0.45, fixed + off + 0.25], [s - 0.45, fixed + off + 0.25], 0.18, DRAIN);
        else quad(g, [fixed + off - 0.25, s - 0.45], [fixed + off + 0.25, s - 0.45], [fixed + off + 0.25, s + 0.45], [fixed + off - 0.25, s + 0.45], 0.18, DRAIN);
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
  // quadrant instead of painting asphalt into the water. A zebra crossing
  // + a stop line on EVERY leg, and a rounded sidewalk corner fan at each
  // corner of the square (radius 3 m, closing the clipped sidewalk strips
  // with a curved outer edge instead of a stiff 90° point).
  const legs = zebraLegs(city);
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
    for (const leg of legs.get(node.id) || []) {
      zebraCrossing(g, leg.x, leg.z, leg.alongX, leg.dir, ah);
      stopLine(g, leg.x, leg.z, leg.alongX, leg.dir, ah);
    }
    // Rounded corners: quarter-disc fan (4 segments) at each corner of
    // the square, centred on the square's corner, arcing outward to the
    // two sidewalk strips. Skipped where the corner would sit in water.
    const fanR = 3;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const cx = node.x + sx * ah, cz = node.z + sz * ah;
      const midX = cx + sx * fanR * 0.7071, midZ = cz + sz * fanR * 0.7071;
      if (riverDistance(cx, cz) < 12 || riverDistance(midX, midZ) < 12) continue;
      let prev = [cx + sx * fanR, cz];
      for (let k = 1; k <= 4; k++) {
        const a = (k / 4) * Math.PI / 2;
        const p = [cx + Math.cos(a) * fanR * sx, cz + Math.sin(a) * fanR * sz];
        tri(g, [cx, cz], prev, p, 0.16, SIDEWALK);
        prev = p;
      }
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
