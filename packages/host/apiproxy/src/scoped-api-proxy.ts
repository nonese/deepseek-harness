/** Per-user authorization view over one process-global API implementation. */

import { realpathSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { AuthPrincipal, UserPaths } from '@deepseek-ai/dsh-auth'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type {
  ApiProxy,
  ClientResponse,
  HostFrame,
  MuxFrame,
  RpcReceipt,
  RpcRequest,
  RpcResponse,
  WorkspaceView,
} from './api/index.ts'

const SHARED_DEEPSEEK_PROVIDER = 'deepseek-official'
const SHARED_DEEPSEEK_MODEL = 'deepseek-v4-flash'
const SHARED_DEEPSEEK_CREDENTIAL_REF = credentialRef('HARNESS_SHARED_DEEPSEEK_API_KEY')
const ADMIN_ONLY_AGENT_PRESETS = new Set(['cordis'])

function canonicalPath(path: string): string {
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
      if (parent === current) return resolve(path)
      missing.push(basename(current))
      current = parent
    }
  }
}

function pathWithin(root: string, candidate: string): boolean {
  const nested = relative(canonicalPath(root), canonicalPath(candidate))
  return nested === '' || (!nested.startsWith('..') && !isAbsolute(nested))
}

async function canonicalPathWithin(root: string, candidate: string): Promise<boolean> {
  try {
    return pathWithin(await realpath(root), await realpath(candidate))
  } catch {
    return false
  }
}

function rejected<P, T>(request: RpcRequest<P>, message = '资源不存在或不属于当前用户'): RpcResponse<T> {
  return {
    rpcId: request.rpcId,
    result: { ok: false, error: { code: 'internal', message, details: {} } },
  }
}

function sessionRejected<P, T>(request: RpcRequest<P>, sessionId: SessionId): RpcResponse<T> {
  return {
    rpcId: request.rpcId,
    result: {
      ok: false,
      error: { code: 'session-not-found', message: `session "${sessionId}" not found`, details: { sessionId } },
    },
  }
}

/**
 * Build one authorization view. The underlying runtime remains shared; every
 * addressable session, workspace, directory, event, download, and response
 * receipt is checked against the principal's generated project root.
 * @param ctx - shared Host services containing sessions, persistence, and workspaces.
 * @param base - process-global API implementation to authorize.
 * @param principal - authenticated browser identity for this view.
 * @param paths - program-managed directories owned by the principal.
 * @returns an API facade that filters and rejects resources outside `paths`.
 */
export function createUserScopedApiProxy(
  ctx: Context,
  base: ApiProxy,
  principal: AuthPrincipal,
  paths: UserPaths,
): ApiProxy {
  const auth = ctx.get('auth')
  if (auth === undefined) throw new Error('createUserScopedApiProxy requires ctx.auth')
  const admin = principal.user.role === 'admin'
  const USER_SAFE_REMOTE_EVENTS = new Set(['commands/change', 'llm/adapters-updated'])
  const allowedSessions = new Set<SessionId>()
  const allowedWorkspaces = new Set<string>()
  const answerableRpcIds = new Set<string>()

  const sessionHeader = async (sessionId: SessionId): Promise<SessionHeader | undefined> => {
    const live = ctx.sessions.get(sessionId)
    if (live !== undefined) return live.header
    try {
      return (await ctx.sessionPersistence.inspect(sessionId)).meta
    } catch {
      return undefined
    }
  }

  const sessionAllowed = async (sessionId: SessionId): Promise<boolean> => {
    if (allowedSessions.has(sessionId)) return true
    const header = await sessionHeader(sessionId)
    const allowed = header?.cwd !== undefined && pathWithin(paths.projects, header.cwd)
    if (allowed) allowedSessions.add(sessionId)
    return allowed
  }

  const workspaceAllowed = (workspaceId: string): boolean => {
    if (allowedWorkspaces.has(workspaceId)) return true
    const workspace = ctx.workspaceRegistry.list().find(candidate => String(candidate.id) === workspaceId)
    const allowed = workspace !== undefined && pathWithin(paths.projects, workspace.path)
    if (allowed) allowedWorkspaces.add(workspaceId)
    return allowed
  }

  const sessionMethod = <P extends { sessionId: SessionId }, T>(
    method: (request: RpcRequest<P>) => Promise<RpcResponse<T>>,
  ) => async (request: RpcRequest<P>): Promise<RpcResponse<T>> =>
    await sessionAllowed(request.payload.sessionId)
      ? method(request)
      : sessionRejected(request, request.payload.sessionId)

  const parentMethod = <P extends { parentSessionId: SessionId }, T>(
    method: (request: RpcRequest<P>, signal?: AbortSignal) => Promise<RpcResponse<T>>,
  ) => async (request: RpcRequest<P>, signal?: AbortSignal): Promise<RpcResponse<T>> =>
    await sessionAllowed(request.payload.parentSessionId)
      ? method(request, signal)
      : sessionRejected(request, request.payload.parentSessionId)

  const goalMethod = sessionMethod

  const denyConfiguration = <P, T>(request: RpcRequest<P>): Promise<RpcResponse<T>> =>
    Promise.resolve(rejected(request, '仅管理员可访问系统配置'))

  const filterWorkspace = (workspace: WorkspaceView): boolean => {
    const allowed = pathWithin(paths.projects, workspace.path)
    if (allowed) allowedWorkspaces.add(String(workspace.workspaceId))
    return allowed
  }

  const filterMux = async function* (
    source: AsyncIterable<RpcRequest<MuxFrame>>,
  ): AsyncIterable<RpcRequest<MuxFrame>> {
    for await (const envelope of source) {
      const payload = envelope.payload
      if (payload.type === 'stream/error') {
        yield envelope
        continue
      }
      if (!await sessionAllowed(payload.sessionId)) continue
      if (payload.type === 'approval/requested' || payload.type === 'question/requested') {
        answerableRpcIds.add(String(envelope.rpcId))
      }
      yield envelope
    }
  }

  const filterHost = async function* (
    source: AsyncIterable<RpcRequest<HostFrame>>,
  ): AsyncIterable<RpcRequest<HostFrame>> {
    for await (const envelope of source) {
      const payload = envelope.payload
      if (payload.type === 'stream/error') {
        yield envelope
        continue
      }
      if (payload.type === 'host/remote-event') {
        if (admin || USER_SAFE_REMOTE_EVENTS.has(payload.event)) yield envelope
        continue
      }
      if (payload.type === 'host/workspace-changed') {
        if (filterWorkspace(payload.workspace)) yield envelope
        continue
      }
      if (payload.type === 'host/workspace-removed') {
        const id = String(payload.workspaceId)
        if (allowedWorkspaces.delete(id)) yield envelope
        continue
      }
      if (payload.type === 'host/workspace-order-changed') {
        yield {
          ...envelope,
          payload: {
            ...payload,
            workspaceIds: payload.workspaceIds.filter(id => workspaceAllowed(String(id))),
          },
        }
        continue
      }
      if (payload.type === 'host/archived-sessions-changed') {
        const checks = await Promise.all(payload.archivedSessionIds.map(sessionAllowed))
        yield {
          ...envelope,
          payload: {
            ...payload,
            archivedSessionIds: payload.archivedSessionIds.filter((_id, index) => checks[index]),
          },
        }
        continue
      }
      if (await sessionAllowed(payload.sessionId)) yield envelope
    }
  }

  return {
    sessions: {
      async list(request) {
        const response = await base.sessions.list(request)
        if (!response.result.ok) return response
        const checks = response.result.value.items.map(item =>
          item.cwd !== undefined && pathWithin(paths.projects, item.cwd))
        const items = response.result.value.items.filter((item, index) => {
          if (!checks[index]) return false
          allowedSessions.add(item.sessionId)
          return true
        })
        return { ...response, result: { ok: true, value: { items } } }
      },
      async search(request, signal) {
        const response = await base.sessions.search(request, signal)
        if (!response.result.ok) return response
        const checks = await Promise.all(response.result.value.items.map(item => sessionAllowed(item.sessionId)))
        return {
          ...response,
          result: {
            ok: true,
            value: {
              items: response.result.value.items.filter((_item, index) => checks[index]),
              hasMore: response.result.value.hasMore,
            },
          },
        }
      },
      async create(request) {
        if (!admin && request.payload.agentPreset !== undefined
          && ADMIN_ONLY_AGENT_PRESETS.has(request.payload.agentPreset)) {
          return rejected(request, '仅管理员可使用动态 Cordis 插件模式')
        }
        const { workspaceId, cwd, ...rest } = request.payload
        if (workspaceId !== undefined) {
          if (!workspaceAllowed(String(workspaceId))) return rejected(request)
          return base.sessions.create(request)
        }
        if (cwd !== undefined && !await canonicalPathWithin(paths.projects, cwd)) return rejected(request)
        if (rest.sessionId !== undefined) {
          const header = await sessionHeader(rest.sessionId)
          if (header !== undefined && !await sessionAllowed(rest.sessionId)) {
            return sessionRejected(request, rest.sessionId)
          }
        }
        return base.sessions.create({
          ...request,
          payload: { ...rest, cwd: cwd ?? paths.projects },
        })
      },
      history: sessionMethod(base.sessions.history.bind(base.sessions)),
      models: sessionMethod(base.sessions.models.bind(base.sessions)),
      selectModel: sessionMethod(base.sessions.selectModel.bind(base.sessions)),
      rename: sessionMethod(base.sessions.rename.bind(base.sessions)),
      fork: sessionMethod(base.sessions.fork.bind(base.sessions)),
      prompt: sessionMethod(base.sessions.prompt.bind(base.sessions)),
      attachment: sessionMethod(base.sessions.attachment.bind(base.sessions)),
      updateQueue: sessionMethod(base.sessions.updateQueue.bind(base.sessions)),
      cancel: sessionMethod(base.sessions.cancel.bind(base.sessions)),
    },
    subagents: {
      list: parentMethod(base.subagents.list.bind(base.subagents)),
      async history(request, signal) {
        if (!await sessionAllowed(request.payload.parentSessionId)) {
          return sessionRejected(request, request.payload.parentSessionId)
        }
        if (!await sessionAllowed(request.payload.childSessionId)) {
          return sessionRejected(request, request.payload.childSessionId)
        }
        return base.subagents.history(request, signal)
      },
      async prompt(request, signal) {
        if (!await sessionAllowed(request.payload.parentSessionId)) {
          return sessionRejected(request, request.payload.parentSessionId)
        }
        if (!await sessionAllowed(request.payload.childSessionId)) {
          return sessionRejected(request, request.payload.childSessionId)
        }
        return base.subagents.prompt(request, signal)
      },
      async interrupt(request) {
        if (!await sessionAllowed(request.payload.parentSessionId)) {
          return sessionRejected(request, request.payload.parentSessionId)
        }
        if (!await sessionAllowed(request.payload.childSessionId)) {
          return sessionRejected(request, request.payload.childSessionId)
        }
        return base.subagents.interrupt(request)
      },
    },
    workspace: {
      async list(request) {
        const response = await base.workspace.list(request)
        if (!response.result.ok) return response
        const items = response.result.value.items.filter(filterWorkspace)
        const checks = await Promise.all(response.result.value.archivedSessionIds.map(sessionAllowed))
        return {
          ...response,
          result: {
            ok: true,
            value: {
              items,
              archivedSessionIds: response.result.value.archivedSessionIds.filter((_id, index) => checks[index]),
            },
          },
        }
      },
      async create(request) {
        if (!await canonicalPathWithin(paths.projects, request.payload.path)) return rejected(request)
        return base.workspace.create(request)
      },
      async rename(request) {
        return workspaceAllowed(String(request.payload.workspaceId))
          ? base.workspace.rename(request)
          : rejected(request)
      },
      async delete(request) {
        return workspaceAllowed(String(request.payload.workspaceId))
          ? base.workspace.delete(request)
          : rejected(request)
      },
      async insertBefore(request) {
        if (!workspaceAllowed(String(request.payload.workspaceId))) return rejected(request)
        if (request.payload.beforeWorkspaceId !== undefined
          && !workspaceAllowed(String(request.payload.beforeWorkspaceId))) return rejected(request)
        return base.workspace.insertBefore(request)
      },
      async insertSessionBefore(request) {
        if (!workspaceAllowed(String(request.payload.workspaceId))) return rejected(request)
        if (!await sessionAllowed(request.payload.sessionId)) {
          return sessionRejected(request, request.payload.sessionId)
        }
        if (request.payload.beforeSessionId !== undefined
          && !await sessionAllowed(request.payload.beforeSessionId)) {
          return sessionRejected(request, request.payload.beforeSessionId)
        }
        return base.workspace.insertSessionBefore(request)
      },
      async archiveSession(request) {
        return await sessionAllowed(request.payload.sessionId)
          ? base.workspace.archiveSession(request)
          : sessionRejected(request, request.payload.sessionId)
      },
    },
    host: {
      async describe(request) {
        const response = await base.host.describe(request)
        if (!response.result.ok) return response
        const live = await Promise.all(ctx.sessions.list().map(session => sessionAllowed(session.id)))
        return {
          ...response,
          result: {
            ok: true,
            value: {
              ...response.result.value,
              cwd: paths.projects,
              attachedSessions: live.filter(Boolean).length,
              canOpenPath: false,
            },
          },
        }
      },
      pickDirectory(request) {
        return Promise.resolve(rejected(request, '服务端模式不提供主机目录选择器'))
      },
      async listDirectory(request, signal) {
        const path = request.payload.path ?? paths.projects
        if (!await canonicalPathWithin(paths.projects, path)) return rejected(request)
        const response = await base.host.listDirectory({ ...request, payload: { path } }, signal)
        if (!response.result.ok) return response
        if (!pathWithin(paths.projects, response.result.value.path)) return rejected(request)
        return {
          ...response,
          result: {
            ok: true,
            value: {
              ...response.result.value,
              home: paths.projects,
              crumbs: response.result.value.crumbs.filter(entry => pathWithin(paths.projects, entry.path)),
              entries: response.result.value.entries.filter(entry => pathWithin(paths.projects, entry.path)),
            },
          },
        }
      },
      async createDirectory(request) {
        if (!await canonicalPathWithin(paths.projects, request.payload.path)) return rejected(request)
        const response = await base.host.createDirectory(request)
        if (!response.result.ok || pathWithin(paths.projects, response.result.value.path)) return response
        return rejected(request)
      },
      openPath(request) {
        return Promise.resolve(rejected(request, '服务端模式不允许打开服务器本地路径'))
      },
    },
    goals: {
      create: goalMethod(base.goals.create.bind(base.goals)),
      edit: goalMethod(base.goals.edit.bind(base.goals)),
      pause: goalMethod(base.goals.pause.bind(base.goals)),
      resume: goalMethod(base.goals.resume.bind(base.goals)),
      complete: goalMethod(base.goals.complete.bind(base.goals)),
      clear: goalMethod(base.goals.clear.bind(base.goals)),
    },
    skills: {
      list: sessionMethod(base.skills.list.bind(base.skills)),
    },
    agentPresets: {
      async list(request) {
        const response = await base.agentPresets.list(request)
        if (admin || !response.result.ok) return response
        return {
          ...response,
          result: {
            ok: true,
            value: {
              presets: response.result.value.presets.filter(preset => !ADMIN_ONLY_AGENT_PRESETS.has(preset.id)),
              authorable: false,
              hasDocument: false,
            },
          },
        }
      },
      async select(request) {
        if (!admin && ADMIN_ONLY_AGENT_PRESETS.has(request.payload.agentPreset)) {
          return rejected(request, '仅管理员可使用动态 Cordis 插件模式')
        }
        return sessionMethod(base.agentPresets.select.bind(base.agentPresets))(request)
      },
      read: admin ? base.agentPresets.read.bind(base.agentPresets) : denyConfiguration,
      copy: admin ? base.agentPresets.copy.bind(base.agentPresets) : denyConfiguration,
      openDocument: admin ? base.agentPresets.openDocument.bind(base.agentPresets) : denyConfiguration,
      remove: admin ? base.agentPresets.remove.bind(base.agentPresets) : denyConfiguration,
    },
    settings: admin
      ? base.settings
      : {
        describe: denyConfiguration,
        openDocument: denyConfiguration,
        update: denyConfiguration,
        replace: denyConfiguration,
        mutate: denyConfiguration,
      },
    credentials: admin
      ? base.credentials
      : {
        describe: denyConfiguration,
        set: denyConfiguration,
        unset: denyConfiguration,
      },
    llm: {
      async providers(request) {
        const response = await base.llm.providers(request)
        if (!response.result.ok) return response
        if (!auth.sharedDeepSeekPreference(principal.user.id).enabled) return response
        const credentials = ctx.get('credentials')
        if (credentials === undefined) return response
        const managedCredential = await credentials.describe(SHARED_DEEPSEEK_CREDENTIAL_REF)
        if (!managedCredential.configured) return response
        return {
          ...response,
          result: {
            ok: true,
            value: {
              providers: response.result.value.providers.map(provider =>
                provider.provider === SHARED_DEEPSEEK_PROVIDER && provider.active
                  ? { ...provider, managedModels: [SHARED_DEEPSEEK_MODEL] }
                  : provider),
            },
          },
        }
      },
      models: base.llm.models.bind(base.llm),
      discoverModels: admin ? base.llm.discoverModels.bind(base.llm) : denyConfiguration,
    },
    events: {
      mux(request, signal) {
        return filterMux(base.events.mux(request, signal))
      },
      host(request, signal) {
        return filterHost(base.events.host(request, signal))
      },
    },
    downloads: {
      async sessionLog(request, signal) {
        if (!await sessionAllowed(request.sessionId)) return new Response('session not found', { status: 404 })
        return base.downloads.sessionLog(request, signal)
      },
    },
    respond(message: ClientResponse): Promise<RpcReceipt> {
      const id = String(message.rpcId)
      if (!answerableRpcIds.delete(id)) {
        return Promise.resolve({ accepted: false, reason: 'not-pending' })
      }
      return base.respond(message)
    },
  }
}
