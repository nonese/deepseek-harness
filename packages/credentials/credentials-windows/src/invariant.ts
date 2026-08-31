/** Package-owned invariant companion for `@deepseek-ai/dsh-credentials-windows`. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-credentials-windows'

/** Cordis companion plugin name. */
export const name = 'credentials-windows-invariant'
/** Service required before this companion reserves package ownership. */
export const inject = ['invariants']

/** No runtime invariant: DPAPI persistence owns no mutable runtime relationship. */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant registry.
 * @returns the installed registration's disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
