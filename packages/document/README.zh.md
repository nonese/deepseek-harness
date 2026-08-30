---
description: "限定在 workspace 内的 Word、PowerPoint 与 Excel 产物生成包映射。"
kind: "package-group"
---

# document/ — Office 产物能力系列

[English](README.md) | 中文

## 概要

`document/` 组在 agent 当前项目内创建 Word、PowerPoint 与 Excel 文件。该能力拆分为 Service Definition、本地 OOXML 提供方和面向模型的工具。随 Web 交付的宿主挂载提供方，教师模式则授予工具。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`artifacts/`](artifacts/README.zh.md) | 有类型的 Word、PowerPoint 与 Excel 创建服务 | `ctx.documentArtifacts` |
| [`artifacts-local/`](artifacts-local/README.zh.md) | 本地 OOXML 生成、校验及项目内原子发布 | 提供 `ctx.documentArtifacts` |
| [`tool-artifacts/`](tool-artifacts/README.zh.md) | 面向模型的 `create_word_document`、`create_presentation` 与 `create_spreadsheet` 工具 | 使用 `ctx.documentArtifacts` |

-----

<a id="related-documentation"></a>
## 相关文档

- [文档产物子系统](../../docs/subsystems/document-artifacts.zh.md) — 服务请求、提供方安全规则与工具行为。
- [能力 seam](../../docs/capability-seams.zh.md) — Service Definition / Service Provider / Consumer 的归属。
- [Agent preset](../preset/agent-presets/README.zh.md) — 教师模式如何按会话选择工具 Consumer。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
