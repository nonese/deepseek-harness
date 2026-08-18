// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { HarnessPortal } from '@deepseek-ai/dsh-client-web/src/HarnessPortal.tsx'
import type { ClientAuthUser } from '@deepseek-ai/dsh-client-web/src/auth-state.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const admin: ClientAuthUser = {
  id: 'admin-1',
  username: 'admin',
  displayName: '管理员',
  role: 'admin',
  status: 'active',
  authMethods: ['local'],
  createdAt: new Date(0).toISOString(),
}

const member: ClientAuthUser = { ...admin, id: 'user-1', username: 'member', displayName: '成员', role: 'user' }

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } })
}

function mount(user: ClientAuthUser) {
  const renderRuntime = vi.fn(() => <div>Harness runtime</div>)
  const result = render(
    <HarnessPortal
      user={user}
      renderRuntime={renderRuntime}
      openWorkspace={() => {}}
      startSession={() => {}}
      onLogout={() => Promise.resolve()}
    />,
  )
  return { renderRuntime, ...result }
}

describe('HarnessPortal administrator navigation', () => {
  it('opens the protected system status page instead of the personal runtime', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (path === '/auth/projects') return jsonResponse({ projects: [] })
      if (path === '/auth/system/shared-deepseek') {
        expect(init?.method).toBe('PUT')
        expect(typeof init?.body).toBe('string')
        expect(JSON.parse(init?.body as string)).toEqual({ apiKey: 'sk-browser-test-secret' })
        return jsonResponse({
          sharedDeepSeek: {
            provider: 'deepseek-official', model: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash',
            configured: true, writable: true,
          },
        })
      }
      if (path === '/auth/system/oidc') {
        expect(init?.method).toBe('PUT')
        const body = JSON.parse(init?.body as string) as Record<string, unknown>
        expect(body).toMatchObject({
          enabled: true,
          issuer: 'http://identity.internal/api/oidc',
          clientId: 'harness-browser-test',
          clientSecret: 'oidc-browser-secret',
          scopes: ['openid', 'profile', 'email', 'groups'],
          clientAuthMethod: 'client_secret_basic',
          allowInsecureIssuer: true,
          administratorGroup: 'super_admin',
        })
        return jsonResponse({
          oidc: {
            configured: true,
            enabled: true,
            clientSecretConfigured: true,
            clientSecretWritable: true,
            settings: { ...body, clientSecret: undefined },
          },
        })
      }
      if (path === '/auth/system') {
        return jsonResponse({
          runtime: { processModel: 'single-process', storage: 'file-backed', dataRoot: '/srv/harness' },
          users: { total: 3, active: 2, administrators: 1 },
          authentication: {
            oidcConfigured: false,
            oidc: {
              configured: false,
              enabled: false,
              clientSecretConfigured: false,
              clientSecretWritable: true,
            },
            localLoginEnabled: true,
            cookie: { name: 'harness_session', httpOnly: true, sameSite: 'Lax', secure: false },
          },
          isolation: {
            userDirectoryKey: 'stable-user-id',
            projectsManaged: true,
            administratorContentAccess: false,
          },
          sharedDeepSeek: {
            provider: 'deepseek-official', model: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash',
            configured: false, writable: true, enabledUsers: 0,
          },
          limits: { maxBodyBytes: 64 * 1024 },
        })
      }
      throw new Error(`unexpected request: ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { getByLabelText, getByRole, getByText, renderRuntime } = mount(admin)
    fireEvent.click(getByRole('button', { name: '系统设置' }))

    await waitFor(() => { expect(getByRole('heading', { name: '系统设置' })).toBeTruthy() })
    expect(getByText('单进程')).toBeTruthy()
    expect(getByText('文件存储')).toBeTruthy()
    expect(getByText('稳定用户 ID（不使用用户名）')).toBeTruthy()
    expect(getByText('仅管理账号元数据，不可查看用户项目内容')).toBeTruthy()
    expect(getByText('64 KiB')).toBeTruthy()
    expect(getByText('统一模型 API')).toBeTruthy()
    expect(getByText('企业 OIDC 登录')).toBeTruthy()
    expect(getByText('DeepSeek-V4-Flash')).toBeTruthy()
    expect(renderRuntime).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledWith('/auth/system', expect.anything())

    fireEvent.change(getByLabelText('设置 API Key'), { target: { value: 'sk-browser-test-secret' } })
    fireEvent.click(getByRole('button', { name: '保存 Key' }))
    await waitFor(() => {
      expect(getByText('统一 DeepSeek API Key 已保存。用户需要在“设置”中主动启用，才会在 DeepSeek-V4-Flash 请求中使用。')).toBeTruthy()
    })
    expect(getByLabelText('替换 API Key')).toHaveProperty('value', '')

    fireEvent.change(getByLabelText('Issuer URL'), { target: { value: 'http://identity.internal/api/oidc' } })
    fireEvent.change(getByLabelText('Client ID'), { target: { value: 'harness-browser-test' } })
    fireEvent.change(getByLabelText('Client Secret'), { target: { value: 'oidc-browser-secret' } })
    fireEvent.click(getByLabelText('允许企业 SSO 登录'))
    fireEvent.click(getByRole('button', { name: '保存 OIDC 配置' }))
    await waitFor(() => {
      expect(getByText('OIDC 配置已保存并启用，登录页现在可使用企业 SSO。')).toBeTruthy()
    })
    expect(getByLabelText('替换 Client Secret')).toHaveProperty('value', '')
  })

  it('gives an ordinary user a personal shared-model switch without exposing administration', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (path === '/auth/projects') return jsonResponse({ projects: [] })
      if (path === '/auth/preferences' && init?.method === 'PATCH') {
        expect(typeof init.body).toBe('string')
        expect(JSON.parse(init.body as string)).toEqual({ sharedDeepSeekEnabled: true })
        return jsonResponse({
          sharedDeepSeek: {
            provider: 'deepseek-official', model: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash',
            configured: true, writable: true, enabled: true,
          },
        })
      }
      if (path === '/auth/preferences') {
        return jsonResponse({
          sharedDeepSeek: {
            provider: 'deepseek-official', model: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash',
            configured: true, writable: true, enabled: false,
          },
        })
      }
      throw new Error(`unexpected request: ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { getByLabelText, getByRole, getByText, queryByRole, renderRuntime } = mount(member)
    expect(queryByRole('button', { name: '系统设置' })).toBeNull()
    expect(queryByRole('button', { name: '用户管理' })).toBeNull()
    fireEvent.click(getByRole('button', { name: '设置' }))
    await waitFor(() => { expect(getByRole('heading', { name: '设置' })).toBeTruthy() })
    expect(getByText('管理员已配置')).toBeTruthy()
    expect(renderRuntime).not.toHaveBeenCalled()
    fireEvent.click(getByLabelText('未启用'))
    await waitFor(() => { expect(getByText('已启用统一 DeepSeek-V4-Flash。')).toBeTruthy() })
    expect(getByLabelText('已启用')).toHaveProperty('checked', true)
  })
})
