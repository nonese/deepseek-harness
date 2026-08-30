/**
 * Authentication and user-directory capability for the Harness server.
 * Providers own credentials and durable sessions; transports consume this
 * service without learning the provider's file format.
 * @module @deepseek-ai/dsh-auth
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Branded } from '@deepseek-ai/dsh-brand'

/**
 * Resolve an existing path prefix while retaining a missing suffix.
 * @param path - managed server path to canonicalize.
 * @returns symlink-resolved spelling suitable for containment checks.
 */
export function canonicalManagedPath(path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    // Preserve an existing symlink-sensitive spelling before walking a missing suffix.
  }
  let current = resolve(path)
  const missing: string[] = []
  while (true) {
    try {
      return resolve(realpathSync.native(current), ...missing.reverse())
    } catch {
      const parent = dirname(current)
      /* v8 ignore next -- every supported platform exposes a resolvable filesystem root. */
      if (parent === current) return resolve(path)
      missing.push(basename(current))
      current = parent
    }
  }
}

/**
 * Check whether a candidate remains inside a managed root after symlink resolution.
 * @param root - owning user or project root.
 * @param candidate - path claimed by a request or durable record.
 * @returns whether the candidate is the root or one of its descendants.
 */
export function managedPathContains(root: string, candidate: string): boolean {
  const nested = relative(canonicalManagedPath(root), canonicalManagedPath(candidate))
  return nested === '' || (!nested.startsWith('..') && !isAbsolute(nested))
}

/** Stable, path-safe identity. Usernames and display names never select storage paths. */
export type UserId = Branded<'UserId'>

/** Roles supported by the server authorization model. */
export type UserRole = 'admin' | 'user'

/** Authentication mechanisms recorded on a browser session. */
export type AuthMethod = 'local' | 'oidc'

/** User lifecycle state. Disabled users cannot create or resume sessions. */
export type UserStatus = 'active' | 'disabled'

/** Public user record. Password material is provider-private. */
export interface AuthUser {
  id: UserId
  username: string
  displayName: string
  role: UserRole
  status: UserStatus
  authMethods: readonly AuthMethod[]
  createdAt: string
  lastLoginAt?: string
}

/** Identity carried by one authenticated request. */
export interface AuthPrincipal {
  user: AuthUser
  sessionId: string
  method: AuthMethod
  expiresAt: string
}

/** A newly-issued opaque browser session. Only the digest is persisted. */
export interface IssuedAuthSession {
  token: string
  principal: AuthPrincipal
}

/** Program-managed directories for one user. */
export interface UserPaths {
  root: string
  projects: string
  state: string
  settings: string
  credentials: string
  sessions: string
  attachments: string
}

/** Input for an administrator-created local account. */
export interface CreateLocalUserInput {
  username: string
  displayName?: string
  password: string
  role?: UserRole
}

/** Mutable administrative user fields. */
export interface UpdateUserInput {
  displayName?: string
  role?: UserRole
  status?: UserStatus
}

/** User-owned choice to consume administrator-managed model credentials. */
export interface SharedDeepSeekPreference {
  enabled: boolean
}

/** Credential-reference prefix reserved for administrator-managed custom model sites. */
export const MANAGED_MODEL_CREDENTIAL_PREFIX = 'HARNESS_SHARED_MODEL_'

/**
 * Identify a credential reference reserved for one administrator-managed custom model site.
 * @param value - credential reference name to classify.
 * @returns whether the reference belongs to the managed-model namespace.
 */
export function isManagedModelCredentialRef(value: string): boolean {
  return /^HARNESS_SHARED_MODEL_[A-F0-9]{12}_API_KEY$/u.test(value)
}

/** Token-endpoint client authentication supported by the configured OIDC provider. */
export type OidcClientAuthMethod = 'client_secret_basic' | 'client_secret_post' | 'none'

/** Non-secret OIDC relying-party settings persisted by the authentication provider. */
export interface OidcClientConfig {
  enabled: boolean
  issuer: string
  clientId: string
  redirectUri: string
  scopes: readonly string[]
  clientAuthMethod: OidcClientAuthMethod
  allowInsecureIssuer: boolean
  administratorGroup: string
}

/** Verified external identity projected from a validated OIDC ID Token. */
export interface OidcLoginInput {
  issuer: string
  subject: string
  preferredUsername?: string
  displayName?: string
  administrator: boolean
}

/** Stable machine codes for expected authentication failures. */
export type AuthErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'USER_DISABLED'
  | 'USERNAME_CONFLICT'
  | 'USER_NOT_FOUND'
  | 'LAST_ADMIN'
  | 'FORBIDDEN'
  | 'INVALID_INPUT'

/** Expected authentication or user-administration failure. */
export class AuthError extends Error {
  constructor(readonly code: AuthErrorCode, message: string) {
    super(message)
    this.name = 'AuthError'
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    auth: AuthService
  }
}

/**
 * Authentication Service Definition. Implementations must compare passwords
 * without early exits, persist only session-token digests, and revoke every
 * session when a user is disabled.
 */
export abstract class AuthService extends Service {
  private readonly principals = new AsyncLocalStorage<AuthPrincipal>()

  constructor(ctx: Context) {
    super(ctx, 'auth')
    ctx.effect(() => () => { this.principals.disable() }, 'auth: request-principal context')
  }

  /**
   * Read the principal established by the authenticated carrier for this async request.
   * @returns the current principal, or undefined outside an authenticated request.
   */
  currentPrincipal(): AuthPrincipal | undefined {
    return this.principals.getStore()
  }

  /**
   * Run one carrier dispatch with an immutable authenticated principal.
   * @param principal - identity resolved from the deployment session cookie.
   * @param operation - request work that may cross asynchronous continuations.
   * @returns the operation result.
   */
  withPrincipal<T>(principal: AuthPrincipal, operation: () => T): T {
    return this.principals.run(structuredClone(principal), operation)
  }

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
}

export default AuthService
