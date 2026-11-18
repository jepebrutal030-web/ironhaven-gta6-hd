// IRONHAVEN — gta6-01 entrypoint: builds dossier.json from game/ + screenshots/.
// Run: node main.ts [output-path]   (defaults to ./dossier.json)
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { buildDossier } from './vendor/makefun-game.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] ? resolve(process.cwd(), process.argv[2]) : join(dir, 'dossier.json');
const bytes = buildDossier(dir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
});
writeFileSync(out, bytes);
console.log(`dossier: ${bytes.length} bytes -> ${out}`);
