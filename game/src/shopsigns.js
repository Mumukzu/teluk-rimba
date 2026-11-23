// Teluk Rimba — ground-floor shop signs + canopies (Phase I, Mu).
// Every building gets: (1) a soft-pastel sloped awning over its door /
// shopfront, (2) a shop/place NAME sign on its sign band (the white band
// on the shopfront kit / entrance kit at y 2.7). The old kit canopies are
// gone — the vivid shopfront accent tint and the facade-coloured entrance
// tint could not give a soft pastel awning, so the awning is its own
// instanced mesh here (white geometry x pastel tints, 1 draw).
// Names come from a pool of 48 English, city-flavoured shop names.
// Buildings facing the same street segment get distinct names (seeded
// shuffle per street group), so no street repeats a name. Text is drawn
// once onto a single shared canvas atlas (one texture) and every sign is
// one quad in a single static textured mesh — the same pattern as the
// direction signs (signs.js). Canopy + sign panels = +2 draw calls.
// All code-made, all derived from the shared city dataset.
import { ROAD_LINES } from './city.js';
import { plainBox, mat4TRS } from './gl.js';
import { addPanelQuad } from './signs.js';

export const SHOP_NAMES = [
  'Rimba Cafe', 'Teluk Bakery', 'Warung Kopi Rimba', 'Rimba Mart',
  'Coral Bakery', 'Palm Pharmacy', 'Jasmine Salon', 'Harbor Fish & Chips',
  'Sunset Bar', 'Mango Juice Bar', 'Coconut Cafe', 'Orchid Florist',
  'Banyan Books', 'Lotus Spa', 'Pearl Jewelry', 'Amber Tailor',
  'Marina Seafood', 'Lagoon Dive Shop', 'Breeze Laundry', 'Turtle Toys',
  'Dolphin Surf Shop', 'Frangipani Hotel', 'Hibiscus Salon', 'Kapok Furniture',
  'Sandalwood Spa', 'Nutmeg Spice Shop', 'Clove Cafe', 'Papaya Mart',
  'Tamarind Kitchen', 'Rattan Crafts', 'Seashell Souvenirs', 'Starfish Ice Cream',
  'Moonlight Bar', 'Sunrise Bakery', 'Emerald Optics', 'Jade Restaurant',
  'Ruby Tailor', 'Sapphire Electronics', 'Ivory Cafe', 'Opal Pharmacy',
  'Garnet Gym', 'Quartz Computer', 'Onyx Barbershop', 'Willow Tea House',
  'Rimba Noodle House', 'Teluk Pizza', 'Coral Dental', 'Palm Bike Shop',
];

// Soft pastel awning colours (Mu: varied soft pastel, like the old pink
// shopfront canopy — extended to every ground floor).
export const CANOPY_PASTELS = [
  [0.93, 0.74, 0.77], // soft pink
  [0.74, 0.84, 0.93], // soft blue
  [0.77, 0.90, 0.77], // soft mint
  [0.96, 0.88, 0.68], // soft butter
  [0.87, 0.79, 0.93], // soft lilac
  [0.96, 0.80, 0.66], // soft peach
  [0.70, 0.87, 0.87], // soft teal
  [0.93, 0.86, 0.74], // soft cream
];

// Light sign-board backgrounds (dark text must read on all of them).
const BOARD_COLORS = ['#f7f2e3', '#fdf3c4', '#dff2e3', '#ddebf7'];

const CELL_W = 768, CELL_H = 112, ATLAS_COLS = 4, ATLAS_ROWS = 12; // 48 cells
const SIGN_W = 3.0, SIGN_H = 0.45, SIGN_Y = 2.7, SIGN_PROUD = 0.16;
const CANOPY_Y = 3.1; // attaches at the facade, front edge ~2.86 (clears the sign top)

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function strHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const hash01 = (x, z) => {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

// Tilt a part around the X axis (local space): rotates positions and
// normals. Same convention as plots.js tiltX.
function tiltX(part, a) {
  const c = Math.cos(a), s = Math.sin(a);
  for (let i = 0; i < part.pos.length; i += 3) {
    const y = part.pos[i + 1], z = part.pos[i + 2];
    part.pos[i + 1] = y * c - z * s;
    part.pos[i + 2] = y * s + z * c;
  }
  for (let i = 0; i < part.nrm.length; i += 3) {
    const ny = part.nrm[i + 1], nz = part.nrm[i + 2];
    part.nrm[i + 1] = ny * c - nz * s;
    part.nrm[i + 2] = ny * s + nz * c;
  }
  return part;
}

// Sloped awning geometry (local space, door faces +z): a 6.4 m wide slab,
// back edge at the facade (z=0), sloping down toward the street so the
// front edge sits ~0.24 m lower. White — the instance tint supplies the
// pastel colour. Instances scale x (shops 1.0, houses 0.5) x kitScale.
export function buildCanopyGeom() {
  const g = plainBox(6.4, 0.1, 1.1, [1, 1, 1]);
  for (let i = 0; i < g.pos.length; i += 3) g.pos[i + 2] += 0.55; // back edge to z=0
  return tiltX(g, 0.22);
}

// Street segment a building faces: the road line just beyond its front
// face, plus the block index along that street. Buildings on both sides
// of the same street segment share the key, so the group gets distinct
// names and no street repeats a name.
export function streetGroup(b) {
  const nx = Math.sin(b.rot), nz = Math.cos(b.rot);
  const fx = b.x + nx * (b.d / 2), fz = b.z + nz * (b.d / 2);
  let axis, line;
  if (Math.abs(nz) > 0.5) {
    axis = 'z';
    line = nz > 0
      ? ROAD_LINES.find((L) => L > fz)
      : [...ROAD_LINES].reverse().find((L) => L < fz);
  } else {
    axis = 'x';
    line = nx > 0
      ? ROAD_LINES.find((L) => L > fx)
      : [...ROAD_LINES].reverse().find((L) => L < fx);
  }
  if (line === undefined) line = (nz > 0 || nx > 0) ? 600 : -600;
  const along = axis === 'z' ? b.x : b.z;
  let seg = 0;
  for (let i = 0; i < ROAD_LINES.length - 1; i++) {
    if (along >= ROAD_LINES[i] && along < ROAD_LINES[i + 1]) { seg = i; break; }
  }
  return axis + ':' + line + ':' + seg;
}

// Pure (no document): assign a shop name to every building, distinct
// within each street group. Returns a Map building -> name.
export function assignShopNames(city) {
  const groups = new Map();
  for (const b of city.buildings) {
    const key = streetGroup(b);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b);
  }
  const nameOf = new Map();
  for (const [key, list] of groups) {
    const rand = mulberry32(strHash(key));
    const pool = [...SHOP_NAMES];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    list.forEach((b, k) => nameOf.set(b, pool[k % pool.length]));
  }
  return { nameOf, groups };
}

// Draw the 48 name cells onto one canvas atlas (browser only).
function drawShopAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_COLS * CELL_W;
  canvas.height = ATLAS_ROWS * CELL_H;
  const ctx = canvas.getContext('2d');
  SHOP_NAMES.forEach((name, idx) => {
    const col = idx % ATLAS_COLS, row = Math.floor(idx / ATLAS_COLS);
    const x0 = col * CELL_W, y0 = row * CELL_H;
    ctx.fillStyle = BOARD_COLORS[idx % BOARD_COLORS.length];
    ctx.fillRect(x0, y0, CELL_W, CELL_H);
    ctx.strokeStyle = '#26262b';
    ctx.lineWidth = 4;
    ctx.strokeRect(x0 + 5, y0 + 5, CELL_W - 10, CELL_H - 10);
    ctx.fillStyle = '#1c1c20';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let px = 56;
    ctx.font = 'bold ' + px + 'px Arial, sans-serif';
    const w = ctx.measureText(name).width;
    if (w > CELL_W - 60) {
      px = Math.max(28, Math.floor(56 * (CELL_W - 60) / w));
      ctx.font = 'bold ' + px + 'px Arial, sans-serif';
    }
    ctx.fillText(name, x0 + CELL_W / 2, y0 + CELL_H / 2 + 2);
  });
  return canvas;
}

export function buildShopSigns(city) {
  const { nameOf, groups } = assignShopNames(city);
  const atlasCanvas = drawShopAtlas();
  const atlasW = ATLAS_COLS * CELL_W, atlasH = ATLAS_ROWS * CELL_H;

  const canopyMatrices = [], canopyTints = [];
  const panelGeom = { pos: [], uv: [] };
  let maxGroup = 0;
  for (const list of groups.values()) maxGroup = Math.max(maxGroup, list.length);

  for (const b of city.buildings) {
    const isShop = b.zone === 'commercial' || b.zone === 'downtown';
    const nx = Math.sin(b.rot), nz = Math.cos(b.rot);
    const fx = b.x + nx * (b.d / 2), fz = b.z + nz * (b.d / 2);
    const kitScale = Math.min(1.6, Math.max(0.8, b.w / 14));
    // Awning over the door / shopfront: shops full width, houses half.
    canopyMatrices.push(mat4TRS(fx, CANOPY_Y, fz, b.rot, kitScale * (isShop ? 1 : 0.5), 1, 1));
    canopyTints.push(CANOPY_PASTELS[Math.floor(hash01(b.x, b.z) * CANOPY_PASTELS.length)]);
    // Name sign: flat board on the sign band, 0.16 m proud of the facade.
    const nameIdx = SHOP_NAMES.indexOf(nameOf.get(b));
    const col = nameIdx % ATLAS_COLS, row = Math.floor(nameIdx / ATLAS_COLS);
    const u0 = (col * CELL_W) / atlasW;
    const u1 = ((col + 1) * CELL_W) / atlasW;
    const vTop = 1 - (row * CELL_H) / atlasH;
    const vBottom = 1 - ((row + 1) * CELL_H) / atlasH;
    addPanelQuad(
      panelGeom,
      fx + nx * SIGN_PROUD, SIGN_Y, fz + nz * SIGN_PROUD,
      [nx, 0, nz], SIGN_W, SIGN_H, [u0, vBottom, u1, vTop],
    );
  }

  return {
    canopy: { geom: buildCanopyGeom(), matrices: canopyMatrices, tints: canopyTints },
    panelGeom, atlasCanvas,
    counts: {
      canopies: canopyMatrices.length,
      signs: city.buildings.length,
      groups: groups.size,
      maxGroup,
    },
  };
}
