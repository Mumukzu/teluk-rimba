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
// Mu 23 Nov 22:55 — CBD ground floor is a glass lobby now: glassBand holds
// the 621 low-house dark bands PLUS 21 bright lobby interiors (one per
// downtown tower, full lobby height); glassBandTall still holds one glass
// box per tall building (the downtown ones are taller + clearer now).
check('glass band covers all 1000 buildings + 21 downtown lobby interiors (621 dark + 21 lobby + 379 tall)',
  meshes.glassBand.matrices.length === 642
  && meshes.glassBandTall.matrices.length === 379
  && meshes.glassBand.matrices.length + meshes.glassBandTall.matrices.length === 1021,
  `${meshes.glassBand.matrices.length} + ${meshes.glassBandTall.matrices.length}`);
check('warm interior glow core on every tall building', meshes.glassGlow.matrices.length === 379);
check('glass + glow matrices and tints are finite',
  allFin(meshes.glassBandTall.matrices) && allFin(meshes.glassGlow.matrices)
  && allFinT(meshes.glassBandTall.tints) && allFinT(meshes.glassGlow.tints));
// ---- CBD glass lobby (Mu 23 Nov 22:55): no grey strip under the glass —
// big pillars + frames on all four faces of every downtown tower, clear
// glass + warm glow core at full lobby height (the curtain's ground row).
{
  const downtown = city.buildings.filter((b) => b.zone === 'downtown');
  const tall = (m) => m[5] > 3; // pillars/mullions/lobby glass are >3 m tall; bands/rails are not
  check('21 bright lobby interiors in the glass band (one per downtown tower)',
    meshes.glassBand.matrices.filter(tall).length === downtown.length,
    meshes.glassBand.matrices.filter(tall).length + ' interiors');
  check('21 full-height lobby glass boxes (downtown glassBandTall)',
    meshes.glassBandTall.matrices.filter(tall).length === downtown.length,
    meshes.glassBandTall.matrices.filter(tall).length + ' tall glass');
  check('21 full-height lobby glow cores (downtown glassGlow)',
    meshes.glassGlow.matrices.filter(tall).length === downtown.length,
    meshes.glassGlow.matrices.filter(tall).length + ' tall glows');
  // Mu 23 Nov 23:31 — the lobby glow read PALE WHITE at night: the old
  // [1.0,0.85,0.60] core behind the 0.32-alpha near-white glass lands at
  // ~[1.0,0.95,0.78], i.e. white. The lobby cores now use a deep amber
  // with a brighter jitter, so the composite through the glass still
  // reads warm amber (r-b >= 0.35 after the 0.32 glass veil).
  {
    const lobbyIdx = meshes.glassGlow.matrices
      .map((m, i) => (tall(m) ? i : -1)).filter((i) => i >= 0);
    const deepAmber = lobbyIdx.every((i) => {
      const t = meshes.glassGlow.tints[i];
      return t[0] >= 1.0 && t[1] >= 0.6 && t[1] <= 1.0 && t[2] <= 0.45;
    });
    check('lobby glow cores are deep amber + bright (Mu 23:31)', deepAmber,
      lobbyIdx.length + ' cores');
    const warmComposite = lobbyIdx.every((i) => {
      const g = meshes.glassGlow.tints[i];
      const r = Math.min(1, 0.32 * 0.93 + 0.68 * g[0]);
      const b = 0.32 * 1.0 + 0.68 * g[2];
      return r - b >= 0.35;
    });
    check('lobby glow reads warm amber through the 0.32 glass (r-b >= 0.35)', warmComposite);
  }
  check('lobby pillars + frames on every downtown tower (plinth mesh, tall parts)',
    meshes.plinth.matrices.filter(tall).length >= downtown.length * 30,
    meshes.plinth.matrices.filter(tall).length + ' tall plinth parts');
  // (matrices are Float32Array: 0.6 stores as 0.6000000238, so the height
  // epsilon must be 1e-6, not 1e-9.)
  const noPlinthBand = downtown.every((b) => !meshes.plinth.matrices.some((m) =>
    Math.abs(m[12] - b.x) < 1e-6 && Math.abs(m[13] - 0.3) < 1e-6 && Math.abs(m[14] - b.z) < 1e-6
    && Math.abs(m[5] - 0.6) < 1e-6));
  check('no dark plinth band on any downtown tower (grey strip gone)', noPlinthBand);
}

// ---- CBD full glass (Mu 23 Nov 21:19; tint lighter pale sky-blue Mu 23 Nov 22:17): lighter pale sky-blue curtain wall, warm
// lit windows on every tower, ground floor glowing on all four sides ----
{
  const sg = buildShopGlow(city);
  // 316 commercial front panels + 11 amber sign bands (every other
  // downtown tower). Mu 23 Nov 22:55 — downtown towers have a glass lobby
  // now, so their 84 flat ground panels are gone (the lobby glow core
  // lights the glass from inside instead); the 400 ground spills stay,
  // one per face, washing the sidewalk.
  check('shop glow: 327 panels (316 commercial + 11 sign bands, no flat downtown panel — glass lobby instead)', sg.counts.panels === 327, sg.counts.panels + ' panels');
  check('shop glow: 11 amber sign bands on downtown towers', sg.counts.bands === 11, sg.counts.bands + ' bands');
  check('shop glow: 400 ground spills (one per ground panel face)', sg.counts.spills === 400, sg.counts.spills + ' spills');
  // Mu 23 Nov 23:31 — downtown spills are deeper (7 m, was 5) and use a
  // deeper amber base at 0.95x (was 0.62x the pale tint), so the sidewalk
  // wash reads warm, not washed-out: 84 downtown spills (21 towers x 4
  // faces) at depth 7 with a bright red channel; commercial stays 3 m.
  {
    const depth = (m) => Math.hypot(m[8], m[9], m[10]);
    const deepSpills = sg.spill.matrices.filter((m) => Math.abs(depth(m) - 7) < 1e-6);
    check('84 downtown spills are 7 m deep (Mu 23:31)', deepSpills.length === 84,
      deepSpills.length + ' deep spills');
    const brightSpills = sg.spill.tints.filter((t) => t[0] >= 0.9).length;
    check('downtown spills are bright warm (red >= 0.9)', brightSpills >= 84,
      brightSpills + ' bright spills');
  }
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

// ---- Feature 6 (data): laundry only — smoke REMOVED (Mu, 23 Nov 2026:
// the drifting puffs read as artefacts in photos, not smoke) ----
check('smoke removed: no smokeSpots data or count on the lively module',
  lv.smokeSpots === undefined && lv.counts.smokeSpots === undefined
  && lv.streetSmokeSpots === undefined,
  'smokeSpots=' + lv.smokeSpots + ' counts.smokeSpots=' + lv.counts.smokeSpots);
check('cloth geometry pivots at its top edge (sway axis)',
  Math.max(...lv.clothGeom.pos.filter((_, i) => i % 3 === 1)) === 0);

// ---- No flags, no outside assets ----
check('no pennant/flag geometry in the lively module',
  !JSON.stringify(lv.counts).includes('flag'));

if (fails) { console.error(fails + ' LIVELY CHECK(S) FAILED'); process.exit(1); }
console.log('ALL LIVELY CHECKS PASSED');
