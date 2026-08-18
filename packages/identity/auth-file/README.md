# @deepseek-ai/dsh-auth-file

English | [中文](README.zh.md)

Owner-only JSON provider for `ctx.auth`. Local passwords use salted scrypt records, browser sessions persist only SHA-256 token digests, and disabling a user revokes every active session.

## Configuration

- `root` defaults to `<DSH_HOME>/server`.
- `sessionTtlHours` defaults to 12.
- `bootstrapUsername` defaults to `admin`.
- `bootstrapPasswordEnv` defaults to `HARNESS_BOOTSTRAP_PASSWORD`.

When no user file exists, the provider creates one administrator. It reads the password from the configured environment variable; if absent, it generates a one-time password and writes it only to the startup log.

## Storage contract

Authentication state lives in `<root>/system/auth/users.json`, `sessions.json`, `preferences.json`, and `oidc.json`, all atomically replaced with mode `0600`. The OIDC document stores non-secret client settings and immutable `(issuer, sub) → UserId` bindings; the client secret remains in the credentials provider. The preferences document stores only user ids that opted into the administrator-managed DeepSeek credential. User data lives below `<root>/users/<UserId>/`; directories use mode `0700`. Usernames never become path segments.

## Model Experience

None, as the provider contributes no model-visible content.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- The JSON provider serializes writes inside one process. Running multiple Harness server processes against the same root is unsupported.
- OIDC identities never auto-link to a local account by username. A colliding preferred username receives a deterministic suffix, and an administrator may manage the resulting Harness role after first login.
