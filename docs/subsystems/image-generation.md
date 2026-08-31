---
description: "Image generation service, Dreamina CLI provider, workspace publication, and model-facing tool lifecycle."
kind: "subsystem"
---

# Image generation

English | [中文](image-generation.zh.md)

## Summary

Image generation is a complete capability seam: `@deepseek-ai/dsh-image-generation` defines `ctx.imageGeneration`; `@deepseek-ai/dsh-image-generation-dreamina` implements it over the local logged-in Dreamina CLI; and `@deepseek-ai/dsh-tool-image-generation` exposes provider-neutral tools. The shipped Product Design preset mounts the provider and tools in one private realm, fixed to Dreamina image 4.0 at 2K.

## Request lifecycle

`generate_image` checks that the calling session has a workspace and that its exact LLM route declares image input. The check occurs before provider submission so a task cannot consume points and then leave a model-visible image that the route cannot accept. The tool passes the trusted session workspace and model-authored prompt, aspect ratio, relative PNG path, and overwrite choice to `ctx.imageGeneration.generate()`.

The Dreamina provider validates the output target before submission, resolves the executable through `ctx.subprocess`, and sends each prompt and option as one argv element. `text2image` is pinned to `--model_version=4.0` and `--resolution_type=2k`. A completed submit is queried with `query_result --download_dir=<private-directory>` so the CLI downloads the media under the same operating-system login. A task that remains incomplete returns `pending`; `collect_generated_image` queries that task id without submitting another charged operation.

## Publication and session data

The provider accepts bounded JSON, validates the opaque task id and status, and reads one regular PNG below its private random download directory. It checks byte limits and the PNG signature before atomically publishing owner-only bytes below the real session workspace. Relative paths cannot be hidden, absolute, traversal-shaped, or routed through a symlinked parent; existing files require an explicit overwrite request.

The tool commits completed bytes through `ctx.attachments.saveImage()` and returns only provider facts, workspace metadata, and the durable attachment reference as canonical JSON. Its renderer emits the text summary and image block that `tool/result` persists. Raw bytes, provider URLs, private temporary paths, Dreamina login material, and credentials never enter the event log.

## Concurrency and cancellation

One provider instance owns one promise queue. The Product Design preset has one standing mount shared by all sessions on that preset, so calls using the same Dreamina account cannot overlap even when different DSH users submit concurrently. The queue does not implement per-user credit quotas.

Foreground subprocesses receive the tool cancellation signal. DSH's subprocess provider terminates the whole process tree and awaits quiescence. The Dreamina provider independently reports pending status, process exit, signal termination, invalid JSON, provider failure, validation failure, and publication failure; it does not collapse those outcomes into a successful generation.

## Configuration

| Field | Default | Meaning |
|---|---:|---|
| `cliPath` | `dreamina` | Absolute executable or bare PATH name; the preset may read `DREAMINA_CLI_PATH` |
| `modelVersion` | `4.0` | Fixed provider model accepted by this version |
| `resolution` | `2k` | Fixed provider resolution accepted by this version |
| `pollSeconds` | `240` | Foreground submit polling interval before returning pending |
| `maxOutputBytes` | 25 MiB | Complete downloaded PNG byte cap |
| `maxPromptChars` | 20,000 | Prompt character cap |
| `graceMs` | 5,000 | Process-tree termination grace |

## Known limitations

- Only text-to-image is composed; Dreamina reference-image, upscale, and video paths are not exposed.
- A specialized Web progress/image card is not registered; the generic tool row renders the persisted content.
- Dreamina login and point balance belong to the host operating-system account, not individual DSH users.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctximagegeneration--imagegenerationruntime-abstract-seam"></a>

### `ctx.imageGeneration` — `ImageGenerationRuntime` (abstract seam)

Image-generation service. Implementations validate provider output before publishing, confine `outputPath` below `cwd`, reject symbolic-link escapes, and serialize provider work when an account cannot safely process concurrent submissions.

```ts cordis-catalog
/**
 * Submit one image and wait for the provider's configured foreground interval.
 * @param request - trusted workspace root plus model-authored prompt, ratio, and output path.
 * @param signal - aborts provider work and publication.
 * @returns a completed workspace image or a resumable pending task.
 */
abstract generate(request: ImageGenerationRequest, signal?: AbortSignal): Promise<ImageGenerationResult>

/**
 * Query and publish one previously submitted task.
 * @param request - trusted workspace root, prior task id, and output path.
 * @param signal - aborts provider work and publication.
 * @returns a completed workspace image or the still-pending task.
 */
abstract collect(request: ImageGenerationCollectRequest, signal?: AbortSignal): Promise<ImageGenerationResult>
```

Source: [`packages/image/image-generation/src/index.ts`](../../packages/image/image-generation/src/index.ts)
<!-- END GENERATED cordis-surface -->
