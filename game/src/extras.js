// Teluk Rimba — shop + extras: market shop, hidden coins, stunt jumps,
// courier jobs. Pure logic (no WebGL, no DOM): the game loop drives it,
// the HUD shows it, main.js renders coins/ramps from the matrices below.
// All in-game text is English; the city name stays Teluk Rimba.
//
// The shop lives at Rimba Market (the market block, 51,-51). Money comes
// from missions (and coins/stunts/couriers); rank = missions completed.
import { terrainHeight } from './city.js';
import { mat4TRS } from './gl.js';

// ---------------------------------------------------------------- shop ---
export const SHOP_POS = { x: 51, z: -23 }; // Rimba Market aisle, dry land (rd 33) between the two stall rows

export const SHOP_ITEMS = [
  { id: 'pistol', name: 'Pistol', price: 250, rank: 0, kind: 'weapon', desc: 'Fire with F — 12 rounds included' },
  { id: 'ammo', name: 'Ammo Pack (+24)', price: 60, rank: 0, kind: 'ammo', desc: 'Refills pistol ammo', needs: 'pistol' },
  { id: 'drink', name: 'Energy Drink', price: 30, rank: 0, kind: 'drink', desc: 'Press R: 30 s speed boost' },
  { id: 'medkit', name: 'Medkit', price: 80, rank: 1, kind: 'medkit', desc: 'Press Q to use: restore 50 health' },
  { id: 'repair', name: 'Vehicle Repair', price: 100, rank: 1, kind: 'repair', desc: 'Fix your vehicle to full condition' },
  { id: 'armor', name: 'Body Armor', price: 150, rank: 2, kind: 'armor', desc: 'Halves the busted fine once' },
];

export function itemById(id) {
  return SHOP_ITEMS.find((i) => i.id === id) || null;
}

export function createShop(ctx) {
  const { game, hud } = ctx;
  const audio = ctx.audio || null;
  const wanted = ctx.wanted || null;
  const onSave = ctx.onSave || (() => {});
  // Rank = missions completed (a function so the shop always reads live).
  const rank = ctx.rank || (() => 0);

  const state = {
    pistol: false, ammo: 0, medkits: 0, armor: 0, drinks: 0,
    boostUntil: 0, // game elapsed seconds; boost while elapsed < boostUntil
  };

  function hint(text, seconds) { if (hud) hud.showHint(text, seconds || 6); }

  function buy(id) {
    const item = itemById(id);
    if (!item) return { ok: false, reason: 'Unknown item' };
    if (rank() < item.rank) {
      return { ok: false, reason: 'Requires rank ' + item.rank + ' — complete ' + item.rank + ' mission' + (item.rank > 1 ? 's' : '') };
    }
    if (item.needs === 'pistol' && !state.pistol) {
      return { ok: false, reason: 'Buy the pistol first' };
    }
    if (item.kind === 'repair') {
      if (!game.driving) return { ok: false, reason: 'Get in a vehicle first' };
      const cond = game.driving.condition ?? 100;
      if (cond >= 100) return { ok: false, reason: 'Vehicle is already in full condition' };
    }
    if (game.money < item.price) {
      return { ok: false, reason: 'Not enough money ($' + item.price + ' needed)' };
    }
    game.money -= item.price;
    if (item.kind === 'weapon') { state.pistol = true; state.ammo += 12; }
    else if (item.kind === 'ammo') state.ammo += 24;
    else if (item.kind === 'drink') state.drinks++;
    else if (item.kind === 'medkit') state.medkits++;
    else if (item.kind === 'armor') state.armor++;
    else if (item.kind === 'repair') game.driving.condition = 100;
    if (audio) audio.shop();
    hint('Bought ' + item.name + ' for $' + item.price + '.');
    onSave();
    return { ok: true };
  }

  // Fire the pistol: spends one round. Returns 'fired' | 'empty' | 'noweapon'.
  function fire() {
    if (!state.pistol) return 'noweapon';
    if (state.ammo <= 0) {
      if (audio) audio.emptyClick();
      hint('Out of ammo — buy more at Rimba Market.');
      return 'empty';
    }
    state.ammo--;
    return 'fired';
  }

  // Medkit (Q): patch up, restore 50 health (capped at 100). With no
  // medkits, or at full health, it does nothing. (Before 24 Nov 2026 it
  // dropped a wanted star instead; Mu's police-shooting order gave
  // medkits this real purpose — the police now deal damage.)
  function useMedkit() {
    if (state.medkits <= 0) { hint('No medkits — buy one at Rimba Market.'); return false; }
    const cur = typeof game.health === 'number' ? game.health : 100;
    if (cur >= 100) { hint('Health is already full.'); return false; }
    state.medkits--;
    game.health = Math.min(100, cur + 50);
    hint('Medkit used — health restored to ' + game.health + '.');
    onSave();
    return true;
  }

  // Energy drink (R): 30 s speed boost (elapsed = game clock seconds).
  function useDrink(elapsed) {
    if (state.drinks <= 0) { hint('No energy drinks — buy one at Rimba Market.'); return false; }
    state.drinks--;
    state.boostUntil = elapsed + 30;
    hint('Energy boost! Faster for 30 s.');
    onSave();
    return true;
  }
  function isBoosted(elapsed) { return elapsed < state.boostUntil; }

  // Busted fine: one armor absorbs half of it (and is consumed).
  function bustedFine(fine) {
    if (state.armor > 0) {
      state.armor--;
      hint('Body armor absorbed half the fine.');
      return Math.ceil(fine / 2);
    }
    return fine;
  }

  function saveState() {
    return {
      pistol: state.pistol, ammo: state.ammo, medkits: state.medkits,
      armor: state.armor, drinks: state.drinks,
    };
  }
  function restore(save) {
    if (!save || typeof save !== 'object') return;
    if (typeof save.pistol === 'boolean') state.pistol = save.pistol;
    if (Number.isInteger(save.ammo)) state.ammo = Math.max(0, save.ammo);
    if (Number.isInteger(save.medkits)) state.medkits = Math.max(0, save.medkits);
    if (Number.isInteger(save.armor)) state.armor = Math.max(0, save.armor);
    if (Number.isInteger(save.drinks)) state.drinks = Math.max(0, save.drinks);
  }

  return { state, buy, fire, useMedkit, useDrink, isBoosted, bustedFine, saveState, restore, rank };
}

// --- shop menu UI (DOM only; no-op in Node) ---
// Opens at Rimba Market (E on foot near the shop, main.js). Lists every
// item with price + rank lock, owned counts, and Use buttons for the
// consumables. All labels in English.
export function createShopUI(shop, game) {
  if (typeof document === 'undefined') return null;
  let panel = null;
  let open = false;
  let msgEl = null;

  function render() {
    if (!panel) return;
    const rank = shop.rank ? shop.rank() : 0;
    let html = '<div style="font-weight:700;font-size:18px;margin-bottom:2px;">RIMBA MARKET — SHOP</div>'
      + '<div style="opacity:.85;font-size:13px;margin-bottom:2px;">Pak Slamet\'s shop — welcome, ' + (game.playerName || 'Wowok') + '!</div>'
      + '<div style="opacity:.85;font-size:13px;margin-bottom:10px;">Money: $' + game.money.toLocaleString('en-US')
      + ' &nbsp;·&nbsp; Rank: ' + rank + ' (' + rank + ' mission' + (rank === 1 ? '' : 's') + ' done)</div>';
    for (const item of SHOP_ITEMS) {
      const locked = rank < item.rank;
      const owned = item.kind === 'weapon' ? (shop.state.pistol ? 'Owned' : '')
        : item.kind === 'ammo' ? shop.state.ammo + ' rounds'
        : item.kind === 'drink' ? shop.state.drinks + ' owned'
        : item.kind === 'medkit' ? shop.state.medkits + ' owned'
        : item.kind === 'armor' ? shop.state.armor + ' owned'
        : '';
      const canAfford = game.money >= item.price;
      const why = locked ? 'Requires rank ' + item.rank
        : item.kind === 'ammo' && !shop.state.pistol ? 'Buy the pistol first'
        : !canAfford ? 'Not enough money' : '';
      html += '<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-top:1px solid rgba(255,255,255,.18);">'
        + '<div style="flex:1;"><div style="font-weight:700;">' + item.name
        + (owned ? ' <span style="opacity:.7;font-weight:400;">(' + owned + ')</span>' : '') + '</div>'
        + '<div style="font-size:12px;opacity:.8;">' + item.desc + '</div></div>'
        + '<div style="font-weight:700;white-space:nowrap;">$' + item.price + '</div>'
        + '<button data-buy="' + item.id + '" ' + (why ? 'disabled' : '')
        + ' style="background:' + (why ? '#555' : '#e8a13a') + ';color:' + (why ? '#ccc' : '#201503')
        + ';border:0;border-radius:6px;padding:6px 12px;font-weight:700;cursor:' + (why ? 'not-allowed' : 'pointer') + ';">Buy</button>'
        + '</div>'
        + (why ? '<div style="font-size:12px;color:#f0a0a0;margin:-4px 0 4px;">' + why + '</div>' : '');
      if ((item.kind === 'medkit' || item.kind === 'drink') && shop.state[item.kind === 'medkit' ? 'medkits' : 'drinks'] > 0) {
        html += '<div style="margin:-2px 0 6px;"><button data-use="' + item.id + '" style="background:#2f6fb2;color:#fff;border:0;border-radius:6px;padding:4px 12px;font-weight:700;cursor:pointer;">Use ' + item.name + '</button></div>';
      }
    }
    html += '<div data-msg style="min-height:18px;font-size:13px;color:#ffd23f;margin-top:8px;"></div>'
      + '<button data-close style="margin-top:8px;background:#e8a13a;color:#201503;border:0;border-radius:6px;padding:6px 14px;font-weight:700;cursor:pointer;">Close (Esc)</button>';
    panel.innerHTML = html;
    msgEl = panel.querySelector('[data-msg]');
    panel.querySelectorAll('[data-buy]').forEach((b) => {
      b.addEventListener('click', () => {
        const r = shop.buy(b.getAttribute('data-buy'));
        if (msgEl) msgEl.textContent = r.ok ? 'Bought!' : r.reason;
        render();
      });
    });
    panel.querySelectorAll('[data-use]').forEach((b) => {
      b.addEventListener('click', () => {
        const id = b.getAttribute('data-use');
        if (id === 'medkit') shop.useMedkit();
        else if (id === 'drink') shop.useDrink(game.elapsed);
        render();
      });
    });
    const closeBtn = panel.querySelector('[data-close]');
    if (closeBtn) closeBtn.addEventListener('click', () => closePanel());
  }

  function openPanel() {
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'shop-menu';
      panel.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:45;background:rgba(10,16,26,.95);color:#fff;border:1px solid rgba(255,255,255,.35);border-radius:10px;padding:16px 18px;font:14px system-ui,sans-serif;width:340px;max-height:86vh;overflow-y:auto;';
      document.body.appendChild(panel);
      document.addEventListener('keydown', (e) => {
        if (open && e.code === 'Escape') closePanel();
      });
    }
    open = true;
    panel.style.display = 'block';
    render();
  }
  function closePanel() {
    open = false;
    if (panel) panel.style.display = 'none';
  }

  return { open: openPanel, close: closePanel, get isOpen() { return open; } };
}

// --------------------------------------------------------------- coins ---
export const COIN_SPOTS = [
  { id: 1, x: 51, z: -51, note: 'Rimba Market' },
  { id: 2, x: 620, z: -100, note: 'Coral Beach' },
  { id: 3, x: -50, z: -50, note: 'Rimba Plaza' },
  { id: 4, x: 407.5, z: 407.5, note: 'Rimba Harbor' },
  { id: 5, x: -600, z: -600, note: 'Mountain base' },
  { id: 6, x: -780, z: -780, note: 'Summit lookout' },
  { id: 7, x: 7.5, z: 350, note: 'Downtown sidewalk' },
  { id: 8, x: 207.5, z: 250, note: 'Commercial sidewalk' },
  { id: 9, x: -392.5, z: -250, note: 'Uptown sidewalk' },
  { id: 10, x: 630, z: -150, note: 'Pier beach' },
  { id: 11, x: 107.5, z: -250, note: 'Residential sidewalk' },
  { id: 12, x: -292.5, z: 250, note: 'Residential sidewalk' },
];
export const COIN_REWARD = 25;
export const COIN_RADIUS = 2.5;

export function createCoins(ctx) {
  const { game, player, hud } = ctx;
  const audio = ctx.audio || null;
  const onSave = ctx.onSave || (() => {});
  const collected = new Set();

  function step() {
    // Coins are collected on foot — walk into them (driving past does not count).
    if (game.driving) return;
    const px = player.state.x, pz = player.state.z;
    for (const c of COIN_SPOTS) {
      if (collected.has(c.id)) continue;
      if (Math.hypot(c.x - px, c.z - pz) < COIN_RADIUS) {
        collected.add(c.id);
        game.money += COIN_REWARD;
        if (audio) audio.coin();
        if (hud) hud.showHint('Hidden coin found! (' + collected.size + '/12) +$' + COIN_REWARD);
        onSave();
      }
    }
  }

  // Spinning gold discs for the uncollected coins (rendered by main.js).
  function matrices(elapsed) {
    const ms = [], tints = [];
    for (const c of COIN_SPOTS) {
      if (collected.has(c.id)) continue;
      const y = Math.max(0, terrainHeight(c.x, c.z)) + 1.2 + 0.25 * Math.sin(elapsed * 2 + c.id);
      ms.push(mat4TRS(c.x, y, c.z, elapsed * 2 + c.id, 1, 1, 1));
      tints.push([1, 0.84, 0.2]);
    }
    return { matrices: ms, tints };
  }

  function count() { return { found: collected.size, total: COIN_SPOTS.length }; }
  function saveState() { return Array.from(collected); }
  function restore(save) {
    collected.clear();
    if (Array.isArray(save)) for (const id of save) if (Number.isInteger(id)) collected.add(id);
  }

  return { step, matrices, count, saveState, restore, get collected() { return new Set(collected); } };
}

// -------------------------------------------------------------- stunts ---
// Four launch ramps on straight roads. Each has a 40 m run-up: a straight
// road segment with no turn before the ramp, so the player can build speed.
export const RAMPS = [
  { id: 1, x: 0, z: 200, heading: 0, note: 'Main Road south jump' },
  { id: 2, x: 200, z: -300, heading: Math.PI, note: 'Main Road north jump' },
  { id: 3, x: -300, z: 0, heading: Math.PI / 2, note: 'Cross-town east jump' },
  { id: 4, x: 400, z: 100, heading: -Math.PI / 2, note: 'Harbor Road west jump' },
];
export const RAMP_LEN = 6; // along the driving direction
export const RAMP_W = 4;
export const RAMP_H = 1.5;
export const STUNT_REWARD = 50;
export const STUNT_MIN_SPEED = 12; // m/s at the ramp lip, or no launch

// Wedge geometry: slope rising toward local +z (the driving direction),
// 6 m long, 4 m wide, 1.5 m tall at the lip. Plain {pos,nrm,col} triangles.
export function wedgeGeom() {
  const g = { pos: [], nrm: [], col: [] };
  const tri = (a, b, c, n, col) => {
    g.pos.push(...a, ...b, ...c);
    g.nrm.push(...n, ...n, ...n);
    g.col.push(...col, ...col, ...col);
  };
  const quad = (a, b, c, d, n, col) => { tri(a, b, c, n, col); tri(a, c, d, n, col); };
  const orange = [1, 0.55, 0.15], light = [1, 0.72, 0.3], dark = [0.85, 0.4, 0.1];
  const hw = RAMP_W / 2, hl = RAMP_LEN / 2;
  // Slope top (rises toward +z).
  quad([-hw, 0, -hl], [hw, 0, -hl], [hw, RAMP_H, hl], [-hw, RAMP_H, hl], [0, 0.97, -0.24], light);
  // Side triangles.
  tri([-hw, 0, -hl], [-hw, 0, hl], [-hw, RAMP_H, hl], [-1, 0, 0], orange);
  tri([hw, 0, -hl], [hw, RAMP_H, hl], [hw, 0, hl], [1, 0, 0], orange);
  // Tall back (the lip).
  quad([hw, 0, hl], [-hw, 0, hl], [-hw, RAMP_H, hl], [hw, RAMP_H, hl], [0, 0, 1], dark);
  return g;
}

export function createStunts(ctx) {
  const { game, hud } = ctx;
  const audio = ctx.audio || null;
  const onSave = ctx.onSave || (() => {});
  const completed = new Set();
  let air = null; // { ramp, t } while the vehicle is in its launch arc

  // Local ramp coordinates: along = forward distance, across = sideways.
  function local(ramp, x, z) {
    const dx = x - ramp.x, dz = z - ramp.z;
    const s = Math.sin(ramp.heading), c = Math.cos(ramp.heading);
    return { along: dx * s + dz * c, across: dx * c - dz * s };
  }
  function onRamp(ramp, x, z) {
    const l = local(ramp, x, z);
    return Math.abs(l.along) <= RAMP_LEN / 2 && Math.abs(l.across) <= RAMP_W / 2;
  }
  // Height of the wedge under a point (0 off the ramp, 0..1.5 on it).
  function rampHeightAt(x, z) {
    let h = 0;
    for (const r of RAMPS) {
      const l = local(r, x, z);
      if (Math.abs(l.along) <= RAMP_LEN / 2 && Math.abs(l.across) <= RAMP_W / 2) {
        h = Math.max(h, RAMP_H * (l.along + RAMP_LEN / 2) / RAMP_LEN);
      }
    }
    return h;
  }

  // Called every step with the driven vehicle (or null on foot). Returns the
  // extra height to add to the vehicle's terrain height: the wedge slope
  // while climbing, the ballistic arc while airborne, 0 otherwise.
  function step(dt, vehicle) {
    if (air) {
      air.t += dt;
      // Launch arc from the lip (1.5 m up, 5.5 m/s up): ~1.1 s of air.
      const h = RAMP_H + 5.5 * air.t - 6 * air.t * air.t;
      if (h <= 0) {
        const ramp = air.ramp;
        air = null;
        if (!completed.has(ramp.id)) {
          completed.add(ramp.id);
          game.money += STUNT_REWARD;
          if (audio) audio.stunt();
          if (hud) hud.showHint('STUNT! +$' + STUNT_REWARD + ' — ' + ramp.note);
          onSave();
        }
        return 0;
      }
      return h;
    }
    if (!vehicle) return 0;
    for (const r of RAMPS) {
      const l = local(r, vehicle.x, vehicle.z);
      if (Math.abs(l.along) <= RAMP_LEN / 2 && Math.abs(l.across) <= RAMP_W / 2) {
        // At the lip, fast enough: launch.
        if (l.along > RAMP_LEN / 2 - 0.5 && Math.abs(vehicle.speed) >= STUNT_MIN_SPEED) {
          air = { ramp: r, t: 0 };
          return RAMP_H;
        }
        return RAMP_H * (l.along + RAMP_LEN / 2) / RAMP_LEN;
      }
    }
    return 0;
  }

  function matrices() {
    const ms = [], tints = [];
    for (const r of RAMPS) {
      ms.push(mat4TRS(r.x, Math.max(0, terrainHeight(r.x, r.z)), r.z, r.heading, 1, 1, 1));
      tints.push([1, 1, 1]); // wedge carries its own colours
    }
    return { matrices: ms, tints };
  }

  function saveState() { return Array.from(completed); }
  function restore(save) {
    completed.clear();
    if (Array.isArray(save)) for (const id of save) if (Number.isInteger(id)) completed.add(id);
  }

  return { step, rampHeightAt, matrices, saveState, restore, get completed() { return new Set(completed); } };
}

// ------------------------------------------------------------ couriers ---
// Three small repeatable delivery jobs from the mission board. The board
// hands them out only once all 6 story missions are done (missions.js
// idle branch) — E on foot at Rimba Plaza, round-robin, repeatable forever.
export const COURIER_JOBS = [
  {
    id: 1, name: 'Harbor Dash', reward: 40, timeLimit: 150,
    from: { x: 51, z: -51, label: 'Pick up the parcel at Rimba Market' },
    to: { x: 407.5, z: 407.5, label: 'Deliver to Rimba Harbor' },
  },
  {
    id: 2, name: 'Beach Run', reward: 50, timeLimit: 150,
    from: { x: -50, z: -50, label: 'Pick up the parcel at Rimba Plaza' },
    to: { x: 620, z: -100, label: 'Deliver to Coral Beach' },
  },
  {
    id: 3, name: 'Uptown Drop', reward: 60, timeLimit: 180,
    from: { x: 51, z: -51, label: 'Pick up the parcel at Rimba Market' },
    to: { x: -392.5, z: -250, label: 'Deliver to Uptown' },
  },
];

export function courierById(id) {
  return COURIER_JOBS.find((j) => j.id === id) || null;
}

export function createCouriers(ctx) {
  const { game, player, hud } = ctx;
  const audio = ctx.audio || null;
  const onSave = ctx.onSave || (() => {});
  const state = {
    status: 'idle', // idle | active
    id: 0, stepIdx: 0, timeLeft: 0, failReason: '',
    lastResult: null,
  };
  let doneCount = 0;
  let lastJobId = 0;

  function nextJob() {
    const idx = COURIER_JOBS.findIndex((j) => j.id === lastJobId);
    return COURIER_JOBS[(idx + 1) % COURIER_JOBS.length];
  }

  function start(id) {
    const job = courierById(id);
    if (!job || state.status === 'active') return false;
    state.status = 'active';
    state.id = id;
    state.stepIdx = 0;
    state.timeLeft = job.timeLimit;
    state.failReason = '';
    lastJobId = id;
    if (hud) hud.showHint('Courier job for Bang Darman: ' + job.name + ' — ' + job.from.label, 6);
    if (audio) audio.missionStart();
    onSave();
    return true;
  }

  function finish(result, reason = '') {
    const job = courierById(state.id);
    if (!job) return;
    if (result === 'done') {
      game.money += job.reward;
      doneCount++;
      state.lastResult = { id: job.id, result: 'done', reason: '' };
      if (hud) hud.showHint('Courier job done: ' + job.name + ' — earned $' + job.reward + '!', 6);
      if (audio) audio.missionComplete();
    } else {
      state.lastResult = { id: job.id, result: 'failed', reason };
      if (hud) hud.showHint('Courier job failed: ' + job.name + ' — ' + reason, 6);
      if (audio) audio.missionFail();
    }
    state.status = 'idle';
    state.id = 0;
    state.stepIdx = 0;
    state.timeLeft = 0;
    onSave();
  }

  function fail(reason) {
    if (state.status !== 'active') return;
    finish('failed', reason);
  }

  function step(dt) {
    if (state.status !== 'active') return;
    const job = courierById(state.id);
    if (!job) return;
    state.timeLeft -= dt;
    if (state.timeLeft <= 0) { fail('Time ran out'); return; }
    const px = player.state.x, pz = player.state.z;
    const target = state.stepIdx === 0 ? job.from : job.to;
    if (Math.hypot(target.x - px, target.z - pz) < 6) {
      if (state.stepIdx === 0) {
        state.stepIdx = 1;
        if (hud) hud.showHint(job.to.label, 5);
        if (audio) audio.uiClick();
        onSave();
      } else {
        finish('done');
      }
    }
  }

  function objectiveText() {
    if (state.status !== 'active') return null;
    const job = courierById(state.id);
    if (!job) return null;
    const label = state.stepIdx === 0 ? job.from.label : job.to.label;
    const mm = Math.max(0, Math.floor(state.timeLeft / 60));
    const ss = Math.max(0, Math.floor(state.timeLeft % 60));
    return job.name + ' — ' + label + ' (' + mm + ':' + String(ss).padStart(2, '0') + ')';
  }

  function marker() {
    if (state.status !== 'active') return null;
    const job = courierById(state.id);
    if (!job) return null;
    const t = state.stepIdx === 0 ? job.from : job.to;
    return { x: t.x, z: t.z, board: false };
  }

  function saveState() {
    return state.status === 'active' ? { id: state.id, step: state.stepIdx } : null;
  }
  function restore(save) {
    if (!save || !courierById(save.id)) return;
    start(save.id);
    if (state.status === 'active' && Number.isInteger(save.step)) state.stepIdx = save.step;
  }

  return {
    state, nextJob, start, fail, step, objectiveText, marker, saveState, restore,
    get active() { return state.status === 'active'; },
    get doneCount() { return doneCount; },
  };
}
