import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { AuthPrincipal, UserId, UserPaths } from '@deepseek-ai/dsh-auth'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ApiProxy, MuxFrame, RpcRequest, WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-host-apiproxy/api'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api'
import { createUserScopedApiProxy } from '@deepseek-ai/dsh-host-apiproxy'

let root: string
let paths: UserPaths
const ownSession = SessionId('own-session')
const foreignSession = SessionId('foreign-session')

function request<P>(id: string, payload: P): RpcRequest<P> {
  return { rpcId: RpcId(id), payload }
}

function ok<T>(rpcId: RpcId, value: T) {
  return { rpcId, result: { ok: true as const, value } }
}

function principal(role: 'admin' | 'user' = 'user'): AuthPrincipal {
  return {
    user: {
      id: 'user-1' as UserId,
      username: 'alice',
      displayName: 'Alice',
      role,
      status: 'active',
      authMethods: ['local'],
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    sessionId: 'browser-session',
    method: 'local',
    expiresAt: '2026-01-02T00:00:00.000Z',
  }
}

function workspace(workspaceId: string, path: string): WorkspaceView {
  return {
    workspaceId: workspaceId as WorkspaceId,
    path,
    title: workspaceId,
    sessionIds: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function fakeContext(
  workspaces: WorkspaceView[] = [],
  shared: { enabled?: boolean; configured?: boolean } = {},
): Context {
  const headers = new Map([
    [ownSession, { cwd: join(paths.projects, 'project-a') }],
    [foreignSession, { cwd: join(root, 'other-user', 'projects', 'project-b') }],
  ])
  const auth = {
    sharedDeepSeekPreference: () => ({ enabled: shared.enabled ?? false }),
  }
  return {
    sessions: {
      get: (id: SessionId) => {
        const header = headers.get(id)
        return header === undefined ? undefined : { id, header }
      },
      list: () => [...headers].map(([id, header]) => ({ id, header })),
    },
    sessionPersistence: {
      inspect: async (id: SessionId) => {
        const meta = headers.get(id)
        if (meta === undefined) throw new Error('not found')
        return { meta }
      },
    },
    workspaceRegistry: {
      list: () => workspaces.map(item => ({ id: item.workspaceId, path: item.path })),
    },
    get: (name: string) => {
      if (name === 'auth') return auth
      return name === 'credentials' ? {
        describe: async () => ({ configured: shared.configured ?? false, writable: true }),
      } : undefined
    },
  } as unknown as Context
}

function fakeBase(overrides: Record<string, unknown> = {}): ApiProxy {
  const empty = vi.fn(async (req: RpcRequest<unknown>) => ok(req.rpcId, {}))
  const emptyStream = async function* (): AsyncIterable<never> {}
  return {
    sessions: {
      list: empty, search: empty, create: empty, history: empty, models: empty,
      selectModel: empty, rename: empty, fork: empty, prompt: empty,
      attachment: empty, updateQueue: empty, cancel: empty,
      ...overrides.sessions as object,
    },
    subagents: { list: empty, history: empty, prompt: empty, interrupt: empty },
    host: { describe: empty, pickDirectory: empty, listDirectory: empty, createDirectory: empty, openPath: empty },
    workspace: {
      list: empty,
      create: empty,
      rename: empty,
      delete: empty,
      insertBefore: empty,
      insertSessionBefore: empty,
      archiveSession: empty,
      ...overrides.workspace as object,
    },
    skills: { list: empty },
    agentPresets: {
      list: empty,
      select: empty,
      read: empty,
      copy: empty,
      openDocument: empty,
      remove: empty,
      ...overrides.agentPresets as object,
    },
    events: { mux: emptyStream, host: emptyStream, ...overrides.events as object },
    goals: { create: empty, edit: empty, pause: empty, resume: empty, complete: empty, clear: empty },
    settings: { describe: empty, openDocument: empty, update: empty, replace: empty, mutate: empty },
    credentials: { describe: empty, set: empty, unset: empty },
    llm: { providers: empty, models: empty, discoverModels: empty, ...overrides.llm as object },
    downloads: { sessionLog: vi.fn(async () => new Response('log')) },
    respond: vi.fn(async () => ({ accepted: true as const })),
  } as unknown as ApiProxy
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = []
  for await (const value of source) values.push(value)
  return values
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-scoped-api-'))
  const userRoot = join(root, 'user-1')
  paths = {
    root: userRoot,
    projects: join(userRoot, 'projects'),
    state: join(userRoot, 'state'),
    settings: join(userRoot, 'settings'),
    credentials: join(userRoot, 'credentials'),
    sessions: join(userRoot, 'sessions'),
    attachments: join(userRoot, 'attachments'),
  }
  await Promise.all([
    mkdir(join(paths.projects, 'project-a'), { recursive: true }),
    mkdir(join(root, 'other-user', 'projects', 'project-b'), { recursive: true }),
  ])
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('per-user API authorization view', () => {
  it('filters session and workspace lists and blocks direct foreign history', async () => {
    const ownWorkspace = workspace('own-workspace', join(paths.projects, 'project-a'))
    const foreignWorkspace = workspace('foreign-workspace', join(root, 'other-user', 'projects', 'project-b'))
    const history = vi.fn(async (req: RpcRequest<unknown>) => ok(req.rpcId, { items: [] }))
    const base = fakeBase({
      sessions: {
        list: async (req: RpcRequest<unknown>) => ok(req.rpcId, {
          items: [
            { sessionId: ownSession, updatedAt: 1, running: false, blank: false, cwd: ownWorkspace.path },
            { sessionId: foreignSession, updatedAt: 1, running: false, blank: false, cwd: foreignWorkspace.path },
          ],
        }),
        history,
      },
      workspace: {
        list: async (req: RpcRequest<unknown>) => ok(req.rpcId, {
          items: [ownWorkspace, foreignWorkspace],
          archivedSessionIds: [ownSession, foreignSession],
        }),
      },
    })
    const api = createUserScopedApiProxy(fakeContext([ownWorkspace, foreignWorkspace]), base, principal(), paths)

    const sessions = await api.sessions.list(request('list-sessions', {}))
    expect(sessions.result.ok && sessions.result.value.items.map(item => item.sessionId)).toEqual([ownSession])
    const workspaces = await api.workspace.list(request('list-workspaces', {}))
    expect(workspaces.result.ok && workspaces.result.value.items.map(item => item.workspaceId)).toEqual(['own-workspace'])
    expect(workspaces.result.ok && workspaces.result.value.archivedSessionIds).toEqual([ownSession])

    const denied = await api.sessions.history(request('foreign-history', { sessionId: foreignSession }))
    expect(denied.result).toMatchObject({ ok: false, error: { code: 'session-not-found' } })
    expect(history).not.toHaveBeenCalled()
  })

  it('rejects foreign project creation before the base API is called', async () => {
    const createSession = vi.fn(async (req: RpcRequest<unknown>) => ok(req.rpcId, {}))
    const createWorkspace = vi.fn(async (req: RpcRequest<unknown>) => ok(req.rpcId, {}))
    const base = fakeBase({ sessions: { create: createSession }, workspace: { create: createWorkspace } })
    const api = createUserScopedApiProxy(fakeContext(), base, principal(), paths)
    const foreign = join(root, 'other-user', 'projects', 'project-b')

    expect((await api.sessions.create(request('create-session', { cwd: foreign }))).result.ok).toBe(false)
    expect((await api.workspace.create(request('create-workspace', { path: foreign }))).result.ok).toBe(false)
    expect(createSession).not.toHaveBeenCalled()
    expect(createWorkspace).not.toHaveBeenCalled()
  })

  it('reserves the dynamic Cordis preset for administrators', async () => {
    const create = vi.fn(async (req: RpcRequest<unknown>) => ok(req.rpcId, {}))
    const select = vi.fn(async (req: RpcRequest<unknown>) => ok(req.rpcId, { agentPreset: 'cordis' }))
    const list = vi.fn(async (req: RpcRequest<unknown>) => ok(req.rpcId, {
      presets: [
        { id: 'standard', trust: 'system', isDefault: true },
        { id: 'cordis', trust: 'system', isDefault: false },
      ],
      authorable: true,
      hasDocument: true,
    }))
    const base = fakeBase({ sessions: { create }, agentPresets: { list, select } })
    const ordinary = createUserScopedApiProxy(fakeContext(), base, principal(), paths)

    const visible = await ordinary.agentPresets.list(request('ordinary-presets', {}))
    expect(visible.result.ok && visible.result.value).toEqual({
      presets: [{ id: 'standard', trust: 'system', isDefault: true }],
      authorable: false,
      hasDocument: false,
    })
    expect((await ordinary.sessions.create(request('ordinary-create', {
      cwd: join(paths.projects, 'project-a'),
      agentPreset: 'cordis',
    }))).result).toMatchObject({ ok: false, error: { message: '仅管理员可使用动态 Cordis 插件模式' } })
    expect((await ordinary.agentPresets.select(request('ordinary-select', {
      sessionId: ownSession,
      agentPreset: 'cordis',
    }))).result).toMatchObject({ ok: false, error: { message: '仅管理员可使用动态 Cordis 插件模式' } })
    expect(create).not.toHaveBeenCalled()
    expect(select).not.toHaveBeenCalled()

    const administrator = createUserScopedApiProxy(fakeContext(), base, principal('admin'), paths)
    const adminVisible = await administrator.agentPresets.list(request('admin-presets', {}))
    expect(adminVisible.result.ok && adminVisible.result.value.presets.map(preset => preset.id))
      .toEqual(['standard', 'cordis'])
    expect(adminVisible.result.ok && adminVisible.result.value.authorable).toBe(true)
    expect((await administrator.sessions.create(request('admin-create', {
      cwd: join(paths.projects, 'project-a'),
      agentPreset: 'cordis',
    }))).result.ok).toBe(true)
    expect((await administrator.agentPresets.select(request('admin-select', {
      sessionId: ownSession,
      agentPreset: 'cordis',
    }))).result.ok).toBe(true)
    expect(create).toHaveBeenCalledTimes(1)
    expect(select).toHaveBeenCalledTimes(1)
  })

  it('drops foreign mux frames and only accepts responses observed on this user stream', async () => {
    const mux = async function* (): AsyncIterable<RpcRequest<MuxFrame>> {
      yield request('own-approval', { type: 'approval/requested', sessionId: ownSession, approvalId: 'approval-1', toolName: 'bash' } as MuxFrame)
      yield request('foreign-approval', { type: 'approval/requested', sessionId: foreignSession, approvalId: 'approval-2', toolName: 'bash' } as MuxFrame)
    }
    const respond = vi.fn(async () => ({ accepted: true as const }))
    const base = fakeBase({ events: { mux }, respond })
    base.respond = respond
    const api = createUserScopedApiProxy(fakeContext(), base, principal(), paths)
    const frames = await collect(api.events.mux(request('open-mux', {}), new AbortController().signal))

    expect(frames.map(frame => frame.rpcId)).toEqual(['own-approval'])
    expect(await api.respond({ type: 'client-response', rpcId: RpcId('foreign-approval'), result: { ok: true, value: {} } })).toEqual({ accepted: false, reason: 'not-pending' })
    expect((await api.respond({ type: 'client-response', rpcId: RpcId('own-approval'), result: { ok: true, value: {} } })).accepted).toBe(true)
    expect(respond).toHaveBeenCalledTimes(1)
  })

  it('advertises the managed Flash model only to opted-in users while the shared key is configured', async () => {
    const providers = vi.fn(async (req: RpcRequest<unknown>) => ok(req.rpcId, {
      providers: [{
        provider: 'deepseek-official',
        displayName: 'DeepSeek',
        settingsNs: 'llm-deepseek',
        settingsPath: [],
        active: true,
      }],
    }))
    const base = fakeBase({ llm: { providers } })

    const optedIn = createUserScopedApiProxy(
      fakeContext([], { enabled: true, configured: true }),
      base,
      principal(),
      paths,
    )
    const available = await optedIn.llm.providers(request('managed-available', {}))
    expect(available.result.ok && available.result.value.providers).toEqual([{
      provider: 'deepseek-official',
      displayName: 'DeepSeek',
      settingsNs: 'llm-deepseek',
      settingsPath: [],
      active: true,
      managedModels: ['deepseek-v4-flash'],
    }])

    for (const [id, shared] of [
      ['not-opted-in', { enabled: false, configured: true }],
      ['key-missing', { enabled: true, configured: false }],
    ] as const) {
      const api = createUserScopedApiProxy(fakeContext([], shared), base, principal(), paths)
      const response = await api.llm.providers(request(id, {}))
      expect(response.result.ok && response.result.value.providers[0]).not.toHaveProperty('managedModels')
    }
  })
})
