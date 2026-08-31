# Agent Note: Project file exchange and teacher artifacts

Status: implemented

English | [中文](2026-08-29-project-file-exchange-and-teacher-artifacts.zh.md)

## Problem

The multi-user Web server made every project a private workspace and let users browse and preview its files, but the browser could not put a source file into that workspace or download a generated result through an explicit file workflow. A teacher could ask the agent for a lesson plan or presentation, but the four shipped presets exposed only general coding tools; producing a usable Word, PowerPoint, or Excel file depended on shell scripts, whatever office libraries happened to exist on the host, and model-authored packaging details. Importing the Codex document skills directly would also bind the server to one managed desktop runtime and its private dependency paths rather than create a deployable Harness capability.

## Decision

The authenticated project-file surface is bidirectional. `PUT /auth/projects/:id/files/upload` streams one raw request body into a selected visible project directory, while the existing download route streams one regular file out. The authenticated user's workspace resolution, hidden-path rejection, traversal rejection, and symbolic-link rejection apply to uploads, previews, listings, and downloads alike. Uploads have a separate deployment limit, use a private temporary file, and publish with an exclusive hard link so a same-name race fails with `FILE_CONFLICT`; they never replace a user's existing file. The Web file browser exposes multi-select and file-drop upload into the currently viewed directory, including Word, PowerPoint, and Excel files, and retains the existing per-file download action. The project list keeps its file dialog, while the runtime mounts the same browser as a collapsible dock that derives its project from the current Session Workspace. A non-image drop on the conversation area uploads the complete batch to that Workspace's root and refreshes the dock; an image-only drop continues through the message-attachment plugin.

Office creation is a complete capability seam. `@deepseek-ai/dsh-artifacts` defines `ctx.documentArtifacts` and provider-neutral Word, presentation, and spreadsheet requests. `@deepseek-ai/dsh-artifacts-local` is one stateless host provider shared by every user: each call receives its trusted session workspace, renders under configured item/text/cell/output limits, checks the generated OOXML archive, and publishes atomically below that workspace. `@deepseek-ai/dsh-tool-artifacts` owns the three model-facing schemas and obtains `cwd` only from the calling Agent, so the model cannot select another user's root.

The local provider uses `docx`, PptxGenJS, and ExcelJS rather than managed Codex runtime paths. Its output vocabulary deliberately stays narrower than those authoring skills: styled Word sections and tables, four text-first PowerPoint layouts with speaker notes, and Excel sheets with formulas, formats, filters, and frozen headers. JSZip structural checks prove that the required OOXML family parts exist before any target is published. Existing targets require an explicit `overwrite: true`, and even that path rechecks symbolic-link and regular-file state immediately before rename.

`teacher` is the fifth shipped agent preset. It duplicates the full standard composition, adds the document-tool Consumer, and replaces the persona with teaching guidance for audience and objectives, instructional sequence, assessment evidence, differentiation, presentation notes, and structured teaching data. The Web host mounts the provider once, while the [per-session preset mechanism](../architecture/2026-08-03-per-session-agent-presets.md) grants the tools and prompt only to sessions choosing Teacher mode. The other four shipped presets keep their previous model-visible catalogs.

This decision applies the existing [capability-seam split](../architecture/2026-06-13-capability-seams.md) and per-session preset ownership; it does not supersede either note. A scoped audit found no prior active Agent Note that owns browser file upload or Office artifact generation.

## Alternatives considered

**Run the Codex Word, presentation, and spreadsheet skills unchanged.** Rejected because those skills target the Codex managed runtime and its bundled dependency paths. A long-lived intranet server needs ordinary declared package dependencies and a Harness service whose workspace authority is explicit.

**Let the teacher persona create Office files through shell commands.** Rejected because library discovery, path safety, validation, result typing, and UI presentation would be repeated in model-authored programs. A tool schema makes those obligations enforceable and testable before deployment.

**Mount one document generator per user or per Agent.** Rejected because the renderer carries no user state. One host service with a trusted workspace on every call preserves tenant isolation without multiplying library instances across concurrent sessions.

**Expose the document tools in every shipped preset.** Rejected because the requirement is a teaching workflow, and adding three large schemas to every session increases fixed request-prefix cost and changes unrelated presets. Per-session composition is the existing product boundary for this choice.

**Buffer uploads as JSON/base64 or overwrite matching names.** Rejected because buffering expands memory with file size and base64 overhead, while implicit overwrite makes an ordinary browser action destructive. A raw bounded stream plus exclusive publication keeps memory bounded and conflicts recoverable.

**Keep project files only in the project-list dialog.** Rejected because a user must leave the active conversation to inspect or upload its workspace files, and a dialog opened earlier does not follow later Session navigation. The runtime dock reuses the same authenticated routes and browser component without replacing the project-list entry point.

## Consequences

- A user can upload source material from the project-file browser or the conversation area into the current private project, ask a Teacher-mode session to create structured Office files there, preview supported text files, and download any regular result through either the project-list dialog or the current-Workspace runtime dock.
- Fifty logged-in users still share one provider and one process. Work occurs only during a document call; concurrency consumes generation memory per active call rather than per account.
- Structural OOXML validation catches missing archive parts but does not prove visual quality in Microsoft Office or LibreOffice. The v1 tools therefore favor bounded, deterministic layouts and do not promise arbitrary document editing, image-heavy slides, charts, animations, or browser-side Office rendering.
- Word, PowerPoint, and Excel generator libraries become production dependencies of the Web bundle. Their versions and license notices must pass the repository's supply-chain and third-party-notice gates.
- Provider and tool tests generate and reopen all three formats, path tests pin escape and overwrite behavior, authenticated route tests pin role isolation and upload limits, the Web file scenario verifies file-browser and conversation-area uploads while preserving image-only attachment drops, and the Teacher preset snapshot boots the shipped composition and creates all three file families without an external model call.
