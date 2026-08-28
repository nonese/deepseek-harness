# 认证与用户归属

[English](authentication.md) | 中文

[dsh-auth](../../packages/identity/auth) 定义服务端身份 seam。[dsh-auth-file](../../packages/identity/auth-file) 将用户、密码校验值、OIDC 身份绑定和可撤销的会话令牌摘要保存在仅所有者可读写的 JSON 文件中，[dsh-auth-web](../../packages/host/auth-web) 则将该 seam 映射为本地与 OIDC cookie 认证的 HTTP 路由。Web 部署从引导环境创建首位管理员，之后的所有账户变更均须由已认证的管理员执行。管理员通过系统设置配置 OIDC；本地登录继续用于测试和紧急访问。

该 seam 拥有身份与授权元数据，但不拥有项目内容。稳定的随机 `UserId` 选择一棵由程序管理的目录树；修改用户名或显示名称既不会重命名存储，也不会参与选择存储。Web 部署注册唯一的 Connection 认证器，由它校验持久 Cookie，并在请求作用域主体中运行分发；有序 Typert Gateway 中间件随后只允许访问根目录位于该主体 `projects` 目录下的会话与 workspace，并对一元结果和 stream 应用同样的投影。管理员列表仅暴露公开账户元数据，不会因此获得访问其他用户项目、会话、附件、凭据或设置的权限。

源码：[`packages/identity/auth/src/index.ts`](../../packages/identity/auth/src/index.ts)

## 稳定标识

```ts type-equiv
/** Stable, path-safe identity. Usernames and display names never select storage paths. */
type UserId = Branded<'UserId'>
```

```ts type-equiv
/** Public user record. Password material is provider-private. */
interface AuthUser {
  id: UserId
  username: string
  displayName: string
  role: UserRole
  status: UserStatus
  authMethods: readonly AuthMethod[]
  createdAt: string
  lastLoginAt?: string
}
```

系统支持 `admin` 和 `user` 两种角色。停用账户会撤销该账户的所有浏览器会话，提供方会拒绝任何将删除或停用最后一位活动管理员的变更。

## OIDC 依赖方

```ts type-equiv
/** Non-secret OIDC relying-party settings persisted by the authentication provider. */
interface OidcClientConfig {
  enabled: boolean
  issuer: string
  clientId: string
  redirectUri: string
  scopes: readonly string[]
  clientAuthMethod: OidcClientAuthMethod
  allowInsecureIssuer: boolean
  administratorGroup: string
}
```

管理员通过 `PUT /auth/system/oidc` 保存这些非敏感字段。机密客户端的密钥由 credentials 提供方另行保存在 `HARNESS_OIDC_CLIENT_SECRET` 下；系统设置响应和发现测试都不会返回该值。redirect URI 固定使用 Harness 的 `/auth/oidc/callback` 路径，并且必须在身份提供方精确登记。除非管理员显式启用纯内网 HTTP 例外，否则必须使用 HTTPS。

`GET /auth/oidc/start` 会发现提供方，创建 PKCE S256 verifier 与 challenge，并把随机 state 和 nonce 绑定到十分钟有效的临时浏览器 cookie 与进程内待完成流程。回调只消费一次该 state，交换授权码，并要求签名 ID Token 的 issuer、audience、过期时间、签发时间、nonce 与 JWKS 密钥均有效。提供方的 `groups` 声明只用于配置的首次登录管理员组判断；`perm:` 项不会成为 Harness 权限。

Web 部署把 `(issuer, sub) → UserId` 保存在 `<DSH_HOME>/system/auth/oidc.json`。这个不可变二元组是唯一的自动账号关联键。首选用户名冲突时会创建带后缀的 OIDC 用户名，而不会关联或覆盖本地账号。配置的管理员组只在新 OIDC 身份创建时选择角色；后续角色变更仍由 Harness 管理员控制。

## 统一 DeepSeek 凭据选择

```ts type-equiv
/** User-owned choice to consume the administrator-managed DeepSeek credential. */
interface SharedDeepSeekPreference {
  enabled: boolean
}
```

Web 部署会把该选择作为用户 id 元数据持久化到 `<DSH_HOME>/system/auth/preferences.json`，但绝不在此保存 Key。管理员统一 Key 仍由普通 credentials 提供方保存在 `HARNESS_SHARED_DEEPSEEK_API_KEY` 下。DeepSeek 适配器只会为实时会话路径属于活动且已启用用户的 `deepseek-official` / `deepseek-v4-flash` 调用使用该 Key；其他调用继续使用已配置的 `apiKeyEnv` 路径。

## 浏览器会话

```ts type-equiv
/** Identity carried by one authenticated request. */
interface AuthPrincipal {
  user: AuthUser
  sessionId: string
  method: AuthMethod
  expiresAt: string
}
```

```ts type-equiv
/** A newly-issued opaque browser session. Only the digest is persisted. */
interface IssuedAuthSession {
  token: string
  principal: AuthPrincipal
}
```

浏览器获得一枚不透明的 `HttpOnly`、`SameSite=Lax` cookie。只有摘要会持久化；退出登录、重置密码、停用账户和管理员显式撤销都会使服务端会话记录失效。认证失败响应不会泄露用户名是否存在。

## 由程序管理的存储

```ts type-equiv
/** Program-managed directories for one user. */
interface UserPaths {
  root: string
  projects: string
  state: string
  settings: string
  credentials: string
  sessions: string
  attachments: string
}
```

Web 部署会在 `<DSH_HOME>/users/<UserId>/` 下创建这些路径角色。应用在 `projects` 下选择项目路径；用户绝不能提供任意服务端路径。现有 Harness 持久化提供方保持不变，并写入已认证用户的根目录，因此无需引入数据库即可保留基于文件的存储模型。

## 管理员变更

```ts type-equiv
/** Input for an administrator-created local account. */
interface CreateLocalUserInput {
  username: string
  displayName?: string
  password: string
  role?: UserRole
}
```

```ts type-equiv
/** Mutable administrative user fields. */
interface UpdateUserInput {
  displayName?: string
  role?: UserRole
  status?: UserStatus
}
```

只有已认证的管理员才能列出用户，或者创建、编辑、停用及重置本地账户。重置密码会撤销目标用户的活动浏览器会话。这些操作永远不会暴露密码哈希或会话令牌摘要。

## 插件权限

部署声明的插件运行在共享 Host 进程中并影响所有用户，因此它们的配置属于管理员职责。已认证 Gateway 中间件会从普通用户的名单中移除随附的 `@deepseek-ai/cordis` preset，并拒绝普通用户使用它创建会话或选择 preset。独立的 Host 守卫还会拒绝所有 `cordis_*` 工具调用，除非调用 Agent 的受管项目路径当前属于管理员；同一 Gateway 中间件会在分发前拒绝非管理员访问 `dynamicCordisRunner/*` Remote 命名空间。这些相互独立的检查保证过期客户端、伪造请求或已打开会话无法把 UI 可见性变成权限。

在某个用户的项目内安装 npm 包只会改变该用户的项目文件。这不会把该包加载到 Cordis、注册为 Host 插件，也不会影响其他用户的运行时。只有管理员把包加入共享部署组合后，它才会影响所有用户；此时该 Host 插件成为受信任的进程全局运行时的一部分。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxauth--authservice-abstract-seam"></a>

### `ctx.auth` — `AuthService` (abstract seam)

Authentication Service Definition. Implementations must compare passwords without early exits, persist only session-token digests, and revoke every session when a user is disabled.

```ts cordis-catalog
/**
 * Read the principal established by the authenticated carrier for this async request.
 * @returns the current principal, or undefined outside an authenticated request.
 */
currentPrincipal(): AuthPrincipal | undefined

/**
 * Run one carrier dispatch with an immutable authenticated principal.
 * @param principal - identity resolved from the deployment session cookie.
 * @param operation - request work that may cross asynchronous continuations.
 * @returns the operation result.
 */
withPrincipal<T>(principal: AuthPrincipal, operation: () => T): T

/**
 * Resolve an opaque cookie token into an active principal.
 * @param token - raw opaque browser token from the cookie.
 * @returns the active principal, or `undefined` for an invalid or expired token.
 */
abstract authenticateToken(token: string): Promise<AuthPrincipal | undefined>

/**
 * Verify local credentials and issue a revocable browser session.
 * @param username - submitted local username.
 * @param password - submitted cleartext password, retained only for verification.
 * @returns the one-time raw token and its public principal.
 */
abstract loginLocal(username: string, password: string): Promise<IssuedAuthSession>

/**
 * Resolve a verified OIDC identity and issue a revocable browser session.
 * Implementations bind identities by immutable issuer and subject values;
 * display claims must never select an existing local account.
 * @param input - claims already validated by the OIDC relying party.
 * @returns the one-time raw token and its public principal.
 */
abstract loginOidc(input: OidcLoginInput): Promise<IssuedAuthSession>

/**
 * Read the persisted non-secret OIDC client settings.
 * @returns a detached configuration, or `undefined` before first setup.
 */
abstract oidcClientConfig(): OidcClientConfig | undefined

/**
 * Persist non-secret OIDC client settings.
 * @param config - validated relying-party settings.
 */
abstract setOidcClientConfig(config: OidcClientConfig): Promise<void>

/**
 * Revoke one opaque cookie token. Missing and expired tokens are no-ops.
 * @param token - raw opaque browser token to revoke.
 */
abstract logout(token: string): Promise<void>

/**
 * Revoke every active browser session for one user.
 * @param userId - stable user identity whose tokens are revoked.
 */
abstract revokeUserSessions(userId: UserId): Promise<void>

/**
 * List public users in stable creation order.
 * @returns detached public records without credential material.
 */
abstract listUsers(): readonly AuthUser[]

/**
 * Read one public user record.
 * @param userId - stable user identity to resolve.
 * @returns the public record, or `undefined` when absent.
 */
abstract getUser(userId: UserId): AuthUser | undefined

/**
 * Create a local account and its owner-only data tree.
 * @param input - validated account identity, password, and role fields.
 * @returns the created public user record.
 */
abstract createLocalUser(input: CreateLocalUserInput): Promise<AuthUser>

/**
 * Change administrative user fields.
 * @param userId - stable user identity to update.
 * @param input - display name, role, or lifecycle changes.
 * @returns the updated public user record.
 */
abstract updateUser(userId: UserId, input: UpdateUserInput): Promise<AuthUser>

/**
 * Replace a local account password and revoke its browser sessions.
 * @param userId - stable user identity whose local password changes.
 * @param password - new cleartext password, retained only until hashing completes.
 */
abstract resetLocalPassword(userId: UserId, password: string): Promise<void>

/**
 * Read whether one user opted into the administrator-managed DeepSeek credential.
 * @param userId - stable user identity whose preference is requested.
 * @returns the detached preference; absent stored state resolves to disabled.
 */
abstract sharedDeepSeekPreference(userId: UserId): SharedDeepSeekPreference

/**
 * Persist one user's choice to consume the administrator-managed DeepSeek credential.
 * @param userId - stable user identity whose preference changes.
 * @param enabled - whether matching DeepSeek V4 Flash requests may use the managed credential.
 */
abstract setSharedDeepSeekPreference(userId: UserId, enabled: boolean): Promise<void>

/**
 * Resolve which user owns a path inside a program-managed project tree.
 * @param path - absolute project or descendant path to classify.
 * @returns the public owner record, or `undefined` outside every managed project tree.
 */
abstract ownerForProjectPath(path: string): AuthUser | undefined

/**
 * Resolve and materialize program-managed directories for one user.
 * @param userId - stable user identity selecting the directory tree.
 * @returns canonical program-managed path roles.
 */
abstract ensureUserPaths(userId: UserId): Promise<UserPaths>

/**
 * Resolve paths without touching disk.
 * @param userId - stable user identity selecting the directory tree.
 * @returns program-managed path roles without creating them.
 */
abstract userPaths(userId: UserId): UserPaths
```

Source: [`packages/identity/auth/src/index.ts`](../../packages/identity/auth/src/index.ts)
<!-- END GENERATED cordis-surface -->
