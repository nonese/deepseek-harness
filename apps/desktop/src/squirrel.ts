/** Squirrel.Windows lifecycle parsing for the packaged desktop entry point. */

import { win32 } from 'node:path'

/** Installer action that must complete before the desktop application starts. */
export interface SquirrelLifecycleAction {
  event: '--squirrel-install' | '--squirrel-updated' | '--squirrel-uninstall' | '--squirrel-obsolete'
  updateExecutable?: string
  updateArguments?: readonly string[]
}

/**
 * Resolve one Squirrel lifecycle flag into the required shortcut operation.
 *
 * @param argv - Process arguments supplied to the packaged executable.
 * @param executable - Absolute path of the packaged desktop executable.
 * @param platform - Host platform used to reject non-Windows invocations.
 * @returns The lifecycle action, or `undefined` for a normal application start.
 */
export function resolveSquirrelLifecycle(
  argv: readonly string[],
  executable: string,
  platform: NodeJS.Platform = process.platform,
): SquirrelLifecycleAction | undefined {
  if (platform !== 'win32') return undefined
  const event = argv.slice(1).find((argument): argument is SquirrelLifecycleAction['event'] => (
    argument === '--squirrel-install'
    || argument === '--squirrel-updated'
    || argument === '--squirrel-uninstall'
    || argument === '--squirrel-obsolete'
  ))
  if (event === undefined || event === '--squirrel-obsolete') return event === undefined ? undefined : { event }
  const shortcutOperation = event === '--squirrel-uninstall' ? '--removeShortcut' : '--createShortcut'
  return {
    event,
    updateExecutable: win32.resolve(win32.dirname(executable), '..', 'Update.exe'),
    updateArguments: [`${shortcutOperation}=${win32.basename(executable)}`],
  }
}
