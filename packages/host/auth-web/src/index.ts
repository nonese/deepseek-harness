/**
 * Same-origin browser authentication routes for Harness server deployments.
 * @module @deepseek-ai/dsh-host-auth-web
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdir } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  AuthError,
  managedPathContains,
  type AuthPrincipal,
  type AuthUser,
  type OidcClientAuthMethod,
  type OidcClientConfig,
  type UserId,
} from '@deepseek-ai/dsh-auth'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {
  ConnectionTrustRequest,
} from '@deepseek-ai/dsh-client-connection'
import { normalizeApiKey } from '@deepseek-ai/dsh-llm'
import {
  PROVIDER as DEEPSEEK_PROVIDER,
  SHARED_DEEPSEEK_API_KEY_ENV,
  SHARED_DEEPSEEK_MODEL,
} from '@deepseek-ai/dsh-llm-deepseek'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-session'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-workspace'
import * as oidc from 'openid-client'
import { userScopedRemotePolicy } from './remote-policy.ts'

/** Stable Cordis plugin name. */
export const name = 'host-auth-web'

/** Required services for authentication and project provisioning. */
export const inject = [
  'auth',
  'connection',
  'credentials',
  'sessionController',
  'sessions',
  'typertGateway',
  'webServer',
  'workspaceRegistry',
]

/** Browser authentication route configuration. */
export interface Config {
  /** Cookie name. Defaults to `harness_session`. */
  cookieName?: string
  /** Add the Secure cookie attribute. Enable when the public origin is HTTPS. */
  secureCookie?: boolean
  /** Maximum JSON request body. Defaults to 64 KiB. */
  maxBodyBytes?: number
}

const DEFAULT_COOKIE_NAME = 'harness_session'
const DEFAULT_MAX_BODY_BYTES = 64 * 1024
const OIDC_CLIENT_SECRET_ENV = 'HARNESS_OIDC_CLIENT_SECRET'
const OIDC_FLOW_TTL_MS = 10 * 60 * 1000
const MAX_PENDING_OIDC_FLOWS = 256
const DYNAMIC_CORDIS_TOOL_PREFIX = 'cordis_'
const DYNAMIC_CORDIS_ADMIN_MESSAGE = '仅管理员可使用动态 Cordis 插件'

export const Config: z<Config> = z.object({
  cookieName: z.string().default(DEFAULT_COOKIE_NAME),
  secureCookie: z.boolean().default(false),
  maxBodyBytes: z.natural().min(1024).max(1024 * 1024).default(DEFAULT_MAX_BODY_BYTES),
})

interface JsonObject {
  [key: string]: unknown
}

interface PendingOidcFlow {
  expiresAt: number
  codeVerifier: string
  nonce: string
  settings: OidcClientConfig
  fingerprint: string
  client: oidc.Configuration
}

function sendJson(res: ServerResponse, status: number, value: unknown, headers?: Record<string, string>): void {
  const body = `${JSON.stringify(value)}\n`
  res.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    ...headers,
  })
  res.end(body)
}

function sendRedirect(res: ServerResponse, location: string, cookies: readonly string[] = []): void {
  res.writeHead(302, {
    'cache-control': 'no-store',
    location,
    'content-length': '0',
    ...cookies.length === 0 ? {} : { 'set-cookie': [...cookies] },
  })
  res.end()
}

function authErrorStatus(error: AuthError): number {
  if (error.code === 'INVALID_CREDENTIALS') return 401
  if (error.code === 'USER_DISABLED') return 403
  if (error.code === 'FORBIDDEN') return 403
  if (error.code === 'USER_NOT_FOUND') return 404
  if (error.code === 'USERNAME_CONFLICT') return 409
  if (error.code === 'LAST_ADMIN') return 409
  return 400
}

function sendFailure(res: ServerResponse, error: unknown): void {
  if (error instanceof AuthError) {
    sendJson(res, authErrorStatus(error), { error: { code: error.code, message: error.message } })
    return
  }
  sendJson(res, 400, {
    error: { code: 'BAD_REQUEST', message: error instanceof Error ? error.message : String(error) },
  })
}

function cookieValue(req: IncomingMessage, name: string): string | undefined {
  const header = req.headers.cookie
  if (header === undefined) return undefined
  for (const part of header.split(';')) {
    const at = part.indexOf('=')
    if (at === -1) continue
    if (part.slice(0, at).trim() !== name) continue
    try {
      return decodeURIComponent(part.slice(at + 1).trim())
    } catch {
      return undefined
    }
  }
  return undefined
}

function requestCookieValue(request: ConnectionTrustRequest, name: string): string | undefined {
  const headers = request.headers
  const header = headers instanceof Headers
    ? headers.get('cookie') ?? undefined
    : headers.cookie
  const value = typeof header === 'string' ? header : header?.join(';')
  if (value === undefined) return undefined
  for (const part of value.split(';')) {
    const at = part.indexOf('=')
    if (at === -1 || part.slice(0, at).trim() !== name) continue
    try {
      return decodeURIComponent(part.slice(at + 1).trim())
    } catch {
      return undefined
    }
  }
  return undefined
}

function sessionCookie(name: string, token: string, expiresAt: string, secure: boolean): string {
  return `${name}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(expiresAt).toUTCString()}${secure ? '; Secure' : ''}`
}

function expiredCookie(name: string, secure: boolean, path = '/'): string {
  return `${name}=; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`
}

function oidcFlowCookie(name: string, state: string, secure: boolean): string {
  return `${name}=${encodeURIComponent(state)}; Path=/auth/oidc; HttpOnly; SameSite=Lax; Max-Age=${String(OIDC_FLOW_TTL_MS / 1000)}${secure ? '; Secure' : ''}`
}

function requestOriginAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (origin === undefined) return true
  const host = req.headers.host
  if (host === undefined) return false
  try {
    const parsed = new URL(origin)
    return parsed.host === host && (parsed.protocol === 'http:' || parsed.protocol === 'https:')
  } catch {
    return false
  }
}

async function readJson(req: IncomingMessage, limit: number): Promise<JsonObject> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req as AsyncIterable<Uint8Array>) {
    const buffer = Buffer.from(chunk)
    size += buffer.length
    if (size > limit) throw new AuthError('INVALID_INPUT', '请求内容过大')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AuthError('INVALID_INPUT', '请求内容必须是 JSON 对象')
  }
  return value as JsonObject
}

function stringField(body: JsonObject, key: string, required = true): string | undefined {
  const value = body[key]
  if (value === undefined && !required) return undefined
  if (typeof value !== 'string') throw new AuthError('INVALID_INPUT', `${key} 必须是字符串`)
  return value
}

function booleanField(body: JsonObject, key: string): boolean {
  const value = body[key]
  if (typeof value !== 'boolean') throw new AuthError('INVALID_INPUT', `${key} 必须是布尔值`)
  return value
}

function stringArrayField(body: JsonObject, key: string): string[] {
  const value = body[key]
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new AuthError('INVALID_INPUT', `${key} 必须是字符串数组`)
  }
  return value as string[]
}

function normalizeOidcUrl(value: string, field: string, allowInsecure: boolean): URL {
  let parsed: URL
  try {
    parsed = new URL(value.trim())
  } catch {
    throw new AuthError('INVALID_INPUT', `${field} 必须是完整 URL`)
  }
  if (parsed.username.length > 0 || parsed.password.length > 0 || parsed.search.length > 0 || parsed.hash.length > 0) {
    throw new AuthError('INVALID_INPUT', `${field} 不能包含凭据、查询参数或片段`)
  }
  if (parsed.protocol !== 'https:' && (!allowInsecure || parsed.protocol !== 'http:')) {
    throw new AuthError('INVALID_INPUT', `${field} 必须使用 HTTPS；纯内网 HTTP 需显式启用允许选项`)
  }
  return parsed
}

function oidcConfigFrom(body: JsonObject): OidcClientConfig {
  const allowInsecureIssuer = booleanField(body, 'allowInsecureIssuer')
  const issuerUrl = normalizeOidcUrl(stringField(body, 'issuer') as string, 'issuer', allowInsecureIssuer)
  issuerUrl.pathname = issuerUrl.pathname.replace(/\/+$/, '') || '/'
  const redirectUrl = normalizeOidcUrl(
    stringField(body, 'redirectUri') as string,
    'redirectUri',
    allowInsecureIssuer,
  )
  if (redirectUrl.pathname !== '/auth/oidc/callback') {
    throw new AuthError('INVALID_INPUT', 'redirectUri 路径必须是 /auth/oidc/callback')
  }
  const clientId = (stringField(body, 'clientId') as string).trim()
  if (clientId.length === 0 || clientId.length > 256) {
    throw new AuthError('INVALID_INPUT', 'clientId 长度必须为 1–256 个字符')
  }
  const scopes = [...new Set(stringArrayField(body, 'scopes').map(scope => scope.trim()))]
  if (scopes.length === 0 || scopes.length > 16
    || scopes.some(scope => scope.length === 0 || scope.length > 128 || /\s/u.test(scope))) {
    throw new AuthError('INVALID_INPUT', 'scopes 必须包含 1–16 个不含空白的有效值')
  }
  if (!scopes.includes('openid')) throw new AuthError('INVALID_INPUT', 'scopes 必须包含 openid')
  const clientAuthMethod = stringField(body, 'clientAuthMethod')
  if (clientAuthMethod !== 'client_secret_basic'
    && clientAuthMethod !== 'client_secret_post'
    && clientAuthMethod !== 'none') {
    throw new AuthError('INVALID_INPUT', 'clientAuthMethod 不受支持')
  }
  const administratorGroup = (stringField(body, 'administratorGroup') as string).trim()
  if (administratorGroup.length > 128 || /\s/u.test(administratorGroup)) {
    throw new AuthError('INVALID_INPUT', 'administratorGroup 不能包含空白且最多 128 个字符')
  }
  return {
    enabled: booleanField(body, 'enabled'),
    issuer: issuerUrl.href.replace(/\/$/, ''),
    clientId,
    redirectUri: redirectUrl.href,
    scopes,
    clientAuthMethod,
    allowInsecureIssuer,
    administratorGroup,
  }
}

function oidcClientAuthentication(method: OidcClientAuthMethod, secret: string | undefined): oidc.ClientAuth {
  if (method === 'client_secret_basic') return oidc.ClientSecretBasic(secret)
  if (method === 'client_secret_post') return oidc.ClientSecretPost(secret)
  return oidc.None()
}

function oidcFingerprint(settings: OidcClientConfig, secret: string | undefined): string {
  return createHash('sha256')
    .update(JSON.stringify(settings))
    .update('\0')
    .update(secret ?? '')
    .digest('base64url')
}

async function oidcStatus(ctx: Context) {
  const settings = ctx.auth.oidcClientConfig()
  const secret = await ctx.credentials.describe(credentialRef(OIDC_CLIENT_SECRET_ENV))
  const secretRequired = settings?.clientAuthMethod !== 'none'
  return {
    configured: settings !== undefined && settings.enabled && (!secretRequired || secret.configured),
    enabled: settings?.enabled ?? false,
    clientSecretConfigured: secret.configured,
    clientSecretWritable: secret.writable,
    settings,
  }
}

async function resolveOidcInputs(ctx: Context, requireEnabled: boolean): Promise<{
  settings: OidcClientConfig
  secret?: string
  fingerprint: string
}> {
  const settings = ctx.auth.oidcClientConfig()
  if (settings === undefined || (requireEnabled && !settings.enabled)) {
    throw new AuthError('INVALID_INPUT', settings === undefined ? 'OIDC 尚未配置' : 'OIDC 尚未启用')
  }
  const resolved = await ctx.credentials.resolve(credentialRef(OIDC_CLIENT_SECRET_ENV))
  const secret = resolved?.value
  if (settings.clientAuthMethod !== 'none' && secret === undefined) {
    throw new AuthError('INVALID_INPUT', 'OIDC 客户端密钥尚未配置')
  }
  return {
    settings,
    ...secret === undefined ? {} : { secret },
    fingerprint: oidcFingerprint(settings, secret),
  }
}

async function discoverOidcClient(ctx: Context, requireEnabled: boolean): Promise<{
  settings: OidcClientConfig
  secret?: string
  fingerprint: string
  client: oidc.Configuration
}> {
  const inputs = await resolveOidcInputs(ctx, requireEnabled)
  const metadata: Partial<oidc.ClientMetadata> = {
    token_endpoint_auth_method: inputs.settings.clientAuthMethod,
    ...inputs.secret === undefined ? {} : { client_secret: inputs.secret },
  }
  // oxlint-disable-next-line typescript/no-deprecated -- explicitly enabled only for administrator-approved intranet HTTP issuers
  const allowInsecureRequests = oidc.allowInsecureRequests
  const client = await oidc.discovery(
    new URL(inputs.settings.issuer),
    inputs.settings.clientId,
    metadata,
    oidcClientAuthentication(inputs.settings.clientAuthMethod, inputs.secret),
    inputs.settings.allowInsecureIssuer ? { execute: [allowInsecureRequests] } : undefined,
  )
  return { ...inputs, client }
}

async function principalFor(ctx: Context, req: IncomingMessage, cookieName: string): Promise<AuthPrincipal | undefined> {
  const token = cookieValue(req, cookieName)
  return token === undefined ? undefined : ctx.auth.authenticateToken(token)
}

function publicSession(principal: AuthPrincipal): { user: AuthUser; expiresAt: string; method: string } {
  return { user: principal.user, expiresAt: principal.expiresAt, method: principal.method }
}

function requireAdmin(principal: AuthPrincipal): void {
  if (principal.user.role !== 'admin') throw new AuthError('FORBIDDEN', '仅管理员可执行此操作')
}

function agentAdministrator(ctx: Context, exec: Readonly<ToolExecution>): boolean {
  const agent = exec.agent
  if (agent === undefined) return false
  const cwd = agent.session.header.cwd
  return cwd !== undefined && ctx.auth.ownerForProjectPath(cwd)?.role === 'admin'
}

function dynamicCordisTool(name: string): boolean {
  return name.startsWith(DYNAMIC_CORDIS_TOOL_PREFIX)
}

function dynamicCordisGuard(ctx: Context, exec: Readonly<ToolExecution>): string | undefined {
  if (!dynamicCordisTool(exec.name)) return undefined
  return agentAdministrator(ctx, exec)
    ? undefined
    : DYNAMIC_CORDIS_ADMIN_MESSAGE
}

async function sharedDeepSeekStatus(ctx: Context, userId?: UserId) {
  const credential = await ctx.credentials.describe(credentialRef(SHARED_DEEPSEEK_API_KEY_ENV))
  return {
    provider: DEEPSEEK_PROVIDER,
    model: SHARED_DEEPSEEK_MODEL,
    name: 'DeepSeek-V4-Flash',
    configured: credential.configured,
    writable: credential.writable,
    ...userId === undefined ? {} : { enabled: ctx.auth.sharedDeepSeekPreference(userId).enabled },
  }
}

function projectView(ctx: Context, principal: AuthPrincipal) {
  const paths = ctx.auth.userPaths(principal.user.id)
  const sessionByWorkspace = new Map<string, { count: number; updatedAt?: number }>()
  for (const session of ctx.sessions.list()) {
    const cwd = session.header.cwd
    if (cwd === undefined || !managedPathContains(paths.projects, cwd)) continue
    const current = sessionByWorkspace.get(cwd) ?? { count: 0 }
    current.count += 1
    current.updatedAt = Math.max(current.updatedAt ?? 0, session.header.createdAt)
    sessionByWorkspace.set(cwd, current)
  }
  return ctx.workspaceRegistry.list()
    .filter(workspace => managedPathContains(paths.projects, workspace.path))
    .map(workspace => ({
      id: workspace.id,
      name: workspace.title,
      path: workspace.path,
      sessionCount: sessionByWorkspace.get(workspace.path)?.count ?? workspace.sessionIds.length,
      createdAt: Date.parse(workspace.createdAt),
      updatedAt: sessionByWorkspace.get(workspace.path)?.updatedAt ?? Date.parse(workspace.updatedAt),
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

/** Register login, session, administration, and managed-project routes. */
export function apply(ctx: Context, config: Config = {}): void {
  const cookieName = config.cookieName ?? DEFAULT_COOKIE_NAME
  const oidcCookieName = `${cookieName}_oidc`
  const secure = config.secureCookie ?? false
  const maxBodyBytes = config.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
  const pendingOidcFlows = new Map<string, PendingOidcFlow>()

  ctx.connection.registerAuthenticator({
    authenticate: async (request) => {
      const token = requestCookieValue(request, cookieName)
      if (token === undefined) return undefined
      const principal = await ctx.auth.authenticateToken(token)
      return principal === undefined
        ? undefined
        : { run: operation => ctx.auth.withPrincipal(principal, operation) }
    },
    authorizeIndex: () => Promise.resolve(true),
    authenticatedUrl: baseUrl => baseUrl,
  })
  ctx.typertGateway.registerMiddleware(userScopedRemotePolicy(ctx))
  ctx.on('webserver/index-inject', (table: IndexInjection[]) => {
    table.push({ kind: 'global', name: '__HARNESS_MULTI_USER__', value: true })
  })

  const pruneOidcFlows = (): void => {
    const now = Date.now()
    for (const [state, flow] of pendingOidcFlows) {
      if (flow.expiresAt <= now) pendingOidcFlows.delete(state)
    }
  }

  const oidcFailureLocation = (settings: OidcClientConfig | undefined, code: string): string => {
    const target = settings === undefined ? new URL('http://harness.invalid/') : new URL('/', settings.redirectUri)
    target.searchParams.set('oidc_error', code)
    return settings === undefined ? `${target.pathname}${target.search}` : target.href
  }

  ctx.inject(['tools'], (policyCtx) => {
    policyCtx.tools.guard(exec => dynamicCordisGuard(policyCtx, exec))
  })

  const route: WebRoute = {
    kind: 'prefix',
    path: '/auth',
    handler: async (req, res) => {
      const pathname = new URL(req.url ?? '/', 'http://x').pathname
      if (req.method !== 'GET' && !requestOriginAllowed(req)) {
        sendJson(res, 403, { error: { code: 'ORIGIN_REJECTED', message: '请求来源不受信任' } })
        return
      }
      try {
        if (pathname === '/auth/session' && req.method === 'GET') {
          const principal = await principalFor(ctx, req, cookieName)
          const oidcState = await oidcStatus(ctx)
          sendJson(res, 200, {
            authenticated: principal !== undefined,
            ...principal === undefined ? {} : publicSession(principal),
            oidc: { configured: oidcState.configured },
            local: { enabled: true },
          })
          return
        }

        if (pathname === '/auth/login/local' && req.method === 'POST') {
          const body = await readJson(req, maxBodyBytes)
          const issued = await ctx.auth.loginLocal(
            stringField(body, 'username') as string,
            stringField(body, 'password') as string,
          )
          sendJson(res, 200, publicSession(issued.principal), {
            'set-cookie': sessionCookie(cookieName, issued.token, issued.principal.expiresAt, secure),
          })
          return
        }

        if (pathname === '/auth/logout' && req.method === 'POST') {
          const token = cookieValue(req, cookieName)
          if (token !== undefined) await ctx.auth.logout(token)
          sendJson(res, 200, { ok: true }, { 'set-cookie': expiredCookie(cookieName, secure) })
          return
        }

        if ((pathname === '/auth/oidc' || pathname === '/auth/oidc/start') && req.method === 'GET') {
          const settings = ctx.auth.oidcClientConfig()
          try {
            pruneOidcFlows()
            if (pendingOidcFlows.size >= MAX_PENDING_OIDC_FLOWS) {
              sendRedirect(res, oidcFailureLocation(settings, 'busy'))
              return
            }
            const runtime = await discoverOidcClient(ctx, true)
            const state = oidc.randomState()
            const nonce = oidc.randomNonce()
            const codeVerifier = oidc.randomPKCECodeVerifier()
            const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier)
            pendingOidcFlows.set(state, {
              expiresAt: Date.now() + OIDC_FLOW_TTL_MS,
              codeVerifier,
              nonce,
              settings: runtime.settings,
              fingerprint: runtime.fingerprint,
              client: runtime.client,
            })
            const authorizationUrl = oidc.buildAuthorizationUrl(runtime.client, {
              redirect_uri: runtime.settings.redirectUri,
              scope: runtime.settings.scopes.join(' '),
              response_type: 'code',
              state,
              nonce,
              code_challenge: codeChallenge,
              code_challenge_method: 'S256',
            })
            sendRedirect(res, authorizationUrl.href, [oidcFlowCookie(oidcCookieName, state, secure)])
          } catch (error) {
            ctx.logger.warn('OIDC authorization start failed')
            ctx.logger.warn(error)
            sendRedirect(res, oidcFailureLocation(settings, 'unavailable'))
          }
          return
        }

        if (pathname === '/auth/oidc/callback' && req.method === 'GET') {
          const requestUrl = new URL(req.url ?? '/', 'http://harness.invalid')
          const state = requestUrl.searchParams.get('state')
          const cookieState = cookieValue(req, oidcCookieName)
          const flow = state === null ? undefined : pendingOidcFlows.get(state)
          const clearFlowCookie = expiredCookie(oidcCookieName, secure, '/auth/oidc')
          if (state === null || cookieState !== state || flow === undefined || flow.expiresAt <= Date.now()) {
            if (flow !== undefined && flow.expiresAt <= Date.now()) pendingOidcFlows.delete(state as string)
            sendRedirect(res, oidcFailureLocation(flow?.settings, 'flow_expired'), [clearFlowCookie])
            return
          }
          pendingOidcFlows.delete(state)
          if (requestUrl.searchParams.has('error')) {
            sendRedirect(res, oidcFailureLocation(flow.settings, 'access_denied'), [clearFlowCookie])
            return
          }
          try {
            const current = await resolveOidcInputs(ctx, true)
            if (current.fingerprint !== flow.fingerprint) {
              sendRedirect(res, oidcFailureLocation(flow.settings, 'configuration_changed'), [clearFlowCookie])
              return
            }
            const callbackUrl = new URL(flow.settings.redirectUri)
            callbackUrl.search = requestUrl.search
            const tokens = await oidc.authorizationCodeGrant(flow.client, callbackUrl, {
              pkceCodeVerifier: flow.codeVerifier,
              expectedState: state,
              expectedNonce: flow.nonce,
              idTokenExpected: true,
            })
            const claims = tokens.claims()
            if (claims === undefined || typeof claims.sub !== 'string' || claims.sub.length === 0) {
              throw new Error('OIDC ID Token is missing sub')
            }
            const groups = Array.isArray(claims.groups)
              ? claims.groups.filter((group): group is string => typeof group === 'string')
              : []
            const issued = await ctx.auth.loginOidc({
              issuer: flow.settings.issuer,
              subject: claims.sub,
              ...typeof claims.preferred_username === 'string'
                ? { preferredUsername: claims.preferred_username }
                : {},
              ...typeof claims.name === 'string' ? { displayName: claims.name } : {},
              administrator: flow.settings.administratorGroup.length > 0
                && groups.includes(flow.settings.administratorGroup),
            })
            sendRedirect(res, new URL('/', flow.settings.redirectUri).href, [
              sessionCookie(cookieName, issued.token, issued.principal.expiresAt, secure),
              clearFlowCookie,
            ])
          } catch (error) {
            ctx.logger.warn('OIDC callback validation failed')
            ctx.logger.warn(error)
            sendRedirect(res, oidcFailureLocation(flow.settings, 'login_failed'), [clearFlowCookie])
          }
          return
        }

        const principal = await principalFor(ctx, req, cookieName)
        if (principal === undefined) {
          sendJson(res, 401, { error: { code: 'AUTH_REQUIRED', message: '请先登录' } })
          return
        }

        if (pathname === '/auth/preferences' && req.method === 'GET') {
          sendJson(res, 200, { sharedDeepSeek: await sharedDeepSeekStatus(ctx, principal.user.id) })
          return
        }

        if (pathname === '/auth/preferences' && req.method === 'PATCH') {
          const body = await readJson(req, maxBodyBytes)
          const enabled = booleanField(body, 'sharedDeepSeekEnabled')
          const status = await sharedDeepSeekStatus(ctx, principal.user.id)
          if (enabled && !status.configured) {
            throw new AuthError('INVALID_INPUT', '管理员尚未配置统一 DeepSeek API Key')
          }
          await ctx.auth.setSharedDeepSeekPreference(principal.user.id, enabled)
          sendJson(res, 200, {
            sharedDeepSeek: { ...await sharedDeepSeekStatus(ctx, principal.user.id), enabled },
          })
          return
        }

        if (pathname === '/auth/projects' && req.method === 'GET') {
          sendJson(res, 200, { projects: projectView(ctx, principal) })
          return
        }

        if (pathname === '/auth/projects' && req.method === 'POST') {
          const body = await readJson(req, maxBodyBytes)
          const requestedName = stringField(body, 'name') as string
          const title = requestedName.normalize('NFKC').trim()
          if (title.length === 0 || title.length > 80) {
            throw new AuthError('INVALID_INPUT', '项目名称长度必须为 1–80 个字符')
          }
          const paths = await ctx.auth.ensureUserPaths(principal.user.id)
          const path = resolve(paths.projects, randomUUID())
          await mkdir(path, { recursive: false, mode: 0o700 })
          const workspace = await ctx.workspaceRegistry.create(path)
          await workspace.setTitle(title)
          const project = projectView(ctx, principal).find(candidate => candidate.id === workspace.id)
          if (project === undefined) throw new Error('created project is outside the authenticated user root')
          sendJson(res, 201, { project })
          return
        }

        if (pathname === '/auth/system/shared-deepseek' && req.method === 'PUT') {
          requireAdmin(principal)
          const body = await readJson(req, maxBodyBytes)
          const checked = normalizeApiKey(stringField(body, 'apiKey') as string)
          if (!checked.ok) {
            throw new AuthError(
              'INVALID_INPUT',
              checked.reason === 'empty' ? 'API Key 不能为空' : 'API Key 包含不支持的字符',
            )
          }
          await ctx.credentials.set(credentialRef(SHARED_DEEPSEEK_API_KEY_ENV), checked.value)
          sendJson(res, 200, { sharedDeepSeek: await sharedDeepSeekStatus(ctx) })
          return
        }

        if (pathname === '/auth/system/shared-deepseek' && req.method === 'DELETE') {
          requireAdmin(principal)
          await ctx.credentials.unset(credentialRef(SHARED_DEEPSEEK_API_KEY_ENV))
          sendJson(res, 200, { sharedDeepSeek: await sharedDeepSeekStatus(ctx) })
          return
        }

        if (pathname === '/auth/system/oidc' && req.method === 'PUT') {
          requireAdmin(principal)
          const body = await readJson(req, maxBodyBytes)
          const settings = oidcConfigFrom(body)
          const clientSecret = stringField(body, 'clientSecret', false)
          if (clientSecret !== undefined && (clientSecret.length === 0 || clientSecret.length > 4096)) {
            throw new AuthError('INVALID_INPUT', 'clientSecret 长度必须为 1–4096 个字符')
          }
          if (settings.clientAuthMethod === 'none' && clientSecret !== undefined) {
            throw new AuthError('INVALID_INPUT', '公共客户端模式不应设置 clientSecret')
          }
          const secretInfo = await ctx.credentials.describe(credentialRef(OIDC_CLIENT_SECRET_ENV))
          if (settings.enabled && settings.clientAuthMethod !== 'none'
            && clientSecret === undefined && !secretInfo.configured) {
            throw new AuthError('INVALID_INPUT', '启用机密客户端前必须设置 clientSecret')
          }
          if (clientSecret !== undefined) {
            await ctx.credentials.set(credentialRef(OIDC_CLIENT_SECRET_ENV), clientSecret)
          }
          await ctx.auth.setOidcClientConfig(settings)
          sendJson(res, 200, { oidc: await oidcStatus(ctx) })
          return
        }

        if (pathname === '/auth/system/oidc/test' && req.method === 'POST') {
          requireAdmin(principal)
          const runtime = await discoverOidcClient(ctx, false)
          const metadata = runtime.client.serverMetadata()
          sendJson(res, 200, {
            oidc: {
              ok: true,
              issuer: metadata.issuer,
              authorizationEndpoint: metadata.authorization_endpoint,
              tokenEndpoint: metadata.token_endpoint,
              jwksUri: metadata.jwks_uri,
              supportsPkceS256: metadata.code_challenge_methods_supported?.includes('S256') ?? false,
            },
          })
          return
        }

        if (pathname === '/auth/system' && req.method === 'GET') {
          requireAdmin(principal)
          const users = ctx.auth.listUsers()
          const dataRoot = dirname(dirname(ctx.auth.userPaths(principal.user.id).root))
          const sharedDeepSeek = await sharedDeepSeekStatus(ctx)
          const oidcState = await oidcStatus(ctx)
          sendJson(res, 200, {
            runtime: {
              processModel: 'single-process',
              storage: 'file-backed',
              dataRoot,
            },
            users: {
              total: users.length,
              active: users.filter(user => user.status === 'active').length,
              administrators: users.filter(user => user.role === 'admin').length,
            },
            authentication: {
              oidcConfigured: oidcState.configured,
              oidc: oidcState,
              localLoginEnabled: true,
              cookie: {
                name: cookieName,
                httpOnly: true,
                sameSite: 'Lax',
                secure,
              },
            },
            isolation: {
              userDirectoryKey: 'stable-user-id',
              projectsManaged: true,
              administratorContentAccess: false,
            },
            sharedDeepSeek: {
              ...sharedDeepSeek,
              enabledUsers: users.filter(user => ctx.auth.sharedDeepSeekPreference(user.id).enabled).length,
            },
            limits: { maxBodyBytes },
          })
          return
        }

        if (pathname === '/auth/users' && req.method === 'GET') {
          requireAdmin(principal)
          sendJson(res, 200, { users: ctx.auth.listUsers() })
          return
        }

        if (pathname === '/auth/users' && req.method === 'POST') {
          requireAdmin(principal)
          const body = await readJson(req, maxBodyBytes)
          const role = body.role
          if (role !== undefined && role !== 'admin' && role !== 'user') {
            throw new AuthError('INVALID_INPUT', 'role 必须是 admin 或 user')
          }
          const user = await ctx.auth.createLocalUser({
            username: stringField(body, 'username') as string,
            password: stringField(body, 'password') as string,
            ...body.displayName === undefined
              ? {}
              : { displayName: stringField(body, 'displayName') as string },
            ...role === undefined ? {} : { role },
          })
          sendJson(res, 201, { user })
          return
        }

        const userMatch = /^\/auth\/users\/([^/]+)$/.exec(pathname)
        if (userMatch !== null && req.method === 'PATCH') {
          requireAdmin(principal)
          const body = await readJson(req, maxBodyBytes)
          const role = body.role
          const status = body.status
          if (role !== undefined && role !== 'admin' && role !== 'user') {
            throw new AuthError('INVALID_INPUT', 'role 必须是 admin 或 user')
          }
          if (status !== undefined && status !== 'active' && status !== 'disabled') {
            throw new AuthError('INVALID_INPUT', 'status 必须是 active 或 disabled')
          }
          const user = await ctx.auth.updateUser(decodeURIComponent(userMatch[1] as string) as UserId, {
            ...body.displayName === undefined
              ? {}
              : { displayName: stringField(body, 'displayName') as string },
            ...role === undefined ? {} : { role },
            ...status === undefined ? {} : { status },
          })
          sendJson(res, 200, { user })
          return
        }

        const resetMatch = /^\/auth\/users\/([^/]+)\/reset-password$/.exec(pathname)
        if (resetMatch !== null && req.method === 'POST') {
          requireAdmin(principal)
          const body = await readJson(req, maxBodyBytes)
          await ctx.auth.resetLocalPassword(
            decodeURIComponent(resetMatch[1] as string) as UserId,
            stringField(body, 'password') as string,
          )
          sendJson(res, 200, { ok: true })
          return
        }

        sendJson(res, 404, { error: { code: 'NOT_FOUND', message: '接口不存在' } })
      } catch (error) {
        sendFailure(res, error)
      }
    },
  }
  ctx.effect(() => ctx.webServer.register(route), 'host-auth-web: /auth routes')
}
