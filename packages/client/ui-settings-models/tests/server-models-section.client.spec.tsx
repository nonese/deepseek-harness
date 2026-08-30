// @vitest-environment jsdom
/** Authenticated-server Models settings behavior over the user preference route. */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModelsSection } from '../src/client/ModelsSection.tsx'
import { ServerModelsSection } from '../src/client/ServerModelsSection.tsx'
import { en } from '../src/client/locales.ts'

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

describe('ServerModelsSection', () => {
  it('loads the user-scoped sources and enables managed models', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse(disabledPreference))
      .mockResolvedValueOnce(jsonResponse({
        managedModels: { ...disabledPreference.managedModels, enabled: true },
      }))
    vi.stubGlobal('fetch', fetch)

    render(<ServerModelsSection t={t} />)

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

    render(<ServerModelsSection t={t} />)

    const toggle = await screen.findByRole('switch', { name: en.serverUseManaged })
    expect((toggle as HTMLButtonElement).disabled).toBe(true)
  })

  it('retries a failed preference read', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'temporary failure' } }, 503))
      .mockResolvedValueOnce(jsonResponse(disabledPreference))
    vi.stubGlobal('fetch', fetch)

    render(<ServerModelsSection t={t} />)

    expect((await screen.findByRole('alert')).textContent).toContain('temporary failure')
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    expect(await screen.findByText('DeepSeek-V4-Flash')).not.toBeNull()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('replaces the process-global provider editor in a multi-user browser', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse(disabledPreference))
    vi.stubGlobal('fetch', fetch)
    vi.stubGlobal('__HARNESS_MULTI_USER__', true)

    render(<ModelsSection t={t} renderSlot={vi.fn() as never} />)

    expect(await screen.findByRole('heading', { name: en.serverTitle })).not.toBeNull()
    expect(screen.queryByText(en.loadFailed)).toBeNull()
    await waitFor(() => { expect(fetch).toHaveBeenCalledOnce() })
  })
})
