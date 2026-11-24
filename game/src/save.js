// Teluk Rimba — save / load (localStorage, no server, no account).
// Saves the player name (Wowok), money, completed missions and the active
// mission (id + step), plus the shop inventory, coins, stunts and courier
// player keeps progress across sessions. Pure storage logic: safe to import
// from Node tests with a localStorage stub.
//
// Three slots (start menu, Mu 24 Nov): SLOT 1/2/3 under keys
// 'teluk-rimba-save-v1-slot1/2/3'. The old single key SAVE_KEY is kept as
// a read fallback for SLOT 1, so saves from before slots still load.
export const SAVE_KEY = 'teluk-rimba-save-v1';
export const SLOT_COUNT = 3;

export function normalizeSlot(slot) {
  const n = Math.floor(Number(slot));
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(SLOT_COUNT, n));
}

export function slotKey(slot) {
  return `${SAVE_KEY}-slot${normalizeSlot(slot)}`;
}

// Read one slot's save (null when empty). SLOT 1 also reads the legacy
// single-save key, so a pre-slot save shows up in SLOT 1.
export function loadGame(slot = 1) {
  try {
    const key = slotKey(slot);
    let raw = localStorage.getItem(key);
    if (!raw && normalizeSlot(slot) === 1) raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (typeof data !== 'object' || data === null) return null;
    return {
      name: typeof data.name === 'string' && data.name ? data.name : 'Wowok',
      money: typeof data.money === 'number' ? data.money : 0,
      done: Array.isArray(data.done) ? data.done.filter((n) => Number.isInteger(n)) : [],
      active: data.active && Number.isInteger(data.active.id) && Number.isInteger(data.active.step)
        ? { id: data.active.id, step: data.active.step }
        : null,
      shop: data.shop && typeof data.shop === 'object' ? data.shop : null,
      health: typeof data.health === 'number' ? Math.max(0, Math.min(100, data.health)) : 100,
      coins: Array.isArray(data.coins) ? data.coins.filter((n) => Number.isInteger(n)) : [],
      stunts: Array.isArray(data.stunts) ? data.stunts.filter((n) => Number.isInteger(n)) : [],
      courier: data.courier && Number.isInteger(data.courier.id) && Number.isInteger(data.courier.step)
        ? { id: data.courier.id, step: data.courier.step }
        : null,
      savedAt: data.savedAt || 0,
    };
  } catch {
    return null;
  }
}

// Write a save into one slot (default SLOT 1 — the old single-save call
// saveGame(data) keeps working exactly as before).
export function saveGame(data, slot = 1) {
  try {
    const payload = {
      name: data.name || 'Wowok', // the protagonist's name, defaults to Wowok
      money: data.money || 0,
      done: Array.isArray(data.done) ? data.done.slice() : [],
      active: data.active || null, // {id, step} or null
      shop: data.shop || null, // {pistol, ammo, medkits, armor, drinks}
      health: typeof data.health === 'number' ? Math.max(0, Math.min(100, Math.round(data.health))) : 100,
      coins: Array.isArray(data.coins) ? data.coins.slice() : [],
      stunts: Array.isArray(data.stunts) ? data.stunts.slice() : [],
      courier: data.courier || null, // {id, step} or null
      savedAt: Date.now(),
    };
    localStorage.setItem(slotKey(slot), JSON.stringify(payload));
    // SLOT 1 also keeps the legacy single-save key in sync, so the old
    // contract "saveGame(data) writes SAVE_KEY" still holds for every
    // existing reader (missions.test.mjs reads SAVE_KEY directly).
    if (normalizeSlot(slot) === 1) localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false; // storage unavailable (private mode, headless) — game goes on
  }
}

export function clearSave(slot = 1) {
  try {
    localStorage.removeItem(slotKey(slot));
    // SLOT 1 also drops the legacy key, so ?mission test mode wipes the
    // old single save exactly as it used to.
    if (normalizeSlot(slot) === 1) localStorage.removeItem(SAVE_KEY);
  } catch { /* ignore */ }
}

// All three slots with their data (null = empty), for the start menu.
export function listSlots() {
  const out = [];
  for (let s = 1; s <= SLOT_COUNT; s++) out.push({ slot: s, data: loadGame(s) });
  return out;
}
