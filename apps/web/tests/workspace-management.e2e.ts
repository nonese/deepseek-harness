/** Browser acceptance for server-managed per-user projects. */

import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  launchWebScaffold,
  watchConsole,
  type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

interface ProjectView {
  id: string
  name: string
  path: string
  sessionCount: number
}

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

  it('stays free of browser errors and model calls', () => {
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })
})
