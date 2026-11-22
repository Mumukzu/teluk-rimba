# Teluk Rimba

[![make.fun](https://make.fun/badge/gta6-01.svg)](https://make.fun)
[![rank](https://make.fun/badge/gta6-01/Mumukzu/teluk-rimba/rank.svg)](https://make.fun)
[![reward](https://make.fun/badge/gta6-01/Mumukzu/teluk-rimba/reward.svg)](https://make.fun)

**Teluk Rimba** is an open-world crime game set in a fictional tropical port
city, built for the [make.fun](https://make.fun) **gta6-01 "Make GTA 6"**
bounty. A volcano with dense forest rises behind the city, a river runs from
the mountain through the centre to the sea, and the beach glows blue in front.

## The city

- **Exactly 1,000 buildings** — downtown towers in the centre, lower towards
  the edges; commercial, residential, beachfront, port/industrial and forest
  zones, each with its own style.
- **One shared dataset** drives buildings, roads, markings, traffic and the
  minimap, so everything always matches. An automated test
  (`node tests/connectivity.test.mjs`) fails if any part of the road graph is
  disconnected.
- Generous tidy roads: main roads are two lanes each way, small roads one
  lane, with wide sidewalks. Trees, lamps and traffic lights stand on the
  kerb-side strip, never on asphalt. Thin dashed markings, one zebra crossing
  per intersection, nothing else scribbled in them.
- ~8-minute day-night cycle, full map, minimap, settings with volume, start
  screen that enables audio, short intro hints.

## Playing

- **6 story missions** — parcel delivery on a scooter, a night black market,
  a forest-road chase, a glass tower downtown, a night port escape by boat,
  and a final mission on the mountain road. Each has fail conditions and
  rewards, saved across sessions.
- **Shop** at the market: weapons + ammo, medkits + armor, energy drinks,
  vehicle repair. Money comes from missions; rank unlocks new items.
- **Extras**: 12 hidden coins, 4 stunt jumps, 3 courier jobs.
- **Traffic & people**: motorbikes, small cars, angkot, bajaj, trucks and
  boats; 200+ pedestrians who walk the sidewalks, cross at zebras and flee
  when shots are fired; police with a 3-star wanted level.

## Controls

| Key | Action |
| --- | --- |
| W A S D / arrows | Walk |
| Shift | Run |
| Drag mouse | Orbit camera |
| Mouse wheel | Zoom camera |
| P / Esc | Pause |

## Run it

```sh
node serve.ts          # http://localhost:8080
node tests/connectivity.test.mjs   # city connectivity + building checks
```

No build step, no network at runtime — the game is plain static files and a
hand-written WebGL2 renderer (no external library).

## Test modes (tests only, off in normal play)

- `?sim=1` — headless fast-sim: logic ticks, no rendering
- `?shot=day|night` — fixed time of day
- `&hud=0` — hide the HUD for clean screenshots
- `&cam=aerial|street` — fixed camera
- `&spawn=x,z` — start position for tests
- `&timeScale=N` — faster clock and timers

## License

MIT — see [LICENSE](LICENSE).
