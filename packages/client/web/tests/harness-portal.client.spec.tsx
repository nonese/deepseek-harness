// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import {
  HarnessPortal, type ActiveWorkspaceSource,
} from '@deepseek-ai/dsh-client-web/src/HarnessPortal.tsx'
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

function mount(user: ClientAuthUser, activeWorkspace?: ActiveWorkspaceSource) {
  const renderRuntime = vi.fn(() => <div>Harness runtime</div>)
  const openWorkspace = vi.fn()
  const result = render(
    <HarnessPortal
      user={user}
      t={translate}
      renderRuntime={renderRuntime}
      {...activeWorkspace === undefined ? {} : { activeWorkspace }}
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
      if (path === '/auth/system/managed-models/deepseek-official') {
        expect(init?.method).toBe('PUT')
        expect(typeof init?.body).toBe('string')
        expect(JSON.parse(init?.body as string)).toEqual({ apiKey: 'sk-browser-test-secret' })
        return jsonResponse({
          managedModels: {
            configured: true,
            sites: [{
              id: 'deepseek-official', kind: 'deepseek-official', provider: 'deepseek-official',
              name: 'DeepSeek', baseURL: 'https://api.deepseek.com',
              models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash' }],
              configured: true, writable: true,
            }],
          },
        })
      }
      if (path === '/auth/system/managed-models/discover') {
        expect(init?.method).toBe('POST')
        expect(JSON.parse(init?.body as string)).toEqual({
          baseURL: 'https://new-api.example.test/v1',
          apiKey: 'sk-custom-browser-secret',
        })
        return jsonResponse({
          models: [
            { id: 'MiniMax M3', name: 'MiniMax M3' },
            { id: 'deepseek-chat', name: 'DeepSeek Chat' },
            { id: 'gpt-4.1-mini', name: 'gpt-4.1-mini' },
          ],
        })
      }
      if (path === '/auth/system/managed-models/sites') {
        expect(init?.method).toBe('POST')
        expect(JSON.parse(init?.body as string)).toEqual({
          name: '校内 New API',
          baseURL: 'https://new-api.example.test/v1',
          models: ['MiniMax M3', 'deepseek-chat', 'gpt-4.1-mini'],
          apiKey: 'sk-custom-browser-secret',
        })
        return jsonResponse({
          managedModels: {
            configured: true,
            sites: [
              {
                id: 'deepseek-official', kind: 'deepseek-official', provider: 'deepseek-official',
                name: 'DeepSeek', baseURL: 'https://api.deepseek.com',
                models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash' }],
                configured: true, writable: true,
              },
              {
                id: 'a1b2c3d4e5f6', kind: 'openai-compatible', provider: 'managed-a1b2c3d4e5f6',
                name: '校内 New API', baseURL: 'https://new-api.example.test/v1',
                models: [
                  { id: 'MiniMax M3', name: 'MiniMax M3' },
                  { id: 'deepseek-chat', name: 'deepseek-chat' },
                  { id: 'gpt-4.1-mini', name: 'gpt-4.1-mini' },
                ],
                configured: true, writable: true,
              },
            ],
          },
        }, 201)
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
          managedModels: {
            configured: false,
            sites: [{
              id: 'deepseek-official', kind: 'deepseek-official', provider: 'deepseek-official',
              name: 'DeepSeek', baseURL: 'https://api.deepseek.com',
              models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash' }],
              configured: false, writable: true,
            }],
            enabledUsers: 0,
          },
          limits: { maxBodyBytes: 64 * 1024 },
        })
      }
      throw new Error(`unexpected request: ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { getByLabelText, getByPlaceholderText, getByRole, getByText, renderRuntime } = mount(admin)
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
    expect(getByText('可用站点').parentElement?.querySelector('strong')?.textContent).toBe('0')
    expect(getByText('自定义站点').parentElement?.querySelector('strong')?.textContent).toBe('0')
    expect(renderRuntime).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledWith('/auth/system', expect.anything())

    fireEvent.change(getByPlaceholderText('输入 DeepSeek API Key'), { target: { value: 'sk-browser-test-secret' } })
    fireEvent.click(getByRole('button', { name: '保存 Key' }))
    await waitFor(() => {
      expect(getByText('DeepSeek 官方站点 API Key 已保存。用户需要在“设置”中主动启用后才能使用。')).toBeTruthy()
    })
    expect(getByText('可用站点').parentElement?.querySelector('strong')?.textContent).toBe('1')
    expect(getByLabelText('替换 API Key')).toHaveProperty('value', '')
    await waitFor(() => { expect(getByPlaceholderText('例如：校内 New API')).toHaveProperty('disabled', false) })

    fireEvent.change(getByPlaceholderText('例如：校内 New API'), { target: { value: '校内 New API' } })
    fireEvent.change(getByPlaceholderText('例如：https://new-api.example.com/v1'), { target: { value: 'https://new-api.example.test/v1' } })
    fireEvent.change(getByPlaceholderText('输入该站点的 API Key'), { target: { value: 'sk-custom-browser-secret' } })
    await waitFor(() => {
      expect(getByRole('checkbox', { name: 'MiniMax M3' })).toBeTruthy()
    }, { timeout: 2_000 })
    fireEvent.click(getByRole('checkbox', { name: 'MiniMax M3' }))
    fireEvent.click(getByRole('checkbox', { name: /DeepSeek Chat/ }))
    fireEvent.click(getByRole('checkbox', { name: 'gpt-4.1-mini' }))
    fireEvent.click(getByRole('button', { name: '添加站点' }))
    await waitFor(() => { expect(getByText('自定义统一模型站点已添加。')).toBeTruthy() })
    expect(getByText('校内 New API')).toBeTruthy()
    expect(getByText('可用站点').parentElement?.querySelector('strong')?.textContent).toBe('2')
    expect(getByText('自定义站点').parentElement?.querySelector('strong')?.textContent).toBe('1')

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

  it('docks the current workspace files beside the runtime and follows workspace changes', async () => {
    const firstProject = {
      id: 'workspace/one',
      name: '课程项目',
      path: '/srv/harness/users/user-1/projects/workspace-one',
      sessionCount: 1,
      createdAt: 0,
      updatedAt: Date.now(),
    }
    const secondProject = {
      ...firstProject,
      id: 'workspace/two',
      name: '备课资料',
      path: '/srv/harness/users/user-1/projects/workspace-two',
    }
    let currentWorkspace = firstProject.id
    const listeners = new Set<() => void>()
    const activeWorkspace: ActiveWorkspaceSource = {
      getSnapshot: () => currentWorkspace,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    }
    let uploaded = false
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (path === '/auth/projects') return jsonResponse({ projects: [firstProject, secondProject] })
      if (path === '/auth/projects/workspace%2Fone/files') {
        return jsonResponse({
          directory: {
            path: '',
            entries: [{
              name: 'README.md', path: 'README.md', kind: 'file', size: 512, updatedAt: 0, previewable: true,
            }],
          },
        })
      }
      if (path === '/auth/projects/workspace%2Fone/files/preview?path=README.md') {
        return jsonResponse({
          preview: {
            file: { name: 'README.md', path: 'README.md', size: 512, updatedAt: 0, format: 'markdown' },
            content: '# 当前课程\n\n这是右侧工作区预览。',
          },
        })
      }
      if (path === '/auth/projects/workspace%2Ftwo/files') {
        return jsonResponse({
          directory: {
            path: '',
            entries: uploaded
              ? [{ name: '新课件.pptx', path: '新课件.pptx', kind: 'file', size: 4, updatedAt: 0, previewable: false }]
              : [{ name: 'notes.txt', path: 'notes.txt', kind: 'file', size: 12, updatedAt: 0, previewable: true }],
          },
        })
      }
      if (path === '/auth/projects/workspace%2Ftwo/files/upload?name=%E6%96%B0%E8%AF%BE%E4%BB%B6.pptx') {
        expect(init?.method).toBe('PUT')
        uploaded = true
        return jsonResponse({ file: { name: '新课件.pptx' } }, 201)
      }
      throw new Error(`unexpected request: ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    history.replaceState(null, '', '/?view=runtime')

    const { getByRole, getByText, queryByRole, queryByText } = mount(member, activeWorkspace)
    await waitFor(() => {
      expect(getByRole('region', { name: '当前工作区文件：课程项目' })).toBeTruthy()
      expect(getByRole('button', { name: 'README.md' })).toBeTruthy()
    })
    expect(getByText('Harness runtime')).toBeTruthy()
    fireEvent.click(getByRole('button', { name: 'README.md' }))
    await waitFor(() => { expect(getByRole('heading', { name: '当前课程' })).toBeTruthy() })
    expect(getByText('这是右侧工作区预览。')).toBeTruthy()
    fireEvent.click(getByRole('button', { name: '返回文件列表' }))

    act(() => {
      currentWorkspace = secondProject.id
      for (const listener of listeners) listener()
    })
    await waitFor(() => {
      expect(getByRole('region', { name: '当前工作区文件：备课资料' })).toBeTruthy()
      expect(getByRole('button', { name: 'notes.txt' })).toBeTruthy()
    })
    const conversationArea = getByRole('region', { name: '会话主区域' })
    const presentation = new File(['pptx'], '新课件.pptx', {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    })
    const officeTransfer = {
      files: [presentation],
      items: [{ kind: 'file', type: presentation.type }],
      types: ['Files'],
      dropEffect: 'none',
    }
    const documentDrop = vi.fn()
    document.addEventListener('drop', documentDrop)
    fireEvent.dragEnter(conversationArea, { dataTransfer: officeTransfer })
    expect(getByText('松开即可上传到当前工作区')).toBeTruthy()
    expect(getByText('文件将保存到“备课资料”的根目录；纯图片仍作为会话附件。')).toBeTruthy()
    expect(fireEvent.dragOver(conversationArea, { dataTransfer: officeTransfer })).toBe(false)
    expect(officeTransfer.dropEffect).toBe('copy')
    fireEvent.drop(conversationArea, { dataTransfer: officeTransfer })
    expect(documentDrop).not.toHaveBeenCalled()
    await waitFor(() => { expect(getByText('已将 1 个文件上传到“备课资料”。')).toBeTruthy() })
    await waitFor(() => { expect(getByText('新课件.pptx')).toBeTruthy() })

    const image = new File(['png'], '课堂照片.png', { type: 'image/png' })
    const imageTransfer = {
      files: [image],
      items: [{ kind: 'file', type: image.type }],
      types: ['Files'],
      dropEffect: 'none',
    }
    expect(fireEvent.dragEnter(conversationArea, { dataTransfer: imageTransfer })).toBe(true)
    expect(queryByText('松开即可上传到当前工作区')).toBeNull()
    expect(fireEvent.drop(conversationArea, { dataTransfer: imageTransfer })).toBe(true)
    expect(documentDrop).toHaveBeenCalledOnce()
    document.removeEventListener('drop', documentDrop)

    fireEvent.click(getByRole('button', { name: '收起工作区文件' }))
    expect(queryByRole('region', { name: '当前工作区文件：备课资料' })).toBeNull()
    fireEvent.click(getByRole('button', { name: '显示工作区文件' }))
    await waitFor(() => { expect(getByRole('region', { name: '当前工作区文件：备课资料' })).toBeTruthy() })
  })

  it('uploads files into the current project folder and reports name conflicts', async () => {
    const project = {
      id: 'workspace-1',
      name: '课件项目',
      path: '/srv/harness/project',
      sessionCount: 0,
      createdAt: 0,
      updatedAt: 0,
    }
    let uploaded = false
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (path === '/auth/projects') return jsonResponse({ projects: [project] })
      if (path === '/auth/projects/workspace-1/files') {
        return jsonResponse({
          directory: {
            path: '',
            entries: uploaded
              ? [{ name: '教案.docx', path: '教案.docx', kind: 'file', size: 4, updatedAt: 0, previewable: false }]
              : [],
          },
        })
      }
      if (path === '/auth/projects/workspace-1/files/upload?name=%E6%95%99%E6%A1%88.docx') {
        expect(init?.method).toBe('PUT')
        expect(init?.body).toBeInstanceOf(File)
        if (uploaded) return jsonResponse({ error: { message: '同名文件已存在，请先更名' } }, 409)
        uploaded = true
        return jsonResponse({ file: { name: '教案.docx' } }, 201)
      }
      throw new Error(`unexpected request: ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { container, getByRole, getByText } = mount(member)
    await waitFor(() => { expect(getByText('课件项目')).toBeTruthy() })
    fireEvent.click(getByRole('button', { name: '文件' }))
    await waitFor(() => { expect(getByText('这个文件夹还是空的。')).toBeTruthy() })
    const input = container.querySelector('input[type="file"]')
    if (!(input instanceof HTMLInputElement)) throw new Error('project upload input is missing')
    const file = new File(['docx'], '教案.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => { expect(getByText('已上传 1 个文件。')).toBeTruthy() })
    await waitFor(() => { expect(getByText('教案.docx')).toBeTruthy() })

    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => { expect(getByRole('alert').textContent).toBe('同名文件已存在，请先更名') })
  })

  it('uploads Word, PowerPoint, and Excel files dropped into the current project', async () => {
    const project = {
      id: 'workspace-1',
      name: 'Office 资料',
      path: '/srv/harness/project',
      sessionCount: 0,
      createdAt: 0,
      updatedAt: 0,
    }
    const uploaded = new Set<string>()
    const files = [
      new File(['docx'], '教案.docx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
      new File(['pptx'], '课件.pptx', {
        type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      }),
      new File(['xlsx'], '成绩.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    ]
    const expectedTypes = new Map(files.map(file => [file.name, file.type]))
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (path === '/auth/projects') return jsonResponse({ projects: [project] })
      if (path === '/auth/projects/workspace-1/files') {
        return jsonResponse({
          directory: {
            path: '',
            entries: [...uploaded].map(name => ({
              name, path: name, kind: 'file', size: 4, updatedAt: 0, previewable: false,
            })),
          },
        })
      }
      if (path.startsWith('/auth/projects/workspace-1/files/upload?name=')) {
        const file = init?.body
        expect(init?.method).toBe('PUT')
        expect(file).toBeInstanceOf(File)
        if (!(file instanceof File)) throw new Error('upload request body is not a File')
        expect(file.type).toBe(expectedTypes.get(file.name))
        uploaded.add(file.name)
        return jsonResponse({ file: { name: file.name } }, 201)
      }
      throw new Error(`unexpected request: ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { getByRole, getByText, queryByRole } = mount(member)
    await waitFor(() => { expect(getByText('Office 资料')).toBeTruthy() })
    fireEvent.click(getByRole('button', { name: '文件' }))
    const dialog = await waitFor(() => getByRole('dialog', { name: '项目文件：Office 资料' }))
    const dataTransfer = { files, types: ['Files'], dropEffect: 'none' }
    fireEvent.dragEnter(dialog, { dataTransfer: { files: [], types: ['text/plain'], dropEffect: 'none' } })
    expect(queryByRole('status')).toBeNull()
    fireEvent.dragEnter(dialog, { dataTransfer })
    expect(getByRole('status').textContent).toContain('松开即可上传到当前文件夹')
    expect(getByRole('status').textContent).toContain('.docx')
    expect(getByRole('status').textContent).toContain('.pptx')
    expect(getByRole('status').textContent).toContain('.xlsx')
    fireEvent.dragEnter(dialog, { dataTransfer })
    fireEvent.dragLeave(dialog, { dataTransfer })
    expect(getByRole('status')).toBeTruthy()
    fireEvent.dragLeave(dialog, { dataTransfer })
    expect(queryByRole('status')).toBeNull()
    fireEvent.dragEnter(dialog, { dataTransfer })
    expect(fireEvent.dragOver(dialog, { dataTransfer })).toBe(false)
    expect(dataTransfer.dropEffect).toBe('copy')
    fireEvent.drop(dialog, { dataTransfer })

    await waitFor(() => { expect(getByText('已上传 3 个文件。')).toBeTruthy() })
    for (const file of files) {
      await waitFor(() => { expect(getByText(file.name)).toBeTruthy() })
    }
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
        expect(JSON.parse(init.body as string)).toEqual({ managedModelsEnabled: true })
        return jsonResponse({
          managedModels: {
            configured: true, enabled: true,
            sites: [{
              id: 'deepseek-official', kind: 'deepseek-official', provider: 'deepseek-official',
              name: 'DeepSeek', baseURL: 'https://api.deepseek.com',
              models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash' }],
              configured: true, writable: true,
            }],
          },
        })
      }
      if (path === '/auth/preferences') {
        return jsonResponse({
          managedModels: {
            configured: true, enabled: false,
            sites: [{
              id: 'deepseek-official', kind: 'deepseek-official', provider: 'deepseek-official',
              name: 'DeepSeek', baseURL: 'https://api.deepseek.com',
              models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash' }],
              configured: true, writable: true,
            }],
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
    await waitFor(() => { expect(getByText('已启用管理员提供的统一模型站点。')).toBeTruthy() })
    expect(getByLabelText('已启用')).toHaveProperty('checked', true)
  })
})
