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
import type { WebTranslate } from './locales.ts'

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
    const message = (body as ApiErrorBody).error?.message ?? String(response.status)
    throw new Error(message)
  }
  return body as T
}

function relativeTime(timestamp: number | string | undefined, t: WebTranslate): string {
  if (timestamp === undefined) return t('time.never')
  const time = typeof timestamp === 'number' ? timestamp : Date.parse(timestamp)
  const delta = Date.now() - time
  if (!Number.isFinite(delta) || delta < 0) return t('time.now')
  const minutes = Math.floor(delta / 60_000)
  if (minutes < 1) return t('time.now')
  if (minutes < 60) return t('time.minutesAgo', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('time.hoursAgo', { count: hours })
  const days = Math.floor(hours / 24)
  return days < 30 ? t('time.daysAgo', { count: days }) : new Date(time).toLocaleDateString()
}

type PortalView = 'projects' | 'runtime' | 'settings' | 'admin' | 'system'

const PORTAL_VIEWS = new Set<PortalView>(['projects', 'runtime', 'settings', 'admin', 'system'])

function initialPortalView(): PortalView {
  if (typeof location === 'undefined') return 'projects'
  const requested = new URLSearchParams(location.search).get('view')
  return requested !== null && PORTAL_VIEWS.has(requested as PortalView)
    ? requested as PortalView
    : 'projects'
}

/** Authenticated product shell for project entry and user administration. */
export interface HarnessPortalProps {
  user: ClientAuthUser
  t: WebTranslate
  renderRuntime(): ReactNode
  openWorkspace(workspaceId: string): void
  startSession(workspaceId?: string): void
  onLogout(): Promise<void>
}

export function HarnessPortal(props: HarnessPortalProps) {
  const { t } = props
  const [view, setView] = useState<PortalView>(initialPortalView)
  const [projects, setProjects] = useState<ProjectView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [creating, setCreating] = useState(false)
  const [projectName, setProjectName] = useState('')

  const selectView = useCallback((next: PortalView): void => {
    if (typeof location !== 'undefined') {
      const url = new URL(location.href)
      if (next === 'projects') url.searchParams.delete('view')
      else url.searchParams.set('view', next)
      history.replaceState(history.state, '', url)
    }
    setView(next)
  }, [])

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
    selectView('runtime')
  }

  const newSession = (): void => {
    const first = projects[0]
    if (first === undefined) {
      setCreating(true)
      return
    }
    props.startSession(first.id)
    selectView('runtime')
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
        <button className={css.returnButton} type="button" onClick={() => { selectView('projects') }}>
          {t('nav.backProjects')}
        </button>
        <div className={css.runtimeBody}>{props.renderRuntime()}</div>
      </div>
    )
  }

  const admin = props.user.role === 'admin'
  return (
    <div className={css.shell}>
      <aside className={css.sidebar}>
        <div className={css.wordmark}>{t('brand.name')}</div>
        <button className={css.newSession} type="button" onClick={newSession}><IconNewChatOutline16 size={18} />{t('nav.newSession')}</button>
        <nav aria-label={t('nav.aria')}>
          <button className={view === 'projects' ? css.navActive : css.navItem} type="button" onClick={() => { selectView('projects') }}><IconFolderClose16 size={18} />{t('nav.projects')}</button>
          <button className={css.navItem} type="button" onClick={() => { selectView('runtime') }}><IconNewChatOutline16 size={18} />{t('nav.sessions')}</button>
          <button className={view === 'settings' ? css.navActive : css.navItem} type="button" onClick={() => { selectView('settings') }}><IconSettingsOutline16 size={18} />{t('preferences.title')}</button>
          {admin && (
            <div className={css.adminNav}>
              <div className={css.navLabel}>{t('nav.management')}</div>
              <button className={view === 'admin' ? css.navActive : css.navItem} type="button" onClick={() => { selectView('admin') }}><IconUserOutline16 size={18} />{t('users.title')}</button>
              <button className={view === 'system' ? css.navActive : css.navItem} type="button" onClick={() => { selectView('system') }}><IconSettingsOutline16 size={18} />{t('system.title')}</button>
            </div>
          )}
        </nav>
        <div className={css.account}>
          <div className={css.avatar}>{props.user.displayName.slice(0, 1).toUpperCase()}</div>
          <div className={css.accountText}>
            <strong>{props.user.displayName}</strong>
            <span>{admin ? t('role.admin') : t('role.user')}</span>
          </div>
          <button type="button" onClick={() => { void props.onLogout() }}>{t('action.logout')}</button>
        </div>
      </aside>

      {view === 'admin' && admin
        ? <AdminView currentUser={props.user} t={t} />
        : view === 'system' && admin
          ? <SystemSettingsView t={t} />
          : view === 'settings'
            ? <UserSettingsView t={t} />
            : (
              <main className={css.main}>
                <header className={css.pageHeader}>
                  <div>
                    <h1>{t('projects.title')}</h1>
                    <p>{t('projects.lead')}</p>
                  </div>
                  <button className={css.primaryButton} type="button" onClick={() => { setCreating(true) }}>{t('projects.new')}</button>
                </header>

                <div className={css.infoStrip}>{t('projects.managedNotice')}</div>
                {error !== undefined && <div className={css.pageError} role="alert">{error}</div>}

                <section className={css.section} aria-labelledby="project-list-title">
                  <h2 id="project-list-title">{t('projects.recent')}</h2>
                  <div className={css.projectList}>
                    {loading && <div className={css.empty}>{t('projects.loading')}</div>}
                    {!loading && projects.length === 0 && <div className={css.empty}>{t('projects.empty')}</div>}
                    {projects.map(project => (
                      <button className={css.projectRow} type="button" key={project.id} onClick={() => { openProject(project) }}>
                        <span className={css.projectMark}><IconFolderClose16 size={20} /></span>
                        <span className={css.projectMain}>
                          <strong>{project.name}</strong>
                          <span>{t('projects.autoManaged')} {project.sessionCount} {t('projects.sessionCount')}</span>
                        </span>
                        <span className={css.projectTime}>{relativeTime(project.updatedAt, t)}</span>
                        <span className={css.openText}>{t('action.open')} <IconChevronRightOutline14 size={14} /></span>
                      </button>
                    ))}
                  </div>
                </section>

                <section className={css.section} aria-labelledby="recent-title">
                  <h2 id="recent-title">{t('projects.recentSessions')}</h2>
                  <div className={css.recentGrid}>
                    {projects.filter(project => project.sessionCount > 0).slice(0, 3).map(project => (
                      <button type="button" key={project.id} onClick={() => { openProject(project) }}>
                        <strong>{project.name}</strong>
                        <span>{project.sessionCount} {t('projects.sessionCountSeparator')} {relativeTime(project.updatedAt, t)}</span>
                      </button>
                    ))}
                    {!loading && projects.every(project => project.sessionCount === 0) && <span className={css.muted}>{t('projects.noSessions')}</span>}
                  </div>
                </section>
              </main>
            )}

      {creating && (
        <div className={css.modalBackdrop} role="presentation" onMouseDown={(event) => {
          if (event.currentTarget === event.target) setCreating(false)
        }}>
          <form className={css.modal} onSubmit={createProject}>
            <h2>{t('projects.new')}</h2>
            <p>{t('projects.dialogLead')}</p>
            <label>
              <span>{t('projects.name')}</span>
              <input value={projectName} onChange={(event) => { setProjectName(event.target.value) }} autoFocus maxLength={80} />
            </label>
            <div className={css.modalActions}>
              <button type="button" onClick={() => { setCreating(false) }}>{t('action.cancel')}</button>
              <button className={css.primaryButton} type="submit">{t('projects.create')}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

function UserSettingsView({ t }: { t: WebTranslate }) {
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
      setNotice(enabled ? t('preferences.enabledNotice') : t('preferences.disabledNotice'))
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => { setSaving(false) })
  }

  return (
    <main className={css.main}>
      <header className={css.pageHeader}>
        <div><h1>{t('preferences.title')}</h1><p>{t('preferences.lead')}</p></div>
        <button className={css.secondaryButton} type="button" disabled={loading || saving} onClick={() => { void refresh() }}>
          {loading ? t('action.refreshing') : t('action.refresh')}
        </button>
      </header>
      <div className={css.infoStrip}>{t('preferences.secretNotice')}</div>
      {error !== undefined && <div className={css.pageError} role="alert">{error}</div>}
      {notice !== undefined && <div className={css.pageNotice} role="status">{notice}</div>}
      {preference === undefined && loading && <div className={css.settingsLoading}>{t('preferences.loading')}</div>}
      {preference !== undefined && (
        <section className={css.preferenceCard} aria-labelledby="shared-deepseek-user-title">
          <div className={css.preferenceHeader}>
            <div>
              <span className={css.eyebrow}>{t('preferences.modelTitle')}</span>
              <h2 id="shared-deepseek-user-title">{preference.name}</h2>
              <p>{t('preferences.modelDescription')}</p>
            </div>
            <span className={preference.configured ? css.stateReady : css.statePending}>
              {preference.configured ? t('preferences.adminConfigured') : t('preferences.adminNotConfigured')}
            </span>
          </div>
          <div className={css.preferenceRow}>
            <div>
              <strong>{t('preferences.useShared')}</strong>
              <span>{preference.enabled ? t('preferences.enabledHelp') : t('preferences.disabledHelp')}</span>
            </div>
            <label className={css.toggleLabel}>
              <input
                type="checkbox"
                checked={preference.enabled}
                disabled={(!preference.configured && !preference.enabled) || saving}
                onChange={(event) => { setEnabled(event.target.checked) }}
              />
              <span>{saving ? t('action.saving') : preference.enabled ? t('state.enabled') : t('state.disabled')}</span>
            </label>
          </div>
        </section>
      )}
    </main>
  )
}

function formatBytes(bytes: number, t: WebTranslate): string {
  if (bytes < 1024) return `${String(bytes)} ${t('units.bytes')}`
  return `${String(Math.round(bytes / 1024))} ${t('units.kibibytes')}`
}

function SystemSettingsView({ t }: { t: WebTranslate }) {
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
      setNotice(t('shared.savedNotice'))
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
      setNotice(t('shared.removedNotice'))
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
        ? t('oidc.savedEnabledNotice')
        : t('oidc.savedInactiveNotice'))
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
        ? t('oidc.testPkceNotice')
        : t('oidc.testNoPkceNotice'))
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => { setOidcTesting(false) })
  }

  return (
    <main className={css.main}>
      <header className={css.pageHeader}>
        <div><h1>{t('system.title')}</h1><p>{t('system.lead')}</p></div>
        <button className={css.secondaryButton} type="button" disabled={loading || saving || oidcSaving || oidcTesting} onClick={() => { void refresh() }}>
          {loading ? t('action.refreshing') : t('action.refresh')}
        </button>
      </header>
      <div className={css.infoStrip}>{t('system.secretNotice')}</div>
      {error !== undefined && <div className={css.pageError} role="alert">{error}</div>}
      {notice !== undefined && <div className={css.pageNotice} role="status">{notice}</div>}
      {settings === undefined && loading && <div className={css.settingsLoading}>{t('system.loading')}</div>}
      {settings !== undefined && (
        <>
          <section className={css.settingsSection} aria-labelledby="shared-deepseek-admin-title">
            <div className={css.sectionHeading}>
              <div><h2 id="shared-deepseek-admin-title">{t('shared.title')}</h2><p>{t('shared.description')}</p></div>
              <span className={settings.sharedDeepSeek.configured ? css.stateReady : css.statePending}>
                {settings.sharedDeepSeek.configured ? t('state.configured') : t('state.notConfigured')}
              </span>
            </div>
            <div className={css.credentialPanel}>
              <div className={css.credentialSummary}>
                <div><span>{t('shared.fixedModel')}</span><strong>{settings.sharedDeepSeek.name}</strong></div>
                <div><span>{t('shared.enabledUsers')}</span><strong>{settings.sharedDeepSeek.enabledUsers}</strong></div>
                <div><span>{t('shared.writable')}</span><strong>{settings.sharedDeepSeek.writable ? t('action.yes') : t('action.no')}</strong></div>
              </div>
              <form className={css.credentialForm} onSubmit={saveSharedCredential}>
                <label htmlFor="shared-deepseek-api-key">{settings.sharedDeepSeek.configured ? t('shared.replaceApiKey') : t('shared.setApiKey')}</label>
                <div>
                  <input
                    id="shared-deepseek-api-key"
                    type="password"
                    autoComplete="off"
                    value={apiKey}
                    disabled={!settings.sharedDeepSeek.writable || saving}
                    placeholder={settings.sharedDeepSeek.configured ? t('shared.replacePlaceholder') : t('shared.setPlaceholder')}
                    onChange={(event) => { setApiKey(event.target.value) }}
                  />
                  <button className={css.primaryButton} type="submit" disabled={!settings.sharedDeepSeek.writable || saving || apiKey.trim().length === 0}>
                    {saving ? t('action.saving') : settings.sharedDeepSeek.configured ? t('shared.replaceKey') : t('shared.saveKey')}
                  </button>
                  {settings.sharedDeepSeek.configured && (
                    <button className={css.dangerButton} type="button" disabled={!settings.sharedDeepSeek.writable || saving} onClick={clearSharedCredential}>
                      {t('shared.removeKey')}
                    </button>
                  )}
                </div>
              </form>
            </div>
          </section>

          <section className={css.settingsSection} aria-labelledby="oidc-settings-title">
            <div className={css.sectionHeading}>
              <div><h2 id="oidc-settings-title">{t('oidc.title')}</h2><p>{t('oidc.description')}</p></div>
              <span className={settings.authentication.oidc.configured ? css.stateReady : css.statePending}>
                {settings.authentication.oidc.configured
                  ? t('state.enabled')
                  : settings.authentication.oidc.settings === undefined ? t('state.notConfigured') : t('oidc.savedDisabled')}
              </span>
            </div>
            <form className={css.oidcPanel} onSubmit={saveOidc}>
              <div className={css.oidcToggleRow}>
                <div><strong>{t('oidc.allowSso')}</strong><span>{t('oidc.disabledHelp')}</span></div>
                <label className={css.toggleLabel}>
                  <input
                    type="checkbox"
                    aria-label={t('oidc.allowSso')}
                    checked={oidcDraft.enabled}
                    onChange={(event) => { setOidcDraft({ ...oidcDraft, enabled: event.target.checked }) }}
                  />
                  <span>{oidcDraft.enabled ? t('action.enable') : t('action.disable')}</span>
                </label>
              </div>
              <div className={css.oidcFormGrid}>
                <label className={css.oidcWideField}>
                  <span>{t('oidc.issuerUrl')}</span>
                  <input
                    required
                    type="url"
                    aria-label={t('oidc.issuerUrl')}
                    value={oidcDraft.issuer}
                    placeholder={t('oidc.issuerPlaceholder')}
                    onChange={(event) => { setOidcDraft({ ...oidcDraft, issuer: event.target.value }) }}
                  />
                  <small>{t('oidc.discoveryHelp')} <code>{t('oidc.discoveryPath')}</code>。</small>
                </label>
                <label>
                  <span>{t('oidc.clientId')}</span>
                  <input
                    required
                    aria-label={t('oidc.clientId')}
                    value={oidcDraft.clientId}
                    autoComplete="off"
                    onChange={(event) => { setOidcDraft({ ...oidcDraft, clientId: event.target.value }) }}
                  />
                </label>
                <label>
                  <span>{t('oidc.tokenAuth')}</span>
                  <select
                    aria-label={t('oidc.tokenAuth')}
                    value={oidcDraft.clientAuthMethod}
                    onChange={(event) => { setOidcDraft({ ...oidcDraft, clientAuthMethod: event.target.value as OidcClientAuthMethod }) }}
                  >
                    <option value="client_secret_basic">client_secret_basic</option>
                    <option value="client_secret_post">client_secret_post</option>
                    <option value="none">{t('oidc.publicClient')}</option>
                  </select>
                </label>
                <label className={css.oidcWideField}>
                  <span>{settings.authentication.oidc.clientSecretConfigured ? t('oidc.replaceSecret') : t('oidc.clientSecret')}</span>
                  <input
                    type="password"
                    aria-label={settings.authentication.oidc.clientSecretConfigured ? t('oidc.replaceSecret') : t('oidc.clientSecret')}
                    autoComplete="new-password"
                    value={oidcSecret}
                    disabled={oidcDraft.clientAuthMethod === 'none' || !settings.authentication.oidc.clientSecretWritable}
                    placeholder={oidcDraft.clientAuthMethod === 'none'
                      ? t('oidc.noSecretPlaceholder')
                      : settings.authentication.oidc.clientSecretConfigured ? t('oidc.keepSecretPlaceholder') : t('oidc.secretPlaceholder')}
                    onChange={(event) => { setOidcSecret(event.target.value) }}
                  />
                  <small>{t('oidc.secretStatus')}{settings.authentication.oidc.clientSecretConfigured ? t('state.configured') : t('state.notConfigured')}。</small>
                </label>
                <label className={css.oidcWideField}>
                  <span>{t('oidc.redirectUri')}</span>
                  <input
                    required
                    type="url"
                    aria-label={t('oidc.redirectUri')}
                    value={oidcDraft.redirectUri}
                    onChange={(event) => { setOidcDraft({ ...oidcDraft, redirectUri: event.target.value }) }}
                  />
                  <small>{t('oidc.redirectHelp')} <code>{t('oidc.callbackPath')}</code>。</small>
                </label>
                <label>
                  <span>{t('oidc.scopes')}</span>
                  <input
                    required
                    aria-label={t('oidc.scopes')}
                    value={oidcDraft.scopes}
                    onChange={(event) => { setOidcDraft({ ...oidcDraft, scopes: event.target.value }) }}
                  />
                  <small>{t('oidc.scopesMinimum')} <code>{t('oidc.openid')}</code>{t('oidc.scopesRecommendation')}</small>
                </label>
                <label>
                  <span>{t('oidc.adminGroup')}</span>
                  <input
                    aria-label={t('oidc.adminGroup')}
                    value={oidcDraft.administratorGroup}
                    placeholder="super_admin"
                    onChange={(event) => { setOidcDraft({ ...oidcDraft, administratorGroup: event.target.value }) }}
                  />
                  <small>{t('oidc.adminGroupHelp')}</small>
                </label>
              </div>
              <label className={css.oidcCheckRow}>
                <input
                  type="checkbox"
                  aria-label={t('oidc.allowHttp')}
                  checked={oidcDraft.allowInsecureIssuer}
                  onChange={(event) => { setOidcDraft({ ...oidcDraft, allowInsecureIssuer: event.target.checked }) }}
                />
                <span><strong>{t('oidc.allowHttp')}</strong>{t('oidc.allowHttpHelp')}</span>
              </label>
              {oidcTest !== undefined && (
                <dl className={css.oidcTestResult}>
                  <div><dt>{t('oidc.discoveryResult')}</dt><dd>{oidcTest.ok ? t('oidc.connectionSuccess') : t('oidc.connectionFailure')}</dd></div>
                  <div><dt>{t('oidc.issuer')}</dt><dd><code>{oidcTest.issuer}</code></dd></div>
                  <div><dt>{t('oidc.pkce')}</dt><dd>{oidcTest.supportsPkceS256 ? t('oidc.supported') : t('oidc.notDeclared')}</dd></div>
                </dl>
              )}
              <div className={css.oidcActions}>
                <button
                  className={css.secondaryButton}
                  type="button"
                  disabled={oidcSaving || oidcTesting || settings.authentication.oidc.settings === undefined}
                  onClick={testOidc}
                >
                  {oidcTesting ? t('oidc.testing') : t('oidc.testSaved')}
                </button>
                <button className={css.primaryButton} type="submit" disabled={oidcSaving || oidcTesting}>
                  {oidcSaving ? t('action.saving') : t('oidc.save')}
                </button>
              </div>
            </form>
          </section>

          <section className={css.settingsSection} aria-labelledby="runtime-settings-title">
            <div className={css.sectionHeading}>
              <div><h2 id="runtime-settings-title">{t('runtime.title')}</h2><p>{t('runtime.description')}</p></div>
              <span className={css.readonlyBadge}>{t('state.readOnly')}</span>
            </div>
            <div className={css.metricGrid}>
              <article><span>{t('runtime.mode')}</span><strong>{t('runtime.singleProcess')}</strong></article>
              <article><span>{t('runtime.persistence')}</span><strong>{t('runtime.fileStorage')}</strong></article>
              <article><span>{t('runtime.activeUsers')}</span><strong>{settings.users.active} / {settings.users.total}</strong></article>
              <article><span>{t('role.admin')}</span><strong>{settings.users.administrators}</strong></article>
            </div>
          </section>

          <section className={css.settingsSection} aria-labelledby="authentication-settings-title">
            <div className={css.sectionHeading}><div><h2 id="authentication-settings-title">{t('auth.title')}</h2><p>{t('auth.description')}</p></div></div>
            <dl className={css.settingsList}>
              <div><dt>{t('auth.enterpriseOidc')}</dt><dd><span className={settings.authentication.oidcConfigured ? css.stateReady : css.statePending}>{settings.authentication.oidcConfigured ? t('state.enabled') : t('state.disabled')}</span></dd></div>
              <div><dt>{t('auth.localLogin')}</dt><dd>{settings.authentication.localLoginEnabled ? t('state.enabled') : t('state.disabled')}</dd></div>
              <div><dt>{t('auth.cookie')}</dt><dd><code>{settings.authentication.cookie.name}</code></dd></div>
              <div><dt>{t('auth.cookieSecurity')}</dt><dd>{[
                settings.authentication.cookie.httpOnly ? 'HttpOnly' : undefined,
                `SameSite=${settings.authentication.cookie.sameSite}`,
                settings.authentication.cookie.secure ? 'Secure' : t('auth.secureDisabled'),
              ].filter(value => value !== undefined).join(' · ')}</dd></div>
            </dl>
          </section>

          <section className={css.settingsSection} aria-labelledby="storage-settings-title">
            <div className={css.sectionHeading}><div><h2 id="storage-settings-title">{t('isolation.title')}</h2><p>{t('isolation.description')}</p></div></div>
            <dl className={css.settingsList}>
              <div><dt>{t('isolation.dataRoot')}</dt><dd><code className={css.pathValue}>{settings.runtime.dataRoot}</code></dd></div>
              <div><dt>{t('isolation.userDirectoryKey')}</dt><dd>{t('isolation.stableUserId')}</dd></div>
              <div><dt>{t('isolation.projectDirectory')}</dt><dd>{settings.isolation.projectsManaged ? t('isolation.managed') : t('isolation.userSelected')}</dd></div>
              <div><dt>{t('isolation.adminAccess')}</dt><dd>{settings.isolation.administratorContentAccess ? t('isolation.canView') : t('isolation.metadataOnly')}</dd></div>
              <div><dt>{t('isolation.requestLimit')}</dt><dd>{formatBytes(settings.limits.maxBodyBytes, t)}</dd></div>
            </dl>
          </section>
        </>
      )}
    </main>
  )
}

function AdminView({ currentUser, t }: { currentUser: ClientAuthUser; t: WebTranslate }) {
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
      setNotice(t('users.resetNotice', { displayName: resetting.displayName }))
      setResetting(undefined)
      setResetPassword('')
      setError(undefined)
    }).catch((reason: unknown) => { setError(reason instanceof Error ? reason.message : String(reason)) })
  }

  return (
    <main className={css.main}>
      <header className={css.pageHeader}>
        <div><h1>{t('users.title')}</h1><p>{t('users.description')}</p></div>
        <button className={css.primaryButton} type="button" onClick={() => { setCreating(true) }}>{t('users.newLocal')}</button>
      </header>
      <div className={css.infoStrip}>{t('users.oidcNotice')}</div>
      {error !== undefined && <div className={css.pageError} role="alert">{error}</div>}
      {notice !== undefined && <div className={css.pageNotice} role="status">{notice}</div>}
      <div className={css.filters}>
        <input placeholder={t('users.search')} value={query} onChange={(event) => { setQuery(event.target.value) }} />
        <select value={role} onChange={(event) => { setRole(event.target.value as typeof role) }}>
          <option value="all">{t('users.allRoles')}</option>
          <option value="admin">{t('role.admin')}</option>
          <option value="user">{t('role.user')}</option>
        </select>
      </div>
      <div className={css.tableWrap}>
        <table>
          <thead><tr><th>{t('users.user')}</th><th>{t('users.authMethod')}</th><th>{t('users.role')}</th><th>{t('users.status')}</th><th>{t('users.lastLogin')}</th><th>{t('users.actions')}</th></tr></thead>
          <tbody>
            {filtered.map(user => (
              <tr key={user.id}>
                <td><strong>{user.displayName}</strong><span>@{user.username}</span></td>
                <td>{user.authMethods.map(method => method === 'local' ? t('auth.local') : 'OIDC').join(' / ')}</td>
                <td>
                  <select
                    value={user.role}
                    disabled={user.id === currentUser.id}
                    onChange={(event) => { update(user, { role: event.target.value }) }}
                  >
                    <option value="admin">{t('role.admin')}</option>
                    <option value="user">{t('role.user')}</option>
                  </select>
                </td>
                <td><span className={user.status === 'active' ? css.statusActive : css.statusDisabled}>{user.status === 'active' ? t('action.enable') : t('action.disable')}</span></td>
                <td>{relativeTime(user.lastLoginAt, t)}</td>
                <td>
                  <div className={css.tableActions}>
                    {user.authMethods.includes('local') && (
                      <button type="button" disabled={user.id === currentUser.id} onClick={() => { setResetting(user); setResetPassword('') }}>
                        {t('users.resetPassword')}
                      </button>
                    )}
                    <button type="button" disabled={user.id === currentUser.id} onClick={() => { update(user, { status: user.status === 'active' ? 'disabled' : 'active' }) }}>
                      {user.status === 'active' ? t('action.disable') : t('action.enable')}
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
            <h2>{t('users.newLocal')}</h2>
            <p>{t('users.newDescription')}</p>
            <label>
              <span>{t('users.username')}</span>
              <input
                required
                minLength={3}
                value={draft.username}
                onChange={(event) => { setDraft({ ...draft, username: event.target.value }) }}
                autoFocus
              />
            </label>
            <label>
              <span>{t('users.displayName')}</span>
              <input
                value={draft.displayName}
                onChange={(event) => { setDraft({ ...draft, displayName: event.target.value }) }}
              />
            </label>
            <label>
              <span>{t('users.initialPassword')}</span>
              <input
                required
                type="password"
                minLength={10}
                value={draft.password}
                onChange={(event) => { setDraft({ ...draft, password: event.target.value }) }}
              />
            </label>
            <label>
              <span>{t('users.role')}</span>
              <select
                value={draft.role}
                onChange={(event) => { setDraft({ ...draft, role: event.target.value as 'admin' | 'user' }) }}
              >
                <option value="user">{t('role.user')}</option>
                <option value="admin">{t('role.admin')}</option>
              </select>
            </label>
            <div className={css.modalActions}>
              <button type="button" onClick={() => { setCreating(false) }}>{t('action.cancel')}</button>
              <button className={css.primaryButton} type="submit">{t('users.create')}</button>
            </div>
          </form>
        </div>
      )}
      {resetting !== undefined && (
        <div className={css.modalBackdrop} role="presentation" onMouseDown={(event) => {
          if (event.currentTarget === event.target) setResetting(undefined)
        }}>
          <form className={css.modal} onSubmit={reset}>
            <h2>{t('users.resetTitle')}</h2>
            <p>{t('users.forPrefix')} {resetting.displayName} {t('users.resetDescription')}</p>
            <label>
              <span>{t('users.newPassword')}</span>
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
              <button type="button" onClick={() => { setResetting(undefined) }}>{t('action.cancel')}</button>
              <button className={css.primaryButton} type="submit">{t('users.confirmReset')}</button>
            </div>
          </form>
        </div>
      )}
    </main>
  )
}
