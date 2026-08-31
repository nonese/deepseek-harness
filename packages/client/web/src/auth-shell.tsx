/** Login preflight and authenticated Harness portal around the plugin runtime. */

import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Context } from '@deepseek-ai/cordis'
import type { UiRendererService } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { HarnessPortal, type ActiveWorkspaceSource } from './HarnessPortal.tsx'
import { LoginPage } from './LoginPage.tsx'
import { isClientAuthSession, type ClientAuthSession } from './auth-state.ts'
import { browserTranslate } from './locales.ts'

interface SessionProbe {
  authenticated?: boolean
  oidc?: { configured?: boolean }
  error?: { message?: string }
}

/** Anonymous login facts returned before any client plugin is loaded. */
export interface AnonymousLoginState {
  readonly oidcConfigured: boolean
  readonly message?: string
}

/** Authentication preflight result for a multi-user Web composition. */
export type AuthPreflight =
  | { readonly authenticated: true; readonly session: ClientAuthSession }
  | { readonly authenticated: false; readonly login: AnonymousLoginState }

function errorMessage(value: unknown, fallback: string): string {
  if (typeof value !== 'object' || value === null) return fallback
  const error = (value as Record<PropertyKey, unknown>).error
  if (typeof error !== 'object' || error === null) return fallback
  const message = (error as Record<PropertyKey, unknown>).message
  return typeof message === 'string' && message.length > 0 ? message : fallback
}

/** Read the same-origin durable browser session before loading application plugins. */
export async function authPreflight(): Promise<AuthPreflight> {
  const t = browserTranslate()
  const response = await fetch('/auth/session', { credentials: 'same-origin' })
  const body: unknown = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(errorMessage(body, t('login.sessionCheckFailure', { status: response.status })))
  const probe = body as SessionProbe
  if (probe.authenticated === true) {
    if (!isClientAuthSession(body)) throw new Error(t('login.sessionResponseIncomplete'))
    return { authenticated: true, session: body }
  }
  const params = new URLSearchParams(globalThis.location.search)
  const oidcError = params.get('oidc_error')
  return {
    authenticated: false,
    login: {
      oidcConfigured: probe.oidc?.configured === true,
      ...oidcError === null ? {} : { message: t('login.oidcFailure', { error: oidcError }) },
    },
  }
}

/** Mount the login page and reload after a successful local or OIDC login. */
export function mountLogin(container: HTMLElement, state: AnonymousLoginState): () => void {
  const t = browserTranslate()
  const root = createRoot(container)
  root.render(<LoginPage
    oidcConfigured={state.oidcConfigured}
    {...state.message === undefined ? {} : { initialMessage: state.message }}
    onLocalLogin={async (username, password) => {
      const response = await fetch('/auth/login/local', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const body: unknown = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(errorMessage(body, t('login.localFailure', { status: response.status })))
      if (!isClientAuthSession(body)) throw new Error(t('login.localResponseIncomplete'))
      globalThis.location.reload()
    }}
    onOidcLogin={() => { globalThis.location.assign('/auth/oidc/start') }}
  />)
  return () => { root.unmount() }
}

function RuntimeMount(props: { renderer: UiRendererService }): ReactNode {
  const element = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const target = element.current
    if (target === null) return
    return props.renderer.mount(target)
  }, [props.renderer])
  return <div ref={element} style={{ width: '100%', height: '100%' }} />
}

interface UiWorkspaceFace {
  connectWorkspace(workspaceId: string): Promise<string>
  startSession(workspaceId?: string): void
}

interface SessionsFace {
  readonly list: {
    getSnapshot(): { current: string | undefined }
    subscribe(listener: () => void): () => void
  }
  open(sessionId: string): void
}

interface WorkspacesFace {
  readonly list: {
    getSnapshot(): {
      items: readonly { workspaceId: string; sessionIds: readonly string[] }[]
    }
    subscribe(listener: () => void): () => void
  }
}

function createActiveWorkspaceSource(
  workspaces: WorkspacesFace,
  sessions: SessionsFace,
): ActiveWorkspaceSource {
  return {
    getSnapshot: () => {
      const current = sessions.list.getSnapshot().current
      if (current === undefined) return undefined
      return workspaces.list.getSnapshot().items
        .find(workspace => workspace.sessionIds.includes(current))?.workspaceId
    },
    subscribe: (listener) => {
      const disposeWorkspaces = workspaces.list.subscribe(listener)
      const disposeSessions = sessions.list.subscribe(listener)
      return () => {
        disposeSessions()
        disposeWorkspaces()
      }
    },
  }
}

/** Mount the authenticated project, settings, and administrator shell. */
export function mountAuthenticatedShell(
  container: HTMLElement,
  ctx: Context,
  session: ClientAuthSession,
): () => void {
  const t = browserTranslate()
  const renderer = ctx.get('uiRenderer')
  const workspace = ctx.get('uiWorkspace') as UiWorkspaceFace | undefined
  const sessions = ctx.get('sessions') as SessionsFace | undefined
  const workspaces = ctx.get('workspaces') as WorkspacesFace | undefined
  if (renderer === undefined || workspace === undefined || sessions === undefined || workspaces === undefined) {
    throw new Error(t('runtime.navigationUnavailable'))
  }
  const activeWorkspace = createActiveWorkspaceSource(workspaces, sessions)
  let root: Root | undefined = createRoot(container)
  root.render(<HarnessPortal
    user={session.user}
    t={t}
    renderRuntime={() => <RuntimeMount renderer={renderer} />}
    activeWorkspace={activeWorkspace}
    openWorkspace={(workspaceId) => {
      void workspace.connectWorkspace(workspaceId).then((sessionId) => { sessions.open(sessionId) })
    }}
    startSession={(workspaceId) => { workspace.startSession(workspaceId) }}
    onLogout={async () => {
      const response = await fetch('/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      if (!response.ok) throw new Error(t('action.logoutFailure', { status: response.status }))
      globalThis.location.reload()
    }}
  />)
  return () => {
    root?.unmount()
    root = undefined
  }
}
