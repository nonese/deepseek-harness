/** Squirrel lifecycle gate that runs before Electron and desktop dependencies load. */

import { spawnSync } from 'node:child_process'
import { win32 } from 'node:path'

const squirrelEvents = new Set([
  '--squirrel-install',
  '--squirrel-updated',
  '--squirrel-uninstall',
  '--squirrel-obsolete',
])
const squirrelEvent = process.argv.slice(1).find(argument => squirrelEvents.has(argument))

if (squirrelEvent !== undefined) {
  if (squirrelEvent !== '--squirrel-obsolete') {
    const updateExecutable = win32.resolve(win32.dirname(process.execPath), '..', 'Update.exe')
    const shortcutOperation = squirrelEvent === '--squirrel-uninstall'
      ? '--removeShortcut'
      : '--createShortcut'
    const result = spawnSync(
      updateExecutable,
      [`${shortcutOperation}=${win32.basename(process.execPath)}`],
      { timeout: 8_000, windowsHide: true },
    )
    if (result.error !== undefined) throw result.error
    if (result.status !== 0) {
      throw new Error(`Squirrel shortcut operation exited with ${String(result.status)}`)
    }
  }
  process.exit(0)
}

const { startDesktopApplication } = await import('./lib/main.js')
if (process.argv.includes('--dsh-desktop-module-smoke')) process.exit(0)
startDesktopApplication()
