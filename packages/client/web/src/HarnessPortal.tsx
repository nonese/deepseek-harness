import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import {
  IconChevronRightOutline14,
  IconFolderClose16,
  IconNewChatOutline16,
  IconSettingsOutline16,
  IconUserOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ClientAuthUser } from './auth-state.ts'
import css from './HarnessPortal.module.css'

interface ProjectView {
  id: string
  name: string
  path: string
  sessionCount: number
  createdAt: number
  updatedAt: number
}

interface UsersResponse {
  users: ClientAuthUser[]
}

interface ProjectsResponse {
  projects: ProjectView[]
}

interface SharedDeepSeekStatus {
  provider: 'deepseek-official'
  model: 'deepseek-v4-flash'
  name: string
  configured: boolean
  writable: boolean
  enabled?: boolean
  enabledUsers?: number
}

interface PreferencesResponse {
  sharedDeepSeek: SharedDeepSeekStatus & { enabled: boolean }
}

type OidcClientAuthMethod = 'client_secret_basic' | 'client_secret_post' | 'none'

interface OidcClientSettings {
  enabled: boolean
  issuer: string
  clientId: string
  redirectUri: string
  scopes: readonly string[]
  clientAuthMethod: OidcClientAuthMethod
  allowInsecureIssuer: boolean
  administratorGroup: string
}

interface OidcAdminStatus {
  configured: boolean
  enabled: boolean
  clientSecretConfigured: boolean
  clientSecretWritable: boolean
  settings?: OidcClientSettings
}

interface OidcDraft extends Omit<OidcClientSettings, 'scopes'> {
  scopes: string
}

interface OidcTestResult {
  ok: boolean
  issuer: string
  authorizationEndpoint?: string
  tokenEndpoint?: string
  jwksUri?: string
  supportsPkceS256: boolean
}

interface SystemSettingsResponse {
  runtime: {
    processModel: 'single-process'
    storage: 'file-backed'
    dataRoot: string
  }
  users: {
    total: number
    active: number
    administrators: number
  }
  authentication: {
    oidcConfigured: boolean
    oidc: OidcAdminStatus
    localLoginEnabled: boolean
    cookie: {
      name: string
      httpOnly: boolean
      sameSite: string
      secure: boolean
    }
  }
  isolation: {
    userDirectoryKey: 'stable-user-id'
    projectsManaged: boolean
    administratorContentAccess: boolean
  }
  sharedDeepSeek: SharedDeepSeekStatus & { enabledUsers: number }
  limits: {
    maxBodyBytes: number
  }
}

function defaultOidcDraft(): OidcDraft {
  const origin = typeof location === 'undefined' ? 'http://127.0.0.1:4178' : location.origin
  return {
    enabled: false,
    issuer: '',
    clientId: '',
    redirectUri: `${origin}/auth/oidc/callback`,
    scopes: 'openid profile email groups',
    clientAuthMethod: 'client_secret_basic',
    allowInsecureIssuer: origin.startsWith('http://'),
    administratorGroup: 'super_admin',
  }
}

function oidcDraftFrom(status: OidcAdminStatus): OidcDraft {
  const settings = status.settings
  return settings === undefined
    ? defaultOidcDraft()
    : { ...settings, scopes: settings.scopes.join(' ') }
}

interface ApiErrorBody {
  error?: { message?: string }
}

async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (!headers.has('content-type')) headers.set('content-type', 'application/json')
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers,
  })
  const body: unknown = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = (body as ApiErrorBody).error?.message ?? `请求失败（${String(response.status)}）`
    throw new Error(message)
  }
  return body as T
}

function relativeTime(timestamp: number | string | undefined): string {
  if (timestamp === undefined) return '尚未登录'
  const time = typeof timestamp === 'number' ? timestamp : Date.parse(timestamp)
  const delta = Date.now() - time
  if (!Number.isFinite(delta) || delta < 0) return '刚刚'
  const minutes = Math.floor(delta / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${String(minutes)} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${String(hours)} 小时前`
  const days = Math.floor(hours / 24)
  return days < 30 ? `${String(days)} 天前` : new Date(time).toLocaleDateString('zh-CN')
}

type PortalView = 'projects' | 'runtime' | 'settings' | 'admin' | 'system'

/** Authenticated product shell for project entry and user administration. */
export interface HarnessPortalProps {
  user: ClientAuthUser
  renderRuntime(): ReactNode
  openWorkspace(workspaceId: string): void
  startSession(workspaceId?: string): void
  onLogout(): Promise<void>
}

export function HarnessPortal(props: HarnessPortalProps) {
  const [view, setView] = useState<PortalView>('projects')
  const [projects, setProjects] = useState<ProjectView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [creating, setCreating] = useState(false)
  const [projectName, setProjectName] = useState('')

  const refreshProjects = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(undefined)
    try {
      const response = await jsonRequest<ProjectsResponse>('/auth/projects')
      setProjects(response.projects)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refreshProjects() }, [refreshProjects])

  const openProject = (project: ProjectView): void => {
    props.openWorkspace(project.id)
    setView('runtime')
  }

  const newSession = (): void => {
    const first = projects[0]
    if (first === undefined) {
      setCreating(true)
      return
    }
    props.startSession(first.id)
    setView('runtime')
  }

  const createProject = (event: FormEvent): void => {
    event.preventDefault()
    const name = projectName.trim()
    if (name.length === 0) return
    setError(undefined)
    void jsonRequest<{ project: ProjectView }>('/auth/projects', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }).then(({ project }) => {
      setProjects(current => [project, ...current.filter(item => item.id !== project.id)])
      setProjectName('')
      setCreating(false)
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  if (view === 'runtime') {
    return (
      <div className={css.runtime}>
        <button className={css.returnButton} type="button" onClick={() => { setView('projects') }}>
          返回我的项目
        </button>
        <div className={css.runtimeBody}>{props.renderRuntime()}</div>
      </div>
    )
  }

  const admin = props.user.role === 'admin'
  return (
    <div className={css.shell}>
      <aside className={css.sidebar}>
        <div className={css.wordmark}>Harness</div>
        <button className={css.newSession} type="button" onClick={newSession}><IconNewChatOutline16 size={18} />新建会话</button>
        <nav aria-label="主导航">
          <button className={view === 'projects' ? css.navActive : css.navItem} type="button" onClick={() => { setView('projects') }}><IconFolderClose16 size={18} />项目</button>
          <button className={css.navItem} type="button" onClick={() => { setView('runtime') }}><IconNewChatOutline16 size={18} />会话</button>
          <button className={view === 'settings' ? css.navActive : css.navItem} type="button" onClick={() => { setView('settings') }}><IconSettingsOutline16 size={18} />设置</button>
          {admin && (
            <div className={css.adminNav}>
              <div className={css.navLabel}>管理</div>
              <button className={view === 'admin' ? css.navActive : css.navItem} type="button" onClick={() => { setView('admin') }}><IconUserOutline16 size={18} />用户管理</button>
              <button className={view === 'system' ? css.navActive : css.navItem} type="button" onClick={() => { setView('system') }}><IconSettingsOutline16 size={18} />系统设置</button>
            </div>
          )}
        </nav>
        <div className={css.account}>
          <div className={css.avatar}>{props.user.displayName.slice(0, 1).toUpperCase()}</div>
          <div className={css.accountText}>
            <strong>{props.user.displayName}</strong>
            <span>{admin ? '管理员' : '普通用户'}</span>
          </div>
          <button type="button" onClick={() => { void props.onLogout() }}>退出</button>
        </div>
      </aside>

      {view === 'admin' && admin
        ? <AdminView currentUser={props.user} />
        : view === 'system' && admin
          ? <SystemSettingsView />
          : view === 'settings'
            ? <UserSettingsView />
            : (
              <main className={css.main}>
                <header className={css.pageHeader}>
                  <div>
                    <h1>我的项目</h1>
                    <p>打开已有项目或创建新的个人项目。</p>
                  </div>
                  <button className={css.primaryButton} type="button" onClick={() => { setCreating(true) }}>新建项目</button>
                </header>

                <div className={css.infoStrip}>项目将自动保存在你的个人空间中，服务器目录由 Harness 统一管理。</div>
                {error !== undefined && <div className={css.pageError} role="alert">{error}</div>}

                <section className={css.section} aria-labelledby="project-list-title">
                  <h2 id="project-list-title">最近使用</h2>
                  <div className={css.projectList}>
                    {loading && <div className={css.empty}>正在读取项目…</div>}
                    {!loading && projects.length === 0 && <div className={css.empty}>还没有项目。新建一个项目后即可开始会话。</div>}
                    {projects.map(project => (
                      <button className={css.projectRow} type="button" key={project.id} onClick={() => { openProject(project) }}>
                        <span className={css.projectMark}><IconFolderClose16 size={20} /></span>
                        <span className={css.projectMain}>
                          <strong>{project.name}</strong>
                          <span>自动管理 · {project.sessionCount} 个会话</span>
                        </span>
                        <span className={css.projectTime}>{relativeTime(project.updatedAt)}</span>
                        <span className={css.openText}>打开 <IconChevronRightOutline14 size={14} /></span>
                      </button>
                    ))}
                  </div>
                </section>

                <section className={css.section} aria-labelledby="recent-title">
                  <h2 id="recent-title">最近会话</h2>
                  <div className={css.recentGrid}>
                    {projects.filter(project => project.sessionCount > 0).slice(0, 3).map(project => (
                      <button type="button" key={project.id} onClick={() => { openProject(project) }}>
                        <strong>{project.name}</strong>
                        <span>{project.sessionCount} 个会话 · {relativeTime(project.updatedAt)}</span>
                      </button>
                    ))}
                    {!loading && projects.every(project => project.sessionCount === 0) && <span className={css.muted}>暂无会话</span>}
                  </div>
                </section>
              </main>
            )}

      {creating && (
        <div className={css.modalBackdrop} role="presentation" onMouseDown={(event) => {
          if (event.currentTarget === event.target) setCreating(false)
        }}>
          <form className={css.modal} onSubmit={createProject}>
            <h2>新建项目</h2>
            <p>Harness 会自动分配并创建私有项目目录。</p>
            <label>
              <span>项目名称</span>
              <input value={projectName} onChange={(event) => { setProjectName(event.target.value) }} autoFocus maxLength={80} />
            </label>
            <div className={css.modalActions}>
              <button type="button" onClick={() => { setCreating(false) }}>取消</button>
              <button className={css.primaryButton} type="submit">创建项目</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

function UserSettingsView() {
  const [preference, setPreference] = useState<PreferencesResponse['sharedDeepSeek']>()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(undefined)
    try {
      setPreference((await jsonRequest<PreferencesResponse>('/auth/preferences')).sharedDeepSeek)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const setEnabled = (enabled: boolean): void => {
    setSaving(true)
    setError(undefined)
    setNotice(undefined)
    void jsonRequest<PreferencesResponse>('/auth/preferences', {
      method: 'PATCH',
      body: JSON.stringify({ sharedDeepSeekEnabled: enabled }),
    }).then((response) => {
      setPreference(response.sharedDeepSeek)
      setNotice(enabled ? '已启用统一 DeepSeek-V4-Flash。' : '已改回 Harness 原有模型凭据。')
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => { setSaving(false) })
  }

  return (
    <main className={css.main}>
      <header className={css.pageHeader}>
        <div><h1>设置</h1><p>选择是否使用管理员提供的统一模型凭据。</p></div>
        <button className={css.secondaryButton} type="button" disabled={loading || saving} onClick={() => { void refresh() }}>
          {loading ? '正在刷新…' : '刷新状态'}
        </button>
      </header>
      <div className={css.infoStrip}>统一 API Key 只在服务端使用，浏览器和个人目录都不会收到密钥内容。</div>
      {error !== undefined && <div className={css.pageError} role="alert">{error}</div>}
      {notice !== undefined && <div className={css.pageNotice} role="status">{notice}</div>}
      {preference === undefined && loading && <div className={css.settingsLoading}>正在读取个人设置…</div>}
      {preference !== undefined && (
        <section className={css.preferenceCard} aria-labelledby="shared-deepseek-user-title">
          <div className={css.preferenceHeader}>
            <div>
              <span className={css.eyebrow}>统一模型</span>
              <h2 id="shared-deepseek-user-title">{preference.name}</h2>
              <p>仅 DeepSeek‑V4‑Flash 会使用管理员配置的统一 Key；其他模型继续使用 Harness 原有配置。</p>
            </div>
            <span className={preference.configured ? css.stateReady : css.statePending}>
              {preference.configured ? '管理员已配置' : '管理员尚未配置'}
            </span>
          </div>
          <div className={css.preferenceRow}>
            <div>
              <strong>使用统一 API Key</strong>
              <span>{preference.enabled ? '当前已启用，可直接使用统一模型。' : '当前未启用，不会使用统一密钥。'}</span>
            </div>
            <label className={css.toggleLabel}>
              <input
                type="checkbox"
                checked={preference.enabled}
                disabled={(!preference.configured && !preference.enabled) || saving}
                onChange={(event) => { setEnabled(event.target.checked) }}
              />
              <span>{saving ? '正在保存…' : preference.enabled ? '已启用' : '未启用'}</span>
            </label>
          </div>
        </section>
      )}
    </main>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  return `${String(Math.round(bytes / 1024))} KiB`
}

function SystemSettingsView() {
  const [settings, setSettings] = useState<SystemSettingsResponse>()
  const [apiKey, setApiKey] = useState('')
  const [oidcDraft, setOidcDraft] = useState<OidcDraft>(defaultOidcDraft)
  const [oidcSecret, setOidcSecret] = useState('')
  const [oidcTest, setOidcTest] = useState<OidcTestResult>()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [oidcSaving, setOidcSaving] = useState(false)
  const [oidcTesting, setOidcTesting] = useState(false)
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(undefined)
    try {
      const response = await jsonRequest<SystemSettingsResponse>('/auth/system')
      setSettings(response)
      setOidcDraft(oidcDraftFrom(response.authentication.oidc))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const updateSharedStatus = (sharedDeepSeek: SharedDeepSeekStatus): void => {
    setSettings(current => current === undefined
      ? current
      : { ...current, sharedDeepSeek: { ...current.sharedDeepSeek, ...sharedDeepSeek } })
  }

  const saveSharedCredential = (event: FormEvent): void => {
    event.preventDefault()
    if (apiKey.trim().length === 0) return
    setSaving(true)
    setError(undefined)
    setNotice(undefined)
    void jsonRequest<{ sharedDeepSeek: SharedDeepSeekStatus }>('/auth/system/shared-deepseek', {
      method: 'PUT',
      body: JSON.stringify({ apiKey }),
    }).then(({ sharedDeepSeek }) => {
      updateSharedStatus(sharedDeepSeek)
      setApiKey('')
      setNotice('统一 DeepSeek API Key 已保存。用户需要在“设置”中主动启用，才会在 DeepSeek-V4-Flash 请求中使用。')
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => { setSaving(false) })
  }

  const clearSharedCredential = (): void => {
    setSaving(true)
    setError(undefined)
    setNotice(undefined)
    void jsonRequest<{ sharedDeepSeek: SharedDeepSeekStatus }>('/auth/system/shared-deepseek', {
      method: 'DELETE',
    }).then(({ sharedDeepSeek }) => {
      updateSharedStatus(sharedDeepSeek)
      setApiKey('')
      setNotice('统一 DeepSeek API Key 已移除。已启用用户在重新配置前不会再使用统一密钥。')
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => { setSaving(false) })
  }

  const saveOidc = (event: FormEvent): void => {
    event.preventDefault()
    setOidcSaving(true)
    setError(undefined)
    setNotice(undefined)
    setOidcTest(undefined)
    const scopes = oidcDraft.scopes.split(/[\s,]+/u).map(scope => scope.trim()).filter(Boolean)
    void jsonRequest<{ oidc: OidcAdminStatus }>('/auth/system/oidc', {
      method: 'PUT',
      body: JSON.stringify({
        ...oidcDraft,
        scopes,
        ...oidcSecret.length === 0 ? {} : { clientSecret: oidcSecret },
      }),
    }).then(({ oidc: status }) => {
      setSettings(current => current === undefined ? current : {
        ...current,
        authentication: { ...current.authentication, oidcConfigured: status.configured, oidc: status },
      })
      setOidcDraft(oidcDraftFrom(status))
      setOidcSecret('')
      setNotice(status.configured
        ? 'OIDC 配置已保存并启用，登录页现在可使用企业 SSO。'
        : 'OIDC 配置已保存，但当前尚未启用或缺少客户端密钥。')
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => { setOidcSaving(false) })
  }

  const testOidc = (): void => {
    setOidcTesting(true)
    setError(undefined)
    setNotice(undefined)
    setOidcTest(undefined)
    void jsonRequest<{ oidc: OidcTestResult }>('/auth/system/oidc/test', {
      method: 'POST',
      body: '{}',
    }).then(({ oidc: result }) => {
      setOidcTest(result)
      setNotice(result.supportsPkceS256
        ? 'OIDC 发现文档连接成功，并声明支持 PKCE S256。'
        : 'OIDC 发现文档连接成功，但未声明支持 PKCE S256。')
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => { setOidcTesting(false) })
  }

  return (
    <main className={css.main}>
      <header className={css.pageHeader}>
        <div><h1>系统设置</h1><p>管理统一模型凭据、企业登录与服务运行状态。</p></div>
        <button className={css.secondaryButton} type="button" disabled={loading || saving || oidcSaving || oidcTesting} onClick={() => { void refresh() }}>
          {loading ? '正在刷新…' : '刷新状态'}
        </button>
      </header>
      <div className={css.infoStrip}>API Key 仅写入服务器的凭据文件，接口只返回“是否已配置”，不会返回密钥内容。</div>
      {error !== undefined && <div className={css.pageError} role="alert">{error}</div>}
      {notice !== undefined && <div className={css.pageNotice} role="status">{notice}</div>}
      {settings === undefined && loading && <div className={css.settingsLoading}>正在读取系统状态…</div>}
      {settings !== undefined && (
        <>
          <section className={css.settingsSection} aria-labelledby="shared-deepseek-admin-title">
            <div className={css.sectionHeading}>
              <div><h2 id="shared-deepseek-admin-title">统一模型 API</h2><p>为所有用户提供可选的 DeepSeek‑V4‑Flash 访问凭据。</p></div>
              <span className={settings.sharedDeepSeek.configured ? css.stateReady : css.statePending}>
                {settings.sharedDeepSeek.configured ? '已配置' : '未配置'}
              </span>
            </div>
            <div className={css.credentialPanel}>
              <div className={css.credentialSummary}>
                <div><span>固定模型</span><strong>{settings.sharedDeepSeek.name}</strong></div>
                <div><span>已启用用户</span><strong>{settings.sharedDeepSeek.enabledUsers}</strong></div>
                <div><span>密钥可修改</span><strong>{settings.sharedDeepSeek.writable ? '是' : '否'}</strong></div>
              </div>
              <form className={css.credentialForm} onSubmit={saveSharedCredential}>
                <label htmlFor="shared-deepseek-api-key">{settings.sharedDeepSeek.configured ? '替换 API Key' : '设置 API Key'}</label>
                <div>
                  <input
                    id="shared-deepseek-api-key"
                    type="password"
                    autoComplete="off"
                    value={apiKey}
                    disabled={!settings.sharedDeepSeek.writable || saving}
                    placeholder={settings.sharedDeepSeek.configured ? '输入新 Key，原 Key 不会显示' : '输入 DeepSeek API Key'}
                    onChange={(event) => { setApiKey(event.target.value) }}
                  />
                  <button className={css.primaryButton} type="submit" disabled={!settings.sharedDeepSeek.writable || saving || apiKey.trim().length === 0}>
                    {saving ? '正在保存…' : settings.sharedDeepSeek.configured ? '替换 Key' : '保存 Key'}
                  </button>
                  {settings.sharedDeepSeek.configured && (
                    <button className={css.dangerButton} type="button" disabled={!settings.sharedDeepSeek.writable || saving} onClick={clearSharedCredential}>
                      移除统一 Key
                    </button>
                  )}
                </div>
              </form>
            </div>
          </section>

          <section className={css.settingsSection} aria-labelledby="oidc-settings-title">
            <div className={css.sectionHeading}>
              <div><h2 id="oidc-settings-title">企业 OIDC 登录</h2><p>接入 Authorization Code + PKCE；客户端密钥只保存在服务器凭据文件中。</p></div>
              <span className={settings.authentication.oidc.configured ? css.stateReady : css.statePending}>
                {settings.authentication.oidc.configured
                  ? '已启用'
                  : settings.authentication.oidc.settings === undefined ? '未配置' : '已保存未启用'}
              </span>
            </div>
            <form className={css.oidcPanel} onSubmit={saveOidc}>
              <div className={css.oidcToggleRow}>
                <div><strong>允许企业 SSO 登录</strong><span>关闭后保留参数与身份绑定，本地测试登录不受影响。</span></div>
                <label className={css.toggleLabel}>
                  <input
                    type="checkbox"
                    aria-label="允许企业 SSO 登录"
                    checked={oidcDraft.enabled}
                    onChange={(event) => { setOidcDraft({ ...oidcDraft, enabled: event.target.checked }) }}
                  />
                  <span>{oidcDraft.enabled ? '启用' : '停用'}</span>
                </label>
              </div>
              <div className={css.oidcFormGrid}>
                <label className={css.oidcWideField}>
                  <span>Issuer URL</span>
                  <input
                    required
                    type="url"
                    aria-label="Issuer URL"
                    value={oidcDraft.issuer}
                    placeholder="https://sso.example.internal/api/oidc"
                    onChange={(event) => { setOidcDraft({ ...oidcDraft, issuer: event.target.value }) }}
                  />
                  <small>填写发现文档中的 issuer；程序会访问 <code>/.well-known/openid-configuration</code>。</small>
                </label>
                <label>
                  <span>Client ID</span>
                  <input
                    required
                    aria-label="Client ID"
                    value={oidcDraft.clientId}
                    autoComplete="off"
                    onChange={(event) => { setOidcDraft({ ...oidcDraft, clientId: event.target.value }) }}
                  />
                </label>
                <label>
                  <span>Token 端点鉴权</span>
                  <select
                    aria-label="Token 端点鉴权"
                    value={oidcDraft.clientAuthMethod}
                    onChange={(event) => { setOidcDraft({ ...oidcDraft, clientAuthMethod: event.target.value as OidcClientAuthMethod }) }}
                  >
                    <option value="client_secret_basic">client_secret_basic</option>
                    <option value="client_secret_post">client_secret_post</option>
                    <option value="none">none（公共客户端）</option>
                  </select>
                </label>
                <label className={css.oidcWideField}>
                  <span>{settings.authentication.oidc.clientSecretConfigured ? '替换 Client Secret' : 'Client Secret'}</span>
                  <input
                    type="password"
                    aria-label={settings.authentication.oidc.clientSecretConfigured ? '替换 Client Secret' : 'Client Secret'}
                    autoComplete="new-password"
                    value={oidcSecret}
                    disabled={oidcDraft.clientAuthMethod === 'none' || !settings.authentication.oidc.clientSecretWritable}
                    placeholder={oidcDraft.clientAuthMethod === 'none'
                      ? '公共客户端不使用密钥'
                      : settings.authentication.oidc.clientSecretConfigured ? '留空则保留现有密钥' : '输入 OIDC 客户端密钥'}
                    onChange={(event) => { setOidcSecret(event.target.value) }}
                  />
                  <small>保存后不会回显。当前状态：{settings.authentication.oidc.clientSecretConfigured ? '已配置' : '未配置'}。</small>
                </label>
                <label className={css.oidcWideField}>
                  <span>Redirect URI</span>
                  <input
                    required
                    type="url"
                    aria-label="Redirect URI"
                    value={oidcDraft.redirectUri}
                    onChange={(event) => { setOidcDraft({ ...oidcDraft, redirectUri: event.target.value }) }}
                  />
                  <small>请把这个完整地址登记到 OIDC 服务端；路径必须为 <code>/auth/oidc/callback</code>。</small>
                </label>
                <label>
                  <span>Scopes</span>
                  <input
                    required
                    aria-label="Scopes"
                    value={oidcDraft.scopes}
                    onChange={(event) => { setOidcDraft({ ...oidcDraft, scopes: event.target.value }) }}
                  />
                  <small>至少包含 <code>openid</code>；当前文档推荐 profile、email、groups。</small>
                </label>
                <label>
                  <span>新用户管理员组</span>
                  <input
                    aria-label="新用户管理员组"
                    value={oidcDraft.administratorGroup}
                    placeholder="super_admin"
                    onChange={(event) => { setOidcDraft({ ...oidcDraft, administratorGroup: event.target.value }) }}
                  />
                  <small>首次登录时命中该 groups 值则创建为管理员；留空则全部创建为普通用户。</small>
                </label>
              </div>
              <label className={css.oidcCheckRow}>
                <input
                  type="checkbox"
                  aria-label="允许内网 HTTP"
                  checked={oidcDraft.allowInsecureIssuer}
                  onChange={(event) => { setOidcDraft({ ...oidcDraft, allowInsecureIssuer: event.target.checked }) }}
                />
                <span><strong>允许内网 HTTP</strong>仅用于受控纯内网部署；生产环境应使用 HTTPS。</span>
              </label>
              {oidcTest !== undefined && (
                <dl className={css.oidcTestResult}>
                  <div><dt>发现结果</dt><dd>{oidcTest.ok ? '连接成功' : '失败'}</dd></div>
                  <div><dt>Issuer</dt><dd><code>{oidcTest.issuer}</code></dd></div>
                  <div><dt>PKCE S256</dt><dd>{oidcTest.supportsPkceS256 ? '支持' : '未声明'}</dd></div>
                </dl>
              )}
              <div className={css.oidcActions}>
                <button
                  className={css.secondaryButton}
                  type="button"
                  disabled={oidcSaving || oidcTesting || settings.authentication.oidc.settings === undefined}
                  onClick={testOidc}
                >
                  {oidcTesting ? '正在连接…' : '测试已保存配置'}
                </button>
                <button className={css.primaryButton} type="submit" disabled={oidcSaving || oidcTesting}>
                  {oidcSaving ? '正在保存…' : '保存 OIDC 配置'}
                </button>
              </div>
            </form>
          </section>

          <section className={css.settingsSection} aria-labelledby="runtime-settings-title">
            <div className={css.sectionHeading}>
              <div><h2 id="runtime-settings-title">运行概览</h2><p>当前 Host 进程与持久化方式。</p></div>
              <span className={css.readonlyBadge}>只读</span>
            </div>
            <div className={css.metricGrid}>
              <article><span>运行模式</span><strong>单进程</strong></article>
              <article><span>持久化</span><strong>文件存储</strong></article>
              <article><span>启用用户</span><strong>{settings.users.active} / {settings.users.total}</strong></article>
              <article><span>管理员</span><strong>{settings.users.administrators}</strong></article>
            </div>
          </section>

          <section className={css.settingsSection} aria-labelledby="authentication-settings-title">
            <div className={css.sectionHeading}><div><h2 id="authentication-settings-title">登录与会话</h2><p>认证入口和浏览器会话安全属性。</p></div></div>
            <dl className={css.settingsList}>
              <div><dt>企业 OIDC</dt><dd><span className={settings.authentication.oidcConfigured ? css.stateReady : css.statePending}>{settings.authentication.oidcConfigured ? '已启用' : '未启用'}</span></dd></div>
              <div><dt>本地账号登录</dt><dd>{settings.authentication.localLoginEnabled ? '已启用' : '已停用'}</dd></div>
              <div><dt>会话 Cookie</dt><dd><code>{settings.authentication.cookie.name}</code></dd></div>
              <div><dt>Cookie 安全属性</dt><dd>{[
                settings.authentication.cookie.httpOnly ? 'HttpOnly' : undefined,
                `SameSite=${settings.authentication.cookie.sameSite}`,
                settings.authentication.cookie.secure ? 'Secure' : '未启用 Secure（仅适用于当前 HTTP 部署）',
              ].filter(value => value !== undefined).join(' · ')}</dd></div>
            </dl>
          </section>

          <section className={css.settingsSection} aria-labelledby="storage-settings-title">
            <div className={css.sectionHeading}><div><h2 id="storage-settings-title">数据与隔离</h2><p>用户目录和项目内容的服务端管理策略。</p></div></div>
            <dl className={css.settingsList}>
              <div><dt>服务数据目录</dt><dd><code className={css.pathValue}>{settings.runtime.dataRoot}</code></dd></div>
              <div><dt>用户目录标识</dt><dd>稳定用户 ID（不使用用户名）</dd></div>
              <div><dt>项目目录</dt><dd>{settings.isolation.projectsManaged ? '由 Harness 自动创建与管理' : '允许用户选择服务器目录'}</dd></div>
              <div><dt>管理员内容权限</dt><dd>{settings.isolation.administratorContentAccess ? '可查看用户项目内容' : '仅管理账号元数据，不可查看用户项目内容'}</dd></div>
              <div><dt>认证请求上限</dt><dd>{formatBytes(settings.limits.maxBodyBytes)}</dd></div>
            </dl>
          </section>
        </>
      )}
    </main>
  )
}

function AdminView({ currentUser }: { currentUser: ClientAuthUser }) {
  const [users, setUsers] = useState<ClientAuthUser[]>([])
  const [query, setQuery] = useState('')
  const [role, setRole] = useState<'all' | 'admin' | 'user'>('all')
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [creating, setCreating] = useState(false)
  const [resetting, setResetting] = useState<ClientAuthUser>()
  const [resetPassword, setResetPassword] = useState('')
  const [draft, setDraft] = useState({ username: '', displayName: '', password: '', role: 'user' as 'admin' | 'user' })

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setUsers((await jsonRequest<UsersResponse>('/auth/users')).users)
      setError(undefined)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  const filtered = useMemo(() => users.filter((user) => {
    const match = `${user.username} ${user.displayName}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
    return match && (role === 'all' || user.role === role)
  }), [query, role, users])

  const update = (user: ClientAuthUser, patch: object): void => {
    setNotice(undefined)
    void jsonRequest<{ user: ClientAuthUser }>(`/auth/users/${encodeURIComponent(user.id)}`, {
      method: 'PATCH', body: JSON.stringify(patch),
    }).then(({ user: next }) => {
      setUsers(current => current.map(item => item.id === next.id ? next : item))
      setError(undefined)
    }).catch((reason: unknown) => { setError(reason instanceof Error ? reason.message : String(reason)) })
  }

  const create = (event: FormEvent): void => {
    event.preventDefault()
    setNotice(undefined)
    void jsonRequest<{ user: ClientAuthUser }>('/auth/users', {
      method: 'POST', body: JSON.stringify({
        username: draft.username,
        password: draft.password,
        role: draft.role,
        ...draft.displayName.trim().length === 0 ? {} : { displayName: draft.displayName },
      }),
    }).then(({ user }) => {
      setUsers(current => [...current, user])
      setCreating(false)
      setDraft({ username: '', displayName: '', password: '', role: 'user' })
      setError(undefined)
    }).catch((reason: unknown) => { setError(reason instanceof Error ? reason.message : String(reason)) })
  }

  const reset = (event: FormEvent): void => {
    event.preventDefault()
    if (resetting === undefined) return
    setNotice(undefined)
    void jsonRequest<Record<string, never>>(`/auth/users/${encodeURIComponent(resetting.id)}/reset-password`, {
      method: 'POST', body: JSON.stringify({ password: resetPassword }),
    }).then(() => {
      setNotice(`已重置 ${resetting.displayName} 的本地密码，并撤销该用户的现有登录会话。`)
      setResetting(undefined)
      setResetPassword('')
      setError(undefined)
    }).catch((reason: unknown) => { setError(reason instanceof Error ? reason.message : String(reason)) })
  }

  return (
    <main className={css.main}>
      <header className={css.pageHeader}>
        <div><h1>用户管理</h1><p>管理访问 Harness 的账号与角色，不显示任何用户项目内容。</p></div>
        <button className={css.primaryButton} type="button" onClick={() => { setCreating(true) }}>新建本地用户</button>
      </header>
      <div className={css.infoStrip}>OIDC 用户首次登录时按 issuer 与 sub 自动绑定；显示名称和用户名不会覆盖现有本地账号。</div>
      {error !== undefined && <div className={css.pageError} role="alert">{error}</div>}
      {notice !== undefined && <div className={css.pageNotice} role="status">{notice}</div>}
      <div className={css.filters}>
        <input placeholder="搜索用户名或显示名称" value={query} onChange={(event) => { setQuery(event.target.value) }} />
        <select value={role} onChange={(event) => { setRole(event.target.value as typeof role) }}>
          <option value="all">全部角色</option>
          <option value="admin">管理员</option>
          <option value="user">普通用户</option>
        </select>
      </div>
      <div className={css.tableWrap}>
        <table>
          <thead><tr><th>用户</th><th>登录方式</th><th>角色</th><th>状态</th><th>最近登录</th><th>操作</th></tr></thead>
          <tbody>
            {filtered.map(user => (
              <tr key={user.id}>
                <td><strong>{user.displayName}</strong><span>@{user.username}</span></td>
                <td>{user.authMethods.map(method => method === 'local' ? '本地' : 'OIDC').join(' / ')}</td>
                <td>
                  <select
                    value={user.role}
                    disabled={user.id === currentUser.id}
                    onChange={(event) => { update(user, { role: event.target.value }) }}
                  >
                    <option value="admin">管理员</option>
                    <option value="user">普通用户</option>
                  </select>
                </td>
                <td><span className={user.status === 'active' ? css.statusActive : css.statusDisabled}>{user.status === 'active' ? '启用' : '停用'}</span></td>
                <td>{relativeTime(user.lastLoginAt)}</td>
                <td>
                  <div className={css.tableActions}>
                    {user.authMethods.includes('local') && (
                      <button type="button" disabled={user.id === currentUser.id} onClick={() => { setResetting(user); setResetPassword('') }}>
                        重置密码
                      </button>
                    )}
                    <button type="button" disabled={user.id === currentUser.id} onClick={() => { update(user, { status: user.status === 'active' ? 'disabled' : 'active' }) }}>
                      {user.status === 'active' ? '停用' : '启用'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {creating && (
        <div className={css.modalBackdrop} role="presentation" onMouseDown={(event) => {
          if (event.currentTarget === event.target) setCreating(false)
        }}>
          <form className={css.modal} onSubmit={create}>
            <h2>新建本地用户</h2>
            <p>用户首次登录后会自动获得独立数据目录。</p>
            <label>
              <span>用户名</span>
              <input
                required
                minLength={3}
                value={draft.username}
                onChange={(event) => { setDraft({ ...draft, username: event.target.value }) }}
                autoFocus
              />
            </label>
            <label>
              <span>显示名称</span>
              <input
                value={draft.displayName}
                onChange={(event) => { setDraft({ ...draft, displayName: event.target.value }) }}
              />
            </label>
            <label>
              <span>初始密码</span>
              <input
                required
                type="password"
                minLength={10}
                value={draft.password}
                onChange={(event) => { setDraft({ ...draft, password: event.target.value }) }}
              />
            </label>
            <label>
              <span>角色</span>
              <select
                value={draft.role}
                onChange={(event) => { setDraft({ ...draft, role: event.target.value as 'admin' | 'user' }) }}
              >
                <option value="user">普通用户</option>
                <option value="admin">管理员</option>
              </select>
            </label>
            <div className={css.modalActions}>
              <button type="button" onClick={() => { setCreating(false) }}>取消</button>
              <button className={css.primaryButton} type="submit">创建用户</button>
            </div>
          </form>
        </div>
      )}
      {resetting !== undefined && (
        <div className={css.modalBackdrop} role="presentation" onMouseDown={(event) => {
          if (event.currentTarget === event.target) setResetting(undefined)
        }}>
          <form className={css.modal} onSubmit={reset}>
            <h2>重置本地密码</h2>
            <p>为 {resetting.displayName} 设置新密码。保存后会撤销该用户的全部现有登录会话。</p>
            <label>
              <span>新密码</span>
              <input
                required
                type="password"
                minLength={10}
                value={resetPassword}
                onChange={(event) => { setResetPassword(event.target.value) }}
                autoFocus
              />
            </label>
            <div className={css.modalActions}>
              <button type="button" onClick={() => { setResetting(undefined) }}>取消</button>
              <button className={css.primaryButton} type="submit">确认重置</button>
            </div>
          </form>
        </div>
      )}
    </main>
  )
}
