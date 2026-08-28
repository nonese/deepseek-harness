import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { OidcClientConfig, UserId } from '@deepseek-ai/dsh-auth'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FileAuthService, apply } from '../src/index.ts'

const roots: string[] = []
const contexts: Context[] = []

async function temporaryRoot(prefix = 'harness-auth-file-edge-'): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

async function writeDocument(root: string, filename: string, value: unknown): Promise<void> {
  const directory = join(root, 'system', 'auth')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await writeFile(join(directory, filename), `${JSON.stringify(value)}\n`, { mode: 0o600 })
}

async function bootAt(root: string, options: {
  bootstrapAdministrator?: boolean
  sessionTtlHours?: number
} = {}): Promise<Context> {
  vi.stubEnv('HARNESS_EDGE_BOOTSTRAP_PASSWORD', 'correct horse battery staple')
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(FileAuthService, {
    root,
    bootstrapPasswordEnv: 'HARNESS_EDGE_BOOTSTRAP_PASSWORD',
    sessionTtlHours: options.sessionTtlHours ?? 1,
    bootstrapAdministrator: options.bootstrapAdministrator ?? true,
  })
  return ctx
}

async function expectBootFailure(filename: string, value: unknown, message: RegExp): Promise<void> {
  const root = await temporaryRoot()
  await writeDocument(root, filename, value)
  const ctx = new Context()
  contexts.push(ctx)
  await expect(ctx.plugin(FileAuthService, { root, bootstrapAdministrator: false })).rejects.toThrow(message)
}

afterEach(async () => {
  vi.useRealTimers()
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('file authentication provider edge behavior', () => {
  it('resolves default configuration and reports a generated bootstrap password once', async () => {
    const home = await temporaryRoot('harness-auth-file-home-')
    vi.stubEnv('DSH_HOME', home)
    vi.stubEnv('HARNESS_BOOTSTRAP_PASSWORD', undefined)
    const ctx = new Context()
    contexts.push(ctx)
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})

    await ctx.plugin(FileAuthService)

    const admin = ctx.auth.listUsers()[0]
    expect(admin).toMatchObject({ username: 'admin', role: 'admin' })
    expect(warn).toHaveBeenCalledTimes(2)
    const generatedPassword = (warn.mock.calls as unknown[][])[0]?.[2]
    expect(typeof generatedPassword).toBe('string')
    const issued = await ctx.auth.loginLocal('admin', generatedPassword as string)
    expect(Date.parse(issued.principal.expiresAt) - Date.parse(issued.principal.user.lastLoginAt ?? '')).toBe(12 * 60 * 60 * 1000)
    expect(ctx.auth.oidcClientConfig()).toBeUndefined()

    const directContext = new Context()
    contexts.push(directContext)
    const direct = new FileAuthService(directContext, { root: join(home, 'direct') })
    expect(direct.userPaths('user' as UserId).root).toBe(join(home, 'direct', 'users', 'user'))
  })

  it('validates local account input and exercises administration and session revocation', async () => {
    const root = await temporaryRoot()
    const ctx = await bootAt(root)
    const missing = '00000000-0000-4000-8000-000000000000' as UserId

    expect(await ctx.auth.authenticateToken('')).toBeUndefined()
    expect(await ctx.auth.authenticateToken('missing-token')).toBeUndefined()
    expect(ctx.auth.getUser(missing)).toBeUndefined()
    await expect(ctx.auth.loginLocal('nobody', 'not the right password'))
      .rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
    await expect(ctx.auth.createLocalUser({ username: 'x', password: 'a sufficiently long password' }))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(ctx.auth.createLocalUser({ username: 'valid.user', displayName: ' ', password: 'a sufficiently long password' }))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(ctx.auth.createLocalUser({ username: 'valid.user', displayName: 'x'.repeat(81), password: 'a sufficiently long password' }))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(ctx.auth.createLocalUser({ username: 'valid.user', password: 'short' }))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(ctx.auth.createLocalUser({ username: 'valid.user', password: 'x'.repeat(1025) }))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' })

    const member = await ctx.auth.createLocalUser({
      username: 'member.user', password: 'a sufficiently long password',
    })
    expect(member).toMatchObject({ displayName: 'member.user', role: 'user' })
    expect(ctx.auth.getUser(member.id)).toEqual(member)
    await expect(ctx.auth.createLocalUser({ username: 'MEMBER.USER', password: 'a sufficiently long password' }))
      .rejects.toMatchObject({ code: 'USERNAME_CONFLICT' })
    await expect(ctx.auth.updateUser(missing, {})).rejects.toMatchObject({ code: 'USER_NOT_FOUND' })
    await expect(ctx.auth.updateUser(member.id, { displayName: '' })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(ctx.auth.updateUser(member.id, { displayName: 'x'.repeat(81) }))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(await ctx.auth.updateUser(member.id, {
      displayName: ' Member Renamed ', role: 'user', status: 'active',
    })).toMatchObject({ displayName: 'Member Renamed', role: 'user', status: 'active' })
    expect(await ctx.auth.updateUser(member.id, { role: 'admin' })).toMatchObject({ role: 'admin' })

    const first = await ctx.auth.loginLocal(member.username, 'a sufficiently long password')
    await ctx.auth.logout('missing-token')
    expect(await ctx.auth.authenticateToken(first.token)).toBeDefined()
    await ctx.auth.logout(first.token)
    expect(await ctx.auth.authenticateToken(first.token)).toBeUndefined()
    await ctx.auth.logout(first.token)

    const second = await ctx.auth.loginLocal(member.username, 'a sufficiently long password')
    await ctx.auth.revokeUserSessions(missing)
    expect(await ctx.auth.authenticateToken(second.token)).toBeDefined()
    await ctx.auth.revokeUserSessions(member.id)
    expect(await ctx.auth.authenticateToken(second.token)).toBeUndefined()
    await ctx.auth.revokeUserSessions(member.id)

    await expect(ctx.auth.resetLocalPassword(missing, 'another sufficiently long password'))
      .rejects.toMatchObject({ code: 'USER_NOT_FOUND' })
    const beforeReset = await ctx.auth.loginLocal(member.username, 'a sufficiently long password')
    await ctx.auth.resetLocalPassword(member.id, 'another sufficiently long password')
    expect(await ctx.auth.authenticateToken(beforeReset.token)).toBeUndefined()
    await expect(ctx.auth.loginLocal(member.username, 'a sufficiently long password'))
      .rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
    await expect(ctx.auth.loginLocal(member.username, 'another sufficiently long password')).resolves.toBeDefined()

    await expect(ctx.auth.setSharedDeepSeekPreference(missing, true))
      .rejects.toMatchObject({ code: 'USER_NOT_FOUND' })
    await ctx.auth.setSharedDeepSeekPreference(member.id, false)
    await ctx.auth.setSharedDeepSeekPreference(member.id, true)
    await ctx.auth.setSharedDeepSeekPreference(member.id, true)
    await ctx.auth.setSharedDeepSeekPreference(member.id, false)
    expect(ctx.auth.sharedDeepSeekPreference(member.id)).toEqual({ enabled: false })

    const secondAdmin = await ctx.auth.createLocalUser({
      username: 'second.admin', password: 'a sufficiently long password', role: 'admin',
    })
    const bootstrap = ctx.auth.listUsers().find(user => user.username === 'admin')
    if (bootstrap === undefined) throw new Error('bootstrap administrator missing')
    expect(await ctx.auth.updateUser(bootstrap.id, { role: 'user' })).toMatchObject({ role: 'user' })
    const thirdAdmin = await ctx.auth.createLocalUser({
      username: 'third.admin', password: 'a sufficiently long password', role: 'admin',
    })
    expect(await ctx.auth.updateUser(member.id, { role: 'user' })).toMatchObject({ role: 'user' })
    expect(await ctx.auth.updateUser(secondAdmin.id, { status: 'disabled' })).toMatchObject({ status: 'disabled' })
    await expect(ctx.auth.updateUser(thirdAdmin.id, { status: 'disabled' }))
      .rejects.toMatchObject({ code: 'LAST_ADMIN' })

    const auth = ctx.auth
    await ctx.fiber.dispose()
    await expect(auth.setSharedDeepSeekPreference(member.id, true)).rejects.toThrow('provider is disposed')
  })

  it('expires active sessions and rejects orphaned session owners', async () => {
    const root = await temporaryRoot()
    let ctx = await bootAt(root)
    const admin = ctx.auth.listUsers()[0]
    if (admin === undefined) throw new Error('bootstrap administrator missing')
    const issued = await ctx.auth.loginLocal('admin', 'correct horse battery staple')

    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.parse(issued.principal.expiresAt) + 1)
    expect(await ctx.auth.authenticateToken(issued.token)).toBeUndefined()
    vi.useRealTimers()

    await ctx.auth.loginLocal('admin', 'correct horse battery staple')
    await ctx.fiber.dispose()
    const sessionsFile = join(root, 'system', 'auth', 'sessions.json')
    const sessionsDocument = JSON.parse(await readFile(sessionsFile, 'utf8')) as {
      sessions: Array<{ expiresAt: string }>
    }
    for (const session of sessionsDocument.sessions) session.expiresAt = '2000-01-01T00:00:00.000Z'
    await writeDocument(root, 'sessions.json', sessionsDocument)
    ctx = await bootAt(root, { bootstrapAdministrator: false })
    expect(JSON.parse(await readFile(sessionsFile, 'utf8'))).toEqual({ version: 1, sessions: [] })

    const orphaned = await ctx.auth.loginLocal('admin', 'correct horse battery staple')
    await ctx.fiber.dispose()
    await writeDocument(root, 'users.json', { version: 1, users: [] })
    ctx = await bootAt(root, { bootstrapAdministrator: false })
    expect(await ctx.auth.authenticateToken(orphaned.token)).toBeUndefined()
  })

  it('rejects unsupported or malformed stored password records', async () => {
    const root = await temporaryRoot()
    let ctx = await bootAt(root)
    await ctx.fiber.dispose()
    const usersFile = join(root, 'system', 'auth', 'users.json')
    const document = JSON.parse(await readFile(usersFile, 'utf8')) as {
      users: Array<{ password: { algorithm: string; digest: string } }>
    }

    document.users[0]!.password.algorithm = 'unknown'
    await writeDocument(root, 'users.json', document)
    ctx = await bootAt(root, { bootstrapAdministrator: false })
    await expect(ctx.auth.loginLocal('admin', 'correct horse battery staple'))
      .rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })

    await ctx.fiber.dispose()
    document.users[0]!.password.algorithm = 'scrypt-v1'
    document.users[0]!.password.digest = 'AA'
    await writeDocument(root, 'users.json', document)
    ctx = await bootAt(root, { bootstrapAdministrator: false })
    await expect(ctx.auth.loginLocal('admin', 'correct horse battery staple'))
      .rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
  })

  it('normalizes OIDC names, adds local credentials, and rejects disabled identities', async () => {
    const root = await temporaryRoot()
    let ctx = await bootAt(root, { bootstrapAdministrator: false })
    const fallback = await ctx.auth.loginOidc({
      issuer: 'https://issuer.example.test', subject: 'fallback', displayName: ' ', administrator: false,
    })
    expect(fallback.principal.user).toMatchObject({ username: 'oidc-user', displayName: 'oidc-user' })
    const truncated = await ctx.auth.loginOidc({
      issuer: 'https://issuer.example.test', subject: 'truncated', preferredUsername: 'person',
      displayName: '名'.repeat(90), administrator: false,
    })
    expect(Array.from(truncated.principal.user.displayName)).toHaveLength(80)
    const preferred = await ctx.auth.loginOidc({
      issuer: 'https://issuer.example.test', subject: 'preferred', preferredUsername: 'preferred.user',
      administrator: false,
    })
    expect(preferred.principal.user.displayName).toBe('preferred.user')
    const unnamed = await ctx.auth.loginOidc({
      issuer: 'https://issuer.example.test', subject: 'unnamed', administrator: false,
    })
    expect(unnamed.principal.user.displayName).toBe(unnamed.principal.user.username)
    await ctx.auth.resetLocalPassword(fallback.principal.user.id, 'an OIDC replacement password')
    await expect(ctx.auth.loginLocal(fallback.principal.user.username, 'an OIDC replacement password'))
      .resolves.toBeDefined()

    const local = await ctx.auth.createLocalUser({
      username: 'linked.local', password: 'a sufficiently long password',
    })
    await ctx.fiber.dispose()
    await writeDocument(root, 'oidc.json', {
      version: 1,
      identities: [{ issuer: 'https://issuer.example.test', subject: 'linked', userId: local.id }],
    })
    ctx = await bootAt(root, { bootstrapAdministrator: false })
    const linked = await ctx.auth.loginOidc({
      issuer: 'https://issuer.example.test', subject: 'linked', administrator: false,
    })
    expect(linked.principal.user.authMethods).toEqual(['local', 'oidc'])
    await ctx.auth.updateUser(local.id, { status: 'disabled' })
    await expect(ctx.auth.loginOidc({
      issuer: 'https://issuer.example.test', subject: 'linked', administrator: false,
    })).rejects.toMatchObject({ code: 'USER_DISABLED' })

    await ctx.auth.updateUser(local.id, { status: 'active' })
    await ctx.auth.resetLocalPassword(local.id, 'a replacement long password')
    await expect(ctx.auth.loginLocal('linked.local', 'a replacement long password')).resolves.toBeDefined()
  })

  it('fails when every deterministic OIDC username is occupied', async () => {
    const root = await temporaryRoot()
    const issuer = 'https://issuer.example.test'
    const subject = 'collision-subject'
    const digest = createHash('sha256').update(`${issuer}\0${subject}`).digest('hex')
    const base = 'oidc-user'
    const usernames = [base, ...[8, 12, 16, 24, 32, 40, 48, 56, 60]
      .map(length => `${Array.from(base).slice(0, 63 - length).join('')}-${digest.slice(0, length)}`)]
    await writeDocument(root, 'users.json', {
      version: 1,
      users: usernames.map((username, index) => ({
        id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        username,
        normalizedUsername: username,
        displayName: username,
        role: 'user',
        status: 'active',
        authMethods: ['oidc'],
        createdAt: '2026-08-29T00:00:00.000Z',
      })),
    })
    const ctx = await bootAt(root, { bootstrapAdministrator: false })
    await expect(ctx.auth.loginOidc({ issuer, subject, preferredUsername: '!', administrator: false }))
      .rejects.toThrow('unable to allocate a unique OIDC username')
  })

  it('accepts every supported stored OIDC client authentication method', async () => {
    const base: OidcClientConfig = {
      enabled: true,
      issuer: 'https://issuer.example.test',
      clientId: 'harness',
      redirectUri: 'https://harness.example.test/auth/oidc/callback',
      scopes: ['openid'],
      clientAuthMethod: 'client_secret_basic',
      allowInsecureIssuer: false,
      administratorGroup: 'admins',
    }
    for (const clientAuthMethod of ['client_secret_post', 'none'] as const) {
      const root = await temporaryRoot()
      await writeDocument(root, 'oidc.json', {
        version: 1, identities: [], config: { ...base, clientAuthMethod },
      })
      const ctx = await bootAt(root, { bootstrapAdministrator: false })
      expect(ctx.auth.oidcClientConfig()?.clientAuthMethod).toBe(clientAuthMethod)
    }
  })

  it('rejects incompatible or invalid durable documents', async () => {
    await expectBootFailure('users.json', { version: 2, users: [] }, /unsupported on-disk format/)
    await expectBootFailure('sessions.json', { version: 2, sessions: [] }, /unsupported on-disk format/)
    await expectBootFailure('preferences.json', { version: 2, sharedDeepSeekUserIds: [] }, /unsupported on-disk format/)
    await expectBootFailure('preferences.json', { version: 1, sharedDeepSeekUserIds: 'invalid' }, /invalid preferences/)
    await expectBootFailure('preferences.json', { version: 1, sharedDeepSeekUserIds: [1] }, /invalid preferences/)
    await expectBootFailure('oidc.json', { version: 2, identities: [] }, /unsupported OIDC document/)
    await expectBootFailure('oidc.json', { version: 1, identities: 'invalid' }, /unsupported OIDC document/)
    await expectBootFailure('oidc.json', {
      version: 1, identities: [{ issuer: 1, subject: 'subject', userId: 'user' }],
    }, /invalid OIDC identity/)
    await expectBootFailure('oidc.json', {
      version: 1, identities: [{ issuer: 'issuer', subject: 1, userId: 'user' }],
    }, /invalid OIDC identity/)
    await expectBootFailure('oidc.json', {
      version: 1, identities: [{ issuer: 'issuer', subject: 'subject', userId: 1 }],
    }, /invalid OIDC identity/)
    const identity = { issuer: 'issuer', subject: 'subject', userId: 'user' }
    await expectBootFailure('oidc.json', { version: 1, identities: [identity, identity] }, /duplicate OIDC/)
    await expectBootFailure('oidc.json', { version: 1, identities: [identity] }, /references a missing user/)

    const validConfig: Record<string, unknown> = {
      enabled: true,
      issuer: 'https://issuer.example.test',
      clientId: 'harness',
      redirectUri: 'https://harness.example.test/auth/oidc/callback',
      scopes: ['openid'],
      clientAuthMethod: 'client_secret_basic',
      allowInsecureIssuer: false,
      administratorGroup: 'admins',
    }
    const invalidConfigs: Array<Record<string, unknown>> = [
      { ...validConfig, enabled: 'yes' },
      { ...validConfig, issuer: 1 },
      { ...validConfig, clientId: 1 },
      { ...validConfig, redirectUri: 1 },
      { ...validConfig, scopes: 'openid' },
      { ...validConfig, scopes: [1] },
      { ...validConfig, clientAuthMethod: 'private_key_jwt' },
      { ...validConfig, allowInsecureIssuer: 'no' },
      { ...validConfig, administratorGroup: 1 },
    ]
    for (const config of invalidConfigs) {
      await expectBootFailure('oidc.json', { version: 1, identities: [], config }, /invalid OIDC client configuration/)
    }

    const malformedRoot = await temporaryRoot()
    const directory = join(malformedRoot, 'system', 'auth')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'users.json'), '{', { mode: 0o600 })
    const malformedContext = new Context()
    contexts.push(malformedContext)
    await expect(malformedContext.plugin(FileAuthService, {
      root: malformedRoot, bootstrapAdministrator: false,
    })).rejects.toBeInstanceOf(SyntaxError)
  })

  it('exposes the plugin entrypoint with its default configuration', () => {
    const plugin = vi.fn()
    apply({ plugin } as never)
    expect(plugin).toHaveBeenCalledWith(FileAuthService, {})
  })
})
