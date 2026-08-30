/** Browser acceptance for server-managed per-user projects. */

import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory,
  captureStableAria,
  compareOrRefreshGolden,
  launchWebScaffold,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

interface ProjectView {
  id: string
  name: string
  path: string
  sessionCount: number
}

const MODE = webSnapshotMode()
const EXPECTED_DIR = fileURLToPath(new URL('./expected/project-files/', import.meta.url))
const LIST_EXPECTED = fileURLToPath(new URL('./expected/project-files/list.expected.md', import.meta.url))
const PREVIEW_EXPECTED = fileURLToPath(new URL('./expected/project-files/preview.expected.md', import.meta.url))

describe('web e2e: server-managed project lifecycle', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  async function createProject(name: string): Promise<void> {
    await page.getByRole('button', { name: 'New project', exact: true }).click()
    await page.getByLabel('Project name', { exact: true }).fill(name)
    await page.getByRole('button', { name: 'Create project', exact: true }).click()
    await page.getByRole('button', { name: new RegExp(`^${name}`) }).waitFor({ timeout: 10_000 })
  }

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: 'Back to my projects', exact: true }).click()
    await page.getByRole('heading', { name: 'My projects', exact: true }).waitFor({ timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('creates projects only under the authenticated administrator managed root', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-managed-projects'))
    await createProject('Alpha workspace')
    await createProject('Beta workspace')

    const response = await scaffold.hostFetch('/auth/projects')
    expect(response.status).toBe(200)
    const body = await response.json() as { projects: ProjectView[] }
    expect(body.projects.map(project => project.name).sort()).toEqual(['Alpha workspace', 'Beta workspace'])

    const administrator = scaffold.ctx.auth.listUsers().find(user => user.role === 'admin')
    if (administrator === undefined) throw new Error('managed-project e2e has no administrator')
    const managedRoot = await realpath(scaffold.ctx.auth.userPaths(administrator.id).projects)
    for (const project of body.projects) {
      const path = await realpath(project.path)
      const suffix = relative(managedRoot, path)
      expect(isAbsolute(suffix)).toBe(false)
      expect(suffix).not.toBe('')
      expect(suffix.startsWith('..')).toBe(false)
      expect((await stat(path)).isDirectory()).toBe(true)
      expect(await page.locator('body').innerText()).not.toContain(path)
    }
  })

  it('opens a managed project in Harness while arbitrary directory creation stays unavailable', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-managed-project-runtime'))
    await page.getByRole('button', { name: /^Alpha workspace/ }).click()
    await page.getByRole('button', { name: 'Back to my projects', exact: true }).waitFor({ timeout: 30_000 })
    await page.getByRole('button', { name: 'Add workspace', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Select Workspace Directory' })
    await dialog.waitFor({ timeout: 10_000 })
    expect(await dialog.getByRole('button', { name: 'New folder', exact: true }).isDisabled()).toBe(true)
    await page.keyboard.press('Escape')
  })

  it('browses, previews, uploads, and downloads files from the selected managed project', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-managed-project-files'))
    await page.getByRole('button', { name: 'Back to my projects', exact: true }).click()
    const response = await scaffold.hostFetch('/auth/projects')
    const body = await response.json() as { projects: ProjectView[] }
    const project = body.projects.find(candidate => candidate.name === 'Alpha workspace')
    if (project === undefined) throw new Error('Alpha workspace is missing')
    await mkdir(join(project.path, 'src'))
    await writeFile(join(project.path, 'README.md'), '# Alpha guide\n\nPrivate managed content.\n')
    await writeFile(join(project.path, 'src', 'main.ts'), 'export const alpha = true\n')
    await writeFile(join(project.path, 'archive.bin'), Buffer.from([1, 2, 3]))

    const row = page.locator('[class*="projectRow"]').filter({ hasText: 'Alpha workspace' })
    await row.getByRole('button', { name: 'Files', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Project files: Alpha workspace', exact: true })
    await dialog.waitFor({ timeout: 10_000 })
    await dialog.getByText('README.md', { exact: true }).waitFor()
    await compareOrRefreshGolden(
      LIST_EXPECTED,
      await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd),
      MODE,
    )

    await dialog.getByRole('button', { name: 'README.md', exact: true }).click()
    await dialog.getByRole('heading', { name: 'Alpha guide', exact: true }).waitFor()
    expect(await dialog.getByText('Private managed content.', { exact: true }).isVisible()).toBe(true)
    expect(await dialog.getByRole('link', { name: 'Download README.md', exact: true }).getAttribute('href'))
      .toContain('/files/download?path=README.md')
    await compareOrRefreshGolden(
      PREVIEW_EXPECTED,
      await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd),
      MODE,
    )

    const uploadContent = Buffer.from('Teacher-owned lesson plan\n')
    await dialog.locator('input[type="file"]').setInputFiles({
      name: 'lesson-plan.txt',
      mimeType: 'text/plain',
      buffer: uploadContent,
    })
    await dialog.getByText('Uploaded 1 file(s).', { exact: true }).waitFor()
    await dialog.getByText('lesson-plan.txt', { exact: true }).waitFor()
    const downloadStarted = page.waitForEvent('download')
    await dialog.getByRole('link', { name: 'Download lesson-plan.txt', exact: true }).click()
    const download = await downloadStarted
    expect(download.suggestedFilename()).toBe('lesson-plan.txt')
    const downloadedPath = await download.path()
    if (downloadedPath === null) throw new Error('browser download did not produce a local file')
    expect(await readFile(downloadedPath)).toEqual(uploadContent)
    await dialog.getByRole('button', { name: 'Close project files', exact: true }).click()
  })

  it('stays free of browser errors and model calls', async () => {
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    await assertFixtureInventory(EXPECTED_DIR, ['list.expected.md', 'preview.expected.md'])
  })
})
