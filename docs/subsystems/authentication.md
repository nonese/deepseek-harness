# Authentication and User Ownership

English | [中文](authentication.zh.md)

[dsh-auth](../../packages/identity/auth) defines the server identity seam. [dsh-auth-file](../../packages/identity/auth-file) keeps users, password verifiers, OIDC identity bindings, and revocable session-token digests in owner-only JSON files, while [dsh-auth-web](../../packages/host/auth-web) maps the seam onto local and OIDC cookie-authenticated HTTP routes. The Web deployment creates one initial administrator from its bootstrap environment, then all later account changes go through an authenticated administrator. Administrators configure OIDC from the system settings page; local login remains available for testing and emergency access.

This seam owns identity and authorization metadata, not project content. A stable random `UserId` selects one program-managed directory tree; username and display-name changes never rename or select storage. The Web deployment registers one Connection authenticator that validates the durable cookie and runs dispatch with a request-scoped principal. An ordered Typert Gateway middleware then admits only sessions and workspaces rooted in that principal's `projects` directory and applies the same projection to unary results and streams. Administrator listing exposes public account metadata only and does not grant access to another user's projects, sessions, attachments, credentials, or settings.

Source: [`packages/identity/auth/src/index.ts`](../../packages/identity/auth/src/index.ts)

## Stable identity

```ts type-equiv
/** Stable, path-safe identity. Usernames and display names never select storage paths. */
type UserId = Branded<'UserId'>
```

```ts type-equiv
/** Public user record. Password material is provider-private. */
interface AuthUser {
  id: UserId
  username: string
  displayName: string
  role: UserRole
  status: UserStatus
  authMethods: readonly AuthMethod[]
  createdAt: string
  lastLoginAt?: string
}
```

The two roles are `admin` and `user`. Disabling an account revokes all of its browser sessions, and the provider rejects any change that would remove or disable the last active administrator.

## OIDC relying party

```ts type-equiv
/** Non-secret OIDC relying-party settings persisted by the authentication provider. */
interface OidcClientConfig {
  enabled: boolean
  issuer: string
  clientId: string
  redirectUri: string
  scopes: readonly string[]
  clientAuthMethod: OidcClientAuthMethod
  allowInsecureIssuer: boolean
  administratorGroup: string
}
```

The administrator saves these non-secret fields through `PUT /auth/system/oidc`. A confidential client's secret is stored separately by the credentials provider under `HARNESS_OIDC_CLIENT_SECRET`; neither the settings response nor the discovery test returns it. The redirect URI is fixed to the Harness `/auth/oidc/callback` path and must be registered exactly at the identity provider. HTTPS is mandatory unless the administrator explicitly enables the pure-intranet HTTP exception.

`GET /auth/oidc/start` discovers the provider, creates a PKCE S256 verifier and challenge, and binds random state and nonce values to a ten-minute transient browser cookie and an in-memory pending flow. The callback consumes that state once, exchanges the authorization code, and requires a signed ID Token whose issuer, audience, expiry, issued-at time, nonce, and JWKS key are valid. The provider's `groups` claim supplies only the configured first-login administrator-group decision; `perm:` entries are not Harness permissions.

The Web deployment stores `(issuer, sub) → UserId` in `<DSH_HOME>/system/auth/oidc.json`. That immutable pair is the only automatic account-link key. A preferred username collision creates a suffixed OIDC username instead of linking or overwriting the local account. The configured administrator group selects the role only when a new OIDC identity is created; later role changes remain under Harness administrator control.

## Administrator-managed model credential choice

```ts type-equiv
/** User-owned choice to consume administrator-managed model credentials. */
interface SharedDeepSeekPreference {
  enabled: boolean
}
```

The Web deployment persists this choice as user-id metadata in `<DSH_HOME>/system/auth/preferences.json`; it never stores a key there. The DeepSeek official key remains in the ordinary credentials provider under `HARNESS_SHARED_DEEPSEEK_API_KEY`, and each custom site has a separate `HARNESS_SHARED_MODEL_<SITE ID>_API_KEY` reference. The DeepSeek adapter applies the choice to `deepseek-official` / `deepseek-v4-flash`. The pi-ai adapter applies it to reserved `managed-<site id>` routes after resolving the live Session's project owner; ordinary provider profiles retain their configured `apiKeyEnv` behavior.

## Browser sessions

```ts type-equiv
/** Identity carried by one authenticated request. */
interface AuthPrincipal {
  user: AuthUser
  sessionId: string
  method: AuthMethod
  expiresAt: string
}
```

```ts type-equiv
/** A newly-issued opaque browser session. Only the digest is persisted. */
interface IssuedAuthSession {
  token: string
  principal: AuthPrincipal
}
```

The browser receives an opaque `HttpOnly`, `SameSite=Lax` cookie. Only a digest is durable; logout, password reset, account disablement, and explicit administrator revocation invalidate server-side session records. Authentication failure responses do not disclose whether a username exists.

## Program-managed storage

```ts type-equiv
/** Program-managed directories for one user. */
interface UserPaths {
  root: string
  projects: string
  state: string
  settings: string
  credentials: string
  sessions: string
  attachments: string
}
```

The Web deployment materializes these roles beneath `<DSH_HOME>/users/<UserId>/`. The application chooses project paths under `projects`; the user never supplies an arbitrary server path. Existing Harness persistence providers remain unchanged and write into the authenticated user's roots, preserving the file-backed storage model without introducing a database.

## Administrator mutations

```ts type-equiv
/** Input for an administrator-created local account. */
interface CreateLocalUserInput {
  username: string
  displayName?: string
  password: string
  role?: UserRole
}
```

```ts type-equiv
/** Mutable administrative user fields. */
interface UpdateUserInput {
  displayName?: string
  role?: UserRole
  status?: UserStatus
}
```

Only an authenticated administrator can list users or create, edit, disable, and reset local accounts. Password reset revokes the target user's active browser sessions. These operations never expose password hashes or session-token digests.

## Plugin authority

Plugins declared by the deployment run in the shared Host process and affect every user, so their configuration is an administrator responsibility. The authenticated Gateway middleware removes the shipped `@deepseek-ai/cordis` preset from ordinary-user rosters and rejects ordinary session creation or preset selection that names it. A Host guard separately rejects every `cordis_*` tool call unless the current owner of the calling Agent's managed project path is an administrator, and the same Gateway middleware rejects the `dynamicCordisRunner/*` Remote namespace before dispatch. These independent checks keep a stale client, a forged request, or an already-open session from turning UI visibility into authority.

Installing an npm package inside one user's project changes only that user's project files. It does not load the package into Cordis, register a Host plugin, or affect another user's runtime. A package affects all users only after an administrator adds it to the shared deployment composition; the configured Host plugin is then part of the trusted process-wide runtime.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxauth--authservice-abstract-seam"></a>

### `ctx.auth` — `AuthService` (abstract seam)

Authentication Service Definition. Implementations must compare passwords without early exits, persist only session-token digests, and revoke every session when a user is disabled.

```ts cordis-catalog
/**
 * Read the principal established by the authenticated carrier for this async request.
 * @returns the current principal, or undefined outside an authenticated request.
 */
currentPrincipal(): AuthPrincipal | undefined

/**
 * Run one carrier dispatch with an immutable authenticated principal.
 * @param principal - identity resolved from the deployment session cookie.
 * @param operation - request work that may cross asynchronous continuations.
 * @returns the operation result.
 */
withPrincipal<T>(principal: AuthPrincipal, operation: () => T): T

/**
 * Resolve an opaque cookie token into an active principal.
 * @param token - raw opaque browser token from the cookie.
 * @returns the active principal, or `undefined` for an invalid or expired token.
 */
abstract authenticateToken(token: string): Promise<AuthPrincipal | undefined>

/**
 * Verify local credentials and issue a revocable browser session.
 * @param username - submitted local username.
 * @param password - submitted cleartext password, retained only for verification.
 * @returns the one-time raw token and its public principal.
 */
abstract loginLocal(username: string, password: string): Promise<IssuedAuthSession>

/**
 * Resolve a verified OIDC identity and issue a revocable browser session.
 * Implementations bind identities by immutable issuer and subject values;
 * display claims must never select an existing local account.
 * @param input - claims already validated by the OIDC relying party.
 * @returns the one-time raw token and its public principal.
 */
abstract loginOidc(input: OidcLoginInput): Promise<IssuedAuthSession>

/**
 * Read the persisted non-secret OIDC client settings.
 * @returns a detached configuration, or `undefined` before first setup.
 */
abstract oidcClientConfig(): OidcClientConfig | undefined

/**
 * Persist non-secret OIDC client settings.
 * @param config - validated relying-party settings.
 */
abstract setOidcClientConfig(config: OidcClientConfig): Promise<void>

/**
 * Revoke one opaque cookie token. Missing and expired tokens are no-ops.
 * @param token - raw opaque browser token to revoke.
 */
abstract logout(token: string): Promise<void>

/**
 * Revoke every active browser session for one user.
 * @param userId - stable user identity whose tokens are revoked.
 */
abstract revokeUserSessions(userId: UserId): Promise<void>

/**
 * List public users in stable creation order.
 * @returns detached public records without credential material.
 */
abstract listUsers(): readonly AuthUser[]

/**
 * Read one public user record.
 * @param userId - stable user identity to resolve.
 * @returns the public record, or `undefined` when absent.
 */
abstract getUser(userId: UserId): AuthUser | undefined

/**
 * Create a local account and its owner-only data tree.
 * @param input - validated account identity, password, and role fields.
 * @returns the created public user record.
 */
abstract createLocalUser(input: CreateLocalUserInput): Promise<AuthUser>

/**
 * Change administrative user fields.
 * @param userId - stable user identity to update.
 * @param input - display name, role, or lifecycle changes.
 * @returns the updated public user record.
 */
abstract updateUser(userId: UserId, input: UpdateUserInput): Promise<AuthUser>

/**
 * Replace a local account password and revoke its browser sessions.
 * @param userId - stable user identity whose local password changes.
 * @param password - new cleartext password, retained only until hashing completes.
 */
abstract resetLocalPassword(userId: UserId, password: string): Promise<void>

/**
 * Read whether one user opted into administrator-managed model credentials.
 * @param userId - stable user identity whose preference is requested.
 * @returns the detached preference; absent stored state resolves to disabled.
 */
abstract sharedDeepSeekPreference(userId: UserId): SharedDeepSeekPreference

/**
 * Persist one user's choice to consume administrator-managed model credentials.
 * @param userId - stable user identity whose preference changes.
 * @param enabled - whether matching model requests may use managed credentials.
 */
abstract setSharedDeepSeekPreference(userId: UserId, enabled: boolean): Promise<void>

/**
 * Resolve which user owns a path inside a program-managed project tree.
 * @param path - absolute project or descendant path to classify.
 * @returns the public owner record, or `undefined` outside every managed project tree.
 */
abstract ownerForProjectPath(path: string): AuthUser | undefined

/**
 * Resolve and materialize program-managed directories for one user.
 * @param userId - stable user identity selecting the directory tree.
 * @returns canonical program-managed path roles.
 */
abstract ensureUserPaths(userId: UserId): Promise<UserPaths>

/**
 * Resolve paths without touching disk.
 * @param userId - stable user identity selecting the directory tree.
 * @returns program-managed path roles without creating them.
 */
abstract userPaths(userId: UserId): UserPaths
```

Source: [`packages/identity/auth/src/index.ts`](../../packages/identity/auth/src/index.ts)
<!-- END GENERATED cordis-surface -->
