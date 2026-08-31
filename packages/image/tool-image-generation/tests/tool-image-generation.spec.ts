import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import ImageGenerationRuntime from '@deepseek-ai/dsh-image-generation'
import type {
  ImageGenerationCollectRequest,
  ImageGenerationRequest,
  ImageGenerationResult,
} from '@deepseek-ai/dsh-image-generation'
import { LlmAdapter, LlmRuntime, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmModelInfo, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ImageGenerationTools from '@deepseek-ai/dsh-tool-image-generation'

const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64')
const roots: string[] = []
const signal = new AbortController().signal

class CatalogAdapter extends LlmAdapter {
  private readonly models: readonly LlmModelInfo[] = [
    { provider: 'test', id: 'vision', name: 'Vision', inputModalities: ['text', 'image'] },
    { provider: 'test', id: 'text', name: 'Text', inputModalities: ['text'] },
    { provider: 'test', id: 'undeclared', name: 'Undeclared' },
  ]

  override listModels(): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve(this.models)
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    const found = this.models.find(candidate => candidate.id === model)
    return Promise.resolve({
      provider,
      id: model,
      name: found?.name ?? model,
      ...(found?.inputModalities === undefined ? {} : { inputModalities: [...found.inputModalities] }),
    })
  }

  override stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    throw new Error('image generation tool tests never stream')
  }
}

class FakeImageGeneration extends ImageGenerationRuntime {
  readonly requests: Array<ImageGenerationRequest | ImageGenerationCollectRequest> = []

  private async completed(cwd: string, outputPath: string, taskId: string): Promise<ImageGenerationResult> {
    await writeFile(join(cwd, outputPath), PNG_1X1)
    return {
      status: 'completed',
      provider: 'fake',
      modelVersion: '4.0',
      resolution: '2k',
      taskId,
      path: outputPath,
      data: PNG_1X1,
      sizeBytes: PNG_1X1.byteLength,
      width: 1,
      height: 1,
      mediaType: 'image/png',
      creditCount: 2,
    }
  }

  override generate(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    this.requests.push(request)
    if (request.prompt === 'pending') {
      return Promise.resolve({
        status: 'pending', provider: 'fake', modelVersion: '4.0', resolution: '2k', taskId: 'pending-1',
      })
    }
    return this.completed(request.cwd, request.outputPath, 'generated-1')
  }

  override collect(request: ImageGenerationCollectRequest): Promise<ImageGenerationResult> {
    this.requests.push(request)
    if (request.taskId === 'pending-1') {
      return Promise.resolve({
        status: 'pending', provider: 'fake', modelVersion: '4.0', resolution: '2k', taskId: request.taskId,
      })
    }
    return this.completed(request.cwd, request.outputPath, request.taskId)
  }
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-image-tool-'))
  const home = await mkdtemp(join(tmpdir(), 'dsh-image-tool-home-'))
  roots.push(root, home)
  await mkdir(join(root, 'product-design'))
  const ctx = new Context()
  const fibers: Fiber[] = []
  fibers.push(await ctx.plugin(SystemPrompt))
  fibers.push(await ctx.plugin(ToolRuntime))
  fibers.push(await ctx.plugin(LocalAttachmentStore, { dshHome: home }))
  fibers.push(await ctx.plugin(LlmRuntime))
  ctx.llm.registerAdapter(['test'], new CatalogAdapter())
  fibers.push(await ctx.plugin(FakeImageGeneration))
  fibers.push(await ctx.plugin(ImageGenerationTools))
  return {
    ctx,
    root,
    dispose: async () => {
      for (const fiber of fibers.reverse()) await fiber.dispose()
    },
  }
}

function agent(root: string, model = 'vision') {
  return {
    options: {},
    session: {
      header: { cwd: root },
      requestHeader: () => ({ config: { provider: 'test', model } }),
    },
  } as never
}

function optionRoutedAgent(root: string) {
  return {
    options: { provider: 'test', model: 'vision' },
    session: {
      header: { cwd: root },
      requestHeader: () => ({ config: {} }),
    },
  } as never
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} is not an object`)
  }
  return value as Record<string, unknown>
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('image generation tools', () => {
  it('generates a workspace image, persists its attachment, and renders the image block', async () => {
    const { ctx, root, dispose } = await setup()
    expect(ctx.tools.schemas().map(schema => schema.name)).toEqual(['generate_image', 'collect_generated_image'])
    const result = await ctx.tools.execute({
      signal,
      agent: optionRoutedAgent(root),
      callId: ToolCallId('generate'),
      name: 'generate_image',
      arguments: {
        prompt: 'A product hero',
        aspect_ratio: '16:9',
        output_path: 'product-design/hero.png',
        overwrite: true,
      },
    })

    expect(result.isError).toBe(false)
    const value = record(result.value, 'completed value')
    expect(value.status).toBe('completed')
    expect(value.modelVersion).toBe('4.0')
    expect(value.resolution).toBe('2k')
    expect(value.path).toBe('product-design/hero.png')
    const image = record(value.image, 'completed image')
    expect(image.attachmentId).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(image.mediaType).toBe('image/png')
    const textBlock = result.content[0]
    const imageBlock = result.content[1]
    expect(textBlock?.type).toBe('text')
    if (textBlock?.type !== 'text') throw new Error('first result block is not text')
    expect(textBlock.text).toContain('4.0 2k PNG')
    expect(imageBlock?.type).toBe('image')
    if (imageBlock?.type !== 'image') throw new Error('second result block is not an image')
    expect(imageBlock.attachment.mediaType).toBe('image/png')
    expect((ctx.imageGeneration as FakeImageGeneration).requests[0]).toMatchObject({ overwrite: true })
    await dispose()
  })

  it('returns and resumes a pending task without inventing a completed image', async () => {
    const { ctx, root, dispose } = await setup()
    const pending = await ctx.tools.execute({
      signal,
      agent: agent(root),
      callId: ToolCallId('pending'),
      name: 'generate_image',
      arguments: { prompt: 'pending', aspect_ratio: '1:1', output_path: 'product-design/pending.png' },
    })
    expect(pending).toMatchObject({ isError: false, value: { status: 'pending', taskId: 'pending-1' } })
    expect(pending.content).toHaveLength(1)
    const pendingText = pending.content[0]
    expect(pendingText?.type).toBe('text')
    if (pendingText?.type !== 'text') throw new Error('pending result block is not text')
    expect(pendingText.text).toContain('collect_generated_image')

    const collected = await ctx.tools.execute({
      signal,
      agent: agent(root),
      callId: ToolCallId('collect'),
      name: 'collect_generated_image',
      arguments: { task_id: 'pending-1', output_path: 'product-design/pending.png' },
    })
    expect(collected).toMatchObject({ isError: false, value: { status: 'pending', taskId: 'pending-1' } })

    const completed = await ctx.tools.execute({
      signal,
      agent: agent(root),
      callId: ToolCallId('collect-complete'),
      name: 'collect_generated_image',
      arguments: {
        task_id: 'completed-2',
        output_path: 'product-design/completed.png',
        overwrite: true,
      },
    })
    expect(completed).toMatchObject({ isError: false, value: { status: 'completed', taskId: 'completed-2' } })
    expect((ctx.imageGeneration as FakeImageGeneration).requests.at(-1)).toMatchObject({ overwrite: true })
    await dispose()
  })

  it('refuses a text-only route and a missing workspace before provider work', async () => {
    const { ctx, root, dispose } = await setup()
    const runtime = ctx.imageGeneration as FakeImageGeneration
    const textOnly = await ctx.tools.execute({
      signal,
      agent: agent(root, 'text'),
      callId: ToolCallId('text-only'),
      name: 'generate_image',
      arguments: { prompt: 'visual', aspect_ratio: '1:1', output_path: 'product-design/text.png' },
    })
    expect(textOnly.isError).toBe(true)
    const errorBlock = textOnly.content[0]
    expect(errorBlock?.type).toBe('text')
    if (errorBlock?.type !== 'text') throw new Error('route error block is not text')
    expect(errorBlock.text).toContain('image-capable model')

    const undeclared = await ctx.tools.execute({
      signal,
      agent: agent(root, 'undeclared'),
      callId: ToolCallId('undeclared'),
      name: 'generate_image',
      arguments: { prompt: 'visual', aspect_ratio: '1:1', output_path: 'product-design/undeclared.png' },
    })
    expect(undeclared.isError).toBe(true)

    const unresolved = await ctx.tools.execute({
      signal,
      agent: {
        options: {},
        session: { header: { cwd: root }, requestHeader: () => ({ config: {} }) },
      } as never,
      callId: ToolCallId('unresolved'),
      name: 'generate_image',
      arguments: { prompt: 'visual', aspect_ratio: '1:1', output_path: 'product-design/unresolved.png' },
    })
    expect(unresolved.isError).toBe(true)

    const noWorkspace = await ctx.tools.execute({
      signal,
      agent: { options: {}, session: { header: {}, requestHeader: () => ({ config: { provider: 'test', model: 'vision' } }) } } as never,
      callId: ToolCallId('no-workspace'),
      name: 'generate_image',
      arguments: { prompt: 'visual', aspect_ratio: '1:1', output_path: 'product-design/missing.png' },
    })
    expect(noWorkspace.isError).toBe(true)
    expect(runtime.requests).toEqual([])
    await dispose()
  })

  it('exposes pure edit-family presentation for both workspace mutations', async () => {
    const { ctx, dispose } = await setup()
    expect(ctx.tools.get('generate_image')?.presentCall?.({
      prompt: 'visual', aspect_ratio: '3:2', output_path: 'product-design/visual.png',
    })).toEqual({
      card: 'generic', title: 'Generate image product-design/visual.png', kind: 'edit',
      locations: [{ path: 'product-design/visual.png' }],
    })
    expect(ctx.tools.get('collect_generated_image')?.presentCall?.({
      task_id: 'task', output_path: 'product-design/visual.png',
    })).toEqual({
      card: 'generic', title: 'Collect image product-design/visual.png', kind: 'edit',
      locations: [{ path: 'product-design/visual.png' }],
    })
    await dispose()
  })
})
