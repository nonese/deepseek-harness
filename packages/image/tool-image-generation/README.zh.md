---
description: "面向模型的工作区图片生成提交与恢复工具。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-image-generation

[English](README.md) | 中文

## 概述

`dsh-tool-image-generation` 注册 `generate_image` 与 `collect_generated_image`。前者提交提示词、测量后的宽高比和项目相对 PNG 路径；后者恢复返回的待完成任务，而不会为重复提交消耗点数。完成结果已经位于工作区内，并会先提交到 DSH 持久附件存储，再让工具结果携带图片 block。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在 `ctx.imageGeneration`、`ctx.attachments`、`ctx.llm` 和工具注册表旁挂载：

```yaml
- name: '@deepseek-ai/dsh-tool-image-generation'
```

调用会话必须拥有工作区和支持图片的模型路线。严格路线门会在提供方工作前执行，使纯文本路线不会先消耗 Dreamina 点数，再因生成图片进入模型上下文而失败。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`generate_image` 要求 `prompt`、`aspect_ratio` 与 `output_path`，`overwrite` 可选。`collect_generated_image` 要求之前的 `task_id` 和所选输出路径。两者返回规范 pending/completed 联合。完成分支包含提供方、模型、分辨率、任务、文件、大小、尺寸和持久图片引用元数据；原始字节不会进入规范 JSON 值。

渲染器输出文本及一个持久图片 block。调用时 presentation 是纯函数，并为所选工作区路径使用 edit 类位置。工具 schema 保持提供方无关；随包 Product Design preset 的描述则明确其 Dreamina 4.0 2K 选择。

-----

<a id="further-exploration"></a>
## 进一步探索

- [图片生成服务](../image-generation/README.zh.md)——提供方无关生命周期。
- [Dreamina 提供方](../image-generation-dreamina/README.zh.md)——subprocess 与发布行为。
- [工具编写](../../../docs/cookbook/adding-a-tool.zh.md)——规范值、渲染和 presentation。

-----

<a id="model-experience"></a>
## 模型体验

### 工具 schema

#### 模型所见内容

Product Design preset 启用时，模型会看到 [`generate_image` 和 `collect_generated_image`](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-image-generation)。提交 schema 要求模型测量目标槽位、选择支持的宽高比、提供详细提示词，并创建项目相对 PNG。收集 schema 要求模型恢复准确的待完成 ID 和路径，而不是再提交一项计费任务。完成调用会渲染生成图片及元数据；待完成调用只渲染可恢复 ID 和指引。

#### Token 影响

Product Design preset 启用时，两个 schema 及其描述会增加固定的请求前缀成本。只有提供方发布且附件提交后，每次调用的元数据和图片内容才会进入会话历史。

#### KV Cache 影响

只要会话保持使用 Product Design preset 和相同工具目录，请求前缀就保持稳定。切换 preset 会改变目录；每个完成结果则会用生成图片块及其元数据扩展历史。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 当前 schema 每次创建一张 PNG，不接受参考图、蒙版或批量请求。
- 即使用户只想取得输出文件，路线也必须明确声明图片输入；这可以防止生成图片破坏下一次模型请求。
- Web 端目前使用通用工具行展示结果；专用进度/图片卡片延后处理。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
