import { describe, expect, it, vi } from 'vitest'
import * as AuthInvariant from '../src/invariant.ts'

describe('authentication invariant companion', () => {
  it('reserves package ownership without installing a runtime check', async () => {
    const dispose = vi.fn()
    const register = vi.fn((_packageName: string, install: () => void) => {
      install()
      return dispose
    })
    const ctx = { invariants: { register } } as never

    await expect(AuthInvariant.apply(ctx)).resolves.toBe(dispose)
    expect(AuthInvariant.name).toBe('auth-invariant')
    expect(AuthInvariant.inject).toEqual(['invariants'])
    expect(register).toHaveBeenCalledWith('@deepseek-ai/dsh-auth', expect.any(Function))
  })
})
