import { Context } from '@deepseek-ai/cordis'
import { createScope, type ScopeKey } from '@deepseek-ai/dsh-scope'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as ProductDesignSkills from '@deepseek-ai/dsh-skill-product-design'
import { describe, expect, it } from 'vitest'

const SKILL_NAMES = [
  'product-design',
  'product-design-audit',
  'product-design-context',
  'product-design-ideate',
  'product-design-image-to-code',
  'product-design-onboarding',
  'product-design-qa',
  'product-design-research',
  'product-design-share',
  'product-design-url-to-code',
]

async function harness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SkillRegistry)
  return ctx
}

describe('the Product Design skill pack', () => {
  it('registers the complete user- and model-invocable workflow catalog', async () => {
    const ctx = await harness()
    await ctx.plugin(ProductDesignSkills)

    const catalog = await ctx.skills.list()
    expect(catalog.map(skill => skill.name)).toEqual(SKILL_NAMES)
    expect(catalog.every(skill => skill.source === 'bundled' && skill.provider === 'product-design')).toBe(true)
    expect(catalog.every(skill => skill.invocation.modelInvocable && skill.invocation.userInvocable)).toBe(true)

    const router = await ctx.skills.get('product-design')
    expect(router?.content).toContain('product-design/user-context.md')
    expect(router?.content).toContain('Treat tools as capabilities, not assumptions')
    expect(router?.content).toContain('collect_generated_image')
    const ideate = await ctx.skills.get('product-design-ideate')
    expect(ideate?.content).toContain('Dreamina 4.0 2K PNG')
    expect(ideate?.content).toContain('do not submit another image')
    const qa = await ctx.skills.get('product-design-qa')
    expect(qa?.content).toContain('A screenshot by itself is not a comparison')
  })

  it('keeps the workflow inside the preset scope and disposes it with that scope', async () => {
    const ctx = await harness()
    const designKey: ScopeKey = { agent: 'designer' }
    const otherKey: ScopeKey = { agent: 'standard' }
    const scope = createScope(ctx, designKey)
    const fiber = await scope.ctx.plugin(ProductDesignSkills)

    expect((await ctx.skills.list({ scope: designKey })).map(skill => skill.name)).toEqual(SKILL_NAMES)
    expect(await ctx.skills.list({ scope: otherKey })).toEqual([])
    expect(await ctx.skills.list()).toEqual([])

    await fiber.dispose()
    expect(await ctx.skills.list({ scope: designKey })).toEqual([])
  })
})
