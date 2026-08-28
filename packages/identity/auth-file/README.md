---
description: "Single-process owner-only JSON authentication storage for local users, browser sessions, OIDC bindings, preferences, and per-user directories."
kind: "package-reference"
---

# @deepseek-ai/dsh-auth-file

English | [中文](README.zh.md)

## Summary

Choose this provider when one long-running Harness server process must persist multiple users without a separate database. It keeps authentication records in owner-only JSON files, creates stable per-user directories, hashes local passwords with salted scrypt, and stores only SHA-256 browser-session token digests. Disabling an account revokes all of its active sessions. Multiple server processes must not share the same root.

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

### Configuration

- `root` defaults to `<DSH_HOME>/server`.
- `sessionTtlHours` defaults to 12.
- `bootstrapUsername` defaults to `admin`.
- `bootstrapPasswordEnv` defaults to `HARNESS_BOOTSTRAP_PASSWORD`.
- `bootstrapAdministrator` defaults to `true`. Set it to `false` only in a closed runtime that exposes no login surface, such as the in-browser preview.

When no user file exists, the provider creates one administrator. It reads the password from the configured environment variable; if absent, it generates a one-time password and writes it only to the startup log.

### Storage contract

Authentication state lives in `<root>/system/auth/users.json`, `sessions.json`, `preferences.json`, and `oidc.json`, all atomically replaced with mode `0600`. The OIDC document stores non-secret client settings and immutable `(issuer, sub) → UserId` bindings; the client secret remains in the credentials provider. The preferences document stores only user ids that opted into the administrator-managed DeepSeek credential. User data lives below `<root>/users/<UserId>/`; directories use mode `0700`. Usernames never become path segments.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The provider serializes mutations inside one process and atomically replaces each versioned JSON document. Password verification uses constant-time digest comparison after scrypt derivation, while session lookup hashes the supplied opaque token before comparison. Directory ownership is derived only from stable user ids.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Authentication subsystem](../../../docs/subsystems/authentication.md) — durable identity and path semantics.
- [auth](../auth/README.md) — the service definition implemented here.
- [host-auth-web](../../host/auth-web/README.md) — the browser and OIDC adapter that consumes this provider.

-----

<a id="model-experience"></a>

## Model Experience

None, as the provider contributes no model-visible content.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The JSON provider serializes writes inside one process. Running multiple Harness server processes against the same root is unsupported.
- OIDC identities never auto-link to a local account by username. A colliding preferred username receives a deterministic suffix, and an administrator may manage the resulting Harness role after first login.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
