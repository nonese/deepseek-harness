# Document Artifacts

English | [中文](document-artifacts.zh.md)

The document-artifact seam creates Word, PowerPoint, and Excel files below one agent workspace. Its Service Definition ([dsh-artifacts](../../packages/document/artifacts), `ctx.documentArtifacts`) carries provider-neutral structured requests. The local Service Provider ([dsh-artifacts-local](../../packages/document/artifacts-local)) renders and validates Office Open XML archives. The Consumer ([dsh-tool-artifacts](../../packages/document/tool-artifacts)) registers the three model-facing creation tools used by the Teacher preset.

## Requests and results

Every request contains an absolute `cwd` supplied by trusted same-process session context, a model-authored relative `outputPath`, an explicit optional overwrite choice, and structured content for one artifact family. Word documents contain titled sections with paragraphs, bullets, and tables. Presentations contain title, section, content, or two-column slides and optional speaker notes. Workbooks contain named worksheets with rows, formulas, filters, frozen headers, and number formats.

Every operation returns `DocumentArtifactResult`: the OOXML family, canonical workspace-relative path, archive byte size, section/slide/sheet count, and a literal `validation: 'ooxml'` marker. Resolution means validation and publication completed; rejected operations publish no result.

## Workspace and publication rules

The Service Definition requires each provider to keep output below `cwd`, reject symbolic-link escape, validate the generated archive, and publish atomically. The local provider additionally rejects absolute paths, dot and hidden segments, missing output directories, non-regular existing targets, and same-name writes without `overwrite: true`. It renders under configured text, item, cell, and output-byte limits, checks the archive's required family-specific parts, stages a mode-`0600` temporary file, and publishes without exposing partial bytes.

The local provider is one host service shared by all users. It carries no user state: the calling agent supplies its own trusted workspace on every operation, and the server's existing project ownership rules decide which directory became that session workspace.

## Consumer and Teacher mode

`create_word_document`, `create_presentation`, and `create_spreadsheet` never accept a workspace argument. The consumer derives it from `exec.agent.session.header.cwd` and refuses calls without an owning agent. The Teacher preset combines the standard toolset with these three tools and a teaching persona covering lesson objectives, instructional sequence, assessment, differentiation, presentation notes, and structured teaching data. Other built-in presets retain their existing tool catalogs.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
