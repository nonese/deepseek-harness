/**
 * Windows CurrentUser DPAPI credential storage. The provider keeps references
 * and plugin-owned records in one versioned JSON document, encrypts the whole
 * document before every atomic replace, and never writes a plaintext staging
 * file. The desktop launcher may update organization-owned references while
 * the local DSH process is stopped through the exported document helper.
 * @module @deepseek-ai/dsh-credentials-windows
 */

import { spawn } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import {
  CredentialProvider,
  credentialRef,
  parseCredentialKey,
  type CredentialInfo,
  type CredentialKey,
  type CredentialRecord,
  type CredentialRecordEntry,
  type CredentialRecordInfo,
  type CredentialRef,
  type ResolvedCredential,
} from '@deepseek-ai/dsh-credentials'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

/** Encrypted desktop credential filename under the DSH home. */
export const WINDOWS_CREDENTIALS_FILENAME = 'credentials.dpapi'

/** Persisted document version. */
export const WINDOWS_CREDENTIALS_VERSION = 1

const DOCUMENT_LOCK_WAIT_MS = 30_000
const DPAPI_ENTROPY = 'DeepSeek Harness desktop credentials v1'

/** Encryption seam used by the provider and deterministic boundary tests. */
export interface DesktopDataProtector {
  /** Encrypt one UTF-8 plaintext for the current Windows user. */
  protect(plaintext: string): Promise<string>
  /** Decrypt one provider-produced value for the current Windows user. */
  unprotect(ciphertext: string): Promise<string>
}

/** Plugin config for the encrypted document. */
export interface Config {
  /** Encrypted document path; defaults under the resolved DSH home. */
  path?: string
  /** Harness home used when `path` is omitted. */
  dshHome?: string
}

interface WindowsCredentialsDocument {
  version: typeof WINDOWS_CREDENTIALS_VERSION
  refs: Record<string, string>
  records: Record<string, CredentialRecord>
}

function emptyDocument(): WindowsCredentialsDocument {
  return { version: WINDOWS_CREDENTIALS_VERSION, refs: {}, records: {} }
}

function isAbsent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

function assertJsonValue(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('credentials-windows: record payload contains a non-finite number')
    return
  }
  if (typeof value !== 'object') throw new TypeError('credentials-windows: record payload is not JSON')
  if (seen.has(value)) throw new TypeError('credentials-windows: record payload is cyclic')
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) assertJsonValue(item, seen)
  } else {
    for (const item of Object.values(value)) assertJsonValue(item, seen)
  }
  seen.delete(value)
}

function assertRecord(key: string, value: unknown): asserts value is CredentialRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`credentials-windows: record "${key}" must be an object`)
  }
  const fields = value as Record<string, unknown>
  if (fields['kind'] === 'grant') {
    if (!Object.hasOwn(fields, 'payload') || Object.keys(fields).some(field => field !== 'kind' && field !== 'payload')) {
      throw new TypeError(`credentials-windows: grant record "${key}" has invalid fields`)
    }
    assertJsonValue(fields['payload'])
    return
  }
  if (fields['kind'] !== 'api-key'
    || Object.keys(fields).some(field => field !== 'kind' && field !== 'key' && field !== 'env')) {
    throw new TypeError(`credentials-windows: record "${key}" has an invalid kind or field`)
  }
  if (fields['key'] !== undefined && (typeof fields['key'] !== 'string' || fields['key'].length === 0)) {
    throw new TypeError(`credentials-windows: api-key record "${key}" has an empty key`)
  }
  if (fields['env'] !== undefined) {
    if (typeof fields['env'] !== 'object' || fields['env'] === null || Array.isArray(fields['env'])) {
      throw new TypeError(`credentials-windows: api-key record "${key}" has invalid env values`)
    }
    for (const [name, envValue] of Object.entries(fields['env'])) {
      credentialRef(name)
      if (typeof envValue !== 'string' || envValue.length === 0) {
        throw new TypeError(`credentials-windows: api-key record "${key}" has an empty env value`)
      }
    }
  }
}

/**
 * Parse and validate the decrypted durable document.
 * @param plaintext - decrypted JSON text.
 * @param filename - storage path used only in diagnostics.
 * @returns admitted document.
 */
export function parseWindowsCredentialsDocument(
  plaintext: string,
  filename: string,
): WindowsCredentialsDocument {
  let parsed: unknown
  try {
    parsed = JSON.parse(plaintext)
  } catch {
    throw new Error(`credentials-windows: decrypted document at ${filename} is not valid JSON`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TypeError(`credentials-windows: decrypted document at ${filename} must be an object`)
  }
  const fields = parsed as Record<string, unknown>
  if (fields['version'] !== WINDOWS_CREDENTIALS_VERSION
    || typeof fields['refs'] !== 'object' || fields['refs'] === null || Array.isArray(fields['refs'])
    || typeof fields['records'] !== 'object' || fields['records'] === null || Array.isArray(fields['records'])
    || Object.keys(fields).some(field => field !== 'version' && field !== 'refs' && field !== 'records')) {
    throw new Error(`credentials-windows: decrypted document at ${filename} has an unsupported layout`)
  }
  const refs = fields['refs'] as Record<string, unknown>
  for (const [name, value] of Object.entries(refs)) {
    credentialRef(name)
    if (typeof value !== 'string' || value.length === 0) {
      throw new TypeError(`credentials-windows: reference "${name}" must have a non-empty string value`)
    }
  }
  const records = fields['records'] as Record<string, unknown>
  for (const [key, value] of Object.entries(records)) {
    parseCredentialKey(key)
    assertRecord(key, value)
  }
  return parsed as WindowsCredentialsDocument
}

function encodedPowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

async function runPowerShell(script: string, input: string): Promise<string> {
  if (process.platform !== 'win32') {
    throw new Error('credentials-windows: Windows DPAPI is available only on Windows')
  }
  return new Promise((resolveOutput, reject) => {
    const child = spawn('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedPowerShell(script),
    ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.once('error', reject)
    child.once('close', (code) => {
      if (code !== 0) {
        reject(new Error(`credentials-windows: DPAPI helper failed with exit code ${String(code)}: ${Buffer.concat(stderr).toString('utf8').trim()}`))
        return
      }
      resolveOutput(Buffer.concat(stdout).toString('utf8').trim())
    })
    child.stdin.end(input, 'utf8')
  })
}

/** CurrentUser DPAPI implementation backed by Windows PowerShell. */
export const windowsDataProtector: DesktopDataProtector = {
  protect: plaintext => runPowerShell(
    '$inputText=[Console]::In.ReadToEnd();Add-Type -AssemblyName System.Security;'
      + `$entropy=[Text.Encoding]::UTF8.GetBytes('${DPAPI_ENTROPY}');`
      + '$bytes=[Text.Encoding]::UTF8.GetBytes($inputText);'
      + '$cipher=[Security.Cryptography.ProtectedData]::Protect($bytes,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser);'
      + '[Console]::Out.Write([Convert]::ToBase64String($cipher))',
    plaintext,
  ),
  unprotect: ciphertext => runPowerShell(
    '$inputText=[Console]::In.ReadToEnd();Add-Type -AssemblyName System.Security;'
      + `$entropy=[Text.Encoding]::UTF8.GetBytes('${DPAPI_ENTROPY}');`
      + '$cipher=[Convert]::FromBase64String($inputText.Trim());'
      + '$bytes=[Security.Cryptography.ProtectedData]::Unprotect($cipher,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser);'
      + '[Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes))',
    ciphertext,
  ),
}

async function readDocument(filename: string, protector: DesktopDataProtector): Promise<WindowsCredentialsDocument> {
  let encrypted: string
  try {
    encrypted = await readFile(filename, 'utf8')
  } catch (error) {
    if (isAbsent(error)) return emptyDocument()
    throw error
  }
  return parseWindowsCredentialsDocument(await protector.unprotect(encrypted.trim()), filename)
}

async function writeDocument(
  filename: string,
  document: WindowsCredentialsDocument,
  protector: DesktopDataProtector,
): Promise<void> {
  const encrypted = await protector.protect(JSON.stringify(document))
  await mkdir(dirname(filename), { recursive: true })
  await writeFileAtomic(filename, `${encrypted}\n`, { mode: 0o600, dirMode: 0o700 })
}

/**
 * Update selected encrypted references while preserving personal references and records.
 * @param filename - encrypted document path.
 * @param changes - reference values to set, or `undefined` to remove.
 * @param protector - DPAPI implementation; injectable for tests.
 */
export async function updateWindowsCredentialRefs(
  filename: string,
  changes: Readonly<Record<string, string | undefined>>,
  protector: DesktopDataProtector = windowsDataProtector,
): Promise<void> {
  await mkdir(dirname(filename), { recursive: true })
  await withFileLock(filename, async () => {
    const document = await readDocument(filename, protector)
    for (const [name, value] of Object.entries(changes)) {
      credentialRef(name)
      if (value === undefined) Reflect.deleteProperty(document.refs, name)
      else if (value.length === 0) throw new TypeError(`credentials-windows: reference "${name}" cannot be empty`)
      else document.refs[name] = value
    }
    await writeDocument(filename, document, protector)
  }, { waitMs: DOCUMENT_LOCK_WAIT_MS })
}

/**
 * Replace every encrypted reference in one owned namespace while retaining
 * references outside that namespace and all credential records.
 * @param filename - encrypted document path.
 * @param prefix - credential-ref prefix owned by the caller.
 * @param values - complete replacement set inside the prefix.
 * @param protector - DPAPI implementation; injectable for tests.
 */
export async function replaceWindowsCredentialRefs(
  filename: string,
  prefix: string,
  values: Readonly<Record<string, string>>,
  protector: DesktopDataProtector = windowsDataProtector,
): Promise<void> {
  credentialRef(prefix)
  await mkdir(dirname(filename), { recursive: true })
  await withFileLock(filename, async () => {
    const document = await readDocument(filename, protector)
    for (const name of Object.keys(document.refs)) {
      if (name.startsWith(prefix)) Reflect.deleteProperty(document.refs, name)
    }
    for (const [name, value] of Object.entries(values)) {
      credentialRef(name)
      if (!name.startsWith(prefix)) {
        throw new TypeError(`credentials-windows: reference "${name}" is outside owned prefix "${prefix}"`)
      }
      if (value.length === 0) throw new TypeError(`credentials-windows: reference "${name}" cannot be empty`)
      document.refs[name] = value
    }
    await writeDocument(filename, document, protector)
  }, { waitMs: DOCUMENT_LOCK_WAIT_MS })
}

/** DPAPI-backed credential service for one desktop user. */
export class WindowsCredentialProvider extends CredentialProvider {
  static Config: z<Config> = z.object({ path: z.string(), dshHome: z.string() })

  private readonly filename: string
  private document = emptyDocument()
  private operations: Promise<void> = Promise.resolve()
  private closed = false

  constructor(ctx: Context, public config: Config, private readonly protector = windowsDataProtector) {
    super(ctx)
    this.filename = resolve(config.path ?? join(resolveDshHome(config.dshHome), WINDOWS_CREDENTIALS_FILENAME))
  }

  async* [Service.init](): AsyncGenerator<() => Promise<void>, void, void> {
    this.document = await readDocument(this.filename, this.protector)
    yield async () => {
      this.closed = true
      await this.operations
    }
  }

  override resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    const value = this.document.refs[ref]
    return Promise.resolve(value === undefined ? undefined : { value, source: 'windows-dpapi' })
  }

  override describe(ref: CredentialRef): Promise<CredentialInfo> {
    return Promise.resolve({
      configured: this.document.refs[ref] !== undefined,
      ...this.document.refs[ref] === undefined ? {} : { source: 'windows-dpapi' },
      writable: true,
    })
  }

  override async set(ref: CredentialRef, value: string): Promise<void> {
    if (value.length === 0) throw new TypeError(`credentials-windows: reference "${ref}" cannot be empty`)
    await this.mutateDocument((document) => {
      document.refs[ref] = value
    })
    this.notifyUpdated(ref)
  }

  override async unset(ref: CredentialRef): Promise<void> {
    const changed = await this.mutateDocument((document) => {
      if (document.refs[ref] === undefined) return false
      Reflect.deleteProperty(document.refs, ref)
      return true
    })
    if (changed) this.notifyUpdated(ref)
  }

  override readRecord(key: CredentialKey): Promise<CredentialRecord | undefined> {
    return Promise.resolve(structuredClone(this.document.records[key]))
  }

  override describeRecord(key: CredentialKey): Promise<CredentialRecordInfo> {
    const record = this.document.records[key]
    return Promise.resolve(record === undefined
      ? { configured: false, writable: true }
      : { configured: true, kind: record.kind, writable: true })
  }

  override listRecords(): Promise<readonly CredentialRecordEntry[]> {
    return Promise.resolve(Object.entries(this.document.records).map(([key, record]) => ({
      key: parseCredentialKey(key),
      kind: record.kind,
    })))
  }

  override async modifyRecord(
    key: CredentialKey,
    mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> {
    const outcome = await this.mutateDocument(async (document) => {
      const current = structuredClone(document.records[key])
      const next = await mutate(structuredClone(document.records[key]))
      if (next === undefined) {
        return { result: current, changed: false }
      }
      assertRecord(key, next)
      document.records[key] = structuredClone(next)
      return { result: structuredClone(next), changed: true }
    })
    if (outcome.changed) this.notifyRecordUpdated(key)
    return outcome.result
  }

  override async deleteRecord(key: CredentialKey): Promise<void> {
    const changed = await this.mutateDocument((document) => {
      if (document.records[key] === undefined) return false
      Reflect.deleteProperty(document.records, key)
      return true
    })
    if (changed) this.notifyRecordUpdated(key)
  }

  private mutateDocument<T>(mutate: (document: WindowsCredentialsDocument) => Promise<T> | T): Promise<T> {
    if (this.closed) return Promise.reject(new Error('credentials-windows: provider is disposed'))
    const operation = this.operations.then(async () => {
      if (this.closed) throw new Error('credentials-windows: provider is disposed')
      await mkdir(dirname(this.filename), { recursive: true })
      return withFileLock(this.filename, async () => {
        const document = await readDocument(this.filename, this.protector)
        const result = await mutate(document)
        await writeDocument(this.filename, document, this.protector)
        this.document = document
        return result
      }, { waitMs: DOCUMENT_LOCK_WAIT_MS })
    })
    this.operations = operation.then(() => undefined, () => undefined)
    return operation
  }
}

export default WindowsCredentialProvider
