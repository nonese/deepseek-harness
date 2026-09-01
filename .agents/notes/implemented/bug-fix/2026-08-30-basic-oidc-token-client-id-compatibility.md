# Agent Note: Basic OIDC token requests carry the public client id

Status: implemented

English | [中文](2026-08-30-basic-oidc-token-client-id-compatibility.zh.md)

## Problem

The OIDC relying party authenticated `client_secret_basic` token requests only through the HTTP Authorization header. Some providers authenticate that header successfully for an invalid authorization code but use the form-body `client_id` to locate or validate the client binding of a real authorization code. Those providers reject the callback exchange as `invalid_client` even though discovery, the client secret, the registered authentication method, and the redirect URI are valid.

Switching the configured method to `client_secret_post` would make those providers accept a different request but would contradict the registered client authentication method and move the secret into the form body.

## Decision

Every authorization-code token exchange passes the configured public client id as an additional form parameter. `openid-client` continues to apply the selected authentication method, so `client_secret_basic` still sends the secret only in the Authorization header and `client_secret_post` retains its configured behavior. PKCE, state, nonce, ID Token validation, pending-flow expiry, and replay rejection remain unchanged.

The client id comes from the immutable settings captured for the pending OIDC flow. The callback rejects a changed settings or secret fingerprint before issuing the token request, so the header credentials and form client id belong to the same configuration.

## Verification

The signed local OIDC provider can require both valid Basic credentials and the public client id in the form body while rejecting any form-body client secret. The complete PKCE login test enables that behavior and proves successful token exchange, signed ID Token validation, isolated user creation, administrator-route denial, and callback replay rejection.

## Alternatives considered

**Change the deployment to `client_secret_post`.** Rejected because the provider registers this client for `client_secret_basic`; changing the method would violate that deployment setting and expose the secret in a different request component.

**Authenticate only with a form-body client id and secret.** Rejected because this is `client_secret_post`, not a compatibility adjustment to the configured Basic method.

**Special-case one issuer.** Rejected because the extra public identifier is harmless to providers that do not require it, while issuer-specific behavior would add an undocumented deployment switch and leave equivalent providers broken.

## Consequences

Token requests contain the public client id twice: once as part of the Basic credential and once as a form field. The secret remains only in the configured authentication mechanism. This small redundancy supports providers that bind real authorization codes through the form field without weakening PKCE or callback validation.
