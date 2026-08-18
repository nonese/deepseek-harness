/** Browser-safe projection of the `/auth/session` response. */

export type ClientUserRole = 'admin' | 'user'

/** User metadata rendered by the shell. */
export interface ClientAuthUser {
  id: string
  username: string
  displayName: string
  role: ClientUserRole
  status: 'active' | 'disabled'
  authMethods: readonly ('local' | 'oidc')[]
  createdAt: string
  lastLoginAt?: string
}

/** Auth preflight state. Plugin boot starts only from the authenticated arm. */
export type ClientAuthState =
  | { phase: 'checking' }
  | { phase: 'anonymous'; oidcConfigured: boolean; message?: string }
  | { phase: 'authenticated'; user: ClientAuthUser; expiresAt: string; method: 'local' | 'oidc' }

/** Successful local-login response. */
export interface ClientAuthSession {
  user: ClientAuthUser
  expiresAt: string
  method: 'local' | 'oidc'
}

/**
 * Validate the narrow session payload used by the shell.
 * @param value - unknown JSON returned by an authentication route.
 * @returns whether the value is a complete active browser session.
 */
export function isClientAuthSession(value: unknown): value is ClientAuthSession {
  if (typeof value !== 'object' || value === null) return false
  const session = value as Partial<ClientAuthSession>
  const user = session.user as Partial<ClientAuthUser> | undefined
  return user !== undefined
    && typeof user.id === 'string'
    && typeof user.username === 'string'
    && typeof user.displayName === 'string'
    && (user.role === 'admin' || user.role === 'user')
    && user.status === 'active'
    && typeof session.expiresAt === 'string'
    && (session.method === 'local' || session.method === 'oidc')
}
