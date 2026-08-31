# Agent Note: Dreamina image generation for Product Design

Status: implemented

English | [中文](2026-08-31-dreamina-image-generation.zh.md)

## Problem

The Product Design preset could require real visual alternatives but had no DSH image provider. Its fail-closed instruction prevented fake assets, yet users had to leave the harness to generate a source image. The host already had a logged-in Dreamina CLI, and the requested route was Dreamina image 4.0 at 2K.

## Decision

Add a complete image-generation capability seam:

- `dsh-image-generation` owns typed submit, collect, pending, completed, and workspace-publication vocabulary;
- `dsh-image-generation-dreamina` owns managed CLI execution, fixed 4.0/2K provider configuration, task parsing, private download, validation, serialization, and atomic PNG publication;
- `dsh-tool-image-generation` owns the `generate_image` and `collect_generated_image` schemas, exact-route image-capability gate, durable attachment commit, model rendering, and pure presentation.

Mount the provider and consumer in one `imageGeneration` realm inside the shipped Product Design preset. The preset is a standing mount, so all Product Design sessions share one Dreamina queue; other presets receive neither the service nor the tools. `DREAMINA_CLI_PATH` selects a non-PATH executable without carrying login material through configuration. An optional Docker-exec route reuses a logged-in CLI in an already-running local container when the host glibc cannot execute that CLI; three settings name the container and both sides of its existing download bind mount.

## Safety properties

The provider validates the workspace target before submission so traversal, symlink, conflict, and invalid-extension requests spend no points. Model input reaches the CLI only through argv arrays. Managed subprocess execution scrubs credential-shaped environment variables, bounds output, propagates cancellation, and owns process-tree teardown. Provider JSON, status, task id, download path, file kind, PNG signature, size, and workspace containment are validated before publication.

Downloads use a private random flat directory. Cleanup unlinks regular or link-shaped entries and removes the directory without recursive traversal. In Docker mode, Dreamina receives the matching container path; the provider rejects any reported path outside that exact container directory before translating it to the host side. Publication uses an owner-only random temporary file followed by a hard-link create or atomic rename. The tool stores provider bytes through the attachment service before emitting a durable image block; raw bytes and provider URLs never enter canonical tool JSON or the session log.

The tool requires the calling route to declare image input before submission. A text-only route therefore cannot consume points and then fail when its generated image becomes model-visible. Pending tasks return an opaque id and must be resumed with `collect_generated_image`; the workflow explicitly forbids duplicate submission.

## Verification

Provider tests use the real local subprocess implementation with an executable Dreamina fixture. They cover direct and Docker-exec argv, completed download/publication, container-to-host path confinement, pending collection, pre-submit path refusal, provider failure, non-PNG rejection, unavailable executables, and concurrent-account serialization. Tool tests cover durable attachment/image-block rendering, pending behavior, exact-route refusal, missing workspace, and pure presentation. A keyless recorded-session replay also executes `generate_image`, verifies the complete PNG workspace state, and persists the image attachment. A real CLI smoke submits one 4.0/2K image only after those keyless checks pass.

## Deferred work

Reference-image editing, masks, batches, image upscale, video, per-DSH-user point quotas, background notification, and a specialized Web card are outside this change.

## Alternatives considered

**Invoke Dreamina only through shell instructions.** This would avoid a new package family, but it would lose typed argument validation, workspace-safe publication, durable image rendering, resumable pending tasks, and the pre-charge model-route gate.

**Expose the Dreamina provider directly as model tools.** This would couple the schemas, lifecycle, and result rendering to one CLI and prevent another provider from implementing the same image-generation service.

**Allow concurrent submissions through the shared host account.** The Dreamina CLI uses one logged-in account, point balance, and task namespace. Serial execution avoids ambiguous downloads and gives one mounted provider deterministic account use.

## Consequences

- Product Design sessions can create a real Dreamina 4.0 2K PNG and resume a pending task without leaving DSH.
- Generated files remain in the calling workspace and the completed image is persisted as a durable attachment.
- Other presets receive neither image-generation tools nor provider access from the shipped composition.
- The host Dreamina account remains shared, serialized, and unmetered per DSH user until a later quota policy is added.
- Older hosts can reuse an externally managed local Dreamina container without replacing the system glibc; DSH does not own that container's lifecycle or login state.
