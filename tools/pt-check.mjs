#!/usr/bin/env node
/**
 * pt-check.mjs — the delivery discriminator.
 *
 * Walks a session.jsonl.zstd (decompressed jsonl path) and, for every inline
 * video block in a tool result / user message, prints the request usage
 * (inputTokens + cacheReadTokens) before and after the block entered the
 * context.
 *
 *   delta ≈ +400…+1500  → video reached the upstream and was ingested natively
 *   delta ≈ +100…+300   → video never entered the wire (stripped), OR the
 *                         gateway stripped it before token counting — the two
 *                         are indistinguishable from tokens alone; use a
 *                         model whose upstream is known-good (qwen) to split.
 *
 * Usage: node pt-check.mjs <decompressed-session.jsonl>
 */
import fs from 'node:fs';
const lines = fs.readFileSync(process.argv[2], 'utf8').split('\n');
const usages = [];
const videos = [];
for (const l of lines) {
  if (!l) continue;
  if (l.includes('"type":"usage"')) {
    usages.push({
      seq: +(l.match(/"seq":(\d+)/) || [])[1] || 0,
      turn: +(l.match(/"turn":(\d+)/) || [])[1] || 0,
      step: +(l.match(/"step":(\d+)/) || [])[1] || 0,
      input: +(l.match(/"inputTokens":(\d+)/) || [])[1] || 0,
      cacheRead: +(l.match(/"cacheReadTokens":(\d+)/) || [])[1] || 0,
    });
  }
  if (l.includes('"type":"video"')) {
    videos.push({
      seq: +(l.match(/"seq":(\d+)/) || [])[1] || 0,
      kb: Math.round(l.length / 1024),
      hasDataUrl: l.includes('data:video/mp4;base64'),
    });
  }
}
console.log(`videos: ${videos.map(v => `seq ${v.seq} (${v.kb}KB, dataURL=${v.hasDataUrl})`).join(', ') || '(none)'}`);
for (const v of videos) {
  console.log(`== video @ seq ${v.seq} ==`);
  usages.filter(u => u.seq < v.seq).slice(-3).forEach(u =>
    console.log(`  BEFORE seq ${u.seq} turn${u.turn} step${u.step}: input=${u.input} cacheRead=${u.cacheRead}`));
  usages.filter(u => u.seq > v.seq).slice(0, 5).forEach(u =>
    console.log(`  AFTER  seq ${u.seq} turn${u.turn} step${u.step}: input=${u.input} cacheRead=${u.cacheRead}`));
}
if (videos.length === 0) console.log('(no inline video blocks in this log)');
