// Token Radar, model radar-2: a Node 22 program that uses only the standard library.
//
// It reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>), scores every
// pre-token protocol that clears the watchlist's exclusion rule with the comparables model in
// lib/model.ts, writes the ranked board to /output/board.json, and copies this repository's
// dashboard/ and screenshots/ into /output. Last it writes /output/dossier.json, the summary the
// judge reads, with the vendored make.fun library.
//
// The dashboard is a static page, no framework and no network: dashboard/index.html,
// dashboard/app.css and dashboard/app.js read /output/data.js, which this program writes from the
// same board. The page recomputes every row's implied value from the snapshot figures and checks
// the number board.json carries, so the screenshots and the code agree.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync as statFile, writeFileSync } from 'node:fs';
import { join as joinPath } from 'node:path';
import { fileURLToPath as fileUrlToPath } from 'node:url';
import { boardProblem, buildRadarData, dataJs, readSnapshot } from './lib/model.ts';
import { buildDossier as buildDossierFile } from './vendor/makefun-board.ts';

const repoRoot = fileUrlToPath(new URL('.', import.meta.url));

/** The scorer's own limits: only the text cap shapes the bytes, the rest refuse. */
const TEXT_LIMIT = 65536;
const SHOT_LIMITS = { max: 4, max_bytes: 524288 };
const IMAGE_FILENAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** The --name <value> flag's value from the arguments, or the fallback. */
function flagValue(flag: string, fallback: string): string {
  const idx = process.argv.indexOf(`--${flag}`);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1]!;
  const equalsForm = process.argv.find((a) => a.startsWith(`--${flag}=`));
  return equalsForm === undefined ? fallback : equalsForm.slice(flag.length + 3);
}

const inputParam = flagValue('input', '/input');
const inputPath = inputParam.endsWith('.json') ? inputParam : joinPath(inputParam, 'snapshot.json');
if (!existsSync(inputPath)) {
  process.stderr.write(`token radar: no snapshot at ${inputPath}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2); // no snapshot found
}
const outDir = flagValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snap = readSnapshot(readFileSync(inputPath, 'utf8'));
const { board: ranked, radar: radarData } = buildRadarData(snap);
const problem = boardProblem(ranked, snap);
if (problem !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${problem}\n`);
  process.exit(1); // the board failed the gate
}

mkdirSync(outDir, { recursive: true });
writeFileSync(joinPath(outDir, 'board.json'), `${JSON.stringify({ rows: ranked })}\n`);
writeFileSync(joinPath(outDir, 'data.js'), dataJs(radarData));

/** One directory's regular files, copied into `to`, skipping names that start with a dot. */
function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) {
    return [];
  }
  mkdirSync(to, { recursive: true }); // the target may not exist yet
  const names: string[] = [];
  for (const entry of readdirSync(from)) {
    if (entry.startsWith('.')) continue;
    const path = joinPath(from, entry);
    if (!statFile(path).isFile()) continue;
    copyFileSync(path, joinPath(to, entry));
    names.push(entry);
  }
  return names;
}

copyDir(joinPath(repoRoot, 'dashboard'), joinPath(outDir, 'dashboard'));
const images = copyDir(joinPath(repoRoot, 'screenshots'), joinPath(outDir, 'screenshots'));
if (images.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${images.length} image${images.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1); // fewer than three screenshots
}
for (const file of images) {
  if (!IMAGE_FILENAME.test(file)) {
    process.stderr.write(`token radar: screenshots/${file}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1); // a screenshot's name is not a dossier name
  }
}

// The dossier goes last: the scorer rebuilds it from this /output and compares the bytes.
writeFileSync(joinPath(outDir, 'dossier.json'), buildDossierFile(outDir, { text_max_bytes: TEXT_LIMIT, screenshots: SHOT_LIMITS, dashboard: { max_files: 400, max_bytes: 4194304 } }));

process.stdout.write(
  `token radar: ${snap.protocols.length} protocols, ${snap.watchlist.length} on the watchlist, ${ranked.length} rows scored (${radarData.early_size} early, ${radarData.live_size} live set aside)\n` +
    `token radar: wrote ${joinPath(outDir, 'board.json')}, ${joinPath(outDir, 'data.js')}, ${joinPath(outDir, 'dashboard')} (3 files), ${joinPath(outDir, 'screenshots')} (${images.length} images) and ${joinPath(outDir, 'dossier.json')}\n`,
);
