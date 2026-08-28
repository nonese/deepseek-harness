/** Per-user authorization and projection for the shared Typert Gateway. */

import type { Context } from '@deepseek-ai/cordis'
import { managedPathContains, type AuthPrincipal } from '@deepseek-ai/dsh-auth'
import type {
  InvokeRemoteRequest,
  TypertGatewayMiddleware,
} from '@deepseek-ai/dsh-api-gateway'
import type {
  SessionControlFrame,
  SessionListValue,
  SessionSearchValue,
} from '@deepseek-ai/dsh-api-session-controller/types'
import { ApiSessionNotFound } from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type { WorkspaceFollowFrame, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/types'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import {
  PROVIDER as DEEPSEEK_PROVIDER,
  SHARED_DEEPSEEK_API_KEY_ENV,
  SHARED_DEEPSEEK_MODEL,
} from '@deepseek-ai/dsh-llm-deepseek'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { TypertRemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'

const ADMIN_NAMESPACES = new Set([
  'cordisInspect',
  'credentials',
  'dynamicCordisRunner',
  'settings',
])

const ADMIN_UNSCOPED_ENDPOINTS = new Set([
  'agentPresets/copy',
  'agentPresets/deletePreset',
])

const SAFE_UNSCOPED_ENDPOINTS = new Set([
  '$events/follow',
  'agentPresets/list',
  'agentPresets/read',
  'llm/discoverModels',
  'llm/listConfigurableProviders',
  'llm/listProviders',
  'pluginInventory/list',
  'session/canOpenWorkspacePath',
  'session/control',
  'session/create',
  'session/list',
  'session/modelCatalog',
  'session/search',
  'workspace/create',
  'workspace/follow',
])

const SESSION_ID_FIELDS = new Set([
  'agentId',
  'childSessionId',
  'parentSessionId',
  'rootSessionId',
  'sessionId',
])

const WORKSPACE_ID_FIELDS = new Set([
  'beforeWorkspaceId',
  'workspaceId',
])

interface RemoteEventReady {
  readonly type: 'ready'
  readonly host: { readonly home: string }
  readonly [key: string]: unknown
}

interface RemoteEventEmit {
  readonly type: 'emit'
  readonly event: string
  readonly args: readonly unknown[]
}

interface RemoteEventWaterfall {
  readonly type: 'waterfall'
  readonly agentId: string
}

function endpointOf(request: InvokeRemoteRequest): string {
  return `${request.namespace}/${request.method}`
}

function forbidden(message: string): never {
  throw new TypertRemoteFailure({ code: 'forbidden', message, details: {} })
}

function hidden(): never {
  throw new TypertRemoteFailure({
    code: 'not-found',
    message: 'requested resource was not found',
    details: {},
  })
}

function namedStrings(value: unknown, names: ReadonlySet<string>, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) namedStrings(item, names, found)
    return found
  }
  if (typeof value !== 'object' || value === null) return found
  for (const [key, item] of Object.entries(value)) {
    if (names.has(key) && typeof item === 'string' && item.length > 0) found.add(item)
    else namedStrings(item, names, found)
  }
  return found
}

function workspaceOwned(ctx: Context, principal: AuthPrincipal, id: string): boolean {
  const workspace = ctx.workspaceRegistry.get(id as WorkspaceId)
  return workspace !== undefined
    && managedPathContains(ctx.auth.userPaths(principal.user.id).projects, workspace.path)
}

function workspaceViewOwned(ctx: Context, principal: AuthPrincipal, workspace: WorkspaceView): boolean {
  return managedPathContains(ctx.auth.userPaths(principal.user.id).projects, workspace.path)
}

type SessionOwnership = 'owned' | 'foreign' | 'missing'

async function sessionOwnership(
  ctx: Context,
  principal: AuthPrincipal,
  id: string,
): Promise<SessionOwnership> {
  const live = ctx.sessions.get(id as SessionId)
  if (live !== undefined) {
    const cwd = live.header.cwd
    return cwd !== undefined && managedPathContains(ctx.auth.userPaths(principal.user.id).projects, cwd)
      ? 'owned'
      : 'foreign'
  }
  try {
    const inspected = await ctx.sessionController.inspect(id as SessionId)
    const cwd = inspected.meta.cwd
    return cwd !== undefined
      && managedPathContains(ctx.auth.userPaths(principal.user.id).projects, cwd)
      ? 'owned'
      : 'foreign'
  } catch (error) {
    if (error instanceof ApiSessionNotFound) return 'missing'
    throw error
  }
}

async function sessionOwned(ctx: Context, principal: AuthPrincipal, id: string): Promise<boolean> {
  return await sessionOwnership(ctx, principal, id) === 'owned'
}

async function requireRequestOwnership(
  ctx: Context,
  principal: AuthPrincipal,
  request: InvokeRemoteRequest,
): Promise<void> {
  const endpoint = endpointOf(request)
  if (endpoint === 'directoryPicker/pick'
    || endpoint === 'directoryPicker/list'
    || endpoint === 'directoryPicker/createDirectory'
    || endpoint === 'session/openWorkspacePath') {
    forbidden('server deployments do not expose host filesystem pickers or native path opening')
  }

  if (ADMIN_NAMESPACES.has(request.namespace) && principal.user.role !== 'admin') {
    forbidden('administrator role is required')
  }

  if (ADMIN_UNSCOPED_ENDPOINTS.has(endpoint) && principal.user.role !== 'admin') {
    forbidden('administrator role is required')
  }

  if (endpoint === 'workspace/create') {
    const path = nestedString(request.args, 'request', 'path')
    if (path === undefined || !managedPathContains(ctx.auth.userPaths(principal.user.id).projects, path)) hidden()
  }

  if (endpoint === 'session/create') {
    const body = nestedObject(request.args, 'request')
    const cwd = typeof body?.cwd === 'string' ? body.cwd : undefined
    const workspaceId = typeof body?.workspaceId === 'string' ? body.workspaceId : undefined
    if (cwd === undefined && workspaceId === undefined) {
      forbidden('a managed project is required when creating a session')
    }
    if (cwd !== undefined && !managedPathContains(ctx.auth.userPaths(principal.user.id).projects, cwd)) hidden()
    if (workspaceId !== undefined && !workspaceOwned(ctx, principal, workspaceId)) hidden()
    const requestedId = typeof body?.sessionId === 'string' ? body.sessionId : undefined
    if (requestedId !== undefined) {
      const ownership = await sessionOwnership(ctx, principal, requestedId)
      if (ownership === 'foreign') hidden()
    }
  }

  const sessionIds = namedStrings(request.args, SESSION_ID_FIELDS)
  if (endpoint === 'session/create') {
    const requested = nestedString(request.args, 'request', 'sessionId')
    if (requested !== undefined) sessionIds.delete(requested)
  }
  for (const id of sessionIds) {
    if (!await sessionOwned(ctx, principal, id)) hidden()
  }

  for (const id of namedStrings(request.args, WORKSPACE_ID_FIELDS)) {
    if (!workspaceOwned(ctx, principal, id)) hidden()
  }

  if (sessionIds.size === 0
    && namedStrings(request.args, WORKSPACE_ID_FIELDS).size === 0
    && !SAFE_UNSCOPED_ENDPOINTS.has(endpoint)
    && !ADMIN_UNSCOPED_ENDPOINTS.has(endpoint)
    && !ADMIN_NAMESPACES.has(request.namespace)) {
    forbidden(`Remote endpoint ${endpoint} is not available without a user-owned session`)
  }
}

function nestedObject(value: Readonly<Record<string, unknown>>, key: string): Record<string, unknown> | undefined {
  const nested = value[key]
  return typeof nested === 'object' && nested !== null && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : undefined
}

function nestedString(
  value: Readonly<Record<string, unknown>>,
  objectKey: string,
  field: string,
): string | undefined {
  const nested = nestedObject(value, objectKey)
  return typeof nested?.[field] === 'string' ? nested[field] : undefined
}

async function projectUnary(
  ctx: Context,
  principal: AuthPrincipal,
  request: InvokeRemoteRequest,
  value: unknown,
): Promise<unknown> {
  const endpoint = endpointOf(request)
  if (endpoint === 'session/list') {
    const result = value as SessionListValue
    return {
      ...result,
      items: result.items.filter(item => item.cwd !== undefined
        && managedPathContains(ctx.auth.userPaths(principal.user.id).projects, item.cwd)),
    }
  }
  if (endpoint === 'session/search') {
    const result = value as SessionSearchValue
    const owned = await Promise.all(result.items.map(item => sessionOwned(ctx, principal, item.sessionId)))
    return { ...result, items: result.items.filter((_item, index) => owned[index]) }
  }
  if (endpoint === 'llm/listConfigurableProviders' && Array.isArray(value)) {
    const credential = await ctx.credentials.describe(credentialRef(SHARED_DEEPSEEK_API_KEY_ENV))
    const managed = credential.configured
      && ctx.auth.sharedDeepSeekPreference(principal.user.id).enabled
    return value.map((entry: unknown) => {
      if (!managed || typeof entry !== 'object' || entry === null
        || Reflect.get(entry, 'provider') !== DEEPSEEK_PROVIDER) return entry
      return { ...entry, managedModels: [SHARED_DEEPSEEK_MODEL] }
    })
  }
  if (endpoint === 'agentPresets/list'
    && principal.user.role !== 'admin'
    && typeof value === 'object'
    && value !== null) {
    return { ...value, authorable: false }
  }
  return value
}

async function *projectWorkspaceStream(
  ctx: Context,
  principal: AuthPrincipal,
  source: AsyncIterable<unknown>,
): AsyncGenerator {
  const visible = new Set<string>()
  for await (const raw of source) {
    const frame = raw as WorkspaceFollowFrame
    if (frame.type === 'baseline') {
      const items = frame.value.items.filter(item => workspaceViewOwned(ctx, principal, item))
      for (const item of items) visible.add(item.workspaceId)
      const archived = await filterOwnedSessionIds(ctx, principal, frame.value.archivedSessionIds)
      yield { ...frame, value: { items, archivedSessionIds: archived } }
    } else if (frame.type === 'upsert') {
      if (!workspaceViewOwned(ctx, principal, frame.workspace)) continue
      visible.add(frame.workspace.workspaceId)
      yield frame
    } else if (frame.type === 'remove') {
      if (!visible.delete(frame.workspaceId)) continue
      yield frame
    } else if (frame.type === 'order') {
      yield { ...frame, workspaceIds: frame.workspaceIds.filter(id => visible.has(id)) }
    } else {
      yield { ...frame, archivedSessionIds: await filterOwnedSessionIds(ctx, principal, frame.archivedSessionIds) }
    }
  }
}

async function filterOwnedSessionIds(
  ctx: Context,
  principal: AuthPrincipal,
  ids: readonly SessionId[],
): Promise<SessionId[]> {
  const owned = await Promise.all(ids.map(id => sessionOwned(ctx, principal, id)))
  return ids.filter((_id, index) => owned[index])
}

async function *projectControlStream(
  ctx: Context,
  principal: AuthPrincipal,
  source: AsyncIterable<unknown>,
): AsyncGenerator {
  for await (const raw of source) {
    const frame = raw as SessionControlFrame
    if (frame.type === 'baseline') {
      const ids = new Set(await filterOwnedSessionIds(
        ctx,
        principal,
        Object.keys(frame.value.queues) as SessionId[],
      ))
      yield {
        ...frame,
        value: {
          queues: Object.fromEntries(Object.entries(frame.value.queues).filter(([id]) => ids.has(id as SessionId))),
          jobs: Object.fromEntries(Object.entries(frame.value.jobs).filter(([id]) => ids.has(id as SessionId))),
          projections: Object.fromEntries(Object.entries(frame.value.projections).filter(([id]) => ids.has(id as SessionId))),
        },
      }
    } else if (await sessionOwned(ctx, principal, frame.sessionId)) {
      yield frame
    }
  }
}

async function *projectEventStream(
  ctx: Context,
  principal: AuthPrincipal,
  source: AsyncIterable<unknown>,
): AsyncGenerator {
  for await (const raw of source) {
    if (typeof raw !== 'object' || raw === null) continue
    const type = (raw as Readonly<Record<string, unknown>>).type
    if (type === 'ready') {
      const ready = raw as RemoteEventReady
      yield { ...ready, host: { ...ready.host, home: ctx.auth.userPaths(principal.user.id).root } }
      continue
    }
    if (type === 'waterfall') {
      const waterfall = raw as RemoteEventWaterfall
      if (await sessionOwned(ctx, principal, waterfall.agentId)) yield raw
      continue
    }
    if (type === 'cancel') {
      yield raw
      continue
    }
    if (type !== 'emit') continue
    const event = raw as RemoteEventEmit
    if (event.event === 'llm/adapters-updated') {
      yield raw
      continue
    }
    if (event.event === 'credentials/reference-updated'
      || event.event === 'settings/document-updated'
      || event.event.startsWith('cordis/')) {
      if (principal.user.role === 'admin') yield raw
      continue
    }
    if (event.event === 'api-session/added') {
      const summary = event.args[0]
      const cwd = typeof summary === 'object' && summary !== null
        ? (summary as Readonly<Record<string, unknown>>).cwd
        : undefined
      if (typeof cwd === 'string' && managedPathContains(ctx.auth.userPaths(principal.user.id).projects, cwd)) yield raw
      continue
    }
    const candidate = event.args.find(arg => typeof arg === 'string')
    if (typeof candidate === 'string' && await sessionOwned(ctx, principal, candidate)) yield raw
  }
}

function projectStream(
  ctx: Context,
  principal: AuthPrincipal,
  request: InvokeRemoteRequest,
  source: AsyncIterable<unknown>,
): AsyncIterable<unknown> {
  const endpoint = endpointOf(request)
  if (endpoint === 'workspace/follow') return projectWorkspaceStream(ctx, principal, source)
  if (endpoint === 'session/control') return projectControlStream(ctx, principal, source)
  if (endpoint === '$events/follow') return projectEventStream(ctx, principal, source)
  return source
}

/**
 * Build the single-process Gateway policy for the current authentication service.
 * @param ctx - Host context providing authentication and owned resource registries.
 * @returns ordered authorization and projection middleware for unary and stream calls.
 */
export function userScopedRemotePolicy(ctx: Context): TypertGatewayMiddleware {
  return {
    invoke: async (request, next) => {
      const principal = ctx.auth.currentPrincipal()
      if (principal === undefined) return next()
      await requireRequestOwnership(ctx, principal, request)
      return projectUnary(ctx, principal, request, await next())
    },
    stream: async (request, next) => {
      const principal = ctx.auth.currentPrincipal()
      if (principal === undefined) return next()
      await requireRequestOwnership(ctx, principal, request)
      return projectStream(ctx, principal, request, await next())
    },
  }
}
