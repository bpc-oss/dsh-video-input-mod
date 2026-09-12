// p40v3_build.cjs — 本地 asar API 版: 提取 → P40 → 打包 out8
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const asar = require('C:/Users/Administrator/.dsh/tmp/p32-deploy/node_modules/@electron/asar/lib/asar.js');
const P = 'C:/Users/Administrator/.dsh/tmp';
const RES = 'C:/Users/Administrator/AppData/Local/Programs/DSH Desktop/resources';
const LIVE = RES + '/app.asar';
const TREE = P + '/p40-deploy/tree';
const OUT = P + '/p40-deploy/out8';

(async () => {
  fs.rmSync(P + '/p40-deploy', { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  console.log('[1] extracting live asar (API)...');
  await asar.extractAll(LIVE, TREE);
  if (fs.existsSync(RES + '/app.asar.unpacked')) fs.cpSync(RES + '/app.asar.unpacked', TREE, { recursive: true, force: true });
  console.log('[1] extracted + unpacked merged');

  const DIST = TREE + '/node_modules/@earendil-works/pi-ai/dist';
  fs.copyFileSync(P + '/p32-deploy/tree/node_modules/@earendil-works/pi-ai/dist/utils/p40-gzip-fetch.js', DIST + '/utils/p40-gzip-fetch.js');
  console.log('[2] p40 module installed');

  for (const rel of ['/api/openai-completions.js', '/api/openai-responses.js']) {
    const f = DIST + rel;
    let s = fs.readFileSync(f, 'utf8');
    if (s.includes('p40Fetch')) { console.log('[3] already patched:', rel); continue; }
    const idx = s.indexOf('\n', s.indexOf('import '));
    s = s.slice(0, idx + 1) + 'import { p40Fetch } from "../utils/p40-gzip-fetch.js";\n' + s.slice(idx + 1);
    const anchor = '        fetch,';
    const n = s.split(anchor).length - 1;
    if (n === 0) { console.error('[3] anchor MISS', rel); process.exit(1); }
    s = s.split(anchor).join('        fetch: p40Fetch(fetch),');
    fs.writeFileSync(f, s);
    console.log('[3] patched', rel, 'x' + n);
  }
  for (const f of ['/utils/p40-gzip-fetch.js', '/api/openai-completions.js', '/api/openai-responses.js']) {
    const tmp = P + '/p40-deploy/' + path.basename(f) + '.mjs';
    fs.copyFileSync(DIST + f, tmp);
    execFileSync('node', ['--check', tmp]);
  }
  console.log('[4] ESM ok');

  // unpack 集: 从 live 头部推导 brace 模式
  function header(p) {
    const fd = fs.openSync(p, 'r'); const b4 = Buffer.alloc(4);
    fs.readSync(fd, b4, 0, 4, 4); const hs = b4.readUInt32LE(0);
    const head = Buffer.alloc(hs); fs.readSync(fd, head, 0, hs, 8); fs.closeSync(fd);
    const txt = head.toString('latin1'); const s = txt.indexOf('{'); let d = 0, e = -1;
    for (let i = s; i < txt.length; i++) { if (txt[i] === '{') d++; else if (txt[i] === '}' && --d === 0) { e = i; break; } }
    return JSON.parse(txt.slice(s, e + 1));
  }
  function walkUnpacked(n, p, out) { for (const [k, v] of Object.entries(n.files || {})) { const q = p + '/' + k; if (v.files) walkUnpacked(v, q, out); else if (v.unpacked) out.push(q); } return out; }
  const liveUn = walkUnpacked(header(LIVE), '', []);
  const dirs = new Set(liveUn.map((p) => p.replace(/^\//, '').split('/').slice(0, -1).join('/')));
  const sorted = [...dirs].sort((a, b) => a.length - b.length);
  const minimal = [];
  for (const d of sorted) if (!minimal.some((m) => d.startsWith(m + '/'))) minimal.push(d);
  const esc = (s) => s.replace(/([?*[\]\\])/g, '\\$1');
  const pattern = '{' + minimal.map(esc).join(',') + '}';
  console.log('[5] unpack dirs:', minimal.length);

  await asar.createPackageWithOptions(TREE, OUT + '/app.asar', { unpackDir: pattern });
  console.log('[6] out8 packed:', fs.statSync(OUT + '/app.asar').size, 'B');

  const newUn = walkUnpacked(header(OUT + '/app.asar'), '', []);
  const L = new Set(liveUn), N = new Set(newUn);
  const missing = liveUn.filter((x) => !N.has(x));
  console.log('[7] unpack set: live=' + liveUn.length + ' new=' + newUn.length + ' missing=' + missing.length);
  missing.slice(0, 5).forEach((m) => console.log('   MISS', m));

  const EX = P + '/v209-intel/asar-extract.cjs';
  const checks = [
    ['node_modules/@earendil-works/pi-ai/dist/utils/p40-gzip-fetch.js', ['DSH_GZIP_MIN_BYTES']],
    ['node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js', ['p40Fetch']],
    ['node_modules/@earendil-works/pi-ai/dist/api/openai-responses.js', ['p40Fetch']],
    ['node_modules/@deepseek-ai/dsh-tool-fs/lib/index.js', ['P38: gate widened', '950000']],
    ['node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js', ['__p34Poison']],
  ];
  for (const [inner, marks] of checks) {
    const tmp = P + '/p40-deploy/v-' + path.basename(inner);
    execFileSync('node', [EX, OUT + '/app.asar', inner, tmp]);
    const raw = fs.readFileSync(tmp, 'utf8');
    console.log('[8]', inner.split('/').slice(2, 4).join('/'), marks.map((m) => m + '=' + raw.includes(m)).join(' '));
  }
  console.log('READY ->', OUT + '/app.asar');
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
