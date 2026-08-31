/**
 * Provider-neutral image generation and workspace publication service.
 * @module @deepseek-ai/dsh-image-generation
 */

import { Context, Service } from '@deepseek-ai/cordis'

/** Aspect ratios accepted by the shipped image-generation tool. */
export type ImageAspectRatio = '21:9' | '16:9' | '3:2' | '4:3' | '1:1' | '3:4' | '2:3' | '9:16'

/** Trusted workspace target plus model-authored generation inputs. */
export interface ImageGenerationRequest {
  /** Absolute session workspace root supplied by the trusted tool consumer. */
  cwd: string
  /** Relative `.png` output path below `cwd`. */
  outputPath: string
  /** Replace an existing regular file at the same path. */
  overwrite?: boolean
  /** Prompt sent to the configured image provider. */
  prompt: string
  /** Requested output aspect ratio. */
  aspectRatio: ImageAspectRatio
}

/** Request to finish one provider task returned as pending. */
export interface ImageGenerationCollectRequest {
  /** Absolute session workspace root supplied by the trusted tool consumer. */
  cwd: string
  /** Relative `.png` output path below `cwd`. */
  outputPath: string
  /** Replace an existing regular file at the same path. */
  overwrite?: boolean
  /** Opaque provider task identifier returned by {@link ImageGenerationPending}. */
  taskId: string
}

/** Common provider facts carried by pending and completed outcomes. */
export interface ImageGenerationBase {
  /** Provider identifier selected by the mounted implementation. */
  provider: string
  /** Exact image-model version used for the task. */
  modelVersion: string
  /** Exact resolution tier used for the task. */
  resolution: string
  /** Provider task identifier used to resume or audit the operation. */
  taskId: string
  /** Credits reported by the provider when available. */
  creditCount?: number
}

/** A submitted task that has not produced downloadable media yet. */
export interface ImageGenerationPending extends ImageGenerationBase {
  status: 'pending'
}

/** A validated image atomically published inside the calling workspace. */
export interface ImageGenerationCompleted extends ImageGenerationBase {
  status: 'completed'
  /** Canonical workspace-relative output path. */
  path: string
  /** Verified PNG bytes, retained only across the same-process service call. */
  data: Uint8Array
  /** Encoded byte length. */
  sizeBytes: number
  /** Provider-reported pixel width. */
  width: number
  /** Provider-reported pixel height. */
  height: number
  /** Verified output media type. */
  mediaType: 'image/png'
}

/** Canonical provider outcome for a submit or collect call. */
export type ImageGenerationResult = ImageGenerationPending | ImageGenerationCompleted

declare module '@deepseek-ai/cordis' {
  interface Context {
    imageGeneration: ImageGenerationRuntime
  }
}

/**
 * Image-generation service. Implementations validate provider output before publishing,
 * confine `outputPath` below `cwd`, reject symbolic-link escapes, and serialize provider
 * work when an account cannot safely process concurrent submissions.
 */
export abstract class ImageGenerationRuntime extends Service {
  constructor(ctx: Context) {
    super(ctx, 'imageGeneration')
  }

  /**
   * Submit one image and wait for the provider's configured foreground interval.
   * @param request - trusted workspace root plus model-authored prompt, ratio, and output path.
   * @param signal - aborts provider work and publication.
   * @returns a completed workspace image or a resumable pending task.
   */
  abstract generate(request: ImageGenerationRequest, signal?: AbortSignal): Promise<ImageGenerationResult>

  /**
   * Query and publish one previously submitted task.
   * @param request - trusted workspace root, prior task id, and output path.
   * @param signal - aborts provider work and publication.
   * @returns a completed workspace image or the still-pending task.
   */
  abstract collect(request: ImageGenerationCollectRequest, signal?: AbortSignal): Promise<ImageGenerationResult>
}

export default ImageGenerationRuntime
