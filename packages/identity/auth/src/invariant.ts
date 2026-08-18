/** Package-owned invariant companion for `@deepseek-ai/dsh-auth`. */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-auth'

/** Cordis companion plugin name. */
export const name = 'auth-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Provider-specific persistence invariants are checked by provider tests. */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
