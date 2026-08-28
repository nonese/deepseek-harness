/**
 * Owner-only JSON authentication provider for the Harness server.
 * @module @deepseek-ai/dsh-auth-file
 */

import { createHash, randomBytes, randomUUID, scrypt as nodeScrypt, timingSafeEqual } from 'node:crypto'
import { chmod, mkdir, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import {
  AuthError,
  AuthService,
  managedPathContains,
  type AuthMethod,
  type AuthPrincipal,
  type AuthUser,
  type CreateLocalUserInput,
  type IssuedAuthSession,
  type OidcClientAuthMethod,
  type OidcClientConfig,
  type OidcLoginInput,
  type UpdateUserInput,
  type UserId,
  type UserPaths,
} from '@deepseek-ai/dsh-auth'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

const FORMAT_VERSION = 1
const PASSWORD_KEY_BYTES = 32
const PASSWORD_SALT_BYTES = 16
const SESSION_TOKEN_BYTES = 32
const SCRYPT_N = 16_384
const SCRYPT_R = 8
const SCRYPT_P = 1
const MIN_PASSWORD_LENGTH = 10
const USERNAME_PATTERN = /^[\p{L}\p{N}._-]{3,64}$/u

interface PasswordRecord {
  algorithm: string
  salt: string
  digest: string
}

interface StoredUser extends Omit<AuthUser, 'authMethods'> {
  normalizedUsername: string
  authMethods: AuthMethod[]
  password?: PasswordRecord
}

interface StoredSession {
  id: string
  tokenDigest: string
  userId: UserId
  method: AuthMethod
  createdAt: string
  expiresAt: string
}

interface UsersDocument {
  version: number
  users: StoredUser[]
}

interface SessionsDocument {
  version: number
  sessions: StoredSession[]
}

interface PreferencesDocument {
  version: number
  sharedDeepSeekUserIds: string[]
}

interface StoredOidcIdentity {
  issuer: string
  subject: string
  userId: UserId
}

interface OidcDocument {
  version: number
  config?: OidcClientConfig
  identities: StoredOidcIdentity[]
}

/** File-provider configuration. */
export interface Config {
  /** Server data root. Defaults to `<DSH_HOME>/server`. */
  root?: string
  /** Local browser-session lifetime. Defaults to 12 hours. */
  sessionTtlHours?: number
  /** Initial administrator username when the user file is absent. */
  bootstrapUsername?: string
  /** Environment variable carrying the initial administrator password. */
  bootstrapPasswordEnv?: string
  /** Create the initial administrator when storage has no users. Defaults to true. */
  bootstrapAdministrator?: boolean
}

interface ResolvedConfig {
  root: string
  sessionTtlMs: number
  bootstrapUsername: string
  bootstrapPasswordEnv: string
  bootstrapAdministrator: boolean
}

/** Stable Cordis plugin name. */
export const name = 'auth-file'

/** No provider prerequisites. */
export const inject: string[] = []

function resolvedConfig(config: Config): ResolvedConfig {
  return {
    root: resolve(config.root ?? join(resolveDshHome(), 'server')),
    sessionTtlMs: (config.sessionTtlHours ?? 12) * 60 * 60 * 1000,
    bootstrapUsername: config.bootstrapUsername ?? 'admin',
    bootstrapPasswordEnv: config.bootstrapPasswordEnv ?? 'HARNESS_BOOTSTRAP_PASSWORD',
    bootstrapAdministrator: config.bootstrapAdministrator ?? true,
  }
}

function normalizeUsername(username: string): string {
  return username.normalize('NFKC').trim().toLocaleLowerCase('en-US')
}

function normalizeDisplayName(displayName: string, fallback: string): string {
  const normalized = displayName.normalize('NFKC').trim()
  if (normalized.length === 0) return fallback
  return Array.from(normalized).slice(0, 80).join('')
}

function oidcUsername(users: readonly StoredUser[], input: OidcLoginInput): string {
  const preferred = (input.preferredUsername ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
  const base = USERNAME_PATTERN.test(preferred) ? preferred : 'oidc-user'
  if (!users.some(user => user.normalizedUsername === normalizeUsername(base))) return base
  const digest = createHash('sha256').update(`${input.issuer}\0${input.subject}`).digest('hex')
  for (const suffixLength of [8, 12, 16, 24, 32, 40, 48, 56, 60]) {
    const suffix = digest.slice(0, suffixLength)
    const candidate = `${Array.from(base).slice(0, 63 - suffix.length).join('')}-${suffix}`
    if (!users.some(user => user.normalizedUsername === normalizeUsername(candidate))) return candidate
  }
  throw new Error('auth-file: unable to allocate a unique OIDC username')
}

function isOidcClientAuthMethod(value: unknown): value is OidcClientAuthMethod {
  return value === 'client_secret_basic' || value === 'client_secret_post' || value === 'none'
}

function assertOidcDocument(value: OidcDocument): void {
  if (value.version !== FORMAT_VERSION || !Array.isArray(value.identities)) {
    throw new Error('auth-file: unsupported OIDC document format')
  }
  const keys = new Set<string>()
  for (const identity of value.identities) {
    if (typeof identity.issuer !== 'string' || typeof identity.subject !== 'string'
      || typeof identity.userId !== 'string') {
      throw new Error('auth-file: invalid OIDC identity document')
    }
    const key = `${identity.issuer}\0${identity.subject}`
    if (keys.has(key)) throw new Error('auth-file: duplicate OIDC identity binding')
    keys.add(key)
  }
  const config = value.config
  if (config === undefined) return
  if (typeof config.enabled !== 'boolean' || typeof config.issuer !== 'string'
    || typeof config.clientId !== 'string' || typeof config.redirectUri !== 'string'
    || !Array.isArray(config.scopes) || config.scopes.some(scope => typeof scope !== 'string')
    || !isOidcClientAuthMethod(config.clientAuthMethod)
    || typeof config.allowInsecureIssuer !== 'boolean'
    || typeof config.administratorGroup !== 'string') {
    throw new Error('auth-file: invalid OIDC client configuration')
  }
}

function validateUsername(username: string): string {
  const normalized = username.normalize('NFKC').trim()
  if (!USERNAME_PATTERN.test(normalized)) {
    throw new AuthError('INVALID_INPUT', '用户名必须为 3–64 个字母、数字、点、下划线或短横线')
  }
  return normalized
}

function validatePassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH || password.length > 1024) {
    throw new AuthError('INVALID_INPUT', `密码长度必须为 ${String(MIN_PASSWORD_LENGTH)}–1024 个字符`)
  }
}

function scrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolveScrypt, reject) => {
    nodeScrypt(password, salt, PASSWORD_KEY_BYTES, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: 64 * 1024 * 1024,
    }, (error, derivedKey) => {
      if (error !== null) reject(error)
      else resolveScrypt(derivedKey)
    })
  })
}

function encodeBase64Url(value: Uint8Array): string {
  return Buffer.from(value).toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '')
}

function decodeBase64Url(value: string): Buffer {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
  const padding = (4 - (base64.length % 4)) % 4
  return Buffer.from(`${base64}${'='.repeat(padding)}`, 'base64')
}

async function hashPassword(password: string): Promise<PasswordRecord> {
  validatePassword(password)
  const salt = randomBytes(PASSWORD_SALT_BYTES)
  const digest = await scrypt(password, salt)
  return {
    algorithm: 'scrypt-v1',
    salt: encodeBase64Url(salt),
    digest: encodeBase64Url(digest),
  }
}

async function verifyPassword(password: string, stored: PasswordRecord): Promise<boolean> {
  if (stored.algorithm !== 'scrypt-v1') return false
  const expected = decodeBase64Url(stored.digest)
  const actual = await scrypt(password, decodeBase64Url(stored.salt))
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function publicUser(user: StoredUser): AuthUser {
  const { normalizedUsername: _normalizedUsername, password: _password, ...visible } = user
  return structuredClone(visible)
}

function isENOENT(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

async function readJson<T>(filename: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filename, 'utf8')) as T
  } catch (error) {
    if (isENOENT(error)) return fallback
    throw error
  }
}

async function assertPrivateFile(filename: string): Promise<void> {
  if (process.platform === 'win32') return
  try {
    const mode = (await stat(filename)).mode & 0o777
    if ((mode & 0o077) !== 0) {
      throw new Error(`auth-file: ${filename} is readable beyond its owner (mode ${mode.toString(8)})`)
    }
  } catch (error) {
    if (!isENOENT(error)) throw error
  }
}

/** File-backed authentication service. */
export class FileAuthService extends AuthService {
  static Config: z<Config> = z.object({
    root: z.string(),
    sessionTtlHours: z.number().min(1).max(24 * 30).default(12),
    bootstrapUsername: z.string().default('admin'),
    bootstrapPasswordEnv: z.string().default('HARNESS_BOOTSTRAP_PASSWORD'),
    bootstrapAdministrator: z.boolean().default(true),
  })

  private readonly spec: ResolvedConfig
  private users: StoredUser[] = []
  private sessions: StoredSession[] = []
  private sharedDeepSeekUserIds = new Set<UserId>()
  private oidcConfig: OidcClientConfig | undefined
  private oidcIdentities: StoredOidcIdentity[] = []
  private writes: Promise<void> = Promise.resolve()
  private closed = false

  constructor(ctx: Context, config: Config = {}) {
    super(ctx)
    this.spec = resolvedConfig(config)
  }

  private get systemRoot(): string {
    return join(this.spec.root, 'system', 'auth')
  }

  private get usersFile(): string {
    return join(this.systemRoot, 'users.json')
  }

  private get sessionsFile(): string {
    return join(this.systemRoot, 'sessions.json')
  }

  private get preferencesFile(): string {
    return join(this.systemRoot, 'preferences.json')
  }

  private get oidcFile(): string {
    return join(this.systemRoot, 'oidc.json')
  }

  async* [Service.init](): AsyncGenerator<() => Promise<void>, void, void> {
    yield async () => {
      this.closed = true
      await this.writes
    }
    await mkdir(this.systemRoot, { recursive: true, mode: 0o700 })
    if (process.platform !== 'win32') await chmod(this.systemRoot, 0o700)
    await Promise.all([
      assertPrivateFile(this.usersFile),
      assertPrivateFile(this.sessionsFile),
      assertPrivateFile(this.preferencesFile),
      assertPrivateFile(this.oidcFile),
    ])
    const usersDocument = await readJson<UsersDocument>(this.usersFile, { version: FORMAT_VERSION, users: [] })
    const sessionsDocument = await readJson<SessionsDocument>(this.sessionsFile, { version: FORMAT_VERSION, sessions: [] })
    const preferencesDocument = await readJson<PreferencesDocument>(this.preferencesFile, {
      version: FORMAT_VERSION,
      sharedDeepSeekUserIds: [],
    })
    const oidcDocument = await readJson<OidcDocument>(this.oidcFile, {
      version: FORMAT_VERSION,
      identities: [],
    })
    if (usersDocument.version !== FORMAT_VERSION
      || sessionsDocument.version !== FORMAT_VERSION
      || preferencesDocument.version !== FORMAT_VERSION) {
      throw new Error('auth-file: unsupported on-disk format version')
    }
    assertOidcDocument(oidcDocument)
    if (!Array.isArray(preferencesDocument.sharedDeepSeekUserIds)
      || preferencesDocument.sharedDeepSeekUserIds.some(value => typeof value !== 'string')) {
      throw new Error('auth-file: invalid preferences document')
    }
    this.users = usersDocument.users
    this.sessions = sessionsDocument.sessions
    this.sharedDeepSeekUserIds = new Set(preferencesDocument.sharedDeepSeekUserIds as UserId[])
    this.oidcConfig = oidcDocument.config === undefined ? undefined : structuredClone(oidcDocument.config)
    this.oidcIdentities = oidcDocument.identities
    if (this.oidcIdentities.some(identity => !this.users.some(user => user.id === identity.userId))) {
      throw new Error('auth-file: OIDC identity references a missing user')
    }
    await this.removeExpiredSessions()
    if (this.users.length === 0 && this.spec.bootstrapAdministrator) await this.bootstrapAdministrator()
    await Promise.all(this.users.map(user => this.ensureUserPaths(user.id)))
  }

  override async authenticateToken(token: string): Promise<AuthPrincipal | undefined> {
    if (token.length === 0) return undefined
    const tokenDigest = this.digestToken(token)
    const session = this.sessions.find(candidate => candidate.tokenDigest === tokenDigest)
    if (session === undefined) return undefined
    if (Date.parse(session.expiresAt) <= Date.now()) {
      await this.enqueue(async () => {
        this.sessions = this.sessions.filter(candidate => candidate.id !== session.id)
        await this.persistSessions()
      })
      return undefined
    }
    const user = this.users.find(candidate => candidate.id === session.userId)
    if (user === undefined || user.status !== 'active') return undefined
    return this.principal(user, session)
  }

  override async loginLocal(username: string, password: string): Promise<IssuedAuthSession> {
    const normalized = normalizeUsername(username)
    const user = this.users.find(candidate => candidate.normalizedUsername === normalized)
    const passwordRecord = user?.password
    let valid = false
    if (passwordRecord !== undefined) valid = await verifyPassword(password, passwordRecord)
    else await scrypt(password, randomBytes(PASSWORD_SALT_BYTES))
    if (!valid || user === undefined) {
      throw new AuthError('INVALID_CREDENTIALS', '用户名或密码不正确')
    }
    if (user.status !== 'active') throw new AuthError('USER_DISABLED', '此账号已被停用')
    const token = encodeBase64Url(randomBytes(SESSION_TOKEN_BYTES))
    const now = new Date()
    const storedSession: StoredSession = {
      id: randomUUID(),
      tokenDigest: this.digestToken(token),
      userId: user.id,
      method: 'local',
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.spec.sessionTtlMs).toISOString(),
    }
    await this.enqueue(async () => {
      user.lastLoginAt = now.toISOString()
      this.sessions.push(storedSession)
      await Promise.all([this.persistUsers(), this.persistSessions()])
    })
    await this.ensureUserPaths(user.id)
    return { token, principal: this.principal(user, storedSession) }
  }

  override async loginOidc(input: OidcLoginInput): Promise<IssuedAuthSession> {
    const token = encodeBase64Url(randomBytes(SESSION_TOKEN_BYTES))
    const now = new Date()
    let issued: IssuedAuthSession | undefined
    await this.enqueue(async () => {
      const identity = this.oidcIdentities.find(candidate =>
        candidate.issuer === input.issuer && candidate.subject === input.subject)
      let user = identity === undefined
        ? undefined
        : this.users.find(candidate => candidate.id === identity.userId)
      if (identity !== undefined && user === undefined) {
        throw new Error('auth-file: OIDC identity references a missing user')
      }
      if (user === undefined) {
        const username = oidcUsername(this.users, input)
        user = {
          id: randomUUID() as UserId,
          username,
          normalizedUsername: normalizeUsername(username),
          displayName: normalizeDisplayName(input.displayName ?? input.preferredUsername ?? username, username),
          role: input.administrator ? 'admin' : 'user',
          status: 'active',
          authMethods: ['oidc'],
          createdAt: now.toISOString(),
        }
        this.users.push(user)
        this.oidcIdentities.push({ issuer: input.issuer, subject: input.subject, userId: user.id })
      }
      if (user.status !== 'active') throw new AuthError('USER_DISABLED', '此账号已被停用')
      if (!user.authMethods.includes('oidc')) user.authMethods = [...user.authMethods, 'oidc']
      if (input.displayName !== undefined) {
        user.displayName = normalizeDisplayName(input.displayName, user.displayName)
      }
      user.lastLoginAt = now.toISOString()
      const session: StoredSession = {
        id: randomUUID(),
        tokenDigest: this.digestToken(token),
        userId: user.id,
        method: 'oidc',
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + this.spec.sessionTtlMs).toISOString(),
      }
      this.sessions.push(session)
      await Promise.all([this.persistUsers(), this.persistSessions(), this.persistOidc()])
      issued = { token, principal: this.principal(user, session) }
    })
    if (issued === undefined) throw new Error('auth-file: OIDC login did not issue a session')
    await this.ensureUserPaths(issued.principal.user.id)
    return issued
  }

  override oidcClientConfig(): OidcClientConfig | undefined {
    return this.oidcConfig === undefined ? undefined : structuredClone(this.oidcConfig)
  }

  override setOidcClientConfig(config: OidcClientConfig): Promise<void> {
    return this.enqueue(async () => {
      this.oidcConfig = structuredClone(config)
      await this.persistOidc()
    })
  }

  override logout(token: string): Promise<void> {
    const digest = this.digestToken(token)
    return this.enqueue(async () => {
      const next = this.sessions.filter(session => session.tokenDigest !== digest)
      if (next.length === this.sessions.length) return
      this.sessions = next
      await this.persistSessions()
    })
  }

  override revokeUserSessions(userId: UserId): Promise<void> {
    return this.enqueue(async () => {
      const next = this.sessions.filter(session => session.userId !== userId)
      if (next.length === this.sessions.length) return
      this.sessions = next
      await this.persistSessions()
    })
  }

  override listUsers(): readonly AuthUser[] {
    return this.users.map(publicUser)
  }

  override getUser(userId: UserId): AuthUser | undefined {
    const user = this.users.find(candidate => candidate.id === userId)
    return user === undefined ? undefined : publicUser(user)
  }

  override async createLocalUser(input: CreateLocalUserInput): Promise<AuthUser> {
    const username = validateUsername(input.username)
    const normalizedUsername = normalizeUsername(username)
    const displayName = (input.displayName ?? username).normalize('NFKC').trim()
    if (displayName.length === 0 || displayName.length > 80) {
      throw new AuthError('INVALID_INPUT', '显示名称长度必须为 1–80 个字符')
    }
    const password = await hashPassword(input.password)
    const user: StoredUser = {
      id: randomUUID() as UserId,
      username,
      normalizedUsername,
      displayName,
      role: input.role ?? 'user',
      status: 'active',
      authMethods: ['local'],
      createdAt: new Date().toISOString(),
      password,
    }
    await this.enqueue(async () => {
      if (this.users.some(candidate => candidate.normalizedUsername === normalizedUsername)) {
        throw new AuthError('USERNAME_CONFLICT', '用户名已存在')
      }
      this.users.push(user)
      await this.persistUsers()
    })
    await this.ensureUserPaths(user.id)
    return publicUser(user)
  }

  override updateUser(userId: UserId, input: UpdateUserInput): Promise<AuthUser> {
    return this.enqueue(async () => {
      const user = this.users.find(candidate => candidate.id === userId)
      if (user === undefined) throw new AuthError('USER_NOT_FOUND', '用户不存在')
      if (input.displayName !== undefined) {
        const value = input.displayName.normalize('NFKC').trim()
        if (value.length === 0 || value.length > 80) {
          throw new AuthError('INVALID_INPUT', '显示名称长度必须为 1–80 个字符')
        }
        user.displayName = value
      }
      if (input.role !== undefined && input.role !== user.role) {
        if (user.role === 'admin' && input.role !== 'admin') this.assertAnotherActiveAdmin(user.id)
        user.role = input.role
      }
      if (input.status !== undefined && input.status !== user.status) {
        if (user.role === 'admin' && input.status === 'disabled') this.assertAnotherActiveAdmin(user.id)
        user.status = input.status
        if (input.status === 'disabled') this.sessions = this.sessions.filter(session => session.userId !== user.id)
      }
      await Promise.all([this.persistUsers(), this.persistSessions()])
      return publicUser(user)
    })
  }

  override async resetLocalPassword(userId: UserId, password: string): Promise<void> {
    const hashed = await hashPassword(password)
    await this.enqueue(async () => {
      const user = this.users.find(candidate => candidate.id === userId)
      if (user === undefined) throw new AuthError('USER_NOT_FOUND', '用户不存在')
      user.password = hashed
      if (!user.authMethods.includes('local')) user.authMethods = [...user.authMethods, 'local']
      this.sessions = this.sessions.filter(session => session.userId !== user.id)
      await Promise.all([this.persistUsers(), this.persistSessions()])
    })
  }

  override sharedDeepSeekPreference(userId: UserId): { enabled: boolean } {
    return { enabled: this.sharedDeepSeekUserIds.has(userId) }
  }

  override setSharedDeepSeekPreference(userId: UserId, enabled: boolean): Promise<void> {
    return this.enqueue(async () => {
      if (!this.users.some(candidate => candidate.id === userId)) {
        throw new AuthError('USER_NOT_FOUND', '用户不存在')
      }
      if (enabled === this.sharedDeepSeekUserIds.has(userId)) return
      if (enabled) this.sharedDeepSeekUserIds.add(userId)
      else this.sharedDeepSeekUserIds.delete(userId)
      await this.persistPreferences()
    })
  }

  override ownerForProjectPath(path: string): AuthUser | undefined {
    const owner = this.users.find(user => managedPathContains(this.userPaths(user.id).projects, path))
    return owner === undefined ? undefined : publicUser(owner)
  }

  override userPaths(userId: UserId): UserPaths {
    const root = join(this.spec.root, 'users', String(userId))
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

  override async ensureUserPaths(userId: UserId): Promise<UserPaths> {
    const paths = this.userPaths(userId)
    const directories: string[] = [
      paths.root,
      paths.projects,
      paths.state,
      paths.settings,
      paths.credentials,
      paths.sessions,
      paths.attachments,
    ]
    await Promise.all(directories.map(async (path) => {
      await mkdir(path, { recursive: true, mode: 0o700 })
      if (process.platform !== 'win32') await chmod(path, 0o700)
    }))
    return paths
  }

  private principal(user: StoredUser, session: StoredSession): AuthPrincipal {
    return {
      user: publicUser(user),
      sessionId: session.id,
      method: session.method,
      expiresAt: session.expiresAt,
    }
  }

  private digestToken(token: string): string {
    return encodeBase64Url(createHash('sha256').update(token).digest())
  }

  private async bootstrapAdministrator(): Promise<void> {
    const username = validateUsername(this.spec.bootstrapUsername)
    const configured = process.env[this.spec.bootstrapPasswordEnv]
    const password = configured ?? encodeBase64Url(randomBytes(18))
    const user: StoredUser = {
      id: randomUUID() as UserId,
      username,
      normalizedUsername: normalizeUsername(username),
      displayName: '管理员',
      role: 'admin',
      status: 'active',
      authMethods: ['local'],
      createdAt: new Date().toISOString(),
      password: await hashPassword(password),
    }
    this.users = [user]
    await this.persistUsers()
    if (configured === undefined) {
      this.ctx.logger.warn('Harness 初始管理员 %s 的一次性密码：%s', username, password)
      this.ctx.logger.warn('首次登录后请立即重置密码；也可在首次启动前设置 %s', this.spec.bootstrapPasswordEnv)
    }
  }

  private assertAnotherActiveAdmin(excluded: UserId): void {
    const count = this.users.filter(user =>
      user.id !== excluded && user.role === 'admin' && user.status === 'active').length
    if (count === 0) throw new AuthError('LAST_ADMIN', '必须至少保留一个启用的管理员账号')
  }

  private removeExpiredSessions(): Promise<void> {
    return this.enqueue(async () => {
      const now = Date.now()
      const next = this.sessions.filter(session => Date.parse(session.expiresAt) > now)
      if (next.length === this.sessions.length) return
      this.sessions = next
      await this.persistSessions()
    })
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error('auth-file: provider is disposed'))
    const task = this.writes.then(operation)
    this.writes = task.then(() => undefined, () => undefined)
    return task
  }

  private persistUsers(): Promise<void> {
    const document: UsersDocument = { version: FORMAT_VERSION, users: this.users }
    return writeFileAtomic(this.usersFile, `${JSON.stringify(document, null, 2)}\n`, {
      mode: 0o600,
      dirMode: 0o700,
    })
  }

  private persistSessions(): Promise<void> {
    const document: SessionsDocument = { version: FORMAT_VERSION, sessions: this.sessions }
    return writeFileAtomic(this.sessionsFile, `${JSON.stringify(document, null, 2)}\n`, {
      mode: 0o600,
      dirMode: 0o700,
    })
  }

  private persistPreferences(): Promise<void> {
    const document: PreferencesDocument = {
      version: FORMAT_VERSION,
      sharedDeepSeekUserIds: [...this.sharedDeepSeekUserIds],
    }
    return writeFileAtomic(this.preferencesFile, `${JSON.stringify(document, null, 2)}\n`, {
      mode: 0o600,
      dirMode: 0o700,
    })
  }

  private persistOidc(): Promise<void> {
    const document: OidcDocument = {
      version: FORMAT_VERSION,
      ...this.oidcConfig === undefined ? {} : { config: this.oidcConfig },
      identities: this.oidcIdentities,
    }
    return writeFileAtomic(this.oidcFile, `${JSON.stringify(document, null, 2)}\n`, {
      mode: 0o600,
      dirMode: 0o700,
    })
  }
}

/** Install the file-backed authentication service. */
export function apply(ctx: Context, config: Config = {}): void {
  ctx.plugin(FileAuthService, config)
}

export default FileAuthService
