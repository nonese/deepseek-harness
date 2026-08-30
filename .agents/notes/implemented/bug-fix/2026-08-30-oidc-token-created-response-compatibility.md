# Agent Note: OIDC token endpoint 201 response compatibility

Status: implemented

English | [中文](2026-08-30-oidc-token-created-response-compatibility.zh.md)

## Problem

OAuth 2.0 token success responses use HTTP 200, and `openid-client` rejects any other status before it parses or validates the response body. Some OIDC providers return HTTP 201 with an otherwise valid token response for an authorization-code exchange. Clients that accept every successful 2xx status can use those providers, while Harness fails the same exchange before ID Token validation.

Harness must not weaken token, PKCE, state, nonce, issuer, audience, signature, or replay validation to accommodate a response-status defect. Deployments using conforming providers must also retain strict status handling.

## Decision

The `host-auth-web` plugin exposes `oidcTokenEndpointCreatedCompatibility`, which defaults to `false`. When enabled, the OIDC client's fetch hook changes HTTP 201 to HTTP 200 only when the outgoing form body has `grant_type=authorization_code`. The replacement response preserves the original headers and body, so `openid-client` still parses the token response and performs every ordinary OIDC validation.

The hook leaves discovery, authorization, JWKS, and non-authorization-code requests unchanged. It also leaves every status other than 201 unchanged, including other successful 2xx statuses and all provider errors.

## Testing

The assembled authentication route test enables the option and completes a PKCE login against a local signed OIDC provider whose token endpoint returns HTTP 201. The same test changes the provider response to HTTP 202 and requires the callback to fail without issuing another session.

## Alternatives considered

**Require the provider to return HTTP 200.** This is the preferred provider behavior, but Harness deployments do not always control the OIDC implementation or its release schedule.

**Accept every HTTP 2xx response.** Rejected because the observed provider requires only 201 compatibility, while broader normalization would hide unexamined status semantics.

**Replace `openid-client` token processing with a hand-written exchange.** Rejected because it would duplicate standards-sensitive response parsing and ID Token validation merely to change one HTTP status.

## Consequences

An administrator can opt one deployment into the observed provider behavior without changing OIDC identity or cryptographic validation. The default remains standards-compliant. An enabled deployment intentionally hides the original 201 status from `openid-client`, so operators must reserve the option for providers that return a complete valid token response with that status.
