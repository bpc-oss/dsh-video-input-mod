// sim-budget.mjs — video keep-rule 确定性模拟（规则A=kept前缀和重算 / 规则B=all-newer-sum 单调）
const ruleA = (videos, B) => { // newest-first, 无条件最新
  let sum = 0; const kept = new Set();
  videos.forEach((v, i) => { if (i === 0 || sum + v.len <= B) { kept.add(i); sum += v.len; } });
  return kept;
};
const ruleB = (videos, B) => {
  const kept = new Set();
  videos.forEach((v, i) => {
    if (i === 0) { kept.add(0); return; }
    let s = 0; for (let j = 0; j < i; j++) s += videos[j].len;
    if (s < B) kept.add(i);
  });
  return kept;
};
const unshift = (arr, v) => [v, ...arr];

console.log('=== 反例：规则 A 非单调（degrade→keep 复活）===');
let a = [{ len: 900_000 }, { len: 60_000 }];
const k1 = ruleA(a, 950_000);
console.log('T1 [y900K,x60K] keeps', [...k1], '→ x degrade:', !k1.has(1));
a = unshift(a, { len: 100_000 });
const k2 = ruleA(a, 950_000);
console.log('T2 [w100K,y900K,x60K] keeps', [...k2], '→ x 复活:', k2.has(2) ? '是 = 非单调(违C3)' : '否');

console.log('=== 规则 B 同场景（all-newer-sum, 单调）===');
let b1 = [{ len: 900_000 }, { len: 60_000 }];
const kb1 = ruleB(b1, 950_000); b1 = unshift(b1, { len: 100_000 });
const kb2 = ruleB(b1, 950_000);
console.log('T1 keeps', [...kb1], ' T2 keeps', [...kb2], ' x 复活:', kb2.has(2) ? '是' : '否 ✓');

console.log('=== 身份级 20 片段随机游走单调检查 ===');
function gen(n) { const r = []; let s = 12345; for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; r.push(180_000 + (s % 620_000)); } return r; }
function walk(videos, B, rule) {
  let seq = []; const degraded = new Set(); let viol = 0; let id = 0;
  for (const len of videos) { seq = unshift(seq, { len, id: ++id }); const k = rule(seq, B);
    seq.forEach((v, i) => { if (degraded.has(v.id) && k.has(i)) viol++; if (!k.has(i)) degraded.add(v.id); });
  } return viol;
}
const clips = gen(20);
console.log('规则A 违例:', walk(clips, 950_000, ruleA), ' 规则B 违例:', walk(clips, 950_000, ruleB));

console.log('=== 真实 QA 片段序列（base64 chars），不同 B 的 keep 数（规则 B）===');
const clipsKB = [522, 414, 293, 616, 442, 352, 292, 1202]; // 新→旧
for (const B of [500_000, 600_000, 950_000]) {
  const videos = clipsKB.map(k => ({ len: k * 1024 }));
  const kept = [...ruleB(videos, B)];
  console.log(`B=${(B / 1000) | 0}K chars: keeps=${kept.length} (${kept.map(i => clipsKB[i] + 'KB').join(', ')})  最坏body≈${((kept.reduce((s, i) => s + clipsKB[i], 0)) / 1024).toFixed(1)}MB视频`);
}
