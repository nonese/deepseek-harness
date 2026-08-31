/** Managed Dreamina CLI JSON transport and downloaded-image validation. */

import { chmod, lstat, mkdtemp, readFile, readdir, realpath, rmdir, stat, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, posix, relative, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'

const STDOUT_MAX_BYTES = 256 * 1024
const STDERR_MAX_BYTES = 64 * 1024
const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)

interface JsonObject {
  [key: string]: unknown
}

/** Parsed provider task facts used by the Dreamina runtime. */
export interface DreaminaTask {
  taskId: string
  status: 'pending' | 'completed'
  creditCount?: number
  image?: {
    path: string
    width: number
    height: number
  }
}

function object(value: unknown, label: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`dreamina CLI returned invalid ${label}`)
  }
  return value as JsonObject
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`dreamina CLI returned invalid ${label}`)
  return value
}

function natural(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`dreamina CLI returned invalid ${label}`)
  }
  return value
}

function optionalNatural(value: unknown, label: string): number | undefined {
  return value === undefined || value === null ? undefined : natural(value, label)
}

function statusOf(value: unknown): 'pending' | 'completed' {
  const status = string(value, 'gen_status').toLocaleLowerCase('en-US')
  if (status === 'success' || status === 'completed') return 'completed'
  if (['pending', 'processing', 'in_progress', 'running', 'submitted'].includes(status)) return 'pending'
  throw new Error(`dreamina task ended with status ${JSON.stringify(status)}`)
}

function completeStdout(text: string, lossy: boolean): string {
  if (lossy) throw new Error(`dreamina CLI stdout exceeded the ${String(STDOUT_MAX_BYTES)} byte protocol limit`)
  return text
}

/**
 * Run one Dreamina argv array and parse its bounded JSON object.
 *
 * @param ctx - Cordis context owning the managed subprocess service.
 * @param executable - Dreamina executable path or PATH-resolved command name.
 * @param args - Complete argument vector excluding the executable.
 * @param cwd - Trusted working directory for the child process.
 * @param graceMs - Grace period used while terminating the child process tree.
 * @param signal - Optional caller cancellation signal.
 * @returns The parsed top-level Dreamina JSON object.
 */
export async function runDreamina(
  ctx: Context,
  executable: string,
  args: readonly string[],
  cwd: string,
  graceMs: number,
  signal?: AbortSignal,
): Promise<JsonObject> {
  signal?.throwIfAborted()
  const handle = ctx.subprocess.spawn({
    argv: [executable, ...args],
    cwd,
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: STDOUT_MAX_BYTES },
      stderr: { maxBytes: STDERR_MAX_BYTES },
    },
    graceMs,
    signal,
  } satisfies SubprocessSpawnSpec)
  let outcome: SubprocessOutcome
  try {
    outcome = await handle.done
  } catch (error: unknown) {
    throw new Error('dreamina CLI failed to start', { cause: error })
  }
  const stdout = handle.collected.stdout?.readFrom(0)
  const stderr = handle.collected.stderr?.readFrom(0)
  if (stdout === undefined || stderr === undefined) throw new Error('dreamina CLI produced no collected output streams')
  signal?.throwIfAborted()
  if (outcome.signal !== null || outcome.exitCode === null) {
    throw new Error(`dreamina CLI was terminated by ${outcome.signal ?? 'an unknown signal'}`)
  }
  if (outcome.exitCode !== 0) {
    const detail = stderr.text.trim()
    throw new Error(`dreamina CLI exited with code ${String(outcome.exitCode)}${detail === '' ? '' : `: ${detail}`}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(completeStdout(stdout.text, stdout.lossy)) as unknown
  } catch (error: unknown) {
    throw new Error('dreamina CLI returned invalid JSON', { cause: error })
  }
  return object(parsed, 'JSON response')
}

/**
 * Parse one submit/query result without trusting provider paths.
 *
 * @param value - Parsed Dreamina response object.
 * @param requireImage - Whether a completed response must contain image metadata.
 * @returns A validated pending or completed task description.
 */
export function parseTask(value: JsonObject, requireImage: boolean): DreaminaTask {
  const taskId = string(value.submit_id, 'submit_id')
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(taskId)) throw new Error('dreamina CLI returned an unsafe submit_id')
  const status = statusOf(value.gen_status)
  const creditCount = optionalNatural(value.credit_count, 'credit_count')
  if (status === 'pending') return { status, taskId, ...(creditCount === undefined ? {} : { creditCount }) }
  if (!requireImage) return { status, taskId, ...(creditCount === undefined ? {} : { creditCount }) }

  const result = object(value.result_json, 'result_json')
  if (!Array.isArray(result.images) || result.images.length === 0) {
    throw new Error('dreamina CLI returned a completed task without images')
  }
  const image = object(result.images[0], 'result_json.images[0]')
  return {
    status,
    taskId,
    ...(creditCount === undefined ? {} : { creditCount }),
    image: {
      path: string(image.path, 'result_json.images[0].path'),
      width: natural(image.width, 'result_json.images[0].width'),
      height: natural(image.height, 'result_json.images[0].height'),
    },
  }
}

/**
 * Create one private flat download directory.
 *
 * @param parent - Existing parent directory for the private download directory.
 * @returns The absolute path of the owner-only temporary directory.
 */
export async function downloadDirectory(parent = tmpdir()): Promise<string> {
  const root = await realpath(parent)
  const path = await mkdtemp(join(root, 'dsh-dreamina-'))
  await chmod(path, 0o700)
  return path
}

/**
 * Translate one container-reported download path into its bind-mounted host directory.
 *
 * @param containerDirectory - private directory passed to Dreamina inside the container.
 * @param hostDirectory - corresponding private host directory visible to DSH.
 * @param providerPath - image path reported by Dreamina inside the container.
 * @returns the corresponding host path below `hostDirectory`.
 */
export function containerDownloadPath(
  containerDirectory: string,
  hostDirectory: string,
  providerPath: string,
): string {
  const suffix = posix.relative(containerDirectory, providerPath)
  if (suffix === '' || suffix === '..' || suffix.startsWith('../') || posix.isAbsolute(suffix)) {
    throw new Error('dreamina CLI downloaded image left its private container directory')
  }
  return resolve(hostDirectory, ...suffix.split('/'))
}

function contained(root: string, target: string): boolean {
  const suffix = relative(root, target)
  return suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix)
}

/**
 * Read and verify the one provider-downloaded PNG without following a link-shaped path.
 *
 * @param directory - Private download directory created for this provider call.
 * @param providerPath - Provider-reported path to the downloaded image.
 * @param maxOutputBytes - Maximum accepted PNG size in bytes.
 * @param signal - Optional caller cancellation signal.
 * @returns The validated PNG bytes.
 */
export async function readDownloadedPng(
  directory: string,
  providerPath: string,
  maxOutputBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  signal?.throwIfAborted()
  const root = await realpath(directory)
  const info = await lstat(providerPath)
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('dreamina CLI downloaded image is not a regular file')
  const path = await realpath(providerPath)
  if (!contained(root, path)) throw new Error('dreamina CLI downloaded image left its private directory')
  const metadata = await stat(path)
  if (metadata.size <= 0 || metadata.size > maxOutputBytes) {
    throw new Error(`dreamina image exceeds the configured ${String(maxOutputBytes)} byte limit`)
  }
  const data = await readFile(path, { signal })
  if (data.length < PNG_SIGNATURE.length || PNG_SIGNATURE.some((byte, index) => data[index] !== byte)) {
    throw new Error('dreamina CLI returned an image that is not a PNG')
  }
  return data
}

/**
 * Remove the private flat download directory without recursively following link-shaped entries.
 *
 * @param directory - Private download directory to remove.
 */
export async function removeDownloadDirectory(directory: string): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
    /* v8 ignore else -- a non-ENOENT readdir rejection requires an external host-filesystem fault. */
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
    /* v8 ignore next -- rethrow preserves the external host-filesystem fault. */
    throw error
  })
  for (const entry of entries) {
    const path = join(directory, entry.name)
    const info = await lstat(path)
    if (!info.isFile() && !info.isSymbolicLink()) {
      throw new Error('dreamina download cleanup found an unexpected directory entry')
    }
    await unlink(path)
  }
  await rmdir(directory).catch((error: unknown) => {
    /* v8 ignore next -- a non-ENOENT rmdir rejection requires an external host-filesystem fault after flat cleanup. */
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
  })
}
