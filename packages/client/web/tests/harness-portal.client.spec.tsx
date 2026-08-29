// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { HarnessPortal } from '@deepseek-ai/dsh-client-web/src/HarnessPortal.tsx'
import type { ClientAuthUser } from '@deepseek-ai/dsh-client-web/src/auth-state.ts'
import { zh, type WebCopyKey } from '@deepseek-ai/dsh-client-web/src/locales.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  history.replaceState(null, '', '/')
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

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

function translate(key: WebCopyKey, params?: Readonly<Record<string, unknown>>): string {
  const template = zh[key]
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

function mount(user: ClientAuthUser) {
  const renderRuntime = vi.fn(() => <div>Harness runtime</div>)
  const openWorkspace = vi.fn()
  const result = render(
    <HarnessPortal
      user={user}
      t={translate}
      renderRuntime={renderRuntime}
      openWorkspace={openWorkspace}
      startSession={() => {}}
      onLogout={() => Promise.resolve()}
    />,
  )
  return { openWorkspace, renderRuntime, ...result }
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

  it('browses an owned project, previews Markdown, navigates folders, and keeps opening separate', async () => {
    const project = {
      id: 'workspace/one',
      name: '课程项目',
      path: '/srv/harness/users/user-1/projects/workspace-one',
      sessionCount: 0,
      createdAt: 0,
      updatedAt: Date.now(),
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (path === '/auth/projects') return jsonResponse({ projects: [project] })
      if (path === '/auth/projects/workspace%2Fone/files') {
        return jsonResponse({
          directory: {
            path: '',
            entries: [
              { name: 'src', path: 'src', kind: 'directory', updatedAt: 0, previewable: false },
              { name: 'README.md', path: 'README.md', kind: 'file', size: 512, updatedAt: 0, previewable: true },
              { name: 'archive.bin', path: 'archive.bin', kind: 'file', size: 2 * 1024 * 1024, updatedAt: 0, previewable: false },
            ],
          },
        })
      }
      if (path === '/auth/projects/workspace%2Fone/files/preview?path=README.md') {
        return jsonResponse({
          preview: {
            file: { name: 'README.md', path: 'README.md', size: 512, updatedAt: 0, format: 'markdown' },
            content: '# 课程说明\n\n这是私有项目。',
          },
        })
      }
      if (path === '/auth/projects/workspace%2Fone/files?path=src') {
        return jsonResponse({ directory: { path: 'src', entries: [] } })
      }
      throw new Error(`unexpected request: ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { getByRole, getByText, openWorkspace, queryByRole } = mount(member)
    await waitFor(() => { expect(getByText('课程项目')).toBeTruthy() })
    fireEvent.click(getByRole('button', { name: '文件' }))
    await waitFor(() => { expect(getByRole('dialog', { name: '项目文件：课程项目' })).toBeTruthy() })
    expect(openWorkspace).not.toHaveBeenCalled()
    expect(getByText('512 B')).toBeTruthy()
    expect(getByText('2.0 MiB')).toBeTruthy()
    const binaryDownload = getByRole('link', { name: 'archive.bin' })
    expect(binaryDownload.getAttribute('href')).toBe('/auth/projects/workspace%2Fone/files/download?path=archive.bin')

    fireEvent.click(getByRole('button', { name: 'README.md' }))
    await waitFor(() => { expect(getByRole('heading', { name: '课程说明' })).toBeTruthy() })
    expect(getByText('这是私有项目。')).toBeTruthy()
    expect(getByRole('link', { name: '下载 README.md' }).getAttribute('href'))
      .toBe('/auth/projects/workspace%2Fone/files/download?path=README.md')

    fireEvent.click(getByRole('button', { name: 'src' }))
    await waitFor(() => { expect(getByText('这个文件夹还是空的。')).toBeTruthy() })
    expect(getByRole('navigation', { name: '项目文件路径' })).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(queryByRole('dialog')).toBeNull()

    fireEvent.click(getByRole('button', { name: '打开' }))
    expect(openWorkspace).toHaveBeenCalledWith('workspace/one')
    expect(getByText('Harness runtime')).toBeTruthy()
  })

  it('renders text preview and localized list and preview failures', async () => {
    const project = {
      id: 'workspace-1',
      name: '故障项目',
      path: '/srv/harness/project',
      sessionCount: 0,
      createdAt: 0,
      updatedAt: 0,
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (path === '/auth/projects') return jsonResponse({ projects: [project] })
      if (path === '/auth/projects/workspace-1/files') {
        return jsonResponse({
          directory: {
            path: '',
            entries: [
              { name: 'broken', path: 'broken', kind: 'directory', updatedAt: 0, previewable: false },
              { name: 'bad.txt', path: 'bad.txt', kind: 'file', size: 2048, updatedAt: 0, previewable: true },
              { name: 'notes.txt', path: 'notes.txt', kind: 'file', size: 12 * 1024, updatedAt: 0, previewable: true },
            ],
          },
        })
      }
      if (path === '/auth/projects/workspace-1/files/preview?path=bad.txt') {
        return new Response('not json', { status: 503 })
      }
      if (path === '/auth/projects/workspace-1/files/preview?path=notes.txt') {
        return jsonResponse({
          preview: {
            file: { name: 'notes.txt', path: 'notes.txt', size: 12 * 1024, updatedAt: 0, format: 'text' },
            content: 'plain text preview',
          },
        })
      }
      if (path === '/auth/projects/workspace-1/files?path=broken') {
        return jsonResponse({ error: { message: '目录暂时不可读' } }, 400)
      }
      throw new Error(`unexpected request: ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { getAllByRole, getByRole, getByText } = mount(member)
    await waitFor(() => { expect(getByText('故障项目')).toBeTruthy() })
    fireEvent.click(getByRole('button', { name: '文件' }))
    await waitFor(() => { expect(getByText('2.0 KiB')).toBeTruthy() })
    expect(getByText('12 KiB')).toBeTruthy()

    fireEvent.click(getByRole('button', { name: 'bad.txt' }))
    await waitFor(() => { expect(getByRole('alert').textContent).toBe('请求失败（503）') })
    fireEvent.click(getByRole('button', { name: 'notes.txt' }))
    await waitFor(() => { expect(getByText('plain text preview')).toBeTruthy() })
    fireEvent.click(getByRole('button', { name: 'broken' }))
    await waitFor(() => {
      const alerts = getAllByRole('alert')
      expect(alerts.at(-1)?.textContent).toBe('目录暂时不可读')
    })
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
