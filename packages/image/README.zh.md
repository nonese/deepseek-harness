---
description: "提供方无关图片生成、Dreamina CLI 提供方及面向模型图片工具的包映射。"
kind: "package-group"
---

# image/ — 图片生成能力系列

[English](README.md) | 中文

## 概要

`image/` 组在 agent 当前工作区内生成光栅图片资源。该能力拆分为 Service Definition、Dreamina CLI 提供方和面向模型的工具。随包 Product Design preset 把三者挂载在一个私有 realm 中，固定使用 Dreamina 图片 4.0 与 2K，并使其他 preset 看不到这些工具。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`image-generation/`](image-generation/README.zh.md) | 有类型的提交、恢复与工作区发布服务 | `ctx.imageGeneration` |
| [`image-generation-dreamina/`](image-generation-dreamina/README.zh.md) | 本地 Dreamina CLI 执行、校验、串行化及 PNG 原子发布 | 提供 `ctx.imageGeneration` |
| [`tool-image-generation/`](tool-image-generation/README.zh.md) | 面向模型的 `generate_image` 与 `collect_generated_image` 工具 | 使用 `ctx.imageGeneration` |

-----

<a id="related-documentation"></a>
## 相关文档

- [图片生成子系统](../../docs/subsystems/image-generation.zh.md)——请求、任务生命周期、工作区限制和附件投影。
- [能力 seam](../../docs/capability-seams.zh.md)——Service Definition / Service Provider / Consumer 的归属。
- [Agent preset](../preset/agent-presets/README.zh.md)——选择本能力的 Product Design 组装。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
