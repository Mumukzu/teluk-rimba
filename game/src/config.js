// Teluk Rimba — tuning numbers in one place (speeds, camera, day length).
export const STEP = 1 / 60; // fixed simulation step (s)
export const DAY_LENGTH = 480; // full day-night cycle, seconds (~8 minutes)
export const PLAYER = {
  walkSpeed: 5,
  runSpeed: 9,
  radius: 0.6,
  height: 1.8,
};
export const CAMERA = {
  distance: 7.5,
  height: 3.2,
  minDistance: 4,
  maxDistance: 16,
};
export const WORLD = {
  bound: 650, // player clamp (city + beach edge)
  seaX: 640, // walking into the sea stops here
};
export const MONEY_START = 0;
export const START_TIME = 10; // 10:00, morning
export const START_POS = { x: 0, z: 120 }; // on main road x=0, facing downtown
