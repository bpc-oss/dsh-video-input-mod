#!/usr/bin/env node
/**
 * dsh-video-input-mod — patch bundle generator
 * Builds patches/full and patches/layers diffs from the pristine baselines
 * (*.bak-video-20260831) and layered backups (*.bak-P20..P25) next to the
 * patched files inside an installed DSH Desktop instance.
 * Usage: node build-patches.mjs <DSH-install-root>
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = process.argv[2];
if (!root) { console.error('usage: build-patches.mjs <install-root>'); process.exit(1); }
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nm = path.join(root, 'resources', 'app.asar.unpacked', 'node_modules');

const rel = {
  piAi: '@deepseek-ai/dsh-llm-pi-ai/lib/index.js',
  deepseek: '@deepseek-ai/dsh-llm-deepseek/lib/index.js',
  llm: '@deepseek-ai/dsh-llm/lib/index.js',
  toolFs: '@deepseek-ai/dsh-tool-fs/lib/index.js',
  tokenMeter: '@deepseek-ai/dsh-token-meter/lib/index.js',
  conversation: '@deepseek-ai/dsh-client-ui-conversation/lib/client.js',
  attachment: '@deepseek-ai/dsh-client-ui-attachment/lib/client.js',
  completions: '@earendil-works/pi-ai/dist/api/openai-completions.js',
  responsesShared: '@earendil-works/pi-ai/dist/api/openai-responses-shared.js',
};

const F = (relPath, suffix = '') => path.join(nm, relPath + suffix);
const jobs = [
  ['patches/full/01-pi-ai-P17-P19b-P20-P25.patch', F(rel.piAi, '.bak-video-20260831'), F(rel.piAi), rel.piAi],
  ['patches/full/02-deepseek-P17b.patch', F(rel.deepseek, '.bak-video-20260831'), F(rel.deepseek), rel.deepseek],
  ['patches/full/03-llm-P19.patch', F(rel.llm, '.bak-video-20260831'), F(rel.llm), rel.llm],
  ['patches/full/04-tool-fs-P21.patch', F(rel.toolFs, '.bak-P21'), F(rel.toolFs), rel.toolFs],
  ['patches/full/05-token-meter-P24.patch', F(rel.tokenMeter, '.bak-P24'), F(rel.tokenMeter), rel.tokenMeter],
  ['patches/full/06-ui-conversation-P18b.patch', F(rel.conversation, '.bak-video-20260831'), F(rel.conversation), rel.conversation],
  ['patches/full/07-ui-attachment-P18c.patch', F(rel.attachment, '.bak-video-20260831'), F(rel.attachment), rel.attachment],
  ['patches/full/08-completions-P17c-P23.patch', F(rel.completions, '.bak-P23'), F(rel.completions), rel.completions],
  ['patches/full/09-responses-shared-P22.patch', F(rel.responsesShared, '.bak-P22'), F(rel.responsesShared), rel.responsesShared],
  ['patches/layers/P17-P19b-base.patch', F(rel.piAi, '.bak-video-20260831'), F(rel.piAi, '.bak-P20'), rel.piAi],
  ['patches/layers/P20-capability-split.patch', F(rel.piAi, '.bak-P20'), F(rel.piAi, '.bak-P25'), rel.piAi],
  ['patches/layers/P25-body-guard.patch', F(rel.piAi, '.bak-P25'), F(rel.piAi), rel.piAi],
];

for (const [outRel, from, to, target] of jobs) {
  const outPath = path.join(repo, outRel);
  let out;
  try {
    out = execFileSync('git', ['diff', '--no-index', '--unified=6', `--src-prefix=a/`, `--dst-prefix=b/`, from, to], { maxBuffer: 1 << 28 });
  } catch (e) {
    if (e.status !== 1) { console.error(`FAIL ${outRel}: ${e.message}`); process.exit(1); }
    out = e.stdout; // git exits 1 on differences; the diff still lands on stdout
  }
  let text = out.toString('utf8');
  const fromEsc = from.split('\\').join('\\\\');
  const toEsc = to.split('\\').join('\\\\');
  text = text.split(`a/${fromEsc}`).join(`a/${target}`);
  text = text.split(`b/${toEsc}`).join(`b/${target}`);
  text = text.split(from).join(`a/${target}`);
  text = text.split(to).join(`b/${target}`);
  fs.writeFileSync(outPath, text);
  console.log(`built ${outRel} (${Math.round(Buffer.byteLength(text) / 1024)} KB)`);
}
console.log('done.');