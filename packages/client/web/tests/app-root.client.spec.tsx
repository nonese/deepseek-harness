// @vitest-environment jsdom
/**
 * AppRoot boot-gate smoke: loading page until the settled signal flips (status
 * alone never opens the gate), fail-loud entry list + boot failure report,
 * one-pass switch to the real UI. The full browser chain (real module system
 * + vendored Loader + bundles) is the e2e's job; this pins the shell-owned
 * gate semantics. Stores are the kernel-own signals production boot uses
 * (shell self-sufficiency: the loading page depends on no plugin package).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'

afterEach(cleanup)
import { AppRoot } from '@deepseek-ai/dsh-client-web/src/AppRoot.tsx'
import type { ClientAuthState } from '@deepseek-ai/dsh-client-web/src/auth-state.ts'
import { createLoaderStatusStore, createSignal } from '@deepseek-ai/dsh-client-web/src/loader-status.ts'

function mount() {
  const auth = createSignal<ClientAuthState>({
    phase: 'authenticated' as const,
    user: {
      id: 'user-1', username: 'user', displayName: '用户', role: 'user' as const,
      status: 'active' as const, authMethods: ['local' as const], createdAt: new Date(0).toISOString(),
    },
    expiresAt: new Date(1).toISOString(), method: 'local' as const,
  })
  const settled = createSignal(false)
  const error = createSignal<string | undefined>(undefined)
  const status = createLoaderStatusStore()
  let renders = 0
  const utils = render(
    <AppRoot
      auth={auth}
      onLocalLogin={() => Promise.resolve()}
      onOidcLogin={() => {}}
      settled={settled}
      status={status}
      error={error}
      renderApp={() => { renders += 1; return <div data-testid="real-ui" /> }}
    />,
  )
  return { auth, settled, status, error, counts: () => renders, ...utils }
}

describe('AppRoot', () => {
  it('shows the loading page and never calls renderApp before settled', () => {
    const { queryByTestId, counts, getByText } = mount()
    expect(getByText('HARNESS')).toBeTruthy()
    expect(queryByTestId('real-ui')).toBeNull()
    expect(counts()).toBe(0)
  })

  it('all-active status alone does not open the gate (settled signal is the only key)', () => {
    const { status, queryByTestId } = mount()
    act(() => {
      status.set('a', 'active')
      status.set('b', 'active')
    })
    expect(queryByTestId('real-ui')).toBeNull()
  })

  it('lists failed entries and stays on the loading page', () => {
    const { status, getByText, queryByTestId } = mount()
    act(() => {
      status.set('@deepseek-ai/dsh-client-ui-layout', 'failed')
      status.set('ok', 'active')
    })
    expect(getByText('Failed to load plugins')).toBeTruthy()
    expect(getByText('@deepseek-ai/dsh-client-ui-layout')).toBeTruthy()
    expect(queryByTestId('real-ui')).toBeNull()
  })

  it('renders the boot failure report even when no entry projected failed', () => {
    const { error, getByText, queryByTestId } = mount()
    act(() => { error.set('web boot: 1 entry did not activate\nx: pending (waiting for service: y)') })
    expect(getByText('Failed to load plugins')).toBeTruthy()
    expect(getByText(/waiting for service/)).toBeTruthy()
    expect(queryByTestId('real-ui')).toBeNull()
  })

  it('flipping settled switches to the real UI in one pass', () => {
    const { settled, getByTestId, queryByText, counts } = mount()
    act(() => { settled.set(true) })
    expect(getByTestId('real-ui')).toBeTruthy()
    expect(queryByText('HARNESS')).toBeNull()
    expect(counts()).toBe(1)
  })

  it('shows login and keeps the plugin UI closed while anonymous', () => {
    const { auth, container, getByText, queryByTestId } = mount()
    act(() => { auth.set({ phase: 'anonymous', oidcConfigured: false }) })
    expect(getByText('登录你的工作空间')).toBeTruthy()
    const hero = container.querySelector('img[src="/assets/harness-login-hero.webp"]')
    expect(hero).toBeTruthy()
    expect(hero?.getAttribute('alt')).toBe('')
    const whaleMark = container.querySelector('img[src="/assets/harness-whale-mark.webp"]')
    expect(whaleMark).toBeTruthy()
    expect(whaleMark?.getAttribute('alt')).toBe('')
    expect(queryByTestId('real-ui')).toBeNull()
  })
})
