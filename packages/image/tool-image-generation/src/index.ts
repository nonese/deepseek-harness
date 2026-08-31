/** Model-facing workspace image generation tools. @module @deepseek-ai/dsh-tool-image-generation */

import type { Context } from '@deepseek-ai/cordis'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { ImageGenerationCompleted, ImageGenerationResult } from '@deepseek-ai/dsh-image-generation'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'

/** Cordis plugin name. */
export const name = 'tool-image-generation'
/** Required provider, durable image store, model route, and tool registry. */
export const inject = ['attachments', 'imageGeneration', 'llm', 'tools']

const COMMON_OUTPUT = {
  provider: { type: 'string', required: true },
  modelVersion: { type: 'string', required: true },
  resolution: { type: 'string', required: true },
  taskId: { type: 'string', required: true },
  creditCount: { type: 'integer' },
} as const

const IMAGE_OUTPUT = {
  type: 'object',
  additionalProperties: false,
  required: true,
  properties: {
    attachmentId: { type: 'string', required: true },
    mediaType: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], required: true },
    bytes: { type: 'integer', required: true },
    width: { type: 'integer', required: true },
    height: { type: 'integer', required: true },
  },
} as const

const OUTPUT_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        status: { type: 'string', const: 'pending', required: true },
        ...COMMON_OUTPUT,
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        status: { type: 'string', const: 'completed', required: true },
        ...COMMON_OUTPUT,
        path: { type: 'string', required: true },
        sizeBytes: { type: 'integer', required: true },
        width: { type: 'integer', required: true },
        height: { type: 'integer', required: true },
        image: IMAGE_OUTPUT,
      },
    },
  ],
} as const

const ASPECT_RATIOS = ['21:9', '16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16'] as const

type ToolValue = {
  status: 'pending'
  provider: string
  modelVersion: string
  resolution: string
  taskId: string
  creditCount?: number
} | {
  status: 'completed'
  provider: string
  modelVersion: string
  resolution: string
  taskId: string
  creditCount?: number
  path: string
  sizeBytes: number
  width: number
  height: number
  image: {
    attachmentId: string
    mediaType: ImageMediaType
    bytes: number
    width: number
    height: number
  }
}

function workspaceCwd(exec: ToolExecution): string {
  const cwd = exec.agent?.session.header.cwd
  if (cwd === undefined || cwd.length === 0) throw new Error('image generation requires a session workspace')
  return cwd
}

async function assertImageCapableRoute(ctx: Context, exec: ToolExecution): Promise<void> {
  const routed = exec.agent?.session.requestHeader()?.config
  const provider = routed?.provider ?? exec.agent?.options.provider
  const model = routed?.model ?? exec.agent?.options.model
  if (provider === undefined || model === undefined) {
    throw new Error('image generation requires a resolved model route')
  }
  const active = await ctx.llm.resolveModelInfo(provider, model, exec.signal)
  if (active.inputModalities === undefined || !active.inputModalities.includes('image')) {
    throw new Error(`image generation requires an image-capable model; current model "${model}" does not declare image input`)
  }
}

function refFromValue(image: Extract<ToolValue, { status: 'completed' }>['image']): ImageAttachmentRef {
  return {
    attachmentId: AttachmentId(image.attachmentId),
    mediaType: image.mediaType,
    bytes: image.bytes,
    width: image.width,
    height: image.height,
  }
}

function content(value: ToolValue): ContentBlock[] {
  if (value.status === 'pending') {
    return [{
      type: 'text',
      text: `Dreamina task ${value.taskId} is still processing. Call collect_generated_image with this task id and the intended output path.`,
    }]
  }
  return [
    {
      type: 'text',
      text: `Generated ${value.modelVersion} ${value.resolution} PNG at ${value.path} (${String(value.width)}x${String(value.height)} px, ${String(value.sizeBytes)} bytes; task ${value.taskId}).`,
    },
    { type: 'image', attachment: refFromValue(value.image) },
  ]
}

async function toolValue(ctx: Context, result: ImageGenerationResult): Promise<ToolValue> {
  const base = {
    provider: result.provider,
    modelVersion: result.modelVersion,
    resolution: result.resolution,
    taskId: result.taskId,
    ...(result.creditCount === undefined ? {} : { creditCount: result.creditCount }),
  }
  if (result.status === 'pending') return { status: 'pending', ...base }
  const name = result.path.split('/').at(-1) as string
  const ref = await ctx.attachments.saveImage({
    data: result.data,
    mediaType: result.mediaType,
    name,
  })
  return completedValue(result, ref, base)
}

function completedValue(
  result: ImageGenerationCompleted,
  ref: ImageAttachmentRef,
  base: Omit<Extract<ToolValue, { status: 'pending' }>, 'status'>,
): Extract<ToolValue, { status: 'completed' }> {
  return {
    status: 'completed',
    ...base,
    path: result.path,
    sizeBytes: result.sizeBytes,
    width: result.width,
    height: result.height,
    image: {
      attachmentId: ref.attachmentId,
      mediaType: ref.mediaType,
      bytes: ref.bytes,
      width: ref.width,
      height: ref.height,
    },
  }
}

/** Register Dreamina-compatible submit and collect tools against the mounted image provider. */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'generate_image',
    description: 'Generate one real PNG image in the current project through the configured image provider. The shipped Product Design mode uses Dreamina image 4.0 at 2K. Choose a measured aspect ratio and a project-relative .png output path; never use this tool for placeholder art.',
    parameters: {
      prompt: { type: 'string', required: true, description: 'Detailed visual prompt with subject, composition, palette, style, lighting, crop, density, and any required text.' },
      aspect_ratio: { type: 'string', required: true, enum: ASPECT_RATIOS, description: 'Output aspect ratio selected for the measured asset slot.' },
      output_path: { type: 'string', required: true, description: 'Project-relative .png path; its parent directory must already exist.' },
      overwrite: { type: 'boolean', description: 'Replace an existing regular PNG at the same path.' },
    },
    output: { schema: OUTPUT_SCHEMA, render: (_args, value) => content(value) },
    presentCall: args => ({
      card: 'generic', title: `Generate image ${args.output_path}`, kind: 'edit', locations: [{ path: args.output_path }],
    }),
    async execute(args, exec) {
      await assertImageCapableRoute(ctx, exec)
      return toolValue(ctx, await ctx.imageGeneration.generate({
        cwd: workspaceCwd(exec),
        outputPath: args.output_path,
        ...(args.overwrite === undefined ? {} : { overwrite: args.overwrite }),
        prompt: args.prompt,
        aspectRatio: args.aspect_ratio,
      }, exec.signal))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'collect_generated_image',
    description: 'Resume one pending image-generation task and publish its PNG in the current project. Reuse exactly the task id and output path returned by generate_image; do not submit another generation merely because the first task is still processing.',
    parameters: {
      task_id: { type: 'string', required: true, description: 'Opaque task id returned by generate_image.' },
      output_path: { type: 'string', required: true, description: 'Project-relative .png path originally selected for the task.' },
      overwrite: { type: 'boolean', description: 'Replace an existing regular PNG at the same path.' },
    },
    output: { schema: OUTPUT_SCHEMA, render: (_args, value) => content(value) },
    presentCall: args => ({
      card: 'generic', title: `Collect image ${args.output_path}`, kind: 'edit', locations: [{ path: args.output_path }],
    }),
    async execute(args, exec) {
      await assertImageCapableRoute(ctx, exec)
      return toolValue(ctx, await ctx.imageGeneration.collect({
        cwd: workspaceCwd(exec),
        outputPath: args.output_path,
        ...(args.overwrite === undefined ? {} : { overwrite: args.overwrite }),
        taskId: args.task_id,
      }, exec.signal))
    },
  }))
}
