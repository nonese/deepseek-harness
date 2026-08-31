/**
 * Per-user credential references stored as isolated records in the deployment credential provider.
 * @module @deepseek-ai/dsh-host-auth-web/user-credentials
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  credentialKey,
  type CredentialRecord,
  type UserCredentialScope,
  type UserCredentialStore,
} from '@deepseek-ai/dsh-credentials'

const RECORD_SCOPE = 'host-auth-web'

/** Derive the private record address owned by this plugin for one opaque user id. */
function recordKey(ownerId: string) {
  const id = `user-${ownerId.toLocaleLowerCase('en-US').replaceAll('-', '')}`
  return credentialKey(RECORD_SCOPE, id)
}

/** Admit this plugin's record before exposing its environment mapping. */
function recordEnvironment(record: CredentialRecord | undefined): Readonly<Record<string, string>> {
  if (record === undefined) return {}
  if (record.kind !== 'api-key') {
    throw new Error('host-auth-web: a user credential record has an unexpected kind')
  }
  return record.env ?? {}
}

/**
 * Build the multi-user reference router mounted by the authenticated Web carrier.
 * @param ctx - authenticated Host context and deployment credential provider.
 * @returns a router that selects browser scopes and explicit session owners.
 */
export function createUserCredentialStore(ctx: Context): UserCredentialStore {
  const scopes = new Map<string, UserCredentialScope>()
  const forOwner = (ownerId: string): UserCredentialScope => {
    const existing = scopes.get(ownerId)
    if (existing !== undefined) return existing
    const key = recordKey(ownerId)
    const scope: UserCredentialScope = {
      async resolve(ref) {
        const value = recordEnvironment(await ctx.credentials.readRecord(key))[ref]
        return value === undefined ? undefined : { value, source: 'user' }
      },
      async describe(ref) {
        const [record, info] = await Promise.all([
          ctx.credentials.readRecord(key),
          ctx.credentials.describeRecord(key),
        ])
        return {
          configured: recordEnvironment(record)[ref] !== undefined,
          ...recordEnvironment(record)[ref] === undefined ? {} : { source: 'user' },
          writable: info.writable,
        }
      },
      async set(ref, value) {
        if (value.length === 0) throw new Error(`user credentials: an empty value cannot be stored for "${ref}"; use unset`)
        const mutation = { changed: false }
        await ctx.credentials.modifyRecord(key, (current) => {
          const env = recordEnvironment(current)
          if (env[ref] === value) return Promise.resolve(undefined)
          mutation.changed = true
          return Promise.resolve({ kind: 'api-key', env: { ...env, [ref]: value } })
        })
        if (mutation.changed) ctx.emit('user-credentials/reference-updated', ownerId, ref)
      },
      async unset(ref) {
        const mutation = { changed: false }
        await ctx.credentials.modifyRecord(key, (current) => {
          const env = recordEnvironment(current)
          if (env[ref] === undefined) return Promise.resolve(undefined)
          mutation.changed = true
          const next = { ...env }
          Reflect.deleteProperty(next, ref)
          return Promise.resolve({ kind: 'api-key', ...Object.keys(next).length === 0 ? {} : { env: next } })
        })
        if (mutation.changed) ctx.emit('user-credentials/reference-updated', ownerId, ref)
      },
    }
    scopes.set(ownerId, scope)
    return scope
  }
  return {
    current: () => {
      const principal = ctx.auth.currentPrincipal()
      return principal === undefined ? undefined : forOwner(String(principal.user.id))
    },
    forOwner,
  }
}
