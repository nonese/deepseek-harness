/** Loopback-only Web command provider for the Windows desktop profile. */

import type { Context } from '@deepseek-ai/cordis'
import { applyWebStartup } from '@deepseek-ai/dsh-web-app/startup'

/** Stable Cordis plugin name. */
export const name = 'desktop-web-startup'

/** Desktop binds loopback and uses the process-token authenticator, so no server authentication service is required. */
export const inject = ['cmdlineArgs']

/**
 * Parse the Web flag family for the desktop profile without waiting for a multi-user server identity provider.
 * @param ctx - desktop plugin context carrying command-line arguments.
 */
export function apply(ctx: Context): void {
  applyWebStartup(ctx, 'desktop')
}
