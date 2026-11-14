// make.fun's dashboard-dossier library for Node 22: a single file on the Node standard library
// only, in erasable TypeScript, so it runs as-is under `node main.ts` with no flags, no build and
// no install. Copy it to vendor/makefun-board.ts in your repository (a copy anywhere else counts
// as lines you wrote) and import it:
//
//   import { buildDossier as buildDossierFile } from './vendor/makefun-board.ts';
//   writeFileSync('/output/dossier.json', buildDossierFile('/output', { text_max_bytes: 65536, screenshots: { max: 4, max_bytes: 524288 }, dashboard: { max_files: 400, max_bytes: 4194304 } }));
//
// The bounty's scorer runs this same file, byte for byte, on what you hand in, and requires your
// dossier.json to equal what buildDossier writes from your dashboard/ and screenshots/.
//
//   buildDossier(dir, caps)  the dossier (makefun/dossier/v1) of a dashboard directory, as canonical
//                            JSON bytes: the screenshots plus a text of the page's source
//
// A dossier is one JSON object (contracts/dossier.ts):
//
//   schema   "makefun/dossier/v1"
//   cover    0: the first screenshot by name is the cover
//   images   the PNG and JPEG files in dir/screenshots/ (names starting with '.' skipped), in name
//            order, each {name, media_type, sha256, base64}
//   text     what the judge reads: a "## Dashboard" block (the file count, the bytes, and every file's
//            path with its size), then "## Source", each text file's path, size and line count and its
//            contents in a fenced block by path, every file by path
//
// The text holds at most caps.text_max_bytes UTF-8 bytes: every file that fits goes in whole, in path
// order; the first that does not goes in up to its last complete line that fits (its fence closed, then
// a line naming how many of its lines are not shown), or not at all when not one line fits; nothing
// follows it but a last line naming how many whole files and how many bytes were left out. A file whose
// extension is not one of .html .css .js .json .mjs .svg .md .txt is named in the Dashboard block and
// not shown: the text is source, and the page's images are not source.
//
// buildDossier refuses (DossierError) an empty screenshots/ directory, a screenshot name a dossier
// refuses, a screenshot that is not a whole PNG or JPEG, a screenshot past its byte cap or more
// screenshots than the count cap, a dashboard file that is not plain (a link, a dot-directory, a name
// that is not letters, digits and . _ -, a file past its byte cap or more files than the count cap),
// a text cap that cannot hold the Dashboard block and the cut line, and a dossier past DOSSIER_MAX_BYTES.
// The caps only refuse: they never shape the bytes. Only text_max_bytes shapes them, so a program that
// passes {text_max_bytes} and writes the result has written what the scorer, given its other caps too,
// compares byte for byte.

import { createHash as makeHash } from 'node:crypto';
import { closeSync, constants as fsConstants, fstatSync, lstatSync, openSync, readdirSync, readSync } from 'node:fs';
import { join as joinPath } from 'node:path';

/** The dossier schema buildDossier writes (contracts/dossier.ts DOSSIER_SCHEMA). */
export const DOSSIER_SCHEMA = 'makefun/dossier/v1';
/** The most bytes a dossier holds (contracts/dossier.ts DOSSIER_MAX_BYTES): 4 MiB. */
export const DOSSIER_MAX_BYTES = 4 * 1024 * 1024;
/** The most images a dossier holds (contracts/dossier.ts DOSSIER_MAX_IMAGES). */
export const DOSSIER_MAX_IMAGES = 8;
/** A plain file's name (contracts/dossier.ts DossierImageName): a letter, digit or _ first, then letters, digits and . _ -, 1 to 128 of them, no directory. */
export const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
/** A dashboard file whose contents the dossier's text shows: source, never an image. */
export const TEXT_FILE = /\.(?:html|css|js|json|mjs|svg|md|txt)$/;

/** What buildDossier is held to: the text's cap in UTF-8 bytes, and, when given, the screenshot and dashboard caps, which only refuse. */
export interface DossierCaps {
  text_max_bytes: number;
  screenshots?: {
    max: number;
    max_bytes: number;
  };
  dashboard?: {
    max_files: number;
    max_bytes: number;
  };
}

/** Why buildDossier writes no dossier for a directory: its caps, its screenshots, its dashboard or its size. */
export class DossierError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DossierError';
  }
}

// ---------------------------------------------------------------- bytes

const sha256Of = (data: Uint8Array): string => makeHash('sha256').update(data).digest('hex');
const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const utf8Length = (s: string): number => Buffer.byteLength(s, 'utf8');

const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_HEADER = [0xff, 0xd8, 0xff];

const startsWithBytes = (data: Uint8Array, magic: readonly number[]): boolean => data.length >= magic.length && magic.every((b, i) => data[i] === b);

/**
 * A regular file's bytes when it is at most `cap` long; never through a link, never more than `cap`
 * bytes read. A link, a directory or a missing file is a DossierError with `what`.
 */
function readUpTo(path: string, cap: number, what: string): Uint8Array {
  let size: number;
  try {
    const stat = lstatSync(path);
    if (!stat.isFile()) throw new DossierError(`buildDossier: ${what} is not a regular file`);
    size = stat.size;
  } catch (err) {
    if (err instanceof DossierError) throw err;
    throw new DossierError(`buildDossier: ${what} cannot be read`);
  }
  if (size > cap) throw new DossierError(`buildDossier: ${what} is ${size} bytes, over the ${cap} a dossier reads`);
  let handle: number;
  try {
    handle = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch {
    throw new DossierError(`buildDossier: ${what} is not a regular file`);
  }
  try {
    const current = fstatSync(handle).size;
    if (current > cap) throw new DossierError(`buildDossier: ${what} is ${current} bytes, over the ${cap} a dossier reads`);
    const buffer = Buffer.alloc(current);
    let offset = 0;
    while (offset < buffer.length) {
      const read = readSync(handle, buffer, offset, buffer.length - offset, offset);
      if (read === 0) break;
      offset += read;
    }
    return new Uint8Array(buffer.buffer, buffer.byteOffset, offset);
  } finally {
    closeSync(handle);
  }
}

/** Lines of a text: 0 when empty, else its newlines plus one for a last line with none. */
function countLines(data: Uint8Array): number {
  if (data.length === 0) return 0;
  let count = 0;
  for (const byte of data) if (byte === 0x0a) count++;
  return data[data.length - 1] === 0x0a ? count : count + 1;
}

/** A Markdown fence one backtick longer than the longest run in `text`, three at least. */
function fenceLengthFor(text: string): string {
  let maxRun = 0;
  for (const ticks of text.match(/`+/g) ?? []) maxRun = Math.max(maxRun, ticks.length);
  return '`'.repeat(Math.max(3, maxRun + 1));
}

/** The fence a file's extension is shown with. */
function fenceLanguageOf(path: string): string {
  const suffix = path.slice(path.lastIndexOf('.') + 1);
  return suffix === 'mjs' ? 'js' : suffix;
}

/**
 * JSON with every object's keys in code-unit order and no whitespace: one spelling per value. Takes
 * null, booleans, finite numbers, strings, arrays and plain objects; throws TypeError on anything else
 * (undefined, a function, a bigint, NaN, Infinity, a class instance).
 */
export function canonicalJson(input: unknown): string {
  if (input === null || typeof input === 'boolean' || typeof input === 'string') return JSON.stringify(input);
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new TypeError(`canonicalJson: ${input} is not a finite number`);
    return JSON.stringify(input);
  }
  if (Array.isArray(input)) return `[${input.map((item) => canonicalJson(item)).join(',')}]`;
  if (typeof input === 'object') {
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError('canonicalJson: only plain objects and arrays');
    const obj = input as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort(compareStrings)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(obj[key])}`)
      .join(',')}}`;
  }
  throw new TypeError(`canonicalJson: a ${typeof input} has no JSON form`);
}

// ---------------------------------------------------------------- the dashboard walk

/** One file of the dashboard tree: its path relative to the directory, and its size in bytes. */
interface DashboardFile {
  path: string;
  size: number;
}

/**
 * Every regular file under `root` (symbolic links are neither followed nor taken for files), in path
 * order, with its size. Refuses a dot-directory, a file whose name a dossier refuses, an entry that is
 * neither a file nor a directory, and, when the caps are given, too many files or bytes in all.
 */
function walkDashboard(root: string, limits: { max_files: number; max_bytes: number } | null): DashboardFile[] {
  let stat: import('node:fs').Stats;
  try {
    stat = lstatSync(root);
  } catch {
    throw new DossierError('buildDossier: no dashboard/ directory: the page and its source are what the judge reads');
  }
  if (!stat.isDirectory()) throw new DossierError('buildDossier: dashboard is not a directory');
  const found: DashboardFile[] = [];
  let totalBytes = 0;
  const pending: string[] = [''];
  while (pending.length > 0) {
    const prefix = pending.pop()!;
    for (const entry of readdirSync(prefix === '' ? root : joinPath(root, prefix), { withFileTypes: true })) {
      const childPath = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) throw new DossierError(`buildDossier: dashboard/${childPath} is a dot-directory`);
        pending.push(childPath);
      } else if (entry.isFile()) {
        if (!PLAIN_NAME.test(entry.name)) throw new DossierError(`buildDossier: dashboard/${childPath}: a file's name is letters, digits and . _ -, 1 to 128 characters, not starting with . or -`);
        const fileSize = lstatSync(joinPath(root, childPath)).size;
        found.push({ path: childPath, size: fileSize });
        totalBytes += fileSize;
        if (limits !== null && found.length > limits.max_files) throw new DossierError(`buildDossier: dashboard/ holds more than the ${limits.max_files} files it may`);
        if (limits !== null && totalBytes > limits.max_bytes) throw new DossierError(`buildDossier: dashboard/'s files come to more than the ${limits.max_bytes} bytes they may`);
      } else {
        throw new DossierError(`buildDossier: dashboard/${childPath} is neither a file nor a directory`);
      }
    }
  }
  return found.sort((a, b) => compareStrings(a.path, b.path));
}

// ---------------------------------------------------------------- the dossier

/**
 * The dossier (makefun/dossier/v1, contracts/dossier.ts) of a dashboard directory, as canonical JSON
 * bytes: `dir/screenshots/`'s PNG and JPEG files (names starting with '.' skipped) are its images, the
 * first the cover; its text is the "## Dashboard" block and the "## Source" sections described above,
 * capped at `limits.text_max_bytes` UTF-8 bytes with the cut rule above. Throws DossierError on caps it
 * cannot keep and on a dashboard or screenshots directory it refuses (see the header).
 */
export function buildDossier(dir: string, limits: DossierCaps): Uint8Array {
  const textCap = limits.text_max_bytes;
  if (!Number.isSafeInteger(textCap) || textCap <= 0) throw new DossierError(`buildDossier: caps.text_max_bytes must be a positive integer, not ${String(textCap)}`);

  let imageCap = { n: DOSSIER_MAX_IMAGES, whose: 'a dossier holds' };
  let imageByteCap = { n: DOSSIER_MAX_BYTES, whose: 'a dossier holds' };
  if (limits.screenshots !== undefined) {
    const shotCaps = limits.screenshots as { max?: unknown; max_bytes?: unknown } | null;
    if (typeof shotCaps !== 'object' || shotCaps === null) throw new DossierError('buildDossier: caps.screenshots must be an object {max, max_bytes}');
    for (const key of ['max', 'max_bytes'] as const) {
      const v = shotCaps[key];
      if (typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0) throw new DossierError(`buildDossier: caps.screenshots.${key} must be a positive integer, not ${String(v)}`);
    }
    if ((shotCaps.max as number) < imageCap.n) imageCap = { n: shotCaps.max as number, whose: 'caps.screenshots.max allows' };
    if ((shotCaps.max_bytes as number) < imageByteCap.n) imageByteCap = { n: shotCaps.max_bytes as number, whose: 'caps.screenshots.max_bytes allows' };
  }
  let dashLimits: { max_files: number; max_bytes: number } | null = null;
  if (limits.dashboard !== undefined) {
    const dashCaps = limits.dashboard as { max_files?: unknown; max_bytes?: unknown } | null;
    if (typeof dashCaps !== 'object' || dashCaps === null) throw new DossierError('buildDossier: caps.dashboard must be an object {max_files, max_bytes}');
    for (const key of ['max_files', 'max_bytes'] as const) {
      const v = dashCaps[key];
      if (typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0) throw new DossierError(`buildDossier: caps.dashboard.${key} must be a positive integer, not ${String(v)}`);
    }
    dashLimits = { max_files: dashCaps.max_files as number, max_bytes: dashCaps.max_bytes as number };
  }

  const dashboard = walkDashboard(joinPath(dir, 'dashboard'), dashLimits);

  const shotsPath = joinPath(dir, 'screenshots');
  let shotFiles: string[];
  try {
    shotFiles = readdirSync(shotsPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort(compareStrings);
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') throw new DossierError('buildDossier: no screenshots/ directory: the first screenshot is the cover');
    throw new DossierError('buildDossier: screenshots/ cannot be read');
  }
  if (shotFiles.length === 0) throw new DossierError('buildDossier: screenshots/ holds no image: the first is the cover');
  if (shotFiles.length > imageCap.n) throw new DossierError(`buildDossier: screenshots/ holds ${shotFiles.length} files, over the ${imageCap.n} ${imageCap.whose}`);
  const shotImages = shotFiles.map((shotName) => {
    if (!PLAIN_NAME.test(shotName)) throw new DossierError(`buildDossier: screenshots/${shotName}: a name is letters, digits and . _ -, 1 to 128 characters, not starting with . or -`);
    const shotBytes = readUpTo(joinPath(shotsPath, shotName), imageByteCap.n, `screenshots/${shotName}`);
    const mime = startsWithBytes(shotBytes, PNG_HEADER) ? 'image/png' : startsWithBytes(shotBytes, JPEG_HEADER) ? 'image/jpeg' : null;
    if (mime === null) throw new DossierError(`buildDossier: screenshots/${shotName} is neither a PNG nor a JPEG`);
    return { name: shotName, media_type: mime, sha256: sha256Of(shotBytes), base64: Buffer.from(shotBytes).toString('base64') };
  });

  const headerBlock = [
    '## Dashboard',
    '',
    `Files: ${dashboard.length} (${dashboard.reduce((total, file) => total + file.size, 0)} bytes)`,
    ...dashboard.map((file) => `- ${file.path} (${file.size} bytes)`),
    '',
    '## Source',
    '',
    '',
  ].join('\n');

  // The files whose contents are shown, by path; a binary file is only named in the Dashboard block.
  const textFiles = dashboard.filter((file) => TEXT_FILE.test(file.path));
  interface DossierSection {
    heading: string;
    code: ShownText | null;
    sectionBytes: number;
    sourceBytes: number;
  }
  const parts: DossierSection[] = textFiles.map((file) => {
    const rawBytes = readUpTo(joinPath(dir, 'dashboard', file.path), DOSSIER_MAX_BYTES, `dashboard/${file.path}`);
    const lines = countLines(rawBytes);
    const heading = `### ${file.path}\n\n${rawBytes.length} bytes, ${lines} line${lines === 1 ? '' : 's'}\n\n`;
    if (rawBytes.length === 0) return { heading, code: null, sectionBytes: utf8Length(heading), sourceBytes: 0 };
    const text = new TextDecoder('utf-8').decode(rawBytes);
    const fence = fenceLengthFor(text);
    const lang = fenceLanguageOf(file.path);
    const block = `${fence}${lang}\n${text}${text.endsWith('\n') ? '' : '\n'}${fence}\n\n`;
    return { heading, code: { sourceBytes: rawBytes, text, fence, lang, block, blockBytes: utf8Length(block), lines }, sectionBytes: utf8Length(heading) + utf8Length(block), sourceBytes: rawBytes.length };
  });

  // tailBytes[idx]: the bytes of the text files after part idx.
  const tailBytes = new Array<number>(parts.length + 1).fill(0);
  for (let idx = parts.length - 1; idx >= 0; idx--) tailBytes[idx] = tailBytes[idx + 1]! + (idx + 1 < parts.length ? parts[idx + 1]!.sourceBytes : 0);

  const cutNote = (n: number, left: number): string => `[Cut at ${textCap} bytes: ${n} file${n === 1 ? '' : 's'} and ${left} bytes left out.]\n`;
  let text = headerBlock;
  let usedBytes = utf8Length(headerBlock);
  if (usedBytes + utf8Length(cutNote(0, 0)) > textCap) throw new DossierError(`buildDossier: caps.text_max_bytes ${textCap} cannot hold even the Dashboard block and the cut line`);
  let keptCount = 0;
  for (; keptCount < parts.length; keptCount++) {
    const part = parts[keptCount]!;
    const restCount = parts.length - keptCount - 1;
    const tailSize = restCount === 0 ? 0 : utf8Length(cutNote(restCount, tailBytes[keptCount]!));
    if (usedBytes + part.sectionBytes + tailSize > textCap) break;
    text += part.code === null ? part.heading : `${part.heading}${part.code.block}`;
    usedBytes += part.sectionBytes;
  }
  if (keptCount < parts.length) {
    // The first file that does not fit whole: its head, up to the last complete line that fits, then nothing more.
    const cut = parts[keptCount]!;
    const restCount = parts.length - keptCount - 1;
    const afterBytes = tailBytes[keptCount]!;
    const head = cut.code === null ? null : headOfFile(cut.heading, cut.code, textCap - usedBytes, (hidden) => cutNote(restCount, afterBytes + hidden));
    text += head ?? cutNote(restCount + 1, afterBytes + cut.sourceBytes);
  }
  if (utf8Length(text) > textCap) throw new DossierError(`buildDossier: caps.text_max_bytes ${textCap} cannot hold even the Dashboard block and the cut line`);

  const dossier = { schema: DOSSIER_SCHEMA, cover: 0, text: text.replace(/\n+$/, '\n'), images: shotImages };
  const encoded = Buffer.from(canonicalJson(dossier), 'utf8');
  if (encoded.length > DOSSIER_MAX_BYTES) throw new DossierError(`buildDossier: the dossier is ${encoded.length} bytes, over the ${DOSSIER_MAX_BYTES} one holds`);
  return new Uint8Array(encoded.buffer, encoded.byteOffset, encoded.length);
}

/** A shown file as the dossier shows it. */
interface ShownText {
  sourceBytes: Uint8Array;
  text: string;
  fence: string;
  /** The language the fence opens with (the file's extension, mjs as js). */
  lang: string;
  /** The fenced block: the fence and the language, the text (a last LF added when it lacks one), the fence, a blank line. */
  block: string;
  blockBytes: number;
  lines: number;
}

/**
 * A file's section cut inside its contents: its heading, its first k lines in its fence (closed), a line
 * naming how many of its lines are not shown, then `tailLine(hidden)` (the cut line, given the bytes this
 * file leaves out), k the most lines (at least one, fewer than all) whose whole fits in `room` UTF-8
 * bytes; null when not one line fits. It cuts only after a line's LF, which is never inside a UTF-8
 * sequence nor a replacement character's bytes, so no character is split, and a line's shown bytes are
 * those of its text.
 */
function headOfFile(heading: string, code: ShownText, room: number, tailLine: (hidden: number) => string): string | null {
  const lineTotal = code.lines;
  const split = code.text.split('\n');
  const openFence = `${code.fence}${code.lang}\n`;
  const closeFence = `${code.fence}\n\n`;
  const hiddenNote = (idx: number): string => `[${lineTotal - idx} of this file's ${lineTotal} lines not shown.]\n`;
  const overhead = utf8Length(heading) + utf8Length(openFence) + utf8Length(closeFence);
  let fit = 0;
  let shownBytes = 0;
  let rawAt = 0;
  for (let idx = 1; idx < lineTotal; idx++) {
    shownBytes += utf8Length(split[idx - 1]!) + 1;
    rawAt = code.sourceBytes.indexOf(0x0a, rawAt) + 1;
    if (overhead + shownBytes + utf8Length(hiddenNote(idx)) + utf8Length(tailLine(code.sourceBytes.length - rawAt)) <= room) fit = idx;
  }
  if (fit === 0) return null;
  let rawEnd = 0;
  for (let idx = 0; idx < fit; idx++) rawEnd = code.sourceBytes.indexOf(0x0a, rawEnd) + 1;
  const headText = split.slice(0, fit).map((line) => `${line}\n`).join('');
  return `${heading}${openFence}${headText}${closeFence}${hiddenNote(fit)}${tailLine(code.sourceBytes.length - rawEnd)}`;
}
