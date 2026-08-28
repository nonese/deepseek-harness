/** Per-user Gateway authorization and projection coverage. */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { AuthPrincipal, AuthUser, UserId, UserPaths } from '@deepseek-ai/dsh-auth'
import { ApiSessionNotFound } from '@deepseek-ai/dsh-api-session-controller'
import { SessionId } from '@deepseek-ai/dsh-session'
import { TypertRemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { userScopedRemotePolicy } from '../src/remote-policy.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function user(id: string, role: 'admin' | 'user' = 'user'): AuthUser {
  return {
    id: id as UserId,
    username: id,
    displayName: id,
    role,
    status: 'active',
    authMethods: ['local'],
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

function principal(account: AuthUser): AuthPrincipal {
  return {
    user: account,
    sessionId: `browser-${account.id}`,
    method: 'local',
    expiresAt: '2027-01-01T00:00:00.000Z',
  }
}

function paths(root: string): UserPaths {
  return {
    root,
    projects: join(root, 'projects'),
    state: join(root, 'state'),
    settings: join(root, 'settings'),
    credentials: join(root, 'credentials'),
    sessions: join(root, 'sessions'),
    attachments: join(root, 'attachments'),
  }
}

function fixture(): {
  ctx: Context
  current: { value: AuthPrincipal }
  alice: UserPaths
  bob: UserPaths
  optedIn: { value: boolean }
} {
  const root = mkdtempSync(join(tmpdir(), 'harness-remote-policy-'))
  roots.push(root)
  const alice = paths(join(root, 'users', 'alice'))
  const bob = paths(join(root, 'users', 'bob'))
  mkdirSync(alice.projects, { recursive: true })
  mkdirSync(bob.projects, { recursive: true })
  const current = { value: principal(user('alice')) }
  const optedIn = { value: true }
  const sessions = new Map([
    ['alice-session', { meta: { cwd: join(alice.projects, 'one') } }],
    ['bob-session', { meta: { cwd: join(bob.projects, 'one') } }],
  ])
  const ctx = {
    auth: {
      currentPrincipal: () => current.value,
      userPaths: (id: UserId) => id === 'alice' ? alice : bob,
      sharedDeepSeekPreference: () => ({ enabled: optedIn.value }),
    },
    credentials: {
      describe: () => Promise.resolve({ configured: true }),
    },
    sessions: { get: () => undefined },
    sessionController: {
      inspect: (id: SessionId) => {
        const hit = sessions.get(id)
        return hit === undefined
          ? Promise.reject(new ApiSessionNotFound())
          : Promise.resolve(hit)
      },
    },
    workspaceRegistry: { get: () => undefined },
  } as unknown as Context
  return { ctx, current, alice, bob, optedIn }
}

function request(namespace: string, method: string, args: Record<string, unknown> = {}) {
  return { namespace, method, args }
}

async function failure(operation: Promise<unknown>): Promise<TypertRemoteFailure> {
  try {
    await operation
  } catch (error) {
    expect(error).toBeInstanceOf(TypertRemoteFailure)
    return error as TypertRemoteFailure
  }
  throw new Error('expected Gateway policy failure')
}

describe('per-user Remote policy', () => {
  it('filters lists and rejects foreign sessions without revealing their identity', async () => {
    const { ctx, alice, bob } = fixture()
    const policy = userScopedRemotePolicy(ctx)
    const value = await policy.invoke(request('session', 'list'), () => Promise.resolve({
      items: [
        { sessionId: SessionId('alice-session'), cwd: join(alice.projects, 'one'), updatedAt: 2, running: false, blank: true },
        { sessionId: SessionId('bob-session'), cwd: join(bob.projects, 'one'), updatedAt: 1, running: false, blank: true },
      ],
    })) as { items: Array<{ sessionId: SessionId }> }
    expect(value.items.map(item => item.sessionId)).toEqual([SessionId('alice-session')])

    const denied = await failure(policy.invoke(
      request('session', 'view', { request: { sessionId: 'bob-session' } }),
      vi.fn(() => Promise.resolve({})),
    ))
    expect(denied.failure).toMatchObject({ code: 'not-found' })
    expect(denied.message).not.toContain('bob-session')
  })

  it('allows a missing explicit session id only for creation and keeps global settings administrator-only', async () => {
    const { ctx, current } = fixture()
    const policy = userScopedRemotePolicy(ctx)
    const next = vi.fn(() => Promise.resolve({ sessionId: 'new-session' }))
    await expect(policy.invoke(request('session', 'create', {
      request: { sessionId: 'new-session', cwd: ctx.auth.userPaths(current.value.user.id).projects },
    }), next)).resolves.toEqual({ sessionId: 'new-session' })
    expect(next).toHaveBeenCalledOnce()

    const ordinary = await failure(policy.invoke(
      request('settings', 'read', { namespace: 'llm-deepseek' }),
      () => Promise.resolve({}),
    ))
    expect(ordinary.failure).toMatchObject({ code: 'forbidden' })

    current.value = principal(user('alice', 'admin'))
    await expect(policy.invoke(
      request('settings', 'read', { namespace: 'llm-deepseek' }),
      () => Promise.resolve({ revision: 0 }),
    )).resolves.toEqual({ revision: 0 })
  })

  it('keeps process-wide preset authoring administrator-only', async () => {
    const { ctx, current } = fixture()
    const policy = userScopedRemotePolicy(ctx)

    await expect(policy.invoke(
      request('agentPresets', 'list'),
      () => Promise.resolve({ presets: [], authorable: true }),
    )).resolves.toEqual({ presets: [], authorable: false })
    const ordinary = await failure(policy.invoke(
      request('agentPresets', 'copy', { from: 'standard', id: 'mine' }),
      () => Promise.resolve(undefined),
    ))
    expect(ordinary.failure).toMatchObject({ code: 'forbidden' })

    current.value = principal(user('alice', 'admin'))
    await expect(policy.invoke(
      request('agentPresets', 'copy', { from: 'standard', id: 'mine' }),
      () => Promise.resolve(undefined),
    )).resolves.toBeUndefined()
    await expect(policy.invoke(
      request('agentPresets', 'deletePreset', { agentPreset: 'mine' }),
      () => Promise.resolve(undefined),
    )).resolves.toBeUndefined()
  })

  it('canonicalizes managed paths and rejects a symlink escaping the user project tree', async () => {
    const { ctx, alice } = fixture()
    const external = mkdtempSync(join(tmpdir(), 'harness-remote-external-'))
    roots.push(external)
    const escape = join(alice.projects, 'escape')
    symlinkSync(external, escape, 'dir')
    const denied = await failure(userScopedRemotePolicy(ctx).invoke(
      request('workspace', 'create', { request: { path: escape } }),
      () => Promise.resolve({}),
    ))
    expect(denied.failure).toMatchObject({ code: 'not-found' })
  })

  it('publishes the administrator-managed Flash route only to an opted-in user', async () => {
    const { ctx, optedIn } = fixture()
    const policy = userScopedRemotePolicy(ctx)
    const directory = [{
      provider: 'deepseek-official',
      displayName: 'DeepSeek',
      settingsNs: 'llm-deepseek',
      settingsPath: [],
    }]
    await expect(policy.invoke(
      request('llm', 'listConfigurableProviders'),
      () => Promise.resolve(directory),
    )).resolves.toEqual([{ ...directory[0], managedModels: ['deepseek-v4-flash'] }])

    optedIn.value = false
    await expect(policy.invoke(
      request('llm', 'listConfigurableProviders'),
      () => Promise.resolve(directory),
    )).resolves.toEqual(directory)
  })

  it('filters the process-wide control stream to the caller sessions', async () => {
    const { ctx } = fixture()
    const source = (async function *() {
      yield {
        type: 'baseline',
        value: {
          queues: { 'alice-session': [], 'bob-session': [] },
          jobs: { 'alice-session': [], 'bob-session': [] },
          projections: { 'alice-session': {}, 'bob-session': {} },
        },
      }
      yield { type: 'queue', sessionId: SessionId('bob-session'), items: [] }
      yield { type: 'queue', sessionId: SessionId('alice-session'), items: [] }
    })()
    const projected = await userScopedRemotePolicy(ctx).stream(
      request('session', 'control'),
      () => Promise.resolve(source),
    )
    const frames: unknown[] = []
    for await (const frame of projected) frames.push(frame)
    expect(frames).toEqual([
      {
        type: 'baseline',
        value: {
          queues: { 'alice-session': [] },
          jobs: { 'alice-session': [] },
          projections: { 'alice-session': {} },
        },
      },
      { type: 'queue', sessionId: SessionId('alice-session'), items: [] },
    ])
  })
})
