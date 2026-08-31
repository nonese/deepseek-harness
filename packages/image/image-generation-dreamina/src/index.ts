/** Dreamina CLI provider for workspace-confined PNG generation. @module @deepseek-ai/dsh-image-generation-dreamina */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { basename, isAbsolute, posix } from 'node:path'
import ImageGenerationRuntime from '@deepseek-ai/dsh-image-generation'
import type {
  ImageGenerationCollectRequest,
  ImageGenerationCompleted,
  ImageGenerationRequest,
  ImageGenerationResult,
} from '@deepseek-ai/dsh-image-generation'
import {
  downloadDirectory,
  containerDownloadPath,
  parseTask,
  readDownloadedPng,
  removeDownloadDirectory,
  runDreamina,
} from './cli.ts'
import { imageTarget, publishImage } from './path.ts'

/** Dreamina CLI deployment settings. */
export interface Config {
  /** Absolute Dreamina executable path or a bare PATH name. Defaults to `dreamina`. */
  cliPath?: string
  /** Dreamina image model. The Product Design preset pins `4.0`. */
  modelVersion?: '4.0'
  /** Dreamina image resolution. The Product Design preset pins `2k`. */
  resolution?: '2k'
  /** Seconds the submit command polls before returning a resumable task. Defaults to 240. */
  pollSeconds?: number
  /** Maximum downloaded PNG bytes. Defaults to 25 MiB. */
  maxOutputBytes?: number
  /** Maximum prompt characters. Defaults to 20,000. */
  maxPromptChars?: number
  /** Process-tree termination grace in milliseconds. Defaults to 5,000. */
  graceMs?: number
  /** Optional running Docker container that provides the Dreamina CLI. */
  dockerContainer?: string
  /** Host directory bind-mounted at `dockerContainerDownloadRoot`. */
  dockerHostDownloadRoot?: string
  /** Container directory corresponding to `dockerHostDownloadRoot`. */
  dockerContainerDownloadRoot?: string
  /** Docker executable path or PATH-resolved name. Defaults to `docker`. */
  dockerPath?: string
}

type ResolvedConfig = Required<Omit<Config,
  'dockerContainer' | 'dockerHostDownloadRoot' | 'dockerContainerDownloadRoot'>> & Pick<Config,
    'dockerContainer' | 'dockerHostDownloadRoot' | 'dockerContainerDownloadRoot'>

/** Runtime schema for the Dreamina CLI provider. */
export const Config: z<Config> = z.object({
  cliPath: z.string().min(1).default('dreamina'),
  modelVersion: z.const('4.0').default('4.0'),
  resolution: z.const('2k').default('2k'),
  pollSeconds: z.natural().min(1).max(600).default(240),
  maxOutputBytes: z.natural().min(1_024).max(100 * 1024 * 1024).default(25 * 1024 * 1024),
  maxPromptChars: z.natural().min(1).max(100_000).default(20_000),
  graceMs: z.natural().min(1).max(60_000).default(5_000),
  dockerContainer: z.string().min(1),
  dockerHostDownloadRoot: z.string().min(1),
  dockerContainerDownloadRoot: z.string().min(1),
  dockerPath: z.string().min(1).default('docker'),
})

interface DreaminaCommand {
  executable: string
  prefix: readonly string[]
}

interface DreaminaDownload {
  hostDirectory: string
  providerDirectory: string
  hostPath(providerPath: string): string
}

function nonEmptyPrompt(prompt: string, maxPromptChars: number): string {
  const trimmed = prompt.trim()
  if (trimmed.length === 0) throw new Error('image prompt must be a non-empty string')
  if (trimmed.length > maxPromptChars) {
    throw new Error(`image prompt exceeds the configured ${String(maxPromptChars)} character limit`)
  }
  return trimmed
}

/** Local Dreamina provider pinned by configuration to model 4.0 and 2K output. */
export class DreaminaImageGenerationRuntime extends ImageGenerationRuntime {
  static inject = ['subprocess']

  static Config = Config

  private readonly config: ResolvedConfig
  private queue: Promise<void> = Promise.resolve()

  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.config = config as ResolvedConfig
    const dockerValues = [
      this.config.dockerContainer,
      this.config.dockerHostDownloadRoot,
      this.config.dockerContainerDownloadRoot,
    ]
    if (dockerValues.some(value => value !== undefined) && dockerValues.some(value => value === undefined)) {
      throw new Error('Dreamina Docker execution requires container, host download root, and container download root together')
    }
    if (this.config.dockerContainer !== undefined
      && !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(this.config.dockerContainer)) {
      throw new Error('Dreamina Docker container name is invalid')
    }
    if (this.config.dockerHostDownloadRoot !== undefined && !isAbsolute(this.config.dockerHostDownloadRoot)) {
      throw new Error('Dreamina Docker host download root must be absolute')
    }
    if (this.config.dockerContainerDownloadRoot !== undefined
      && !posix.isAbsolute(this.config.dockerContainerDownloadRoot)) {
      throw new Error('Dreamina Docker container download root must be absolute')
    }
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.queue.then(operation)
    this.queue = pending.then(() => {}, () => {})
    return pending
  }

  private base(taskId: string, creditCount?: number) {
    return {
      provider: 'dreamina-cli',
      modelVersion: this.config.modelVersion,
      resolution: this.config.resolution,
      taskId,
      ...(creditCount === undefined ? {} : { creditCount }),
    } as const
  }

  private async command(signal?: AbortSignal): Promise<DreaminaCommand> {
    const docker = this.config.dockerContainer
    const wanted = docker === undefined ? this.config.cliPath : this.config.dockerPath
    try {
      const executable = await this.ctx.subprocess.resolveExecutable(wanted, undefined, signal)
      return docker === undefined
        ? { executable, prefix: [] }
        : { executable, prefix: ['exec', docker, this.config.cliPath] }
    } catch (error: unknown) {
      throw new Error(
        `${docker === undefined ? 'dreamina CLI' : 'Docker executable'} ${JSON.stringify(wanted)} is unavailable`,
        { cause: error },
      )
    }
  }

  private async download(): Promise<DreaminaDownload> {
    const hostRoot = this.config.dockerHostDownloadRoot
    const containerRoot = this.config.dockerContainerDownloadRoot
    if (hostRoot === undefined || containerRoot === undefined) {
      const hostDirectory = await downloadDirectory()
      return { hostDirectory, providerDirectory: hostDirectory, hostPath: path => path }
    }
    const hostDirectory = await downloadDirectory(hostRoot)
    const providerDirectory = posix.join(containerRoot, basename(hostDirectory))
    return {
      hostDirectory,
      providerDirectory,
      hostPath: path => containerDownloadPath(providerDirectory, hostDirectory, path),
    }
  }

  private async finish(
    command: DreaminaCommand,
    request: ImageGenerationCollectRequest,
    signal?: AbortSignal,
  ): Promise<ImageGenerationResult> {
    const overwrite = request.overwrite ?? false
    const target = await imageTarget(request.cwd, request.outputPath, overwrite)
    const download = await this.download()
    try {
      const raw = await runDreamina(this.ctx, command.executable, [...command.prefix,
        'query_result',
        `--submit_id=${request.taskId}`,
        `--download_dir=${download.providerDirectory}`,
      ], request.cwd, this.config.graceMs, signal)
      const task = parseTask(raw, true)
      if (task.taskId !== request.taskId) throw new Error('dreamina CLI returned a different submit_id')
      if (task.status === 'pending') return { status: 'pending', ...this.base(task.taskId, task.creditCount) }
      /* v8 ignore next -- parseTask(requireImage=true) guarantees image metadata for every completed task. */
      if (task.image === undefined) throw new Error('dreamina CLI returned no downloaded image metadata')
      const data = await readDownloadedPng(
        download.hostDirectory,
        download.hostPath(task.image.path),
        this.config.maxOutputBytes,
        signal,
      )
      await publishImage(target, data, overwrite, signal)
      const result: ImageGenerationCompleted = {
        status: 'completed',
        ...this.base(task.taskId, task.creditCount),
        path: target.relativePath,
        data,
        sizeBytes: data.byteLength,
        width: task.image.width,
        height: task.image.height,
        mediaType: 'image/png',
      }
      return result
    } finally {
      await removeDownloadDirectory(download.hostDirectory)
    }
  }

  override generate(request: ImageGenerationRequest, signal?: AbortSignal): Promise<ImageGenerationResult> {
    return this.serialized(async () => {
      signal?.throwIfAborted()
      const overwrite = request.overwrite ?? false
      await imageTarget(request.cwd, request.outputPath, overwrite)
      const command = await this.command(signal)
      const raw = await runDreamina(this.ctx, command.executable, [...command.prefix,
        'text2image',
        `--prompt=${nonEmptyPrompt(request.prompt, this.config.maxPromptChars)}`,
        `--ratio=${request.aspectRatio}`,
        `--model_version=${this.config.modelVersion}`,
        `--resolution_type=${this.config.resolution}`,
        `--poll=${String(this.config.pollSeconds)}`,
      ], request.cwd, this.config.graceMs, signal)
      const task = parseTask(raw, false)
      if (task.status === 'pending') return { status: 'pending', ...this.base(task.taskId, task.creditCount) }
      return this.finish(command, {
        cwd: request.cwd,
        outputPath: request.outputPath,
        overwrite,
        taskId: task.taskId,
      }, signal)
    })
  }

  override collect(request: ImageGenerationCollectRequest, signal?: AbortSignal): Promise<ImageGenerationResult> {
    return this.serialized(async () => {
      signal?.throwIfAborted()
      const command = await this.command(signal)
      return this.finish(command, request, signal)
    })
  }
}

export default DreaminaImageGenerationRuntime
