/** Authenticated-server model-source preferences for the Models settings page. */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { CredentialInfo } from '@deepseek-ai/dsh-api-remotes/client'
import { apiKeyFailure } from './apiKey.ts'
import type { en } from './locales.ts'
import type { ModelsOperations } from './operations.ts'
import styles from './ServerModelsSection.module.css'

/** Personal credential consumed by the official DeepSeek model and search providers. */
export const PERSONAL_DEEPSEEK_API_KEY_REF = 'DEEPSEEK_API_KEY'

/** Non-secret model metadata returned by the authenticated preferences route. */
export interface ServerManagedModelSite {
  id: string
  name: string
  models: readonly { id: string; name: string }[]
  configured: boolean
}

/** User-scoped administrator-managed model preference. */
export interface ServerManagedModelsPreference {
  configured: boolean
  enabled: boolean
  sites: readonly ServerManagedModelSite[]
}

interface PreferencesResponse {
  managedModels: ServerManagedModelsPreference
}

interface ApiErrorBody {
  error?: { message?: string }
}

class ServerModelsRequestError extends Error {
  constructor(
    readonly kind: 'request' | 'invalid-response',
    message: string,
    readonly status?: number,
  ) {
    super(message)
  }
}

type ServerModelsState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | {
    phase: 'ready'
    preference: ServerManagedModelsPreference
    personalCredential: CredentialInfo | undefined
  }

/** Whether the served page selected authenticated multi-user behavior. */
export function isMultiUserBrowser(): boolean {
  return (globalThis as { __HARNESS_MULTI_USER__?: unknown }).__HARNESS_MULTI_USER__ === true
}

function isModel(value: unknown): value is { id: string; name: string } {
  if (typeof value !== 'object' || value === null) return false
  const model = value as { id?: unknown; name?: unknown }
  return typeof model.id === 'string' && typeof model.name === 'string'
}

function isSite(value: unknown): value is ServerManagedModelSite {
  if (typeof value !== 'object' || value === null) return false
  const site = value as Partial<ServerManagedModelSite>
  return typeof site.id === 'string'
    && typeof site.name === 'string'
    && typeof site.configured === 'boolean'
    && Array.isArray(site.models)
    && site.models.every(isModel)
}

function isPreferencesResponse(value: unknown): value is PreferencesResponse {
  if (typeof value !== 'object' || value === null) return false
  const preference = (value as { managedModels?: Partial<ServerManagedModelsPreference> }).managedModels
  return preference !== undefined
    && typeof preference.configured === 'boolean'
    && typeof preference.enabled === 'boolean'
    && Array.isArray(preference.sites)
    && preference.sites.every(isSite)
}

/**
 * Read or update the authenticated user's managed-model preference.
 * @param enabled - New opt-in state, or undefined for a read.
 * @param signal - Optional cancellation for a component-owned read.
 * @returns The complete non-secret preference returned after the operation.
 */
export async function requestServerModelsPreference(
  enabled?: boolean,
  signal?: AbortSignal,
): Promise<ServerManagedModelsPreference> {
  const response = await fetch('/auth/preferences', {
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    ...enabled === undefined
      ? { method: 'GET' }
      : { method: 'PATCH', body: JSON.stringify({ managedModelsEnabled: enabled }) },
    ...signal === undefined ? {} : { signal },
  })
  const body: unknown = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new ServerModelsRequestError(
      'request',
      (body as ApiErrorBody).error?.message ?? '',
      response.status,
    )
  }
  if (!isPreferencesResponse(body)) throw new ServerModelsRequestError('invalid-response', '')
  return body.managedModels
}

function requestFailureMessage(reason: unknown, t: ServerModelsSectionProps['t']): string {
  if (!(reason instanceof ServerModelsRequestError)) {
    return reason instanceof Error ? reason.message : String(reason)
  }
  if (reason.message.length > 0) return reason.message
  if (reason.kind === 'invalid-response') return t('serverInvalidResponse')
  return t('serverRequestStatus').replace('{status}', String(reason.status ?? ''))
}

/** Props for the authenticated-server Models view. */
export interface ServerModelsSectionProps {
  /** Models namespace translator. */
  t: (key: keyof typeof en) => string
  /** User-scoped credential operations carried by the authenticated Remote. */
  operations: ModelsOperations
}

/**
 * Render the user's managed-model opt-in without exposing process-global provider settings.
 * @param props - Localized copy.
 * @returns The server-specific model-source preference view.
 */
export function ServerModelsSection({ t, operations }: ServerModelsSectionProps): ReactNode {
  const [state, setState] = useState<ServerModelsState>({ phase: 'loading' })
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string>()
  const [keyDraft, setKeyDraft] = useState('')
  const [credentialSaving, setCredentialSaving] = useState(false)
  const [credentialNotice, setCredentialNotice] = useState<string>()
  const [credentialFailure, setCredentialFailure] = useState<string>()
  const generation = useRef(0)

  const load = useCallback((signal?: AbortSignal): void => {
    const current = ++generation.current
    setState({ phase: 'loading' })
    setNotice(undefined)
    void Promise.all([
      requestServerModelsPreference(undefined, signal),
      operations.describeCredential(PERSONAL_DEEPSEEK_API_KEY_REF),
    ]).then(([preference, personalCredential]) => {
      if (current === generation.current) setState({ phase: 'ready', preference, personalCredential })
    }).catch((reason: unknown) => {
      if (signal?.aborted === true || current !== generation.current) return
      setState({ phase: 'error', message: requestFailureMessage(reason, t) })
    })
  }, [operations, t])

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
    return () => {
      controller.abort()
      generation.current += 1
    }
  }, [load])

  const setEnabled = (enabled: boolean): void => {
    const current = ++generation.current
    setSaving(true)
    setNotice(undefined)
    void requestServerModelsPreference(enabled).then((preference) => {
      if (current !== generation.current) return
      setState((previous) => {
        /* v8 ignore next -- the switch renders only from ready state, and a newer load invalidates this generation above */
        if (previous.phase !== 'ready') return previous
        return { ...previous, preference }
      })
      setNotice(t(enabled ? 'serverEnabledNotice' : 'serverDisabledNotice'))
    }).catch((reason: unknown) => {
      if (current !== generation.current) return
      setState({ phase: 'error', message: requestFailureMessage(reason, t) })
    }).finally(() => {
      if (current === generation.current) setSaving(false)
    })
  }

  const updatePersonalCredential = async (remove: boolean): Promise<void> => {
    if (credentialSaving) return
    const failure = remove ? undefined : apiKeyFailure(keyDraft) ?? (keyDraft.length === 0 ? 'keyRequired' : undefined)
    if (failure !== undefined) {
      setCredentialFailure(t(failure))
      return
    }
    setCredentialSaving(true)
    setCredentialFailure(undefined)
    setCredentialNotice(undefined)
    try {
      const refused = remove
        ? await operations.removeCredential(PERSONAL_DEEPSEEK_API_KEY_REF)
        : await operations.storeCredential(PERSONAL_DEEPSEEK_API_KEY_REF, keyDraft.trim())
      if (refused !== undefined) {
        setCredentialFailure(refused)
        return
      }
      const personalCredential = await operations.describeCredential(PERSONAL_DEEPSEEK_API_KEY_REF)
      setState((previous) => {
        /* v8 ignore next -- the credential form renders only from ready state and owns no concurrent state transition */
        if (previous.phase !== 'ready') return previous
        return { ...previous, personalCredential }
      })
      setKeyDraft('')
      setCredentialNotice(t(remove ? 'serverPersonalRemoved' : 'serverPersonalSaved'))
    } catch (reason) {
      setCredentialFailure(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setCredentialSaving(false)
    }
  }

  return (
    <div className={styles.section}>
      <h2 className={styles.title}>{t('serverTitle')}</h2>
      <p className={styles.intro}>{t('serverIntro')}</p>
      <div className={styles.selectionGuide}>
        <strong>{t('serverSelectionTitle')}</strong>
        <span>{t('serverSelectionHint')}</span>
      </div>
      {state.phase === 'loading' ? <p className={styles.status} role="status">{t('serverLoading')}</p> : null}
      {state.phase === 'error'
        ? (
          <div className={styles.error} role="alert">
            <span>{`${t('serverLoadFailed')}: ${state.message}`}</span>
            <button type="button" onClick={() => { load() }}>{t('retry')}</button>
          </div>
        )
        : null}
      {state.phase === 'ready'
        ? (
          <>
            <section className={styles.personalCredential} aria-label={t('serverPersonalTitle')}>
              <div className={styles.credentialHeading}>
                <div>
                  <strong>{t('serverPersonalTitle')}</strong>
                  <span>{t('serverPersonalDescription')}</span>
                </div>
                <span className={state.personalCredential?.configured === true ? styles.ready : styles.pending}>
                  {t(state.personalCredential?.configured === true ? 'credentialConfigured' : 'credentialMissing')}
                </span>
              </div>
              {state.personalCredential === undefined
                ? <p className={styles.error} role="alert">{t('serverPersonalUnavailable')}</p>
                : (
                  <form
                    className={styles.credentialForm}
                    onSubmit={(event) => {
                      event.preventDefault()
                      void updatePersonalCredential(false)
                    }}
                  >
                    <label className={styles.credentialField}>
                      <span>{t('keyInput')}</span>
                      <input
                        type="password"
                        autoComplete="off"
                        value={keyDraft}
                        placeholder={state.personalCredential.configured ? t('keyStored') : t('keyPlaceholder')}
                        aria-label={t('keyInput')}
                        aria-invalid={credentialFailure !== undefined}
                        disabled={!state.personalCredential.writable || credentialSaving}
                        onChange={(event) => {
                          setKeyDraft(event.target.value)
                          setCredentialFailure(undefined)
                          setCredentialNotice(undefined)
                        }}
                      />
                    </label>
                    <div className={styles.credentialActions}>
                      {state.personalCredential.configured
                        ? (
                          <button
                            className={styles.removeButton}
                            type="button"
                            disabled={!state.personalCredential.writable || credentialSaving}
                            onClick={() => { void updatePersonalCredential(true) }}
                          >
                            {t('serverPersonalRemove')}
                          </button>
                        )
                        : null}
                      <button
                        className={styles.saveButton}
                        type="submit"
                        disabled={!state.personalCredential.writable || credentialSaving || keyDraft.length === 0}
                      >
                        {t(credentialSaving ? 'serverPersonalSaving' : 'serverPersonalSave')}
                      </button>
                    </div>
                    {credentialFailure === undefined
                      ? null
                      : <p className={styles.credentialError} role="alert">{credentialFailure}</p>}
                    {credentialNotice === undefined
                      ? null
                      : <p className={styles.notice} role="status">{credentialNotice}</p>}
                  </form>
                )}
            </section>
            <div className={styles.sites} aria-label={t('serverAvailableSites')}>
              {state.preference.sites.map(site => (
                <article className={styles.site} key={site.id}>
                  <div className={styles.siteHeading}>
                    <strong>{site.name}</strong>
                    <span className={site.configured ? styles.ready : styles.pending}>
                      {t(site.configured ? 'serverConfigured' : 'serverNotConfigured')}
                    </span>
                  </div>
                  <span className={styles.models}>
                    {site.models.length === 0
                      ? t('serverNoModels')
                      : site.models.map(model => model.name).join(' · ')}
                  </span>
                </article>
              ))}
            </div>
            <div className={styles.preference}>
              <div>
                <strong>{t('serverUseManaged')}</strong>
                <span>{t(state.preference.enabled ? 'serverEnabledHelp' : 'serverDisabledHelp')}</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={state.preference.enabled}
                aria-label={t('serverUseManaged')}
                className={`${styles.switch} ${state.preference.enabled ? styles.switchOn : ''}`}
                disabled={saving || (!state.preference.configured && !state.preference.enabled)}
                onClick={() => { setEnabled(!state.preference.enabled) }}
              >
                <span className={styles.thumb} />
              </button>
            </div>
            {notice === undefined ? null : <p className={styles.notice} role="status">{notice}</p>}
          </>
        )
        : null}
    </div>
  )
}
