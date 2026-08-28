// Shared plumbing for the web smoke tests (dist location, free port, failure shots).
import { existsSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Locator, Page } from 'playwright'

/** The built page under test; `pnpm run test:web` rebuilds it before running. */
export const DIST_INDEX = fileURLToPath(new URL('../dist/index.html', import.meta.url))

export const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))

/**
 * Browser language a page must advertise to boot into the product's Chinese
 * surface: with no stored preference the client derives its initial locale
 * from the browser, and Playwright's default browser asks for English.
 */
export const ZH_BROWSER_LOCALE = 'zh-CN'

/**
 * Open the standard browser-test page advertising English before client boot.
 * This keeps role locators and goldens deterministic while leaving the Host
 * settings document free to override the provisional browser-derived locale;
 * scenarios asserting the Chinese surface advertise
 * {@link ZH_BROWSER_LOCALE} instead.
 * @param browser - Playwright browser owning the page.
 * @param height - Viewport height; width is fixed to the lane baseline.
 * @returns the initialized page.
 */
export async function newEnglishPage(browser: Browser, height = 1000): Promise<Page> {
  return await browser.newPage({ viewport: { width: 1680, height }, locale: 'en-US' })
}

/** Open the standard browser-test page advertising Chinese before client boot. */
export async function newChinesePage(browser: Browser, height = 1000): Promise<Page> {
  return await browser.newPage({ viewport: { width: 1680, height }, locale: ZH_BROWSER_LOCALE })
}

/**
 * Expand every currently eligible Turn-process group so a Tool-focused
 * scenario can exercise the original row contract beneath product-default
 * compact Chat presentation.
 * @param page - page containing the Chat view.
 */
export async function expandTurnProcesses(page: Page): Promise<void> {
  const controls = page.locator('[data-turn-process]')
  await controls.first().waitFor({ state: 'visible', timeout: 10_000 })
  const count = await controls.count()
  for (let index = 0; index < count; index++) {
    const control = controls.nth(index)
    if (await control.getAttribute('aria-expanded') !== 'true') await control.click()
  }
}

/**
 * Expand the Turn-process group containing one possibly hidden descendant.
 * @param page - page containing the Chat view.
 * @param target - descendant whose owning Turn process should open.
 */
export async function expandOwningTurnProcess(page: Page, target: Locator): Promise<void> {
  const turn = await target.evaluate(element => element.closest<HTMLElement>('[data-chat-turn]')?.dataset.chatTurn)
  if (turn === undefined || await target.isVisible()) return
  const control = page.locator(`[data-turn-process="${turn}"]`)
  await control.waitFor({ state: 'visible', timeout: 10_000 })
  if (await control.getAttribute('aria-expanded') !== 'true') await control.click()
}

/** Fail loud on a stale checkout instead of testing yesterday's bundle. */
export function requireDist(): void {
  if (!existsSync(DIST_INDEX)) {
    throw new Error('web app dist not built — run `pnpm run build` from the repository root (`pnpm run test:web` does this first)')
  }
}

/** OS-assigned free port, released before use (the spawned `dsh web` needs a concrete --port). */
export function probeFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      if (address === null || typeof address === 'string') {
        probe.close(() => { reject(new Error('port probe returned no address')) })
        return
      }
      probe.close(() => { resolvePort(address.port) })
    })
  })
}

/**
 * Create a managed project and open it through the account portal until the
 * live composer unlocks. The scaffold-only route preserves the deterministic
 * `<root>/<name>` path used by filesystem assertions; a spawned production
 * server falls back to the public managed-project route.
 * @param page - the page under test.
 * @param root - host directory the workspace folder is staged in (the scaffold's `workspaceCwd`).
 * @param name - managed project name.
 */
export async function connectFreshWorkspace(page: Page, root: string, name = 'workspace'): Promise<void> {
  await connectManagedProject(page, root, name)
  await page.locator('[data-composer-input][contenteditable="true"][data-placeholder="Describe what you want to build... / commands, @ files or sessions"]')
    .waitFor({ timeout: 15_000 })
}

/**
 * {@link connectFreshWorkspace} over a page that advertises
 * {@link ZH_BROWSER_LOCALE}: the English helper's anchors assume the locale
 * most other scenarios boot, so a scenario that deliberately keeps zh needs
 * the localized composer copy.
 * @param page - the browser page under test.
 * @param root - workspace parent directory.
 * @param name - directory created under `root` and connected.
 */
export async function connectFreshWorkspaceZh(page: Page, root: string, name = 'workspace'): Promise<void> {
  await connectManagedProject(page, root, name)
  await page.locator('[data-composer-input][contenteditable="true"][data-placeholder="描述你想要构建的内容… / 调用指令 @ 文件或对话"]')
    .waitFor({ timeout: 15_000 })
}

/** Create a server-managed project and open it through the account portal. */
async function connectManagedProject(page: Page, root: string, name: string): Promise<void> {
  const project = await page.evaluate(async ({ expectedPath, name: requestedName }) => {
    const testResponse = await fetch(`/__dsh-e2e-workspace?name=${encodeURIComponent(requestedName)}`, {
      method: 'POST',
    })
    if (testResponse.ok) {
      const body = await testResponse.json() as { project: { name: string; path: string } }
      if (body.project.path !== expectedPath) {
        throw new Error(`test workspace path mismatch: ${body.project.path}`)
      }
      return body.project
    }
    if (testResponse.status !== 404) throw new Error(await testResponse.text())
    const response = await fetch('/auth/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: requestedName }),
    })
    if (!response.ok) throw new Error(await response.text())
    return (await response.json() as { project: { name: string; path: string } }).project
  }, { expectedPath: join(root, name), name })

  await page.goto(new URL('/', page.url()).href, { waitUntil: 'load' })
  const row = page.getByRole('button').filter({ hasText: project.name }).first()
  await row.waitFor({ timeout: 15_000 })
  await row.click()
}

/**
 * Replace the composer draft through per-key gestures. `fill()` issues
 * select-all and insertText inside one task; directly after a trigger-menu or
 * chip interaction Lexical's internal selection has not yet absorbed the DOM
 * selection, and the batched edit lands on a null selection and is silently
 * dropped, leaving the previous draft in place. Real keystrokes leave room for
 * `selectionchange` between keys, which is also what a user's typing does.
 *
 * Waits for the surface to be editable first. While the input machine is
 * adjudicating or submitting a send — and in every locked state (removed
 * session, no workspace, an owner block) — the composer renders read-only
 * with `contenteditable="false"` on the same element. `fill()` throws
 * immediately on that element, and `isEnabled()` reports `true` for a
 * `<div>` regardless of the attribute — so a gesture directly after a
 * submit must gate on the attribute, not on enablement. A running turn by
 * itself keeps the composer editable (that is what queueing types into).
 * @param page - the page under test.
 * @param input - the `[data-composer-input]` surface locator.
 * @param text - the replacement draft; `''` clears the draft. Must not
 * contain a newline: typed Enter submits the composer.
 */
export async function writeComposerDraft(
  page: Page,
  input: ReturnType<Page['locator']>,
  text: string,
): Promise<void> {
  await input.and(page.locator('[contenteditable="true"]')).waitFor({ timeout: 15_000 })
  await input.click()
  await page.keyboard.press('ControlOrMeta+A')
  if (text === '') await page.keyboard.press('Backspace')
  else await page.keyboard.type(text)
}

/** Failure evidence goes to the gitignored .artifacts/ (repo convention). */
export async function saveFailureShot(page: Page, name: string): Promise<void> {
  const dir = fileURLToPath(new URL('../../../.artifacts', import.meta.url))
  mkdirSync(dir, { recursive: true })
  try {
    await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true })
  } catch {
    // Best-effort evidence: a dead page/browser at failure time must not mask the real assertion error.
  }
}

/**
 * The conversation engine's Context key format, restated here rather than
 * imported: these specs live in the Host compiler aggregate, which must not
 * reach the Client plane. The engine's own copy is
 * `conversationContextKey` in ui-conversation; a drift between them makes
 * the key miss its rendered node, so the assertion fails loudly.
 * @param kind - Definition kind.
 * @param id - Definition-local business identity.
 * @returns the engine-owned Context key.
 */
export function conversationContextKey(kind: string, id: string): string {
  return `${kind.length}:${kind}${id}`
}
