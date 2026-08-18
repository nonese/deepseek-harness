# @deepseek-ai/dsh-host-auth-web

English | [中文](README.zh.md)

Same-origin HTTP routes for the Harness login screen, local and OIDC browser sessions, user administration, and program-managed project creation.

## Routes

`GET /auth/session`, `POST /auth/login/local`, `GET /auth/oidc/start`, `GET /auth/oidc/callback`, and `POST /auth/logout` own the browser session lifecycle. OIDC uses Authorization Code with PKCE S256, state, nonce, provider discovery, and signed ID Token validation through the provider's rotating JWKS. A pending flow is process-memory state with a ten-minute lifetime and a matching `HttpOnly`, `SameSite=Lax` transient cookie; callback replay cannot issue another session. Authenticated users may list and create projects below their own generated data root. `GET` and `PATCH /auth/preferences` expose and change only the current user's shared-DeepSeek opt-in; enabling fails while the administrator credential is absent.

Administrators may read the effective process, storage, authentication, isolation, request-limit, and shared-model status; list user metadata; create local users; change role or status; and reset a local password. `PUT /auth/system/oidc` saves issuer, client id, redirect URI, scopes, client authentication method, the optional intranet-HTTP exception, and the first-login administrator group. The submitted client secret is written under `HARNESS_OIDC_CLIENT_SECRET` in the existing credentials provider and never returned. `POST /auth/system/oidc/test` validates the saved discovery document without issuing tokens. `PUT` and `DELETE /auth/system/shared-deepseek` replace or remove the dedicated managed model credential. Administration responses expose configured and writable state but never return submitted or stored secrets or user project and session content.

In an authenticated Web composition, this plugin also registers a monotonic execution guard for every `cordis_*` tool. The guard resolves the calling Agent's current owner from its program-managed project path on every invocation and allows the body only while that owner is an administrator. Calls with no Agent, no managed owner, an ordinary owner, or a demoted owner fail before the tool body. Preset and Remote-runner admission are enforced independently by the scoped API proxy and Connection carrier.

The opaque cookie is `HttpOnly`, `SameSite=Lax`, and optionally `Secure`. Mutable routes reject a mismatched `Origin`, cap JSON request bodies, and return stable error codes. HTTPS is required for issuer and callback URLs unless an administrator explicitly enables the pure-intranet HTTP exception. OIDC claims create or resume an account only by the validated issuer and subject; a preferred username cannot take over an existing local account. The configured administrator group applies only when the external identity is first created, after which the Harness administrator owns role changes.

## Model Experience

### Dynamic Cordis denial

#### What the model sees

The policy adds no prompt content. A denied `cordis_*` attempt becomes the ordinary tool failure `Error: 仅管理员可使用动态 Cordis 插件`; administrator calls are unchanged.

#### Token effect

None until a denied call is appended as an ordinary tool result.

#### KV Cache effect

Append-only after a denial; the earlier request prefix remains reusable.

## Known Limitations and Deferred Work

- The provider does not expose end-session or token-revocation endpoints, so Harness logout revokes only the local browser session and does not sign the user out of the upstream identity provider.
- Deployments terminating HTTPS must enable `secureCookie`.
