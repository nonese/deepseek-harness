import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import {
  IconChevronRightOutline14,
  IconCloseOutline16,
  IconCodeOutline16,
  IconDownloadOutline16,
  IconFolderClose16,
  IconFolderOpenOutline16,
  IconPlusOutline16,
  MarkdownText,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { WebTranslate } from './locales.ts'
import css from './ProjectFileBrowser.module.css'

interface ProjectFileEntry {
  name: string
  path: string
  kind: 'directory' | 'file'
  size?: number
  updatedAt: number
  previewable: boolean
}

interface ProjectDirectoryResponse {
  directory: {
    path: string
    entries: ProjectFileEntry[]
  }
}

interface ProjectPreviewResponse {
  preview: {
    file: {
      name: string
      path: string
      size: number
      updatedAt: number
      format: 'markdown' | 'text'
    }
    content: string
  }
}

interface ApiErrorBody {
  error?: { message?: string }
}

async function requestJson<T>(path: string, signal: AbortSignal, t: WebTranslate): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', signal })
  const body: unknown = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error((body as ApiErrorBody).error?.message ?? t('projectFiles.requestFailure', { status: response.status }))
  }
  return body as T
}

function projectFileUrl(
  projectId: string,
  operation: '' | 'preview' | 'download' | 'upload',
  path: string,
  name?: string,
): string {
  const query = new URLSearchParams()
  if (path !== '') query.set('path', path)
  if (name !== undefined) query.set('name', name)
  const suffix = operation === '' ? '' : `/${operation}`
  const encodedQuery = query.toString()
  return `/auth/projects/${encodeURIComponent(projectId)}/files${suffix}${encodedQuery === '' ? '' : `?${encodedQuery}`}`
}

function formatBytes(bytes: number | undefined, t: WebTranslate): string {
  if (bytes === undefined) return '—'
  if (bytes < 1024) return `${String(bytes)} ${t('units.bytes')}`
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} ${t('units.kibibytes')}`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} ${t('units.mebibytes')}`
}

function formatUpdatedAt(updatedAt: number): string {
  return new Date(updatedAt).toLocaleString(undefined, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

/** Authenticated browser for one program-managed project directory. */
export function ProjectFileBrowser({ project, onClose, t }: {
  project: { id: string; name: string }
  onClose: () => void
  t: WebTranslate
}) {
  const [currentPath, setCurrentPath] = useState('')
  const [entries, setEntries] = useState<ProjectFileEntry[]>([])
  const [listing, setListing] = useState(true)
  const [listError, setListError] = useState<string>()
  const [selected, setSelected] = useState<ProjectFileEntry>()
  const [preview, setPreview] = useState<ProjectPreviewResponse['preview']>()
  const [previewing, setPreviewing] = useState(false)
  const [previewError, setPreviewError] = useState<string>()
  const [listingRevision, setListingRevision] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [uploadMessage, setUploadMessage] = useState<string>()
  const [uploadError, setUploadError] = useState<string>()
  const uploadInput = useRef<HTMLInputElement>(null)
  const uploadController = useRef<AbortController>()

  useEffect(() => {
    const controller = new AbortController()
    setListing(true)
    setListError(undefined)
    setSelected(undefined)
    setPreview(undefined)
    setPreviewError(undefined)
    void requestJson<ProjectDirectoryResponse>(projectFileUrl(project.id, '', currentPath), controller.signal, t)
      .then((response) => { setEntries(response.directory.entries) })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return
        setEntries([])
        setListError(errorMessage(reason))
      })
      .finally(() => {
        if (!controller.signal.aborted) setListing(false)
      })
    return () => { controller.abort() }
  }, [currentPath, listingRevision, project.id, t])

  useEffect(() => {
    if (selected === undefined || !selected.previewable) return
    const controller = new AbortController()
    setPreviewing(true)
    setPreview(undefined)
    setPreviewError(undefined)
    void requestJson<ProjectPreviewResponse>(
      projectFileUrl(project.id, 'preview', selected.path),
      controller.signal,
      t,
    ).then((response) => { setPreview(response.preview) })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return
        setPreviewError(errorMessage(reason))
      })
      .finally(() => {
        if (!controller.signal.aborted) setPreviewing(false)
      })
    return () => { controller.abort() }
  }, [project.id, selected, t])

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    addEventListener('keydown', closeOnEscape)
    return () => { removeEventListener('keydown', closeOnEscape) }
  }, [onClose])

  useEffect(() => () => { uploadController.current?.abort() }, [])

  const breadcrumbs = useMemo(() => {
    const segments = currentPath === '' ? [] : currentPath.split('/')
    return segments.map((name, index) => ({ name, path: segments.slice(0, index + 1).join('/') }))
  }, [currentPath])
  const markdownLabels = useMemo(() => ({
    code: {
      copyLabel: t('projectFiles.copy'),
      copiedLabel: t('projectFiles.copied'),
    },
    footnotes: t('projectFiles.footnotes'),
  }), [t])

  const navigate = (path: string): void => {
    if (path !== currentPath) {
      setUploadMessage(undefined)
      setUploadError(undefined)
      setCurrentPath(path)
    }
  }

  const uploadFiles = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ''
    if (files.length === 0) return
    const controller = new AbortController()
    uploadController.current?.abort()
    uploadController.current = controller
    setUploading(true)
    setUploadMessage(undefined)
    setUploadError(undefined)
    let uploaded = 0
    try {
      for (const file of files) {
        const response = await fetch(projectFileUrl(project.id, 'upload', currentPath, file.name), {
          method: 'PUT',
          credentials: 'same-origin',
          headers: { 'content-type': file.type || 'application/octet-stream' },
          body: file,
          signal: controller.signal,
        })
        const body: unknown = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error((body as ApiErrorBody).error?.message
            ?? t('projectFiles.requestFailure', { status: response.status }))
        }
        uploaded += 1
      }
      setUploadMessage(t('projectFiles.uploadComplete', { count: uploaded }))
      setListingRevision(value => value + 1)
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
        setUploadError(errorMessage(reason))
        if (uploaded > 0) setListingRevision(value => value + 1)
      }
    } finally {
      if (uploadController.current === controller) uploadController.current = undefined
      if (!controller.signal.aborted) setUploading(false)
    }
  }

  return (
    <div className={css.backdrop} role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose()
    }}>
      <section
        className={selected === undefined ? css.dialog : `${css.dialog} ${css.dialogPreview}`}
        role="dialog"
        aria-modal="true"
        aria-label={t('projectFiles.dialogTitle', { name: project.name })}
      >
        <header className={css.header}>
          <div className={css.heading}>
            <span className={css.headingIcon}><IconFolderOpenOutline16 size={20} /></span>
            <div>
              <h2>{t('projectFiles.title')}</h2>
              <p>{project.name}</p>
            </div>
          </div>
          <button className={css.closeButton} type="button" aria-label={t('projectFiles.close')} onClick={onClose} autoFocus>
            <IconCloseOutline16 size={17} />
          </button>
        </header>

        <nav className={css.breadcrumbs} aria-label={t('projectFiles.path')}>
          <button type="button" onClick={() => { navigate('') }}><IconFolderClose16 size={15} />{project.name}</button>
          {breadcrumbs.map(crumb => (
            <span key={crumb.path}>
              <IconChevronRightOutline14 size={13} />
              <button type="button" onClick={() => { navigate(crumb.path) }}>{crumb.name}</button>
            </span>
          ))}
        </nav>

        <div className={css.toolbar}>
          <span>{t('projectFiles.uploadDestination', { path: currentPath === '' ? project.name : currentPath })}</span>
          <input
            ref={uploadInput}
            className={css.uploadInput}
            type="file"
            multiple
            aria-label={t('projectFiles.chooseUpload')}
            onChange={(event) => { void uploadFiles(event) }}
          />
          <button
            className={css.uploadButton}
            type="button"
            disabled={uploading}
            onClick={() => { uploadInput.current?.click() }}
          >
            <IconPlusOutline16 size={16} />
            {uploading ? t('projectFiles.uploading') : t('projectFiles.upload')}
          </button>
        </div>
        {(uploadMessage !== undefined || uploadError !== undefined) && (
          <div className={uploadError === undefined ? css.uploadStatus : `${css.uploadStatus} ${css.uploadStatusError}`}
            role={uploadError === undefined ? 'status' : 'alert'}>
            {uploadError ?? uploadMessage}
          </div>
        )}

        <div className={css.content}>
          <section className={css.filePane} aria-label={t('projectFiles.list')}>
            <div className={css.columnHeader} aria-hidden="true">
              <span>{t('projectFiles.name')}</span><span>{t('projectFiles.size')}</span><span>{t('projectFiles.updated')}</span><span />
            </div>
            <div className={css.rows} aria-live="polite">
              {listing && <div className={css.state}>{t('projectFiles.loadingList')}</div>}
              {!listing && listError !== undefined && <div className={css.error} role="alert">{listError}</div>}
              {!listing && listError === undefined && entries.length === 0 && (
                <div className={css.state}>{t('projectFiles.empty')}</div>
              )}
              {!listing && entries.map(entry => (
                <div className={selected?.path === entry.path ? `${css.row} ${css.rowSelected}` : css.row} key={entry.path}>
                  <span className={css.nameCell}>
                    {entry.kind === 'directory'
                      ? (
                        <button type="button" onClick={() => { navigate(entry.path) }}>
                          <span className={css.entryIcon}><IconFolderClose16 size={18} /></span>
                          <span>{entry.name}</span>
                        </button>
                      )
                      : entry.previewable
                        ? (
                          <button
                            type="button"
                            aria-pressed={selected?.path === entry.path}
                            onClick={() => { setSelected(entry) }}
                          >
                            <span className={css.entryIcon}><IconCodeOutline16 size={17} /></span>
                            <span>{entry.name}</span>
                          </button>
                        )
                        : (
                          <a href={projectFileUrl(project.id, 'download', entry.path)} download>
                            <span className={css.entryIcon}><IconCodeOutline16 size={17} /></span>
                            <span>{entry.name}</span>
                          </a>
                        )}
                  </span>
                  <span className={css.metaCell}>{entry.kind === 'file' ? formatBytes(entry.size, t) : '—'}</span>
                  <span className={css.metaCell}>{formatUpdatedAt(entry.updatedAt)}</span>
                  <span className={css.downloadCell}>
                    {entry.kind === 'file' && (
                      <a
                        href={projectFileUrl(project.id, 'download', entry.path)}
                        download
                        aria-label={t('projectFiles.downloadNamed', { name: entry.name })}
                        title={t('projectFiles.downloadNamed', { name: entry.name })}
                      >
                        <IconDownloadOutline16 size={16} />
                      </a>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {selected !== undefined && (
            <section className={css.previewPane} aria-label={t('projectFiles.preview')}>
              <div className={css.previewHeader}>
                <div>
                  <span>{t('projectFiles.preview')}</span>
                  <strong>{selected.name}</strong>
                </div>
                <a className={css.downloadButton} href={projectFileUrl(project.id, 'download', selected.path)} download>
                  <IconDownloadOutline16 size={16} />{t('projectFiles.download')}
                </a>
              </div>
              <div className={css.previewBody} aria-live="polite">
                {previewing && <div className={css.state}>{t('projectFiles.loadingPreview')}</div>}
                {!previewing && previewError !== undefined && <div className={css.error} role="alert">{previewError}</div>}
                {!previewing && preview !== undefined && (
                  preview.file.format === 'markdown'
                    ? <div className={css.markdownPreview}><MarkdownText text={preview.content} labels={markdownLabels} /></div>
                    : <pre className={css.textPreview}>{preview.content}</pre>
                )}
              </div>
            </section>
          )}
        </div>

        <footer className={css.footer}>
          <span><IconFolderClose16 size={14} />{t('projectFiles.currentProjectOnly')}</span>
          <span>{t('projectFiles.hiddenNotice')}</span>
        </footer>
      </section>
    </div>
  )
}
