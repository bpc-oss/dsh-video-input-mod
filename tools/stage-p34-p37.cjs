// apply_p34_p35.cjs 鈥?浠?live asar 鎻愬彇, 鎵?P34(姣掕棰戠啍鏂?+P35(鏃堕暱鍦版澘), 楠岃瘉, 涓嶉儴缃?const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const EX = 'C:/Users/Administrator/.dsh/tmp/v209-intel/asar-extract.cjs';
const LIVE = 'C:/Users/Administrator/AppData/Local/Programs/DSH Desktop/resources/app.asar';
const W = 'C:/Users/Administrator/.dsh/tmp/p34-stage';
fs.rmSync(W, { recursive: true, force: true });
fs.mkdirSync(W, { recursive: true });
execFileSync('node', [EX, LIVE, 'node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js', W + '/pi-ai.js']);
execFileSync('node', [EX, LIVE, 'node_modules/@deepseek-ai/dsh-tool-fs/lib/index.js', W + '/tool-fs.js']);

// ---------- P34a: pi-ai 妯″潡绾?poison 闆?+ 鏍囪鍑芥暟 ----------
let s = fs.readFileSync(W + '/pi-ai.js', 'utf8');
const fnMark = `const __p34Poison = new Set();
function __p34Key(url) { return url.length + ":" + url.slice(0, 48) + ":" + url.slice(-48); }
function __p34MarkPoison(messages) {
	for (let mi = messages.length - 1; mi >= 0; mi--) {
		const blocks = Array.isArray(messages[mi]?.content) ? messages[mi].content : null;
		if (!blocks) continue;
		for (let bi = blocks.length - 1; bi >= 0; bi--) {
			const b = blocks[bi];
			const urls = [];
			if (b?.type === "video" && typeof b.url === "string") urls.push(b.url);
			if (b?.type === "tool-result" && Array.isArray(b.content)) for (const c of b.content) if (c?.type === "video" && typeof c.url === "string") urls.push(c.url);
			for (const u of urls) {
				const k = __p34Key(u);
				if (!__p34Poison.has(k)) {
					if (__p34Poison.size > 64) __p34Poison.clear();
					__p34Poison.add(k);
					return true;
				}
			}
		}
	}
	return false;
}
// P25: gateway body-size guard`;
if (!s.includes('// P25: gateway body-size guard')) { console.error('P34a anchor MISS'); process.exit(1); }
s = s.replace('// P25: gateway body-size guard', fnMark);

// ---------- P34b: __p25OffloadOldVideos 鍔?key + poison 鍒嗘敮 + keptAny ----------
const hitTop = 'hits.push({ mi, bi, ci: -1, len: b.url.length })';
if (!s.includes(hitTop)) { console.error('P34b anchor1 MISS'); process.exit(1); }
s = s.replace(hitTop, 'hits.push({ mi, bi, ci: -1, len: b.url.length, key: __p34Key(b.url) })');
const hitNest = 'hits.push({ mi, bi, ci, len: c.url.length })';
if (!s.includes(hitNest)) { console.error('P34b anchor2 MISS'); process.exit(1); }
s = s.replace(hitNest, 'hits.push({ mi, bi, ci, len: c.url.length, key: __p34Key(c.url) })');
const loopOld = `for (let i = hits.length - 1; i >= 0; i--) {
\t\tconst h = hits[i];
\t\tif (i !== hits.length - 1 && newerSum >= budget) {`;
const loopNew = `let keptAny = false;
\tfor (let i = hits.length - 1; i >= 0; i--) {
\t\tconst h = hits[i];
\t\tif (__p34Poison.has(h.key)) {
\t\t\tif (h.ci < 0) { const t = topSet.get(h.mi) ?? new Set(); t.add(h.bi); topSet.set(h.mi, t); }
\t\t\telse { const m2 = nested.get(h.mi) ?? new Map(); const set = m2.get(h.bi) ?? new Set(); set.add(h.ci); m2.set(h.bi, set); nested.set(h.mi, m2); }
\t\t\tnewerSum += h.len;
\t\t\tcontinue;
\t\t}
\t\tif (keptAny && newerSum >= budget) {`;
if (!s.includes(loopOld)) { console.error('P34b anchor3 MISS'); process.exit(1); }
s = s.replace(loopOld, loopNew);
const keepOld = `\t\t}
\t\tnewerSum += h.len;
\t}`;
const keepNew = `\t\t\tnewerSum += h.len;
\t\t\tcontinue;
\t\t}
\t\tkeptAny = true;
\t\tnewerSum += h.len;
\t}`;
if (!s.includes(keepOld)) { console.error('P34b anchor4 MISS'); process.exit(1); }
s = s.replace(keepOld, keepNew);

// ---------- P34c: 鐢熸垚鍣?yield 鐐圭啍鏂?----------
const yLine = '\t\t\t\t\t\tyield result.value;';
let yIdx = s.indexOf(yLine);
if (yIdx < 0) {
  // 缂╄繘灞傜骇鍙兘涓嶅悓 鈥?鍦?watchdog.next 涔嬪悗鎵?yield result.value
  const wi = s.indexOf('const result = await watchdog.next(iterator);');
  const yi = s.indexOf('yield result.value;', wi);
  if (wi < 0 || yi < 0) { console.error('P34c anchor MISS'); process.exit(1); }
  const indent = s.slice(s.lastIndexOf('\n', yi) + 1, yi);
  yLine2 = indent + 'yield result.value;';
  yIdx = s.indexOf(yLine2);
  s = s.replace(yLine2, indent + `// P34: video poison circuit-breaker 鈥?a 4xx-class failure on a request that
${indent}// carried inline video_url marks the newest inline video as poison; the harness
${indent}// retry layer's next attempt degrades it (next-newest takes its place).
${indent}if (p34Active && result.value?.type === "finish" && result.value.reason?.kind === "error") {
${indent}\tconst fm = String(result.value.reason.failure?.message || "");
${indent}\tif (/\\b(400|404|422)\\b|invalid_request|bad_response_status_code|video modality|InvalidParameter/i.test(fm)) __p34MarkPoison(p25Messages);
${indent}}
${indent}yield result.value;`);
} else {
  s = s.replace(yLine, yLine.replace('yield result.value;', `// P34: video poison circuit-breaker (4xx with inline video 鈫?mark newest video poison)
\t\t\t\t\t\tif (p34Active && result.value?.type === "finish" && result.value.reason?.kind === "error") {
\t\t\t\t\t\t\tconst fm = String(result.value.reason.failure?.message || "");
\t\t\t\t\t\t\tif (/\\b(400|404|422)\\b|invalid_request|bad_response_status_code|video modality|InvalidParameter/i.test(fm)) __p34MarkPoison(p25Messages);
\t\t\t\t\t\t}
\t\t\t\t\t\tyield result.value;`));
}
// p34Active 瀹氫箟
const actAnchor = 'if (containsVideo) p25Messages = __p25OffloadOldVideos(options.messages);';
if (!s.includes(actAnchor)) { console.error('P34d anchor MISS'); process.exit(1); }
s = s.replace(actAnchor, actAnchor + '\n\t\t\t\tconst p34Active = containsVideo && !videoToFrames;');
fs.writeFileSync(W + '/pi-ai.js', s);

// ---------- P35: tool-fs MP4 mvhd 鏃堕暱鍦版澘 ----------
let t = fs.readFileSync(W + '/tool-fs.js', 'utf8');
const a35 = '// P21: video wire form 鈥?data URL on the block, same shape the UI composer emits';
if (!t.includes(a35)) { console.error('P35 anchor MISS'); process.exit(1); }
const p35 = `// P35: upstream duration floor 鈥?parse MP4 mvhd from the bytes (no deps);
\t\t\t\t// too-short clips are rejected fail-loud so they never poison the history.
\t\t\t\tconst minDur = Number(process.env.DSH_VIDEO_MIN_DURATION_SEC || 2);
\t\t\t\tconst dur = __p35Mp4Duration(data);
\t\t\t\tif (dur !== void 0 && dur < minDur) throw new Error(\`cannot read "\${target.displayPath}": video is \${dur.toFixed(2)}s, below the \${minDur}s upstream minimum (rejected as "too short" by video backends) 鈥?use a longer clip or extract frames yourself\`);
\t\t\t\t` + a35;
t = t.replace(a35, p35);
const helper35 = `function __p35Mp4Duration(buf) {
	// P35: find mvhd; v0 timescale/duration are 4B, v1 8B duration. Returns seconds or undefined.
	try {
		const tag = Buffer.from("mvhd");
		let pos = -1;
		for (let i = 0; i + 4 <= buf.length; i++) { if (buf[i] === tag[0] && buf.readUInt32BE(i) === tag.readUInt32BE(0)) { pos = i + 4; break; } }
		if (pos < 0) return void 0;
		const ver = buf[pos];
		if (ver === 0) {
			const timescale = buf.readUInt32BE(pos + 4 + 8);
			const duration = buf.readUInt32BE(pos + 4 + 12);
			return timescale > 0 ? duration / timescale : void 0;
		}
		const timescale = buf.readUInt32BE(pos + 4 + 16);
		const duration = Number(buf.readBigUInt64BE(pos + 4 + 20));
		return timescale > 0 ? duration / timescale : void 0;
	} catch { return void 0; }
}
function readImageTool`;
// helper 鏀炬ā鍧楅《灞?鈥?鎸傚湪 assertVideoCapableRoute 鍓?鍚屼负椤跺眰鍑芥暟)
// FIX(P36 事故): 锚点必须带 async — 裸 'function ...' 会匹配到 async 声明的子串, 把 async 吞进 helper 头
const anchorTop = 'async function assertVideoCapableRoute(';
if (!t.includes(anchorTop)) { console.error('P35 helper anchor MISS'); process.exit(1); }
t = t.replace(anchorTop, helper35.replace('function readImageTool', '') + '\n' + anchorTop);
fs.writeFileSync(W + '/tool-fs.js', t);

// ---------- 楠岃瘉 ----------
execFileSync('node', ['--check', W + '/pi-ai.js']);
execFileSync('node', ['--check', W + '/tool-fs.js']);
console.log('P34+P35 applied, syntax OK');

// 鍔熻兘娴嬭瘯: 鎻愬彇 __p34*/__p25 鍑芥暟鏃?eval
const grab = (name) => { const i = s.indexOf('function ' + name); let d = 0, j = s.indexOf('{', i); const st = j; for (; j < s.length; j++) { if (s[j] === '{') d++; else if (s[j] === '}') { d--; if (d === 0) break; } } return s.slice(i, j + 1); };
const poisonDecl = 'const __p34Poison = new Set();\n' + grab('__p34Key') + '\n' + grab('__p34MarkPoison') + '\n' + grab('__p25OffloadOldVideos');
const mk = (len) => [{ type: 'text', text: 'x' }, { type: 'video', mediaType: 'video/mp4', url: 'v'.repeat(64) + 'x'.repeat(len - 128) + 'e'.repeat(64) }];
const isVid = (m) => JSON.stringify(m).includes('"type":"video"');
const suite = new Function(poisonDecl + `
const mk = (len) => [{ type: "text", text: "x" }, { type: "video", mediaType: "video/mp4", url: "v".repeat(64) + "x".repeat(len - 128) + "e".repeat(64) }];
const isVid = (m) => JSON.stringify(m).includes('"type":"video"');
return function(budgetEnv) {
  process.env.DSH_VIDEO_WIRE_BUDGET = String(budgetEnv);
  const A = { role: "user", content: mk(433000) };   // 鏃?433K
  const B = { role: "user", content: mk(1130000) };  // 鏂?1.13M (姣?
  const msgs = [A, B];
  let r = __p25OffloadOldVideos(msgs);
  const keep1 = isVid(r[0].content[1]) === false && isVid(r[1].content[1]) === true; // B keep, A degrade
  __p34MarkPoison(msgs); // mark B poison
  r = __p25OffloadOldVideos(msgs);
  const swap = isVid(r[0].content[1]) === true && isVid(r[1].content[1]) === false; // A keep, B degrade
  __p34Poison.add(__p34Key(A.content[1].url)); // 鍐嶆瘨鎺?A
  const keep2 = (() => { const r2 = __p25OffloadOldVideos(msgs); return !isVid(r2[0].content[1]) && !isVid(r2[1].content[1]); })();
  return { keep1, swap, keep2 };
};`);
const out = suite()(950000);
console.log('poison suite: keep1(B only)=', out.keep1, ' swap(A takes over)=', out.swap, ' all-degraded(survive)=', out.keep2);
if (!(out.keep1 && out.swap && out.keep2)) { console.error('P34 FUNCTIONAL FAIL'); process.exit(2); }
// P35: 鐢ㄧ湡鏂囦欢娴?mvhd
const rgbl = fs.readFileSync('C:/Users/Administrator/AppData/Local/Temp/vlm_test/rgblight.mp4');
const big = fs.readFileSync('E:/ai-files/OpenMontage/reports/openmontage/fl2va-fp8/sb-008-d1.0-2490.mp4');

function grab2(name) { const i = t.indexOf(name); let d = 0, j = t.indexOf('{', i); for (; j < t.length; j++) { if (t[j] === '{') d++; else if (t[j] === '}') { d--; if (d === 0) break; } } return 'const process=globalThis.process;' + t.slice(i, j + 1) + '\nreturn __p35Mp4Duration;'; }
const dur = new Function(grab2('function __p35Mp4Duration'))();
console.log('mvhd: rgblight=', dur(rgbl)?.toFixed(2) + 's', ' poison2490=', dur(big)?.toFixed(2) + 's');
if (!(Math.abs((dur(rgbl) ?? 0) - 4) < 0.5 && Math.abs((dur(big) ?? 0) - 1.657) < 0.2)) { console.error('P35 FUNCTIONAL FAIL'); process.exit(3); }
console.log('STAGED OK at', W);

