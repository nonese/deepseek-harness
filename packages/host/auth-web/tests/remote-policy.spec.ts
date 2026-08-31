/** Per-user Gateway authorization and projection coverage. */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { AuthPrincipal, AuthUser, UserId, UserPaths } from '@deepseek-ai/dsh-auth'
import { ApiSessionNotFound } from '@deepseek-ai/dsh-api-session-controller'
import { SessionId } from '@deepseek-ai/dsh-session'
import { remoteErrorOf, type RemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
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
  credentialConfigured: { value: boolean }
  personalCredentialConfigured: { value: boolean }
  modelSettings: { providers: Record<string, unknown>; sharedModels?: string[] }
  liveSessions: Map<string, { header: { cwd?: string } }>
  workspaces: Map<string, { path: string }>
  inspectError: { value?: Error }
} {
  const root = mkdtempSync(join(tmpdir(), 'harness-remote-policy-'))
  roots.push(root)
  const alice = paths(join(root, 'users', 'alice'))
  const bob = paths(join(root, 'users', 'bob'))
  mkdirSync(alice.projects, { recursive: true })
  mkdirSync(bob.projects, { recursive: true })
  const current = { value: principal(user('alice')) }
  const optedIn = { value: true }
  const credentialConfigured = { value: true }
  const personalCredentialConfigured = { value: false }
  const modelSettings: { providers: Record<string, unknown>; sharedModels?: string[] } = { providers: {} }
  const liveSessions = new Map<string, { header: { cwd?: string } }>()
  const workspaces = new Map<string, { path: string }>()
  const inspectError: { value?: Error } = {}
  const sessions = new Map([
    ['alice-session', { meta: { cwd: join(alice.projects, 'one') } }],
    ['bob-session', { meta: { cwd: join(bob.projects, 'one') } }],
  ])
  const ctx = {
    get(name: string): unknown {
      return Reflect.get(this, name) as unknown
    },
    auth: {
      currentPrincipal: () => current.value,
      userPaths: (id: UserId) => id === 'alice' ? alice : bob,
      sharedDeepSeekPreference: () => ({ enabled: optedIn.value }),
    },
    credentials: {
      describe: () => Promise.resolve({ configured: credentialConfigured.value }),
    },
    userCredentials: {
      current: () => ({}),
      forOwner: () => ({
        describe: () => Promise.resolve({ configured: personalCredentialConfigured.value, writable: true }),
      }),
    },
    settings: {
      writable: true,
      get: () => modelSettings,
    },
    sessions: { get: (id: SessionId) => liveSessions.get(id) },
    sessionController: {
      inspect: (id: SessionId) => {
        if (inspectError.value !== undefined) return Promise.reject(inspectError.value)
        const hit = sessions.get(id)
        return hit === undefined
          ? Promise.reject(new ApiSessionNotFound())
          : Promise.resolve(hit)
      },
    },
    workspaceRegistry: { get: (id: string) => workspaces.get(id) },
  } as unknown as Context
  return {
    ctx,
    current,
    alice,
    bob,
    optedIn,
    credentialConfigured,
    personalCredentialConfigured,
    modelSettings,
    liveSessions,
    workspaces,
    inspectError,
  }
}

function request(namespace: string, method: string, args: Record<string, unknown> = {}) {
  return { namespace, method, args }
}

async function failure(operation: Promise<unknown>): Promise<RemoteFailure> {
  try {
    await operation
  } catch (error: unknown) {
    const failure = remoteErrorOf(error)
    if (failure === undefined) throw error
    return failure
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
    expect(denied).toMatchObject({ code: 'auth/not-found' })
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
    expect(ordinary).toMatchObject({ code: 'auth/forbidden' })

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
    expect(ordinary).toMatchObject({ code: 'auth/forbidden' })

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
    expect(denied).toMatchObject({ code: 'auth/not-found' })
  })

  it('publishes every administrator-selected official model only to an opted-in user', async () => {
    const { ctx, modelSettings, optedIn } = fixture()
    modelSettings.sharedModels = ['deepseek-v4-flash', 'deepseek-v4-pro']
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
    )).resolves.toEqual([{
      ...directory[0],
      managedModels: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    }])

    optedIn.value = false
    await expect(policy.invoke(
      request('llm', 'listConfigurableProviders'),
      () => Promise.resolve(directory),
    )).resolves.toEqual(directory)
  })

  it('limits the official catalog to shared models only when the user has no personal key', async () => {
    const { ctx, modelSettings, personalCredentialConfigured } = fixture()
    modelSettings.sharedModels = ['deepseek-v4-pro', 'deepseek-v4-flash']
    const policy = userScopedRemotePolicy(ctx)
    const catalog = {
      default: { provider: 'deepseek-official', model: 'deepseek-v4-flash-vision-exp' },
      routableProviders: ['deepseek-official', 'local'],
      groups: [
        {
          id: 'deepseek-official',
          name: 'DeepSeek',
          models: [
            { id: 'deepseek-v4-flash', name: 'Flash' },
            { id: 'deepseek-v4-pro', name: 'Pro' },
            { id: 'deepseek-v4-flash-vision-exp', name: 'Vision' },
          ],
        },
        { id: 'local', name: 'Local', models: [{ id: 'local-model', name: 'Local' }] },
      ],
      failures: [],
    }

    await expect(policy.invoke(
      request('session', 'modelCatalog'),
      () => Promise.resolve(catalog),
    )).resolves.toEqual({
      ...catalog,
      default: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      groups: [
        {
          ...catalog.groups[0],
          models: [
            { id: 'deepseek-v4-flash', name: 'Flash' },
            { id: 'deepseek-v4-pro', name: 'Pro' },
          ],
        },
        catalog.groups[1],
      ],
    })

    personalCredentialConfigured.value = true
    await expect(policy.invoke(
      request('session', 'modelCatalog'),
      () => Promise.resolve(catalog),
    )).resolves.toEqual(catalog)
  })

  it('hides a custom managed site until its user opts in', async () => {
    const { ctx, modelSettings, optedIn } = fixture()
    modelSettings.providers['managed-a1b2c3d4e5f6'] = {
      api: 'openai-completions',
      displayName: '校内 New API',
      baseURL: 'https://new-api.example.test/v1',
      apiKeyEnv: 'HARNESS_SHARED_MODEL_A1B2C3D4E5F6_API_KEY',
      models: [{ id: 'deepseek-chat', name: 'deepseek-chat' }],
    }
    const policy = userScopedRemotePolicy(ctx)
    const catalog = {
      default: { provider: 'managed-a1b2c3d4e5f6', model: 'deepseek-chat' },
      routableProviders: ['managed-a1b2c3d4e5f6', 'local'],
      groups: [
        { id: 'managed-a1b2c3d4e5f6', name: '校内 New API', models: [{ id: 'deepseek-chat', name: 'deepseek-chat' }] },
        { id: 'local', name: 'Local', models: [{ id: 'local-model', name: 'local-model' }] },
      ],
      failures: [{ id: 'managed-a1b2c3d4e5f6', name: '校内 New API', message: 'unavailable' }],
    }

    optedIn.value = false
    await expect(policy.invoke(
      request('session', 'modelCatalog'),
      () => Promise.resolve(catalog),
    )).resolves.toEqual({
      default: { provider: 'local', model: 'local-model' },
      routableProviders: ['local'],
      groups: [{ id: 'local', name: 'Local', models: [{ id: 'local-model', name: 'local-model' }] }],
      failures: [],
    })

    await expect(policy.invoke(
      request('session', 'modelCatalog'),
      () => Promise.resolve({ ...catalog, default: { provider: 'local', model: 'local-model' } }),
    )).resolves.toMatchObject({ default: { provider: 'local', model: 'local-model' } })

    optedIn.value = true
    await expect(policy.invoke(
      request('session', 'modelCatalog'),
      () => Promise.resolve(catalog),
    )).resolves.toBe(catalog)
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

  it('rejects requests when no authenticated principal is installed', async () => {
    const { ctx } = fixture()
    const auth = ctx.auth as unknown as { currentPrincipal: () => AuthPrincipal | undefined }
    auth.currentPrincipal = () => undefined
    const policy = userScopedRemotePolicy(ctx)
    const invokeNext = vi.fn(() => Promise.resolve('value'))
    expect((await failure(policy.invoke(
      request('unscoped', 'method'),
      invokeNext,
    ))).code).toBe('auth/forbidden')
    expect(invokeNext).not.toHaveBeenCalled()

    const source = (async function *() { yield 'frame' })()
    const streamNext = vi.fn(() => Promise.resolve(source))
    expect((await failure(policy.stream(
      request('unscoped', 'stream'),
      streamNext,
    ))).code).toBe('auth/forbidden')
    expect(streamNext).not.toHaveBeenCalled()
  })

  it('allows the personal credentials namespace and projects updates only to their owner', async () => {
    const { ctx } = fixture()
    const policy = userScopedRemotePolicy(ctx)
    await expect(policy.invoke(
      request('credentials', 'describe', { refs: ['DEEPSEEK_API_KEY'] }),
      () => Promise.resolve({ DEEPSEEK_API_KEY: { configured: false, writable: true } }),
    )).resolves.toEqual({ DEEPSEEK_API_KEY: { configured: false, writable: true } })

    const source = (async function *() {
      yield { type: 'emit', event: 'user-credentials/reference-updated', args: ['bob', 'DEEPSEEK_API_KEY'] }
      yield { type: 'emit', event: 'user-credentials/reference-updated', args: ['alice', 'DEEPSEEK_API_KEY'] }
      yield { type: 'emit', event: 'credentials/reference-updated', args: ['HARNESS_SHARED_DEEPSEEK_API_KEY'] }
    })()
    const projected = await policy.stream(request('$events', 'follow'), () => Promise.resolve(source))
    const frames: unknown[] = []
    for await (const frame of projected) frames.push(frame)
    expect(frames).toEqual([
      { type: 'emit', event: 'credentials/reference-updated', args: ['DEEPSEEK_API_KEY'] },
    ])

    Reflect.deleteProperty(ctx, 'userCredentials')
    expect((await failure(policy.invoke(
      request('credentials', 'describe', { refs: ['DEEPSEEK_API_KEY'] }),
      () => Promise.resolve({}),
    )))).toMatchObject({ code: 'auth/forbidden' })
  })

  it('rejects native filesystem access and unscoped ordinary-user endpoints', async () => {
    const { ctx } = fixture()
    const policy = userScopedRemotePolicy(ctx)
    for (const endpoint of [
      ['directoryPicker', 'pick'],
      ['directoryPicker', 'list'],
      ['directoryPicker', 'createDirectory'],
      ['session', 'openWorkspacePath'],
    ] as const) {
      const denied = await failure(policy.invoke(
        request(endpoint[0], endpoint[1]),
        () => Promise.resolve(undefined),
      ))
      expect(denied.code).toBe('auth/forbidden')
    }
    const denied = await failure(policy.invoke(
      request('pluginInventory', 'mutate'),
      () => Promise.resolve(undefined),
    ))
    expect(denied.code).toBe('auth/forbidden')
  })

  it('validates managed workspaces, nested identifiers, and live session ownership', async () => {
    const { ctx, alice, bob, liveSessions, workspaces } = fixture()
    const policy = userScopedRemotePolicy(ctx)
    workspaces.set('alice-workspace', { path: join(alice.projects, 'one') })
    workspaces.set('bob-workspace', { path: join(bob.projects, 'one') })
    liveSessions.set('live-alice', { header: { cwd: join(alice.projects, 'live') } })
    liveSessions.set('live-bob', { header: { cwd: join(bob.projects, 'live') } })
    liveSessions.set('live-no-cwd', { header: {} })

    await expect(policy.invoke(
      request('workspace', 'create', { request: { path: join(alice.projects, 'new') } }),
      () => Promise.resolve('created'),
    )).resolves.toBe('created')
    for (const args of [
      { request: {} },
      { request: { path: join(bob.projects, 'new') } },
    ]) {
      expect((await failure(policy.invoke(
        request('workspace', 'create', args),
        () => Promise.resolve(undefined),
      ))).code).toBe('auth/not-found')
    }

    await expect(policy.invoke(
      request('session', 'create', { request: { workspaceId: 'alice-workspace' } }),
      () => Promise.resolve('created'),
    )).resolves.toBe('created')
    for (const body of [
      { cwd: join(bob.projects, 'one') },
      { workspaceId: 'bob-workspace' },
      { workspaceId: 'missing-workspace' },
      { cwd: join(alice.projects, 'one'), sessionId: 'bob-session' },
    ]) {
      expect((await failure(policy.invoke(
        request('session', 'create', { request: body }),
        () => Promise.resolve(undefined),
      ))).code).toBe('auth/not-found')
    }
    expect((await failure(policy.invoke(
      request('session', 'create', { request: {} }),
      () => Promise.resolve(undefined),
    ))).code).toBe('auth/forbidden')
    expect((await failure(policy.invoke(
      request('session', 'create', { request: [] }),
      () => Promise.resolve(undefined),
    ))).code).toBe('auth/forbidden')

    await expect(policy.invoke(
      request('session', 'view', { nested: [{ agentId: 'live-alice' }, null, 1] }),
      () => Promise.resolve('owned'),
    )).resolves.toBe('owned')
    for (const id of ['live-bob', 'live-no-cwd']) {
      expect((await failure(policy.invoke(
        request('session', 'view', { nested: { childSessionId: id } }),
        () => Promise.resolve(undefined),
      ))).code).toBe('auth/not-found')
    }
    expect((await failure(policy.invoke(
      request('workspace', 'read', { payload: { beforeWorkspaceId: 'bob-workspace' } }),
      () => Promise.resolve(undefined),
    ))).code).toBe('auth/not-found')
  })

  it('propagates unexpected session inspection failures', async () => {
    const { ctx, inspectError } = fixture()
    inspectError.value = new Error('storage unavailable')
    await expect(userScopedRemotePolicy(ctx).invoke(
      request('session', 'view', { request: { sessionId: 'unknown' } }),
      () => Promise.resolve(undefined),
    )).rejects.toThrow('storage unavailable')
  })

  it('projects session search and all configurable-provider variants', async () => {
    const { ctx, credentialConfigured, optedIn } = fixture()
    const policy = userScopedRemotePolicy(ctx)
    const search = {
      items: [
        { sessionId: SessionId('alice-session') },
        { sessionId: SessionId('bob-session') },
        { sessionId: SessionId('missing-session') },
      ],
    }
    await expect(policy.invoke(
      request('session', 'search'),
      () => Promise.resolve(search),
    )).resolves.toEqual({ items: [{ sessionId: SessionId('alice-session') }] })

    const entries = [null, 'text', { provider: 'other' }, { provider: 'deepseek-official' }]
    credentialConfigured.value = false
    await expect(policy.invoke(
      request('llm', 'listConfigurableProviders'),
      () => Promise.resolve(entries),
    )).resolves.toEqual(entries)
    credentialConfigured.value = true
    optedIn.value = true
    await expect(policy.invoke(
      request('llm', 'listConfigurableProviders'),
      () => Promise.resolve(entries),
    )).resolves.toEqual([
      null,
      'text',
      { provider: 'other' },
      { provider: 'deepseek-official', managedModels: ['deepseek-v4-flash'] },
    ])
    await expect(policy.invoke(
      request('llm', 'listConfigurableProviders'),
      () => Promise.resolve({ provider: 'deepseek-official' }),
    )).resolves.toEqual({ provider: 'deepseek-official' })
  })

  it('projects every workspace stream frame without leaking foreign resources', async () => {
    const { ctx, alice, bob } = fixture()
    const source = (async function *() {
      yield {
        type: 'baseline',
        value: {
          items: [
            { workspaceId: 'alice-workspace', path: join(alice.projects, 'one') },
            { workspaceId: 'bob-workspace', path: join(bob.projects, 'one') },
          ],
          archivedSessionIds: [SessionId('alice-session'), SessionId('bob-session')],
        },
      }
      yield { type: 'upsert', workspace: { workspaceId: 'bob-new', path: join(bob.projects, 'new') } }
      yield { type: 'upsert', workspace: { workspaceId: 'alice-new', path: join(alice.projects, 'new') } }
      yield { type: 'order', workspaceIds: ['bob-workspace', 'alice-workspace', 'alice-new'] }
      yield { type: 'remove', workspaceId: 'bob-workspace' }
      yield { type: 'remove', workspaceId: 'alice-new' }
      yield { type: 'archived', archivedSessionIds: [SessionId('alice-session'), SessionId('bob-session')] }
    })()
    const projected = await userScopedRemotePolicy(ctx).stream(
      request('workspace', 'follow'),
      () => Promise.resolve(source),
    )
    const frames: unknown[] = []
    for await (const frame of projected) frames.push(frame)
    expect(frames).toEqual([
      {
        type: 'baseline',
        value: {
          items: [{ workspaceId: 'alice-workspace', path: join(alice.projects, 'one') }],
          archivedSessionIds: [SessionId('alice-session')],
        },
      },
      { type: 'upsert', workspace: { workspaceId: 'alice-new', path: join(alice.projects, 'new') } },
      { type: 'order', workspaceIds: ['alice-workspace', 'alice-new'] },
      { type: 'remove', workspaceId: 'alice-new' },
      { type: 'archived', archivedSessionIds: [SessionId('alice-session')] },
    ])
  })

  it('projects global events by role and owned resource', async () => {
    const { ctx, current, alice, bob } = fixture()
    const frames = [
      null,
      'invalid',
      { type: 'unknown' },
      { type: 'ready', host: { home: '/host-home' }, version: 1 },
      { type: 'waterfall', eventId: 'bob-waterfall', agentId: 'bob-session' },
      { type: 'waterfall', eventId: 'alice-waterfall', agentId: 'alice-session' },
      { type: 'cancel', eventId: 'bob-waterfall' },
      { type: 'cancel', eventId: 'alice-waterfall' },
      { type: 'emit', event: 'llm/adapters-updated', args: [] },
      { type: 'emit', event: 'credentials/reference-updated', args: [] },
      { type: 'emit', event: 'settings/document-updated', args: [] },
      { type: 'emit', event: 'cordis/plugin-added', args: [] },
      { type: 'emit', event: 'api-session/added', args: [null] },
      { type: 'emit', event: 'api-session/added', args: [{ cwd: join(bob.projects, 'one') }] },
      { type: 'emit', event: 'api-session/added', args: [{ cwd: join(alice.projects, 'one') }] },
      { type: 'emit', event: 'session/custom', args: [42, 'bob-session'] },
      { type: 'emit', event: 'session/custom', args: [42, 'alice-session'] },
      { type: 'emit', event: 'session/custom', args: [42] },
    ]
    const collect = async (): Promise<unknown[]> => {
      const source = (async function *() { for (const frame of frames) yield frame })()
      const projected = await userScopedRemotePolicy(ctx).stream(
        request('$events', 'follow'),
        () => Promise.resolve(source),
      )
      const result: unknown[] = []
      for await (const frame of projected) result.push(frame)
      return result
    }
    const ordinary = await collect()
    expect(ordinary).toEqual([
      { type: 'ready', host: { home: alice.root }, version: 1 },
      { type: 'waterfall', eventId: 'alice-waterfall', agentId: 'alice-session' },
      { type: 'cancel', eventId: 'alice-waterfall' },
      { type: 'emit', event: 'llm/adapters-updated', args: [] },
      { type: 'emit', event: 'api-session/added', args: [{ cwd: join(alice.projects, 'one') }] },
      { type: 'emit', event: 'session/custom', args: [42, 'alice-session'] },
    ])

    current.value = principal(user('alice', 'admin'))
    const admin = await collect()
    expect(admin).toContainEqual({ type: 'emit', event: 'credentials/reference-updated', args: [] })
    expect(admin).toContainEqual({ type: 'emit', event: 'settings/document-updated', args: [] })
    expect(admin).toContainEqual({ type: 'emit', event: 'cordis/plugin-added', args: [] })
  })

  it('returns untouched streams and ordinary values for unrelated safe endpoints', async () => {
    const { ctx, current } = fixture()
    const policy = userScopedRemotePolicy(ctx)
    const source = (async function *() { yield { type: 'value' } })()
    await expect(policy.stream(
      request('workspace', 'create', { request: { path: ctx.auth.userPaths(current.value.user.id).projects } }),
      () => Promise.resolve(source),
    )).resolves.toBe(source)
    await expect(policy.invoke(
      request('llm', 'listProviders'),
      () => Promise.resolve('unchanged'),
    )).resolves.toBe('unchanged')

    current.value = principal(user('alice', 'admin'))
    await expect(policy.invoke(
      request('agentPresets', 'list'),
      () => Promise.resolve({ presets: [], authorable: true }),
    )).resolves.toEqual({ presets: [], authorable: true })
    current.value = principal(user('alice'))
    await expect(policy.invoke(
      request('agentPresets', 'list'),
      () => Promise.resolve(null),
    )).resolves.toBeNull()
  })
})
