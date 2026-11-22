// Teluk Rimba — HUD (DOM) + minimap (2D canvas), both drawn from the same
// city dataset as the 3D world, so the map can never disagree with the streets.
import { ROAD_LINES, RIVER_POINTS } from './city.js';

export function createHud(city) {
  const moneyEl = document.getElementById('hud-money');
  const coinsEl = document.getElementById('hud-coins');
  const timeEl = document.getElementById('hud-time');
  const starsEl = document.getElementById('hud-stars');
  const speedEl = document.getElementById('hud-speed');
  const objEl = document.getElementById('hud-objective');
  const areaEl = document.getElementById('hud-area');
  const hintEl = document.getElementById('hud-hint');
  const map = document.getElementById('minimap');
  const ctx = map.getContext('2d');
  const W = map.width, H = map.height;
  const SCALE = W / 1400; // world [-700, 700] -> canvas
  const toX = (x) => (x + 700) * SCALE;
  const toY = (z) => (z + 700) * SCALE;

  // --- full-screen map overlay (M key, Phase E2) ---
  let mapOverlay = null, mapCanvas = null, mapCtx = null;
  let mapOpen = false;
  function ensureMapOverlay() {
    if (mapOverlay) return;
    mapOverlay = document.createElement('div');
    mapOverlay.id = 'full-map';
    mapOverlay.style.cssText = 'position:fixed;inset:0;z-index:40;background:rgba(5,10,18,.88);display:none;flex-direction:column;align-items:center;justify-content:center;color:#fff;font-family:system-ui,sans-serif;';
    mapOverlay.innerHTML = '<div style="font-size:22px;font-weight:700;letter-spacing:2px;margin-bottom:10px;">TELUK RIMBA — MAP</div>'
      + '<canvas id="full-map-canvas" width="560" height="560" style="border:2px solid rgba(255,255,255,.6);border-radius:8px;background:#1a2f22;"></canvas>'
      + '<div style="margin-top:10px;font-size:14px;opacity:.9;">'
      + '<span style="color:#ffd23f;">◆</span> You &nbsp;'
      + '<span style="color:#ffd23f;">◆</span> Mission target &nbsp;'
      + '<span style="color:#4ade80;">◆</span> Mission board &nbsp;'
      + '<span style="color:#fb923c;">$</span> Market shop &nbsp;'
      + '<span style="color:#ffd23f;">●</span> Coins found'
      + '</div>'
      + '<button data-close style="margin-top:12px;background:#e8a13a;color:#201503;border:0;border-radius:6px;padding:8px 22px;font-weight:700;font-size:15px;cursor:pointer;">Close (M)</button>';
    document.body.appendChild(mapOverlay);
    mapCanvas = mapOverlay.querySelector('#full-map-canvas');
    mapCtx = mapCanvas.getContext('2d');
    mapOverlay.querySelector('[data-close]').addEventListener('click', () => { closeMap(); });
  }
  function openMap(player, timeHours, markers) {
    ensureMapOverlay();
    mapOpen = true;
    mapOverlay.style.display = 'flex';
    drawMap(mapCtx, 560, 560, player, timeHours, markers || []);
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

  function update(dt, s) {
    // s: {money, coins {found,total}, timeHours, wanted, speedKmh, objective, place}
    moneyEl.textContent = '$' + s.money.toLocaleString('en-US');
    if (coinsEl && s.coins) coinsEl.textContent = '◉ ' + s.coins.found + '/' + s.coins.total + ' coins';
    const hh = Math.floor(s.timeHours) % 24;
    const mm = Math.floor((s.timeHours % 1) * 60);
    timeEl.textContent = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
    starsEl.textContent = '★'.repeat(s.wanted) + '☆'.repeat(Math.max(0, 3 - s.wanted));
    starsEl.style.color = s.wanted > 0 ? '#ffd23f' : '#888';
    speedEl.textContent = Math.round(s.speedKmh) + ' km/h';
    if (s.objective) objEl.textContent = s.objective;
    if (s.place && areaEl) areaEl.textContent = s.place;
    if (hintTimer > 0) {
      hintTimer -= dt;
      if (hintTimer <= 0) hintEl.style.display = 'none';
    }
  }

  // Shared map drawing: sea, river, roads, buildings, markers, player.
  // markers: [{x, z, color, shape}] — shape 'diamond' (mission/board),
  // 'dollar' (shop), 'dot' (coin found). Used by the minimap and the
  // full-screen map (Phase E2).
  function drawMap(c, w, h, player, timeHours, markers) {
    const sc = w / 1400;
    const X = (x) => (x + 700) * sc;
    const Y = (z) => (z + 700) * sc;
    const night = timeHours < 6 || timeHours >= 18;
    c.fillStyle = night ? '#0d1520' : '#1a2f22';
    c.fillRect(0, 0, w, h);
    // Sea (east).
    c.fillStyle = night ? '#0e2a44' : '#2a6ea6';
    c.fillRect(X(640), 0, w - X(640), h);
    // River.
    c.strokeStyle = night ? '#14486e' : '#3a8ac0';
    c.lineWidth = Math.max(2, 22 * sc);
    c.beginPath();
    RIVER_POINTS.forEach(([x, z], i) => { if (i === 0) c.moveTo(X(x), Y(z)); else c.lineTo(X(x), Y(z)); });
    c.stroke();
    // Roads.
    for (const L of ROAD_LINES) {
      const main = L === -400 || L === -200 || L === 0 || L === 200 || L === 400;
      c.strokeStyle = night ? '#5a5a58' : '#8a8a86';
      c.lineWidth = main ? 3 : 1.5;
      c.beginPath(); c.moveTo(X(L), 0); c.lineTo(X(L), h); c.stroke();
      c.beginPath(); c.moveTo(0, Y(L)); c.lineTo(w, Y(L)); c.stroke();
    }
    // Buildings (tiny rects).
    c.fillStyle = night ? '#3a3f46' : '#5c5c58';
    for (const b of city.buildings) {
      c.fillRect(X(b.x - b.w / 2), Y(b.z - b.d / 2), Math.max(1, b.w * sc), Math.max(1, b.d * sc));
    }
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
    // Player arrow.
    const px = X(player.x), py = Y(player.z);
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
  }

  function drawMinimap(player, timeHours, marker) {
    // Minimap shows only the mission marker (yellow diamond for the current
    // objective, green for the mission board at Rimba Plaza).
    const markers = marker
      ? [{ x: marker.x, z: marker.z, color: marker.board ? '#4ade80' : '#ffd23f', shape: 'diamond' }]
      : [];
    drawMap(ctx, W, H, player, timeHours, markers);
    // If the full map is open, keep it live too.
    if (mapOpen) drawMap(mapCtx, 560, 560, player, timeHours, lastMarkers);
  }

  let lastMarkers = [];
  function setMapMarkers(markers) { lastMarkers = markers || []; }

  return { update, drawMinimap, showHint, openMap, closeMap, toggleMap, setMapMarkers, get mapOpen() { return mapOpen; } };
}
