import { describe, expect, it, vi } from 'vitest'
import * as DreaminaInvariant from '../../image-generation-dreamina/src/invariant.ts'
import * as ImageGenerationInvariant from '../src/invariant.ts'
import * as ImageToolInvariant from '../../tool-image-generation/src/invariant.ts'
import * as ProductDesignInvariant from '../../../skill/skill-product-design/src/invariant.ts'

describe('image and Product Design invariant companions', () => {
  it.each([
    [ImageGenerationInvariant, '@deepseek-ai/dsh-image-generation'],
    [DreaminaInvariant, '@deepseek-ai/dsh-image-generation-dreamina'],
    [ImageToolInvariant, '@deepseek-ai/dsh-tool-image-generation'],
    [ProductDesignInvariant, '@deepseek-ai/dsh-skill-product-design'],
  ] as const)('reserves package ownership for %s', async (companion, packageName) => {
    const dispose = vi.fn()
    const register = vi.fn((_packageName: string, install: () => void) => {
      install()
      return dispose
    })
    const ctx = { invariants: { register } } as never

    await expect(companion.apply(ctx)).resolves.toBe(dispose)
    expect(companion.inject).toEqual(['invariants'])
    expect(register).toHaveBeenCalledWith(packageName, expect.any(Function))
  })
})
