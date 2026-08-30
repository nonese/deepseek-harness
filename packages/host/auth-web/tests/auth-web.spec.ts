/** Real Loader composition coverage for browser authentication routes. */

import { createHash, createSign, generateKeyPairSync } from 'node:crypto'
import { createServer, request as httpRequest, type Server } from 'node:http'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AuthFile from '@deepseek-ai/dsh-auth-file'
import type { ConnectionRequestAuthenticator } from '@deepseek-ai/dsh-client-connection'
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

function json(res: import('node:http').ServerResponse, value: unknown, status = 200): void {
  const body = JSON.stringify(value)
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

async function startOidcProvider(): Promise<{
  issuer: string
  captureAuthorization(url: URL): void
  setClientAuthMethod(method: 'client_secret_basic' | 'client_secret_post'): void
  setClaims(claims: Readonly<Record<string, unknown>>): void
  setTokenSuccessStatus(status: number): void
  setSupportsPkce(value: boolean | undefined): void
}> {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const publicJwk = publicKey.export({ format: 'jwk' })
  let issuer = ''
  let expectedNonce = ''
  let expectedChallenge = ''
  let supportsPkce: boolean | undefined = true
  let tokenSuccessStatus = 200
  let clientAuthMethod: 'client_secret_basic' | 'client_secret_post' = 'client_secret_basic'
  let customClaims: Readonly<Record<string, unknown>> = {
    sub: 'oidc-user-1',
    preferred_username: 'external.user',
    name: '企业普通用户',
    email: 'external.user@example.test',
    email_verified: true,
    groups: ['teacher', 'perm:self.profile.read'],
  }
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
        ...supportsPkce === undefined
          ? {}
          : { code_challenge_methods_supported: supportsPkce ? ['S256'] : [] },
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
      const clientAuthenticated = clientAuthMethod === 'client_secret_basic'
        ? credentials === 'harness-client:harness-secret'
        : body.get('client_id') === 'harness-client' && body.get('client_secret') === 'harness-secret'
      if (body.get('code') !== 'valid-code' || challenge !== expectedChallenge
        || !clientAuthenticated) {
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
        aud: 'harness-client',
        iat: now,
        exp: now + 3600,
        nonce: expectedNonce,
        ...customClaims,
      })}`
      const signature = createSign('RSA-SHA256').update(signingInput).sign(privateKey, 'base64url')
      json(res, {
        access_token: 'opaque-access-token',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'openid profile email groups',
        id_token: `${signingInput}.${signature}`,
      }, tokenSuccessStatus)
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
    setClientAuthMethod(method) {
      clientAuthMethod = method
    },
    setClaims(claims) {
      customClaims = claims
    },
    setTokenSuccessStatus(status) {
      tokenSuccessStatus = status
    },
    setSupportsPkce(value) {
      supportsPkce = value
    },
  }
}

interface BootOptions {
  readonly secureCookie?: boolean
  readonly maxBodyBytes?: number
  readonly projectFileMaxEntries?: number
  readonly projectFilePreviewMaxBytes?: number
  readonly oidcTokenEndpointCreatedCompatibility?: boolean
  readonly projectFileUploadMaxBytes?: number
}

interface BootResult {
  readonly context: Context
  readonly origin: string
  readonly authenticator: ConnectionRequestAuthenticator
  readonly sessions: Array<{ header: { cwd?: string; createdAt: number } }>
  readonly workspaces: Array<Record<string, unknown>>
}

async function boot(options: BootOptions = {}): Promise<BootResult> {
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
    '  config:',
    `    secureCookie: ${String(options.secureCookie ?? false)}`,
    `    maxBodyBytes: ${String(options.maxBodyBytes ?? 64 * 1024)}`,
    `    projectFileMaxEntries: ${String(options.projectFileMaxEntries ?? 1_000)}`,
    `    projectFilePreviewMaxBytes: ${String(options.projectFilePreviewMaxBytes ?? 512 * 1024)}`,
    `    oidcTokenEndpointCreatedCompatibility: ${String(options.oidcTokenEndpointCreatedCompatibility ?? false)}`,
    `    projectFileUploadMaxBytes: ${String(options.projectFileUploadMaxBytes ?? 50 * 1024 * 1024)}`,
    '',
  ].join('\n'))

  const workspaces: Array<Record<string, unknown>> = []
  const sessions: Array<{ header: { cwd?: string; createdAt: number } }> = []
  let authenticator: ConnectionRequestAuthenticator | undefined
  const testDeps = {
    name: 'auth-web-test-deps',
    apply(context: Context) {
      context.provide('sessions', { list: () => sessions } as never)
      context.provide('connection', {
        registerAuthenticator: (value: ConnectionRequestAuthenticator) => {
          authenticator = value
          return () => Promise.resolve()
        },
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
  if (authenticator === undefined) throw new Error('authentication route did not register its Connection policy')
  return {
    context: ctx,
    origin: `http://127.0.0.1:${String(ctx.webServer.port)}`,
    authenticator,
    sessions,
    workspaces,
  }
}

async function localLogin(origin: string, username = 'admin', password = 'correct horse battery staple'): Promise<string> {
  const response = await fetch(`${origin}/auth/login/local`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ username, password }),
  })
  const cookie = response.headers.get('set-cookie')?.split(';', 1)[0]
  if (response.status !== 200 || cookie === undefined) throw new Error(`local login failed with HTTP ${String(response.status)}`)
  return cookie
}

function jsonHeaders(origin: string, cookie?: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    origin,
    ...cookie === undefined ? {} : { cookie },
  }
}

async function postWithoutHost(origin: string, path: string, requestOrigin: string): Promise<number> {
  const target = new URL(origin)
  return await new Promise<number>((resolveStatus, reject) => {
    const req = httpRequest({
      hostname: target.hostname,
      port: target.port,
      path,
      method: 'POST',
      headers: { origin: requestOrigin },
      setHost: false,
    }, (res) => {
      res.resume()
      res.once('end', () => { resolveStatus(res.statusCode ?? 0) })
    })
    req.once('error', reject)
    req.end()
  })
}

async function putChunked(
  targetUrl: URL,
  cookie: string,
  chunks: readonly Uint8Array[],
): Promise<{ status: number; body: unknown }> {
  return await new Promise((resolveResponse, reject) => {
    const req = httpRequest({
      hostname: targetUrl.hostname,
      port: targetUrl.port,
      path: `${targetUrl.pathname}${targetUrl.search}`,
      method: 'PUT',
      headers: { cookie, origin: targetUrl.origin, 'content-type': 'application/octet-stream' },
    }, (res) => {
      const body: Uint8Array[] = []
      res.on('data', (chunk: Uint8Array) => body.push(chunk))
      res.once('end', () => {
        const text = Buffer.concat(body).toString('utf8')
        resolveResponse({ status: res.statusCode ?? 0, body: text.length === 0 ? undefined : JSON.parse(text) })
      })
    })
    req.once('error', reject)
    for (const chunk of chunks) req.write(chunk)
    req.end()
  })
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
      limits: {
        maxBodyBytes: 64 * 1024,
        projectFileMaxEntries: 1_000,
        projectFilePreviewMaxBytes: 512 * 1024,
        projectFileUploadMaxBytes: 50 * 1024 * 1024,
      },
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

  it('browses, previews, and downloads only the authenticated user project files', { timeout: 60_000 }, async () => {
    const { origin } = await boot({ projectFileUploadMaxBytes: 1_024 })
    const adminCookie = await localLogin(origin)
    expect((await fetch(`${origin}/auth/projects/missing/files`)).status).toBe(401)

    expect((await fetch(`${origin}/auth/users`, {
      method: 'POST',
      headers: jsonHeaders(origin, adminCookie),
      body: JSON.stringify({ username: 'file-member', password: 'ordinary member password' }),
    })).status).toBe(201)
    const memberCookie = await localLogin(origin, 'file-member', 'ordinary member password')

    const adminProjectResponse = await fetch(`${origin}/auth/projects`, {
      method: 'POST',
      headers: jsonHeaders(origin, adminCookie),
      body: JSON.stringify({ name: 'Admin files' }),
    })
    const adminProject = await adminProjectResponse.json() as { project: { id: string; path: string } }
    const memberProjectResponse = await fetch(`${origin}/auth/projects`, {
      method: 'POST',
      headers: jsonHeaders(origin, memberCookie),
      body: JSON.stringify({ name: 'Member files' }),
    })
    const memberProject = await memberProjectResponse.json() as { project: { id: string; path: string } }

    await mkdir(join(adminProject.project.path, 'src'))
    await writeFile(join(adminProject.project.path, 'README.md'), '# Managed project\n\nPrivate preview.\n')
    await writeFile(join(adminProject.project.path, 'LICENSE'), 'internal test license\n')
    await writeFile(join(adminProject.project.path, 'archive.bin'), Buffer.from([1, 2, 3]))
    await writeFile(join(adminProject.project.path, 'embedded.txt'), Buffer.from([65, 0, 66]))
    await writeFile(join(adminProject.project.path, 'invalid.txt'), Buffer.from([0xff]))
    await writeFile(join(adminProject.project.path, '中文.md'), '# 下载内容\n')
    await writeFile(join(adminProject.project.path, '.env'), 'SECRET=hidden\n')
    await writeFile(join(adminProject.project.path, 'src', 'main.ts'), 'export const ready = true\n')
    await mkdir(join(adminProject.project.path, 'z-late-dir'))
    const outside = join(root as string, 'outside-secret.txt')
    await writeFile(outside, 'outside\n')
    await symlink(outside, join(adminProject.project.path, 'outside-link'))
    await writeFile(join(memberProject.project.path, 'member.txt'), 'member owned\n')

    const adminFiles = `${origin}/auth/projects/${encodeURIComponent(adminProject.project.id)}/files`
    const memberFiles = `${origin}/auth/projects/${encodeURIComponent(memberProject.project.id)}/files`
    const rootListing = await fetch(adminFiles, { headers: { cookie: adminCookie } })
    expect(rootListing.status).toBe(200)
    const rootBody = await rootListing.json() as {
      directory: { path: string; entries: Array<{ name: string; kind: string; previewable: boolean }> }
    }
    expect(rootBody.directory.path).toBe('')
    expect(rootBody.directory.entries.map(entry => entry.name)).toEqual([
      'src', 'z-late-dir', '中文.md', 'archive.bin', 'embedded.txt', 'invalid.txt', 'LICENSE', 'README.md',
    ])
    expect(rootBody.directory.entries.find(entry => entry.name === 'README.md')).toMatchObject({
      kind: 'file', previewable: true,
    })
    expect(rootBody.directory.entries.find(entry => entry.name === 'archive.bin')).toMatchObject({
      kind: 'file', previewable: false,
    })

    const nested = new URL(adminFiles)
    nested.searchParams.set('path', 'src')
    expect(await (await fetch(nested, { headers: { cookie: adminCookie } })).json()).toMatchObject({
      directory: { path: 'src', entries: [{ name: 'main.ts', path: 'src/main.ts', previewable: true }] },
    })

    const upload = new URL(`${adminFiles}/upload`)
    upload.searchParams.set('path', 'src')
    upload.searchParams.set('name', '教案.md')
    const uploaded = await fetch(upload, {
      method: 'PUT',
      headers: { cookie: adminCookie, origin, 'content-type': 'text/markdown' },
      body: '# 课程教案\n',
    })
    expect(uploaded.status).toBe(201)
    expect(await uploaded.json()).toMatchObject({
      file: { name: '教案.md', path: 'src/教案.md', kind: 'file', previewable: true },
    })
    const uploadedPreview = new URL(`${adminFiles}/preview`)
    uploadedPreview.searchParams.set('path', 'src/教案.md')
    expect(await (await fetch(uploadedPreview, { headers: { cookie: adminCookie } })).json()).toMatchObject({
      preview: { content: '# 课程教案\n' },
    })

    const chunkedUpload = new URL(`${adminFiles}/upload`)
    chunkedUpload.searchParams.set('name', 'chunked.txt')
    const chunked = await putChunked(chunkedUpload, adminCookie, [Buffer.from('chunked '), Buffer.from('upload\n')])
    expect(chunked).toMatchObject({ status: 201, body: { file: { name: 'chunked.txt', size: 15 } } })

    const conflict = new URL(`${adminFiles}/upload`)
    conflict.searchParams.set('name', 'README.md')
    const conflictResponse = await fetch(conflict, {
      method: 'PUT', headers: { cookie: adminCookie, origin }, body: 'must not overwrite\n',
    })
    expect(conflictResponse.status).toBe(409)
    expect(await conflictResponse.json()).toMatchObject({ error: { code: 'FILE_CONFLICT' } })
    expect(await readFile(join(adminProject.project.path, 'README.md'), 'utf8')).toBe('# Managed project\n\nPrivate preview.\n')

    for (const { name, path } of [
      { name: '.hidden.txt', path: '' },
      { name: 'nested/file.txt', path: '' },
      { name: 'file.txt', path: 'README.md' },
    ]) {
      const invalidUpload = new URL(`${adminFiles}/upload`)
      invalidUpload.searchParams.set('name', name)
      if (path !== '') invalidUpload.searchParams.set('path', path)
      expect((await fetch(invalidUpload, {
        method: 'PUT', headers: { cookie: adminCookie, origin }, body: 'invalid\n',
      })).status, `${path}/${name}`).toBe(400)
    }
    const oversizedUpload = new URL(`${adminFiles}/upload`)
    oversizedUpload.searchParams.set('name', 'oversized.bin')
    expect((await fetch(oversizedUpload, {
      method: 'PUT', headers: { cookie: adminCookie, origin }, body: Buffer.alloc(1_025),
    })).status).toBe(400)
    const oversizedChunked = new URL(`${adminFiles}/upload`)
    oversizedChunked.searchParams.set('name', 'oversized-chunked.bin')
    expect((await putChunked(oversizedChunked, adminCookie, [Buffer.alloc(600), Buffer.alloc(600)])).status).toBe(400)

    const missingName = new URL(`${adminFiles}/upload`)
    expect((await fetch(missingName, {
      method: 'PUT', headers: { cookie: adminCookie, origin }, body: 'missing name',
    })).status).toBe(400)
    const longName = new URL(`${adminFiles}/upload`)
    longName.searchParams.set('name', `${'x'.repeat(252)}.txt`)
    expect((await fetch(longName, {
      method: 'PUT', headers: { cookie: adminCookie, origin }, body: 'long name',
    })).status).toBe(400)
    expect((await fetch(upload, { headers: { cookie: adminCookie } })).status).toBe(405)
    expect((await fetch(adminFiles, {
      method: 'PUT', headers: { cookie: adminCookie, origin }, body: 'wrong operation',
    })).status).toBe(405)

    const markdownPreview = new URL(`${adminFiles}/preview`)
    markdownPreview.searchParams.set('path', 'README.md')
    expect(await (await fetch(markdownPreview, { headers: { cookie: adminCookie } })).json()).toMatchObject({
      preview: {
        file: { name: 'README.md', path: 'README.md', format: 'markdown' },
        content: '# Managed project\n\nPrivate preview.\n',
      },
    })
    const textPreview = new URL(`${adminFiles}/preview`)
    textPreview.searchParams.set('path', 'LICENSE')
    expect(await (await fetch(textPreview, { headers: { cookie: adminCookie } })).json()).toMatchObject({
      preview: { file: { format: 'text' }, content: 'internal test license\n' },
    })

    const download = new URL(`${adminFiles}/download`)
    download.searchParams.set('path', '中文.md')
    const downloaded = await fetch(download, { headers: { cookie: adminCookie } })
    expect(downloaded.status).toBe(200)
    expect(downloaded.headers.get('content-type')).toBe('application/octet-stream')
    expect(downloaded.headers.get('content-disposition')).toContain("filename*=UTF-8''%E4%B8%AD%E6%96%87.md")
    expect(downloaded.headers.get('x-content-type-options')).toBe('nosniff')
    expect(await downloaded.text()).toBe('# 下载内容\n')

    for (const path of ['../outside-secret.txt', '.env', 'src//main.ts', 'src\\main.ts', '/etc/passwd', 'bad\0path']) {
      const invalid = new URL(adminFiles)
      invalid.searchParams.set('path', path)
      expect((await fetch(invalid, { headers: { cookie: adminCookie } })).status, path).toBe(400)
    }
    for (const path of ['README.md', 'missing']) {
      const invalid = new URL(adminFiles)
      invalid.searchParams.set('path', path)
      expect((await fetch(invalid, { headers: { cookie: adminCookie } })).status).toBe(path === 'missing' ? 404 : 400)
    }
    const linked = new URL(`${adminFiles}/preview`)
    linked.searchParams.set('path', 'outside-link')
    expect((await fetch(linked, { headers: { cookie: adminCookie } })).status).toBe(403)
    for (const path of ['', 'src', 'archive.bin', 'embedded.txt', 'invalid.txt']) {
      const invalid = new URL(`${adminFiles}/preview`)
      if (path !== '') invalid.searchParams.set('path', path)
      expect((await fetch(invalid, { headers: { cookie: adminCookie } })).status, path).toBe(400)
    }
    for (const path of ['', 'src']) {
      const invalid = new URL(`${adminFiles}/download`)
      if (path !== '') invalid.searchParams.set('path', path)
      expect((await fetch(invalid, { headers: { cookie: adminCookie } })).status, path).toBe(400)
    }

    expect((await fetch(memberFiles, { headers: { cookie: adminCookie } })).status).toBe(404)
    expect((await fetch(adminFiles, { headers: { cookie: memberCookie } })).status).toBe(404)
    const memberUpload = new URL(`${memberFiles}/upload`)
    memberUpload.searchParams.set('name', 'member-upload.txt')
    expect((await fetch(memberUpload, {
      method: 'PUT', headers: { cookie: memberCookie, origin }, body: 'member upload\n',
    })).status).toBe(201)
    expect(await (await fetch(memberFiles, { headers: { cookie: memberCookie } })).json()).toMatchObject({
      directory: { entries: [{ name: 'member-upload.txt' }, { name: 'member.txt' }] },
    })
  })

  it('completes PKCE OIDC login, keeps the client secret server-side, and creates an ordinary isolated user', { timeout: 60_000 }, async () => {
    const { context, origin } = await boot({ oidcTokenEndpointCreatedCompatibility: true })
    const provider = await startOidcProvider()
    provider.setClientAuthMethod('client_secret_post')
    provider.setTokenSuccessStatus(201)
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
        clientAuthMethod: 'client_secret_post',
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

    provider.setTokenSuccessStatus(202)
    const unsupportedStart = await fetch(`${origin}/auth/oidc/start`, { redirect: 'manual' })
    const unsupportedAuthorization = new URL(unsupportedStart.headers.get('location') as string)
    provider.captureAuthorization(unsupportedAuthorization)
    const unsupportedState = unsupportedAuthorization.searchParams.get('state')
    const unsupportedCookie = unsupportedStart.headers.get('set-cookie')?.split(';', 1)[0]
    if (unsupportedState === null || unsupportedCookie === undefined) throw new Error('second OIDC flow state missing')
    const unsupportedCallback = await fetch(
      `${origin}/auth/oidc/callback?code=valid-code&state=${encodeURIComponent(unsupportedState)}`,
      { headers: { cookie: unsupportedCookie }, redirect: 'manual' },
    )
    expect(unsupportedCallback.headers.get('location')).toBe(`${origin}/?oidc_error=login_failed`)

    const replay = await fetch(`${origin}/auth/oidc/callback?code=valid-code&state=${encodeURIComponent(state)}`, {
      headers: { cookie: flowCookie },
      redirect: 'manual',
    })
    expect(replay.headers.get('location')).toBe('/?oidc_error=flow_expired')
  })

  it('covers connection authentication, local account administration, and route validation', { timeout: 60_000 }, async () => {
    const { context, origin, authenticator, sessions, workspaces } = await boot()
    expect(context.webServer.collectIndexInjections()).toContainEqual({
      kind: 'global',
      name: '__HARNESS_MULTI_USER__',
      value: true,
    })
    await expect(authenticator.authorizeIndex({ headers: {} }, {
      writeHead: vi.fn(),
      end: vi.fn(),
    })).resolves.toBe(true)
    expect(authenticator.authenticatedUrl(origin)).toBe(origin)
    await expect(authenticator.authenticate({ headers: {} })).resolves.toBeUndefined()
    await expect(authenticator.authenticate({ headers: new Headers() })).resolves.toBeUndefined()
    await expect(authenticator.authenticate({ headers: new Headers({ cookie: 'other=value; malformed' }) })).resolves.toBeUndefined()
    await expect(authenticator.authenticate({ headers: { cookie: ['harness_session=%', 'other=value'] } })).resolves.toBeUndefined()
    await expect(authenticator.authenticate({ headers: { cookie: 'harness_session=unknown-token' } })).resolves.toBeUndefined()

    expect((await fetch(`${origin}/auth/login/local`, {
      method: 'POST',
      headers: jsonHeaders(origin),
      body: JSON.stringify({ username: 'admin', password: 'wrong password' }),
    })).status).toBe(401)
    for (const originHeader of [':::', 'ftp://127.0.0.1']) {
      expect((await fetch(`${origin}/auth/login/local`, {
        method: 'POST',
        headers: { ...jsonHeaders(origin), origin: originHeader },
        body: '{}',
      })).status).toBe(403)
    }
    await expect(postWithoutHost(origin, '/auth/logout', origin)).resolves.toBe(400)
    expect((await fetch(`${origin}/auth/logout`, { method: 'POST' })).status).toBe(200)
    expect((await fetch(`${origin}/auth/logout`, {
      method: 'POST',
      headers: { origin: origin.replace('http:', 'https:') },
    })).status).toBe(200)
    for (const body of ['', 'null', '[]', '"text"', '{']) {
      expect((await fetch(`${origin}/auth/login/local`, {
        method: 'POST',
        headers: jsonHeaders(origin),
        body,
      })).status).toBe(400)
    }
    expect((await fetch(`${origin}/auth/login/local`, {
      method: 'POST',
      headers: jsonHeaders(origin),
      body: JSON.stringify({ username: 1, password: 'value' }),
    })).status).toBe(400)

    const adminCookie = await localLogin(origin)
    const authenticated = await authenticator.authenticate({ headers: { cookie: ['other=value', adminCookie] } })
    expect(authenticated?.run(() => context.auth.currentPrincipal()?.user.username)).toBe('admin')
    expect(context.auth.currentPrincipal()).toBeUndefined()
    expect(await (await fetch(`${origin}/auth/session`, {
      headers: { cookie: 'part-without-equals; harness_session=%' },
    })).json()).toMatchObject({ authenticated: false })
    expect(await (await fetch(`${origin}/auth/session`, {
      headers: { cookie: 'other=value' },
    })).json()).toMatchObject({ authenticated: false })

    const created = await fetch(`${origin}/auth/users`, {
      method: 'POST',
      headers: jsonHeaders(origin, adminCookie),
      body: JSON.stringify({
        username: 'member',
        password: 'ordinary member password',
        displayName: 'Member One',
        role: 'user',
      }),
    })
    expect(created.status).toBe(201)
    const createdBody = await created.json() as { user: { id: string } }
    const memberId = createdBody.user.id
    expect((await fetch(`${origin}/auth/users`, {
      method: 'POST',
      headers: jsonHeaders(origin, adminCookie),
      body: JSON.stringify({ username: 'member', password: 'ordinary member password' }),
    })).status).toBe(409)
    for (const body of [
      { username: 'invalid-role', password: 'ordinary member password', role: 'owner' },
      { username: 'invalid-display', password: 'ordinary member password', displayName: 1 },
    ]) {
      expect((await fetch(`${origin}/auth/users`, {
        method: 'POST',
        headers: jsonHeaders(origin, adminCookie),
        body: JSON.stringify(body),
      })).status).toBe(400)
    }

    const adminId = context.auth.listUsers().find(account => account.username === 'admin')?.id
    if (adminId === undefined) throw new Error('administrator id missing')
    expect((await fetch(`${origin}/auth/users/${encodeURIComponent(adminId)}`, {
      method: 'PATCH',
      headers: jsonHeaders(origin, adminCookie),
      body: JSON.stringify({ status: 'disabled' }),
    })).status).toBe(409)
    for (const body of [{ role: 'owner' }, { status: 'pending' }, { displayName: 1 }]) {
      expect((await fetch(`${origin}/auth/users/${encodeURIComponent(memberId)}`, {
        method: 'PATCH',
        headers: jsonHeaders(origin, adminCookie),
        body: JSON.stringify(body),
      })).status).toBe(400)
    }
    const patched = await fetch(`${origin}/auth/users/${encodeURIComponent(memberId)}`, {
      method: 'PATCH',
      headers: jsonHeaders(origin, adminCookie),
      body: JSON.stringify({ displayName: 'Member Renamed', role: 'admin', status: 'active' }),
    })
    expect(await patched.json()).toMatchObject({ user: { displayName: 'Member Renamed', role: 'admin', status: 'active' } })
    expect((await fetch(`${origin}/auth/users/${encodeURIComponent(memberId)}`, {
      method: 'PATCH',
      headers: jsonHeaders(origin, adminCookie),
      body: '{}',
    })).status).toBe(200)
    expect((await fetch(`${origin}/auth/users/missing-user`, {
      method: 'PATCH',
      headers: jsonHeaders(origin, adminCookie),
      body: '{}',
    })).status).toBe(404)

    expect((await fetch(`${origin}/auth/users/${encodeURIComponent(memberId)}/reset-password`, {
      method: 'POST',
      headers: jsonHeaders(origin, adminCookie),
      body: JSON.stringify({ password: 'replacement member password' }),
    })).status).toBe(200)
    expect((await fetch(`${origin}/auth/users/missing-user/reset-password`, {
      method: 'POST',
      headers: jsonHeaders(origin, adminCookie),
      body: JSON.stringify({ password: 'replacement member password' }),
    })).status).toBe(404)
    const memberCookie = await localLogin(origin, 'member', 'replacement member password')
    expect((await fetch(`${origin}/auth/users`, { headers: { cookie: memberCookie } })).status).toBe(200)

    const disabled = await fetch(`${origin}/auth/users/${encodeURIComponent(memberId)}`, {
      method: 'PATCH',
      headers: jsonHeaders(origin, adminCookie),
      body: JSON.stringify({ role: 'user', status: 'disabled' }),
    })
    expect(disabled.status).toBe(200)
    expect((await fetch(`${origin}/auth/login/local`, {
      method: 'POST',
      headers: jsonHeaders(origin),
      body: JSON.stringify({ username: 'member', password: 'replacement member password' }),
    })).status).toBe(403)

    for (const name of ['', 'x'.repeat(81)]) {
      expect((await fetch(`${origin}/auth/projects`, {
        method: 'POST',
        headers: jsonHeaders(origin, adminCookie),
        body: JSON.stringify({ name }),
      })).status).toBe(400)
    }
    const projectResponse = await fetch(`${origin}/auth/projects`, {
      method: 'POST',
      headers: jsonHeaders(origin, adminCookie),
      body: JSON.stringify({ name: '  Managed project  ' }),
    })
    expect(projectResponse.status).toBe(201)
    expect((await fetch(`${origin}/auth/projects`, {
      method: 'POST',
      headers: jsonHeaders(origin, adminCookie),
      body: JSON.stringify({ name: 'Older project' }),
    })).status).toBe(201)
    const workspace = workspaces[0]
    if (workspace === undefined || typeof workspace.path !== 'string') throw new Error('created workspace missing')
    sessions.push(
      { header: { cwd: workspace.path, createdAt: 20 } },
      { header: { cwd: workspace.path, createdAt: 10 } },
      { header: { createdAt: 30 } },
      { header: { cwd: join(root as string, 'outside'), createdAt: 40 } },
    )
    const projectList = await (await fetch(`${origin}/auth/projects`, {
      headers: { cookie: adminCookie },
    })).json() as { projects: Array<{ name: string; sessionCount: number; updatedAt: number }> }
    expect(projectList.projects.find(candidate => candidate.name === 'Managed project')).toMatchObject({
      name: 'Managed project',
      sessionCount: 2,
      updatedAt: 20,
    })

    const originalCreate = context.workspaceRegistry.create.bind(context.workspaceRegistry)
    Reflect.set(context.workspaceRegistry, 'create', async () => ({
      id: 'outside-workspace',
      path: join(root as string, 'outside'),
      title: 'outside',
      sessionIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      setTitle: () => Promise.resolve(),
    }))
    expect((await fetch(`${origin}/auth/projects`, {
      method: 'POST',
      headers: jsonHeaders(origin, adminCookie),
      body: JSON.stringify({ name: 'Outside project' }),
    })).status).toBe(400)
    Reflect.set(context.workspaceRegistry, 'create', originalCreate)

    for (const apiKey of ['', 'bad\u0000key']) {
      expect((await fetch(`${origin}/auth/system/shared-deepseek`, {
        method: 'PUT',
        headers: jsonHeaders(origin, adminCookie),
        body: JSON.stringify({ apiKey }),
      })).status).toBe(400)
    }
    expect((await fetch(`${origin}/auth/not-found`, { headers: { cookie: adminCookie } })).status).toBe(404)

    expect((await fetch(`${origin}/auth/logout`, {
      method: 'POST',
      headers: { origin },
    })).status).toBe(200)
    const logout = await fetch(`${origin}/auth/logout`, {
      method: 'POST',
      headers: { cookie: adminCookie, origin },
    })
    expect(logout.status).toBe(200)
    expect(logout.headers.get('set-cookie')).toContain('Max-Age=0')
  })

  it('rejects invalid OIDC administration input and supports public clients', { timeout: 60_000 }, async () => {
    const { origin } = await boot()
    const adminCookie = await localLogin(origin)
    const base = {
      enabled: false,
      issuer: 'https://id.example.test/',
      clientId: 'harness-client',
      redirectUri: `${origin}/auth/oidc/callback`,
      scopes: ['openid', 'profile'],
      clientAuthMethod: 'none',
      allowInsecureIssuer: true,
      administratorGroup: '',
    }
    const invalidBodies: unknown[] = [
      { ...base, allowInsecureIssuer: 'yes' },
      { ...base, issuer: 'not a url' },
      { ...base, issuer: 'https://user@id.example.test/oidc' },
      { ...base, issuer: 'https://id.example.test/oidc?query=yes' },
      { ...base, issuer: 'https://id.example.test/oidc#fragment' },
      { ...base, issuer: 'http://id.example.test/oidc', allowInsecureIssuer: false },
      { ...base, redirectUri: `${origin}/wrong-callback` },
      { ...base, clientId: '' },
      { ...base, clientId: 'x'.repeat(257) },
      { ...base, scopes: 'openid' },
      { ...base, scopes: ['openid', 1] },
      { ...base, scopes: [] },
      { ...base, scopes: Array.from({ length: 17 }, (_, index) => `scope${String(index)}`) },
      { ...base, scopes: ['openid', 'bad scope'] },
      { ...base, scopes: ['profile'] },
      { ...base, clientAuthMethod: 'unsupported' },
      { ...base, administratorGroup: 'admin group' },
      { ...base, administratorGroup: 'x'.repeat(129) },
      { ...base, enabled: 'yes' },
      { ...base, clientSecret: '' },
      { ...base, clientSecret: 'x'.repeat(4097) },
      { ...base, clientSecret: 'public-clients-have-no-secret' },
    ]
    for (const body of invalidBodies) {
      const response = await fetch(`${origin}/auth/system/oidc`, {
        method: 'PUT',
        headers: jsonHeaders(origin, adminCookie),
        body: JSON.stringify(body),
      })
      expect(response.status, JSON.stringify(body).slice(0, 200)).toBe(400)
    }

    const publicClient = await fetch(`${origin}/auth/system/oidc`, {
      method: 'PUT',
      headers: jsonHeaders(origin, adminCookie),
      body: JSON.stringify(base),
    })
    expect(publicClient.status).toBe(200)
    expect(await publicClient.json()).toMatchObject({
      oidc: { enabled: false, clientSecretConfigured: false, settings: { clientAuthMethod: 'none' } },
    })
    expect((await fetch(`${origin}/auth/oidc/start`, { redirect: 'manual' })).headers.get('location')).toContain('oidc_error=unavailable')

    const disabledConfidential = await fetch(`${origin}/auth/system/oidc`, {
      method: 'PUT',
      headers: jsonHeaders(origin, adminCookie),
      body: JSON.stringify({ ...base, clientAuthMethod: 'client_secret_basic' }),
    })
    expect(disabledConfidential.status).toBe(200)
    expect((await fetch(`${origin}/auth/system/oidc/test`, {
      method: 'POST',
      headers: jsonHeaders(origin, adminCookie),
      body: '{}',
    })).status).toBe(400)
    expect((await fetch(`${origin}/auth/system/oidc`, {
      method: 'PUT',
      headers: jsonHeaders(origin, adminCookie),
      body: JSON.stringify({ ...base, enabled: true, clientAuthMethod: 'client_secret_basic' }),
    })).status).toBe(400)

    const provider = await startOidcProvider()
    const publicRuntime = {
      ...base,
      enabled: true,
      issuer: provider.issuer,
      redirectUri: `${origin}/auth/oidc/callback`,
      clientAuthMethod: 'none',
    }
    expect((await fetch(`${origin}/auth/system/oidc`, {
      method: 'PUT',
      headers: jsonHeaders(origin, adminCookie),
      body: JSON.stringify(publicRuntime),
    })).status).toBe(200)
    provider.setSupportsPkce(undefined)
    const publicTest = await fetch(`${origin}/auth/system/oidc/test`, {
      method: 'POST',
      headers: jsonHeaders(origin, adminCookie),
      body: '{}',
    })
    expect(await publicTest.json()).toMatchObject({ oidc: { ok: true, supportsPkceS256: false } })
    provider.setSupportsPkce(true)

    const secureIssuer = {
      ...publicRuntime,
      issuer: provider.issuer.replace('http:', 'https:'),
      redirectUri: `${origin.replace('http:', 'https:')}/auth/oidc/callback`,
      allowInsecureIssuer: false,
    }
    expect((await fetch(`${origin}/auth/system/oidc`, {
      method: 'PUT',
      headers: jsonHeaders(origin, adminCookie),
      body: JSON.stringify(secureIssuer),
    })).status).toBe(200)
    expect((await fetch(`${origin}/auth/system/oidc/test`, {
      method: 'POST',
      headers: jsonHeaders(origin, adminCookie),
      body: '{}',
    })).status).toBe(400)

    const confidential = {
      ...base,
      enabled: true,
      issuer: provider.issuer,
      redirectUri: `${origin}/auth/oidc/callback`,
      allowInsecureIssuer: true,
      clientAuthMethod: 'client_secret_post',
      clientSecret: 'harness-secret',
    }
    expect((await fetch(`${origin}/auth/system/oidc`, {
      method: 'PUT',
      headers: jsonHeaders(origin, adminCookie),
      body: JSON.stringify(confidential),
    })).status).toBe(200)
    expect((await fetch(`${origin}/auth/system/oidc/test`, {
      method: 'POST',
      headers: jsonHeaders(origin, adminCookie),
      body: '{}',
    })).status).toBe(200)

    expect((await fetch(`${origin}/auth/oidc/callback`, { redirect: 'manual' })).headers.get('location')).toContain('oidc_error=flow_expired')

    const start = await fetch(`${origin}/auth/oidc/start`, { redirect: 'manual' })
    const authorization = new URL(start.headers.get('location') as string)
    const state = authorization.searchParams.get('state')
    const flowCookie = start.headers.get('set-cookie')?.split(';', 1)[0]
    if (state === null || flowCookie === undefined) throw new Error('OIDC state missing')
    const denied = await fetch(`${origin}/auth/oidc/callback?error=access_denied&state=${encodeURIComponent(state)}`, {
      headers: { cookie: flowCookie },
      redirect: 'manual',
    })
    expect(denied.headers.get('location')).toContain('oidc_error=access_denied')

    const changedStart = await fetch(`${origin}/auth/oidc/start`, { redirect: 'manual' })
    const changedUrl = new URL(changedStart.headers.get('location') as string)
    const changedState = changedUrl.searchParams.get('state')
    const changedCookie = changedStart.headers.get('set-cookie')?.split(';', 1)[0]
    if (changedState === null || changedCookie === undefined) throw new Error('OIDC changed state missing')
    expect((await fetch(`${origin}/auth/oidc/callback?code=valid-code&state=${encodeURIComponent(changedState)}`, {
      headers: { cookie: 'harness_session=wrong' },
      redirect: 'manual',
    })).headers.get('location')).toContain('oidc_error=flow_expired')
    expect((await fetch(`${origin}/auth/system/oidc`, {
      method: 'PUT',
      headers: jsonHeaders(origin, adminCookie),
      body: JSON.stringify({ ...confidential, clientId: 'changed-client', clientSecret: undefined }),
    })).status).toBe(200)
    const changed = await fetch(`${origin}/auth/oidc/callback?code=valid-code&state=${encodeURIComponent(changedState)}`, {
      headers: { cookie: changedCookie },
      redirect: 'manual',
    })
    expect(changed.headers.get('location')).toContain('oidc_error=configuration_changed')
    expect((await fetch(`${origin}/auth/system/oidc`, {
      method: 'PUT',
      headers: jsonHeaders(origin, adminCookie),
      body: JSON.stringify({ ...confidential, clientAuthMethod: 'client_secret_basic', clientSecret: undefined }),
    })).status).toBe(200)

    const failingStart = await fetch(`${origin}/auth/oidc/start`, { redirect: 'manual' })
    const failingUrl = new URL(failingStart.headers.get('location') as string)
    const failingState = failingUrl.searchParams.get('state')
    const failingCookie = failingStart.headers.get('set-cookie')?.split(';', 1)[0]
    if (failingState === null || failingCookie === undefined) throw new Error('OIDC failure state missing')
    const failed = await fetch(`${origin}/auth/oidc/callback?code=invalid-code&state=${encodeURIComponent(failingState)}`, {
      headers: { cookie: failingCookie },
      redirect: 'manual',
    })
    expect(failed.headers.get('location')).toContain('oidc_error=login_failed')

    const expiredStart = await fetch(`${origin}/auth/oidc/start`, { redirect: 'manual' })
    const expiredUrl = new URL(expiredStart.headers.get('location') as string)
    const expiredState = expiredUrl.searchParams.get('state')
    const expiredFlowCookie = expiredStart.headers.get('set-cookie')?.split(';', 1)[0]
    if (expiredState === null || expiredFlowCookie === undefined) throw new Error('OIDC expiry state missing')
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60 * 1000)
    const expired = await fetch(`${origin}/auth/oidc/callback?code=valid-code&state=${encodeURIComponent(expiredState)}`, {
      headers: { cookie: expiredFlowCookie },
      redirect: 'manual',
    })
    expect(expired.headers.get('location')).toContain('oidc_error=flow_expired')
    clock.mockRestore()

    const staleStart = await fetch(`${origin}/auth/oidc/start`, { redirect: 'manual' })
    expect(staleStart.status).toBe(302)
    const pruneClock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60 * 1000)
    expect((await fetch(`${origin}/auth/oidc/start`, { redirect: 'manual' })).status).toBe(302)
    pruneClock.mockRestore()

    provider.setClaims({ sub: 'oidc-minimal', groups: 'not-an-array' })
    const minimalStart = await fetch(`${origin}/auth/oidc/start`, { redirect: 'manual' })
    const minimalAuthorization = new URL(minimalStart.headers.get('location') as string)
    provider.captureAuthorization(minimalAuthorization)
    const minimalState = minimalAuthorization.searchParams.get('state')
    const minimalCookie = minimalStart.headers.get('set-cookie')?.split(';', 1)[0]
    if (minimalState === null || minimalCookie === undefined) throw new Error('OIDC minimal state missing')
    const minimal = await fetch(`${origin}/auth/oidc/callback?code=valid-code&state=${encodeURIComponent(minimalState)}`, {
      headers: { cookie: minimalCookie },
      redirect: 'manual',
    })
    expect(minimal.headers.get('location')).toBe(`${origin}/`)

    provider.setClaims({ sub: 'oidc-admin', preferred_username: 'oidc.admin', groups: ['super_admin'] })
    const adminSettings = { ...confidential, clientAuthMethod: 'client_secret_basic', administratorGroup: 'super_admin', clientSecret: undefined }
    expect((await fetch(`${origin}/auth/system/oidc`, {
      method: 'PUT',
      headers: jsonHeaders(origin, adminCookie),
      body: JSON.stringify(adminSettings),
    })).status).toBe(200)
    const oidcAdminStart = await fetch(`${origin}/auth/oidc/start`, { redirect: 'manual' })
    const oidcAdminAuthorization = new URL(oidcAdminStart.headers.get('location') as string)
    provider.captureAuthorization(oidcAdminAuthorization)
    const oidcAdminState = oidcAdminAuthorization.searchParams.get('state')
    const oidcAdminCookie = oidcAdminStart.headers.get('set-cookie')?.split(';', 1)[0]
    if (oidcAdminState === null || oidcAdminCookie === undefined) throw new Error('OIDC admin state missing')
    const oidcAdmin = await fetch(`${origin}/auth/oidc/callback?code=valid-code&state=${encodeURIComponent(oidcAdminState)}`, {
      headers: { cookie: oidcAdminCookie },
      redirect: 'manual',
    })
    const oidcAdminSession = (oidcAdmin.headers as Headers & { getSetCookie(): string[] }).getSetCookie()
      .find(value => value.startsWith('harness_session='))?.split(';', 1)[0]
    if (oidcAdminSession === undefined) throw new Error('OIDC administrator session missing')
    expect(await (await fetch(`${origin}/auth/session`, { headers: { cookie: oidcAdminSession } })).json()).toMatchObject({
      user: { username: 'oidc.admin', role: 'admin' },
    })

    let busyLocation = ''
    for (let index = 0; index < 257 && !busyLocation.includes('oidc_error=busy'); index += 1) {
      const response = await fetch(`${origin}/auth/oidc/start`, { redirect: 'manual' })
      busyLocation = response.headers.get('location') ?? ''
    }
    expect(busyLocation).toContain('oidc_error=busy')
  })

  it('honors secure cookies and the configured request limit', { timeout: 60_000 }, async () => {
    const { origin } = await boot({
      secureCookie: true,
      maxBodyBytes: 1024,
      projectFileMaxEntries: 1,
      projectFilePreviewMaxBytes: 1024,
    })
    const cookie = await localLogin(origin)
    const response = await fetch(`${origin}/auth/logout`, {
      method: 'POST',
      headers: { cookie, origin },
    })
    expect(response.headers.get('set-cookie')).toContain('Secure')
    const activeCookie = await localLogin(origin)
    expect((await fetch(`${origin}/auth/login/local`, {
      method: 'POST',
      headers: jsonHeaders(origin),
      body: JSON.stringify({ username: 'admin', password: 'x'.repeat(2048) }),
    })).status).toBe(400)

    const provider = await startOidcProvider()
    expect((await fetch(`${origin}/auth/system/oidc`, {
      method: 'PUT',
      headers: jsonHeaders(origin, activeCookie),
      body: JSON.stringify({
        enabled: true,
        issuer: provider.issuer,
        clientId: 'harness-client',
        redirectUri: `${origin}/auth/oidc/callback`,
        scopes: ['openid'],
        clientAuthMethod: 'none',
        allowInsecureIssuer: true,
        administratorGroup: '',
      }),
    })).status).toBe(200)
    const start = await fetch(`${origin}/auth/oidc/start`, { redirect: 'manual' })
    expect(start.headers.get('set-cookie')).toContain('Secure')

    const projectResponse = await fetch(`${origin}/auth/projects`, {
      method: 'POST',
      headers: jsonHeaders(origin, activeCookie),
      body: JSON.stringify({ name: 'Limited files' }),
    })
    const project = await projectResponse.json() as { project: { id: string; path: string } }
    await writeFile(join(project.project.path, 'one.txt'), 'one\n')
    await writeFile(join(project.project.path, 'two.txt'), 'two\n')
    await writeFile(join(project.project.path, 'large.txt'), 'x'.repeat(1025))
    const files = `${origin}/auth/projects/${encodeURIComponent(project.project.id)}/files`
    expect((await fetch(files, { headers: { cookie: activeCookie } })).status).toBe(400)
    const preview = new URL(`${files}/preview`)
    preview.searchParams.set('path', 'large.txt')
    expect((await fetch(preview, { headers: { cookie: activeCookie } })).status).toBe(400)
  })
})
