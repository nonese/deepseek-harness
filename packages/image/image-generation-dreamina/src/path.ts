/** Workspace-confined atomic publication for generated PNG files. */

import { randomUUID } from 'node:crypto'
import { link, lstat, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function isConflict(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST'
}

function contained(root: string, target: string): boolean {
  const suffix = relative(root, target)
  return suffix === '' || (suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix))
}

/** Resolved, validated PNG target below one workspace root. */
export interface ImageTarget {
  /** Canonical workspace-relative path for results and UI cards. */
  relativePath: string
  /** Host path used only inside the local provider. */
  path: string
  /** Canonical workspace root. */
  root: string
}

/**
 * Resolve a PNG output path below an existing workspace without following symbolic links outside it.
 * @param cwd - absolute session workspace root.
 * @param outputPath - model-authored relative output path.
 * @param overwrite - whether an existing regular target is eligible for replacement.
 * @returns the canonical target and portable relative display path.
 */
export async function imageTarget(cwd: string, outputPath: string, overwrite: boolean): Promise<ImageTarget> {
  if (outputPath.includes('\0') || isAbsolute(outputPath)
    || /^[A-Za-z]:[/\\]/.test(outputPath) || outputPath.startsWith('\\\\')) {
    throw new Error('image generation output_path must be relative to the current workspace')
  }
  const segments = outputPath.split(/[/\\]/)
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..'
    || segment.startsWith('.'))) {
    throw new Error('image generation output_path cannot be empty, hidden, or leave the current workspace')
  }
  const filename = segments.at(-1) as string
  if (!filename.toLocaleLowerCase('en-US').endsWith('.png')) {
    throw new Error('image generation output_path must end with .png')
  }

  const root = await realpath(cwd)
  const parent = await realpath(resolve(root, ...segments.slice(0, -1)))
  if (!contained(root, parent)) throw new Error('image generation output_path leaves the current workspace')
  const path = resolve(parent, filename)
  const current = await lstat(path).catch((error: unknown) => {
    /* v8 ignore next 3 -- any non-ENOENT lstat rejection requires an external host-filesystem fault. */
    if (!isMissing(error)) throw error
    return undefined
  })
  if (current?.isSymbolicLink()) throw new Error('image generation output_path cannot replace a symbolic link')
  if (current !== undefined && !current.isFile()) throw new Error('image generation output_path is not a regular file')
  if (current !== undefined && !overwrite) {
    throw new Error('image generation output_path already exists; set overwrite to replace it')
  }
  return { relativePath: segments.join('/'), path, root }
}

/**
 * Atomically publish generated PNG bytes at a previously validated target.
 * @param target - validated workspace target.
 * @param bytes - complete verified PNG bytes.
 * @param overwrite - whether an existing regular file may be replaced.
 * @param signal - aborts before publication.
 */
export async function publishImage(
  target: ImageTarget,
  bytes: Uint8Array,
  overwrite: boolean,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted()
  const temporary = resolve(dirname(target.path), `.dsh-image-${randomUUID()}`)
  try {
    await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600, signal })
    signal?.throwIfAborted()
    const parent = await realpath(dirname(target.path))
    if (!contained(target.root, parent)) throw new Error('image generation output parent left the current workspace')
    if (overwrite) {
      const current = await lstat(target.path).catch((error: unknown) => {
        /* v8 ignore next 3 -- any non-ENOENT lstat rejection requires an external host-filesystem fault. */
        if (!isMissing(error)) throw error
        return undefined
      })
      if (current?.isSymbolicLink()) throw new Error('image generation output_path cannot replace a symbolic link')
      if (current !== undefined && !current.isFile()) throw new Error('image generation output_path is not a regular file')
      await rename(temporary, target.path)
    } else {
      try {
        await link(temporary, target.path)
      } catch (error: unknown) {
        /* v8 ignore next 3 -- non-conflict hard-link failures require a host-filesystem fault after validation. */
        if (!isConflict(error)) throw error
        throw new Error('image generation output_path already exists; set overwrite to replace it')
      }
    }
  } finally {
    await unlink(temporary).catch((error: unknown) => {
      /* v8 ignore next -- cleanup can otherwise fail only through an external host-filesystem fault. */
      if (!isMissing(error)) throw error
    })
  }
}
