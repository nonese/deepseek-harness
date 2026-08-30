# 文档产物

[English](document-artifacts.md) | 中文

文档产物 seam 在一个 agent workspace 下创建 Word、PowerPoint 与 Excel 文件。其 Service Definition（[dsh-artifacts](../../packages/document/artifacts)，`ctx.documentArtifacts`）携带提供方中立的结构化请求。本地 Service Provider（[dsh-artifacts-local](../../packages/document/artifacts-local)）渲染并校验 Office Open XML 压缩包。Consumer（[dsh-tool-artifacts](../../packages/document/tool-artifacts)）注册教师模式使用的三个面向模型的创建工具。

## 请求与结果

每个请求都包含由受信同进程会话上下文提供的绝对 `cwd`、模型给出的相对 `outputPath`、明确的可选覆盖选择，以及某一产物系列的结构化内容。Word 文档包含带标题的章节、段落、项目符号与表格；演示文稿包含标题、章节、内容或双栏幻灯片及可选讲者备注；工作簿包含命名工作表、行、公式、筛选、冻结表头与数字格式。

每次操作都返回 `DocumentArtifactResult`：OOXML 系列、规范的 workspace 相对路径、压缩包字节大小、章节/幻灯片/工作表数量，以及字面量 `validation: 'ooxml'` 标记。Promise 成功意味着校验和发布均已完成；被拒绝的操作不会发布结果。

## Workspace 与发布规则

Service Definition 要求每个 Provider 把输出限制在 `cwd` 下，拒绝符号链接逃逸，校验生成的压缩包并原子发布。本地 Provider 还会拒绝绝对路径、点或隐藏路径段、不存在的输出目录、现有的非普通文件，以及未设置 `overwrite: true` 的同名写入。它在配置的文本、项目、单元格与输出字节限制下渲染，检查该文件系列要求的部件，暂存到权限为 `0600` 的临时文件，并在不暴露部分字节的情况下发布。

本地 Provider 是所有用户共享的一个宿主服务。它不携带用户状态：调用 agent 在每次操作时提供自己的受信 workspace，而服务器现有的项目所有权规则决定哪个目录成为该会话的 workspace。

## Consumer 与教师模式

`create_word_document`、`create_presentation` 与 `create_spreadsheet` 都不接受 workspace 参数。Consumer 从 `exec.agent.session.header.cwd` 派生它，并拒绝没有所属 agent 的调用。教师模式把标准工具集与这三个工具及教学 persona 组合起来，覆盖教学目标、教学流程、评价、差异化支持、演示文稿备注与结构化教学数据。其他内置 preset 保持其原有工具目录。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxdocumentartifacts--documentartifactruntime-abstract-seam"></a>

### `ctx.documentArtifacts` — `DocumentArtifactRuntime` (abstract seam)

Office artifact generation service. Implementations must keep `outputPath` below `cwd`, reject symbolic-link escapes, validate the generated OOXML archive, and publish atomically.

```ts cordis-catalog
/**
 * Create a Word document.
 * @param request - trusted workspace root plus model-authored document content.
 * @param signal - aborts before publication.
 * @returns the published artifact metadata.
 */
abstract createWord(request: WordDocumentRequest, signal?: AbortSignal): Promise<DocumentArtifactResult>

/**
 * Create a PowerPoint presentation.
 * @param request - trusted workspace root plus model-authored slide content.
 * @param signal - aborts before publication.
 * @returns the published artifact metadata.
 */
abstract createPresentation(request: PresentationRequest, signal?: AbortSignal): Promise<DocumentArtifactResult>

/**
 * Create an Excel workbook.
 * @param request - trusted workspace root plus model-authored workbook content.
 * @param signal - aborts before publication.
 * @returns the published artifact metadata.
 */
abstract createSpreadsheet(request: SpreadsheetRequest, signal?: AbortSignal): Promise<DocumentArtifactResult>
```

Source: [`packages/document/artifacts/src/index.ts`](../../packages/document/artifacts/src/index.ts)
<!-- END GENERATED cordis-surface -->
