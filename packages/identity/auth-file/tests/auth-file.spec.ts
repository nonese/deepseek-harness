import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { FileAuthService } from '../src/index.ts'

let root: string | undefined
let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  vi.unstubAllEnvs()
})

async function boot(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'harness-auth-file-'))
  vi.stubEnv('HARNESS_TEST_BOOTSTRAP_PASSWORD', 'correct horse battery staple')
  ctx = new Context()
  await ctx.plugin(FileAuthService, {
    root,
    bootstrapUsername: 'admin',
    bootstrapPasswordEnv: 'HARNESS_TEST_BOOTSTRAP_PASSWORD',
    sessionTtlHours: 1,
  })
  return ctx
}

describe('file authentication provider', () => {
  it('persists desktop devices and enforces account and revocation state', async () => {
    const loaded = await boot()
    const administrator = loaded.auth.listUsers()[0]
    expect(administrator).toBeDefined()
    const device = await loaded.auth.registerDesktopDevice({
      userId: administrator!.id,
      label: 'Office PC',
      appVersion: '0.1.2-alpha.2',
      signaturePublicJwk: { kty: 'OKP', crv: 'Ed25519', x: 'signature-public' },
      encryptionPublicJwk: { kty: 'OKP', crv: 'X25519', x: 'encryption-public' },
    })
    const expiresAt = new Date(Date.now() + 60_000).toISOString()
    await loaded.auth.touchDesktopDevice(device.id, expiresAt)
    expect(loaded.auth.getDesktopDevice(device.id)).toMatchObject({
      label: 'Office PC', leaseExpiresAt: expiresAt,
    })

    await loaded.fiber.dispose()
    ctx = new Context()
    await ctx.plugin(FileAuthService, {
      root: root as string,
      bootstrapPasswordEnv: 'HARNESS_TEST_BOOTSTRAP_PASSWORD',
      sessionTtlHours: 1,
    })
    expect(ctx.auth.getDesktopDevice(device.id)).toMatchObject({ id: device.id, userId: administrator!.id })
    await ctx.auth.revokeDesktopDevice(device.id)
    await expect(ctx.auth.touchDesktopDevice(device.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('can provide an empty service for a closed runtime that supplies no login surface', async () => {
    root = await mkdtemp(join(tmpdir(), 'harness-auth-file-empty-'))
    ctx = new Context()
    await ctx.plugin(FileAuthService, { root, bootstrapAdministrator: false })
    expect(ctx.auth.listUsers()).toEqual([])
    await expect(readFile(join(root, 'system', 'auth', 'users.json'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('bootstraps one administrator, stores owner-only files, and authenticates opaque sessions', async () => {
    const loaded = await boot()
    expect(loaded.auth.listUsers()).toMatchObject([{ username: 'admin', role: 'admin', status: 'active' }])
    await expect(loaded.auth.loginLocal('admin', 'wrong password'))
      .rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })

    const issued = await loaded.auth.loginLocal('ADMIN', 'correct horse battery staple')
    expect(issued.token).not.toContain(issued.principal.user.id)
    expect((await loaded.auth.authenticateToken(issued.token))?.user.username).toBe('admin')

    const usersFile = join(root as string, 'system', 'auth', 'users.json')
    const sessionsFile = join(root as string, 'system', 'auth', 'sessions.json')
    expect(await readFile(usersFile, 'utf8')).not.toContain('correct horse battery staple')
    expect(await readFile(sessionsFile, 'utf8')).not.toContain(issued.token)
    if (process.platform !== 'win32') {
      expect((await stat(usersFile)).mode & 0o777).toBe(0o600)
      expect((await stat(sessionsFile)).mode & 0o777).toBe(0o600)
      expect((await stat(loaded.auth.userPaths(issued.principal.user.id).projects)).mode & 0o777).toBe(0o700)
    }
  })

  it('creates isolated UUID roots and revokes sessions when a user is disabled', async () => {
    const loaded = await boot()
    const user = await loaded.auth.createLocalUser({
      username: 'lin.xi', displayName: '林溪', password: 'a sufficiently long password', role: 'user',
    })
    const paths = loaded.auth.userPaths(user.id)
    expect(paths.root).toContain(String(user.id))
    expect(paths.root).not.toContain(user.username)
    const issued = await loaded.auth.loginLocal('lin.xi', 'a sufficiently long password')
    expect(await loaded.auth.authenticateToken(issued.token)).toBeDefined()
    await loaded.auth.updateUser(user.id, { status: 'disabled' })
    expect(await loaded.auth.authenticateToken(issued.token)).toBeUndefined()
    await expect(loaded.auth.loginLocal('lin.xi', 'a sufficiently long password'))
      .rejects.toMatchObject({ code: 'USER_DISABLED' })
  })

  it('persists OIDC settings and binds immutable issuer subjects without taking over local usernames', async () => {
    const loaded = await boot()
    const settings = {
      enabled: true,
      issuer: 'https://identity.example.test/api/oidc',
      clientId: 'harness-test',
      redirectUri: 'https://harness.example.test/auth/oidc/callback',
      scopes: ['openid', 'profile', 'email', 'groups'],
      clientAuthMethod: 'client_secret_basic' as const,
      allowInsecureIssuer: false,
      administratorGroup: 'super_admin',
    }
    await loaded.auth.setOidcClientConfig(settings)
    expect(loaded.auth.oidcClientConfig()).toEqual(settings)

    const first = await loaded.auth.loginOidc({
      issuer: settings.issuer,
      subject: 'external-user-1',
      preferredUsername: 'admin',
      displayName: '外部普通用户',
      administrator: false,
    })
    expect(first.principal.method).toBe('oidc')
    expect(first.principal.user).toMatchObject({ role: 'user', authMethods: ['oidc'] })
    expect(first.principal.user.username).toMatch(/^admin-[a-f0-9]{8}$/)
    expect(first.principal.user.id).not.toBe(loaded.auth.listUsers()[0]?.id)

    const repeated = await loaded.auth.loginOidc({
      issuer: settings.issuer,
      subject: 'external-user-1',
      preferredUsername: 'renamed-by-idp',
      displayName: '更新后的名称',
      administrator: true,
    })
    expect(repeated.principal.user).toMatchObject({
      id: first.principal.user.id,
      username: first.principal.user.username,
      displayName: '更新后的名称',
      role: 'user',
    })
    const externalAdmin = await loaded.auth.loginOidc({
      issuer: settings.issuer,
      subject: 'external-admin-1',
      preferredUsername: 'oidc.admin',
      displayName: '企业管理员',
      administrator: true,
    })
    expect(externalAdmin.principal.user).toMatchObject({ role: 'admin', authMethods: ['oidc'] })

    const oidcFile = join(root as string, 'system', 'auth', 'oidc.json')
    const persisted = JSON.parse(await readFile(oidcFile, 'utf8')) as Record<string, unknown>
    expect(persisted).toMatchObject({
      version: 1,
      config: settings,
      identities: [
        { issuer: settings.issuer, subject: 'external-user-1', userId: first.principal.user.id },
        { issuer: settings.issuer, subject: 'external-admin-1', userId: externalAdmin.principal.user.id },
      ],
    })
    expect(await readFile(oidcFile, 'utf8')).not.toContain('client-secret')
    if (process.platform !== 'win32') expect((await stat(oidcFile)).mode & 0o777).toBe(0o600)

    await loaded.fiber.dispose()
    ctx = new Context()
    await ctx.plugin(FileAuthService, {
      root: root as string,
      bootstrapPasswordEnv: 'HARNESS_TEST_BOOTSTRAP_PASSWORD',
      sessionTtlHours: 1,
    })
    const afterRestart = await ctx.auth.loginOidc({
      issuer: settings.issuer,
      subject: 'external-user-1',
      preferredUsername: 'another-name',
      administrator: false,
    })
    expect(afterRestart.principal.user.id).toBe(first.principal.user.id)
  })

  it('keeps at least one active administrator', async () => {
    const loaded = await boot()
    const admin = loaded.auth.listUsers()[0]
    if (admin === undefined) throw new Error('bootstrap administrator missing')
    await expect(loaded.auth.updateUser(admin.id, { role: 'user' }))
      .rejects.toMatchObject({ code: 'LAST_ADMIN' })
  })

  it('persists the shared DeepSeek choice and resolves project ownership by stable user id', async () => {
    const loaded = await boot()
    const user = await loaded.auth.createLocalUser({
      username: 'model.user', password: 'a sufficiently long password', role: 'user',
    })
    const nestedProject = join(loaded.auth.userPaths(user.id).projects, 'project-a', 'src')
    await mkdir(nestedProject, { recursive: true })

    expect(loaded.auth.sharedDeepSeekPreference(user.id)).toEqual({ enabled: false })
    expect(loaded.auth.ownerForProjectPath(nestedProject)).toMatchObject({ id: user.id, username: 'model.user' })
    expect(loaded.auth.ownerForProjectPath(join(root as string, 'outside'))).toBeUndefined()

    await loaded.auth.setSharedDeepSeekPreference(user.id, true)
    const preferencesFile = join(root as string, 'system', 'auth', 'preferences.json')
    expect(JSON.parse(await readFile(preferencesFile, 'utf8'))).toEqual({
      version: 1,
      sharedDeepSeekUserIds: [user.id],
    })
    if (process.platform !== 'win32') expect((await stat(preferencesFile)).mode & 0o777).toBe(0o600)

    await loaded.fiber.dispose()
    ctx = new Context()
    await ctx.plugin(FileAuthService, {
      root: root as string,
      bootstrapPasswordEnv: 'HARNESS_TEST_BOOTSTRAP_PASSWORD',
      sessionTtlHours: 1,
    })
    expect(ctx.auth.sharedDeepSeekPreference(user.id)).toEqual({ enabled: true })
  })

  it.skipIf(process.platform === 'win32')('refuses an authentication file readable by another OS user', async () => {
    root = await mkdtemp(join(tmpdir(), 'harness-auth-file-wide-'))
    const authRoot = join(root, 'system', 'auth')
    await mkdir(authRoot, { recursive: true })
    await writeFile(join(authRoot, 'users.json'), '{"version":1,"users":[]}', { mode: 0o644 })
    ctx = new Context()
    await expect(ctx.plugin(FileAuthService, { root })).rejects.toThrow(/readable beyond its owner/)
  })
})
