# 架构：DSH 原生视频输入管线

## 分层

```
┌─ UI / Agent ─────────────────────────────────────────────────────┐
│  拖入附件 (P18b encodeVideo)  或  agent 调 read_image 读盘 (P21)  │
└──────────────┬───────────────────────────────────────────────────┘
               ▼
┌─ apiproxy (P18) ─────────────────────────────────────────────────┐
│  promptContentPartSchema 接受 {type:"video", mediaType, url}     │
└──────────────┬───────────────────────────────────────────────────┘
               ▼
┌─ session 持久层 ─────────────────────────────────────────────────┐
│  user/message 与 tool/result 的 content 块按原样存储 (loose)      │
│  注意: 工具结果里的 video 块与用户消息里的形态一致                 │
└──────────────┬───────────────────────────────────────────────────┘
               ▼
┌─ pi-ai adapter (P17/P19b/P20/P23/P25) ───────────────────────────┐
│  containsVideo 检测 (含 tool-result 嵌套)                         │
│  videoToFrames = containsVideo && !input.video && input.image     │
│   ├─ false → case "video" 透传 video_url (原生路)                 │
│   └─ true  → videoBlockToImageBlocks: ffmpeg fps=1 采样           │
│              ≤10 帧带 [video … frame i/n, t≈Xs] 标记 (兜底路)      │
│  P25: 请求构建前, 仅最新视频块保留 data URL (网关 body 守护)       │
└──────────────┬───────────────────────────────────────────────────┘
               ▼
┌─ wire 序列化 (按 provider.api 分派) ─────────────────────────────┐
│  openai-completions (P17c/P23): video_url 原样 + 工具结果媒体      │
│   搭后续 user 消息 ("Attached media(s) from tool result:")        │
│  deepseek adapter (P17b): video_url                               │
│  openai-responses (P22): video_url 透传 (端点兼容性未验证)          │
│  其他 adapter (anthropic/google/bedrock…): 未覆盖                  │
└──────────────────────────────────────────────────────────────────┘
```

## 核心不变量

1. **能力门按模型声明，不按 provider**。`videoToFrames` 的唯一判据是
   `containsVideo && !model.input.includes("video") && model.input.includes("image")`。
   换 provider 不改变行为；换模型声明才改变。
2. **P21 与 P20 解耦**。工具层只负责"文件→video 块"；分流发生在管线层。
   因此 read_image 对任何模型都可用，无需知道模型能力。
3. **视频块 = data URL 直接内联**，不经附件存储（图片走 sha256 附件引用 +
   prepareRequestImages 解析；视频刻意绕开，因为附件服务的 magic-byte 校验
   是图片专用的）。
4. **fail-loud 优先**。wire 不支持时让请求显式失败（400/422），而不是静默
   降级成瞎子——静默降级会导致 agent 自信地答 "NO VIDEO" 并错误收尾。

## 已知取舍

- **上游采样 fps 不可控**。GLM 视频管线内部 ~1fps 采样；模型感知到的
  "N 帧离散画面" 就是原生态。瞬态缺陷（中间帧闪现字幕）会漏，需要
  agent 侧 ffmpeg 高密度补扫。
- **token 计量**：P24 给 video 块固定 4096 token 启发式。真实成本随时长
  变化（4s ≈ 490，长片可到数万），如需精确要给块加 duration 元数据。
- **P25 只保留最新一个视频**的 data URL。多视频对照场景（对比两段视频）
  会被降级——发生时模型会看到 `[earlier video omitted…]` 文本占位。
- **responses wire 的 video_url 合同未验证**。透传形状镜像 completions；
  上游若拒绝会 400（fail-loud），届时该 provider 声明去掉 video 即回退
  P20 抽帧。
