---
description: "Identity packages for anonymous installation ids, multi-user server accounts, and signed desktop device authorization."
kind: "package-group"
---

# identity/ — shared identity

English | [中文](README.zh.md)

## Summary

The identity group contains the anonymous installation id, the server authentication seam and file provider, and the cryptographic protocol used to authorize packaged desktop devices. Server users and desktop devices use opaque stable ids; usernames never select storage paths. Each package README owns its storage and trust rules.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

<a id="packages"></a>
## Packages

| Package | Role |
|---|---|
| [`anonymous-user-id`](anonymous-user-id/README.md) | Gives every harness home one anonymous id that telemetry, feedback, and DeepSeek requests attach to their records, so records from one installation can be recognized without identifying the user |
| [`auth`](auth/README.md) | Server-user, role, OIDC binding, path, and desktop-device capability definitions |
| [`auth-file`](auth-file/README.md) | Owner-only file provider for accounts, browser sessions, OIDC identities, and desktop devices |
| [`desktop-auth`](desktop-auth/README.md) | Signed activation, device proofs, offline leases, and encrypted organization model configuration |

<a id="related-documentation"></a>
## Related documentation

- [Session telemetry subsystem](../../docs/subsystems/session-telemetry.md) — the telemetry feature that carries the id on exports.
- [dsh-llm-deepseek](../llm/llm-deepseek/README.md) — the DeepSeek provider that carries the id on requests.
- [dsh-command-feedback](../feedback/command-feedback/README.md) — the feedback command that names the anonymous installation in its acknowledgement.

<a id="dev-note"></a>
## Dev Note

None.
