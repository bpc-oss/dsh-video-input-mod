# dsh-video-input-mod

给 [DSH Desktop](https://deepseek.com)（DeepSeek Harness）加上**原生视频输入**能力的内核补丁集 —— agent 可以自动从磁盘读取视频文件、视频块沿请求管线透传、模型原生看视频；不具备原生视频能力的模型自动降级为抽帧。

English: kernel patches that add native video input to DSH Desktop. Agents read video files from disk themselves (`read_image` accepts mp4/webm/mov), video blocks flow through the request pipeline as native `video_url` parts for video-declaring models, and automatically degrade to frame extraction (P20) for image-only models. Provider-agnostic: gating is by model `inputModalities`, not by provider.

> ⚠️ 本仓库只包含**补丁（diff）、工具与文档**，不包含任何 DSH 原始源码文件。补丁应用于合法安装的 DSH Desktop 2.0.1（`app.asar.unpacked/node_modules` 内的模块）。许可见 [LICENSE](LICENSE)。

## 能力一览

- **工具层**：`read_image` 接受视频文件（mp4/webm/mov/avi/mpeg），返回 `{type:"video", url:"data:video/mp4;base64,…"}` 内容块（P21）
- **管线层**：按目标模型的 `inputModalities` 自动分流（P20）——声明 `video` 的模型走原生 `video_url`，只有 `image` 的模型自动抽帧，两者皆无的模型显式报错
- **wire 层**：openai-completions（P17c/P23）、deepseek adapter（P17b）、openai-responses（P22）三种 wire 的视频序列化
- **护栏**：多视频历史自动瘦身（P25，只保留最新视频的 data URL），避免网关 body 超限；token 计量修复（P24，视频块不再按 base64 文本计费）

## 实测矩阵

| Provider / wire | 原生视频 | 视频（P20 抽帧） | 备注 |
|---|---|---|---|
| bai · glm-5.3-flash (completions) | ⚠️ ~25% 上游命中，重试可解 | ✅ | 上游池混合，坏节点静默丢弃 |
| bai · qwen3.8-flash (completions) | ✅ 4/4 | ✅ | 推荐的原生视频目标 |
| deepseek-official (deepseek adapter) | 理论 ✅（P17b）未实测 | ✅ | |
| tokenrouter · glm-5.3-free (responses) | ❌ wire 拒收（serde 无视频类型） | ✅ 实测 | completions wire 也 4/4 丢弃 |
| teamoroute (responses) | ❌ 同上（P22 透传未验证） | ✅ | |
| 本地 DGX Spark (completions) | 理论 ✅ 未实测 | ✅ | |

pt 判别器：视频块进上下文后，下一请求 `inputTokens` 跳变 ≈ +500…+1500 = 原生摄入；≈ +100 = 未到达或被网关剥离（见 `tools/pt-check.mjs`）。

## 安装（DSH Desktop 2.0.1）

```powershell
# 0) 关闭 DSH Desktop；备份将被打补丁的文件（脚本自动做 .bak-<patch-id>）
cd <install-root>\resources\app.asar.unpacked\node_modules

# 1) 按序应用 full 补丁（-p1 去掉 a/ b/ 前缀；路径为仓库内相对路径）
git apply --directory="resources/app.asar.unpacked/node_modules" -p0 ..\..\dsh-video-input-mod\patches\full\*.patch
# 或逐个:
#   git apply patches/full/01-pi-ai-P17-P19b-P20-P25.patch ...

# 2) settings.yaml 模型声明（llm-pi-ai.providers.<id>.models[]）:
#    input: [text, image, video]          # 原生视频路由的前提
#    reasoningEfforts: {low: low, high: high, max: max}
#    （glm-5.3 家族上游不支持关闭思考，勿声明 off）

# 3) 启动 DSH Desktop，然后在任意对话里:
#    "用 read_image 读一下 E:\path\to\video.mp4"
```

> P18（apiproxy schema）无基线 diff，见 `patches/snippets/P18-apiproxy-video-part.md` 手工片段。

## 验证

```powershell
node tools\verify.mjs "<install-root>"        # 哈希 + 标记三重校验
node tools\pt-check.mjs <session.jsonl>       # 视频块是否真实进入请求（usage 判别）
```

E2E 基准（2026-09-10，DSH 2.0.1）：glm-5.3-flash input 2940→3522（+582）答对红→绿→蓝；qwen3.8-flash 2022→3495（+1473）同对。详见 `docs/provider-matrix.md`。

## 排障速查

| 症状 | 根因 | 处置 |
|---|---|---|
| `read_image` 不在工具列表 | attachments 服务未挂载 / 未解锁 | `dev_tool_search` 解锁 `read_image`；确认 preset |
| 400 `read body failed` (gateway_error) | 请求体超网关读取上限（多视频历史） | P25 自动瘦身上个视频之外的块；仍超则 `/compact` 或新会话 |
| 400 `InputParam … untagged enum` (responses) | responses wire 无视频类型 | 该 provider 声明去掉 `video`（P20 接管） |
| 模型答 "NO VIDEO" | 上游节点不支持（glm 池 ~75%） | 重发一次命中好节点；或切 qwen3.8-flash |
| 模型只看到 3-4 帧离散画面 | **这就是原生摄入的形态**（GLM 上游 1fps 内部采样） | 非 bug；瞬态细节用 agent 侧 ffmpeg 高密度补扫 |

更多背景见 `docs/architecture.md`（管线分层与设计取舍）与 `docs/troubleshooting.md`（本次踩过的全部坑：strict schema 方言、serde 白名单、网关 body 上限）。

## 2026-09-12 现状（DSH v2.0.9 / asar 时代）

补丁编号 P26–P31 已被 v2.0.9 迁移链占用；本链新增 **P32（规则 B 视频内联预算）/ P33（源文件 1.2MB 硬上限 + `-c copy` 无损分段指引）**，设计与独立审查结论见 `docs/DESIGN-P32-P33.md`（含非单调反例、keep/冻结/单调性验证证据）。补丁现以"从 live app.asar 提取 → 打补丁 → @electron/asar 重打包"流程落地（不再是 unpacked 直改），`tools/stage-p32-p33.cjs` 可复现暂存与验证；`tools/regen-manifest.mjs` 重生成 asar 时代 manifest（argv 可指向 live/out2 两态做双向校验）。

**2026-09-12 13:46 已部署**（watcher 自动备份 `app.asar.pre-p32-20260912` → 换包 → 标记验证通过）。线上实测：read_image 磁盘视频 → 5 帧带时间戳送达模型（蓝→黄判定正确，P23 收集器工作）；1880KB 文件触发 P33 显式拒绝（附 `-c copy` 分段指引）。回滚 = 还原备份文件。

**2026-09-12 P34/P35（毒视频熔断 + 2s 时长地板）**：zcode QA 会话被 1.66s 毒丸砖化（0 成功/22 失败）驱动新增；设计见 docs/DESIGN-P34-P35.md，功能验证 keep1/swap/survive + mvhd 4.00s/1.66s 全过，out3 重打包 294/294 集校验通过，部署 watcher 已挂（pre-p34 备份），重启后 zcode 会话自愈（首撞 400 → 熔断降级 → 次新顶上，实测 14:54 恢复成功）。

**P36/P37 事故复盘**：P34/P35 部署曾因锚点子串吞掉 async 关键字导致 ESM 编译崩溃（`node --check` 漏检）；P36 恢复 async、P37 使 P35 时长地板真正生效（dur 由 Promise 变数字），out4 已验证并挂 watcher 随下次重启生效。教训与修复版重放脚本见 docs/DESIGN-P34-P35.md + tools/stage-p34-p37.cjs（锚点全行语义、.mjs 强制 ESM 校验、源树自动回写）。
**P40（请求体 gzip，2026-09-12）**：qwen 时代 QA 会话的 read-body 失败/5min 超时根因 = 巨大 plain body 的上传耗时（2.6MB ≈ 41s 实测），b.ai 网关完整支持 `content-encoding: gzip`（3.72MB 实测解压处理）。pi-ai 的 SDK 客户端 fetch 注入 gzip 包装器（白名单 api.b.ai、阈值 256KB、env 可调、异常回退明文）。out8 已验证挂 watcher；设计/证据见 docs/DESIGN-P40.md，重放脚本 tools/stage-p40.cjs。
## 仓库结构

```
patches/full/    一键 diff（20260831 基线 → 全量打补丁后），按文件拆分
patches/layers/  分层 diff（P20 / P25 单补丁粒度，便于审阅）
patches/snippets/P18 手工片段（该文件无基线备份）
manifest/        dsh-video-patches.manifest.json（sha256 登记 + 验证记录）
tools/           build-patches / verify / pt-check / probe 脚本
docs/            架构、矩阵、排障
```

## 许可

MIT（见 [LICENSE](LICENSE)）。补丁以 diff 形式分发、面向合法安装的 DSH Desktop；本仓库不含、也不分发 DSH 本体的任何源码文件。上游行为（b.ai/tokenrouter 等）不在本仓库控制范围内。
