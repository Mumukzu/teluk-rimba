// Teluk Rimba — full WebAudio sound system. Synthesized only: every sound
// is built from oscillators + filtered noise, no sound files, no samples.
// One AudioContext, created/resumed after the first click on the start
// screen. Separate volumes (master / music / effects / ambience / UI) +
// a saved mute. Concurrent voices are capped so the game stays light;
// music ducks briefly on gunshots and collisions.
//
// Pure-logic parts (area + surface classification, engine pitch, volume
// math) are exported / testable from Node; the AudioContext is only touched
// inside unlock(), so importing this file in Node is safe.
import { ROAD_LINES, ASPHALT_HALF, riverDistance, areaNameAt, terrainHeight } from './city.js';

export const AUDIO_KEY = 'teluk-rimba-audio-v1';
export const MAX_SFX_VOICES = 24;
export const MAX_MUSIC_VOICES = 10;

export const DEFAULT_VOLUMES = {
  master: 0.8, music: 0.5, effects: 0.9, ambience: 0.7, ui: 0.8, muted: false,
};

// Engine base pitch per vehicle type (Hz at idle; rises with speed).
export function engineBaseFreq(type) {
  const map = {
    motorbike: 95, scooter: 80, bajaj: 70, car: 70, sedan: 75, mpv: 65,
    jeep: 70, angkot: 65, bus: 45, truck: 45, firetruck: 50, ambulance: 78,
    police: 82, supercar: 112, boat: 58, fishingboat: 42, sailboat: 0,
  };
  return map[type] ?? 70; // ?? not || : sailboat is 0, and 0 is a real value
}

function loadVolumes() {
  const v = { ...DEFAULT_VOLUMES };
  try {
    if (typeof localStorage === 'undefined') return v;
    const raw = localStorage.getItem(AUDIO_KEY);
    if (!raw) return v;
    const data = JSON.parse(raw);
    for (const k of ['master', 'music', 'effects', 'ambience', 'ui']) {
      if (typeof data[k] === 'number' && Number.isFinite(data[k])) {
        v[k] = Math.max(0, Math.min(1, data[k]));
      }
    }
    if (typeof data.muted === 'boolean') v.muted = data.muted;
  } catch { /* storage unavailable — defaults stand */ }
  return v;
}

function makeNoiseBuffer(ctx) {
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

export function createAudio(city) {
  const volumes = loadVolumes();
  let ctx = null; // the one AudioContext; created in unlock()
  let noiseBuf = null;
  let buses = null; // {master, music, sfx, amb, ui}
  let loops = null; // persistent loop sources + their gain nodes
  let duckUntilMs = 0;
  let nextChordAt = 0;
  let chordIdx = 0;
  let stepAccum = 0; // metres walked since the last footstep
  let heartT = 0; // heartbeat timer (danger state)
  let lastArea = 'downtown';
  let lastMode = 'day';
  let prevPlaneActive = false;
  let thunderTimer = 20;
  const timers = { gull: 6, bird: 3, bark: 18, horn: 12, clank: 10, npc: 5 };

  const debug = { counts: {}, dropped: 0 };
  const sfxVoices = new Set(); // live one-shot nodes (capped)
  const musicVoices = new Set();

  function saveVolumes() {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(AUDIO_KEY, JSON.stringify(volumes));
    } catch { /* ignore */ }
  }

  function count(name) {
    debug.counts[name] = (debug.counts[name] || 0) + 1;
  }

  // Register a live node so the voice cap + debug counter can see it.
  function track(node, set, priority) {
    if (!node) return null;
    node._prio = priority;
    set.add(node);
    const done = () => set.delete(node);
    try { node.onended = done; } catch { /* some nodes lack onended */ }
    // Safety net: a node that never fires onended is dropped after 8 s.
    setTimeout(done, 8000);
    return node;
  }

  function setBusGain(node, value) {
    if (!ctx || !node) return;
    try { node.gain.setTargetAtTime(value, ctx.currentTime, 0.08); } catch { /* ignore */ }
  }

  function applyVolumes() {
    if (!ctx || !buses) return;
    const m = volumes.muted ? 0 : volumes.master;
    setBusGain(buses.master, m);
    setBusGain(buses.sfx, volumes.effects);
    setBusGain(buses.amb, volumes.ambience);
    setBusGain(buses.ui, volumes.ui);
    // Music gain is ducked live in update(); its base is volumes.music.
    setBusGain(buses.music, volumes.music * (Date.now() < duckUntilMs ? 0.3 : 1));
  }

  // --- one-shot synth helpers (all schedule on ctx.currentTime) ---
  function envGain(t0, peak, attack, dur) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + Math.max(0.005, attack));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    return g;
  }

  function tone(dest, o) {
    const t0 = ctx.currentTime + (o.at || 0);
    const osc = ctx.createOscillator();
    const g = envGain(t0, o.peak || 0.3, o.attack || 0.005, o.dur || 0.2);
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq || 440, t0);
    if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.freqEnd), t0 + (o.dur || 0.2));
    osc.connect(g); g.connect(dest);
    osc.start(t0);
    osc.stop(t0 + (o.dur || 0.2) + 0.05);
    return track(osc, o.music ? musicVoices : sfxVoices, o.priority || 2);
  }

  function noiseHit(dest, o) {
    const t0 = ctx.currentTime + (o.at || 0);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = o.filter || 'lowpass';
    f.frequency.setValueAtTime(o.freq || 1000, t0);
    f.Q.value = o.q || 1;
    if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(10, o.freqEnd), t0 + (o.dur || 0.2));
    const g = envGain(t0, o.peak || 0.3, o.attack || 0.005, o.dur || 0.2);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + (o.dur || 0.2) + 0.05);
    return track(src, o.music ? musicVoices : sfxVoices, o.priority || 2);
  }

  // Play one named one-shot. Always counted (the debug counter moves even
  // before unlock / in headless runs); sounded only when the context exists.
  // Returns false when the voice cap drops a low-priority sound.
  function play(name, priority, fn) {
    count(name);
    if (!ctx || !buses) return true; // counted, not sounded yet
    if (sfxVoices.size >= MAX_SFX_VOICES && priority < 2) {
      debug.dropped++;
      return false;
    }
    if (sfxVoices.size >= MAX_SFX_VOICES) {
      // Make room: stop the oldest low-priority voices until under the cap.
      // (A single sound adds 1-4 nodes, so evicting one is not enough.)
      for (const v of sfxVoices) {
        if (sfxVoices.size < MAX_SFX_VOICES) break;
        // Remove synchronously: onended fires async, so without this the
        // loop would stop every low-priority voice in one call.
        if ((v._prio || 2) < 2) { try { v.stop(); } catch { /* ignore */ } sfxVoices.delete(v); }
      }
    }
    try { fn(); } catch { /* a failed voice must never break the game */ }
    return true;
  }

  function duck(ms = 900) {
    duckUntilMs = Date.now() + ms;
    applyVolumes();
  }

  // --- persistent loops (created once at unlock) ---
  function loopNoise(filterType, freq, q) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filterType; f.frequency.value = freq; f.Q.value = q || 1;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f); f.connect(g);
    src.start();
    return { src, filter: f, gain: g };
  }

  function loopOsc(type, freq) {
    const o = ctx.createOscillator();
    o.type = type; o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = 0;
    o.connect(g);
    o.start();
    return { osc: o, gain: g };
  }

  // Amplitude-modulate a gain node with an LFO (for waves swell, wind,
  // crickets, helicopter rotor chop).
  function addLfo(param, rate, depth, base) {
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = rate;
    const depthGain = ctx.createGain();
    depthGain.gain.value = depth;
    lfo.connect(depthGain);
    depthGain.connect(param);
    param.value = base;
    lfo.start();
    return lfo;
  }

  // Insert a swell gain node between a loop's level gain (driven by
  // update()) and its bus, and modulate the swell with an LFO. The LFO
  // must never touch the level param itself, or a "silent" loop (level 0)
  // would still sound from the LFO swing.
  function swellTo(gainNode, dest, rate, depth) {
    const swell = ctx.createGain();
    swell.gain.value = 1;
    gainNode.connect(swell);
    swell.connect(dest);
    addLfo(swell.gain, rate, depth, 1);
    return swell;
  }

  function buildLoops() {
    const L = {};
    // Sea waves: low noise with a slow swell.
    L.waves = loopNoise('lowpass', 420, 0.6);
    swellTo(L.waves.gain, buses.amb, 0.07, 0.3);
    // Wind: bandpassed noise, slow swell.
    L.wind = loopNoise('bandpass', 380, 0.4);
    swellTo(L.wind.gain, buses.amb, 0.11, 0.3);
    // Downtown traffic hum: very low noise.
    L.traffic = loopNoise('lowpass', 170, 0.7);
    L.traffic.gain.connect(buses.amb);
    // Market murmur: voice-band noise, plus an echo send (old-town echo).
    L.murmur = loopNoise('bandpass', 480, 1.4);
    L.murmur.gain.connect(buses.amb);
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.27;
    const fb = ctx.createGain(); fb.gain.value = 0.35;
    const echoGain = ctx.createGain(); echoGain.gain.value = 0;
    L.murmur.gain.connect(delay);
    delay.connect(fb); fb.connect(delay);
    delay.connect(echoGain); echoGain.connect(buses.amb);
    L.echoGain = echoGain;
    // Industrial machinery: low saw hum + filtered noise.
    L.mach = loopOsc('sawtooth', 48);
    L.mach.gain.connect(buses.amb);
    L.machNoise = loopNoise('lowpass', 260, 0.8);
    L.machNoise.gain.connect(buses.amb);
    // Crickets: 4.2 kHz trill, amplitude-chopped at 11 Hz.
    L.crickets = loopOsc('sine', 4200);
    swellTo(L.crickets.gain, buses.amb, 11, 0.5);
    // Rain: soft high noise.
    L.rain = loopNoise('lowpass', 1300, 0.5);
    L.rain.gain.connect(buses.amb);
    // Player vehicle engine: saw + exhaust noise, pitch follows speed.
    L.engine = loopOsc('sawtooth', 80);
    const engFilter = ctx.createBiquadFilter();
    engFilter.type = 'lowpass'; engFilter.frequency.value = 700;
    L.engine.gain.connect(engFilter); engFilter.connect(buses.sfx);
    L.engineFilter = engFilter;
    // Police siren: sine wailing 660-880 Hz.
    L.siren = loopOsc('sine', 770);
    L.siren.gain.connect(buses.sfx);
    const sirenLfo = ctx.createOscillator();
    sirenLfo.type = 'sine'; sirenLfo.frequency.value = 0.45;
    const sirenDepth = ctx.createGain(); sirenDepth.gain.value = 110;
    sirenLfo.connect(sirenDepth); sirenDepth.connect(L.siren.osc.frequency);
    sirenLfo.start();
    // Helicopter rotor: chopped low noise.
    L.heli = loopNoise('lowpass', 280, 0.8);
    swellTo(L.heli.gain, buses.sfx, 13, 0.5);
    return L;
  }

  function unlock() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return ctx;
    }
    let AC = null;
    try {
      AC = typeof window !== 'undefined'
        ? (window.AudioContext || window.webkitAudioContext)
        : null;
    } catch { AC = null; }
    if (!AC) return null; // no WebAudio here (Node / old browser): counted-only mode
    try {
      ctx = new AC();
      noiseBuf = makeNoiseBuffer(ctx);
      buses = {
        master: ctx.createGain(),
        music: ctx.createGain(),
        sfx: ctx.createGain(),
        amb: ctx.createGain(),
        ui: ctx.createGain(),
      };
      buses.music.connect(buses.master);
      buses.sfx.connect(buses.master);
      buses.amb.connect(buses.master);
      buses.ui.connect(buses.master);
      buses.master.connect(ctx.destination);
      applyVolumes();
      loops = buildLoops();
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    } catch {
      ctx = null; buses = null; loops = null;
    }
    return ctx;
  }

  function setVolume(key, value) {
    if (!['master', 'music', 'effects', 'ambience', 'ui'].includes(key)) return false;
    volumes[key] = Math.max(0, Math.min(1, Number(value) || 0));
    saveVolumes();
    applyVolumes();
    return true;
  }

  function setMuted(m) {
    volumes.muted = !!m;
    saveVolumes();
    applyVolumes();
    return volumes.muted;
  }

  // --- area + surface classification (pure, testable) ---
  function areaFor(x, z) {
    const name = areaNameAt(city, x, z);
    switch (name) {
      case 'Coral Beach': case 'Rimba Bay': return 'beach';
      case 'Rimba Harbor': return 'port';
      case 'Rimba Central': return 'downtown';
      case 'Merchant Quarter': return 'commercial';
      case 'Palm Gardens': return 'residential';
      case 'Volcano Woods': case 'Mount Rimba': return 'forest';
      case 'Rimba River': return 'river';
      case 'Rimba Market': case 'Rimba Plaza': return 'market';
      default: return 'residential';
    }
  }

  function surfaceAt(x, z) {
    if (x > 628 || riverDistance(x, z) < 8) return 'water';
    if (x > 600) return 'sand';
    const name = areaNameAt(city, x, z);
    if (name === 'Volcano Woods' || name === 'Mount Rimba') return 'grass';
    let best = Infinity;
    for (const L of ROAD_LINES) {
      const d = Math.min(Math.abs(x - L), Math.abs(z - L));
      best = Math.min(best, d - ASPHALT_HALF(L));
    }
    if (best <= 0) return 'asphalt';
    if (best <= 3) return 'sidewalk';
    return 'grass';
  }

  // --- one-shot SFX (all synthesized; every call is counted) ---
  const sfx = {
    gunshot() {
      duck();
      return play('gunshot', 3, () => {
        noiseHit(buses.sfx, { filter: 'lowpass', freq: 3200, freqEnd: 700, dur: 0.13, peak: 0.9, attack: 0.002 });
        tone(buses.sfx, { type: 'sine', freq: 160, freqEnd: 45, dur: 0.12, peak: 0.7 });
        // A faint impact a beat later (the bullet hits something).
        noiseHit(buses.sfx, { at: 0.09, filter: 'bandpass', freq: 900, q: 1, dur: 0.08, peak: 0.18 });
      });
    },
    reload() {
      return play('reload', 2, () => {
        tone(buses.sfx, { type: 'square', freq: 1250, dur: 0.03, peak: 0.22 });
        tone(buses.sfx, { at: 0.16, type: 'square', freq: 900, dur: 0.03, peak: 0.25 });
        noiseHit(buses.sfx, { at: 0.07, filter: 'bandpass', freq: 2200, q: 2, dur: 0.06, peak: 0.15 });
      });
    },
    emptyClick() {
      return play('emptyClick', 2, () => {
        tone(buses.sfx, { type: 'square', freq: 2100, dur: 0.025, peak: 0.2 });
      });
    },
    // Bullet impact on a material: concrete | metal | wood | water | dirt.
    impact(material) {
      const m = material || 'concrete';
      return play('impact:' + m, 2, () => {
        if (m === 'metal') {
          tone(buses.sfx, { type: 'sine', freq: 1250, dur: 0.28, peak: 0.3 });
          tone(buses.sfx, { type: 'sine', freq: 1870, dur: 0.2, peak: 0.18 });
          noiseHit(buses.sfx, { filter: 'highpass', freq: 3000, dur: 0.05, peak: 0.15 });
        } else if (m === 'wood') {
          tone(buses.sfx, { type: 'sine', freq: 180, freqEnd: 90, dur: 0.12, peak: 0.4 });
          noiseHit(buses.sfx, { filter: 'lowpass', freq: 800, dur: 0.08, peak: 0.25 });
        } else if (m === 'water') {
          noiseHit(buses.sfx, { filter: 'bandpass', freq: 1200, freqEnd: 300, q: 1, dur: 0.3, peak: 0.35 });
          tone(buses.sfx, { at: 0.12, type: 'sine', freq: 900, freqEnd: 500, dur: 0.08, peak: 0.12 });
          tone(buses.sfx, { at: 0.22, type: 'sine', freq: 700, freqEnd: 420, dur: 0.07, peak: 0.1 });
        } else if (m === 'dirt') {
          noiseHit(buses.sfx, { filter: 'lowpass', freq: 420, dur: 0.15, peak: 0.3 });
        } else { // concrete
          noiseHit(buses.sfx, { filter: 'bandpass', freq: 900, q: 1, dur: 0.09, peak: 0.4 });
          tone(buses.sfx, { type: 'sine', freq: 120, freqEnd: 70, dur: 0.09, peak: 0.3 });
        }
      });
    },
    engineStart() {
      return play('engineStart', 2, () => {
        tone(buses.sfx, { type: 'sawtooth', freq: 55, freqEnd: 95, dur: 0.4, peak: 0.25 });
        noiseHit(buses.sfx, { filter: 'lowpass', freq: 500, dur: 0.35, peak: 0.15 });
      });
    },
    // Throttled inside (min gap) — safe to call every frame while braking.
    brake() {
      const now = Date.now();
      if (now - (sfx._brakeAt || 0) < 300) return true;
      sfx._brakeAt = now;
      return play('brake', 2, () => {
        noiseHit(buses.sfx, { filter: 'bandpass', freq: 1800, q: 3, dur: 0.25, peak: 0.22 });
      });
    },
    screech() {
      const now = Date.now();
      if (now - (sfx._screechAt || 0) < 250) return true;
      sfx._screechAt = now;
      return play('screech', 2, () => {
        noiseHit(buses.sfx, { filter: 'bandpass', freq: 1150, q: 4, dur: 0.3, peak: 0.2 });
      });
    },
    collision(speedKmh) {
      const now = Date.now();
      if (now - (sfx._collisionAt || 0) < 600) return true;
      sfx._collisionAt = now;
      const k = Math.max(0.25, Math.min(1, (speedKmh || 10) / 40));
      duck();
      return play('collision', 3, () => {
        noiseHit(buses.sfx, { filter: 'lowpass', freq: 520, dur: 0.22, peak: 0.5 * k + 0.2 });
        tone(buses.sfx, { type: 'sine', freq: 75, freqEnd: 32, dur: 0.28, peak: 0.6 * k + 0.2 });
        noiseHit(buses.sfx, { at: 0.05, filter: 'bandpass', freq: 700, q: 1, dur: 0.12, peak: 0.25 * k });
      });
    },
    horn(type) {
      const low = type === 'bus' || type === 'truck' || type === 'firetruck';
      return play('horn', 2, () => {
        const f1 = low ? 220 : 370, f2 = low ? 277 : 466;
        tone(buses.sfx, { type: 'square', freq: f1, dur: 0.35, peak: 0.16 });
        tone(buses.sfx, { type: 'square', freq: f2, dur: 0.35, peak: 0.16 });
      });
    },
    footstep(surface) {
      const s = surface || 'asphalt';
      return play('footstep:' + s, 3, () => {
        if (s === 'water') {
          noiseHit(buses.sfx, { filter: 'bandpass', freq: 900, freqEnd: 350, q: 1, dur: 0.18, peak: 0.2 });
        } else if (s === 'sand') {
          noiseHit(buses.sfx, { filter: 'lowpass', freq: 350, dur: 0.09, peak: 0.22 });
        } else if (s === 'grass') {
          noiseHit(buses.sfx, { filter: 'lowpass', freq: 520, dur: 0.07, peak: 0.18 });
        } else if (s === 'sidewalk') {
          noiseHit(buses.sfx, { filter: 'bandpass', freq: 1100, q: 1, dur: 0.05, peak: 0.22 });
        } else { // asphalt
          noiseHit(buses.sfx, { filter: 'bandpass', freq: 700, q: 1, dur: 0.06, peak: 0.25 });
        }
      });
    },
    splash(strength) {
      const k = strength || 1;
      return play('splash', 2, () => {
        noiseHit(buses.sfx, { filter: 'bandpass', freq: 950, freqEnd: 300, q: 1, dur: 0.35, peak: 0.3 * k });
        tone(buses.sfx, { at: 0.1, type: 'sine', freq: 800, freqEnd: 480, dur: 0.08, peak: 0.1 * k });
      });
    },
    // Throttled: boats splash at most once per 0.9 s.
    boatSplash() {
      const now = Date.now();
      if (now - (sfx._boatAt || 0) < 900) return true;
      sfx._boatAt = now;
      return sfx.splash(0.5);
    },
    uiClick() {
      return play('uiClick', 2, () => {
        tone(buses.ui, { type: 'sine', freq: 880, dur: 0.05, peak: 0.2 });
      });
    },
    shop() {
      return play('shop', 2, () => {
        tone(buses.ui, { type: 'sine', freq: 1318, dur: 0.1, peak: 0.22 });
        tone(buses.ui, { at: 0.09, type: 'sine', freq: 1760, dur: 0.16, peak: 0.22 });
        noiseHit(buses.ui, { at: 0.02, filter: 'highpass', freq: 4000, dur: 0.08, peak: 0.1 });
      });
    },
    coin() {
      return play('coin', 2, () => {
        tone(buses.ui, { type: 'sine', freq: 1568, dur: 0.08, peak: 0.25 });
        tone(buses.ui, { at: 0.08, type: 'sine', freq: 2093, dur: 0.2, peak: 0.25 });
      });
    },
    stunt() {
      return play('stunt', 2, () => {
        noiseHit(buses.sfx, { filter: 'bandpass', freq: 400, freqEnd: 2400, q: 1.5, dur: 0.5, peak: 0.25 });
        tone(buses.sfx, { at: 0.1, type: 'sine', freq: 523, dur: 0.12, peak: 0.2 });
        tone(buses.sfx, { at: 0.22, type: 'sine', freq: 659, dur: 0.12, peak: 0.2 });
        tone(buses.sfx, { at: 0.34, type: 'sine', freq: 784, dur: 0.2, peak: 0.22 });
      });
    },
    missionBell() {
      return play('missionBell', 2, () => {
        tone(buses.ui, { type: 'sine', freq: 880, dur: 1.1, peak: 0.25 });
        tone(buses.ui, { type: 'sine', freq: 1318, dur: 0.9, peak: 0.12 });
        tone(buses.ui, { type: 'sine', freq: 1760, dur: 0.6, peak: 0.07 });
      });
    },
    missionStart() {
      sfx.missionBell();
      return play('missionStart', 2, () => {
        tone(buses.ui, { at: 0.15, type: 'triangle', freq: 523, dur: 0.15, peak: 0.2 });
        tone(buses.ui, { at: 0.3, type: 'triangle', freq: 659, dur: 0.15, peak: 0.2 });
        tone(buses.ui, { at: 0.45, type: 'triangle', freq: 784, dur: 0.25, peak: 0.22 });
      });
    },
    missionComplete() {
      sfx.coin();
      return play('missionComplete', 2, () => {
        const notes = [523, 659, 784, 1046];
        notes.forEach((f, i) => tone(buses.ui, { at: 0.12 + i * 0.13, type: 'triangle', freq: f, dur: 0.22, peak: 0.22 }));
      });
    },
    missionFail() {
      return play('missionFail', 2, () => {
        const notes = [392, 311, 233];
        notes.forEach((f, i) => tone(buses.ui, { at: i * 0.28, type: 'sine', freq: f, dur: 0.3, peak: 0.22 }));
      });
    },
    busted() {
      return play('busted', 2, () => {
        tone(buses.ui, { type: 'sawtooth', freq: 220, freqEnd: 110, dur: 0.5, peak: 0.2 });
        tone(buses.ui, { at: 0.1, type: 'sine', freq: 330, freqEnd: 165, dur: 0.45, peak: 0.18 });
      });
    },
    shipHorn() {
      return play('shipHorn', 2, () => {
        tone(buses.sfx, { type: 'sine', freq: 110, dur: 1.6, peak: 0.35, attack: 0.15 });
        tone(buses.sfx, { type: 'sine', freq: 164, dur: 1.6, peak: 0.25, attack: 0.15 });
      });
    },
    // Two low thumps (a heartbeat); the caller repeats it while in danger.
    heartbeat() {
      return play('heartbeat', 3, () => {
        tone(buses.sfx, { type: 'sine', freq: 55, dur: 0.14, peak: 0.5 });
        tone(buses.sfx, { at: 0.16, type: 'sine', freq: 50, dur: 0.12, peak: 0.35 });
      });
    },
    thunder() {
      return play('thunder', 2, () => {
        noiseHit(buses.sfx, { filter: 'lowpass', freq: 130, dur: 2.4, peak: 0.5, attack: 0.1 });
        noiseHit(buses.sfx, { at: 0.4, filter: 'lowpass', freq: 90, dur: 1.8, peak: 0.35, attack: 0.2 });
      });
    },
    bark() {
      return play('bark', 1, () => {
        tone(buses.sfx, { type: 'square', freq: 320, freqEnd: 240, dur: 0.09, peak: 0.12 });
        tone(buses.sfx, { at: 0.14, type: 'square', freq: 300, freqEnd: 230, dur: 0.09, peak: 0.1 });
      });
    },
    birdChirp() {
      return play('birdChirp', 1, () => {
        tone(buses.sfx, { type: 'sine', freq: 2800, freqEnd: 3600, dur: 0.09, peak: 0.07 });
        tone(buses.sfx, { at: 0.11, type: 'sine', freq: 3400, freqEnd: 2400, dur: 0.1, peak: 0.06 });
      });
    },
    gull() {
      return play('gull', 1, () => {
        tone(buses.sfx, { type: 'sine', freq: 1700, freqEnd: 900, dur: 0.5, peak: 0.09 });
        tone(buses.sfx, { at: 0.1, type: 'sine', freq: 1500, freqEnd: 850, dur: 0.4, peak: 0.06 });
      });
    },
    // Synthesized NPC chatter: a short vowel-like blip. Enemies are lower.
    npcVoice(enemy) {
      return play(enemy ? 'npcVoice:enemy' : 'npcVoice', 1, () => {
        const f = enemy ? 130 + Math.random() * 60 : 200 + Math.random() * 130;
        tone(buses.sfx, { type: enemy ? 'square' : 'sine', freq: f, freqEnd: f * 0.85, dur: 0.13, peak: 0.06 });
      });
    },
    busStop() {
      return play('busStop', 1, () => {
        tone(buses.sfx, { type: 'sine', freq: 880, dur: 0.16, peak: 0.14 });
        tone(buses.sfx, { at: 0.18, type: 'sine', freq: 660, dur: 0.22, peak: 0.14 });
      });
    },
    doorThud() {
      return play('doorThud', 2, () => {
        tone(buses.sfx, { type: 'sine', freq: 95, freqEnd: 55, dur: 0.1, peak: 0.3 });
      });
    },
    // Distant traffic horn (ambient, quiet).
    distantHorn() {
      return play('distantHorn', 1, () => {
        tone(buses.sfx, { type: 'square', freq: 370, dur: 0.3, peak: 0.05 });
        tone(buses.sfx, { type: 'square', freq: 466, dur: 0.3, peak: 0.05 });
      });
    },
    // Industrial metal clank.
    clank() {
      return play('clank', 1, () => {
        tone(buses.sfx, { type: 'sine', freq: 740, dur: 0.18, peak: 0.1 });
        tone(buses.sfx, { type: 'sine', freq: 1180, dur: 0.12, peak: 0.06 });
        noiseHit(buses.sfx, { filter: 'highpass', freq: 2500, dur: 0.05, peak: 0.08 });
      });
    },
    // Plane flyover whoosh (once per crossing).
    planeWhoosh() {
      return play('planeWhoosh', 1, () => {
        noiseHit(buses.sfx, { filter: 'bandpass', freq: 320, freqEnd: 900, q: 1, dur: 2.5, peak: 0.16, attack: 0.8 });
      });
    },
  };

  // --- generative music: soft tropical chord pads, day mode; a muffled,
  // jazzy set for the night bar near downtown / commercial. ---
  const DAY_CHORDS = [
    [261.6, 329.6, 392.0, 493.9], // Cmaj7
    [220.0, 261.6, 329.6, 392.0], // Am7
    [174.6, 220.0, 261.6, 329.6], // Fmaj7
    [196.0, 246.9, 293.7, 349.2], // G7
  ];
  const BAR_CHORDS = [
    [293.7, 349.2, 440.0, 523.3], // Dm7
    [196.0, 246.9, 293.7, 349.2], // G7
    [261.6, 329.6, 392.0, 493.9], // Cmaj7
    [220.0, 277.2, 329.6, 392.0], // A7
  ];

  function scheduleChord(mode) {
    if (!ctx || !buses) return;
    if (musicVoices.size >= MAX_MUSIC_VOICES) { nextChordAt = ctx.currentTime + 1; return; }
    const chords = mode === 'bar' ? BAR_CHORDS : DAY_CHORDS;
    const chord = chords[chordIdx % chords.length];
    chordIdx++;
    const t0 = ctx.currentTime + 0.05;
    const peak = mode === 'bar' ? 0.028 : 0.042;
    for (const f of chord) {
      tone(buses.music, { type: 'triangle', freq: f, dur: 5.2, peak, attack: 1.4, priority: 1, music: true });
    }
    // Soft bass root, one octave below the chord root.
    tone(buses.music, { type: 'sine', freq: chord[0] / 2, dur: 5.2, peak: peak * 1.1, attack: 1.2, priority: 1, music: true });
    nextChordAt = ctx.currentTime + 4.2;
  }

  function setLoopGain(node, target) {
    if (!ctx || !node) return;
    try { node.gain.setTargetAtTime(Math.max(0, target), ctx.currentTime, 0.6); } catch { /* ignore */ }
  }

  // Per-frame update: ambience crossfades, loops, engine, siren, music,
  // footsteps, random wildlife / street events. `s` carries the world state;
  // every field is optional (tests call update with partial state).
  function update(dt, s = {}) {
    const x = s.x || 0, z = s.z || 0;
    const timeHours = typeof s.timeHours === 'number' ? s.timeHours : 12;
    const isNight = timeHours < 6 || timeHours >= 18;
    const area = areaFor(x, z);
    lastArea = area;
    lastMode = isNight ? 'night' : 'day';
    const rain = Math.max(0, Math.min(1, s.rain || 0));
    const speedKmh = s.speedKmh || 0;
    const speedRatio = Math.max(0, Math.min(1, speedKmh / 100));

    // --- footsteps on foot (cadence from distance walked) ---
    if (s.onFoot && s.moving && speedKmh > 1) {
      stepAccum += (speedKmh / 3.6) * dt;
      const stride = speedKmh > 20 ? 2.6 : 2.0; // run vs walk
      if (stepAccum >= stride) {
        stepAccum = 0;
        const surf = s.inWater ? 'water' : surfaceAt(x, z);
        sfx.footstep(surf);
      }
    } else {
      stepAccum = 0;
    }

    if (!ctx || !loops) return; // counted-only mode: triggers still counted

    // --- ambience weights by area (crossfaded by the gain smoothing) ---
    const w = { waves: 0, wind: 0, traffic: 0, murmur: 0, mach: 0, birds: 0, crickets: 0, echo: 0 };
    if (area === 'beach') { w.waves = 1; w.birds = 0.35; w.wind = 0.3; }
    else if (area === 'port') { w.mach = 1; w.waves = 0.35; w.traffic = 0.3; w.birds = 0.25; }
    else if (area === 'downtown') { w.traffic = 1; w.murmur = 0.35; }
    else if (area === 'commercial') { w.murmur = 0.6; w.traffic = 0.6; }
    else if (area === 'residential') { w.birds = 0.8; w.traffic = 0.15; }
    else if (area === 'forest') { w.wind = 1; w.birds = 1; w.crickets = isNight ? 1 : 0.3; }
    else if (area === 'river') { w.waves = 0.25; w.birds = 0.5; w.wind = 0.3; }
    else if (area === 'market') { w.murmur = 1; w.traffic = 0.3; w.echo = 0.5; }
    if (isNight) {
      w.crickets = Math.max(w.crickets, area === 'residential' ? 0.7 : area === 'beach' ? 0.5 : 0.25);
      w.birds = w.birds * 0.15; // birds sleep; crickets take over
    }
    setLoopGain(loops.waves.gain, w.waves * 0.5);
    setLoopGain(loops.wind.gain, w.wind * 0.4);
    setLoopGain(loops.traffic.gain, w.traffic * 0.32);
    setLoopGain(loops.murmur.gain, w.murmur * 0.3);
    setLoopGain(loops.echoGain, w.echo * 0.3);
    setLoopGain(loops.mach.gain, w.mach * 0.16);
    setLoopGain(loops.machNoise.gain, w.mach * 0.2);
    setLoopGain(loops.crickets.gain, w.crickets * 0.05);
    setLoopGain(loops.rain.gain, rain * 0.5);

    // --- player vehicle engine (pitch follows speed + type) ---
    if (s.driving && s.vehicleType !== 'sailboat') {
      const base = engineBaseFreq(s.vehicleType || 'car');
      const freq = base * (0.75 + 0.9 * speedRatio);
      try {
        loops.engine.osc.frequency.setTargetAtTime(freq, ctx.currentTime, 0.1);
        loops.engineFilter.frequency.setTargetAtTime(500 + 900 * speedRatio, ctx.currentTime, 0.1);
      } catch { /* ignore */ }
      setLoopGain(loops.engine.gain, 0.1 + 0.1 * speedRatio);
    } else {
      setLoopGain(loops.engine.gain, 0);
    }

    // --- police siren: louder the closer the nearest police car is ---
    const wanted = s.wanted || 0;
    let sirenTarget = 0;
    if (wanted > 0) {
      const d = typeof s.policeDist === 'number' ? s.policeDist : 120;
      sirenTarget = Math.max(0.1, Math.min(0.6, 0.85 - d / 220));
    }
    setLoopGain(loops.siren.gain, sirenTarget);

    // --- helicopter rotor: audible when the heli is near ---
    let heliTarget = 0;
    if (typeof s.heliX === 'number') {
      const d = Math.hypot(s.heliX - x, s.heliZ - z);
      heliTarget = Math.max(0, Math.min(0.35, 0.5 - d / 500));
    }
    setLoopGain(loops.heli.gain, heliTarget);

    // --- plane flyover whoosh (once per crossing) ---
    if (s.planeActive && !prevPlaneActive) sfx.planeWhoosh();
    prevPlaneActive = !!s.planeActive;

    // --- danger heartbeat: wanted 3 with police close (no health system
    // exists yet, so high-danger stands in for low health) ---
    if (wanted >= 3 && typeof s.policeDist === 'number' && s.policeDist < 40) {
      heartT += dt;
      if (heartT > 0.9) { heartT = 0; sfx.heartbeat(); }
    }

    // --- thunder during rain ---
    if (rain > 0.5) {
      thunderTimer -= dt;
      if (thunderTimer <= 0) {
        thunderTimer = 14 + Math.random() * 18;
        sfx.thunder();
      }
    }

    // --- random wildlife / street events (gated by the area weights) ---
    const tick = (key, range, weight, fn) => {
      timers[key] -= dt;
      if (timers[key] <= 0) {
        timers[key] = range[0] + Math.random() * (range[1] - range[0]);
        if (weight > 0.25) fn();
      }
    };
    tick('gull', [6, 14], w.waves, () => sfx.gull());
    tick('bird', [3, 8], w.birds, () => sfx.birdChirp());
    tick('bark', [15, 40], area === 'residential' ? 1 : 0, () => sfx.bark());
    tick('horn', [10, 25], w.traffic, () => sfx.distantHorn());
    tick('clank', [8, 20], w.mach, () => sfx.clank());
    tick('npc', [4, 10], w.murmur + (area === 'downtown' ? 0.4 : 0), () =>
      sfx.npcVoice(wanted >= 2 && Math.random() < 0.3));

    // --- music: next chord when due; bar mode at night near downtown ---
    const barMode = isNight && (area === 'downtown' || area === 'commercial');
    const mode = barMode ? 'bar' : 'day';
    if (ctx.currentTime >= nextChordAt) scheduleChord(mode);
    setBusGain(buses.music, volumes.music * (Date.now() < duckUntilMs ? 0.3 : 1) * (mode === 'bar' ? 0.55 : 1));
  }

  function debugStats() {
    return {
      counts: { ...debug.counts },
      active: sfxVoices.size + musicVoices.size,
      dropped: debug.dropped,
      ctxState: ctx ? ctx.state : 'none',
      volumes: { ...volumes },
      area: lastArea,
      mode: lastMode,
    };
  }

  return {
    // lifecycle
    unlock, update, debugStats,
    // volumes
    volumes,
    setVolume, setMuted,
    get muted() { return volumes.muted; },
    get ctxState() { return ctx ? ctx.state : 'none'; },
    // classification (pure, used by the game + tests)
    areaFor, surfaceAt,
    // one-shot SFX (also reachable as audio.sfx.*)
    ...sfx,
    sfx,
  };
}

// --- settings UI (DOM only; no-op in Node) ---
// A small Audio button bottom-left + a panel with the five volume sliders
// and a saved mute toggle. All labels in English.
export function createSettingsUI(audio) {
  if (typeof document === 'undefined') return null;
  const btn = document.createElement('button');
  btn.id = 'audio-settings-btn';
  btn.textContent = 'Audio';
  btn.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:30;background:rgba(0,0,0,.55);color:#fff;border:1px solid rgba(255,255,255,.5);border-radius:6px;padding:6px 12px;font:14px system-ui,sans-serif;cursor:pointer;';
  const panel = document.createElement('div');
  panel.id = 'audio-settings';
  panel.style.cssText = 'position:fixed;left:12px;bottom:52px;z-index:30;background:rgba(10,16,26,.92);color:#fff;border:1px solid rgba(255,255,255,.35);border-radius:8px;padding:12px 14px;font:14px system-ui,sans-serif;display:none;width:230px;';
  const rows = [
    ['master', 'Master'], ['music', 'Music'], ['effects', 'Effects'],
    ['ambience', 'Ambience'], ['ui', 'Interface'],
  ];
  let html = '<div style="font-weight:700;margin-bottom:8px;">Audio Settings</div>';
  for (const [key, label] of rows) {
    html += '<label style="display:flex;align-items:center;gap:8px;margin:6px 0;">'
      + '<span style="width:74px;">' + label + '</span>'
      + '<input type="range" min="0" max="100" value="' + Math.round(audio.volumes[key] * 100)
      + '" data-vol="' + key + '" style="flex:1;">'
      + '<span data-vol-val="' + key + '" style="width:34px;text-align:right;">' + Math.round(audio.volumes[key] * 100) + '</span>'
      + '</label>';
  }
  html += '<label style="display:flex;align-items:center;gap:8px;margin:10px 0 4px;">'
    + '<input type="checkbox" data-mute' + (audio.muted ? ' checked' : '') + '> Mute all'
    + '</label>'
    + '<button data-close style="margin-top:8px;background:#e8a13a;color:#201503;border:0;border-radius:6px;padding:6px 14px;font-weight:700;cursor:pointer;">Close</button>';
  panel.innerHTML = html;
  panel.querySelectorAll('[data-vol]').forEach((input) => {
    input.addEventListener('input', () => {
      const key = input.getAttribute('data-vol');
      audio.setVolume(key, Number(input.value) / 100);
      const val = panel.querySelector('[data-vol-val="' + key + '"]');
      if (val) val.textContent = input.value;
    });
  });
  const muteBox = panel.querySelector('[data-mute]');
  if (muteBox) {
    muteBox.addEventListener('change', () => {
      audio.setMuted(muteBox.checked);
      audio.uiClick();
    });
  }
  const closeBtn = panel.querySelector('[data-close]');
  if (closeBtn) closeBtn.addEventListener('click', () => { panel.style.display = 'none'; });
  btn.addEventListener('click', () => {
    // Re-sync the mute box on every open: mute can change through the API
    // or a saved setting, and the box was only set once at creation.
    if (muteBox) muteBox.checked = audio.muted;
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    audio.uiClick();
  });
  document.body.appendChild(btn);
  document.body.appendChild(panel);
  return { btn, panel };
}
