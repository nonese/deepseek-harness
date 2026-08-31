/**
 * Product-design workflow skill pack.
 *
 * The package contributes workflow instructions to the mounting agent scope.
 * It deliberately uses the host's existing filesystem, shell, Web, attachment,
 * and optional visual tools instead of pretending those capabilities exist.
 *
 * @module @deepseek-ai/dsh-skill-product-design
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-skill'
import { PRODUCT_DESIGN_SKILLS } from './skills.ts'

/** Cordis plugin name. */
export const name = 'skill-product-design'

/** Scoped skill registry contributed to by this pack. */
export const inject = ['skills']

/**
 * Register the Product Design workflow skills in the mounting scope.
 * @param ctx - Agent-preset context whose skill layer receives the pack.
 */
export function apply(ctx: Context): void {
  for (const skill of PRODUCT_DESIGN_SKILLS) ctx.skills.register(skill)
}
