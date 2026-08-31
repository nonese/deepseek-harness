---
description: "Model-facing submit and resume tools for workspace image generation."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-image-generation

English | [中文](README.zh.md)

## Summary

`dsh-tool-image-generation` registers `generate_image` and `collect_generated_image`. The first submits a prompt, measured aspect ratio, and project-relative PNG path; the second resumes a returned pending task without spending points on a duplicate submission. Completed output is already present in the workspace and is also committed to DSH's durable attachment store before the tool result carries an image block.

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

Mount the tool beside `ctx.imageGeneration`, `ctx.attachments`, `ctx.llm`, and the tool registry:

```yaml
- name: '@deepseek-ai/dsh-tool-image-generation'
```

The calling session must have a workspace and an image-capable model route. The strict route gate runs before provider work so a text-only route cannot consume Dreamina points and then fail when the generated image re-enters model context.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`generate_image` requires `prompt`, `aspect_ratio`, and `output_path`; `overwrite` is optional. `collect_generated_image` requires the prior `task_id` and selected output path. Both return a canonical pending/completed union. The completed branch includes provider, model, resolution, task, file, size, dimensions, and durable image-reference metadata; raw bytes never enter the canonical JSON value.

The renderer emits text plus one durable image block. Call-time presentation is pure and uses an edit-family location for the selected workspace path. Tool schemas stay provider-neutral even though the shipped Product Design preset describes its Dreamina 4.0 2K selection.

-----

<a id="further-exploration"></a>
## Further Exploration

- [Image generation service](../image-generation/README.md) — provider-independent lifecycle.
- [Dreamina provider](../image-generation-dreamina/README.md) — subprocess and publication behavior.
- [Tool authoring](../../../docs/cookbook/adding-a-tool.md) — canonical values, rendering, and presentation.

-----

<a id="model-experience"></a>
## Model Experience

### Tool schemas

#### What the model sees

The model sees [`generate_image` and `collect_generated_image`](../../../docs/tool-catalog.md#deepseek-aidsh-tool-image-generation) while the Product Design preset is active. The submit schema tells it to measure the intended slot, choose a supported aspect ratio, supply a detailed prompt, and create a project-relative PNG. The collect schema tells it to resume the exact pending id and path rather than submit another charged task. Completed calls render the generated image and metadata; pending calls render only the resumable id and instruction.

#### Token effect

The two schemas and descriptions add a fixed request-prefix cost while the Product Design preset is active. Per-call metadata and image content enter session history only after provider publication and attachment commit.

#### KV Cache effect

Prefix-stable for sessions that retain the Product Design preset and the same tool catalog. Switching presets changes the catalog, while each completed result extends history with its generated image block and metadata.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The current schema creates one PNG and does not accept reference images, masks, or batches.
- A route must explicitly declare image input even if the human only wants the output file; this prevents a generated image from breaking the next model request.
- The generic Web tool row displays the result; a specialized progress/image card is deferred.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
