// @vitest-environment jsdom
/** Authenticated-server Models settings behavior over the user preference route. */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModelsSection } from '../src/client/ModelsSection.tsx'
import {
  requestServerModelsPreference,
  ServerModelsSection,
} from '../src/client/ServerModelsSection.tsx'
import { en } from '../src/client/locales.ts'
import type { ModelsOperations } from '../src/client/operations.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const t = (key: keyof typeof en): string => en[key]

const disabledPreference = {
  managedModels: {
    configured: true,
    enabled: false,
    sites: [
      {
        id: 'deepseek-official',
        name: 'DeepSeek',
        configured: true,
        models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash' }],
      },
      {
        id: 'missing',
        name: 'School gateway',
        configured: false,
        models: [],
      },
    ],
  },
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response
}

function modelOperations(overrides: Partial<ModelsOperations> = {}): ModelsOperations {
  return {
    describeCredential: vi.fn(() => Promise.resolve({ configured: false, writable: true })),
    storeCredential: vi.fn(() => Promise.resolve(undefined)),
    removeCredential: vi.fn(() => Promise.resolve(undefined)),
    writeSettings: vi.fn(() => Promise.resolve({ kind: 'refused' as const, message: 'not used' })),
    discoverModels: vi.fn(() => Promise.resolve({ kind: 'refused' as const, message: 'not used' })),
    ...overrides,
  }
}

function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<Value>((accept, refuse) => {
    resolve = accept
    reject = refuse
  })
  return { promise, resolve, reject }
}

describe('ServerModelsSection', () => {
  it('loads the user-scoped sources and enables managed models', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse(disabledPreference))
      .mockResolvedValueOnce(jsonResponse({
        managedModels: { ...disabledPreference.managedModels, enabled: true },
      }))
    vi.stubGlobal('fetch', fetch)
    const operations = modelOperations()

    render(<ServerModelsSection t={t} operations={operations} />)

    expect(await screen.findByText('DeepSeek-V4-Flash')).not.toBeNull()
    expect(screen.getByText(en.serverSelectionHint)).not.toBeNull()
    expect(screen.getByText(en.serverNoModels)).not.toBeNull()
    expect(screen.getByText(en.serverNotConfigured)).not.toBeNull()

    fireEvent.click(screen.getByRole('switch', { name: en.serverUseManaged }))

    expect(await screen.findByText(en.serverEnabledNotice)).not.toBeNull()
    expect(screen.getByRole('switch', { name: en.serverUseManaged }).getAttribute('aria-checked')).toBe('true')
    expect(fetch).toHaveBeenNthCalledWith(2, '/auth/preferences', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ managedModelsEnabled: true }),
      credentials: 'same-origin',
    }))
  })

  it('keeps the preference disabled until an administrator configures a model site', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      managedModels: {
        configured: false,
        enabled: false,
        sites: [{
          id: 'deepseek-official', name: 'DeepSeek', configured: false,
          models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash' }],
        }],
      },
    })))
    const operations = modelOperations()

    render(<ServerModelsSection t={t} operations={operations} />)

    const toggle = await screen.findByRole('switch', { name: en.serverUseManaged })
    expect((toggle as HTMLButtonElement).disabled).toBe(true)
  })

  it('retries a failed preference read', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'temporary failure' } }, 503))
      .mockResolvedValueOnce(jsonResponse(disabledPreference))
    vi.stubGlobal('fetch', fetch)
    const operations = modelOperations()

    render(<ServerModelsSection t={t} operations={operations} />)

    expect((await screen.findByRole('alert')).textContent).toContain('temporary failure')
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    expect(await screen.findByText('DeepSeek-V4-Flash')).not.toBeNull()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('replaces the process-global provider editor in a multi-user browser', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse(disabledPreference))
    vi.stubGlobal('fetch', fetch)
    vi.stubGlobal('__HARNESS_MULTI_USER__', true)
    const operations = modelOperations()

    render(<ModelsSection t={t} operations={operations} renderSlot={vi.fn() as never} />)

    expect(await screen.findByRole('heading', { name: en.serverTitle })).not.toBeNull()
    expect(screen.queryByText(en.loadFailed)).toBeNull()
    await waitFor(() => { expect(fetch).toHaveBeenCalledOnce() })
  })

  it('stores and removes the current user personal DeepSeek key without rendering it', async () => {
    const describeCredential = vi.fn()
      .mockResolvedValueOnce({ configured: false, writable: true })
      .mockResolvedValueOnce({ configured: true, source: 'user', writable: true })
      .mockResolvedValueOnce({ configured: false, writable: true })
    const storeCredential = vi.fn(() => Promise.resolve(undefined))
    const removeCredential = vi.fn(() => Promise.resolve(undefined))
    const operations = modelOperations({ describeCredential, storeCredential, removeCredential })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(disabledPreference)))

    const view = render(<ServerModelsSection t={t} operations={operations} />)

    const input = await screen.findByLabelText(en.keyInput)
    fireEvent.change(input, { target: { value: 'sk-user-private' } })
    fireEvent.click(screen.getByRole('button', { name: en.serverPersonalSave }))

    expect(await screen.findByText(en.serverPersonalSaved)).not.toBeNull()
    expect(storeCredential).toHaveBeenCalledWith('DEEPSEEK_API_KEY', 'sk-user-private')
    expect(view.container.textContent).not.toContain('sk-user-private')
    expect((input as HTMLInputElement).value).toBe('')

    fireEvent.click(screen.getByRole('button', { name: en.serverPersonalRemove }))
    expect(await screen.findByText(en.serverPersonalRemoved)).not.toBeNull()
    expect(removeCredential).toHaveBeenCalledWith('DEEPSEEK_API_KEY')
  })

  it('keeps personal credential controls unavailable when the user store cannot describe a reference', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(disabledPreference)))
    const operations = modelOperations({ describeCredential: vi.fn(() => Promise.resolve(undefined)) })

    render(<ServerModelsSection t={t} operations={operations} />)

    expect((await screen.findByRole('alert')).textContent).toContain(en.serverPersonalUnavailable)
    expect(screen.queryByLabelText(en.keyInput)).toBeNull()
  })

  it('validates every preference response layer before rendering it', async () => {
    const invalid = [
      null,
      1,
      {},
      { managedModels: { configured: 'yes', enabled: false, sites: [] } },
      { managedModels: { configured: true, enabled: 'yes', sites: [] } },
      { managedModels: { configured: true, enabled: false, sites: {} } },
      { managedModels: { configured: true, enabled: false, sites: [null] } },
      { managedModels: { configured: true, enabled: false, sites: [{ name: 'x', configured: true, models: [] }] } },
      { managedModels: { configured: true, enabled: false, sites: [{ id: 'x', configured: true, models: [] }] } },
      { managedModels: { configured: true, enabled: false, sites: [{ id: 'x', name: 'x', configured: 'yes', models: [] }] } },
      { managedModels: { configured: true, enabled: false, sites: [{ id: 'x', name: 'x', configured: true, models: {} }] } },
      { managedModels: { configured: true, enabled: false, sites: [{ id: 'x', name: 'x', configured: true, models: [null] }] } },
      { managedModels: { configured: true, enabled: false, sites: [{ id: 'x', name: 'x', configured: true, models: [{ name: 'm' }] }] } },
      { managedModels: { configured: true, enabled: false, sites: [{ id: 'x', name: 'x', configured: true, models: [{ id: 'm' }] }] } },
    ]
    const fetch = vi.fn()
    for (const body of invalid) fetch.mockResolvedValueOnce(jsonResponse(body))
    vi.stubGlobal('fetch', fetch)

    for (const _body of invalid) await expect(requestServerModelsPreference()).rejects.toThrow()
  })

  it('sends a preference patch with an optional abort signal', async () => {
    const controller = new AbortController()
    const fetch = vi.fn().mockResolvedValue(jsonResponse({
      managedModels: { ...disabledPreference.managedModels, enabled: true },
    }))
    vi.stubGlobal('fetch', fetch)

    await expect(requestServerModelsPreference(true, controller.signal))
      .resolves.toEqual({ ...disabledPreference.managedModels, enabled: true })
    expect(fetch).toHaveBeenCalledWith('/auth/preferences', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ managedModelsEnabled: true }),
      signal: controller.signal,
    }))
  })

  it.each([
    ['network error', new Error('network down'), 'network down'],
    ['non-error rejection', 'wire closed', 'wire closed'],
  ])('reports a %s while loading', async (_name, reason, expected) => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(reason))

    render(<ServerModelsSection t={t} operations={modelOperations()} />)

    expect((await screen.findByRole('alert')).textContent).toContain(expected)
  })

  it('localizes invalid JSON and an empty HTTP error response', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.reject(new Error('not json')),
      })
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce({
        ok: false,
        status: undefined,
        json: () => Promise.resolve({}),
      })
      .mockResolvedValueOnce(jsonResponse(disabledPreference))
    vi.stubGlobal('fetch', fetch)
    const operations = modelOperations()

    render(<ServerModelsSection t={t} operations={operations} />)

    expect((await screen.findByRole('alert')).textContent).toContain(en.serverInvalidResponse)
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    expect((await screen.findByRole('alert')).textContent).toContain('503')
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    expect((await screen.findByRole('alert')).textContent).toContain(en.serverRequestStatus.replace('{status}', ''))
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    expect(await screen.findByText('DeepSeek-V4-Flash')).not.toBeNull()
  })

  it('validates a personal key and reports a refused write', async () => {
    const storeCredential = vi.fn(() => Promise.resolve('write refused'))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(disabledPreference)))
    render(<ServerModelsSection t={t} operations={modelOperations({ storeCredential })} />)
    const input = await screen.findByLabelText(en.keyInput)
    const form = input.closest('form') as HTMLFormElement

    fireEvent.submit(form)
    expect(await screen.findByText(en.keyRequired)).not.toBeNull()
    fireEvent.change(input, { target: { value: 'sk-😀' } })
    fireEvent.submit(form)
    expect(await screen.findByText(en.keyIllegalCharacters)).not.toBeNull()
    fireEvent.change(input, { target: { value: 'sk-valid' } })
    fireEvent.submit(form)
    expect(await screen.findByText('write refused')).not.toBeNull()
  })

  it('shows the pending write and reports thrown credential failures', async () => {
    const pending = deferred<string | undefined>()
    const storeCredential = vi.fn()
      .mockImplementationOnce(() => pending.promise)
      .mockRejectedValueOnce(new Error('credential transport failed'))
      .mockRejectedValueOnce('credential transport closed')
    const describeCredential = vi.fn()
      .mockResolvedValueOnce({ configured: false, writable: true })
      .mockResolvedValueOnce({ configured: true, source: 'user', writable: true })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(disabledPreference)))
    render(<ServerModelsSection
      t={t}
      operations={modelOperations({ storeCredential, describeCredential })}
    />)
    const input = await screen.findByLabelText(en.keyInput)

    fireEvent.change(input, { target: { value: 'sk-first' } })
    fireEvent.click(screen.getByRole('button', { name: en.serverPersonalSave }))
    expect(await screen.findByRole('button', { name: en.serverPersonalSaving })).not.toBeNull()
    fireEvent.submit(input.closest('form') as HTMLFormElement)
    expect(storeCredential).toHaveBeenCalledTimes(1)
    pending.resolve(undefined)
    expect(await screen.findByText(en.serverPersonalSaved)).not.toBeNull()

    fireEvent.change(input, { target: { value: 'sk-second' } })
    fireEvent.click(screen.getByRole('button', { name: en.serverPersonalSave }))
    expect(await screen.findByText('credential transport failed')).not.toBeNull()
    fireEvent.change(input, { target: { value: 'sk-third' } })
    fireEvent.click(screen.getByRole('button', { name: en.serverPersonalSave }))
    expect(await screen.findByText('credential transport closed')).not.toBeNull()
  })

  it('renders a configured read-only personal credential without mutation controls', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      managedModels: { ...disabledPreference.managedModels, enabled: true },
    })))
    const operations = modelOperations({
      describeCredential: vi.fn(() => Promise.resolve({ configured: true, source: 'user', writable: false })),
    })

    render(<ServerModelsSection t={t} operations={operations} />)

    const input = await screen.findByLabelText(en.keyInput)
    expect((input as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.serverPersonalRemove }).disabled).toBe(true)
    expect(screen.getByText(en.serverEnabledHelp)).not.toBeNull()
    expect(screen.getByRole('switch', { name: en.serverUseManaged }).getAttribute('aria-checked')).toBe('true')
  })

  it('disables managed models and reports a failed preference update', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ managedModels: { ...disabledPreference.managedModels, enabled: true } }))
      .mockResolvedValueOnce(jsonResponse({ managedModels: disabledPreference.managedModels }))
      .mockResolvedValueOnce(jsonResponse({ error: {} }, 409))
    vi.stubGlobal('fetch', fetch)
    render(<ServerModelsSection t={t} operations={modelOperations()} />)

    const toggle = await screen.findByRole('switch', { name: en.serverUseManaged })
    fireEvent.click(toggle)
    expect(await screen.findByText(en.serverDisabledNotice)).not.toBeNull()
    fireEvent.click(toggle)
    expect((await screen.findByRole('alert')).textContent).toContain('409')
  })

  it('ignores an obsolete load result after its component dependencies change', async () => {
    const firstCredential = deferred<{ configured: boolean; writable: boolean } | undefined>()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(disabledPreference)))
    const first = modelOperations({ describeCredential: vi.fn(() => firstCredential.promise) })
    const second = modelOperations()
    const view = render(<ServerModelsSection t={t} operations={first} />)

    view.rerender(<ServerModelsSection t={t} operations={second} />)
    expect(await screen.findByText('DeepSeek-V4-Flash')).not.toBeNull()
    firstCredential.resolve({ configured: true, writable: true })
    await Promise.resolve()
    expect(screen.getByText(en.credentialMissing)).not.toBeNull()
  })

  it('ignores an aborted load failure after its component dependencies change', async () => {
    const firstCredential = deferred<{ configured: boolean; writable: boolean } | undefined>()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(disabledPreference)))
    const view = render(<ServerModelsSection
      t={t}
      operations={modelOperations({ describeCredential: vi.fn(() => firstCredential.promise) })}
    />)

    view.rerender(<ServerModelsSection t={t} operations={modelOperations()} />)
    expect(await screen.findByText('DeepSeek-V4-Flash')).not.toBeNull()
    firstCredential.reject(new Error('obsolete load'))
    await Promise.resolve()
    expect(screen.queryByText('obsolete load')).toBeNull()
  })

  it.each([
    ['resolved', false],
    ['rejected', true],
  ])('ignores a stale %s preference mutation', async (_name, rejectPatch) => {
    const patch = deferred<Response>()
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse(disabledPreference))
      .mockImplementationOnce(() => patch.promise)
      .mockResolvedValueOnce(jsonResponse(disabledPreference))
    vi.stubGlobal('fetch', fetch)
    const view = render(<ServerModelsSection t={t} operations={modelOperations()} />)
    const toggle = await screen.findByRole('switch', { name: en.serverUseManaged })

    fireEvent.click(toggle)
    view.rerender(<ServerModelsSection t={t} operations={modelOperations()} />)
    expect(await screen.findByText('DeepSeek-V4-Flash')).not.toBeNull()
    if (rejectPatch) patch.reject(new Error('obsolete patch'))
    else patch.resolve(jsonResponse({ managedModels: { ...disabledPreference.managedModels, enabled: true } }))
    await Promise.resolve()
    expect(screen.queryByText('obsolete patch')).toBeNull()
    expect(screen.queryByText(en.serverEnabledNotice)).toBeNull()
  })
})
