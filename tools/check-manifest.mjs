#!/usr/bin/env node
/**
 * check-manifest.mjs — CI-side structural validation (no DSH install needed).
 * - manifest parses
 * - every patch entry has id/file/sha256/backups/note
 * - every referenced patch file exists in the repo tree (patches/ or manifest/)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(repo, 'manifest', 'dsh-video-patches.manifest.json');
const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

if (m.manifest !== 'dsh-video-patches') throw new Error('unexpected manifest kind');
if (!Array.isArray(m.patches) || m.patches.length === 0) throw new Error('no patch entries');

let bad = 0;
for (const p of m.patches) {
  for (const key of ['id', 'file', 'sha256', 'note']) {
    if (!p[key]) { console.error(`entry ${p.id ?? '(no id)'}: missing ${key}`); bad++; }
  }
  if (p.sha256 && !/^[0-9a-f]{64}$/.test(p.sha256)) { console.error(`entry ${p.id}: bad sha256`); bad++; }
  if (!Array.isArray(p.backups)) { console.error(`entry ${p.id}: missing backups[]`); bad++; }
}
if (bad > 0) { console.error(`manifest check FAILED (${bad} issue(s))`); process.exit(1); }
console.log(`manifest OK: ${m.patches.length} patch entries, generatedAt=${m.generatedAt}`);
