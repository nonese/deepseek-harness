/**
 * Desktop device-authentication protocol primitives. The server signs every
 * trust decision and encrypts organization credentials to one registered
 * device. Callers own persistence, replay tracking, and account policy.
 * @module @deepseek-ai/dsh-desktop-auth
 */

import {
  generateKeyPairSync,
  randomUUID,
} from 'node:crypto'
import {
  CompactEncrypt,
  SignJWT,
  calculateJwkThumbprint,
  compactDecrypt,
  decodeProtectedHeader,
  importJWK,
  jwtVerify,
  type JWK,
  type JWTPayload,
} from 'jose'

/** Wire-format version of encrypted organization model configuration. */
export const DESKTOP_ORGANIZATION_CONFIG_VERSION = 1

/** Audience of signed activation envelopes. */
export const DESKTOP_ACTIVATION_AUDIENCE = 'dsh-desktop-activation'

/** Audience of device-held offline leases. */
export const DESKTOP_LEASE_AUDIENCE = 'dsh-desktop'

/** Audience of signed device requests. */
export const DESKTOP_DEVICE_PROOF_AUDIENCE = 'dsh-desktop-server'

/** JOSE type of a server-signed activation envelope. */
export const DESKTOP_ACTIVATION_TYP = 'dsh-desktop-activation+jwt'

/** JOSE type of an offline device lease. */
export const DESKTOP_LEASE_TYP = 'dsh-desktop-lease+jwt'

/** JOSE type of a signed encrypted-config receipt. */
export const DESKTOP_CONFIGURATION_RECEIPT_TYP = 'dsh-desktop-config+jwt'

/** JOSE type of a device proof. */
export const DESKTOP_DEVICE_PROOF_TYP = 'dsh-desktop-proof+jwt'

/** JOSE type of an encrypted organization-model bundle. */
export const DESKTOP_ORGANIZATION_CONFIG_TYP = 'dsh-org-model-config+jwe'

/** Public JSON Web Key accepted by the desktop protocol. */
export type DesktopPublicJwk = Readonly<JWK>

/** Extractable asymmetric key pair represented as JSON Web Keys. */
export interface DesktopJwkPair {
  publicJwk: DesktopPublicJwk
  privateJwk: Readonly<JWK>
}

/** Signature and encryption keys generated and retained by one desktop device. */
export interface DesktopDeviceKeyMaterial {
  signature: DesktopJwkPair
  encryption: DesktopJwkPair
}

/** One server-managed model exposed to an authorized desktop user. */
export interface DesktopOrganizationModel {
  id: string
  name: string
}

/** One server-managed model site, including its raw key inside the encrypted payload. */
export interface DesktopOrganizationModelSite {
  id: string
  kind: 'deepseek-official' | 'openai-compatible'
  name: string
  baseURL: string
  models: readonly DesktopOrganizationModel[]
  apiKey: string
}

/** Complete organization model configuration encrypted to one device. */
export interface DesktopOrganizationConfig {
  version: typeof DESKTOP_ORGANIZATION_CONFIG_VERSION
  revision: string
  issuedAt: string
  sites: readonly DesktopOrganizationModelSite[]
}

/** Claims signed by a device for one activation or authenticated request. */
export interface DesktopDeviceProofClaims extends JWTPayload {
  purpose: 'activation-complete' | 'lease-renew' | 'config-sync'
  deviceId?: string
  flowId?: string
  challenge?: string
  leaseDigest?: string
}

/** Claims returned before the system browser begins OIDC authorization. */
export interface DesktopActivationClaims extends JWTPayload {
  flowId: string
  challenge: string
  authorizationUrl: string
  signatureKeyThumbprint: string
  encryptionKeyThumbprint: string
}

/** Activation values supplied before standard JWT claims are added. */
export interface DesktopActivationInput {
  flowId: string
  challenge: string
  authorizationUrl: string
  signatureKeyThumbprint: string
  encryptionKeyThumbprint: string
}

/** Claims held by a desktop installation for bounded offline use. */
export interface DesktopLeaseClaims extends JWTPayload {
  deviceId: string
  role: 'admin' | 'user'
  displayName: string
  configurationRevision: string
}

/** Lease values supplied before standard JWT claims are added. */
export interface DesktopLeaseInput {
  deviceId: string
  role: 'admin' | 'user'
  displayName: string
  configurationRevision: string
}

/** Claims authenticating one encrypted organization-model response. */
export interface DesktopConfigurationReceiptClaims extends JWTPayload {
  deviceId: string
  configurationRevision: string
  encryptedConfigDigest: string
}

/** Values supplied before standard JWT claims are added to a config receipt. */
export interface DesktopConfigurationReceiptInput {
  deviceId: string
  configurationRevision: string
  encryptedConfigDigest: string
}

function privateJwkPair(type: 'ed25519' | 'x25519'): DesktopJwkPair {
  const generated = type === 'ed25519'
    ? generateKeyPairSync('ed25519')
    : generateKeyPairSync('x25519')
  const privateJwk = generated.privateKey.export({ format: 'jwk' })
  const publicJwk = generated.publicKey.export({ format: 'jwk' })
  return { privateJwk, publicJwk }
}

/**
 * Generate the two key pairs one desktop installation owns.
 * @returns Ed25519 signing keys and X25519 encryption keys.
 */
export function generateDesktopDeviceKeys(): DesktopDeviceKeyMaterial {
  return {
    signature: privateJwkPair('ed25519'),
    encryption: privateJwkPair('x25519'),
  }
}

/**
 * Generate the long-lived server signing key.
 * @returns an Ed25519 JSON Web Key pair.
 */
export function generateDesktopServerSigningKey(): DesktopJwkPair {
  return privateJwkPair('ed25519')
}

/**
 * Derive the public JSON Web Key from an Ed25519 private key.
 * @param privateJwk - persisted server private key.
 * @returns the corresponding public key.
 */
export function publicJwkFromPrivate(privateJwk: Readonly<JWK>): DesktopPublicJwk {
  const { d: _privateComponent, ...publicJwk } = privateJwk
  return publicJwk
}

/**
 * Calculate the RFC 7638 thumbprint used to bind a signed flow to one key.
 * @param publicJwk - public key to identify.
 * @returns base64url SHA-256 thumbprint.
 */
export async function desktopJwkThumbprint(publicJwk: DesktopPublicJwk): Promise<string> {
  return calculateJwkThumbprint(publicJwk, 'sha256')
}

async function signingKey(jwk: Readonly<JWK>): Promise<CryptoKey> {
  return importJWK(jwk as JWK, 'EdDSA', { extractable: false }) as Promise<CryptoKey>
}

function assertProtectedType(token: string, expected: string): void {
  const header = decodeProtectedHeader(token)
  if (header.alg !== 'EdDSA' || header.typ !== expected) {
    throw new Error(`desktop-auth: expected ${expected} signed with EdDSA`)
  }
}

function requiredString(payload: JWTPayload, field: string): string {
  const value = payload[field]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`desktop-auth: signed payload has no ${field}`)
  }
  return value
}

/**
 * Sign the browser authorization envelope returned to a desktop client.
 * @param privateJwk - server signing key.
 * @param issuer - fixed server origin.
 * @param claims - activation flow values and device-key bindings.
 * @param expiresAt - absolute expiration in milliseconds.
 * @returns compact signed JWT.
 */
export async function signDesktopActivation(
  privateJwk: Readonly<JWK>,
  issuer: string,
  claims: DesktopActivationInput,
  expiresAt: number,
): Promise<string> {
  const key = await signingKey(privateJwk)
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'EdDSA', typ: DESKTOP_ACTIVATION_TYP })
    .setIssuer(issuer)
    .setAudience(DESKTOP_ACTIVATION_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt / 1000))
    .setJti(claims.flowId)
    .sign(key)
}

/**
 * Verify a server activation envelope and return its required claims.
 * @param token - compact signed JWT.
 * @param publicJwk - pinned server public key.
 * @param issuer - expected server origin.
 * @returns verified activation claims.
 */
export async function verifyDesktopActivation(
  token: string,
  publicJwk: DesktopPublicJwk,
  issuer: string,
): Promise<DesktopActivationClaims> {
  assertProtectedType(token, DESKTOP_ACTIVATION_TYP)
  const key = await signingKey(publicJwk)
  const { payload } = await jwtVerify(token, key, {
    issuer,
    audience: DESKTOP_ACTIVATION_AUDIENCE,
  })
  return {
    ...payload,
    flowId: requiredString(payload, 'flowId'),
    challenge: requiredString(payload, 'challenge'),
    authorizationUrl: requiredString(payload, 'authorizationUrl'),
    signatureKeyThumbprint: requiredString(payload, 'signatureKeyThumbprint'),
    encryptionKeyThumbprint: requiredString(payload, 'encryptionKeyThumbprint'),
  }
}

/**
 * Sign one short-lived proof of device-key possession.
 * @param privateJwk - device signing key.
 * @param issuer - device id, or `pending:<flowId>` before registration.
 * @param claims - operation-specific claims.
 * @param now - current epoch milliseconds.
 * @returns compact signed JWT with a unique identifier.
 */
export async function signDesktopDeviceProof(
  privateJwk: Readonly<JWK>,
  issuer: string,
  claims: DesktopDeviceProofClaims,
  now = Date.now(),
): Promise<string> {
  const key = await signingKey(privateJwk)
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'EdDSA', typ: DESKTOP_DEVICE_PROOF_TYP })
    .setIssuer(issuer)
    .setAudience(DESKTOP_DEVICE_PROOF_AUDIENCE)
    .setIssuedAt(Math.floor(now / 1000))
    .setExpirationTime(Math.floor((now + 60_000) / 1000))
    .setJti(randomUUID())
    .sign(key)
}

/**
 * Verify one short-lived proof against a registered device key.
 * @param token - compact signed JWT.
 * @param publicJwk - registered device signing key.
 * @param issuer - expected device or pending-flow identifier.
 * @param purpose - exact operation this proof authorizes.
 * @returns verified claims including the unique proof id.
 */
export async function verifyDesktopDeviceProof(
  token: string,
  publicJwk: DesktopPublicJwk,
  issuer: string,
  purpose: DesktopDeviceProofClaims['purpose'],
): Promise<DesktopDeviceProofClaims> {
  assertProtectedType(token, DESKTOP_DEVICE_PROOF_TYP)
  const key = await signingKey(publicJwk)
  const { payload } = await jwtVerify(token, key, {
    issuer,
    audience: DESKTOP_DEVICE_PROOF_AUDIENCE,
    maxTokenAge: '2 minutes',
  })
  if (payload['purpose'] !== purpose) {
    throw new Error(`desktop-auth: expected ${purpose} device proof`)
  }
  if (typeof payload.jti !== 'string' || payload.jti.length === 0) {
    throw new Error('desktop-auth: device proof has no jti')
  }
  return payload as DesktopDeviceProofClaims
}

/**
 * Issue a server-signed bounded offline lease.
 * @param privateJwk - server signing key.
 * @param issuer - fixed server origin.
 * @param subject - authenticated user id.
 * @param claims - device, role, display, and organization-config revision.
 * @param expiresAt - absolute expiration in milliseconds.
 * @returns compact signed JWT.
 */
export async function signDesktopLease(
  privateJwk: Readonly<JWK>,
  issuer: string,
  subject: string,
  claims: DesktopLeaseInput,
  expiresAt: number,
): Promise<string> {
  const key = await signingKey(privateJwk)
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'EdDSA', typ: DESKTOP_LEASE_TYP })
    .setIssuer(issuer)
    .setSubject(subject)
    .setAudience(DESKTOP_LEASE_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt / 1000))
    .setJti(randomUUID())
    .sign(key)
}

/**
 * Verify a device lease against the pinned server key.
 * @param token - compact signed lease.
 * @param publicJwk - pinned server public key.
 * @param issuer - expected server origin.
 * @returns verified lease claims.
 */
export async function verifyDesktopLease(
  token: string,
  publicJwk: DesktopPublicJwk,
  issuer: string,
): Promise<DesktopLeaseClaims> {
  assertProtectedType(token, DESKTOP_LEASE_TYP)
  const key = await signingKey(publicJwk)
  const { payload } = await jwtVerify(token, key, {
    issuer,
    audience: DESKTOP_LEASE_AUDIENCE,
  })
  const role = payload['role']
  if (role !== 'admin' && role !== 'user') throw new Error('desktop-auth: lease has invalid role')
  return {
    ...payload,
    sub: requiredString(payload, 'sub'),
    deviceId: requiredString(payload, 'deviceId'),
    displayName: requiredString(payload, 'displayName'),
    configurationRevision: requiredString(payload, 'configurationRevision'),
    role,
  }
}

/**
 * Sign the digest of one encrypted configuration response.
 * @param privateJwk - server signing key.
 * @param issuer - fixed server origin.
 * @param input - target device, revision, and compact-JWE digest.
 * @param expiresAt - absolute receipt expiration in milliseconds.
 * @returns compact signed JWT.
 */
export async function signDesktopConfigurationReceipt(
  privateJwk: Readonly<JWK>,
  issuer: string,
  input: DesktopConfigurationReceiptInput,
  expiresAt: number,
): Promise<string> {
  const key = await signingKey(privateJwk)
  return new SignJWT({ ...input })
    .setProtectedHeader({ alg: 'EdDSA', typ: DESKTOP_CONFIGURATION_RECEIPT_TYP })
    .setIssuer(issuer)
    .setAudience(DESKTOP_LEASE_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt / 1000))
    .setJti(randomUUID())
    .sign(key)
}

/**
 * Verify one encrypted-config receipt against the pinned server key.
 * @param token - compact signed receipt.
 * @param publicJwk - pinned server public key.
 * @param issuer - expected server origin.
 * @returns verified digest binding.
 */
export async function verifyDesktopConfigurationReceipt(
  token: string,
  publicJwk: DesktopPublicJwk,
  issuer: string,
): Promise<DesktopConfigurationReceiptClaims> {
  assertProtectedType(token, DESKTOP_CONFIGURATION_RECEIPT_TYP)
  const key = await signingKey(publicJwk)
  const { payload } = await jwtVerify(token, key, {
    issuer,
    audience: DESKTOP_LEASE_AUDIENCE,
  })
  return {
    ...payload,
    deviceId: requiredString(payload, 'deviceId'),
    configurationRevision: requiredString(payload, 'configurationRevision'),
    encryptedConfigDigest: requiredString(payload, 'encryptedConfigDigest'),
  }
}

/**
 * Encrypt organization model configuration to one device.
 * @param config - validated configuration containing raw API keys.
 * @param devicePublicJwk - registered device X25519 public key.
 * @returns compact ECDH-ES/A256-GCM JWE.
 */
export async function encryptDesktopOrganizationConfig(
  config: DesktopOrganizationConfig,
  devicePublicJwk: DesktopPublicJwk,
): Promise<string> {
  const key = await importJWK(devicePublicJwk as JWK, 'ECDH-ES')
  return new CompactEncrypt(Buffer.from(JSON.stringify(config)))
    .setProtectedHeader({ alg: 'ECDH-ES', enc: 'A256GCM', typ: DESKTOP_ORGANIZATION_CONFIG_TYP })
    .encrypt(key)
}

/**
 * Decrypt and minimally validate an organization model configuration.
 * @param token - compact encrypted configuration.
 * @param devicePrivateJwk - device X25519 private key.
 * @returns parsed configuration.
 */
export async function decryptDesktopOrganizationConfig(
  token: string,
  devicePrivateJwk: Readonly<JWK>,
): Promise<DesktopOrganizationConfig> {
  const header = decodeProtectedHeader(token)
  if (header.alg !== 'ECDH-ES' || header.enc !== 'A256GCM' || header.typ !== DESKTOP_ORGANIZATION_CONFIG_TYP) {
    throw new Error('desktop-auth: organization config uses unexpected JOSE protection')
  }
  const key = await importJWK(devicePrivateJwk as JWK, 'ECDH-ES')
  const { plaintext } = await compactDecrypt(token, key)
  const parsed = JSON.parse(Buffer.from(plaintext).toString('utf8')) as unknown
  if (!isDesktopOrganizationConfig(parsed)) {
    throw new Error('desktop-auth: organization config has invalid fields')
  }
  return parsed
}

/**
 * Validate the durable/wire organization-model document before use.
 * @param value - parsed JSON value.
 * @returns whether the value is a supported configuration.
 */
export function isDesktopOrganizationConfig(value: unknown): value is DesktopOrganizationConfig {
  if (!isRecord(value) || value['version'] !== DESKTOP_ORGANIZATION_CONFIG_VERSION
    || typeof value['revision'] !== 'string' || value['revision'].length === 0
    || typeof value['issuedAt'] !== 'string' || !Array.isArray(value['sites'])) return false
  return value['sites'].every((site) => {
    if (!isRecord(site) || typeof site['id'] !== 'string' || site['id'].length === 0
      || (site['kind'] !== 'deepseek-official' && site['kind'] !== 'openai-compatible')
      || typeof site['name'] !== 'string' || typeof site['baseURL'] !== 'string'
      || typeof site['apiKey'] !== 'string' || site['apiKey'].length === 0
      || !Array.isArray(site['models']) || site['models'].length === 0) return false
    return site['models'].every(model => isRecord(model)
      && typeof model['id'] === 'string' && model['id'].length > 0
      && typeof model['name'] === 'string' && model['name'].length > 0)
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
