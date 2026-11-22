// Teluk Rimba — HUD (DOM) + minimap (2D canvas), both drawn from the same
// city dataset as the 3D world, so the map can never disagree with the streets.
import { ROAD_LINES, RIVER_POINTS } from './city.js';

export function createHud(city) {
  const moneyEl = document.getElementById('hud-money');
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

  let hintTimer = 0;
  function showHint(text, seconds = 6) {
    hintEl.textContent = text;
    hintEl.style.display = 'block';
    hintTimer = seconds;
  }

  function update(dt, s) {
    // s: {money, timeHours, wanted, speedKmh, objective, place}
    moneyEl.textContent = '$' + s.money.toLocaleString('en-US');
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

  function drawMinimap(player, timeHours) {
    const night = timeHours < 6 || timeHours >= 18;
    ctx.fillStyle = night ? '#0d1520' : '#1a2f22';
    ctx.fillRect(0, 0, W, H);
    // Sea (east).
    ctx.fillStyle = night ? '#0e2a44' : '#2a6ea6';
    ctx.fillRect(toX(640), 0, W - toX(640), H);
    // River.
    ctx.strokeStyle = night ? '#14486e' : '#3a8ac0';
    ctx.lineWidth = Math.max(2, 22 * SCALE);
    ctx.beginPath();
    RIVER_POINTS.forEach(([x, z], i) => { if (i === 0) ctx.moveTo(toX(x), toY(z)); else ctx.lineTo(toX(x), toY(z)); });
    ctx.stroke();
    // Roads.
    for (const L of ROAD_LINES) {
      const main = L === -400 || L === -200 || L === 0 || L === 200 || L === 400;
      ctx.strokeStyle = night ? '#5a5a58' : '#8a8a86';
      ctx.lineWidth = main ? 3 : 1.5;
      ctx.beginPath(); ctx.moveTo(toX(L), 0); ctx.lineTo(toX(L), H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, toY(L)); ctx.lineTo(W, toY(L)); ctx.stroke();
    }
    // Buildings (tiny rects).
    ctx.fillStyle = night ? '#3a3f46' : '#5c5c58';
    for (const b of city.buildings) {
      ctx.fillRect(toX(b.x - b.w / 2), toY(b.z - b.d / 2), Math.max(1, b.w * SCALE), Math.max(1, b.d * SCALE));
    }
    // Player arrow.
    const px = toX(player.x), py = toY(player.z);
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    const a = player.facing;
    ctx.beginPath();
    ctx.moveTo(px + Math.sin(a) * 8, py + Math.cos(a) * 8);
    ctx.lineTo(px - Math.sin(a + 0.5) * 6, py - Math.cos(a + 0.5) * 6);
    ctx.lineTo(px - Math.sin(a - 0.5) * 6, py - Math.cos(a - 0.5) * 6);
    ctx.closePath();
    ctx.fill();
  }

  return { update, drawMinimap, showHint };
}
