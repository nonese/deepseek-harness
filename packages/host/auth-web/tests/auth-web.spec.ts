/** Real Loader composition coverage for browser authentication routes. */

import { createHash, createSign, generateKeyPairSync } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AuthFile from '@deepseek-ai/dsh-auth-file'
import CredentialsLocal from '@deepseek-ai/dsh-credentials-local'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import * as AuthWeb from '../src/index.ts'

let root: string | undefined
let ctx: Context | undefined
let oidcServer: Server | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  if (oidcServer !== undefined) {
    await new Promise<void>((resolveClose, reject) => {
      oidcServer?.close((error) => { if (error !== undefined) reject(error); else resolveClose() })
    })
    oidcServer = undefined
  }
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  vi.unstubAllEnvs()
})

function json(res: import('node:http').ServerResponse, value: unknown): void {
  const body = JSON.stringify(value)
  res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

async function startOidcProvider(): Promise<{
  issuer: string
  captureAuthorization(url: URL): void
}> {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const publicJwk = publicKey.export({ format: 'jwk' })
  let issuer = ''
  let expectedNonce = ''
  let expectedChallenge = ''
  const handle = async (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', issuer || 'http://127.0.0.1')
    if (url.pathname === '/api/oidc/.well-known/openid-configuration') {
      json(res, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        userinfo_endpoint: `${issuer}/userinfo`,
        jwks_uri: `${issuer}/jwks`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
        code_challenge_methods_supported: ['S256'],
        scopes_supported: ['openid', 'profile', 'email', 'groups'],
        claims_supported: ['sub', 'preferred_username', 'name', 'email', 'email_verified', 'groups'],
      })
      return
    }
    if (url.pathname === '/api/oidc/jwks') {
      json(res, { keys: [{ ...publicJwk, kid: 'test-key', use: 'sig', alg: 'RS256' }] })
      return
    }
    if (url.pathname === '/api/oidc/token' && req.method === 'POST') {
      const chunks: Uint8Array[] = []
      for await (const chunk of req as AsyncIterable<Uint8Array>) chunks.push(chunk)
      const body = new URLSearchParams(Buffer.concat(chunks).toString('utf8'))
      const verifier = body.get('code_verifier') ?? ''
      const challenge = createHash('sha256').update(verifier).digest('base64url')
      const encodedCredentials = Buffer.from(
        (req.headers.authorization ?? '').replace(/^Basic /, ''),
        'base64',
      ).toString()
      const credentials = encodedCredentials.split(':').map(part => decodeURIComponent(part)).join(':')
      if (body.get('code') !== 'valid-code' || challenge !== expectedChallenge
        || credentials !== 'harness-client:harness-secret') {
        const failure = JSON.stringify({
          error: 'invalid_grant',
          error_description: JSON.stringify({
            code: body.get('code'),
            challenge,
            expectedChallenge,
            credentials,
          }),
        })
        res.writeHead(400, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(failure) })
        res.end(failure)
        return
      }
      const now = Math.floor(Date.now() / 1000)
      const signingInput = `${encodeJson({ alg: 'RS256', kid: 'test-key', typ: 'JWT' })}.${encodeJson({
        iss: issuer,
        sub: 'oidc-user-1',
        aud: 'harness-client',
        iat: now,
        exp: now + 3600,
        nonce: expectedNonce,
        preferred_username: 'external.user',
        name: '企业普通用户',
        email: 'external.user@example.test',
        email_verified: true,
        groups: ['teacher', 'perm:self.profile.read'],
      })}`
      const signature = createSign('RSA-SHA256').update(signingInput).sign(privateKey, 'base64url')
      json(res, {
        access_token: 'opaque-access-token',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'openid profile email groups',
        id_token: `${signingInput}.${signature}`,
      })
      return
    }
    res.writeHead(404)
    res.end()
  }
  oidcServer = createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => { res.destroy(error instanceof Error ? error : undefined) })
  })
  await new Promise<void>((resolveListen, reject) => {
    oidcServer?.once('error', reject)
    oidcServer?.listen(0, '127.0.0.1', () => { resolveListen() })
  })
  const address = oidcServer.address()
  if (address === null || typeof address === 'string') throw new Error('OIDC test server did not bind TCP')
  issuer = `http://127.0.0.1:${String(address.port)}/api/oidc`
  return {
    issuer,
    captureAuthorization(url: URL) {
      expectedNonce = url.searchParams.get('nonce') ?? ''
      expectedChallenge = url.searchParams.get('code_challenge') ?? ''
    },
  }
}

async function boot(): Promise<{ context: Context; origin: string }> {
  root = await mkdtemp(join(tmpdir(), 'harness-auth-web-'))
  vi.stubEnv('HARNESS_TEST_ADMIN_PASSWORD', 'correct horse battery staple')
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-auth-file'",
    '  config:',
    `    root: ${JSON.stringify(root)}`,
    '    bootstrapPasswordEnv: HARNESS_TEST_ADMIN_PASSWORD',
    "- name: '@deepseek-ai/dsh-credentials-local'",
    '  config:',
    `    path: ${JSON.stringify(join(root, '.credentials.yaml'))}`,
    '    watch: false',
    "- name: '@test/auth-deps'",
    "- name: '@deepseek-ai/dsh-host-webserver'",
    '  config:',
    "    host: '127.0.0.1'",
    '    port: 0',
    "- name: '@deepseek-ai/dsh-host-auth-web'",
    '',
  ].join('\n'))

  const workspaces: Array<Record<string, unknown>> = []
  const testDeps = {
    name: 'auth-web-test-deps',
    apply(context: Context) {
      context.provide('sessions', { list: () => [] } as never)
      context.provide('connection', {
        registerAuthenticator: () => () => Promise.resolve(),
      } as never)
      context.provide('sessionController', { inspect: vi.fn() } as never)
      context.provide('typertGateway', {
        registerMiddleware: () => () => Promise.resolve(),
      } as never)
      context.provide('workspaceRegistry', {
        list: () => workspaces,
        async create(path: string) {
          const canonical = await realpath(path)
          const workspace: Record<string, unknown> = {
            id: `workspace-${String(workspaces.length + 1)}`,
            path: canonical,
            title: 'untitled',
            sessionIds: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            async setTitle(title: string) { workspace.title = title; workspace.updatedAt = new Date().toISOString() },
          }
          workspaces.push(workspace)
          return workspace
        },
      } as never)
    },
  }

  ctx = new Context()
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-auth-file', AuthFile],
    ['@deepseek-ai/dsh-credentials-local', CredentialsLocal],
    ['@test/auth-deps', testDeps],
    ['@deepseek-ai/dsh-host-webserver', WebServer],
    ['@deepseek-ai/dsh-host-auth-web', AuthWeb],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return { context: ctx, origin: `http://127.0.0.1:${String(ctx.webServer.port)}` }
}

describe('real authentication route composition', () => {
  it('keeps the plugin graph behind local login and exposes admin metadata only after authentication', { timeout: 60_000 }, async () => {
    const { context, origin } = await boot()
    const unloaded = [...context.loader.entries()]
      .filter(entry => entry.fiber === undefined && !entry.disabled)
      .map(entry => entry.options.name)
    expect(unloaded).toEqual([])

    const anonymous = await fetch(`${origin}/auth/session`)
    expect(await anonymous.json()).toMatchObject({ authenticated: false, oidc: { configured: false } })
    expect((await fetch(`${origin}/auth/projects`)).status).toBe(401)

    const rejectedOrigin = await fetch(`${origin}/auth/login/local`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://untrusted.internal' },
      body: JSON.stringify({ username: 'admin', password: 'correct horse battery staple' }),
    })
    expect(rejectedOrigin.status).toBe(403)

    const login = await fetch(`${origin}/auth/login/local`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ username: 'admin', password: 'correct horse battery staple' }),
    })
    expect(login.status).toBe(200)
    const cookie = login.headers.get('set-cookie')?.split(';', 1)[0]
    expect(cookie).toMatch(/^harness_session=/)

    const session = await fetch(`${origin}/auth/session`, { headers: { cookie: cookie as string } })
    expect(await session.json()).toMatchObject({ authenticated: true, user: { username: 'admin', role: 'admin' } })
    const users = await fetch(`${origin}/auth/users`, { headers: { cookie: cookie as string } })
    expect(await users.json()).toMatchObject({ users: [{ username: 'admin', role: 'admin' }] })

    expect((await fetch(`${origin}/auth/system`)).status).toBe(401)
    const system = await fetch(`${origin}/auth/system`, { headers: { cookie: cookie as string } })
    expect(await system.json()).toEqual({
      runtime: { processModel: 'single-process', storage: 'file-backed', dataRoot: root },
      users: { total: 1, active: 1, administrators: 1 },
      authentication: {
        oidcConfigured: false,
        oidc: {
          configured: false,
          enabled: false,
          clientSecretConfigured: false,
          clientSecretWritable: true,
        },
        localLoginEnabled: true,
        cookie: { name: 'harness_session', httpOnly: true, sameSite: 'Lax', secure: false },
      },
      isolation: {
        userDirectoryKey: 'stable-user-id',
        projectsManaged: true,
        administratorContentAccess: false,
      },
      sharedDeepSeek: {
        provider: 'deepseek-official',
        model: 'deepseek-v4-flash',
        name: 'DeepSeek-V4-Flash',
        configured: false,
        writable: true,
        enabledUsers: 0,
      },
      limits: { maxBodyBytes: 64 * 1024 },
    })

    const createdUser = await fetch(`${origin}/auth/users`, {
      method: 'POST',
      headers: { cookie: cookie as string, origin, 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'member', password: 'ordinary member password' }),
    })
    expect(createdUser.status).toBe(201)
    const memberLogin = await fetch(`${origin}/auth/login/local`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ username: 'member', password: 'ordinary member password' }),
    })
    const memberCookie = memberLogin.headers.get('set-cookie')?.split(';', 1)[0]
    expect((await fetch(`${origin}/auth/system`, { headers: { cookie: memberCookie as string } })).status).toBe(403)

    const initialPreference = await fetch(`${origin}/auth/preferences`, {
      headers: { cookie: memberCookie as string },
    })
    expect(await initialPreference.json()).toMatchObject({
      sharedDeepSeek: { configured: false, enabled: false, model: 'deepseek-v4-flash' },
    })
    const unavailableOptIn = await fetch(`${origin}/auth/preferences`, {
      method: 'PATCH',
      headers: { cookie: memberCookie as string, origin, 'content-type': 'application/json' },
      body: JSON.stringify({ sharedDeepSeekEnabled: true }),
    })
    expect(unavailableOptIn.status).toBe(400)

    const sharedKey = 'sk-shared-secret-that-must-not-return'
    const configured = await fetch(`${origin}/auth/system/shared-deepseek`, {
      method: 'PUT',
      headers: { cookie: cookie as string, origin, 'content-type': 'application/json' },
      body: JSON.stringify({ apiKey: sharedKey }),
    })
    const configuredBody: unknown = await configured.json()
    expect(configuredBody).toEqual({
      sharedDeepSeek: {
        provider: 'deepseek-official',
        model: 'deepseek-v4-flash',
        name: 'DeepSeek-V4-Flash',
        configured: true,
        writable: true,
      },
    })
    expect(JSON.stringify(configuredBody)).not.toContain(sharedKey)

    const memberWrite = await fetch(`${origin}/auth/system/shared-deepseek`, {
      method: 'PUT',
      headers: { cookie: memberCookie as string, origin, 'content-type': 'application/json' },
      body: JSON.stringify({ apiKey: 'sk-member-must-be-rejected' }),
    })
    expect(memberWrite.status).toBe(403)

    const enabled = await fetch(`${origin}/auth/preferences`, {
      method: 'PATCH',
      headers: { cookie: memberCookie as string, origin, 'content-type': 'application/json' },
      body: JSON.stringify({ sharedDeepSeekEnabled: true }),
    })
    expect(await enabled.json()).toMatchObject({ sharedDeepSeek: { configured: true, enabled: true } })
    const updatedSystem = await fetch(`${origin}/auth/system`, { headers: { cookie: cookie as string } })
    expect(await updatedSystem.json()).toMatchObject({ sharedDeepSeek: { configured: true, enabledUsers: 1 } })

    const cleared = await fetch(`${origin}/auth/system/shared-deepseek`, {
      method: 'DELETE',
      headers: { cookie: cookie as string, origin },
    })
    expect(await cleared.json()).toMatchObject({ sharedDeepSeek: { configured: false } })

    const project = await fetch(`${origin}/auth/projects`, {
      method: 'POST',
      headers: { cookie: cookie as string, origin, 'content-type': 'application/json' },
      body: JSON.stringify({ name: '内网项目' }),
    })
    expect(await project.json()).toMatchObject({ project: { name: '内网项目', sessionCount: 0 } })

    const oidc = await fetch(`${origin}/auth/oidc`, { redirect: 'manual' })
    expect(oidc.status).toBe(302)
    expect(oidc.headers.get('location')).toBe('/?oidc_error=unavailable')
  })

  it('completes PKCE OIDC login, keeps the client secret server-side, and creates an ordinary isolated user', { timeout: 60_000 }, async () => {
    const { context, origin } = await boot()
    const provider = await startOidcProvider()
    const login = await fetch(`${origin}/auth/login/local`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ username: 'admin', password: 'correct horse battery staple' }),
    })
    const adminCookie = login.headers.get('set-cookie')?.split(';', 1)[0]
    if (adminCookie === undefined) throw new Error('administrator cookie missing')

    const saved = await fetch(`${origin}/auth/system/oidc`, {
      method: 'PUT',
      headers: { cookie: adminCookie, origin, 'content-type': 'application/json' },
      body: JSON.stringify({
        enabled: true,
        issuer: provider.issuer,
        clientId: 'harness-client',
        clientSecret: 'harness-secret',
        redirectUri: `${origin}/auth/oidc/callback`,
        scopes: ['openid', 'profile', 'email', 'groups'],
        clientAuthMethod: 'client_secret_basic',
        allowInsecureIssuer: true,
        administratorGroup: 'super_admin',
      }),
    })
    expect(saved.status).toBe(200)
    const savedBody: unknown = await saved.json()
    expect(savedBody).toMatchObject({
      oidc: {
        configured: true,
        enabled: true,
        clientSecretConfigured: true,
        settings: { issuer: provider.issuer, clientId: 'harness-client' },
      },
    })
    expect(JSON.stringify(savedBody)).not.toContain('harness-secret')

    const tested = await fetch(`${origin}/auth/system/oidc/test`, {
      method: 'POST',
      headers: { cookie: adminCookie, origin, 'content-type': 'application/json' },
      body: '{}',
    })
    expect(await tested.json()).toMatchObject({
      oidc: { ok: true, issuer: provider.issuer, supportsPkceS256: true },
    })
    expect(await (await fetch(`${origin}/auth/session`)).json()).toMatchObject({
      authenticated: false,
      oidc: { configured: true },
    })

    const start = await fetch(`${origin}/auth/oidc/start`, { redirect: 'manual' })
    expect(start.status).toBe(302)
    const authorization = new URL(start.headers.get('location') as string)
    provider.captureAuthorization(authorization)
    expect(authorization.origin + authorization.pathname).toBe(`${provider.issuer}/authorize`)
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorization.searchParams.get('scope')).toBe('openid profile email groups')
    const state = authorization.searchParams.get('state')
    expect(state).not.toBeNull()
    const flowCookie = start.headers.get('set-cookie')?.split(';', 1)[0]
    if (state === null || flowCookie === undefined) throw new Error('OIDC flow state missing')

    const callback = await fetch(`${origin}/auth/oidc/callback?code=valid-code&state=${encodeURIComponent(state)}`, {
      headers: { cookie: flowCookie },
      redirect: 'manual',
    })
    expect(callback.status).toBe(302)
    expect(callback.headers.get('location')).toBe(`${origin}/`)
    const setCookies = (callback.headers as Headers & { getSetCookie(): string[] }).getSetCookie()
    const oidcSessionCookie = setCookies.find(value => value.startsWith('harness_session='))?.split(';', 1)[0]
    if (oidcSessionCookie === undefined) throw new Error('OIDC session cookie missing')

    const oidcSession = await fetch(`${origin}/auth/session`, { headers: { cookie: oidcSessionCookie } })
    expect(await oidcSession.json()).toMatchObject({
      authenticated: true,
      method: 'oidc',
      user: {
        username: 'external.user',
        displayName: '企业普通用户',
        role: 'user',
        authMethods: ['oidc'],
      },
    })
    expect(context.auth.listUsers()).toHaveLength(2)
    expect((await fetch(`${origin}/auth/system`, { headers: { cookie: oidcSessionCookie } })).status).toBe(403)

    const replay = await fetch(`${origin}/auth/oidc/callback?code=valid-code&state=${encodeURIComponent(state)}`, {
      headers: { cookie: flowCookie },
      redirect: 'manual',
    })
    expect(replay.headers.get('location')).toBe('/?oidc_error=flow_expired')
  })
})
