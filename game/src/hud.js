// Teluk Rimba — HUD (DOM) + minimap (2D canvas), Neon City style (Mu,
// option 1, 24 Nov): dark translucent panels, neon cyan/magenta/yellow
// accents, GTA-style layout — circular minimap bottom-left, money + wanted
// top-right, weapon + speedometer bottom-right, mission banner top-left.
// All in-game text is English (game rule). The map is drawn from the same
// city dataset as the 3D world, so it can never disagree with the streets:
// zone blocks, all 1,000 building boxes at their real positions, roads,
// river, lake, sea, stadium, mission markers, player arrow, north marker.
import { ROAD_LINES, RIVER_POINTS, AREA_NAMES, areaNameAt } from './city.js';

// --- Pure helpers (exported for Node tests) ---

// Brighten a 0..1 RGB colour into a neon version: push every channel away
// from the mean (more saturation), then scale so the brightest hits 1.
export function neonColor([r, g, b]) {
  const mean = (r + g + b) / 3;
  const sat = 2.0;
  let c = [r, g, b].map((v) => mean + (v - mean) * sat);
  const m = Math.max(c[0], c[1], c[2], 0.001);
  c = c.map((v) => Math.max(0, Math.min(1, v / m)));
  return c;
}

export function cssColor([r, g, b], alpha = 1) {
  return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${alpha})`;
}

// Neon fill colour for a zone block on the map / in the legend.
// Mu: every zone must read as a DIFFERENT colour. The pastel palettes in
// city.js share hues (downtown pale sky blue ≈ port blue-grey ≈
// residential white-blue; beach coral ≈ commercial terracotta), so no
// hue-preserving derivation can separate them — the anchors below are the
// neon-saturated version of each zone's most distinctive palette tone:
// downtown = pale sky blue glass, commercial = cream/peach amber,
// residential = mint variant, beach = aqua variant, port = blue-grey
// steel (darker, to stand apart from downtown), forest = sage/moss green.
// Building boxes on the map still use each building's real colour.
const ZONE_NEON = {
  downtown: [0.35, 0.65, 1.0],
  commercial: [1.0, 0.7, 0.3],
  residential: [0.55, 0.95, 0.7],
  beach: [0.25, 0.9, 0.9],
  port: [0.25, 0.45, 0.85],
  forest: [0.45, 0.85, 0.3],
  plaza: [1, 0.25, 0.85],
  market: [1, 0.8, 0.2],
  river: [0.13, 0.83, 0.93],
  sea: [0.13, 0.83, 0.93],
  volcano: [1, 0.35, 0.2],
};
export function zoneNeonFill(city, zone) {
  return ZONE_NEON[zone] || [0.6, 0.6, 0.6];
}

// Distance label: metres under 1 km, kilometres above.
export function formatDistance(m) {
  if (m == null || !Number.isFinite(m)) return '';
  if (m < 1000) return Math.round(m) + ' m';
  return (m / 1000).toFixed(1) + ' km';
}

// Health bar state (pure, Node-testable): fill width % + low-health flag
// (at or under 30 the bar reads as critical). Health is a real game
// value (Mu, 24 Nov 2026 — police gunfire), never an invented bar.
export function healthBarState(health) {
  const pct = Math.max(0, Math.min(100, Math.round(health ?? 100)));
  return { pct, low: pct <= 30 };
}

// Shared map drawing: zone blocks, sea, lake, river, roads, buildings,
// stadium, markers, player arrow, north marker. NO area-name text is drawn
// on the map tiles (Mu, 24 Nov 14:33 — "mini mapnya gak usah pake tulisan
// nama setiap daerah"): the old code drew one zone label per block (144
// blocks, all ~84 m wide, labels up to ~106 px wide at 11 px bold), so the
// names stacked into unreadable mush. Area names live only in the legend
// under the canvas.
// markers: [{x, z, color, shape}] — shape 'diamond' (mission/board),
// 'dollar' (shop), 'dot' (coin found). opts: {zoneAlpha}.

// Full-map overlay sizing (pure, Node-testable): the canvas must fit the
// viewport together with the title, legend, marker key and Close button.
// That chrome costs ~160 px at the sizes in ensureMapOverlay, so the canvas
// is vh-160, clamped to [280, 560] and to vw-32. At 960x540 the canvas is
// 380 px and the whole overlay fits (380 + 160 = 540).
export function fullMapLayout(vw, vh) {
  const w = Number.isFinite(vw) && vw > 0 ? vw : 960;
  const h = Number.isFinite(vh) && vh > 0 ? vh : 540;
  const size = Math.max(280, Math.min(560, h - 160, w - 32));
  return { size, fits: size + 160 <= h };
}
export function drawCityMap(c, city, w, h, player, timeHours, markers, opts = {}) {
  const sc = w / 1400;
  const X = (x) => (x + 700) * sc;
  const Y = (z) => (z + 700) * sc;
  const night = timeHours < 6 || timeHours >= 18;
  const zoneAlpha = opts.zoneAlpha ?? 0.32;
  c.fillStyle = night ? '#070d18' : '#0a1826';
  c.fillRect(0, 0, w, h);
  // Zone blocks (neon, from the real palette) — under everything else.
  for (const b of city.blocks) {
    c.fillStyle = cssColor(zoneNeonFill(city, b.zone), zoneAlpha);
    c.fillRect(X(b.x0), Y(b.z0), (b.x1 - b.x0) * sc, (b.z1 - b.z0) * sc);
  }
  // Sea (east).
  c.fillStyle = night ? '#0a2438' : '#0e3a5c';
  c.fillRect(X(640), 0, w - X(640), h);
  // Lake below the waterfall at (-440,-440), ~80 m disc.
  c.fillStyle = night ? '#14486e' : '#2a7ab8';
  c.beginPath();
  c.arc(X(-440), Y(-440), Math.max(2, 40 * sc), 0, Math.PI * 2);
  c.fill();
  // River.
  c.strokeStyle = night ? '#1b6ea8' : '#35b6e8';
  c.lineWidth = Math.max(2, 22 * sc);
  c.beginPath();
  RIVER_POINTS.forEach(([x, z], i) => { if (i === 0) c.moveTo(X(x), Y(z)); else c.lineTo(X(x), Y(z)); });
  c.stroke();
  // Roads.
  for (const L of ROAD_LINES) {
    const main = L === -400 || L === -200 || L === 0 || L === 200 || L === 400;
    c.strokeStyle = night ? '#3d4450' : '#565e68';
    c.lineWidth = main ? 3 : 1.5;
    c.beginPath(); c.moveTo(X(L), 0); c.lineTo(X(L), h); c.stroke();
    c.beginPath(); c.moveTo(0, Y(L)); c.lineTo(w, Y(L)); c.stroke();
  }
  // Buildings: every one of the 1,000, at its real position, in its real
  // colour brightened to neon so the boxes read on the dark map.
  for (const b of city.buildings) {
    c.fillStyle = cssColor(neonColor(b.color), night ? 0.75 : 0.9);
    c.fillRect(X(b.x - b.w / 2), Y(b.z - b.d / 2), Math.max(1, b.w * sc), Math.max(1, b.d * sc));
  }
  // Rimba Stadium: green pitch rect with a white outline.
  if (city.stadium) {
    const st = city.stadium;
    c.fillStyle = night ? '#1d5c2e' : '#2e9e4f';
    c.fillRect(X(st.x0), Y(st.z0), (st.x1 - st.x0) * sc, (st.z1 - st.z0) * sc);
    c.strokeStyle = '#e8e8e8';
    c.lineWidth = 1;
    c.strokeRect(X(st.x0), Y(st.z0), (st.x1 - st.x0) * sc, (st.z1 - st.z0) * sc);
  }
  // No text labels on the map tiles (Mu, 24 Nov 14:33): zone/area names
  // appear only in the legend under the canvas. The stadium is drawn as
  // a green pitch rect with a white outline — no name text on it either.
  // Markers.
  for (const m of markers || []) {
    const mx = X(m.x), my = Y(m.z);
    if (m.shape === 'dollar') {
      c.fillStyle = m.color || '#fb923c';
      c.font = 'bold ' + Math.max(12, 22 * sc) + 'px system-ui,sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('$', mx, my);
      continue;
    }
    if (m.shape === 'dot') {
      c.fillStyle = m.color || '#ffd23f';
      c.beginPath();
      c.arc(mx, my, Math.max(2, 4 * sc), 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = '#111';
      c.lineWidth = 1;
      c.stroke();
      continue;
    }
    // diamond (mission target / board)
    const pulse = (5 + Math.sin(performance.now() / 300) * 1.5) * (w > 300 ? 1.6 : 1);
    c.fillStyle = m.color || '#ffd23f';
    c.beginPath();
    c.moveTo(mx, my - pulse);
    c.lineTo(mx + pulse, my);
    c.lineTo(mx, my + pulse);
    c.lineTo(mx - pulse, my);
    c.closePath();
    c.fill();
    c.strokeStyle = '#111';
    c.lineWidth = 1.5;
    c.stroke();
  }
  // Player arrow (yellow dot + heading wedge, with a faint halo).
  const px = X(player.x), py = Y(player.z);
  c.fillStyle = 'rgba(255,210,63,.25)';
  c.beginPath();
  c.arc(px, py, 9, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#ffd23f';
  c.beginPath();
  c.arc(px, py, 4, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = '#111';
  c.lineWidth = 1.5;
  c.stroke();
  const a = player.facing;
  c.beginPath();
  c.moveTo(px + Math.sin(a) * 8, py + Math.cos(a) * 8);
  c.lineTo(px - Math.sin(a + 0.5) * 6, py - Math.cos(a + 0.5) * 6);
  c.lineTo(px - Math.sin(a - 0.5) * 6, py - Math.cos(a - 0.5) * 6);
  c.closePath();
  c.fill();
  // North marker (N) at the top edge.
  c.fillStyle = '#22d3ee';
  c.font = 'bold ' + Math.max(11, 15 * sc) + 'px system-ui,sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'top';
  c.fillText('N', w / 2, 3);
  c.beginPath();
  c.moveTo(w / 2, 3 + Math.max(11, 15 * sc) + 2);
  c.lineTo(w / 2 - 4, 3 + Math.max(11, 15 * sc) + 9);
  c.lineTo(w / 2 + 4, 3 + Math.max(11, 15 * sc) + 9);
  c.closePath();
  c.fill();
}

export function createHud(city) {
  const moneyEl = document.getElementById('hud-money');
  const coinsEl = document.getElementById('hud-coins');
  const timeEl = document.getElementById('hud-time');
  const starsEl = document.getElementById('hud-stars');
  const missionsEl = document.getElementById('hud-missions');
  const objEl = document.getElementById('hud-objective');
  const distEl = document.getElementById('hud-distance');
  const areaEl = document.getElementById('hud-area');
  const zoneEl = document.getElementById('hud-zone');
  const hintEl = document.getElementById('hud-hint');
  const armorEl = document.getElementById('hud-armor');
  const medkitEl = document.getElementById('hud-medkit');
  const boostEl = document.getElementById('hud-boost');
  const healthFillEl = document.getElementById('hud-health-fill');
  const healthTextEl = document.getElementById('hud-health-text');
  const weaponNameEl = document.getElementById('hud-weapon-name');
  const ammoEl = document.getElementById('hud-ammo');
  const speedoEl = document.getElementById('hud-speedo');
  const speedoArcEl = document.getElementById('hud-speedo-arc');
  const speedoTextEl = document.getElementById('hud-speedo-text');
  const crosshairEl = document.getElementById('hud-crosshair');
  const map = document.getElementById('minimap');
  const ctx = map.getContext('2d');
  const W = map.width, H = map.height;

  // --- full-screen map overlay (M key, Phase E2) ---
  let mapOverlay = null, mapCanvas = null, mapCtx = null;
  let mapOpen = false;
  let mapSize = 380; // set by ensureMapOverlay from fullMapLayout()
  const LEGEND_ZONES = ['downtown', 'commercial', 'residential', 'beach', 'port', 'forest', 'plaza', 'market'];
  function ensureMapOverlay() {
    if (mapOverlay) return;
    // Size the canvas to the viewport so the whole overlay (title +
    // canvas + legend + key + Close button) fits — at 960x540 the canvas
    // is 380 px. overflow-y:auto is a safety net for tiny viewports only.
    const vw = (typeof window !== 'undefined' && window.innerWidth) || 960;
    const vh = (typeof window !== 'undefined' && window.innerHeight) || 540;
    mapSize = fullMapLayout(vw, vh).size;
    mapOverlay = document.createElement('div');
    mapOverlay.id = 'full-map';
    mapOverlay.style.cssText = 'position:fixed;inset:0;z-index:40;background:rgba(4,8,16,.92);display:none;flex-direction:column;align-items:center;justify-content:center;color:#fff;font-family:system-ui,sans-serif;overflow-y:auto;';
    const legend = LEGEND_ZONES.map((z) => {
      const c = zoneNeonFill(city, z);
      const sw = cssColor(c, 1);
      return '<span style="margin-right:12px;white-space:nowrap;"><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:' + sw + ';box-shadow:0 0 6px ' + sw + ';vertical-align:-1px;"></span> ' + (AREA_NAMES[z] || z) + '</span>';
    }).join('');
    mapOverlay.innerHTML = '<div style="font-size:20px;font-weight:700;letter-spacing:3px;margin-bottom:8px;color:#22d3ee;text-shadow:0 0 14px rgba(34,211,238,.8);">TELUK RIMBA — MAP</div>'
      + '<canvas id="full-map-canvas" width="' + mapSize + '" height="' + mapSize + '" style="border:2px solid rgba(34,211,238,.7);border-radius:12px;background:#0a1826;box-shadow:0 0 24px rgba(34,211,238,.35);"></canvas>'
      + '<div style="margin-top:8px;font-size:12px;opacity:.95;max-width:640px;text-align:center;line-height:1.7;">' + legend + '</div>'
      + '<div style="margin-top:6px;font-size:13px;opacity:.9;">'
      + '<span style="color:#ffd23f;">◆</span> You &nbsp;'
      + '<span style="color:#ffd23f;">◆</span> Mission target &nbsp;'
      + '<span style="color:#4ade80;">◆</span> Mission board &nbsp;'
      + '<span style="color:#fb923c;">$</span> Market shop &nbsp;'
      + '<span style="color:#ffd23f;">●</span> Coins found'
      + '</div>'
      + '<button data-close style="margin-top:10px;background:rgba(34,211,238,.15);color:#22d3ee;border:1px solid #22d3ee;border-radius:8px;padding:7px 20px;font-weight:700;font-size:14px;cursor:pointer;box-shadow:0 0 12px rgba(34,211,238,.35);">Close (M)</button>';
    document.body.appendChild(mapOverlay);
    mapCanvas = mapOverlay.querySelector('#full-map-canvas');
    mapCtx = mapCanvas.getContext('2d');
    mapOverlay.querySelector('[data-close]').addEventListener('click', () => { closeMap(); });
  }
  function openMap(player, timeHours, markers) {
    ensureMapOverlay();
    mapOpen = true;
    mapOverlay.style.display = 'flex';
    drawCityMap(mapCtx, city, mapSize, mapSize, player, timeHours, markers || [], { zoneAlpha: 0.5 });
  }
  function closeMap() {
    if (mapOverlay) mapOverlay.style.display = 'none';
    mapOpen = false;
  }
  function toggleMap(player, timeHours, markers) {
    if (mapOpen) closeMap();
    else openMap(player, timeHours, markers);
  }

  let hintTimer = 0;
  function showHint(text, seconds = 6) {
    hintEl.textContent = text;
    hintEl.style.display = 'block';
    hintTimer = seconds;
  }

  // Speedometer gauge: 270° arc, circumference 2π·46 ≈ 289, visible span
  // 216.8 units; red zone is the top 20% (160–200 km/h).
  const SPEEDO_MAX = 200;
  const SPEEDO_SPAN = 216.8;
  function update(dt, s) {
    // s: {money, coins {found,total}, timeHours, wanted, speedKmh, objective,
    // place, weapon {owned, ammo}, armor, medkits, drinks, boosted,
    // missionsDone, missionsTotal, targetDist (m|null), driving, armed,
    // health (0-100, real player health — police gunfire, Mu 24 Nov 2026)}
    moneyEl.textContent = '$' + s.money.toLocaleString('en-US');
    if (coinsEl && s.coins) coinsEl.textContent = '◉ ' + s.coins.found + '/' + s.coins.total + ' coins';
    const hh = Math.floor(s.timeHours) % 24;
    const mm = Math.floor((s.timeHours % 1) * 60);
    timeEl.textContent = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
    starsEl.textContent = '★'.repeat(s.wanted) + '☆'.repeat(Math.max(0, 3 - s.wanted));
    starsEl.style.color = s.wanted > 0 ? '#ff2e88' : '#5a6b7d';
    if (missionsEl && s.missionsDone != null) {
      missionsEl.textContent = 'MISSIONS ' + s.missionsDone + '/' + (s.missionsTotal || 6);
    }
    if (s.objective) objEl.textContent = s.objective;
    if (distEl) {
      if (s.targetDist != null && Number.isFinite(s.targetDist)) {
        distEl.textContent = '◆ TARGET ' + formatDistance(s.targetDist);
        distEl.style.display = 'inline-block';
      } else {
        distEl.style.display = 'none';
      }
    }
    if (s.place && areaEl) areaEl.textContent = s.place;
    // Weapon slot (real shop state) + ammo.
    if (weaponNameEl) {
      const owned = s.weapon && s.weapon.owned;
      weaponNameEl.textContent = owned ? 'PISTOL' : 'NO WEAPON';
      weaponNameEl.style.opacity = owned ? '1' : '.45';
    }
    if (ammoEl) {
      const ammo = s.weapon ? s.weapon.ammo : 0;
      ammoEl.textContent = (s.weapon && s.weapon.owned) ? ammo + ' RDS' : '';
      ammoEl.style.color = ammo <= 0 ? '#ff2e63' : '#ffd23f';
    }
    // Owned-item chips (real shop state — no invented stamina/level
    // systems exist in the game, so the HUD shows what the player owns).
    if (armorEl) {
      armorEl.textContent = 'ARMOR ×' + (s.armor || 0);
      armorEl.style.opacity = (s.armor || 0) > 0 ? '1' : '.4';
    }
    // Health bar (real player health — police gunfire, Mu 24 Nov 2026).
    // Skipped when the caller passes no health (old minimal state).
    if (healthFillEl && s.health != null) {
      const hb = healthBarState(s.health);
      healthFillEl.style.width = hb.pct + '%';
      healthFillEl.style.background = hb.low
        ? 'linear-gradient(90deg,#ff0033,#ff2e63)'
        : 'linear-gradient(90deg,#ff2e63,#ff7a5c)';
      if (healthTextEl) healthTextEl.textContent = 'HEALTH ' + hb.pct;
    }
    if (medkitEl) {
      medkitEl.textContent = 'MEDKIT ×' + (s.medkits || 0);
      medkitEl.style.opacity = (s.medkits || 0) > 0 ? '1' : '.4';
    }
    if (boostEl) boostEl.style.display = s.boosted ? 'inline-block' : 'none';
    // Crosshair: only while armed with the pistol.
    if (crosshairEl) crosshairEl.style.display = s.armed ? 'block' : 'none';
    // Round speedometer: only while driving.
    if (speedoEl) {
      if (s.driving) {
        speedoEl.style.display = 'block';
        const frac = Math.max(0, Math.min(1, (s.speedKmh || 0) / SPEEDO_MAX));
        if (speedoArcEl) speedoArcEl.setAttribute('stroke-dasharray', (SPEEDO_SPAN * frac).toFixed(1) + ' 289');
        if (speedoTextEl) speedoTextEl.textContent = String(Math.round(s.speedKmh || 0));
      } else {
        speedoEl.style.display = 'none';
      }
    }
    if (hintTimer > 0) {
      hintTimer -= dt;
      if (hintTimer <= 0) hintEl.style.display = 'none';
    }
  }

  function drawMinimap(player, timeHours, marker) {
    // Minimap shows only the mission marker (yellow diamond for the current
    // objective, green for the mission board at Rimba Plaza).
    const markers = marker
      ? [{ x: marker.x, z: marker.z, color: marker.board ? '#4ade80' : '#ffd23f', shape: 'diamond' }]
      : [];
    drawCityMap(ctx, city, W, H, player, timeHours, markers, { zoneAlpha: 0.32 });
    // Active zone strip under the minimap.
    if (zoneEl) zoneEl.textContent = areaNameAt(city, player.x, player.z).toUpperCase();
    // If the full map is open, keep it live too.
    if (mapOpen) drawCityMap(mapCtx, city, mapSize, mapSize, player, timeHours, lastMarkers, { zoneAlpha: 0.5 });
  }

  let lastMarkers = [];
  function setMapMarkers(markers) { lastMarkers = markers || []; }

  return { update, drawMinimap, showHint, openMap, closeMap, toggleMap, setMapMarkers, get mapOpen() { return mapOpen; } };
}
