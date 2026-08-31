import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import ImageGenerationRuntime from '@deepseek-ai/dsh-image-generation'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
)

class SnapshotImageGeneration extends ImageGenerationRuntime {
  async generate(request) {
    await writeFile(join(request.cwd, request.outputPath), PNG)
    return this.completed(request)
  }

  collect(request) {
    return Promise.resolve(this.completed(request))
  }

  completed(request) {
    return {
      status: 'completed',
      provider: 'snapshot',
      modelVersion: '4.0',
      resolution: '2k',
      taskId: 'snapshot-task',
      path: request.outputPath,
      data: PNG,
      sizeBytes: PNG.byteLength,
      width: 1,
      height: 1,
      mediaType: 'image/png',
    }
  }
}

export default SnapshotImageGeneration
