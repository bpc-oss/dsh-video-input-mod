# Provider 能力矩阵（2026-09-10 实测）

测试介质：`rgblight.mp4`（4KB，8 帧 @2fps，红 0-2s / 绿 2-3s / 蓝 3-4s），
内容可盲判。判定通道：usage inputTokens 跳变量级 + 模型回答颜色序列。

## 原生 video_url（模型声明 video）

| Provider | api | 结果 | 采样 |
|---|---|---|---|
| bai · qwen3.8-flash | openai-completions | ✅ 4/4 全对（pt≈403-514） | 直连 + DSH 管线 |
| bai · glm-5.3-flash | openai-completions | ⚠️ 3/12 全对、9/12 剥离 | 直连多点采样；上游池混合 |
| tokenrouter · glm-5.3-free | completions | ❌ 4/4 剥离（pt=56） | 直连 |
| tokenrouter · glm-5.3-free | responses | ❌ 400 serde 拒收 | 直连 |
| teamoroute · glm-5.3-flash-free | responses | ⚠️ 未实测（免费额度限制） | — |
| 本地 DGX Spark · GLM-5.3-Flash-EXL3 | completions | ⚠️ 未实测（服务异常） | — |

## P20 抽帧（模型声明 [text,image]）

| Provider | 结果 | 备注 |
|---|---|---|
| bai · glm-5.3-flash | ✅ 4 帧 + t≈ 标记 | fps=1，帧内容与源逐像素一致 |

## 图片对照（管线健全性）

| Provider | 结果 |
|---|---|
| bai · glm-5.3-flash | ✅ 红方块识别正确 |
| bai · qwen3.8-flash | ✅ |

## 结论

- **qwen3.8-flash (bai)**：原生视频首选，无抽奖。
- **glm-5.3-flash (bai)**：~25% 节点支持；失败重发即可，或 P20 抽帧。
- **responses wire 家族**：video_url serde 拒收 → 声明 [text,image] 走 P20。
- **tool-result 内嵌视频**：completions wire 上视频块被工具消息序列化丢弃，
  P23 将其搭到后续 user 消息（"Attached media(s) from tool result:"）后
  glm/qwen 均实测通过（usage +582/+1473）。
