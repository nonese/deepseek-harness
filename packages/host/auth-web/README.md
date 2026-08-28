---
description: "Same-origin local and OIDC login, browser-session authorization, administrator controls, per-user project creation, and managed-model preferences for the Harness Web server."
kind: "package-reference"
---

# @deepseek-ai/dsh-host-auth-web

English | [中文](README.zh.md)

## Summary

Use this package to turn the Harness Web composition into a login-gated, single-process multi-user server. It provides local and OIDC login routes, durable browser-session authorization, administrator controls, per-user project creation, and the user's opt-in to an administrator-managed DeepSeek credential. Ordinary users receive only their own sessions, workspaces, projects, and event streams; administrator namespaces and dynamic Cordis mutation remain administrator-only.

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

### Routes

`GET /auth/session`, `POST /auth/login/local`, `GET /auth/oidc/start`, `GET /auth/oidc/callback`, and `POST /auth/logout` own the browser session lifecycle. OIDC uses Authorization Code with PKCE S256, state, nonce, provider discovery, and signed ID Token validation through the provider's rotating JWKS. A pending flow is process-memory state with a ten-minute lifetime and a matching `HttpOnly`, `SameSite=Lax` transient cookie; callback replay cannot issue another session. Authenticated users may list and create projects below their own generated data root. `GET` and `PATCH /auth/preferences` expose and change only the current user's shared-DeepSeek opt-in; enabling fails while the administrator credential is absent.

Administrators may read the effective process, storage, authentication, isolation, request-limit, and shared-model status; list user metadata; create local users; change role or status; and reset a local password. `PUT /auth/system/oidc` saves issuer, client id, redirect URI, scopes, client authentication method, the optional intranet-HTTP exception, and the first-login administrator group. The submitted client secret is written under `HARNESS_OIDC_CLIENT_SECRET` in the existing credentials provider and never returned. `POST /auth/system/oidc/test` validates the saved discovery document without issuing tokens. `PUT` and `DELETE /auth/system/shared-deepseek` replace or remove the dedicated managed model credential. Administration responses expose configured and writable state but never return submitted or stored secrets or user project and session content.

In an authenticated Web composition, this plugin registers the sole Connection authenticator and an ordered Typert Gateway middleware. The authenticator validates the durable cookie and supplies the request principal to both HTTP and WebSocket dispatch. The middleware filters user-owned sessions, workspaces, Host facts, lists, and streams, and rejects administrator namespaces for ordinary users. A separate monotonic execution guard protects every `cordis_*` tool by resolving the calling Agent's current owner from its program-managed project path on every invocation; calls with no Agent, no managed owner, an ordinary owner, or a demoted owner fail before the tool body.

The opaque cookie is `HttpOnly`, `SameSite=Lax`, and optionally `Secure`. Mutable routes reject a mismatched `Origin`, cap JSON request bodies, and return stable error codes. HTTPS is required for issuer and callback URLs unless an administrator explicitly enables the pure-intranet HTTP exception. OIDC claims create or resume an account only by the validated issuer and subject; a preferred username cannot take over an existing local account. The configured administrator group applies only when the external identity is first created, after which the Harness administrator owns role changes.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The deployment authenticator validates one cookie before HTTP or WebSocket RPC dispatch and establishes the resulting `AuthPrincipal` in the authentication service's asynchronous context. Ordered Typert middleware applies method-specific ownership filtering to unary calls, streams, and event following. Tool policy resolves ownership again at execution time so a role downgrade or project-owner change cannot reuse stale admission.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Authentication subsystem](../../../docs/subsystems/authentication.md) — server-wide identity, session, storage, and authorization behavior.
- [auth](../../identity/auth/README.md) — the request-principal and user-path definitions.
- [auth-file](../../identity/auth-file/README.md) — durable users, sessions, OIDC bindings, and preferences.
- [Connection](../../client/connection/README.md) — deployment authentication before transport dispatch.
- [Gateway](../../api/gateway/README.md) — ordered RPC authorization middleware.

-----

<a id="model-experience"></a>

## Model Experience

### Dynamic Cordis denial

#### What the model sees

The policy adds no prompt content. A denied `cordis_*` attempt becomes the ordinary tool failure `Error: 仅管理员可使用动态 Cordis 插件`; administrator calls are unchanged.

#### Token effect

None until a denied call is appended as an ordinary tool result.

#### KV Cache effect

Append-only after a denial; the earlier request prefix remains reusable.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The provider does not expose end-session or token-revocation endpoints, so Harness logout revokes only the local browser session and does not sign the user out of the upstream identity provider.
- Deployments terminating HTTPS must enable `secureCookie`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
