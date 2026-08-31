import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { credentialKey, credentialRef } from '@deepseek-ai/dsh-credentials'
import { afterEach, describe, expect, it } from 'vitest'
import {
  WindowsCredentialProvider,
  parseWindowsCredentialsDocument,
  replaceWindowsCredentialRefs,
  updateWindowsCredentialRefs,
  type DesktopDataProtector,
} from '../src/index.ts'

const protector: DesktopDataProtector = {
  protect: value => Promise.resolve(Buffer.from(`sealed:${value}`).toString('base64')),
  unprotect: (value) => {
    const decoded = Buffer.from(value, 'base64').toString('utf8')
    if (!decoded.startsWith('sealed:')) throw new Error('not sealed')
    return Promise.resolve(decoded.slice('sealed:'.length))
  },
}

describe('Windows DPAPI credential document', () => {
  const cleanups: Array<() => Promise<void>> = []
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!()
  })

  it('keeps values out of the durable ciphertext and preserves personal refs during organization sync', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-windows-credentials-'))
    const filename = join(root, 'credentials.dpapi')
    const ctx = new Context()
    class TestProvider extends WindowsCredentialProvider {
      constructor(context: Context, config: { path: string }) {
        super(context, config, protector)
      }
    }
    const fiber = ctx.plugin(TestProvider, { path: filename })
    await fiber
    cleanups.push(() => fiber.dispose())
    await ctx.credentials.set(credentialRef('PERSONAL_KEY'), 'personal-secret')
    await ctx.credentials.modifyRecord(credentialKey('owner', 'grant'), () => Promise.resolve({
      kind: 'grant',
      payload: { refresh: 'record-secret' },
    }))

    await fiber.dispose()
    cleanups.pop()
    await updateWindowsCredentialRefs(filename, { ORGANIZATION_KEY: 'organization-secret' }, protector)
    await replaceWindowsCredentialRefs(filename, 'ORGANIZATION_', {
      ORGANIZATION_REPLACED_KEY: 'replacement-secret',
    }, protector)

    const ciphertext = await readFile(filename, 'utf8')
    expect(ciphertext).not.toContain('personal-secret')
    expect(ciphertext).not.toContain('organization-secret')
    expect(ciphertext).not.toContain('record-secret')
    expect(ciphertext).not.toContain('replacement-secret')
    const document = parseWindowsCredentialsDocument(await protector.unprotect(ciphertext.trim()), filename)
    expect(document.refs).toEqual({ PERSONAL_KEY: 'personal-secret', ORGANIZATION_REPLACED_KEY: 'replacement-secret' })
    expect(document.records['owner/grant']).toEqual({ kind: 'grant', payload: { refresh: 'record-secret' } })
  })

  it('rejects a decrypted document with an unaddressable credential ref', () => {
    expect(() => parseWindowsCredentialsDocument(
      JSON.stringify({ version: 1, refs: { 'bad ref': 'secret' }, records: {} }),
      'credentials.dpapi',
    )).toThrow(/credential ref/)
  })
})
