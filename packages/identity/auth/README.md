# @deepseek-ai/dsh-auth

English | [中文](README.zh.md)

Service Definition for authenticated Harness server users. It defines public users, administrator and user roles, revocable browser sessions, and program-managed per-user paths. A stable random `UserId`, never a username or display name, selects the data directory.

## Composition

A provider supplies `ctx.auth`. HTTP and WebSocket transports authenticate an opaque cookie before constructing a user-scoped API view. Product-visible callers receive only `AuthUser`; password records and session-token digests remain provider-private. The service owns non-secret OIDC client settings, immutable issuer-and-subject identity bindings, the per-user opt-in for an administrator-managed DeepSeek credential, and project-path ownership without using usernames.

## Storage contract

`UserPaths` separates projects, runtime state, settings, credentials, sessions, and attachments below one owner directory. Providers create these directories with owner-only permissions. Renaming a user does not move data. An OIDC login resolves an existing account only through the verified `(issuer, sub)` pair; mutable username and display-name claims cannot select a local account. The shared-DeepSeek preference and OIDC client parameters are authentication metadata rather than credential material.

## Model Experience

None, as authentication controls runtime access but adds no prompt or model-visible content.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- The service consumes verified OIDC claims; discovery, token exchange, and ID Token validation remain the deployment adapter's responsibility.
- Application-level isolation does not protect against a malicious plugin running inside the trusted Host process.
