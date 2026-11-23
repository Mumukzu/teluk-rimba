// Lively city checks (Mu): varied building shapes, livelier facades,
// vertical neon, street life, used roofs, small animations — plus the
// ground-floor glass for tall buildings. All code-made, no flags.
// Pure geometry: buildLivelyMeshes + buildBuildingMeshes run in Node
// (document is undefined — the canvas atlases are null there).
import { generateCity, riverDistance } from '../game/src/city.js';
import { buildBuildingMeshes, buildLitWindows } from '../game/src/buildings.js';
import { buildLivelyMeshes } from '../game/src/lively.js';
import { buildShopGlow } from '../game/src/shopglow.js';

let fails = 0;
function check(name, ok, extra = '') {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (extra ? ' — ' + extra : ''));
  if (!ok) fails++;
}

const city = generateCity();
const lv = buildLivelyMeshes(city);
const meshes = buildBuildingMeshes(null, { litInst: 'LIT' }, city);
const allFin = (mats) => mats.every((mt) => { for (const v of mt) if (!Number.isFinite(v)) return false; return true; });
const allFinT = (t) => t.every((c) => c.every((v) => Number.isFinite(v)));
const allFinG = (g) => g.pos.every(Number.isFinite) && g.nrm.every(Number.isFinite) && g.col.every(Number.isFinite);

// ---- Feature 1: varied building shapes ----
check('stepped tiers on tall unshaped blocks', lv.counts.stepped === 224, lv.counts.stepped + ' tiers');
check('pitched roofs on low houses/shops', lv.counts.pitched === 136, lv.counts.pitched + ' roofs');
check('pitched roof geometry is a closed prism (6 tris)', lv.pitched.geom.pos.length / 9 === 6);
check('stepped + pitched matrices are finite', allFin(lv.stepped.matrices) && allFin(lv.pitched.matrices));
check('stepped tiers only on h>=20 unshaped blocks',
  lv.stepped.matrices.every((m) => m[13] >= 20 + 1.5 - 0.01));

// ---- Ground-floor glass for tall buildings (Mu) ----
check('glass band covers all 1000 buildings (621 dark + 379 tall)',
  meshes.glassBand.matrices.length === 621
  && meshes.glassBandTall.matrices.length === 379
  && meshes.glassBand.matrices.length + meshes.glassBandTall.matrices.length === 1000,
  `${meshes.glassBand.matrices.length} + ${meshes.glassBandTall.matrices.length}`);
check('warm interior glow core on every tall building', meshes.glassGlow.matrices.length === 379);
check('glass + glow matrices and tints are finite',
  allFin(meshes.glassBandTall.matrices) && allFin(meshes.glassGlow.matrices)
  && allFinT(meshes.glassBandTall.tints) && allFinT(meshes.glassGlow.tints));

// ---- CBD full glass (Mu 23 Nov 21:19; tint lighter pale sky-blue Mu 23 Nov 22:17): lighter pale sky-blue curtain wall, warm
// lit windows on every tower, ground floor glowing on all four sides ----
{
  const sg = buildShopGlow(city);
  // 316 commercial front panels + 21 downtown towers x 4 faces = 400
  // ground panels + 11 amber sign bands (every other downtown tower).
  check('shop glow: 411 panels (400 ground + 11 sign bands, CBD towers glow on all 4 sides)', sg.counts.panels === 411, sg.counts.panels + ' panels');
  check('shop glow: 11 amber sign bands on downtown towers', sg.counts.bands === 11, sg.counts.bands + ' bands');
  check('shop glow: 400 ground spills (one per ground panel)', sg.counts.spills === 400, sg.counts.spills + ' spills');
  check('shop glow panels + spills are finite',
    allFin(sg.matrices) && allFinT(sg.tints) && allFin(sg.spill.matrices) && allFinT(sg.spill.tints));
  const lw = buildLitWindows(city);
  // 21 downtown towers x 80 warm windows + the other zones unchanged.
  check('lit windows: 11,248 (CBD towers light 80 each, all warm, bigger quads)', lw.matrices.length === 11248, lw.matrices.length + ' windows');
  check('lit window matrices + tints are finite', allFin(lw.matrices) && allFinT(lw.tints));
}

// ---- Feature 2: livelier facades ----
check('curtains inside real window cells (thousands)', lv.counts.curtains > 1000, lv.counts.curtains + ' curtains');
check('curtain matrices + tints are finite', allFin(lv.curtains.matrices) && allFinT(lv.curtains.tints));
check('facade clutter geometry is finite', allFinG(lv.clutter));
// Mu 23 Nov 21:19: NO murals on downtown glass towers — murals stay on
// commercial (4) + beach (2) walls only, so the CBD curtain wall stays clean.
check('6 geometric murals on tall walls (no murals on CBD glass)', lv.counts.murals === 6);
check('mural panels carry UVs', lv.muralGeom.uv.length === lv.muralGeom.pos.length / 3 * 2);
check('laundry pieces fit the 200-capacity dynamic mesh', lv.counts.laundry <= 200, lv.counts.laundry + ' pieces');

// ---- Feature 3: vertical neon ----
check('vertical neon panels on commercial/CBD facades', lv.counts.neon === 140, lv.counts.neon + ' panels');
check('one neon halo per panel', lv.neonGlow.matrices.length === lv.counts.neon);
check('neon halos fit the 160-capacity dynamic mesh', lv.neonGlow.matrices.length <= 160);
check('neon geometry + halos are finite',
  allFin(lv.neonGlow.matrices) && lv.neonGeom.pos.every(Number.isFinite) && lv.neonGeom.uv.every(Number.isFinite));

// ---- Feature 4: street life ----
check('20 food carts placed', lv.counts.carts === 20);
check('12 tent warungs placed', lv.counts.tents === 12);
check('25 cafe table sets placed', lv.counts.cafe === 25);
check('street life stays out of the river (>= 20 m)',
  lv.streetSpots.length === 57 && lv.streetSpots.every((s) => riverDistance(s.x, s.z) >= 20),
  lv.streetSpots.length + ' spots, min rd ' + Math.min(...lv.streetSpots.map((s) => riverDistance(s.x, s.z))).toFixed(1));

// ---- Feature 5: used roofs ----
check('roofs in use (gardens + pools + helipads + courts)', lv.counts.roofUse === 220, lv.counts.roofUse + ' roofs');
check('roof-use kinds add up',
  lv.counts.roofUseKinds.garden + lv.counts.roofUseKinds.pool
  + lv.counts.roofUseKinds.helipad + lv.counts.roofUseKinds.court === lv.counts.roofUse,
  JSON.stringify(lv.counts.roofUseKinds));

// ---- Feature 6 (data): smoke + laundry ----
check('smoke spots: chimneys + warungs', lv.counts.smokeSpots >= 50, lv.counts.smokeSpots + ' spots');
check('2 smoke puffs per spot fit the 160-capacity mesh', lv.counts.smokeSpots * 2 <= 160);
check('smoke spots are finite',
  lv.smokeSpots.every((s) => Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.z)));
check('cloth geometry pivots at its top edge (sway axis)',
  Math.max(...lv.clothGeom.pos.filter((_, i) => i % 3 === 1)) === 0);

// ---- No flags, no outside assets ----
check('no pennant/flag geometry in the lively module',
  !JSON.stringify(lv.counts).includes('flag'));

if (fails) { console.error(fails + ' LIVELY CHECK(S) FAILED'); process.exit(1); }
console.log('ALL LIVELY CHECKS PASSED');
