# 排障手册（实战踩坑全记录）

本文按"症状 → 根因 → 修法"组织，全部条目来自 2026-09 真实排障。

---

## 1. 400 `read body failed` (gateway_error, 400001)

**症状**：LLM 请求间歇性 400，重试延迟 ~2s 后成功。
**根因**：b.ai 网关对请求 body 有读取上限。多视频历史（每视频 data URL
433–580KB base64）叠加后 body 数 MB，间歇越限。
**修法**：P25 —— 请求构建时只保留最新视频的 data URL，更早的降级文本。
**判别**：`tools/pt-check.mjs` 看 video 块前后的 inputTokens 跳变。

---

## 2. responses wire 400 `…did not match any variant of untagged enum InputParam`

**症状**：走 openai-responses api 的 provider，发视频即 400（Rust serde 反序列化）。
**根因**：responses wire 的 input 枚举没有视频类型；`video_url` 透传形状不被接受。
**修法**：该 provider 的模型声明去掉 `video`（改 `[text, image]`）→ P20 抽帧接管。
P22 的透传分支保留（fail-loud），等上游支持后再声明回来。

---

## 3. completions 上游 `pt=56 :: NO VIDEO`

**症状**：请求 200、prompt_tokens≈55-56，模型答 "NO VIDEO"。
**根因**：b.ai/tokenrouter 的 glm-5.3-flash 上游池混布——部分节点吃 video_url
（计 pt≈500+ 并真实看帧），部分节点在计数前静默剥离。
**关键认知**：pt 无法区分"网关剥"与"未发"（剥离发生在计数前）；用已知好
上游（qwen3.8-flash 4/4）做对照实验才能定位。
**修法**：重发命中好节点；或该会话切 qwen3.8-flash。

---

## 4. `JsonSchemaError: unsupported JSON schema`（工具注册失败）

dsh-tools 的自定义 schema 方言规则（defineTool 编译时强制）：

- 每个 object **必须显式** `additionalProperties: true | false`（省略 = 报错）
- `required` 字段**只能为 true**；可选属性 = 整行省略（`required: false` 报错
  "must be true when present"）

P21 首版连踩两次：video 子对象缺 `additionalProperties: true`（整个
applyReadImageTool 注册失败、read_image 消失）；IMAGE_VALUE_SCHEMA 改
`required: false`（再次注册失败）。两次都只有启动错误日志
（`%APPDATA%\DSH Desktop\logs\dsh-*.error.log`）有痕迹。

**教训**：给 bundled 工具打补丁后，先 `node --check`，再翻 error log 找
`JsonSchemaError`——注册失败不会在任何会话里报错。

---

## 5. 视频块在会话日志里存在，但模型说"没看到"

分四层排查（自上而下）：

1. **UI 附件层**：浏览器加载的是预构建 bundle（`assets/index-*.js`），
   patch lib 源码 ≠ patch 浏览器代码。确认 served bundle 含 encodeVideo
   （grep `/plugins/@deepseek-ai/dsh-client-ui-conversation/client.js`）。
2. **apiproxy 层**：`promptContentPartSchema` 无 `video` 臂 → 400。P18 修复。
3. **管线层**：`videoToFrames` 分流 + P25 body 守护。确认 request/header
   后模型 reasoning 是否引用了 P20 标记（`frame i/n`）——引用了 = 抽帧路
   成功；没引用且答 NO VIDEO = wire 层丢弃。
4. **wire 层**：见上文 2/3 条。

---

## 6. 工具"解锁成功"但 catalog 里没有

preset 的 `tool-bootstrap` 用 `unlockedFor(session)` 扫 `tool/call` 事件的
`toolNames` 参数解锁。解锁只改 **keep 集合**；如果工具本身没注册（如
read_image 依赖 attachments 服务挂载），keep 过滤是 no-op——catalog 不变、
无 header change 事件。先确认服务挂载，再谈解锁。

`read_image` 注册条件：`ctx.inject(['attachments'])` —— 附件服务必须挂载。
快速验证：对该会话发一个纯图片 session.prompt，图片路径若正常工作则服务
已挂载。

---

## 7. 计量虚高：`对话消息 609K` 但总量 331K

**根因**：`dsh-token-meter` 的 `estimateContent` default 分支按
`JSON.stringify(block).length / 4` 计费——video 块的 data URL（约 1.6MB）
被当文本计 ≈ +400K 虚假 token。
**修法**：P24 `case "video": tokens += VIDEO_BLOCK_TOKENS (4096)`。
**注意**：该估算只供 UI 展示；compaction 触发用的是真实 usage
（thresholdRatio × contextWindow），虚高不影响行为。

---

## 8. git diff --no-index 的退出码陷阱

`git diff --no-index` 在文件**有差异**时退出码为 1（无差异为 0）。
execFileSync 对非零退出码抛异常，但 diff 内容已在 e.stdout 里。
捕获 status===1 并取 e.stdout，否则拿不到 diff。

---

## 9. 助手"自救"污染测试结论

模型收到 "看一下这个视频" 却没有视觉输入时，会自主：搜 workspace → 翻
session 日志挖 base64 → 自己 ffprobe/ffmpeg 解码 → 给出**正确**答案。
这会让"链路已通"的假象以最高置信度出现。判别方法：
- 查工具调用序列里有没有 pwsh/ffmpeg（有 = 自救）
- 看模型是否引用 P20 标记 `frame i/n`（引用了 = 抽帧路成功）
- usage 跳变量级（+500 ≈ 4KB 视频摄入；+100 ≈ 只有文本）
**测试视频识别类问题时，prompt 必须显式禁止工具使用。**
