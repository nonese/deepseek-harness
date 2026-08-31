---
description: "Provider-neutral image generation service for maintainers composing or implementing visual providers."
kind: "package-reference"
---

# @deepseek-ai/dsh-image-generation

English | [中文](README.zh.md)

## Summary

`dsh-image-generation` defines `ctx.imageGeneration`, the provider-neutral service for submitting one image task, resuming a pending task, and publishing a completed PNG inside one trusted workspace. Consumers supply the calling session's absolute workspace root and a model-authored relative output path; providers return either a resumable task or validated bytes already published at that path.

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

Implement `ImageGenerationRuntime` when a deployment needs another provider. `generate()` receives a prompt, aspect ratio, output path, and overwrite decision. `collect()` receives the same workspace facts plus the provider task id. Both return `pending` with an opaque id or `completed` with provider facts, PNG bytes, dimensions, byte size, and the workspace-relative path.

The workspace root is trusted same-process context. Prompt text, aspect ratio, output path, overwrite choice, and task id may originate from a model, so a provider validates its protocol, confines publication below the workspace, rejects link escapes and silent replacement, bounds output, and honors cancellation.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The package contains only request/result types and the abstract Cordis service. Provider bytes cross a typed same-process call so the tool consumer can commit a durable attachment before returning an image block; the service never serializes raw bytes into a session event.

-----

<a id="further-exploration"></a>
## Further Exploration

- [Dreamina provider](../image-generation-dreamina/README.md) — the shipped local CLI implementation.
- [Model-facing tools](../tool-image-generation/README.md) — submit and collect schemas for agents.
- [Image generation subsystem](../../../docs/subsystems/image-generation.md) — complete lifecycle and ownership.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through consumers such as `dsh-tool-image-generation`; this Service Definition adds no prompt section or tool schema by itself.

#### KV Cache effect

None by itself. A consumer that registers tools or guidance owns the request-prefix change.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Version one produces one raster image per task and standardizes workspace publication on PNG.
- Reference-image editing, masks, image upscale, and video belong to later requests or separate capability methods.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
