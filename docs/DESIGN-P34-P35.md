# P34/P35 — 毒视频熔断 + 时长地板（2026-09-12 事故驱动）

## 事故

zcode QA 会话（session-68cdbcc8）13:47 起 **0 成功 / 22 失败** 卡死。根因链：

1. 13:06 agent 读入 `sb-008-d1.0-2490.mp4`（**1.657s**）→ 上游（DashScope 后端）拒绝：`InvalidParameter: The video file is too short`
2. P32 规则"最新视频无条件内联" → 毒丸永久驻留 wire → 每次请求 400（包装成 `openai_error/bad_response_status_code`）→ 重试再撞 → **会话砖化**（用户发纯文本也救不了，毒丸在历史里）
3. 同节点本会话无恙（无毒丸）——证实是 payload 问题而非路由问题

P32 的设计缺口：**无条件最新 = 没有逃生通道**。

## P34 — 毒视频熔断（dsh-llm-pi-ai）

- 模块级 `__p34Poison` Set（key = url 长度 + 首尾 48 字符，上限 64 条自动清空）
- **触发**：stream 生成器 yield 点拦截 `{type:"finish", reason:{kind:"error"}}` 块，消息匹配 `400|404|422|invalid_request|bad_response_status_code|video modality|InvalidParameter` 且本次请求内联过视频（`p34Active = containsVideo && !videoToFrames`）→ 标记当前最新内联视频为毒
- **效果**：pi-ai 的 retry 层下一次尝试自动降级毒丸、**次新视频顶上**（`keptAny` 逻辑：最新非毒块无条件保留）；全部中毒 → 全降级 → 会话以纯文本存活
- 自愈无需人工：zcode 会话重启后第一次重试即触发熔断

## P35 — 时长地板（dsh-tool-fs）

- read_image 视频分支：从字节直接解析 **MP4 mvhd**（零依赖、无 ffprobe；v0/v1 两版 timescale/duration）
- `dur < DSH_VIDEO_MIN_DURATION_SEC`（默认 2.0s，实测阈值在 1.66–2.36 之间）→ fail-loud 拒绝，附"用更长片段或自行抽帧"指引
- 解析失败（webm/异常结构）→ 跳过检查（P34 兜底）
- 毒丸从**入口**进不了历史

## 验证（真实提取函数 eval，tools/stage-p34-p35.cjs 同源）

```
poison suite: keep1(B only)=true  swap(A takes over)=true  all-degraded(survive)=true
mvhd:         rgblight=4.00s(放行)  poison2490=1.66s(拒绝)
repack:       unpacked 集 294/294 精确一致, delta +3066B, 包内标记全在
```

## 质量红线复核

P34/P35 均不改动任何送达模型的字节：保留块原样、被拒内容只发生在**入口拒绝**与**降级占位**（既有 P25/P32 语义）。


## 事故与修复（P36/P37，2026-09-12 14:29-14:47）

**P34/P35 部署后应用崩溃进恢复模式**。根因（并行会话修复者定位）：P35 插入锚点用了裸 'function assertVideoCapableRoute(' —— 它是 'async function assertVideoCapableRoute(' 的子串，replace 把 async 吞进 helper 头部，守卫函数失去 async 而体内有 await → **ESM 编译期语法错误** → 插件树加载失败。

三条教训（已固化进 tools/stage-p34-p37.cjs）：
1. **锚点必须全行语义**：改用 async function 前缀 + 插入后双向断言（helper 无 async、守卫保留 async）
2. **node --check 对 ESM 不可信**（实测漏检 await-in-non-async）：验证一律复制为 .mjs 强制 ESM parse（或 vm.SourceTextModule）
3. **源树漂移**：补丁只进装机 asar 会被下次重打包管线吞掉 —— P37 起部署脚本自动回写 runtime/v209-patched-tree

**P37**：helper 恢复同步（dur 从 Promise 变回数字，P35 时长地板真正生效：1.66s 拒 / 4.0s 放实测过）。out4 已打包并 294/294 集校验 + 哈希闭环 + ESM 双文件通过；watcher 挂机等下次自然重启，无需专门操作。