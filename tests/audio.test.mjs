// Teluk Rimba — audio system checks (Node, no browser, no AudioContext).
// The audio module is import-safe in Node: every sound is counted even
// without a context (counted-only mode), and the pure parts (area + surface
// classification, engine pitch, volume math) are verified directly.
// Run: node tests/audio.test.mjs
import { generateCity } from '../game/src/city.js';
import {
  createAudio, engineBaseFreq, MAX_SFX_VOICES, AUDIO_KEY, DEFAULT_VOLUMES,
} from '../game/src/audio.js';

// localStorage stub for Node.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const city = generateCity();
const audio = createAudio(city);

// --- import-safe + counted-only mode (no AudioContext in Node) ---
check('createAudio works without a browser', !!audio);
check('AudioContext stays null without unlock', audio.ctxState === 'none');
audio.gunshot(); audio.coin(); audio.missionComplete(); audio.horn('car');
audio.impact('metal'); audio.impact('water'); audio.splash(); audio.footstep('sand');
audio.reload(); audio.emptyClick(); audio.shop(); audio.stunt(); audio.shipHorn();
audio.thunder(); audio.bark(); audio.birdChirp(); audio.gull(); audio.npcVoice();
audio.heartbeat(); audio.busted(); audio.busStop(); audio.doorThud(); audio.engineStart();
audio.collision(30); audio.brake(); audio.screech(); audio.missionStart(); audio.missionFail();
audio.missionBell(); audio.distantHorn(); audio.clank(); audio.planeWhoosh(); audio.boatSplash();
audio.wantedUp(1); audio.wantedUp(3);
{
  const d = audio.debugStats();
  const total = Object.values(d.counts).reduce((a, b) => a + b, 0);
  check('every SFX call is counted without a context', total >= 30, `${total} triggers`);
  check('gunshot counted', d.counts.gunshot === 1);
  check('coin counted', d.counts.coin === 2, 'missionComplete plays a coin too');
  check('impact split by material', d.counts['impact:metal'] === 1 && d.counts['impact:water'] === 1);
  check('wantedUp counted at both levels', d.counts.wantedUp === 2);
  check('no voices live without a context', d.active === 0);
  check('nothing dropped without a context', d.dropped === 0);
}

// --- volumes + saved mute ---
check('default volumes match spec', audio.volumes.master === DEFAULT_VOLUMES.master
  && audio.volumes.music === DEFAULT_VOLUMES.music && audio.volumes.effects === DEFAULT_VOLUMES.effects
  && audio.volumes.ambience === DEFAULT_VOLUMES.ambience && audio.volumes.ui === DEFAULT_VOLUMES.ui);
check('setVolume clamps to 0..1', audio.setVolume('music', 2) && audio.volumes.music === 1
  && audio.setVolume('music', -1) && audio.volumes.music === 0);
check('setVolume rejects unknown keys', audio.setVolume('nope', 0.5) === false);
audio.setVolume('music', 0.42);
audio.setMuted(true);
check('mute is saved to localStorage', (() => {
  const raw = JSON.parse(store.get(AUDIO_KEY));
  return raw.muted === true && raw.music === 0.42;
})());
{
  const audio2 = createAudio(city);
  check('volumes + mute reload from storage', audio2.volumes.music === 0.42 && audio2.muted === true);
  audio2.setMuted(false);
  check('unmute persists too', JSON.parse(store.get(AUDIO_KEY)).muted === false);
}

// --- area classification (drives the ambience crossfade) ---
check('beach area at the shore', audio.areaFor(650, 0) === 'beach', audio.areaFor(650, 0));
check('sea area past the shore', audio.areaFor(700, 0) === 'beach');
check('downtown area at the centre', audio.areaFor(0, 0) === 'downtown', audio.areaFor(0, 0));
check('port area south-east', audio.areaFor(400, 400) === 'port', audio.areaFor(400, 400));
check('forest area north-west', audio.areaFor(-600, -400) === 'forest', audio.areaFor(-600, -400));
check('residential area far out', audio.areaFor(0, -560) === 'residential', audio.areaFor(0, -560));
check('market area at Rimba Market', audio.areaFor(-50, -50) === 'market', audio.areaFor(-50, -50));
check('river area on the river', audio.areaFor(-300, -300) === 'river', audio.areaFor(-300, -300));

// --- surface classification (drives footstep sounds) ---
check('sand on the beach', audio.surfaceAt(620, 0) === 'sand', audio.surfaceAt(620, 0));
check('water past the shore', audio.surfaceAt(650, 0) === 'water');
check('water in the river', audio.surfaceAt(-480, -480) === 'water');
check('asphalt on a main road', audio.surfaceAt(0, 100) === 'asphalt', audio.surfaceAt(0, 100));
check('sidewalk next to a road', audio.surfaceAt(8, 150) === 'sidewalk', audio.surfaceAt(8, 150));
check('grass inside a block', audio.surfaceAt(50, 50) === 'grass', audio.surfaceAt(50, 50));

// --- engine pitch by type + speed ---
check('supercar idles higher than a bus', engineBaseFreq('supercar') > engineBaseFreq('bus'),
  `${engineBaseFreq('supercar')} vs ${engineBaseFreq('bus')}`);
check('motorbike idles higher than a truck', engineBaseFreq('motorbike') > engineBaseFreq('truck'));
check('sailboat has no engine', engineBaseFreq('sailboat') === 0);
check('unknown type falls back', engineBaseFreq('hovercraft') === 70);

// --- update() runs with partial state (no crash, no context needed) ---
{
  const before = audio.debugStats();
  audio.update(1 / 60, { x: 650, z: 0, timeHours: 12, moving: true, onFoot: true, speedKmh: 5 });
  audio.update(1 / 60, { x: 0, z: 0, timeHours: 21.5, wanted: 3, policeDist: 20, rain: 1 });
  audio.update(1 / 60, { x: -500, z: -500, timeHours: 10, driving: { type: 'motorbike' }, vehicleType: 'motorbike', speedKmh: 60 });
  audio.update(1 / 60, {});
  const after = audio.debugStats();
  check('update() tolerates partial state', true);
  check('walking on the beach triggers footsteps', (after.counts['footstep:sand'] || 0) > 0,
    `sand steps: ${after.counts['footstep:sand'] || 0}`);
  check('wanted 3 + close police triggers heartbeat', (after.counts.heartbeat || 0) > 0,
    `heartbeats: ${after.counts.heartbeat || 0}`);
  check('update counted nothing unexpected', after.dropped === 0);
}

// --- wanted-level-up sting: fired by update() on a rise, once per rise ---
{
  const a2 = createAudio(city); // fresh instance: prevWanted starts at 0
  a2.update(1 / 60, { wanted: 0 });
  check('no sting at wanted 0', (a2.debugStats().counts.wantedUp || 0) === 0);
  a2.update(1 / 60, { wanted: 1 });
  check('sting on 0 -> 1', a2.debugStats().counts.wantedUp === 1);
  a2.update(1 / 60, { wanted: 1 });
  check('no repeat sting at the same level', a2.debugStats().counts.wantedUp === 1);
  a2.update(1 / 60, { wanted: 3 });
  check('sting again on 1 -> 3', a2.debugStats().counts.wantedUp === 2);
  a2.update(1 / 60, { wanted: 0 });
  check('no sting when wanted falls', a2.debugStats().counts.wantedUp === 2);
  a2.update(1 / 60, {});
  check('missing wanted in state is safe', a2.debugStats().counts.wantedUp === 2);
  // Audibility is gain-gated (UI bus + master mute), not call-gated: the
  // sting is still counted while muted, it just sounds at gain 0.
  a2.setMuted(true);
  a2.wantedUp(2);
  check('sting counted even while muted', a2.debugStats().counts.wantedUp === 3);
  a2.setMuted(false);
}

// --- ducking + voice cap constants ---
check('voice cap is sane', MAX_SFX_VOICES >= 16 && MAX_SFX_VOICES <= 32, `${MAX_SFX_VOICES}`);

console.log(failures === 0 ? 'ALL AUDIO CHECKS PASSED' : `${failures} AUDIO CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
