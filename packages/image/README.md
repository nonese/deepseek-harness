---
description: "Package map for provider-neutral image generation, the Dreamina CLI provider, and model-facing image tools."
kind: "package-group"
---

# image/ — image generation capability family

English | [中文](README.zh.md)

## Summary

The `image/` group generates raster assets inside an agent's current workspace. The capability is split into a Service Definition, a Dreamina CLI provider, and model-facing tools. The shipped Product Design preset mounts all three in one private realm, pins Dreamina image 4.0 at 2K, and keeps the tools absent from other presets.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`image-generation/`](image-generation/README.md) | Typed submit, resume, and workspace-publication service | `ctx.imageGeneration` |
| [`image-generation-dreamina/`](image-generation-dreamina/README.md) | Local Dreamina CLI execution, validation, serialization, and atomic PNG publication | provides `ctx.imageGeneration` |
| [`tool-image-generation/`](tool-image-generation/README.md) | Model-facing `generate_image` and `collect_generated_image` tools | consumes `ctx.imageGeneration` |

-----

<a id="related-documentation"></a>
## Related documentation

- [Image generation subsystem](../../docs/subsystems/image-generation.md) — requests, task lifecycle, workspace confinement, and attachment projection.
- [Capability seams](../../docs/capability-seams.md) — Service Definition / Service Provider / Consumer ownership.
- [Agent presets](../preset/agent-presets/README.md) — the Product Design composition that selects this capability.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
