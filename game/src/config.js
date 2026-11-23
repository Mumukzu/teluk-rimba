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
export const START_POS = { x: 7.5, z: 120 }; // on the sidewalk beside main road x=0 (asphalt ends at 6 m, plots at 9 m), facing downtown

// Vehicle tuning: max speed (m/s), acceleration, turn rate. Motorbike is
// the main vehicle; scooter is its own slower, step-through type.
export const VEHICLES = {
  motorbike: { maxSpeed: 24, accel: 16, turn: 2.6, len: 2.0, w: 0.7 },
  scooter: { maxSpeed: 17, accel: 11, turn: 2.4, len: 1.9, w: 0.7 },
  bajaj: { maxSpeed: 13, accel: 8, turn: 1.9, len: 2.4, w: 1.3 },
  car: { maxSpeed: 21, accel: 11, turn: 1.7, len: 3.6, w: 1.7 },
  sedan: { maxSpeed: 25, accel: 13, turn: 1.7, len: 4.4, w: 1.8 },
  mpv: { maxSpeed: 22, accel: 11, turn: 1.6, len: 4.5, w: 1.85 },
  jeep: { maxSpeed: 23, accel: 12, turn: 1.7, len: 4.2, w: 1.9 },
  angkot: { maxSpeed: 19, accel: 10, turn: 1.6, len: 4.0, w: 1.8 },
  bus: { maxSpeed: 18, accel: 7, turn: 1.1, len: 9.0, w: 2.5 },
  truck: { maxSpeed: 18, accel: 8, turn: 1.2, len: 7.0, w: 2.4 },
  firetruck: { maxSpeed: 21, accel: 9, turn: 1.2, len: 7.5, w: 2.5 },
  ambulance: { maxSpeed: 24, accel: 12, turn: 1.5, len: 5.2, w: 2.0 },
  police: { maxSpeed: 27, accel: 15, turn: 1.9, len: 4.4, w: 1.85 },
  supercar: { maxSpeed: 32, accel: 18, turn: 2.0, len: 4.3, w: 2.0 },
  boat: { maxSpeed: 15, accel: 8, turn: 1.4, len: 6.0, w: 2.2 },
  fishingboat: { maxSpeed: 9, accel: 5, turn: 1.0, len: 7.0, w: 2.6 },
  sailboat: { maxSpeed: 7, accel: 4, turn: 0.9, len: 4.5, w: 1.8 },
};
export const TRAFFIC_COUNT = 224; // moving road vehicles (dense on main roads)
export const PARKED_COUNT = 24;
export const PED_COUNT = 2000; // Mu: 2000 NPCs, spread over every zone (was 300)
export const CULL_DIST = 160; // hide far peds/vehicles (rendered only)
