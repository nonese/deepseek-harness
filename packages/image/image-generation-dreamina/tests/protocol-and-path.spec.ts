import { mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle, SubprocessOutcome, SubprocessOutputRead } from '@deepseek-ai/dsh-subprocess'
import {
  parseTask,
  containerDownloadPath,
  readDownloadedPng,
  removeDownloadDirectory,
  runDreamina,
} from '../src/cli.ts'
import { imageTarget, publishImage } from '../src/path.ts'

const PNG = Buffer.from('89504e470d0a1a0a0102', 'hex')
const roots: string[] = []

async function temporary(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

function read(text: string, lossy = false): SubprocessOutputRead {
  return { text, lossy, nextOffset: Buffer.byteLength(text) }
}

function handle(
  outcome: Promise<SubprocessOutcome>,
  stdout: SubprocessOutputRead | null = read('{}'),
  stderr: SubprocessOutputRead | null = read(''),
): SubprocessHandle {
  return {
    done: outcome,
    collected: {
      ...(stdout === null ? {} : { stdout: { readFrom: () => stdout } }),
      ...(stderr === null ? {} : { stderr: { readFrom: () => stderr } }),
    },
  } as unknown as SubprocessHandle
}

function context(process: SubprocessHandle): Context {
  return { subprocess: { spawn: () => process } } as unknown as Context
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Dreamina CLI protocol', () => {
  it('accepts every supported task family and validates completed image metadata', () => {
    expect(parseTask({ submit_id: 'done', gen_status: 'completed', credit_count: null }, false))
      .toEqual({ status: 'completed', taskId: 'done' })
    for (const status of ['pending', 'processing', 'in_progress', 'running', 'submitted']) {
      expect(parseTask({ submit_id: `task-${status}`, gen_status: status }, true).status).toBe('pending')
    }
    expect(parseTask({ submit_id: 'pending-credit', gen_status: 'pending', credit_count: 2 }, false))
      .toEqual({ status: 'pending', taskId: 'pending-credit', creditCount: 2 })
    expect(parseTask({
      submit_id: 'image-1', gen_status: 'SUCCESS', credit_count: 0,
      result_json: { images: [{ path: '/tmp/image.png', width: 2048, height: 1024 }] },
    }, true)).toEqual({
      status: 'completed', taskId: 'image-1', creditCount: 0,
      image: { path: '/tmp/image.png', width: 2048, height: 1024 },
    })
  })

  it('rejects malformed task ids, status values, credits, and image metadata', () => {
    const completed = { submit_id: 'task', gen_status: 'success' }
    for (const value of [undefined, '', []]) {
      expect(() => parseTask({ ...completed, submit_id: value }, false)).toThrow(/submit_id/)
    }
    expect(() => parseTask({ ...completed, submit_id: '../unsafe' }, false)).toThrow(/unsafe submit_id/)
    expect(() => parseTask({ ...completed, gen_status: 1 }, false)).toThrow(/gen_status/)
    expect(() => parseTask({ ...completed, gen_status: 'failed' }, false)).toThrow(/ended with status/)
    for (const credit_count of ['3', 1.5, -1]) {
      expect(() => parseTask({ ...completed, credit_count }, false)).toThrow(/credit_count/)
    }
    for (const result_json of [null, [], {}, { images: [] }]) {
      expect(() => parseTask({ ...completed, result_json }, true)).toThrow(/result_json|without images/)
    }
    expect(() => parseTask({ ...completed, result_json: { images: [[]] } }, true)).toThrow(/images\[0\]/)
    for (const path of [undefined, '']) {
      expect(() => parseTask({
        ...completed, result_json: { images: [{ path, width: 1, height: 1 }] },
      }, true)).toThrow(/path/)
    }
    for (const width of ['1', 1.5, -1]) {
      expect(() => parseTask({
        ...completed, result_json: { images: [{ path: '/tmp/image.png', width, height: 1 }] },
      }, true)).toThrow(/width/)
    }
    expect(() => parseTask({
      ...completed, result_json: { images: [{ path: '/tmp/image.png', width: 1, height: -1 }] },
    }, true)).toThrow(/height/)
  })

  it('classifies managed-process and JSON transport failures', async () => {
    const root = await temporary('dsh-dreamina-protocol-')
    const run = (process: SubprocessHandle, signal?: AbortSignal) =>
      runDreamina(context(process), '/bin/fake', ['version'], root, 10, signal)
    const clean = Promise.resolve({ exitCode: 0, signal: null })

    await expect(run(handle(Promise.reject(new Error('spawn'))))).rejects.toThrow(/failed to start/)
    await expect(run(handle(clean, null))).rejects.toThrow(/no collected output streams/)
    await expect(run(handle(Promise.resolve({ exitCode: null, signal: 'SIGTERM' })))).rejects.toThrow(/SIGTERM/)
    await expect(run(handle(Promise.resolve({ exitCode: null, signal: null })))).rejects.toThrow(/unknown signal/)
    await expect(run(handle(Promise.resolve({ exitCode: 2, signal: null }), read('{}'), read('bad request\n'))))
      .rejects.toThrow(/code 2: bad request/)
    await expect(run(handle(Promise.resolve({ exitCode: 2, signal: null })))).rejects.toThrow(/code 2$/)
    await expect(run(handle(clean, read('{')))).rejects.toThrow(/invalid JSON/)
    await expect(run(handle(clean, read('{}', true)))).rejects.toThrow(/invalid JSON/)
    await expect(run(handle(clean, read('[]')))).rejects.toThrow(/invalid JSON response/)
    await expect(run(handle(clean, read('{"ok":true}')))).resolves.toEqual({ ok: true })

    const controller = new AbortController()
    controller.abort()
    await expect(run(handle(clean), controller.signal)).rejects.toThrow(/abort/i)
  })
})

describe('Dreamina downloaded media', () => {
  it('maps only descendant container paths into the corresponding host directory', () => {
    expect(containerDownloadPath('/data/download', '/host/download', '/data/download/image.png'))
      .toBe('/host/download/image.png')
    for (const path of ['/data/download', '/data/other/image.png', 'relative.png']) {
      expect(() => containerDownloadPath('/data/download', '/host/download', path))
        .toThrow(/private container directory/)
    }
  })

  it('accepts a confined PNG and rejects links, escapes, empty, oversized, and invalid files', async () => {
    const download = await temporary('dsh-dreamina-download-')
    const outside = await temporary('dsh-dreamina-outside-')
    const good = join(download, 'good.png')
    await writeFile(good, PNG)
    await expect(readDownloadedPng(download, good, PNG.byteLength)).resolves.toEqual(PNG)

    const link = join(download, 'link.png')
    await symlink(good, link)
    await expect(readDownloadedPng(download, link, 100)).rejects.toThrow(/regular file/)
    await expect(readDownloadedPng(download, download, 100)).rejects.toThrow(/regular file/)

    const escaped = join(outside, 'escaped.png')
    await writeFile(escaped, PNG)
    await expect(readDownloadedPng(download, escaped, 100)).rejects.toThrow(/left its private directory/)

    const empty = join(download, 'empty.png')
    await writeFile(empty, '')
    await expect(readDownloadedPng(download, empty, 100)).rejects.toThrow(/byte limit/)
    await expect(readDownloadedPng(download, good, PNG.byteLength - 1)).rejects.toThrow(/byte limit/)

    const short = join(download, 'short.png')
    await writeFile(short, PNG.subarray(0, 4))
    await expect(readDownloadedPng(download, short, 100)).rejects.toThrow(/not a PNG/)
    const wrong = join(download, 'wrong.png')
    await writeFile(wrong, Buffer.alloc(PNG.length))
    await expect(readDownloadedPng(download, wrong, 100)).rejects.toThrow(/not a PNG/)

    const controller = new AbortController()
    controller.abort()
    await expect(readDownloadedPng(download, good, 100, controller.signal)).rejects.toThrow(/abort/i)
  })

  it('removes only flat files and links, tolerates absence, and refuses nested directories', async () => {
    const download = await temporary('dsh-dreamina-cleanup-')
    const outside = await temporary('dsh-dreamina-cleanup-outside-')
    const outsideFile = join(outside, 'kept.txt')
    await writeFile(outsideFile, 'kept')
    await writeFile(join(download, 'file.png'), PNG)
    await symlink(outsideFile, join(download, 'link.png'))
    await removeDownloadDirectory(download)
    expect(await readFile(outsideFile, 'utf8')).toBe('kept')
    await removeDownloadDirectory(download)

    const nested = await temporary('dsh-dreamina-cleanup-nested-')
    await mkdir(join(nested, 'directory'))
    await expect(removeDownloadDirectory(nested)).rejects.toThrow(/unexpected directory entry/)
  })
})

describe('workspace image publication', () => {
  it('validates relative visible PNG targets and current target kinds', async () => {
    const root = await temporary('dsh-image-target-')
    const outside = await temporary('dsh-image-target-outside-')
    await mkdir(join(root, 'images'))
    await symlink(outside, join(root, 'escape'))

    for (const outputPath of [
      '/absolute.png', 'C:\\absolute.png', '\\\\server\\share.png', 'bad\0name.png', '',
      './dot.png', '../up.png', '.hidden.png', 'images/.hidden.png', 'images/not-jpeg.jpg',
    ]) {
      await expect(imageTarget(root, outputPath, false)).rejects.toThrow(/output_path/)
    }
    await expect(imageTarget(root, 'escape/outside.png', false)).rejects.toThrow(/leaves the current workspace/)

    await symlink(join(outside, 'missing.png'), join(root, 'images', 'linked.png'))
    await expect(imageTarget(root, 'images/linked.png', true)).rejects.toThrow(/symbolic link/)
    await mkdir(join(root, 'images', 'directory.png'))
    await expect(imageTarget(root, 'images/directory.png', true)).rejects.toThrow(/regular file/)
    await writeFile(join(root, 'images', 'existing.png'), 'old')
    await expect(imageTarget(root, 'images/existing.png', false)).rejects.toThrow(/already exists/)
    await expect(imageTarget(root, 'images/existing.png', true)).resolves.toMatchObject({
      relativePath: 'images/existing.png', root: await realpath(root),
    })
  })

  it('publishes without overwrite, detects a race, and honors cancellation', async () => {
    const root = await temporary('dsh-image-publish-')
    await mkdir(join(root, 'images'))
    const created = await imageTarget(root, 'images/created.png', false)
    await publishImage(created, PNG, false)
    await expect(readFile(created.path)).resolves.toEqual(PNG)

    const conflict = await imageTarget(root, 'images/conflict.png', false)
    await writeFile(conflict.path, 'racer')
    await expect(publishImage(conflict, PNG, false)).rejects.toThrow(/already exists/)
    await expect(readFile(conflict.path, 'utf8')).resolves.toBe('racer')

    const cancelled = await imageTarget(root, 'images/cancelled.png', false)
    const controller = new AbortController()
    controller.abort()
    await expect(publishImage(cancelled, PNG, false, controller.signal)).rejects.toThrow(/abort/i)
  })

  it('revalidates overwrite targets and the parent immediately before publication', async () => {
    const root = await temporary('dsh-image-overwrite-')
    const outside = await temporary('dsh-image-overwrite-outside-')
    await mkdir(join(root, 'images'))

    const absent = await imageTarget(root, 'images/absent.png', true)
    await publishImage(absent, PNG, true)
    await expect(readFile(absent.path)).resolves.toEqual(PNG)

    await writeFile(join(root, 'images', 'existing.png'), 'old')
    const existing = await imageTarget(root, 'images/existing.png', true)
    await publishImage(existing, PNG, true)
    await expect(readFile(existing.path)).resolves.toEqual(PNG)

    const linked = await imageTarget(root, 'images/linked.png', true)
    await symlink(join(outside, 'target.png'), linked.path)
    await expect(publishImage(linked, PNG, true)).rejects.toThrow(/symbolic link/)

    const directory = await imageTarget(root, 'images/directory.png', true)
    await mkdir(directory.path)
    await expect(publishImage(directory, PNG, true)).rejects.toThrow(/regular file/)

    const movedParent = join(root, 'moved-images')
    const escaped = await imageTarget(root, 'images/escaped.png', false)
    await rename(join(root, 'images'), movedParent)
    await symlink(outside, join(root, 'images'))
    await expect(publishImage(escaped, PNG, false)).rejects.toThrow(/parent left/)
  })
})
