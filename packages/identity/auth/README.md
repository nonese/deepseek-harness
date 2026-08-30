---
description: "Authenticated server-user definitions for roles, browser principals, OIDC identity bindings, shared-model preferences, and stable per-user data paths."
kind: "package-reference"
---

# @deepseek-ai/dsh-auth

English | [中文](README.zh.md)

## Summary

Use this package to give a server composition one vocabulary for authenticated users, administrator authorization, browser principals, OIDC identity bindings, and program-managed per-user paths. A stable random `UserId`, never a username or display name, selects each data directory. The package defines the capability and retains no credential values by itself; mount a provider such as `@deepseek-ai/dsh-auth-file` to supply `ctx.auth`.

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

### Composition

A provider supplies `ctx.auth`. HTTP and WebSocket transports authenticate an opaque cookie before constructing a user-scoped API view. Product-visible callers receive only `AuthUser`; password records and session-token digests remain provider-private. The service owns non-secret OIDC client settings, immutable issuer-and-subject identity bindings, the per-user opt-in for administrator-managed model credentials, and project-path ownership without using usernames.

### Storage contract

`UserPaths` separates projects, runtime state, settings, credentials, sessions, and attachments below one owner directory. Providers create these directories with owner-only permissions. Renaming a user does not move data. An OIDC login resolves an existing account only through the verified `(issuer, sub)` pair; mutable username and display-name claims cannot select a local account. The managed-model preference and OIDC client parameters are authentication metadata rather than credential material.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`AuthService` is the Cordis service definition. Its request principal uses asynchronous context propagation so HTTP, WebSocket, RPC, and tool policy code can read one immutable identity throughout a dispatch without adding identity fields to every method. Providers implement durable account, session, OIDC, preference, and path operations; carriers authenticate requests and establish the principal.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Authentication subsystem](../../../docs/subsystems/authentication.md) — identity, session, path, and authorization semantics.
- [auth-file](../auth-file/README.md) — the single-process owner-only JSON provider.
- [host-auth-web](../../host/auth-web/README.md) — browser routes, OIDC exchange, and request authorization.

-----

<a id="model-experience"></a>
## Model Experience

None, as authentication controls runtime access but adds no prompt or model-visible content.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The service consumes verified OIDC claims; discovery, token exchange, and ID Token validation remain the deployment adapter's responsibility.
- Application-level isolation does not protect against a malicious plugin running inside the trusted Host process.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
