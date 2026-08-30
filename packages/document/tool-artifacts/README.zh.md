---
description: "供用户和维护者组装教学工作流的面向模型 Word、PowerPoint 与 Excel 创建工具。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-artifacts

[English](README.md) | 中文

## 概述

`dsh-tool-artifacts` 注册三个面向模型的工具：`create_word_document`、`create_presentation` 与 `create_spreadsheet`。每个工具接收结构化内容，从调用 agent 会话取得受信的 workspace 根目录，再把生成委托给 `ctx.documentArtifacts`。教师模式随附这些工具；其余内置模式保持原有目录。

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

先在宿主挂载一个 `ctx.documentArtifacts` Provider，再把此 Consumer 加入 agent preset：

```yaml
- name: '@deepseek-ai/dsh-tool-artifacts'
```

| 工具 | 主要输入 | 结果 |
|---|---|---|
| `create_word_document` | 相对 `.docx` 路径、标题、章节、段落、项目符号、表格 | 已校验 Word 文件元数据 |
| `create_presentation` | 相对 `.pptx` 路径、标题、有类型幻灯片、讲者备注 | 已校验 PowerPoint 元数据 |
| `create_spreadsheet` | 相对 `.xlsx` 路径、工作表、行、公式、格式 | 已校验 Excel 元数据 |

模型不能选择绝对 workspace 根目录。`output_path` 始终解析到调用会话的项目下，同名替换必须设置 `overwrite: true`。成功调用渲染为文件编辑卡片并暴露创建路径，因此浏览器的“生成文件”区域和项目文件浏览器可以打开或下载文件。

-----

<a id="understand-the-implementation"></a>
## 理解实现

插件负责 schema、模型描述、结果文本及 UI 呈现；它不导入渲染库，也不自行写文件。工具执行读取 `exec.agent.session.header.cwd`；没有所属 agent 的调用在到达 Provider 前失败。规范结果保持结构化，模型则收到包含文件类型、路径、字节数和内容项目数的紧凑确认。

-----

<a id="further-exploration"></a>
## 进一步了解

- [Service Definition](../artifacts/README.zh.md) — 提供方中立的请求与结果类型。
- [本地提供方](../artifacts-local/README.zh.md) — 校验与文件系统安全。
- [生成的工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-artifacts) — 完整 schema。
- [教师 preset](../../preset/agent-presets/README.zh.md) — 按会话选择这些工具。

-----

<a id="model-experience"></a>
## 模型体验

### 工具

#### 模型会看到什么

此插件处于活动状态时，模型会看到 `create_word_document`、`create_presentation` 和 `create_spreadsheet`。描述要求它使用项目相对的 Office 扩展名、保持演示文稿简洁，并优先使用公式计算电子表格派生值。每个成功结果都说明创建类型、项目相对路径、字节大小及章节、幻灯片或工作表数量。Provider 校验失败会成为普通工具错误，不会发布部分文件。

#### Token 影响

插件启用期间，三个工具 schema 与描述会增加固定请求前缀开销。只有调用工具时才会追加文档内容与生成元数据。

#### KV Cache 影响

对保持同一 preset 的每个会话保持前缀稳定。新会话切换到包含这些工具的 preset 或离开它时，工具目录会变化，并使该目录位置之后的缓存失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 工具创建结构化文件，但不解析或修改任意上传的 Office 文档。
- 幻灯片布局以文本为主；未暴露图片放置、图表、动画和任意母版编辑。
- 生成的 Office 文件可以下载，但不会转换为浏览器内视觉预览。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
