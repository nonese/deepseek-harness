---
description: "Local OOXML generation for users and maintainers creating Word, PowerPoint, and Excel files inside a project."
kind: "package-reference"
---

# @deepseek-ai/dsh-artifacts-local

English | [中文](README.zh.md)

## Summary

`dsh-artifacts-local` is the local provider behind `ctx.documentArtifacts`. It renders `.docx`, `.pptx`, and `.xlsx` archives with maintained JavaScript libraries, validates required OOXML parts before publication, and writes the result atomically below the calling session's current project. It rejects absolute, hidden, escaping, and symbolic-link paths and never replaces an existing file unless the request explicitly opts into overwrite.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the provider once on the host. Presets or other scoped consumers can then call the shared service without loading a separate renderer per user.

```yaml
- name: '@deepseek-ai/dsh-artifacts-local'
```

| Field | Default | Meaning |
|---|---:|---|
| `maxWordSections` | `64` | Maximum sections in one Word document |
| `maxPresentationSlides` | `80` | Maximum slides in one presentation |
| `maxSpreadsheetSheets` | `20` | Maximum worksheets in one workbook |
| `maxSpreadsheetRowsPerSheet` | `10,000` | Maximum rows per worksheet |
| `maxSpreadsheetCells` | `100,000` | Maximum populated cells across a workbook |
| `maxTextChars` | `1,000,000` | Aggregate request-text limit |
| `maxOutputBytes` | `100 MiB` | Maximum generated archive size |
| `fontFamily` | `Aptos` | Default document font |
| `accentColor` | `2F6FEB` | Six-digit theme color |

Output directories must already exist. A successful request returns only after the archive has been structurally checked and atomically published. Word files use styled headings, paragraphs, bullets, and tables. Presentations use widescreen title, section, content, or two-column layouts with optional speaker notes. Workbooks use styled headers, calculated formulas, optional filters and frozen headers, fitted columns, and number formats.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The provider renders into memory under explicit input and output limits, opens the generated ZIP with JSZip, verifies the required Word document, PowerPoint slide, or Excel workbook and worksheet parts, and only then resolves the target. Target resolution canonicalizes the workspace and parent directory, refuses dot segments and symbolic links, and stages bytes in a mode-`0600` temporary file. Exclusive hard-link publication prevents a same-name race; explicit overwrite rechecks the target before an atomic rename.

`docx` owns Word package creation, PptxGenJS owns PowerPoint creation, and ExcelJS owns workbook creation. The provider presents one stable typed service to the rest of Harness so these libraries do not leak into tool schemas or presets.

-----

<a id="further-exploration"></a>
## Further Exploration

- [Service Definition](../artifacts/README.md) — shared requests and provider obligations.
- [Model-facing tools](../tool-artifacts/README.md) — the consumer used by Teacher mode.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-artifacts-local) — exhaustive accepted fields.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through a model-facing consumer. This host provider adds no prompt text or schema; its validation failures become ordinary tool errors through the calling consumer.

#### KV Cache effect

None by itself. Generated files and results are appended only when a consumer invokes the service.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The provider creates new structured files; it does not edit arbitrary existing Office files or preserve unsupported features.
- It validates OOXML structure, not visual layout in Microsoft Office or LibreOffice.
- It does not convert artifacts to PDF or images for browser preview; users download the generated file from the project browser.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
