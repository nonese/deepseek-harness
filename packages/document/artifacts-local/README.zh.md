---
description: "供用户和维护者在项目内创建 Word、PowerPoint 与 Excel 文件的本地 OOXML 生成器。"
kind: "package-reference"
---

# @deepseek-ai/dsh-artifacts-local

[English](README.md) | 中文

## 概述

`dsh-artifacts-local` 是 `ctx.documentArtifacts` 背后的本地 Provider。它使用维护中的 JavaScript 库渲染 `.docx`、`.pptx` 与 `.xlsx` 压缩包，发布前校验必要的 OOXML 部件，并在调用会话的当前项目下原子写入结果。它拒绝绝对、隐藏、越界和符号链接路径，除非请求明确启用覆盖，否则绝不替换现有文件。

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

在宿主上挂载一次 Provider。preset 或其他有作用域的 Consumer 随后可以调用共享服务，而无需为每名用户加载单独的渲染器。

```yaml
- name: '@deepseek-ai/dsh-artifacts-local'
```

| 字段 | 默认值 | 含义 |
|---|---:|---|
| `maxWordSections` | `64` | 单个 Word 文档的最大章节数 |
| `maxPresentationSlides` | `80` | 单份演示文稿的最大幻灯片数 |
| `maxSpreadsheetSheets` | `20` | 单个工作簿的最大工作表数 |
| `maxSpreadsheetRowsPerSheet` | `10,000` | 每个工作表的最大行数 |
| `maxSpreadsheetCells` | `100,000` | 工作簿全部已填充单元格上限 |
| `maxTextChars` | `1,000,000` | 请求文本总字符上限 |
| `maxOutputBytes` | `100 MiB` | 生成压缩包的最大大小 |
| `fontFamily` | `Aptos` | 默认文档字体 |
| `accentColor` | `2F6FEB` | 六位主题颜色 |

输出目录必须已经存在。成功请求只有在压缩包完成结构检查并原子发布后才返回。Word 文件使用带样式的标题、段落、项目符号与表格；演示文稿使用宽屏标题、章节、内容或双栏布局并可附讲者备注；工作簿使用带样式的表头、计算公式、可选筛选和冻结表头、自适应列宽与数字格式。

-----

<a id="understand-the-implementation"></a>
## 理解实现

Provider 在明确的输入和输出限制下渲染到内存，用 JSZip 打开生成的 ZIP，校验必要的 Word 主文档、PowerPoint 幻灯片或 Excel 工作簿与工作表部件，然后才解析目标路径。目标解析会规范化 workspace 与父目录，拒绝点路径段和符号链接，并把字节暂存为权限 `0600` 的临时文件。独占硬链接发布可阻止同名竞争；明确覆盖会在原子重命名前再次检查目标。

`docx` 负责创建 Word 包，PptxGenJS 负责创建 PowerPoint，ExcelJS 负责创建工作簿。Provider 向 Harness 其余部分提供一个稳定的有类型服务，使这些库不会泄漏到工具 schema 或 preset。

-----

<a id="further-exploration"></a>
## 进一步了解

- [Service Definition](../artifacts/README.zh.md) — 共享请求与 Provider 义务。
- [面向模型的工具](../tool-artifacts/README.zh.md) — 教师模式使用的 Consumer。
- [生成的配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-artifacts-local) — 全部可接受字段。

-----

<a id="model-experience"></a>
## 模型体验

通过面向模型的 Consumer 间接影响。此宿主 Provider 不增加提示文本或 schema；其校验错误会通过调用方 Consumer 变为普通工具错误。

#### KV Cache 影响

自身没有影响。只有 Consumer 调用服务时，生成文件和结果才会追加到会话。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- Provider 创建新的结构化文件；它不会编辑任意现有 Office 文件或保留不受支持的功能。
- 它校验 OOXML 结构，不校验 Microsoft Office 或 LibreOffice 中的视觉布局。
- 它不会把产物转换为 PDF 或图片供浏览器预览；用户从项目文件浏览器下载生成文件。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
