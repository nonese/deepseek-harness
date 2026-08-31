/** Desktop activation, proof, lease, and encrypted-config protocol coverage. */

import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  decryptDesktopOrganizationConfig,
  desktopJwkThumbprint,
  encryptDesktopOrganizationConfig,
  generateDesktopDeviceKeys,
  generateDesktopServerSigningKey,
  publicJwkFromPrivate,
  signDesktopActivation,
  signDesktopConfigurationReceipt,
  signDesktopDeviceProof,
  signDesktopLease,
  verifyDesktopActivation,
  verifyDesktopConfigurationReceipt,
  verifyDesktopDeviceProof,
  verifyDesktopLease,
  type DesktopOrganizationConfig,
} from '../src/index.ts'

const ISSUER = 'http://10.155.44.246:3081'

describe('desktop auth protocol', () => {
  it('binds an activation envelope to both device keys', async () => {
    const server = generateDesktopServerSigningKey()
    const device = generateDesktopDeviceKeys()
    const claims = {
      flowId: 'flow-1',
      challenge: 'challenge-1',
      authorizationUrl: 'https://issuer.example/authorize?state=flow-1',
      signatureKeyThumbprint: await desktopJwkThumbprint(device.signature.publicJwk),
      encryptionKeyThumbprint: await desktopJwkThumbprint(device.encryption.publicJwk),
    }
    const token = await signDesktopActivation(server.privateJwk, ISSUER, claims, Date.now() + 60_000)

    await expect(verifyDesktopActivation(token, server.publicJwk, ISSUER)).resolves.toMatchObject(claims)
    await expect(verifyDesktopActivation(token, generateDesktopServerSigningKey().publicJwk, ISSUER))
      .rejects.toThrow()
  })

  it('verifies one operation-specific proof of device possession', async () => {
    const device = generateDesktopDeviceKeys()
    const proof = await signDesktopDeviceProof(device.signature.privateJwk, 'pending:flow-1', {
      purpose: 'activation-complete',
      flowId: 'flow-1',
      challenge: 'challenge-1',
    })

    await expect(verifyDesktopDeviceProof(
      proof,
      device.signature.publicJwk,
      'pending:flow-1',
      'activation-complete',
    )).resolves.toMatchObject({ flowId: 'flow-1', challenge: 'challenge-1' })
    await expect(verifyDesktopDeviceProof(
      proof,
      device.signature.publicJwk,
      'pending:flow-1',
      'config-sync',
    )).rejects.toThrow('expected config-sync')
  })

  it('issues a bounded lease and rejects another server key', async () => {
    const server = generateDesktopServerSigningKey()
    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000
    const token = await signDesktopLease(server.privateJwk, ISSUER, 'user-1', {
      deviceId: 'device-1',
      role: 'user',
      displayName: 'Desktop User',
      configurationRevision: 'revision-1',
    }, expiresAt)

    const lease = await verifyDesktopLease(token, publicJwkFromPrivate(server.privateJwk), ISSUER)
    expect(lease).toMatchObject({
      sub: 'user-1',
      deviceId: 'device-1',
      role: 'user',
      configurationRevision: 'revision-1',
    })
    await expect(verifyDesktopLease(token, generateDesktopServerSigningKey().publicJwk, ISSUER))
      .rejects.toThrow()
  })

  it('encrypts raw organization credentials only to the target device', async () => {
    const server = generateDesktopServerSigningKey()
    const device = generateDesktopDeviceKeys()
    const other = generateDesktopDeviceKeys()
    const config: DesktopOrganizationConfig = {
      version: 1,
      revision: createHash('sha256').update('config').digest('hex'),
      issuedAt: new Date().toISOString(),
      sites: [{
        id: 'deepseek',
        kind: 'deepseek-official',
        name: 'DeepSeek',
        baseURL: 'https://api.deepseek.com',
        models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' }],
        apiKey: 'secret-value',
      }],
    }
    const encrypted = await encryptDesktopOrganizationConfig(config, device.encryption.publicJwk)
    const encryptedConfigDigest = createHash('sha256').update(encrypted).digest('base64url')
    const receipt = await signDesktopConfigurationReceipt(server.privateJwk, ISSUER, {
      deviceId: 'device-1',
      configurationRevision: config.revision,
      encryptedConfigDigest,
    }, Date.now() + 60_000)

    expect(encrypted).not.toContain('secret-value')
    await expect(verifyDesktopConfigurationReceipt(receipt, server.publicJwk, ISSUER)).resolves.toMatchObject({
      deviceId: 'device-1',
      configurationRevision: config.revision,
      encryptedConfigDigest,
    })
    await expect(decryptDesktopOrganizationConfig(encrypted, device.encryption.privateJwk)).resolves.toEqual(config)
    await expect(decryptDesktopOrganizationConfig(encrypted, other.encryption.privateJwk)).rejects.toThrow()
  })
})
