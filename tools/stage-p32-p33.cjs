// p32-p33-stage.cjs — 从 live asar 提取、打补丁、验证；不 pack 不部署
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('node:child_process');
const ASAR = 'C:/Users/Administrator/AppData/Local/Programs/DSH Desktop/resources/app.asar';
const EXTRACT = 'C:/Users/Administrator/.dsh/tmp/v209-intel/asar-extract.cjs';
const WORK = 'C:/Users/Administrator/.dsh/tmp/p32-stage';
fs.mkdirSync(WORK, { recursive: true });

const targets = [
  ['node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js', 'pi-ai.js'],
  ['node_modules/@deepseek-ai/dsh-tool-fs/lib/index.js', 'tool-fs.js'],
];
for (const [inner, out] of targets) {
  execFileSync('node', [EXTRACT, ASAR, inner, path.join(WORK, out)]);
  console.log('extracted', inner);
}

// --- P32: pi-ai rule-B ---
let s = fs.readFileSync(path.join(WORK, 'pi-ai.js'), 'utf8');
console.log('P25 present:', s.includes('__p25OffloadOldVideos'));
const startMark = 'function __p25OffloadOldVideos(messages) {';
const endMark = '\treturn changed ? out : messages;\n}';
const si = s.indexOf(startMark), ei = s.indexOf(endMark);
if (si < 0 || ei < 0) { console.log('P32 anchor MISS — pi-ai 形态与预期不符, dump 附近 300 字符:'); console.log(s.slice(Math.max(0, si - 100), si + 300)); process.exit(2); }
const newFn = `function __p25OffloadOldVideos(messages) {
\t// P32 (rule B, monotonic budget): newest video block always inline; older blocks stay
\t// inline only while the TOTAL data-URL length of ALL newer video blocks is under
\t// DSH_VIDEO_WIRE_BUDGET (default 950000 chars). Degradation is permanent per block
\t// (newer-sum never shrinks on append) so the wire prefix mutates only at the
\t// budget boundary. No re-encoding: kept blocks are byte-identical (quality mandate).
\tconst budget = Number(process.env.DSH_VIDEO_WIRE_BUDGET || 950000);
\tconst hits = [];
\tfor (let mi = 0; mi < messages.length; mi++) {
\t\tconst blocks = Array.isArray(messages[mi]?.content) ? messages[mi].content : null;
\t\tif (!blocks) continue;
\t\tfor (let bi = 0; bi < blocks.length; bi++) {
\t\t\tconst b = blocks[bi];
\t\t\tif (b?.type === "video" && typeof b.url === "string") { hits.push({ mi, bi, ci: -1, len: b.url.length }); continue; }
\t\t\tif (b?.type === "tool-result" && Array.isArray(b.content)) for (let ci = 0; ci < b.content.length; ci++) { const c = b.content[ci]; if (c?.type === "video" && typeof c.url === "string") hits.push({ mi, bi, ci, len: c.url.length }); }
\t\t}
\t}
\tif (hits.length < 2) return messages;
\tconst PLACEHOLDER = "[earlier video omitted to keep the request within gateway limits]";
\tlet newerSum = 0;
\tconst topSet = new Map();
\tconst nested = new Map();
\tfor (let i = hits.length - 1; i >= 0; i--) {
\t\tconst h = hits[i];
\t\tif (i !== hits.length - 1 && newerSum >= budget) {
\t\t\tif (h.ci < 0) { const t = topSet.get(h.mi) ?? new Set(); t.add(h.bi); topSet.set(h.mi, t); }
\t\t\telse { const m2 = nested.get(h.mi) ?? new Map(); const set = m2.get(h.bi) ?? new Set(); set.add(h.ci); m2.set(h.bi, set); nested.set(h.mi, m2); }
\t\t}
\t\tnewerSum += h.len;
\t}
\tif (topSet.size === 0 && nested.size === 0) return messages;
\treturn messages.map((msg, mi) => {
\t\tconst tops = topSet.get(mi); const nest = nested.get(mi);
\t\tif (!tops && !nest) return msg;
\t\tconst content = (Array.isArray(msg.content) ? msg.content : []).map((b, bi) => {
\t\t\tif (tops?.has(bi)) return { type: "text", text: PLACEHOLDER };
\t\t\tconst ciSet = nest?.get(bi);
\t\t\tif (ciSet && b?.type === "tool-result" && Array.isArray(b.content)) return { ...b, content: b.content.map((c, ci) => ciSet.has(ci) ? { type: "text", text: PLACEHOLDER } : c) };
\t\t\treturn b;
\t\t});
\t\treturn { ...msg, content };
\t});
}`;
s = s.slice(0, si) + newFn + s.slice(ei + endMark.length);
fs.writeFileSync(path.join(WORK, 'pi-ai.js'), s);

// --- P33: tool-fs 内联预算上限（源文件字节）+ 无损分段提示 ---
let t = fs.readFileSync(path.join(WORK, 'tool-fs.js'), 'utf8');
const a2 = 'if (declared !== void 0 && declared.startsWith("video/")) {\n\t\t\t\t// P21: video wire form';
if (!t.includes(a2)) { console.log('P33 anchor MISS; dump:'); const i = t.indexOf('video wire form'); console.log(t.slice(Math.max(0,i-300), i+100)); process.exit(2); }
const guard = 'if (declared !== void 0 && declared.startsWith("video/")) {\n\t\t\t\t// P33: inline-budget guard on SOURCE bytes — fail loud, never transform (quality mandate).\n\t\t\t\tconst videoCap = Number(process.env.DSH_VIDEO_MAX_FILE_BYTES || 1200000);\n\t\t\t\tif (data.length > videoCap) throw new Error(`cannot read "${target.displayPath}": video ${(data.length / 1024) | 0}KB exceeds the ${(videoCap / 1024) | 0}KB inline budget; split it losslessly first (ffmpeg -c copy -map 0 -segment_time 8 -f segment out%03d.mp4) or read a smaller file`);\n\t\t\t\t// P21: video wire form';
t = t.replace(a2, guard);
fs.writeFileSync(path.join(WORK, 'tool-fs.js'), t);

// --- 验证 ---
execFileSync('node', ['--check', path.join(WORK, 'pi-ai.js')]);
execFileSync('node', ['--check', path.join(WORK, 'tool-fs.js')]);
console.log('P32+P33 applied, syntax OK');

// 单调性 + keep 决策模拟（真实函数体从文件提取后 eval）
const fn = new Function('process', s.slice(s.indexOf('function __p25OffloadOldVideos'), s.indexOf('\n}\n', s.indexOf('function __p25OffloadOldVideos')) + 3) + '\nreturn __p25OffloadOldVideos;')({ env: process.env });
const mk = (len) => [{ type: 'text', text: 'x' }, { type: 'video', mediaType: 'video/mp4', url: 'v'.repeat(len) }];
const isVideo = (m) => JSON.stringify(m).includes('"type":"video"');
// 场景1: 最新522K+旧414K chars → 都 <950K → 全保留
let r = fn([{ role:'user', content: mk(414000) }, { role:'user', content: mk(522000) }]);
console.log('scene keep2:', isVideo(r[0]) && isVideo(r[1]), '(expect true)');
// 场景2: 522K+616K 新者在前 newer-sum(616K)<950K 仍留; 加第三条 500K → 第1条 newerSum=1116K≥B → 降级
r = fn([{ role:'user', content: mk(522000) }, { role:'user', content: mk(616000) }, { role:'user', content: mk(400000) }]);
console.log('scene drop-oldest:', !isVideo(r[0]) && isVideo(r[1]) && isVideo(r[2]), '(expect true)');
// 场景3 单调性: 降级后新增更大的视频, 旧的不得复活
const msgs = [{ role:'user', content: mk(522000) }, { role:'user', content: mk(616000) }, { role:'user', content: mk(400000) }];
r = fn(msgs);
r = fn([...r, { role: 'user', content: mk(1200000) }]); // 最新 1.2M chars
console.log('monotonic (v522K stays degraded):', !isVideo(r[0]), '(expect true)');
// 冻结数组安全
try { Object.freeze(msgs); msgs.forEach(m => Object.freeze(m.content)); fn(msgs); console.log('frozen-input: ok'); } catch (e) { console.log('frozen-input FAIL:', e.message); }
console.log('\nSTAGED at', WORK, '— 未 pack、未部署。');
