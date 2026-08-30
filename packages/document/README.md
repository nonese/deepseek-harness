---
description: "Package map for workspace-confined Word, PowerPoint, and Excel artifact generation."
kind: "package-group"
---

# document/ — Office artifact capability family

English | [中文](README.zh.md)

## Summary

The `document/` group creates Word, PowerPoint, and Excel files inside an agent's current project. The capability is split into a Service Definition, a local OOXML provider, and model-facing tools. The shipped Web host mounts the provider, while the Teacher preset grants the tools.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`artifacts/`](artifacts/README.md) | Typed Word, PowerPoint, and Excel creation service | `ctx.documentArtifacts` |
| [`artifacts-local/`](artifacts-local/README.md) | Local OOXML generation, validation, and atomic project publication | provides `ctx.documentArtifacts` |
| [`tool-artifacts/`](tool-artifacts/README.md) | Model-facing `create_word_document`, `create_presentation`, and `create_spreadsheet` tools | consumes `ctx.documentArtifacts` |

-----

<a id="related-documentation"></a>
## Related documentation

- [Document artifacts subsystem](../../docs/subsystems/document-artifacts.md) — service requests, provider safety rules, and tool behavior.
- [Capability seams](../../docs/capability-seams.md) — Service Definition / Service Provider / Consumer ownership.
- [Agent presets](../preset/agent-presets/README.md) — how Teacher mode selects the tool consumer per session.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
