import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const DIST_ROOT = fileURLToPath(new URL('../dist', import.meta.url))

it('ships install metadata with the built web application', async () => {
  const index = await readFile(join(DIST_ROOT, 'index.html'), 'utf8')
  expect(index).toContain('<link rel="manifest" href="./manifest.webmanifest" />')

  const manifest: unknown = JSON.parse(await readFile(join(DIST_ROOT, 'manifest.webmanifest'), 'utf8'))
  expect(manifest).toEqual({
    id: '/',
    name: 'Harness',
    short_name: 'Harness',
    start_url: '/',
    scope: '/',
    display: 'fullscreen',
  })
})

it('does not ship the former vendor logo as a favicon', async () => {
  expect(await readFile(join(DIST_ROOT, 'index.html'), 'utf8')).not.toContain('favicon.svg')
})
