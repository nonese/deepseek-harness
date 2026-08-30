# Agent Note: Authenticated WebSocket stream isolation

Status: implemented

English | [中文](2026-08-30-authenticated-websocket-stream-isolation.zh.md)

## Problem

The multi-user Web deployment authenticated the HTTP upgrade for `/api/remote.mux`, but logical Remote streams opened later from WebSocket message callbacks without restoring that request's principal. The Auth Web Gateway middleware treated a missing principal as an unauthenticated internal call and delegated to the process-wide source. A browser could consequently receive foreign workspaces, session-control state, and process events even though the existing projectors correctly filtered those values when a principal was present.

## Decision

Every accepted multiplexed WebSocket retains its `ConnectionRequestAuthorization`. Each logical stream pump begins through that authorization's `run()` method, so authorization middleware, stream creation, and asynchronous iteration execute with the principal captured for that socket. The generic Gateway still accepts principal-free deployments because the default process-token Connection authorization supplies an identity runner.

The Auth Web Gateway middleware now rejects unary and stream dispatch when no principal is current. Auth Web is the deployment component that installs this middleware, so a missing principal represents a transport or integration failure rather than a supported internal call. Workspace, Session control, and event sources remain process-wide; their existing Auth Web projectors remain the single ownership layer and receive a stable principal for every browser stream.

Event waterfall projection also participates in Gateway delivery accounting. When a projector suppresses a foreign waterfall, it delegates that Client delivery immediately; the Host continuation can settle after the visible owners respond, and later cancellation is sent only to Clients that received the waterfall.

## Alternatives considered

**Filter only `workspace/follow`.** Rejected because `session/control`, `$events/follow`, and any session-addressed stream would retain the same missing-principal bypass.

**Rely on the execution context used during the HTTP upgrade.** Rejected because later WebSocket message callbacks are separate asynchronous entry points and do not inherit that call's context automatically.

**Filter foreign rows in the browser.** Rejected because private paths and session state would already have crossed the server authorization boundary.

## Consequences

- One process can continue to serve many users, while every WebSocket connection projects only its authenticated user's workspaces, sessions, and events.
- A future transport regression that loses the principal fails closed instead of exposing process-wide Remote data.
- A filtered foreign waterfall neither blocks its owner's continuation nor exposes the event id through a later cancellation.
- Logging out or disabling an account does not yet revoke an already accepted socket immediately; session expiry and reconnect behavior remain separate lifecycle policy.
- Carrier tests pin per-socket execution context through asynchronous iteration and cancellation. Real-mux coverage proves a foreign Client receives neither a waterfall nor its cancellation while the owner's `next()` settles the Host continuation; multi-user acceptance covers separate projects, file routes, and concurrent sessions.
