// regen-manifest.mjs — asar 时代 manifest: 文件身份 = asar 内路径 + 解包字节哈希
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

// 部署完成前用 out2(待部署包), 部署后用 live — argv[2] 可覆盖
const OUT2 = process.argv[2] || 'C:/Users/Administrator/.dsh/tmp/p32-deploy/out2/app.asar';
const TMP = 'C:/Users/Administrator/.dsh/tmp/manifest-probe';
fs.mkdirSync(TMP, { recursive: true });
const EX = 'C:/Users/Administrator/.dsh/tmp/v209-intel/asar-extract.cjs';

const entries = [
  ['P17+P19b+P20+P32', 'node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js', 'P25 keep-newest 升级为规则 B 单调预算(DSH_VIDEO_WIRE_BUDGET, 默认 950000 chars);嵌套 tool-result 视频统一处理'],
  ['P17b', 'node_modules/@deepseek-ai/dsh-llm-deepseek/lib/index.js', 'deepseek adapter video case'],
  ['P17c+P23', 'node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js', 'wire video_url + 工具结果媒体搭后续 user 消息'],
  ['P22', 'node_modules/@earendil-works/pi-ai/dist/api/openai-responses-shared.js', 'responses wire 视频透传(实测端点拒收→保持休眠,video provider 声明须去掉)'],
  ['P40', 'node_modules/@earendil-works/pi-ai/dist/utils/p40-gzip-fetch.js', '请求体 gzip(白名单 api.b.ai, 阈值 256KB, env DSH_GZIP_MIN_BYTES/DSH_GZIP_HOSTS); 注入于 openai-completions.js 与 openai-responses.js 的客户端 fetch'],
  ['P7+P9', 'node_modules/@deepseek-ai/dsh-api-session-controller/lib/index.js', '并行链(v2.0.9 迁移)'],
  ['P9+P18', 'node_modules/@deepseek-ai/dsh-api-session-controller/lib/typert.host.js', 'apiproxy schema video 臂(P18 现居此包)'],
  ['P13', 'node_modules/@deepseek-ai/dsh-api-gateway/lib/index.js', '并行链'],
  ['P18b', 'node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js', '前端 encodeVideo'],
  ['P18c', 'node_modules/@deepseek-ai/dsh-client-ui-attachment/lib/client.js', '前端视频缩略'],
  ['P19', 'node_modules/@deepseek-ai/dsh-llm/lib/index.js', 'contentHasVideo'],
  ['P21+P33', 'node_modules/@deepseek-ai/dsh-tool-fs/lib/index.js', 'read_image 视频块 + 1.2MB 源文件硬上限(DSH_VIDEO_MAX_FILE_BYTES)+ -c copy 分段指引'],
  ['P24', 'node_modules/@deepseek-ai/dsh-token-meter/lib/index.js', 'video 块固定 4096 计价'],
  ['P18x', 'node_modules/@deepseek-ai/dsh-attachment/lib/index.js', '并行链'],
  ['P27', 'node_modules/@deepseek-ai/dsh-session-format-v2-to-v3/lib/index.js', '并行链(v2→v3 迁移)'],
];

const patches = [];
for (const [id, inner, note] of entries) {
  const out = path.join(TMP, inner.split('/').pop() + '.' + crypto.createHash('sha1').update(inner).digest('hex').slice(0, 6) + '.js');
  try {
    execFileSync('node', [EX, OUT2, inner, out]);
    const buf = fs.readFileSync(out);
    patches.push({
      id, file: 'app.asar!' + inner,
      sha256: crypto.createHash('sha256').update(buf).digest('hex'),
      bytes: buf.length, note
    });
  } catch (e) {
    patches.push({ id, file: 'app.asar!' + inner, error: 'extract failed: ' + e.message.slice(0, 80) });
  }
}

const manifest = {
  manifest: 'dsh-video-patches', version: 2,
  generatedAt: new Date().toISOString(),
  appVersion: 'DSH Desktop (v2.0.9 era, asar-packed patch chain P3..P32)',
  archive: 'live app.asar (部署后与 out2 一致; 验证时以 resources/app.asar 为准)',
  note: '身份 = asar 内路径 + 解包字节 sha256。P26-P31 为并行会话迁移链(编号顺延)。P32=规则B视频内联预算, P33=源文件上限。',
  verification: {
    p32: 'sim: keep2/drop-oldest/monotonic/frozen 全过 (tools/sim-budget.mjs)',
    p33: 'node --check + 包内标记 grep 通过',
    setcheck: 'unpacked 集 294/294 与 live 完全一致, 体积 delta +1481B'
  },
  patches
};
const dest = 'E:/ai-files/dsh-video-input-mod/manifest/dsh-video-patches.manifest.json';
fs.writeFileSync(dest, JSON.stringify(manifest, null, 2));
console.log('manifest written:', dest, 'entries:', patches.length, 'errors:', patches.filter(p => p.error).length);
