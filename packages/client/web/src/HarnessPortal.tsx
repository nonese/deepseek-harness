import {
  useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore,
  type DragEvent, type FormEvent, type ReactNode,
} from 'react'
import {
  IconChevronRightOutline14,
  IconCloseOutline16,
  IconFolderClose16,
  IconFolderOpenOutline16,
  IconNewChatOutline16,
  IconSettingsOutline16,
  IconUserOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ClientAuthUser } from './auth-state.ts'
import { ProjectFileBrowser, uploadProjectFile } from './ProjectFileBrowser.tsx'
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

interface ManagedModelSiteStatus {
  id: string
  kind: 'deepseek-official' | 'openai-compatible'
  provider: string
  name: string
  baseURL: string
  models: readonly { id: string; name: string }[]
  availableModels: readonly { id: string; name: string }[]
  configured: boolean
  writable: boolean
  modelSelectionWritable: boolean
}

interface ManagedModelsStatus {
  configured: boolean
  sites: readonly ManagedModelSiteStatus[]
  enabled?: boolean
  enabledUsers?: number
}

interface PreferencesResponse {
  managedModels: ManagedModelsStatus & { enabled: boolean }
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
  managedModels: ManagedModelsStatus & { enabledUsers: number }
  limits: {
    maxBodyBytes: number
    projectFileMaxEntries: number
    projectFilePreviewMaxBytes: number
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

function workspaceFileTransfer(event: DragEvent<HTMLElement>): DataTransfer | undefined {
  const transfer = event.dataTransfer
  if (!transfer.types.includes('Files')) return undefined
  const items = Array.from(transfer.items).filter(item => item.kind === 'file')
  if (items.length > 0) {
    return items.every(item => item.type.startsWith('image/')) ? undefined : transfer
  }
  const files = Array.from(transfer.files)
  return files.length > 0 && files.every(file => file.type.startsWith('image/')) ? undefined : transfer
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
  activeWorkspace?: ActiveWorkspaceSource
  openWorkspace(workspaceId: string): void
  startSession(workspaceId?: string): void
  onLogout(): Promise<void>
}

/** Current runtime Workspace projection supplied by the activated client Controllers. */
export interface ActiveWorkspaceSource {
  getSnapshot(): string | undefined
  subscribe(listener: () => void): () => void
}

const EMPTY_ACTIVE_WORKSPACE: ActiveWorkspaceSource = {
  getSnapshot: () => undefined,
  subscribe: () => () => {},
}

export function HarnessPortal(props: HarnessPortalProps) {
  const { t } = props
  const [view, setView] = useState<PortalView>(initialPortalView)
  const [projects, setProjects] = useState<ProjectView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [creating, setCreating] = useState(false)
  const [projectName, setProjectName] = useState('')
  const [browsingProject, setBrowsingProject] = useState<ProjectView>()
  const [pendingWorkspaceId, setPendingWorkspaceId] = useState<string>()
  const [runtimeFilesOpen, setRuntimeFilesOpen] = useState(true)
  const [runtimeFilesRevision, setRuntimeFilesRevision] = useState(0)
  const [runtimeDragActive, setRuntimeDragActive] = useState(false)
  const [runtimeUploading, setRuntimeUploading] = useState(false)
  const [runtimeUploadStatus, setRuntimeUploadStatus] = useState<{
    kind: 'success' | 'error'
    text: string
  }>()
  const runtimeDragDepth = useRef(0)
  const runtimeUploadController = useRef<AbortController>()
  const activeWorkspace = props.activeWorkspace ?? EMPTY_ACTIVE_WORKSPACE
  const activeWorkspaceId = useSyncExternalStore(
    listener => activeWorkspace.subscribe(listener),
    () => activeWorkspace.getSnapshot(),
    () => activeWorkspace.getSnapshot(),
  )
  const runtimeProjectId = activeWorkspaceId ?? pendingWorkspaceId
  const runtimeProject = useMemo(
    () => projects.find(project => project.id === runtimeProjectId),
    [projects, runtimeProjectId],
  )

  useEffect(() => {
    runtimeUploadController.current?.abort()
    runtimeUploadController.current = undefined
    runtimeDragDepth.current = 0
    setRuntimeDragActive(false)
    setRuntimeUploading(false)
    setRuntimeUploadStatus(undefined)
    return () => { runtimeUploadController.current?.abort() }
  }, [runtimeProjectId])

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
    setPendingWorkspaceId(project.id)
    props.openWorkspace(project.id)
    selectView('runtime')
  }

  const newSession = (): void => {
    const first = projects[0]
    if (first === undefined) {
      setCreating(true)
      return
    }
    setPendingWorkspaceId(first.id)
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

  const uploadRuntimeFiles = async (files: readonly File[]): Promise<void> => {
    const project = runtimeProject
    if (project === undefined || files.length === 0) return
    const controller = new AbortController()
    runtimeUploadController.current?.abort()
    runtimeUploadController.current = controller
    setRuntimeUploading(true)
    setRuntimeUploadStatus(undefined)
    let uploaded = 0
    try {
      for (const file of files) {
        await uploadProjectFile(project.id, '', file, controller.signal, t)
        uploaded += 1
      }
      setRuntimeUploadStatus({
        kind: 'success',
        text: t('projectFiles.conversationUploadComplete', { count: uploaded, name: project.name }),
      })
      setRuntimeFilesRevision(value => value + 1)
      setRuntimeFilesOpen(true)
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
        setRuntimeUploadStatus({
          kind: 'error',
          text: reason instanceof Error ? reason.message : String(reason),
        })
        if (uploaded > 0) setRuntimeFilesRevision(value => value + 1)
      }
    } finally {
      if (runtimeUploadController.current === controller) runtimeUploadController.current = undefined
      if (!controller.signal.aborted) setRuntimeUploading(false)
    }
  }

  const enterRuntimeFileDrag = (event: DragEvent<HTMLElement>): void => {
    if (runtimeProject === undefined || workspaceFileTransfer(event) === undefined) return
    event.preventDefault()
    event.stopPropagation()
    runtimeDragDepth.current += 1
    setRuntimeUploadStatus(undefined)
    setRuntimeDragActive(true)
  }

  const continueRuntimeFileDrag = (event: DragEvent<HTMLElement>): void => {
    const transfer = workspaceFileTransfer(event)
    if (runtimeProject === undefined || transfer === undefined) return
    event.preventDefault()
    event.stopPropagation()
    transfer.dropEffect = 'copy'
  }

  const leaveRuntimeFileDrag = (event: DragEvent<HTMLElement>): void => {
    if (runtimeProject === undefined || workspaceFileTransfer(event) === undefined) return
    event.preventDefault()
    event.stopPropagation()
    runtimeDragDepth.current = Math.max(0, runtimeDragDepth.current - 1)
    if (runtimeDragDepth.current === 0) setRuntimeDragActive(false)
  }

  const dropRuntimeFiles = (event: DragEvent<HTMLElement>): void => {
    if (runtimeProject === undefined || workspaceFileTransfer(event) === undefined) return
    event.preventDefault()
    event.stopPropagation()
    runtimeDragDepth.current = 0
    setRuntimeDragActive(false)
    void uploadRuntimeFiles(Array.from(event.dataTransfer.files))
  }

  if (view === 'runtime') {
    return (
      <div className={css.runtime}>
        <button className={css.returnButton} type="button" onClick={() => { selectView('projects') }}>
          {t('nav.backProjects')}
        </button>
        <div className={css.runtimeLayout}>
          <div
            className={css.runtimeBody}
            role="region"
            aria-label={t('runtime.conversationArea')}
            onDragEnter={enterRuntimeFileDrag}
            onDragOver={continueRuntimeFileDrag}
            onDragLeave={leaveRuntimeFileDrag}
            onDrop={dropRuntimeFiles}
          >
            {props.renderRuntime()}
            {(runtimeDragActive || runtimeUploading) && runtimeProject !== undefined && (
              <div className={css.runtimeDropOverlay} role="status">
                <span className={css.runtimeDropIcon}><IconFolderOpenOutline16 size={28} /></span>
                <strong>{runtimeUploading
                  ? t('projectFiles.conversationUploading', { name: runtimeProject.name })
                  : t('projectFiles.conversationDropUpload')}</strong>
                <span>{t('projectFiles.conversationDropDestination', { name: runtimeProject.name })}</span>
                <small>{t('projectFiles.dropOfficeFormats')}</small>
              </div>
            )}
            {runtimeUploadStatus !== undefined && !runtimeUploading && (
              <div
                className={runtimeUploadStatus.kind === 'error'
                  ? `${css.runtimeUploadStatus} ${css.runtimeUploadError}`
                  : css.runtimeUploadStatus}
                role={runtimeUploadStatus.kind === 'error' ? 'alert' : 'status'}
              >
                {runtimeUploadStatus.text}
              </div>
            )}
          </div>
          {runtimeFilesOpen
            ? (
              <aside className={css.runtimeFilePanel}>
                {runtimeProject === undefined
                  ? (
                    <section className={css.runtimeFileEmpty} aria-label={t('projectFiles.currentTitle')}>
                      <header>
                        <div><IconFolderOpenOutline16 size={18} /><strong>{t('projectFiles.currentTitle')}</strong></div>
                        <button type="button" aria-label={t('projectFiles.collapse')}
                          onClick={() => { setRuntimeFilesOpen(false) }}><IconCloseOutline16 size={16} /></button>
                      </header>
                      <p>{loading ? t('projects.loading') : t('projectFiles.noCurrentProject')}</p>
                    </section>
                  )
                  : (
                    <ProjectFileBrowser
                      key={runtimeProject.id}
                      variant="panel"
                      project={runtimeProject}
                      t={t}
                      refreshRevision={runtimeFilesRevision}
                      onClose={() => { setRuntimeFilesOpen(false) }}
                    />
                  )}
              </aside>
            )
            : (
              <button className={css.runtimeFileExpand} type="button" aria-label={t('projectFiles.expand')}
                title={t('projectFiles.expand')} onClick={() => { setRuntimeFilesOpen(true) }}>
                <IconFolderOpenOutline16 size={17} /><span>{t('projects.files')}</span>
              </button>
            )}
        </div>
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
                      <div className={css.projectRow} key={project.id}>
                        <button className={css.projectOpen} type="button" onClick={() => { openProject(project) }}>
                          <span className={css.projectMark}><IconFolderClose16 size={20} /></span>
                          <span className={css.projectMain}>
                            <strong>{project.name}</strong>
                            <span>{t('projects.autoManaged')} {project.sessionCount} {t('projects.sessionCount')}</span>
                          </span>
                        </button>
                        <span className={css.projectTime}>{relativeTime(project.updatedAt, t)}</span>
                        <button className={css.fileText} type="button" onClick={() => { setBrowsingProject(project) }}>
                          <IconFolderClose16 size={15} />{t('projects.files')}
                        </button>
                        <button className={css.openText} type="button" onClick={() => { openProject(project) }}>
                          {t('action.open')} <IconChevronRightOutline14 size={14} />
                        </button>
                      </div>
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
      {browsingProject !== undefined && (
        <ProjectFileBrowser
          key={browsingProject.id}
          project={browsingProject}
          t={t}
          onClose={() => { setBrowsingProject(undefined) }}
        />
      )}
    </div>
  )
}

function UserSettingsView({ t }: { t: WebTranslate }) {
  const [preference, setPreference] = useState<PreferencesResponse['managedModels']>()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(undefined)
    try {
      setPreference((await jsonRequest<PreferencesResponse>('/auth/preferences')).managedModels)
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
      body: JSON.stringify({ managedModelsEnabled: enabled }),
    }).then((response) => {
      setPreference(response.managedModels)
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
        <section className={css.preferenceCard} aria-labelledby="managed-models-user-title">
          <div className={css.preferenceHeader}>
            <div>
              <span className={css.eyebrow}>{t('preferences.modelTitle')}</span>
              <h2 id="managed-models-user-title">{t('preferences.modelHeading')}</h2>
              <p>{t('preferences.modelDescription')}</p>
            </div>
            <span className={preference.configured ? css.stateReady : css.statePending}>
              {preference.configured ? t('preferences.adminConfigured') : t('preferences.adminNotConfigured')}
            </span>
          </div>
          <div className={css.preferenceSites} aria-label={t('preferences.availableSites')}>
            {preference.sites.map(site => (
              <div key={site.id}>
                <strong>{site.name}</strong>
                <span>{site.models.map(model => model.name).join(' · ')}</span>
                <span className={site.configured ? css.stateReady : css.statePending}>
                  {site.configured ? t('state.configured') : t('state.notConfigured')}
                </span>
              </div>
            ))}
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

interface ManagedSiteDraft {
  name: string
  baseURL: string
  models: string[]
  apiKey: string
}

function emptyManagedSiteDraft(): ManagedSiteDraft {
  return { name: '', baseURL: '', models: [], apiKey: '' }
}

function managedSiteDraft(site: ManagedModelSiteStatus, apiKey = ''): ManagedSiteDraft {
  return {
    name: site.name,
    baseURL: site.baseURL,
    models: site.models.map(model => model.id),
    apiKey,
  }
}

function managedSiteDiscoveryReady(draft: ManagedSiteDraft, storedKeyAvailable: boolean): boolean {
  if (!storedKeyAvailable && draft.apiKey.trim().length === 0) return false
  try {
    const url = new URL(draft.baseURL)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.host.length > 0
  } catch {
    return false
  }
}

interface ManagedModelPickerProps {
  disabled: boolean
  discovering: boolean
  models: readonly { id: string; name: string }[]
  selected: readonly string[]
  t: WebTranslate
  onDiscover?: () => void
  onSelected: (models: string[]) => void
}

function ManagedModelPicker({
  disabled,
  discovering,
  models,
  selected,
  t,
  onDiscover,
  onSelected,
}: ManagedModelPickerProps) {
  const selectedSet = new Set(selected)
  return (
    <fieldset className={css.managedModelPicker} disabled={disabled || discovering}>
      <legend>{t('shared.modelIds')}</legend>
      <div className={css.managedModelPickerToolbar}>
        <span>{t('shared.selectedModels', { count: selected.length })}</span>
        <div>
          {onDiscover === undefined
            ? null
            : <button type="button" onClick={onDiscover}>{discovering ? t('shared.loadingModels') : t('shared.loadModels')}</button>}
          <button type="button" disabled={models.length === 0} onClick={() => { onSelected(models.slice(0, 32).map(model => model.id)) }}>{t('shared.selectAllModels')}</button>
          <button type="button" disabled={selected.length === 0} onClick={() => { onSelected([]) }}>{t('shared.clearModels')}</button>
        </div>
      </div>
      {models.length === 0
        ? <p className={css.managedModelPickerEmpty}>{t('shared.modelDiscoveryHelp')}</p>
        : (
          <div className={css.managedModelOptions}>
            {models.map((model) => {
              const checked = selectedSet.has(model.id)
              return (
                <label key={model.id}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!checked && selected.length >= 32}
                    onChange={(event) => {
                      onSelected(event.target.checked
                        ? [...selected, model.id]
                        : selected.filter(id => id !== model.id))
                    }}
                  />
                  <span>{model.name}</span>
                  {model.name !== model.id && <code>{model.id}</code>}
                </label>
              )
            })}
          </div>
        )}
    </fieldset>
  )
}

function SystemSettingsView({ t }: { t: WebTranslate }) {
  const [settings, setSettings] = useState<SystemSettingsResponse>()
  const [apiKey, setApiKey] = useState('')
  const [officialModels, setOfficialModels] = useState<string[]>([])
  const [newSite, setNewSite] = useState<ManagedSiteDraft>(emptyManagedSiteDraft)
  const [siteDrafts, setSiteDrafts] = useState<Record<string, ManagedSiteDraft>>({})
  const [modelOptions, setModelOptions] = useState<Record<string, readonly { id: string; name: string }[]>>({})
  const [discoveringSite, setDiscoveringSite] = useState<string>()
  const discoveryGeneration = useRef<Record<string, number>>({})
  const automaticDiscovery = useRef<Record<string, string>>({})
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
      setOfficialModels(response.managedModels.sites
        .find(site => site.kind === 'deepseek-official')?.models.map(model => model.id) ?? [])
      setOidcDraft(oidcDraftFrom(response.authentication.oidc))
      setSiteDrafts(Object.fromEntries(response.managedModels.sites
        .filter(site => site.kind === 'openai-compatible')
        .map(site => [site.id, managedSiteDraft(site)])))
      setModelOptions(Object.fromEntries(response.managedModels.sites
        .filter(site => site.kind === 'openai-compatible')
        .map(site => [site.id, site.models])))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const updateManagedStatus = (managedModels: ManagedModelsStatus): void => {
    setSettings(current => current === undefined
      ? current
      : { ...current, managedModels: { ...current.managedModels, ...managedModels } })
    setSiteDrafts(current => Object.fromEntries(managedModels.sites
      .filter(site => site.kind === 'openai-compatible')
      .map(site => [site.id, managedSiteDraft(site, current[site.id]?.apiKey ?? '')])))
    setModelOptions(current => Object.fromEntries(managedModels.sites
      .filter(site => site.kind === 'openai-compatible')
      .map(site => [site.id, current[site.id] ?? site.models])))
    setOfficialModels(managedModels.sites
      .find(site => site.kind === 'deepseek-official')?.models.map(model => model.id) ?? [])
  }

  const discoverManagedSite = useCallback(async (
    key: string,
    draft: ManagedSiteDraft,
    siteId?: string,
    force = false,
  ): Promise<void> => {
    if (!managedSiteDiscoveryReady(draft, siteId !== undefined)) return
    const signature = `${draft.baseURL}\u0000${draft.apiKey}`
    if (!force && automaticDiscovery.current[key] === signature) return
    automaticDiscovery.current[key] = signature
    const generation = (discoveryGeneration.current[key] ?? 0) + 1
    discoveryGeneration.current[key] = generation
    setDiscoveringSite(key)
    setError(undefined)
    setNotice(undefined)
    try {
      const response = await jsonRequest<{ models: { id: string; name: string }[] }>('/auth/system/managed-models/discover', {
        method: 'POST',
        body: JSON.stringify({
          baseURL: draft.baseURL,
          ...siteId === undefined ? {} : { siteId },
          ...draft.apiKey.trim().length === 0 ? {} : { apiKey: draft.apiKey },
        }),
      })
      if (discoveryGeneration.current[key] !== generation) return
      const available = new Set(response.models.map(model => model.id))
      setModelOptions(current => ({ ...current, [key]: response.models }))
      if (siteId === undefined) {
        setNewSite(current => ({ ...current, models: current.models.filter(model => available.has(model)) }))
      } else {
        setSiteDrafts((current) => {
          const live = current[siteId]
          return live === undefined
            ? current
            : { ...current, [siteId]: { ...live, models: live.models.filter(model => available.has(model)) } }
        })
      }
      setNotice(t('shared.modelsLoadedNotice', { count: response.models.length }))
    } catch (reason) {
      if (discoveryGeneration.current[key] !== generation) return
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (discoveryGeneration.current[key] === generation) {
        setDiscoveringSite(current => current === key ? undefined : current)
      }
    }
  }, [t])

  useEffect(() => {
    discoveryGeneration.current.new = (discoveryGeneration.current.new ?? 0) + 1
    setDiscoveringSite(current => current === 'new' ? undefined : current)
    if (!managedSiteDiscoveryReady(newSite, false)) {
      Reflect.deleteProperty(automaticDiscovery.current, 'new')
      setModelOptions(current => current.new === undefined ? current : { ...current, new: [] })
      return
    }
    const timeout = window.setTimeout(() => {
      void discoverManagedSite('new', newSite)
    }, 700)
    return () => { window.clearTimeout(timeout) }
  }, [discoverManagedSite, newSite.apiKey, newSite.baseURL])

  const saveSharedCredential = (event: FormEvent): void => {
    event.preventDefault()
    if (apiKey.trim().length === 0) return
    setSaving(true)
    setError(undefined)
    setNotice(undefined)
    void jsonRequest<{ managedModels: ManagedModelsStatus }>('/auth/system/managed-models/deepseek-official', {
      method: 'PUT',
      body: JSON.stringify({ apiKey }),
    }).then(({ managedModels }) => {
      updateManagedStatus(managedModels)
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
    void jsonRequest<{ managedModels: ManagedModelsStatus }>('/auth/system/managed-models/deepseek-official', {
      method: 'DELETE',
    }).then(({ managedModels }) => {
      updateManagedStatus(managedModels)
      setApiKey('')
      setNotice(t('shared.removedNotice'))
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => { setSaving(false) })
  }

  const saveOfficialModels = (): void => {
    if (officialModels.length === 0) return
    setSaving(true)
    setError(undefined)
    setNotice(undefined)
    void jsonRequest<{ managedModels: ManagedModelsStatus }>('/auth/system/managed-models/deepseek-official/models', {
      method: 'PUT',
      body: JSON.stringify({ models: officialModels }),
    }).then(({ managedModels }) => {
      updateManagedStatus(managedModels)
      setNotice(t('shared.officialModelsSavedNotice'))
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => { setSaving(false) })
  }

  const createManagedSite = (event: FormEvent): void => {
    event.preventDefault()
    if (newSite.name.trim().length === 0 || newSite.baseURL.trim().length === 0
      || newSite.models.length === 0 || newSite.apiKey.trim().length === 0) return
    setSaving(true)
    setError(undefined)
    setNotice(undefined)
    void jsonRequest<{ managedModels: ManagedModelsStatus }>('/auth/system/managed-models/sites', {
      method: 'POST',
      body: JSON.stringify(newSite),
    }).then(({ managedModels }) => {
      updateManagedStatus(managedModels)
      setNewSite(emptyManagedSiteDraft())
      setModelOptions(current => ({ ...current, new: [] }))
      setNotice(t('shared.siteAddedNotice'))
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => { setSaving(false) })
  }

  const saveManagedSite = (id: string): void => {
    const draft = siteDrafts[id]
    if (draft === undefined) return
    if (draft.name.trim().length === 0 || draft.baseURL.trim().length === 0 || draft.models.length === 0) return
    setSaving(true)
    setError(undefined)
    setNotice(undefined)
    void jsonRequest<{ managedModels: ManagedModelsStatus }>(`/auth/system/managed-models/sites/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: draft.name,
        baseURL: draft.baseURL,
        models: draft.models,
        ...draft.apiKey.trim().length === 0 ? {} : { apiKey: draft.apiKey },
      }),
    }).then(({ managedModels }) => {
      updateManagedStatus(managedModels)
      setNotice(t('shared.siteSavedNotice'))
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => { setSaving(false) })
  }

  const removeManagedSite = (id: string): void => {
    setSaving(true)
    setError(undefined)
    setNotice(undefined)
    void jsonRequest<{ managedModels: ManagedModelsStatus }>(`/auth/system/managed-models/sites/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }).then(({ managedModels }) => {
      updateManagedStatus(managedModels)
      setNotice(t('shared.siteRemovedNotice'))
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

  const officialSite = settings?.managedModels.sites.find(site => site.kind === 'deepseek-official')
  const customSites = settings?.managedModels.sites.filter(site => site.kind === 'openai-compatible') ?? []

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
          <section className={css.settingsSection} aria-labelledby="managed-models-admin-title">
            <div className={css.sectionHeading}>
              <div><h2 id="managed-models-admin-title">{t('shared.title')}</h2><p>{t('shared.description')}</p></div>
              <span className={settings.managedModels.configured ? css.stateReady : css.statePending}>
                {settings.managedModels.configured ? t('state.configured') : t('state.notConfigured')}
              </span>
            </div>
            <div className={css.managedOverview}>
              <div><span>{t('shared.siteCount')}</span><strong>{settings.managedModels.sites.filter(site => site.configured).length}</strong></div>
              <div><span>{t('shared.enabledUsers')}</span><strong>{settings.managedModels.enabledUsers}</strong></div>
              <div><span>{t('shared.configuredSites')}</span><strong>{customSites.length}</strong></div>
            </div>

            {officialSite !== undefined && (
              <article className={css.managedSiteCard}>
                <div className={css.managedSiteHeader}>
                  <div>
                    <span>{t('shared.officialSite')}</span>
                    <h3>{officialSite.name}</h3>
                    <code>{officialSite.baseURL}</code>
                  </div>
                  <span className={officialSite.configured ? css.stateReady : css.statePending}>
                    {officialSite.configured ? t('state.configured') : t('state.notConfigured')}
                  </span>
                </div>
                <p className={css.managedSiteHelp}>{t('shared.officialModelHelp')}</p>
                <ManagedModelPicker
                  disabled={saving || !officialSite.modelSelectionWritable}
                  discovering={false}
                  models={officialSite.availableModels}
                  selected={officialModels}
                  t={t}
                  onSelected={setOfficialModels}
                />
                <div className={css.managedSiteActions}>
                  <button
                    className={css.primaryButton}
                    type="button"
                    disabled={saving || !officialSite.modelSelectionWritable || officialModels.length === 0}
                    onClick={saveOfficialModels}
                  >
                    {saving ? t('action.saving') : t('shared.saveOfficialModels')}
                  </button>
                </div>
                <form className={css.credentialForm} onSubmit={saveSharedCredential}>
                  <label htmlFor="shared-deepseek-api-key">{officialSite.configured ? t('shared.replaceApiKey') : t('shared.setApiKey')}</label>
                  <div>
                    <input
                      id="shared-deepseek-api-key"
                      type="password"
                      autoComplete="off"
                      value={apiKey}
                      disabled={!officialSite.writable || saving}
                      placeholder={officialSite.configured ? t('shared.replacePlaceholder') : t('shared.setPlaceholder')}
                      onChange={(event) => { setApiKey(event.target.value) }}
                    />
                    <button className={css.primaryButton} type="submit" disabled={!officialSite.writable || saving || apiKey.trim().length === 0}>
                      {saving ? t('action.saving') : officialSite.configured ? t('shared.replaceKey') : t('shared.saveKey')}
                    </button>
                    {officialSite.configured && (
                      <button className={css.dangerButton} type="button" disabled={!officialSite.writable || saving} onClick={clearSharedCredential}>
                        {t('shared.removeKey')}
                      </button>
                    )}
                  </div>
                </form>
              </article>
            )}

            <div className={css.managedSiteList}>
              {customSites.map((site) => {
                const draft = siteDrafts[site.id] ?? managedSiteDraft(site)
                return (
                  <article className={css.managedSiteCard} key={site.id}>
                    <div className={css.managedSiteHeader}>
                      <div><span>{t('shared.customSite')}</span><h3>{site.name}</h3><code>{site.provider}</code></div>
                      <span className={site.configured ? css.stateReady : css.statePending}>
                        {site.configured ? t('state.configured') : t('state.notConfigured')}
                      </span>
                    </div>
                    <div className={css.managedSiteFormGrid}>
                      <label>
                        <span>{t('shared.siteName')}</span>
                        <input aria-label={`${t('shared.siteName')} ${site.name}`} value={draft.name} disabled={saving} onChange={(event) => {
                          setSiteDrafts({ ...siteDrafts, [site.id]: { ...draft, name: event.target.value } })
                        }} />
                      </label>
                      <label>
                        <span>{t('shared.baseUrl')}</span>
                        <input
                          type="url"
                          aria-label={`${t('shared.baseUrl')} ${site.name}`}
                          value={draft.baseURL}
                          disabled={saving}
                          onChange={(event) => {
                            discoveryGeneration.current[site.id] = (discoveryGeneration.current[site.id] ?? 0) + 1
                            setDiscoveringSite(current => current === site.id ? undefined : current)
                            setSiteDrafts({ ...siteDrafts, [site.id]: { ...draft, baseURL: event.target.value, models: [] } })
                            setModelOptions({ ...modelOptions, [site.id]: [] })
                          }}
                          onBlur={() => { void discoverManagedSite(site.id, draft, site.id) }}
                        />
                      </label>
                      <label>
                        <span>{t('shared.replaceApiKey')}</span>
                        <input
                          type="password"
                          autoComplete="off"
                          aria-label={`${t('shared.replaceApiKey')} ${site.name}`}
                          value={draft.apiKey}
                          disabled={saving}
                          placeholder={t('shared.keepKeyPlaceholder')}
                          onChange={(event) => {
                            discoveryGeneration.current[site.id] = (discoveryGeneration.current[site.id] ?? 0) + 1
                            setDiscoveringSite(current => current === site.id ? undefined : current)
                            setSiteDrafts({ ...siteDrafts, [site.id]: { ...draft, apiKey: event.target.value, models: [] } })
                            setModelOptions({ ...modelOptions, [site.id]: [] })
                          }}
                          onBlur={() => { void discoverManagedSite(site.id, draft, site.id) }}
                        />
                      </label>
                    </div>
                    <ManagedModelPicker
                      disabled={saving || !managedSiteDiscoveryReady(draft, true)}
                      discovering={discoveringSite === site.id}
                      models={modelOptions[site.id] ?? site.models}
                      selected={draft.models}
                      t={t}
                      onDiscover={() => { void discoverManagedSite(site.id, draft, site.id, true) }}
                      onSelected={(models) => { setSiteDrafts({ ...siteDrafts, [site.id]: { ...draft, models } }) }}
                    />
                    <div className={css.managedSiteActions}>
                      <button className={css.dangerButton} type="button" disabled={saving} onClick={() => { removeManagedSite(site.id) }}>{t('shared.removeSite')}</button>
                      <button className={css.primaryButton} type="button" disabled={saving || draft.models.length === 0} onClick={() => { saveManagedSite(site.id) }}>{t('shared.saveSite')}</button>
                    </div>
                  </article>
                )
              })}
            </div>

            <form className={css.addManagedSite} onSubmit={createManagedSite}>
              <div><h3>{t('shared.addSite')}</h3><p>{t('shared.addSiteHelp')}</p></div>
              <div className={css.managedSiteFormGrid}>
                <label><span>{t('shared.siteName')}</span><input required value={newSite.name} disabled={saving} placeholder={t('shared.siteNamePlaceholder')} onChange={(event) => { setNewSite({ ...newSite, name: event.target.value }) }} /></label>
                <label><span>{t('shared.baseUrl')}</span><input required type="url" value={newSite.baseURL} disabled={saving} placeholder={t('shared.baseUrlPlaceholder')} onChange={(event) => { setNewSite({ ...newSite, baseURL: event.target.value, models: [] }); setModelOptions({ ...modelOptions, new: [] }) }} /></label>
                <label><span>{t('shared.setApiKey')}</span><input required type="password" autoComplete="off" value={newSite.apiKey} disabled={saving} placeholder={t('shared.customKeyPlaceholder')} onChange={(event) => { setNewSite({ ...newSite, apiKey: event.target.value, models: [] }); setModelOptions({ ...modelOptions, new: [] }) }} /></label>
              </div>
              <ManagedModelPicker
                disabled={saving || !managedSiteDiscoveryReady(newSite, false)}
                discovering={discoveringSite === 'new'}
                models={modelOptions.new ?? []}
                selected={newSite.models}
                t={t}
                onDiscover={() => { void discoverManagedSite('new', newSite, undefined, true) }}
                onSelected={(models) => { setNewSite({ ...newSite, models }) }}
              />
              <div className={css.managedSiteActions}><button className={css.primaryButton} type="submit" disabled={saving || newSite.models.length === 0}>{saving ? t('action.saving') : t('shared.addSiteAction')}</button></div>
            </form>
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
