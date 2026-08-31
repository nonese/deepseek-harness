import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import DreaminaImageGenerationRuntime from '@deepseek-ai/dsh-image-generation-dreamina'
import type { Config as DreaminaConfig } from '@deepseek-ai/dsh-image-generation-dreamina'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'

const fixture = fileURLToPath(new URL('./fixtures/fake-dreamina.mjs', import.meta.url))
const roots: string[] = []

beforeAll(async () => { await chmod(fixture, 0o755) })
afterAll(async () => { await chmod(fixture, 0o644) })

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-dreamina-provider-'))
  roots.push(root)
  await mkdir(join(root, 'product-design'))
  return root
}

async function runtime(config: Partial<DreaminaConfig> = {}) {
  const ctx = new Context()
  const subprocess = await ctx.plugin(LocalSubprocessRuntime)
  const provider = await ctx.plugin(DreaminaImageGenerationRuntime, {
    cliPath: fixture,
    modelVersion: '4.0',
    resolution: '2k',
    pollSeconds: 1,
    graceMs: 100,
    ...config,
  })
  return { ctx, dispose: async () => { await provider.dispose(); await subprocess.dispose() } }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('DreaminaImageGenerationRuntime', () => {
  it('pins Dreamina 4.0 and 2K, downloads one PNG, and publishes it in the workspace', async () => {
    const root = await workspace()
    const { ctx, dispose } = await runtime()
    const result = await ctx.imageGeneration.generate({
      cwd: root,
      outputPath: 'product-design/hero.png',
      prompt: 'A calm product hero',
      aspectRatio: '16:9',
    })

    expect(result).toMatchObject({
      status: 'completed', provider: 'dreamina-cli', modelVersion: '4.0', resolution: '2k',
      taskId: 'success-task', path: 'product-design/hero.png', width: 2048, height: 2048,
      mediaType: 'image/png', creditCount: 3,
    })
    expect((await readFile(join(root, 'product-design', 'hero.png'))).subarray(0, 8))
      .toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    const invocation = await readFile(join(root, '.fake-dreamina-invocations'), 'utf8')
    expect(invocation).toContain('--model_version=4.0')
    expect(invocation).toContain('--resolution_type=2k')
    expect(invocation).toContain('--ratio=16:9')
    await dispose()
  })

  it('returns a resumable pending task and collects it without submitting a duplicate', async () => {
    const root = await workspace()
    const { ctx, dispose } = await runtime()
    const pending = await ctx.imageGeneration.generate({
      cwd: root,
      outputPath: 'product-design/pending.png',
      prompt: '[pending] visual',
      aspectRatio: '1:1',
    })
    expect(pending).toEqual({
      status: 'pending', provider: 'dreamina-cli', modelVersion: '4.0', resolution: '2k', taskId: 'pending-task',
    })
    await expect(ctx.imageGeneration.collect({
      cwd: root,
      outputPath: 'product-design/pending.png',
      taskId: 'pending-task',
    })).resolves.toEqual(pending)
    await expect(lstat(join(root, 'product-design', 'pending.png'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await readFile(join(root, '.fake-dreamina-invocations'), 'utf8')).trim().split('\n')).toHaveLength(1)
    await dispose()
  })

  it('uses a running local Docker container when the host CLI needs a newer libc', async () => {
    const root = await workspace()
    const bridge = join(root, 'bridge')
    await mkdir(bridge)
    const { ctx, dispose } = await runtime({
      cliPath: 'dreamina',
      dockerContainer: 'dreamina-test',
      dockerHostDownloadRoot: bridge,
      dockerContainerDownloadRoot: '/container-data',
      dockerPath: fixture,
    })
    await expect(ctx.imageGeneration.generate({
      cwd: root,
      outputPath: 'product-design/docker.png',
      prompt: 'docker visual',
      aspectRatio: '1:1',
    })).resolves.toMatchObject({ status: 'completed', path: 'product-design/docker.png' })
    expect(await readFile(join(root, '.fake-dreamina-invocations'), 'utf8')).toContain('text2image')
    await dispose()
  })

  it('rejects unsafe output paths and conflicts before consuming a provider invocation', async () => {
    const root = await workspace()
    const outside = await workspace()
    await symlink(outside, join(root, 'escape'))
    await writeFile(join(root, 'product-design', 'existing.png'), 'original')
    const { ctx, dispose } = await runtime()
    const base = { cwd: root, prompt: 'visual', aspectRatio: '1:1' as const }

    await expect(ctx.imageGeneration.generate({ ...base, outputPath: '../outside.png' })).rejects.toThrow(/workspace|relative/)
    await expect(ctx.imageGeneration.generate({ ...base, outputPath: 'escape/outside.png' })).rejects.toThrow(/workspace/)
    await expect(ctx.imageGeneration.generate({ ...base, outputPath: 'product-design/existing.png' })).rejects.toThrow(/already exists/)
    await expect(readFile(join(root, '.fake-dreamina-invocations'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(root, 'product-design', 'existing.png'), 'utf8')).resolves.toBe('original')
    await dispose()
  })

  it('rejects provider failures and non-PNG downloads without publishing them', async () => {
    const root = await workspace()
    const { ctx, dispose } = await runtime()
    await expect(ctx.imageGeneration.generate({
      cwd: root,
      outputPath: 'product-design/fail.png',
      prompt: '[fail] visual',
      aspectRatio: '1:1',
    })).rejects.toThrow(/simulated provider failure/)
    await expect(ctx.imageGeneration.generate({
      cwd: root,
      outputPath: 'product-design/bad.png',
      prompt: '[bad-png] visual',
      aspectRatio: '1:1',
    })).rejects.toThrow(/not a PNG/)
    await expect(ctx.imageGeneration.generate({
      cwd: root,
      outputPath: 'product-design/mismatch.png',
      prompt: '[mismatch] visual',
      aspectRatio: '1:1',
    })).rejects.toThrow(/different submit_id/)
    await expect(lstat(join(root, 'product-design', 'bad.png'))).rejects.toMatchObject({ code: 'ENOENT' })
    await dispose()
  })

  it('rejects empty and over-limit prompts before invoking Dreamina', async () => {
    const root = await workspace()
    const { ctx, dispose } = await runtime({ maxPromptChars: 3 })
    const base = { cwd: root, outputPath: 'product-design/prompt.png', aspectRatio: '1:1' as const }

    await expect(ctx.imageGeneration.generate({ ...base, prompt: '   ' })).rejects.toThrow(/non-empty/)
    await expect(ctx.imageGeneration.generate({ ...base, prompt: 'four' })).rejects.toThrow(/character limit/)
    await expect(readFile(join(root, '.fake-dreamina-invocations'))).rejects.toMatchObject({ code: 'ENOENT' })
    await dispose()
  })

  it('serializes concurrent generations that share the mounted Dreamina account', async () => {
    const root = await workspace()
    const { ctx, dispose } = await runtime()
    const generate = (name: string) => ctx.imageGeneration.generate({
      cwd: root,
      outputPath: `product-design/${name}.png`,
      prompt: `[slow] ${name}`,
      aspectRatio: '1:1',
    })
    const [first, second] = await Promise.all([generate('first'), generate('second')])
    expect([first.status, second.status]).toEqual(['completed', 'completed'])
    await expect(readFile(join(root, 'product-design', 'first.png'))).resolves.toBeInstanceOf(Buffer)
    await expect(readFile(join(root, 'product-design', 'second.png'))).resolves.toBeInstanceOf(Buffer)
    await dispose()
  })

  it('rejects invalid configuration and an unavailable executable clearly', async () => {
    const invalid = new Context()
    const invalidSubprocess = await invalid.plugin(LocalSubprocessRuntime)
    await expect(invalid.plugin(DreaminaImageGenerationRuntime, { pollSeconds: 0 })).rejects.toThrow()

    const root = await workspace()
    const missing = new Context()
    const missingSubprocess = await missing.plugin(LocalSubprocessRuntime)
    const missingProvider = await missing.plugin(DreaminaImageGenerationRuntime, { cliPath: join(dirname(fixture), 'missing-dreamina') })
    await expect(missing.imageGeneration.generate({
      cwd: root,
      outputPath: 'product-design/missing.png',
      prompt: 'visual',
      aspectRatio: '1:1',
    })).rejects.toThrow(/dreamina CLI.*unavailable/)
    await missingProvider.dispose()
    await missingSubprocess.dispose()

    for (const config of [
      { dockerContainer: 'only-one' },
      {
        dockerContainer: 'bad/name',
        dockerHostDownloadRoot: '/tmp',
        dockerContainerDownloadRoot: '/data',
      },
      {
        dockerContainer: 'valid',
        dockerHostDownloadRoot: 'relative',
        dockerContainerDownloadRoot: '/data',
      },
      {
        dockerContainer: 'valid',
        dockerHostDownloadRoot: '/tmp',
        dockerContainerDownloadRoot: 'relative',
      },
    ]) {
      const configContext = new Context()
      const configSubprocess = await configContext.plugin(LocalSubprocessRuntime)
      await expect(configContext.plugin(DreaminaImageGenerationRuntime, config)).rejects.toThrow(/Docker/)
      await configSubprocess.dispose()
    }

    const docker = new Context()
    const dockerSubprocess = await docker.plugin(LocalSubprocessRuntime)
    const missingDocker = await docker.plugin(DreaminaImageGenerationRuntime, {
      cliPath: 'dreamina',
      dockerContainer: 'dreamina-test',
      dockerHostDownloadRoot: '/tmp',
      dockerContainerDownloadRoot: '/data',
      dockerPath: join(dirname(fixture), 'missing-docker'),
    })
    await expect(docker.imageGeneration.generate({
      cwd: root,
      outputPath: 'product-design/missing-docker.png',
      prompt: 'visual',
      aspectRatio: '1:1',
    })).rejects.toThrow(/Docker executable.*unavailable/)
    await missingDocker.dispose()
    await dockerSubprocess.dispose()
    await invalidSubprocess.dispose()
  })
})
