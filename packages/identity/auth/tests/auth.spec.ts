import { mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import {
  AuthError,
  AuthService,
  canonicalManagedPath,
  managedPathContains,
  type AuthPrincipal,
  type UserId,
} from '@deepseek-ai/dsh-auth'
import { afterEach, describe, expect, it } from 'vitest'

const roots: string[] = []

function temporaryDirectory(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('authentication capability primitives', () => {
  it('canonicalizes existing prefixes and enforces managed-path containment', () => {
    const root = temporaryDirectory('dsh-auth-root-')
    const alias = `${root}-alias`
    roots.push(alias)
    symlinkSync(root, alias, process.platform === 'win32' ? 'junction' : 'dir')
    const canonicalRoot = canonicalManagedPath(root)

    expect(canonicalManagedPath(alias)).toBe(canonicalRoot)
    expect(canonicalManagedPath(join(alias, 'missing', 'child'))).toBe(join(canonicalRoot, 'missing', 'child'))
    expect(managedPathContains(root, root)).toBe(true)
    expect(managedPathContains(root, join(alias, 'project'))).toBe(true)
    expect(managedPathContains(root, `${root}-outside`)).toBe(false)
  })

  it('keeps cloned principals inside their asynchronous request context', async () => {
    const ctx = new Context()
    const ConcreteAuth = AuthService as unknown as new (context: Context) => AuthService
    const auth = new ConcreteAuth(ctx)
    const principal: AuthPrincipal = {
      user: {
        id: 'user-1' as UserId,
        username: 'member',
        displayName: 'Member',
        role: 'user',
        status: 'active',
        authMethods: ['local'],
        createdAt: '2026-08-29T00:00:00.000Z',
      },
      sessionId: 'session-1',
      method: 'local',
      expiresAt: '2026-08-30T00:00:00.000Z',
    }

    expect(auth.currentPrincipal()).toBeUndefined()
    await auth.withPrincipal(principal, async () => {
      await Promise.resolve()
      expect(auth.currentPrincipal()).toEqual(principal)
      expect(auth.currentPrincipal()).not.toBe(principal)
    })
    expect(auth.currentPrincipal()).toBeUndefined()

    await ctx.fiber.dispose()
  })

  it('publishes stable authentication error codes', () => {
    const error = new AuthError('FORBIDDEN', 'administrator required')
    expect(error).toMatchObject({ name: 'AuthError', code: 'FORBIDDEN', message: 'administrator required' })
  })
})
