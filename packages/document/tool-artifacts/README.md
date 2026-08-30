---
description: "Model-facing Word, PowerPoint, and Excel creation tools for users and maintainers composing teaching workflows."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-artifacts

English | [中文](README.zh.md)

## Summary

`dsh-tool-artifacts` registers three model-facing tools: `create_word_document`, `create_presentation`, and `create_spreadsheet`. Each tool takes structured content, obtains the trusted workspace root from the calling agent session, and delegates generation to `ctx.documentArtifacts`. The Teacher preset ships these tools; the other built-in presets keep their existing catalogs.

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

Mount a `ctx.documentArtifacts` provider on the host, then add this consumer to an agent preset:

```yaml
- name: '@deepseek-ai/dsh-tool-artifacts'
```

| Tool | Primary inputs | Result |
|---|---|---|
| `create_word_document` | relative `.docx` path, title, sections, paragraphs, bullets, tables | validated Word file metadata |
| `create_presentation` | relative `.pptx` path, title, typed slides, speaker notes | validated PowerPoint metadata |
| `create_spreadsheet` | relative `.xlsx` path, sheets, rows, formulas, formats | validated Excel metadata |

The model cannot choose an absolute workspace root. `output_path` is always resolved below the calling session's project, and same-name replacement requires `overwrite: true`. Successful calls render as file-edit cards and expose the created path so the browser's produced-files surface and project file browser can open or download it.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The plugin owns schemas, model descriptions, result text, and UI presentation. It does not import a rendering library or write files itself. Tool execution reads `exec.agent.session.header.cwd`; a call without an owning agent fails before it reaches the provider. The canonical result remains structured, while the model receives a compact confirmation containing the file kind, path, byte count, and content-item count.

-----

<a id="further-exploration"></a>
## Further Exploration

- [Service Definition](../artifacts/README.md) — provider-neutral request and result types.
- [Local provider](../artifacts-local/README.md) — validation and filesystem safety.
- [Generated tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-artifacts) — exhaustive schemas.
- [Teacher preset](../../preset/agent-presets/README.md) — per-session selection of these tools.

-----

<a id="model-experience"></a>
## Model Experience

### Tools

#### What the model sees

The model sees `create_word_document`, `create_presentation`, and `create_spreadsheet` while this plugin is active. Their descriptions tell it to use project-relative Office extensions, keep presentations concise, and prefer formulas for derived spreadsheet values. Each successful result states the created type, project-relative path, byte size, and section, slide, or sheet count. Provider validation failures appear as ordinary tool errors and do not publish a partial file.

#### Token effect

The three tool schemas and descriptions add a fixed request-prefix cost while the plugin is active. Document content and generated metadata are added only when the tools are called.

#### KV Cache effect

Prefix-stable for every session that keeps the same preset. Switching to or from a preset that includes these tools changes the tool catalog for the new session and invalidates reuse from that catalog position.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The tools create structured files but do not parse or revise an arbitrary uploaded Office document.
- Slide layouts are text-first; image placement, charts, animations, and arbitrary master editing are not exposed.
- Generated Office files are downloadable but are not converted into an in-browser visual preview.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
