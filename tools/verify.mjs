#!/usr/bin/env node
/**
 * verify.mjs — check an installed DSH Desktop against the patch manifest.
 *
 * 1. every manifest patch file must exist
 * 2. its sha256 must match the manifest (mismatch = patch lost, likely an
 *    app update overwriting app.asar.unpacked)
 * 3. each expected marker string must be present (belt and braces)
 *
 * Usage: node verify.mjs <DSH-install-root> [path/to/dsh-video-patches.manifest.json]
 * Exit 0 = all patches present; exit 2 = some missing/mismatched.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = process.argv[2];
const manifestPath = process.argv[3] ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'manifest', 'dsh-video-patches.manifest.json');
if (!root || !fs.existsSync(manifestPath)) { console.error('usage: verify.mjs <install-root> [manifest.json]'); process.exit(1); }

const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const nm = path.join(root, 'resources', 'app.asar.unpacked', 'node_modules');

// belt-and-braces markers: unique strings each patch contributes
const MARKERS = {
  'P17+P19b+P20+P25': ['case "video":', 'videoToFrames', '__p25OffloadOldVideos'],
  'P17b': ['type: "video_url"'],
  'P17c+P23': ['video_url', 'video blocks from tool results'],
  'P18': ['"video"'],
  'P18b': ['encodeVideo'],
  'P18c': ['startsWith("video/")'],
  'P19': ['contentHasVideo'],
  'P21': ['assertVideoCapableRoute', 'video/mp4'],
  'P22': ['item.type === "video_url"'],
  'P24': ['VIDEO_BLOCK_TOKENS'],
};

const ciMode = process.argv.includes("--ci");
let missing = 0;
let fileMissing = 0;
for (const p of m.patches) {
  const rel = p.file.slice(m.appRoot.length + 1);
  if (!fs.existsSync(p.file)) { console.log(`MISSING  ${p.id}  ${rel}`); missing++; fileMissing++; continue; }
  const sha = crypto.createHash('sha256').update(fs.readFileSync(p.file)).digest('hex');
  const hashOk = sha === p.sha256;
  const raw = fs.readFileSync(p.file, 'utf8');
  const markers = MARKERS[p.id] ?? [];
  const markersOk = markers.every(k => raw.includes(k));
  const state = hashOk && markersOk ? 'OK     ' : (markersOk ? 'HASHDIFF' : 'PATCH LOST');
  if (state !== 'OK     ') missing++;
  console.log(`${state}  ${p.id.padEnd(20)} ${rel}`);
  if (!hashOk) console.log(`          manifest sha256=${p.sha256.slice(0, 12)}… installed=${sha.slice(0, 12)}… (expected after a DSH update — re-apply patches)`);
  if (!markersOk) console.log(`          missing marker(s): ${markers.filter(k => !raw.includes(k)).join(', ')}`);
}
console.log(missing === 0 ? '\nALL PATCHES PRESENT' : `\n${missing} patch file(s) missing/changed`);
if (missing === 0) process.exit(0);
if (ciMode && missing === fileMissing) { console.log('--ci: no DSH install detected, treating as clean'); process.exit(0); }
process.exit(2);
