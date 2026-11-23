// Teluk Rimba — save / load (localStorage, no server, no account).
// Saves the player name (Wowok), money, completed missions and the active
// mission (id + step), plus the shop inventory, coins, stunts and courier
// player keeps progress across sessions. Pure storage logic: safe to import
// from Node tests with a localStorage stub.
export const SAVE_KEY = 'teluk-rimba-save-v1';

export function saveGame(data) {
  try {
    const payload = {
      name: data.name || 'Wowok', // the protagonist's name, defaults to Wowok
      money: data.money || 0,
      done: Array.isArray(data.done) ? data.done.slice() : [],
      active: data.active || null, // {id, step} or null
      shop: data.shop || null, // {pistol, ammo, medkits, armor, drinks}
      coins: Array.isArray(data.coins) ? data.coins.slice() : [],
      stunts: Array.isArray(data.stunts) ? data.stunts.slice() : [],
      courier: data.courier || null, // {id, step} or null
      savedAt: Date.now(),
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false; // storage unavailable (private mode, headless) — game goes on
  }
}

export function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
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

export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}
