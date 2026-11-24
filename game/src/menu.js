// Teluk Rimba — start menu (Mu 24 Nov): the golden-hour drone video loops
// behind NEW GAME / LOAD GAME (3 save slots) / SETTINGS until the player
// picks something. Our own look, nothing like the reference Mu sent:
// title top-CENTER, menu a vertical stack CENTERED under it, save slots a
// HORIZONTAL strip at the bottom, upright bold type (never italic), sunset
// gold + deep teal + coral on dark navy.
//
// Pure helpers + a DOM-free state model are exported for Node tests;
// createStartMenu() wires the DOM (no-op in Node, where document is
// undefined). The video is our own footage — game/assets/menu-loop.mp4,
// re-encoded in-session from the golden-hour drone video at 854x480.
import { listSlots, SLOT_COUNT } from './save.js';

export const MENU_ITEMS = [
  { id: 'new', label: 'NEW GAME' },
  { id: 'load', label: 'LOAD GAME' },
  { id: 'settings', label: 'SETTINGS' },
];
export const VIDEO_SRC = 'assets/menu-loop.mp4';

// Volume rows in the menu settings panel, wired to audio.js's existing
// setters (audio.setVolume(key, 0..1), audio.setMuted(bool)).
export const VOLUME_ROWS = [
  { key: 'music', label: 'Music' },
  { key: 'effects', label: 'SFX' },
  { key: 'ambience', label: 'Ambience' },
];

export function formatSlotDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// One slot's card text: EMPTY, or date + cash + mission progress.
export function slotSummary(slot, data) {
  if (!data) {
    return { slot, empty: true, title: `SLOT ${slot}`, detail: 'EMPTY — no save yet' };
  }
  const missions = Array.isArray(data.done) ? data.done.length : 0;
  return {
    slot,
    empty: false,
    title: `SLOT ${slot}`,
    detail: `${formatSlotDate(data.savedAt)} · $${data.money || 0} · MISSIONS ${missions}/6`,
  };
}

// HTML for the 3 slot cards (horizontal strip at the bottom of the menu).
// Pure string — the menu fills #slot-strip with it on LOAD GAME.
export function slotCardsHtml(slots) {
  const list = Array.isArray(slots) ? slots : [];
  let html = '';
  for (let s = 1; s <= SLOT_COUNT; s++) {
    const entry = list.find((e) => e && e.slot === s);
    const sum = slotSummary(s, entry ? entry.data : null);
    html += '<button type="button" class="slot-card' + (sum.empty ? ' empty' : '')
      + '" data-slot="' + s + '"' + (sum.empty ? ' disabled' : '')
      + '><span class="slot-title">' + sum.title + '</span>'
      + '<span class="slot-detail">' + sum.detail + '</span></button>';
  }
  return html;
}

// First empty slot for a new game; when all 3 are full, NEW GAME
// overwrites SLOT 1 (said plainly in the menu code — no confirm dialog).
export function pickNewGameSlot(slots) {
  const list = Array.isArray(slots) ? slots : [];
  for (const entry of list) {
    if (entry && !entry.data) return entry.slot;
  }
  return 1;
}

// DOM-free menu state: the game does NOT start until chooseNewGame() or
// chooseSlot() runs — opening LOAD GAME or SETTINGS never starts it.
export function createMenuModel(getSlots) {
  const readSlots = typeof getSlots === 'function' ? getSlots : listSlots;
  const model = {
    view: 'main', // 'main' | 'slots' | 'settings'
    selected: 0, // index into MENU_ITEMS
    started: false,
    activeSlot: null,
    slots: [],
    openSlots() {
      model.view = 'slots';
      model.slots = readSlots();
      return model.slots;
    },
    openSettings() { model.view = 'settings'; },
    back() { model.view = 'main'; },
    moveSelection(d) {
      model.selected = (model.selected + d + MENU_ITEMS.length) % MENU_ITEMS.length;
      return MENU_ITEMS[model.selected].id;
    },
    chooseNewGame() {
      const slot = pickNewGameSlot(model.slots.length ? model.slots : readSlots());
      model.started = true;
      model.activeSlot = slot;
      return slot;
    },
    // Returns the save data, or null when the slot is empty (nothing starts).
    chooseSlot(slot) {
      const list = model.slots.length ? model.slots : readSlots();
      const entry = list.find((e) => e && e.slot === slot);
      if (!entry || !entry.data) return null;
      model.started = true;
      model.activeSlot = slot;
      return entry.data;
    },
  };
  return model;
}

// --- DOM wiring (browser only) ---
export function createStartMenu({ overlay, audio, getSlots, onNewGame, onLoadSlot }) {
  if (typeof document === 'undefined' || !overlay) return null;
  const model = createMenuModel(getSlots);
  const video = overlay.querySelector('#menu-video');
  const nav = overlay.querySelector('#menu-main');
  const slotsView = overlay.querySelector('#menu-slots');
  const settingsView = overlay.querySelector('#menu-settings');
  const strip = overlay.querySelector('#slot-strip');
  const buttons = Array.from(overlay.querySelectorAll('.menu-btn'));

  // If the video file cannot load, hide it: the menu still works over the
  // dark gradient + the live city render behind it.
  if (video) {
    video.addEventListener('error', () => { video.style.display = 'none'; });
    // Autoplay is allowed (muted), but never trust it silently: if the
    // video is still paused after a beat, try once more; the menu works
    // either way — the loop is the backdrop, not the game.
    video.addEventListener('loadeddata', () => {
      if (video.paused) video.play().catch(() => { /* backdrop only */ });
    });
  }

  function show(view) {
    if (nav) nav.hidden = view !== 'main';
    if (slotsView) slotsView.hidden = view !== 'slots';
    if (settingsView) settingsView.hidden = view !== 'settings';
  }

  function refreshSlots() {
    if (!strip) return;
    strip.innerHTML = slotCardsHtml(model.openSlots());
    strip.querySelectorAll('.slot-card:not(.empty)').forEach((card) => {
      card.addEventListener('click', () => {
        const slot = Number(card.getAttribute('data-slot'));
        const data = model.chooseSlot(slot);
        if (data && onLoadSlot) onLoadSlot(slot, data);
      });
    });
  }

  function syncSettings() {
    if (!audio || !settingsView) return;
    settingsView.querySelectorAll('[data-vol]').forEach((input) => {
      const key = input.getAttribute('data-vol');
      const v = audio.volumes && typeof audio.volumes[key] === 'number' ? audio.volumes[key] : 0;
      input.value = String(Math.round(v * 100));
      const val = settingsView.querySelector('[data-vol-val="' + key + '"]');
      if (val) val.textContent = String(Math.round(v * 100));
    });
    const muteBox = settingsView.querySelector('[data-mute]');
    if (muteBox) muteBox.checked = !!audio.muted;
  }

  function select(i) {
    model.selected = i;
    buttons.forEach((b, j) => b.classList.toggle('selected', j === i));
  }

  function activate(id) {
    if (id === 'new') {
      const slot = model.chooseNewGame();
      if (onNewGame) onNewGame(slot);
    } else if (id === 'load') {
      refreshSlots();
      show('slots');
    } else if (id === 'settings') {
      syncSettings();
      show('settings');
    }
  }

  buttons.forEach((btn, i) => {
    btn.addEventListener('click', () => { select(i); activate(btn.getAttribute('data-menu')); });
    btn.addEventListener('mouseenter', () => select(i));
  });
  overlay.querySelectorAll('[data-menu-back]').forEach((btn) => {
    btn.addEventListener('click', () => { model.back(); show('main'); });
  });
  if (settingsView) {
    settingsView.querySelectorAll('[data-vol]').forEach((input) => {
      input.addEventListener('input', () => {
        const key = input.getAttribute('data-vol');
        if (audio && audio.setVolume) audio.setVolume(key, Number(input.value) / 100);
        const val = settingsView.querySelector('[data-vol-val="' + key + '"]');
        if (val) val.textContent = input.value;
      });
    });
    const muteBox = settingsView.querySelector('[data-mute]');
    if (muteBox) {
      muteBox.addEventListener('change', () => {
        if (audio && audio.setMuted) audio.setMuted(muteBox.checked);
        if (audio && audio.uiClick) audio.uiClick();
      });
    }
  }
  overlay.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') { model.back(); show('main'); return; }
    if (model.view !== 'main') return;
    if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
      e.preventDefault();
      select((model.selected + (e.code === 'ArrowDown' ? 1 : -1) + MENU_ITEMS.length) % MENU_ITEMS.length);
      const btn = buttons[model.selected];
      if (btn) btn.focus();
    } else if (e.code === 'Enter' || e.code === 'Space') {
      // Buttons already fire on Enter/Space natively — only handle the
      // key here when focus sits on the overlay itself, never twice.
      if (e.target === overlay) {
        e.preventDefault();
        activate(MENU_ITEMS[model.selected].id);
      }
    }
  });

  select(0);
  show('main');
  return { model, refreshSlots, show };
}
