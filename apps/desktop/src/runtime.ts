/** Pure desktop activation and local-configuration helpers. */

import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseDocument } from 'yaml'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import {
  decryptDesktopOrganizationConfig,
  desktopJwkThumbprint,
  verifyDesktopActivation,
  verifyDesktopConfigurationReceipt,
  verifyDesktopLease,
  type DesktopDeviceKeyMaterial,
  type DesktopOrganizationConfig,
  type DesktopPublicJwk,
} from '@deepseek-ai/dsh-desktop-auth'
import {
  WINDOWS_CREDENTIALS_FILENAME,
  replaceWindowsCredentialRefs,
  type DesktopDataProtector,
} from '@deepseek-ai/dsh-credentials-windows'

const ORGANIZATION_CREDENTIAL_PREFIX = 'DSH_DESKTOP_ORG_'
const ORGANIZATION_PROVIDER_PREFIX = 'desktop-org-'

/** Public deployment values pinned into one desktop build. */
export interface DesktopBuildConfig {
  serverOrigin: string
  serverSigningPublicJwk: DesktopPublicJwk
}

/** Server response carrying a signed lease and encrypted organization settings. */
export interface DesktopActivationPackage {
  lease: string
  leaseExpiresAt: string
  encryptedConfiguration: string
  configurationReceipt: string
  configurationRevision: string
}

/** Durable activation state protected by Electron safeStorage. */
export interface DesktopState {
  keys: DesktopDeviceKeyMaterial
  lease: string
  leaseExpiresAt: string
  deviceId: string
  organizationConfiguration: DesktopOrganizationConfig
}

/** Parse and constrain public desktop build configuration. */
export function parseDesktopBuildConfig(text: string): DesktopBuildConfig {
  const parsed = JSON.parse(text) as unknown
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('desktop: desktop.config.json must be an object')
  }
  const fields = parsed as Record<string, unknown>
  if (typeof fields['serverOrigin'] !== 'string'
    || typeof fields['serverSigningPublicJwk'] !== 'object' || fields['serverSigningPublicJwk'] === null) {
    throw new Error('desktop: desktop.config.json has no server origin or signing key')
  }
  const origin = new URL(fields['serverOrigin'])
  if ((origin.protocol !== 'http:' && origin.protocol !== 'https:') || origin.pathname !== '/'
    || origin.username.length > 0 || origin.password.length > 0 || origin.search.length > 0 || origin.hash.length > 0) {
    throw new Error('desktop: server origin must be a bare HTTP or HTTPS origin')
  }
  const jwk = fields['serverSigningPublicJwk'] as Record<string, unknown>
  if (jwk['kty'] !== 'OKP' || jwk['crv'] !== 'Ed25519' || typeof jwk['x'] !== 'string' || jwk['d'] !== undefined) {
    throw new Error('desktop: pinned signing key must be an Ed25519 public JWK')
  }
  return { serverOrigin: origin.origin, serverSigningPublicJwk: jwk }
}

/** Extract the process-authenticated loopback URL from one DSH stdout line. */
export function parseDshWebUrl(line: string): string | undefined {
  const match = /^dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_-]+)(?:\s|$)/u.exec(line.trim())
  return match?.[1]
}

/** Verify that a signed activation envelope binds both generated device keys. */
export async function verifyActivationForKeys(
  token: string,
  keys: DesktopDeviceKeyMaterial,
  config: DesktopBuildConfig,
) {
  const claims = await verifyDesktopActivation(token, config.serverSigningPublicJwk, config.serverOrigin)
  if (claims.signatureKeyThumbprint !== await desktopJwkThumbprint(keys.signature.publicJwk)
    || claims.encryptionKeyThumbprint !== await desktopJwkThumbprint(keys.encryption.publicJwk)) {
    throw new Error('desktop: activation response is bound to different device keys')
  }
  const authorization = new URL(claims.authorizationUrl)
  if (authorization.protocol !== 'https:' && authorization.protocol !== 'http:') {
    throw new Error('desktop: activation authorization URL is not HTTP or HTTPS')
  }
  return claims
}

/** Verify, decrypt, and bind one server response before persisting it. */
export async function acceptDesktopPackage(
  response: DesktopActivationPackage,
  keys: DesktopDeviceKeyMaterial,
  config: DesktopBuildConfig,
): Promise<DesktopState> {
  const lease = await verifyDesktopLease(response.lease, config.serverSigningPublicJwk, config.serverOrigin)
  const receipt = await verifyDesktopConfigurationReceipt(
    response.configurationReceipt,
    config.serverSigningPublicJwk,
    config.serverOrigin,
  )
  const encryptedDigest = createHash('sha256').update(response.encryptedConfiguration).digest('base64url')
  if (receipt.deviceId !== lease.deviceId || receipt.encryptedConfigDigest !== encryptedDigest
    || receipt.configurationRevision !== response.configurationRevision
  ) {
    throw new Error('desktop: signed lease and encrypted model configuration do not match')
  }
  const organizationConfiguration = await decryptDesktopOrganizationConfig(
    response.encryptedConfiguration,
    keys.encryption.privateJwk,
  )
  if (organizationConfiguration.revision !== response.configurationRevision) {
    throw new Error('desktop: decrypted model configuration has a different revision')
  }
  return {
    keys,
    lease: response.lease,
    leaseExpiresAt: response.leaseExpiresAt,
    deviceId: lease.deviceId,
    organizationConfiguration,
  }
}

/** Stable environment-style credential ref used only for one organization site. */
export function organizationCredentialRef(siteId: string): string {
  return `${ORGANIZATION_CREDENTIAL_PREFIX}${createHash('sha256').update(siteId).digest('hex').slice(0, 16).toUpperCase()}_API_KEY`
}

function organizationProviderId(siteId: string): string {
  return `${ORGANIZATION_PROVIDER_PREFIX}${createHash('sha256').update(siteId).digest('hex').slice(0, 12)}`
}

/**
 * Install an authenticated organization configuration without replacing
 * personal model profiles. Stale organization refs and profiles are removed.
 */
export async function installOrganizationConfiguration(
  dshHome: string,
  next: DesktopOrganizationConfig,
  protector?: DesktopDataProtector,
): Promise<void> {
  const settingsPath = join(dshHome, 'settings.yaml')
  let text = ''
  try {
    text = await readFile(settingsPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const document = parseDocument(text)
  if (document.errors.length > 0) throw new Error('desktop: settings.yaml is invalid')
  const settings = document.toJS() as unknown
  if (typeof settings === 'object' && settings !== null && !Array.isArray(settings)) {
    const piAi = Reflect.get(settings, 'llm-pi-ai') as unknown
    if (typeof piAi === 'object' && piAi !== null && !Array.isArray(piAi)) {
      const providers = Reflect.get(piAi, 'providers') as unknown
      if (typeof providers === 'object' && providers !== null && !Array.isArray(providers)) {
        for (const providerId of Object.keys(providers)) {
          if (providerId.startsWith(ORGANIZATION_PROVIDER_PREFIX)) {
            document.deleteIn(['llm-pi-ai', 'providers', providerId])
          }
        }
      }
    }
  }
  for (const site of next.sites) {
    document.setIn(['llm-pi-ai', 'providers', organizationProviderId(site.id)], {
      api: 'openai-completions',
      apiKeyEnv: organizationCredentialRef(site.id),
      baseURL: site.baseURL,
      displayName: `单位 · ${site.name}`,
      models: site.models.map(model => ({ id: model.id, name: model.name })),
    })
  }
  const credentials = Object.fromEntries(next.sites.map(site => [organizationCredentialRef(site.id), site.apiKey]))
  await replaceWindowsCredentialRefs(
    join(dshHome, WINDOWS_CREDENTIALS_FILENAME),
    ORGANIZATION_CREDENTIAL_PREFIX,
    credentials,
    protector,
  )
  await mkdir(dshHome, { recursive: true })
  await writeFileAtomic(settingsPath, String(document), { mode: 0o600, dirMode: 0o700 })
}
