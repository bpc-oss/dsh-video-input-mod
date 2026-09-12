# P40 — 请求体 gzip（已回滚：会话数据显示恶化）

> **状态：REVERTED（2026-09-12 19:4x）**。合成 A/B（SDK+gzip+stream 1.5MB ×6 全过）与真实会话背离：部署后 zcode 会话 read-body 失败从 ~4次/30min 升至 14→24→30/30min（5 倍）。合成测试缺少会话负载特征（工具 schema、base64 图/视频、深层嵌套），不足以定罪豁免。已回滚至 pre-P40 态（其余补丁保留）。
> 嫌疑机制：bai 异构节点池对 gzip+复杂 payload 的处理不一致。若日后重启此方向，需以真实会话流量做 A/B 而非合成体。

---

# P40 — 请求体 gzip（传输层优化，零语义变化）

## 事故背景

zcode QA 会话（68cdbcc8）在 qwen3.8-flash 时代持续报 `400 read request body failed`（70 分钟 145 次重试）+ 13 次 5 分钟 idle 超时。会话上下文 542K→584K tokens（body ≈2.3MB 文本 + 内联视频 0.7–1.5MB）。

## 诊断（三组对照实验推翻并重建了因果）

| 实验 | 结果 | 结论 |
|---|---|---|
| 2.7MB 纯文本 plain | ✅ 200 | "~2.5MB 尺寸墙"假设**被推翻** |
| 2.58MB 文本+小视频 plain | ✅ 200 但**耗时 41.4s** | **上传慢才是元凶**：巨大 body 的上传时间引发读超时/挂断 |
| 3.72MB body **gzip** | ✅ 网关解压成功并处理到视频校验 | **b.ai 网关完整支持 `content-encoding: gzip`** |

失败模式重构：带视频的轮次 body 3–3.8MB → 上传几十秒 → 网关读超时/中断 → `read body failed`；纯文本轮 2.3MB 能过但慢。重试风暴 → 换节点 → 缓存命中率崩（0%→41%→18% 的恶化曲线）。

## 实现

`pi-ai/dist/utils/p40-gzip-fetch.js`（新模块）+ 两处 OpenAI SDK 客户端构造注入（`openai-completions.js`、`openai-responses.js` 的 `fetch,` → `fetch: p40Fetch(fetch),`）：

- **触发条件**：body ≥ `DSH_GZIP_MIN_BYTES`（默认 256KB）**且** 目标域名在 `DSH_GZIP_HOSTS` 白名单（默认仅 `api.b.ai`）
- **动作**：`gzipSync(level 6)` + `content-encoding: gzip` + 删 content-length；其余头原样
- **兜底**：任何异常静默回退明文；已在白名单域名验证（3.72MB 实测）
- 非白名单 provider（teamoroute/本地/tokenrouter）零影响——要扩白名单需先验证该网关支持 gzip

## 验证

- 功能：3.72MB（含假视频）经包装器发出 → 网关解压成功处理（"Invalid video file" 是假素材的格式校验，非读失败）；小请求原样 200
- ESM：两注入文件 + 新模块 `.mjs` parse 通过
- out8：从 live 全新提取（含并行会话改动，**零回退**），unpacked 集 294/294，既有链（P32–P39cap）标记全在，源树已回写

## 预期效果

| 指标 | 前 | 后 |
|---|---|---|
| wire 体积（584K 上下文轮） | 3.7MB | ~1.1MB |
| 上传耗时 | ~41s | 3–5s |
| read body failed / idle 超时 | 64+13 次/3h | 预期成批消失 |
| 缓存命中率 | 0→41→18% 恶化 | 回到 qwen 池正常水平（重试风暴停 → 换节点少） |

## 环境旋钮

- `DSH_GZIP_MIN_BYTES`：触发阈值（字节，默认 262144）
- `DSH_GZIP_HOSTS`：逗号分隔白名单（默认 `api.b.ai`）
