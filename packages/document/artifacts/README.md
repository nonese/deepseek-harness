---
description: "Typed Office artifact service for maintainers composing or implementing Word, PowerPoint, and Excel generation."
kind: "package-reference"
---

# @deepseek-ai/dsh-artifacts

English | [中文](README.zh.md)

## Summary

`dsh-artifacts` defines `ctx.documentArtifacts`, the provider-neutral service for creating Word, PowerPoint, and Excel files in one trusted workspace. Consumers supply an absolute session workspace plus a relative output path and structured content; providers must confine the path, validate the OOXML archive, and publish it atomically.

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

Implement `DocumentArtifactRuntime` when a deployment needs a different generator or storage backend. `createWord`, `createPresentation`, and `createSpreadsheet` accept structured requests and return the artifact kind, project-relative path, byte size, item count, and completed OOXML validation marker.

The workspace root is trusted same-process context. The relative output path and all document content may be model-authored, so every provider must enforce workspace confinement, symbolic-link safety, output limits, structural validation, and atomic publication.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The package contains the shared request and result types plus the abstract Cordis service. It does not select a rendering library or access the filesystem. Word requests contain titled sections, optional bullets and tables; presentation requests contain explicit slide layouts and speaker notes; spreadsheet requests contain sheets, rows, formulas, filters, freezes, and number formats.

-----

<a id="further-exploration"></a>
## Further Exploration

- [Local provider](../artifacts-local/README.md) — the shipped OOXML implementation.
- [Model-facing tools](../tool-artifacts/README.md) — structured tool schemas for agents.
- [Document artifacts subsystem](../../../docs/subsystems/document-artifacts.md) — complete ownership and data flow.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through consumers such as `dsh-tool-artifacts`; this Service Definition adds no prompt section or tool schema itself.

#### KV Cache effect

None by itself. A consumer that registers tools or prompt guidance owns the corresponding request-prefix change.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Requests cover structured text, tables, formulas, and a small fixed slide-layout set; arbitrary OOXML editing is not part of this service.
- The service describes generation only; preview conversion to PDF or images belongs to a separate capability.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
