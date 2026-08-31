/** Server runtime for desktop activation, leases, replay control, and encrypted model sync. */

import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import {
  AuthError,
  type AuthUser,
  type DesktopDevice,
  type DesktopDeviceId,
  type DesktopDevicePublicJwk,
} from '@deepseek-ai/dsh-auth'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import {
  encryptDesktopOrganizationConfig,
  generateDesktopServerSigningKey,
  publicJwkFromPrivate,
  signDesktopActivation,
  signDesktopConfigurationReceipt,
  signDesktopLease,
  verifyDesktopDeviceProof,
  verifyDesktopLease,
  type DesktopActivationInput,
  type DesktopPublicJwk,
} from '@deepseek-ai/dsh-desktop-auth'
import { desktopOrganizationConfig } from './managed-models.ts'

/** Credential reference that stores the server's Ed25519 private JWK. */
export const DESKTOP_SIGNING_PRIVATE_JWK_ENV = 'HARNESS_DESKTOP_SIGNING_PRIVATE_JWK'

/** One completed OIDC activation waiting for device-key proof. */
interface PendingDesktopCompletion {
  flowId: string
  challenge: string
  deviceId: DesktopDeviceId
  expiresAt: number
}

/** Desktop endpoints' deployment-owned options. */
export interface DesktopRuntimeOptions {
  issuer: string
  signingPrivateJwkRef?: string
  leaseTtlMs: number
  completionTtlMs: number
}

/** Signed activation and encrypted-model response. */
export interface DesktopActivationPackage {
  lease: string
  leaseExpiresAt: string
  encryptedConfiguration: string
  configurationReceipt: string
  configurationRevision: string
}

/** Encrypted model sync response for a still-valid lease. */
export interface DesktopConfigurationPackage {
  encryptedConfiguration: string
  configurationReceipt: string
  configurationRevision: string
}

function leaseDigest(lease: string): string {
  return createHash('sha256').update(lease).digest('base64url')
}

function asDesktopPublicJwk(value: DesktopDevicePublicJwk): DesktopPublicJwk {
  return value as DesktopPublicJwk
}

function parsePrivateJwk(value: string): Readonly<JsonWebKey> {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('host-auth-web: desktop signing credential is not valid JSON')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('host-auth-web: desktop signing credential must be a private JWK object')
  }
  const jwk = parsed as JsonWebKey
  if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || typeof jwk.x !== 'string'
    || typeof jwk.d !== 'string') {
    throw new Error('host-auth-web: desktop signing credential must be an Ed25519 private JWK')
  }
  return jwk
}

function deviceView(device: DesktopDevice): Omit<DesktopDevice, 'signaturePublicJwk' | 'encryptionPublicJwk'> {
  const { signaturePublicJwk: _signaturePublicJwk, encryptionPublicJwk: _encryptionPublicJwk, ...view } = device
  return view
}

/**
 * Owns server-side desktop authorization state. Pending completions and replay
 * identifiers are intentionally memory-only and bounded by short expirations.
 */
export class DesktopAuthRuntime {
  private readonly pending = new Map<string, PendingDesktopCompletion>()
  private readonly usedProofs = new Map<string, number>()
  private signingPrivateJwkPromise: Promise<Readonly<JsonWebKey>> | undefined

  constructor(private readonly ctx: Context, private readonly options: DesktopRuntimeOptions) {}

  /**
   * Return the public half of the persisted server signing key.
   * @returns the key pinned into desktop builds.
   */
  async publicSigningJwk(): Promise<DesktopPublicJwk> {
    return publicJwkFromPrivate(await this.signingPrivateJwk())
  }

  /**
   * Sign a pending OIDC authorization URL and its exact device-key bindings.
   * @param input - activation flow values.
   * @param expiresAt - flow expiration in milliseconds.
   * @returns compact signed activation envelope.
   */
  async signActivation(input: DesktopActivationInput, expiresAt: number): Promise<string> {
    return signDesktopActivation(await this.signingPrivateJwk(), this.options.issuer, input, expiresAt)
  }

  /**
   * Publish an OIDC-authenticated device for the client's final proof.
   * @param flowId - activation flow identity.
   * @param challenge - activation challenge bound by the signed start response.
   * @param deviceId - registered device identity.
   * @param expiresAt - final-proof deadline.
   */
  completeOidc(flowId: string, challenge: string, deviceId: DesktopDeviceId, expiresAt: number): void {
    this.prune()
    this.pending.set(flowId, { flowId, challenge, deviceId, expiresAt })
  }

  /**
   * Verify the pending device's proof, consume the activation, and issue its first lease.
   * @param flowId - pending activation identity.
   * @param proof - device-signed activation proof.
   * @returns signed lease and encrypted organization model configuration.
   */
  async finishActivation(flowId: string, proof: string): Promise<DesktopActivationPackage | undefined> {
    this.prune()
    const completion = this.pending.get(flowId)
    if (completion === undefined) return undefined
    const device = this.requiredDevice(completion.deviceId)
    const claims = await verifyDesktopDeviceProof(
      proof,
      asDesktopPublicJwk(device.signaturePublicJwk),
      `pending:${flowId}`,
      'activation-complete',
    )
    if (claims.flowId !== flowId || claims.challenge !== completion.challenge) {
      throw new AuthError('FORBIDDEN', '桌面设备激活证明与待处理登录不匹配')
    }
    this.consumeProof(claims.jti as string, claims.exp)
    this.pending.delete(flowId)
    return this.issue(device)
  }

  /**
   * Renew a valid device lease after proof of possession.
   * @param lease - current server-signed lease.
   * @param proof - device-signed request proof.
   * @returns replacement lease and current encrypted configuration.
   */
  async renew(lease: string, proof: string): Promise<DesktopActivationPackage> {
    const { device } = await this.verifyAuthorizedRequest(lease, proof, 'lease-renew')
    return this.issue(device)
  }

  /**
   * Synchronize organization configuration under a valid lease.
   * @param lease - current server-signed lease.
   * @param proof - device-signed request proof.
   * @returns current encrypted organization configuration.
   */
  async sync(lease: string, proof: string): Promise<DesktopConfigurationPackage> {
    const { device } = await this.verifyAuthorizedRequest(lease, proof, 'config-sync')
    await this.ctx.auth.touchDesktopDevice(device.id)
    return this.configurationPackage(device)
  }

  /**
   * List administrative device summaries without public keys.
   * @returns devices in provider creation order.
   */
  listDevices(): readonly ReturnType<typeof deviceView>[] {
    return this.ctx.auth.listDesktopDevices().map(deviceView)
  }

  /**
   * Revoke one registered device.
   * @param deviceId - stable device identity.
   * @returns revoked administrative summary.
   */
  async revoke(deviceId: DesktopDeviceId): Promise<ReturnType<typeof deviceView>> {
    return deviceView(await this.ctx.auth.revokeDesktopDevice(deviceId))
  }

  private async verifyAuthorizedRequest(
    lease: string,
    proof: string,
    purpose: 'lease-renew' | 'config-sync',
  ): Promise<{ device: DesktopDevice; user: AuthUser }> {
    const signingPublic = await this.publicSigningJwk()
    const leaseClaims = await verifyDesktopLease(lease, signingPublic, this.options.issuer)
    const device = this.requiredDevice(leaseClaims.deviceId as DesktopDeviceId)
    if (device.revokedAt !== undefined || String(device.userId) !== leaseClaims.sub) {
      throw new AuthError('FORBIDDEN', '桌面授权已被撤销')
    }
    const user = this.ctx.auth.getUser(device.userId)
    if (user === undefined) throw new AuthError('USER_NOT_FOUND', '用户不存在')
    if (user.status !== 'active') throw new AuthError('USER_DISABLED', '此账号已被停用')
    const proofClaims = await verifyDesktopDeviceProof(
      proof,
      asDesktopPublicJwk(device.signaturePublicJwk),
      String(device.id),
      purpose,
    )
    if (proofClaims.deviceId !== device.id || proofClaims.leaseDigest !== leaseDigest(lease)) {
      throw new AuthError('FORBIDDEN', '桌面设备请求证明与授权不匹配')
    }
    this.consumeProof(proofClaims.jti as string, proofClaims.exp)
    return { device, user }
  }

  private requiredDevice(deviceId: DesktopDeviceId): DesktopDevice {
    const device = this.ctx.auth.getDesktopDevice(deviceId)
    if (device === undefined) throw new AuthError('INVALID_INPUT', '桌面设备不存在')
    return device
  }

  private async issue(device: DesktopDevice): Promise<DesktopActivationPackage> {
    const user = this.ctx.auth.getUser(device.userId)
    if (user === undefined) throw new AuthError('USER_NOT_FOUND', '用户不存在')
    if (user.status !== 'active') throw new AuthError('USER_DISABLED', '此账号已被停用')
    if (device.revokedAt !== undefined) throw new AuthError('FORBIDDEN', '桌面授权已被撤销')
    const configuration = await desktopOrganizationConfig(this.ctx)
    const expiresAt = Date.now() + this.options.leaseTtlMs
    const leaseExpiresAt = new Date(expiresAt).toISOString()
    const lease = await signDesktopLease(
      await this.signingPrivateJwk(),
      this.options.issuer,
      String(user.id),
      {
        deviceId: String(device.id),
        role: user.role,
        displayName: user.displayName,
        configurationRevision: configuration.revision,
      },
      expiresAt,
    )
    await this.ctx.auth.touchDesktopDevice(device.id, leaseExpiresAt)
    return {
      lease,
      leaseExpiresAt,
      ...await this.configurationPackage(device, configuration),
    }
  }

  private async configurationPackage(
    device: DesktopDevice,
    resolved: Awaited<ReturnType<typeof desktopOrganizationConfig>>
      | ReturnType<typeof desktopOrganizationConfig> = desktopOrganizationConfig(this.ctx),
  ): Promise<DesktopConfigurationPackage> {
    const configuration = await resolved
    const encryptedConfiguration = await encryptDesktopOrganizationConfig(
      configuration,
      asDesktopPublicJwk(device.encryptionPublicJwk),
    )
    const configurationReceipt = await signDesktopConfigurationReceipt(
      await this.signingPrivateJwk(),
      this.options.issuer,
      {
        deviceId: String(device.id),
        configurationRevision: configuration.revision,
        encryptedConfigDigest: createHash('sha256').update(encryptedConfiguration).digest('base64url'),
      },
      Date.now() + 2 * 60 * 1000,
    )
    return {
      encryptedConfiguration,
      configurationReceipt,
      configurationRevision: configuration.revision,
    }
  }

  private consumeProof(jti: string, expirationSeconds: number | undefined): void {
    this.prune()
    if (this.usedProofs.has(jti)) throw new AuthError('FORBIDDEN', '桌面设备请求证明已被使用')
    const expiration = expirationSeconds === undefined ? Date.now() + 2 * 60 * 1000 : expirationSeconds * 1000
    this.usedProofs.set(jti, expiration)
  }

  private prune(): void {
    const now = Date.now()
    for (const [flowId, completion] of this.pending) {
      if (completion.expiresAt <= now) this.pending.delete(flowId)
    }
    for (const [jti, expiresAt] of this.usedProofs) {
      if (expiresAt <= now) this.usedProofs.delete(jti)
    }
  }

  private signingPrivateJwk(): Promise<Readonly<JsonWebKey>> {
    this.signingPrivateJwkPromise ??= this.loadOrCreateSigningPrivateJwk()
    return this.signingPrivateJwkPromise
  }

  private async loadOrCreateSigningPrivateJwk(): Promise<Readonly<JsonWebKey>> {
    const ref = credentialRef(this.options.signingPrivateJwkRef ?? DESKTOP_SIGNING_PRIVATE_JWK_ENV)
    const existing = await this.ctx.credentials.resolve(ref)
    if (existing !== undefined) {
      const privateJwk = parsePrivateJwk(existing.value)
      publicJwkFromPrivate(privateJwk)
      return privateJwk
    }
    const status = await this.ctx.credentials.describe(ref)
    if (!status.writable) throw new Error('host-auth-web: desktop signing credential is not writable')
    const generated = generateDesktopServerSigningKey()
    await this.ctx.credentials.set(ref, JSON.stringify(generated.privateJwk))
    return generated.privateJwk
  }
}
