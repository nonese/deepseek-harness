import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'
import {
  parseWindowsCredentialsDocument,
  updateWindowsCredentialRefs,
  type DesktopDataProtector,
} from '@deepseek-ai/dsh-credentials-windows'
import {
  encryptDesktopOrganizationConfig,
  generateDesktopDeviceKeys,
  generateDesktopServerSigningKey,
  signDesktopConfigurationReceipt,
  signDesktopLease,
} from '@deepseek-ai/dsh-desktop-auth'
import {
  acceptDesktopPackage,
  installOrganizationConfiguration,
  organizationCredentialRef,
  parseDshWebUrl,
} from '../src/runtime.ts'
import { createDesktopStartupLogger, redactDesktopDiagnostic } from '../src/diagnostics.ts'
import { windowsProcessTreeArguments } from '../src/process-tree.ts'

const protector: DesktopDataProtector = {
  protect: value => Promise.resolve(Buffer.from(`sealed:${value}`).toString('base64')),
  unprotect: value => Promise.resolve(Buffer.from(value, 'base64').toString('utf8').slice('sealed:'.length)),
}

describe('desktop runtime boundary', () => {
  it('exits the Squirrel obsolete bootstrap before Electron loads', async () => {
    const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      main?: unknown
      files?: unknown
    }
    expect(packageJson.main).toBe('bootstrap.mjs')
    expect(packageJson.files).toContain('bootstrap.mjs')

    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL('../bootstrap.mjs', import.meta.url)),
      'app.asar',
      '--squirrel-obsolete',
    ], { encoding: 'utf8', timeout: 5_000 })
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
  })

  it('targets the complete Windows runtime tree during shutdown', () => {
    expect(windowsProcessTreeArguments(42, false)).toEqual(['/PID', '42', '/T'])
    expect(windowsProcessTreeArguments(42, true)).toEqual(['/PID', '42', '/T', '/F'])
    expect(() => windowsProcessTreeArguments(0, true)).toThrow(/positive safe integer/u)
  })

  it('writes bounded startup diagnostics without bearer, token, or API key values', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-desktop-diagnostics-'))
    const logger = createDesktopStartupLogger(directory)
    const unsafe = 'GET /?token=process-secret&client_secret=oidc-secret Bearer lease-secret {"apiKey":"model-secret"}'
    logger.record('failure', { message: unsafe })

    const text = await readFile(logger.path, 'utf8')
    expect(text).toContain('failure')
    expect(text).toContain('[redacted]')
    expect(text).not.toContain('process-secret')
    expect(text).not.toContain('lease-secret')
    expect(text).not.toContain('model-secret')
    expect(text).not.toContain('oidc-secret')
    expect(redactDesktopDiagnostic(unsafe)).not.toMatch(/process-secret|oidc-secret|lease-secret|model-secret/u)
  })

  it('accepts only the authenticated loopback startup URL', () => {
    expect(parseDshWebUrl('dsh web: http://127.0.0.1:49211/?token=abc_DEF-123')).toBe(
      'http://127.0.0.1:49211/?token=abc_DEF-123',
    )
    expect(parseDshWebUrl('dsh web: http://192.168.1.8:3080/?token=abc')).toBeUndefined()
    expect(parseDshWebUrl('noise http://127.0.0.1:1/?token=x')).toBeUndefined()
  })

  it('rejects an encrypted model response whose signed digest was changed', async () => {
    const issuer = 'http://10.155.44.246:3081'
    const server = generateDesktopServerSigningKey()
    const device = generateDesktopDeviceKeys()
    const configuration = {
      version: 1 as const,
      revision: 'revision-a',
      issuedAt: new Date().toISOString(),
      sites: [{
        id: 'deepseek-official',
        kind: 'deepseek-official' as const,
        name: 'DeepSeek',
        baseURL: 'https://api.deepseek.com',
        models: [{ id: 'deepseek-v4-flash', name: 'V4 Flash' }],
        apiKey: 'secret',
      }],
    }
    const encryptedConfiguration = await encryptDesktopOrganizationConfig(configuration, device.encryption.publicJwk)
    const lease = await signDesktopLease(server.privateJwk, issuer, 'user-1', {
      deviceId: 'device-1', role: 'user', displayName: 'User', configurationRevision: configuration.revision,
    }, Date.now() + 60_000)
    const configurationReceipt = await signDesktopConfigurationReceipt(server.privateJwk, issuer, {
      deviceId: 'device-1',
      configurationRevision: configuration.revision,
      encryptedConfigDigest: createHash('sha256').update(encryptedConfiguration).digest('base64url'),
    }, Date.now() + 60_000)
    await expect(acceptDesktopPackage({
      lease,
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      encryptedConfiguration: `${encryptedConfiguration}x`,
      configurationReceipt,
      configurationRevision: configuration.revision,
    }, device, { serverOrigin: issuer, serverSigningPublicJwk: server.publicJwk })).rejects.toThrow(/do not match/)
  })

  it('reconciles organization models while preserving personal settings and credentials', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-desktop-runtime-'))
    const credentialsPath = join(dshHome, 'credentials.dpapi')
    await updateWindowsCredentialRefs(credentialsPath, {
      PERSONAL_API_KEY: 'personal-secret',
      DSH_DESKTOP_ORG_STALE_API_KEY: 'stale-secret',
    }, protector)
    await writeFile(join(dshHome, 'settings.yaml'), [
      'llm-pi-ai:',
      '  providers:',
      '    personal-provider:',
      '      api: openai-completions',
      '    desktop-org-stale:',
      '      api: openai-completions',
      '',
    ].join('\n'))

    await installOrganizationConfiguration(dshHome, {
      version: 1,
      revision: 'revision-b',
      issuedAt: new Date().toISOString(),
      sites: [{
        id: 'school-site',
        kind: 'openai-compatible',
        name: 'School',
        baseURL: 'https://models.example.test/v1',
        models: [{ id: 'MiniMax M3', name: 'MiniMax M3' }],
        apiKey: 'organization-secret',
      }],
    }, protector)

    const settings = parseDocument(await readFile(join(dshHome, 'settings.yaml'), 'utf8')).toJS() as {
      'llm-pi-ai': { providers: Record<string, unknown> }
    }
    expect(settings['llm-pi-ai'].providers['personal-provider']).toBeDefined()
    expect(settings['llm-pi-ai'].providers['desktop-org-stale']).toBeUndefined()
    const organizationEntries = Object.entries(settings['llm-pi-ai'].providers)
      .filter(([id]) => id.startsWith('desktop-org-'))
    expect(organizationEntries).toHaveLength(1)
    expect(organizationEntries[0]?.[1]).toMatchObject({
      apiKeyEnv: organizationCredentialRef('school-site'),
      models: [{ id: 'MiniMax M3', name: 'MiniMax M3' }],
    })

    const ciphertext = await readFile(credentialsPath, 'utf8')
    const credentials = parseWindowsCredentialsDocument(await protector.unprotect(ciphertext.trim()), credentialsPath)
    expect(credentials.refs).toEqual({
      PERSONAL_API_KEY: 'personal-secret',
      [organizationCredentialRef('school-site')]: 'organization-secret',
    })
  })
})
