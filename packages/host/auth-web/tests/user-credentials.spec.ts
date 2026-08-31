/** User credential record isolation over the deployment credential provider. */

import { Context } from '@deepseek-ai/cordis'
import { credentialKey, credentialRef } from '@deepseek-ai/dsh-credentials'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createUserCredentialStore } from '../src/user-credentials.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

async function harness() {
  const ctx = new Context()
  contexts.push(ctx)
  const current: { value: string | undefined } = { value: 'alice' }
  ctx.provide('auth', {
    currentPrincipal: () => current.value === undefined ? undefined : { user: { id: current.value } },
  } as never)
  await ctx.plugin(MemoryCredentials)
  const store = createUserCredentialStore(ctx)
  return { ctx, current, store }
}

describe('authenticated user credential references', () => {
  it('stores, describes, rotates, and removes one owner without exposing the value', async () => {
    const { store } = await harness()
    const ref = credentialRef('DEEPSEEK_API_KEY')
    const alice = store.forOwner('alice')
    expect(store.forOwner('alice')).toBe(alice)
    await expect(alice.describe(ref)).resolves.toEqual({ configured: false, writable: true })
    await expect(alice.set(ref, '')).rejects.toThrow('an empty value cannot be stored')
    await alice.set(ref, 'alice-secret')
    await expect(alice.describe(ref)).resolves.toEqual({ configured: true, source: 'user', writable: true })
    await expect(alice.resolve(ref)).resolves.toEqual({ value: 'alice-secret', source: 'user' })
    await alice.set(ref, 'alice-rotated')
    await expect(alice.resolve(ref)).resolves.toEqual({ value: 'alice-rotated', source: 'user' })
    await alice.unset(ref)
    await expect(alice.resolve(ref)).resolves.toBeUndefined()
    await expect(alice.describe(ref)).resolves.toEqual({ configured: false, writable: true })
  })

  it('keeps two users isolated and selects the authenticated browser scope', async () => {
    const { current, store } = await harness()
    const ref = credentialRef('DEEPSEEK_API_KEY')
    await store.forOwner('alice').set(ref, 'alice-secret')
    await store.forOwner('bob').set(ref, 'bob-secret')
    await expect(store.current()?.resolve(ref)).resolves.toEqual({ value: 'alice-secret', source: 'user' })
    current.value = 'bob'
    await expect(store.current()?.resolve(ref)).resolves.toEqual({ value: 'bob-secret', source: 'user' })
    current.value = undefined
    expect(store.current()).toBeUndefined()
  })

  it('preserves sibling references and rejects a record kind owned by another protocol', async () => {
    const { ctx, store } = await harness()
    const deepseek = credentialRef('DEEPSEEK_API_KEY')
    const openai = credentialRef('OPENAI_API_KEY')
    const alice = store.forOwner('alice')
    await alice.set(deepseek, 'deepseek-secret')
    await alice.set(openai, 'openai-secret')
    await alice.unset(deepseek)
    await expect(alice.resolve(openai)).resolves.toEqual({ value: 'openai-secret', source: 'user' })

    await ctx.credentials.modifyRecord(
      credentialKey('host-auth-web', 'user-bob'),
      async () => ({ kind: 'grant', payload: { accessToken: 'opaque' } }),
    )
    await expect(store.forOwner('bob').resolve(deepseek)).rejects.toThrow('unexpected kind')
  })

  it('publishes only committed per-user reference changes', async () => {
    const { ctx, store } = await harness()
    const ref = credentialRef('DEEPSEEK_API_KEY')
    const updated = vi.fn()
    ctx.on('user-credentials/reference-updated', updated)
    const alice = store.forOwner('alice')
    await alice.set(ref, 'alice-secret')
    await alice.set(ref, 'alice-secret')
    await alice.unset(ref)
    await alice.unset(ref)
    expect(updated.mock.calls).toEqual([
      ['alice', ref],
      ['alice', ref],
    ])
  })
})
