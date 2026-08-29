# Agent Note: Browser access to managed project files

Status: implemented

English | [中文](2026-08-29-browser-project-files.zh.md)

## Problem

The authenticated portal could open a managed project only by entering its coding runtime. A remote browser could not inspect or download files produced in that project, while an operating-system file manager action would target the server machine and provide no usable path to an external client. Exposing a general host path browser would also contradict the per-user project isolation owned by the [multi-user server decision](../architecture/2026-08-14-single-process-multi-user-server.md).

## Decision

Each project row opens an in-page, same-origin file dialog scoped by the opaque workspace id. The Host resolves that id only among workspaces below the authenticated user's generated projects root. The browser submits project-relative paths and never chooses an absolute filesystem target. Directory listing omits hidden entries and symbolic links, rejects traversal, caps visible entries, and returns only relative metadata. Text preview accepts a bounded regular file from an explicit text allowlist, validates UTF-8, and renders Markdown through the existing untrusted-Markdown primitive. Download streams one regular file with attachment and `nosniff` headers.

The portal keeps browsing separate from starting a workspace session. Directory navigation, preview, download, empty, loading, and error states remain inside one centered dialog; selecting a previewable file expands the dialog into a list-and-preview layout. The Host remains the authorization source for every request, so a stale browser row cannot cross into another user's project after an account or workspace change.

## Alternatives considered

**Open Finder or another native file manager.** Rejected because the browser may run on a different machine, and a native action would open the server's desktop rather than return a remotely usable file view.

**Expose a general server directory picker.** Rejected because this capability needs read and download operations only inside one authenticated managed project; accepting arbitrary starting paths would widen both disclosure and authorization responsibilities.

**Reuse the directory-only picker response.** Rejected because that response intentionally excludes files and lacks preview, download, file-size, and modification-time semantics. Extending it would mix unrestricted loopback selection with authenticated project content access.

## Consequences

Remote users can inspect generated project output without a separate network share or a coding-session transition. Hidden files, symbolic links, unsupported or oversized previews, directory downloads, and cross-user workspace ids are unavailable through this route. The entry and preview limits are deployment configuration; downloads have no application byte cap and therefore rely on HTTP streaming and deployment-level transfer controls. The UI and Host routes remain specific to the authenticated multi-user Web composition.
