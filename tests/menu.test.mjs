// Start menu checks (Mu 24 Nov): looping golden-hour video behind NEW
// GAME / LOAD GAME (3 slots) / SETTINGS — our own layout, nothing copied
// from the competitor reference (title top-center, menu centered, slots a
// horizontal strip at the bottom, upright bold type).
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  MENU_ITEMS, VIDEO_SRC, VOLUME_ROWS, formatSlotDate, slotSummary,
  slotCardsHtml, pickNewGameSlot, createMenuModel,
} from '../game/src/menu.js';
import { SLOT_COUNT } from '../game/src/save.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
let fails = 0;
function check(name, ok, extra = '') {
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' — ' + extra : ''));
  if (!ok) fails++;
}

const html = readFileSync(join(repoRoot, 'game/index.html'), 'utf8');
const mainJs = readFileSync(join(repoRoot, 'game/src/main.js'), 'utf8');

// --- Menu items: exactly the 3 Mu asked for ---
check('menu has exactly 3 items', MENU_ITEMS.length === 3);
check('menu items are new/load/settings in order',
  MENU_ITEMS.map((m) => m.id).join(',') === 'new,load,settings');
check('menu labels are NEW GAME / LOAD GAME / SETTINGS',
  MENU_ITEMS.map((m) => m.label).join(',') === 'NEW GAME,LOAD GAME,SETTINGS');
check('settings panel has exactly the 3 volume rows (music/SFX/ambience)',
  VOLUME_ROWS.map((r) => r.key).join(',') === 'music,effects,ambience');

// --- Slot summaries ---
const empty = slotSummary(2, null);
check('empty slot reports EMPTY', empty.empty && /EMPTY/.test(empty.detail), empty.detail);
check('empty slot title is SLOT 2', empty.title === 'SLOT 2');
const fake = { name: 'Wowok', money: 1250, done: [1, 2], savedAt: Date.UTC(2026, 10, 24, 4, 0, 0) };
const full = slotSummary(1, fake);
check('filled slot is not empty', !full.empty);
check('filled slot detail shows cash', /\$1250/.test(full.detail), full.detail);
check('filled slot detail shows mission progress', /MISSIONS 2\/6/.test(full.detail), full.detail);
check('filled slot detail shows the save date', /24 Nov 2026/.test(full.detail), full.detail);
check('formatSlotDate is empty for a missing timestamp', formatSlotDate(0) === '');

// --- Slot cards HTML: 3 cards, horizontal strip content ---
const cards = slotCardsHtml([
  { slot: 1, data: fake },
  { slot: 2, data: null },
  { slot: 3, data: { name: 'Wowok', money: 0, done: [], savedAt: Date.UTC(2026, 10, 23) } },
]);
check('slot strip renders 3 cards', (cards.match(/slot-card/g) || []).length === 3, cards.slice(0, 80));
check('empty slot card is disabled + EMPTY', /data-slot="2"[^>]*disabled/.test(cards) && /EMPTY/.test(cards));
check('filled slot card is clickable (not disabled)', !/data-slot="1"[^>]*disabled/.test(cards));
check('filled slot card shows cash + missions', /\$1250/.test(cards) && /MISSIONS 2\/6/.test(cards));

// --- New-game slot picking: first empty, else overwrite SLOT 1 ---
check('new game picks the first empty slot',
  pickNewGameSlot([{ slot: 1, data: fake }, { slot: 2, data: null }, { slot: 3, data: fake }]) === 2);
check('new game with all slots full overwrites SLOT 1',
  pickNewGameSlot([{ slot: 1, data: fake }, { slot: 2, data: fake }, { slot: 3, data: fake }]) === 1);
check('new game with all slots empty picks SLOT 1',
  pickNewGameSlot([{ slot: 1, data: null }, { slot: 2, data: null }, { slot: 3, data: null }]) === 1);

// --- Menu state model: nothing starts before a choice ---
const slotsStub = () => ([
  { slot: 1, data: fake },
  { slot: 2, data: null },
  { slot: 3, data: null },
]);
const model = createMenuModel(slotsStub);
check('menu starts on the main view, game not started',
  model.view === 'main' && model.started === false);
model.openSlots();
check('LOAD GAME opens the slots view, still not started',
  model.view === 'slots' && model.started === false);
check('clicking an empty slot starts nothing',
  model.chooseSlot(2) === null && model.started === false);
model.back();
check('BACK returns to the main view', model.view === 'main');
model.openSettings();
check('SETTINGS opens the settings view, still not started',
  model.view === 'settings' && model.started === false);
model.back();
const picked = model.chooseNewGame();
check('NEW GAME starts the game into the first empty slot (2)',
  model.started === true && model.activeSlot === 2 && picked === 2);
const model2 = createMenuModel(slotsStub);
const loaded = model2.chooseSlot(1);
check('loading SLOT 1 starts the game with that save',
  model2.started === true && model2.activeSlot === 1 && loaded === fake);
check('keyboard selection cycles through the 3 items',
  model2.moveSelection(1) === 'load' && model2.moveSelection(1) === 'settings'
  && model2.moveSelection(1) === 'new' && model2.moveSelection(-1) === 'settings');

// --- index.html: video + menu markup, ours not theirs ---
const videoTag = html.match(/<video[^>]*id="menu-video"[^>]*>/) || html.match(/<video[^>]*>/);
check('menu video element exists', !!videoTag, videoTag ? videoTag[0] : 'no <video>');
if (videoTag) {
  const tag = videoTag[0];
  check('video loops', /\bloop\b/.test(tag), tag);
  check('video autoplays', /\bautoplay\b/.test(tag), tag);
  check('video is muted', /\bmuted\b/.test(tag), tag);
  check('video is playsinline', /\bplaysinline\b/.test(tag), tag);
  check('video src is inside game/ (' + VIDEO_SRC + ')', tag.includes('src="' + VIDEO_SRC + '"'), tag);
}
check('title is TELUK RIMBA', /TELUK RIMBA/.test(html));
check('menu has NEW GAME button', /data-menu="new">NEW GAME</.test(html));
check('menu has LOAD GAME button', /data-menu="load">LOAD GAME</.test(html));
check('menu has SETTINGS button', /data-menu="settings">SETTINGS</.test(html));
check('slots strip container exists', /id="slot-strip"/.test(html));
check('settings has music slider', /data-vol="music"/.test(html));
check('settings has SFX slider', /data-vol="effects"/.test(html));
check('settings has ambience slider', /data-vol="ambience"/.test(html));
check('settings has a mute checkbox', /data-mute/.test(html));
check('settings has a BACK button', /data-menu-back>BACK</.test(html));
check('old click-to-start is gone', !/CLICK TO START/.test(html));
check('no competitor title words', !/ISLE OF EMBERS/i.test(html));
check('no competitor save-place words', !/Tomo/i.test(html));
check('no competitor tagline words', !/never existed/i.test(html));
check('title is top-center, not left-aligned (CSS)', /\.menu-title[^}]*letter-spacing: 6px/.test(html) && !/#start-screen[^}]*text-align: left/.test(html));

// --- main.js wiring: menu drives the start, no click-anywhere start ---
check('main.js creates the start menu', /createStartMenu\(/.test(mainJs));
check('main.js has no click-anywhere start anymore',
  !/overlay\.addEventListener\('click', startGame\)/.test(mainJs));
check('main.js restores a save only from a picked slot',
  /function applySave\(saved\)/.test(mainJs) && !/const saved = loadGame\(\);/.test(mainJs));
check('main.js pauses the menu video when play starts', /menuVideo\.pause\(\)/.test(mainJs));

// --- The loop video file itself ---
const videoPath = join(repoRoot, 'game/assets/menu-loop.mp4');
let videoSize = -1;
try { videoSize = statSync(videoPath).size; } catch { /* missing */ }
check('menu-loop.mp4 exists under game/assets/', videoSize > 0);
check('menu-loop.mp4 is at most 16 MB (leaves game/ headroom)',
  videoSize > 0 && videoSize <= 16 * 1024 * 1024, videoSize > 0 ? (videoSize / 1048576).toFixed(2) + ' MiB' : 'missing');
check('save has 3 slots', SLOT_COUNT === 3);

if (fails) { console.error(fails + ' MENU CHECK(S) FAILED'); process.exit(1); }
console.log('ALL MENU CHECKS PASSED');
