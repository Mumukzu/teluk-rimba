// Teluk Rimba — the entry program (Node 22, standard library only).
// It hands the game in: copies game/ and screenshots/ from beside this file
// into /output and writes /output/dossier.json with the vendored make.fun
// library, then refuses loudly if the result would break the scorer's caps
// (too many files, game/ too big, a screenshot too big or too many of them).
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Play it locally first with: node serve.ts  (http://localhost:8080)

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

function countTree(dir) {
  let files = 0, bytes = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = countTree(full);
      files += sub.files + 1; bytes += sub.bytes;
    } else if (entry.isFile()) {
      files += 1; bytes += statSync(full).size;
    }
  }
  return { files, bytes };
}

function fail(message) {
  console.error('main.ts: ' + message);
  process.exit(1);
}

const gameDir = join(repoRoot, 'game');
const shotsDir = join(repoRoot, 'screenshots');
if (!existsSync(gameDir)) fail('game/ is missing');
const gameSize = countTree(gameDir);
if (gameSize.files > 993) fail(`game/: ${gameSize.files} files, max 993`);
if (gameSize.bytes > 48 * 1024 * 1024) fail(`game/: ${gameSize.bytes} bytes, max 48 MiB`);
const indexSize = statSync(join(gameDir, 'index.html')).size;
if (indexSize > 1024 * 1024) fail(`game/index.html: ${indexSize} bytes, max 1 MiB`);

const shots = existsSync(shotsDir)
  ? readdirSync(shotsDir).filter((n) => !n.startsWith('.'))
  : [];
if (shots.length > 4) fail(`screenshots/: ${shots.length} shots, max 4`);
for (const name of shots) {
  const size = statSync(join(shotsDir, name)).size;
  if (size > 256 * 1024) fail(`screenshots/${name}: ${size} bytes, max 256 KiB`);
}

mkdirSync(outDir, { recursive: true });
cpSync(gameDir, join(outDir, 'game'), { recursive: true });
mkdirSync(join(outDir, 'screenshots'), { recursive: true });
if (existsSync(shotsDir)) cpSync(shotsDir, join(outDir, 'screenshots'), { recursive: true });

writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);

const outSize = countTree(outDir);
console.log(`Teluk Rimba handed in: game/ ${gameSize.files} files, ${(gameSize.bytes / 1048576).toFixed(2)} MiB; ${shots.length} screenshot(s); /output ${outSize.files} entries, ${(outSize.bytes / 1048576).toFixed(2)} MiB`);
