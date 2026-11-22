// Teluk Rimba — screenshot + test modes, driven by URL parameters.
//   ?shot=day|night   set the time of day (12:00 / 21:30)
//   &hud=0            hide the HUD (for clean screenshots)
//   &cam=aerial       high camera over the whole city (aerial shot)
//   &cam=street       street-level camera near downtown
//   &camPos=x,y,z &camLook=x,y,z  free camera (test/screenshot only)
//   &spawn=x,z        start the player at a test location
//   &timeScale=N      speed up the clock and timers (tests only)
//   &sim=1            headless fast-sim: no rendering, logic ticks only
// Nothing here runs in normal play: plain ? with no params is the real game.
export function parseShotParams() {
  const p = new URLSearchParams(window.location.search);
  const spawn = p.get('spawn');
  let spawnPos = null;
  if (spawn) {
    const [x, z] = spawn.split(',').map(Number);
    if (Number.isFinite(x) && Number.isFinite(z)) spawnPos = { x, z };
  }
  const camPos = p.get('camPos');
  let camPosVec = null;
  if (camPos) {
    const [x, y, z] = camPos.split(',').map(Number);
    if ([x, y, z].every(Number.isFinite)) camPosVec = [x, y, z];
  }
  const camLook = p.get('camLook');
  let camLookVec = null;
  if (camLook) {
    const [x, y, z] = camLook.split(',').map(Number);
    if ([x, y, z].every(Number.isFinite)) camLookVec = [x, y, z];
  }
  return {
    shot: p.get('shot'), // 'day' | 'night' | null
    hud: p.get('hud') !== '0',
    cam: p.get('cam'), // 'aerial' | 'street' | null
    camPos: camPosVec,
    camLook: camLookVec,
    spawn: spawnPos,
    timeScale: Math.max(0.1, Math.min(100, Number(p.get('timeScale')) || 1)),
    sim: p.get('sim') === '1',
    seed: Number.parseInt(p.get('seed') ?? '', 10) || 20261122,
    drive: p.get('drive'), // test-only: start driving a vehicle type
    wanted: Math.max(0, Math.min(3, Number(p.get('wanted')) || 0)), // test-only
    weather: p.get('weather'), // test-only: 'rain' | 'wet' | 'clear'
  };
}

export function timeForShot(shot, fallbackHours) {
  if (shot === 'day') return 12;
  if (shot === 'night') return 21.5;
  return fallbackHours;
}
