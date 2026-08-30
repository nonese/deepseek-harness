---
description: "供维护者组装或实现 Word、PowerPoint 与 Excel 生成的有类型 Office 产物服务。"
kind: "package-reference"
---

# @deepseek-ai/dsh-artifacts

[English](README.md) | 中文

## 概述

`dsh-artifacts` 定义 `ctx.documentArtifacts`，即在一个受信 workspace 内创建 Word、PowerPoint 与 Excel 文件的提供方中立服务。Consumer 提供会话的绝对 workspace 和相对输出路径及结构化内容；Provider 必须限制路径、校验 OOXML 压缩包并原子发布。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步了解](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

部署需要不同生成器或存储后端时，实现 `DocumentArtifactRuntime`。`createWord`、`createPresentation` 与 `createSpreadsheet` 接收结构化请求，并返回产物类型、项目相对路径、字节大小、项目数及已完成 OOXML 校验标记。

workspace 根目录来自受信的同进程上下文。相对输出路径和全部文档内容都可能由模型给出，因此每个 Provider 都必须强制 workspace 限定、符号链接安全、输出限制、结构校验及原子发布。

-----

<a id="understand-the-implementation"></a>
## 理解实现

本包包含共享请求/结果类型及抽象 Cordis 服务，不选择渲染库，也不访问文件系统。Word 请求由带标题的段落、可选项目符号和表格组成；演示文稿请求由明确的幻灯片布局与讲者备注组成；电子表格请求由工作表、行、公式、筛选、冻结与数字格式组成。

-----

<a id="further-exploration"></a>
## 进一步了解

- [本地提供方](../artifacts-local/README.zh.md) — 随项目交付的 OOXML 实现。
- [面向模型的工具](../tool-artifacts/README.zh.md) — 供 agent 使用的结构化工具 schema。
- [文档产物子系统](../../../docs/subsystems/document-artifacts.zh.md) — 完整归属与数据流。

-----

<a id="model-experience"></a>
## 模型体验

通过 `dsh-tool-artifacts` 等 Consumer 间接影响；Service Definition 自身不增加提示词段落或工具 schema。

#### KV Cache 影响

自身没有影响。注册工具或提示指引的 Consumer 负责对应的请求前缀变化。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 请求覆盖结构化文本、表格、公式和一组较小的固定幻灯片布局；任意 OOXML 编辑不属于此服务。
- 服务只描述生成；把文件转换为 PDF 或图片进行预览属于另一项能力。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
