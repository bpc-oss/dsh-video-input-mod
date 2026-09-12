# P32/P33 — 视频内联预算与源文件上限（设计 v2 · 已审查 · 已暂存验证）

> 前身 DESIGN-P28-P21guard.md 作废：编号被并行工作占用（P26–P31 已存在），锚点亦随 v2.0.9 迁移更新。

## 独立审查结论（主线程，subagent 注入失败已声明）

| 编号 | 级别 | 结论 |
|---|---|---|
| F1 | 阻塞 | 设计 v1 的 keep 规则（kept-前缀和重算）**非单调**：20-clip 随机游走 6 次“降级→复活”违例。**改规则 B**：`degrade(x) ⟺ Σ(比 x 新的全部视频 data-URL 长度) ≥ B`，最新块无条件保留 → 违例 0 |
| F2 | 阻塞 | 无条件保留最新块 → 单个超大视频可把 body 顶爆。**P33 源文件上限** 1.2MB（base64 后 ≈1.6MB），超限显式报错并给 **`-c copy` 无损分段**指引 |
| F3 | 采纳 | B=950K chars：真实 QA 序列下 keep 1–2 段（≈0.9MB 视频体，实测安全区内）；env `DSH_VIDEO_WIRE_BUDGET` 可覆盖 |
| F4 | 记录 | 429（并发配额 + `mode:always` 500ms 重试）与 body 正交，不动 retryPolicy |
| C1 | 红线 | **零质量改动**：无转码、无降帧、保留块字节级原样 |

## 实现（已暂存并验证，未部署）

- **P32**（dsh-llm-pi-ai）：`__p25OffloadOldVideos` 整体替换为规则 B（顶层 + tool-result 嵌套视频块统一扫描；克隆式输出，输入 frozen 安全）
- **P33**（dsh-tool-fs）：read_image 视频分支前置 `DSH_VIDEO_MAX_FILE_BYTES`（默认 1,200,000B）硬上限
- 暂存位置：`.dsh/tmp/p32-stage/{pi-ai.js,tool-fs.js}`（从 **live app.asar** 提取原件打补丁，锚点为 v2.0.9 实际形态：`declared.startsWith("video/")`）
- 生成器：`tools/stage-p32-p33.cjs`（可重复执行；含验证）

### 验证证据（真实提取函数，eval 执行）
```
scene keep2:      true   (522K+414K chars → 双保留, 严格优于现状"只留最新1")
scene drop-oldest:true   (预算边界正确降级最旧)
monotonic:        true   (1.2M 新块入场后, 已降级块不复活)
frozen-input:     ok
node --check:     两文件通过
```

## 待办（部署需用户批准，涉及并行会话）

1. 从 live app.asar 全量 extract 工作树 → 覆盖两文件 → `npx @electron/asar pack`（复用 pack-209.ps1 的 unpack-dir 模式）→ `app.asar.pre-p32-<date>` 备份 → 替换 → 重启
2. manifest 增加 P32/P33 条目（含 v2.0.9 asar 路径与哈希）；`verify.mjs` 标记词更新
3. 部署后 E2E：连续 3 段 QA 视频 → 预期 keep≤2、无 400、缓存漂移显著下降
