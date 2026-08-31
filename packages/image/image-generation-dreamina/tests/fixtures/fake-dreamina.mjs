#!/usr/bin/env node

import { appendFile, open, unlink, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

let args = process.argv.slice(2)
if (args[0] === 'exec') {
  if (args[1] !== 'dreamina-test' || args[2] !== 'dreamina') {
    process.stderr.write('invalid docker execution prefix\n')
    process.exit(2)
  }
  args = args.slice(3)
}
const command = args[0]
const option = name => args.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const emit = value => process.stdout.write(`${JSON.stringify(value)}\n`)
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64')

if (command === 'text2image') {
  await appendFile(join(process.cwd(), '.fake-dreamina-invocations'), `${args.join('\t')}\n`)
  if (option('model_version') !== '4.0' || option('resolution_type') !== '2k' || option('ratio') === undefined) {
    process.stderr.write('model, resolution, and ratio are required\n')
    process.exitCode = 2
  } else {
    const prompt = option('prompt') ?? ''
    if (prompt.includes('[fail]')) {
      process.stderr.write('simulated provider failure\n')
      process.exitCode = 3
    } else if (prompt.includes('[pending]')) {
      emit({ submit_id: 'pending-task', gen_status: 'processing' })
    } else {
      if (prompt.includes('[slow]')) {
        const lockPath = join(process.cwd(), '.fake-dreamina-lock')
        let handle
        try {
          handle = await open(lockPath, 'wx', 0o600)
        } catch {
          process.stderr.write('concurrent invocation detected\n')
          process.exit(4)
        }
        await new Promise(resolve => setTimeout(resolve, 80))
        await handle.close()
        await unlink(lockPath)
      }
      const taskId = prompt.includes('[bad-png]')
        ? 'bad-png-task'
        : prompt.includes('[mismatch]')
          ? 'mismatch-task'
          : 'success-task'
      emit({ submit_id: taskId, gen_status: 'success', credit_count: 3 })
    }
  }
} else if (command === 'query_result') {
  const taskId = option('submit_id')
  if (taskId === 'pending-task') {
    emit({ submit_id: taskId, gen_status: 'processing' })
  } else {
    const downloadDir = option('download_dir')
    if (downloadDir === undefined) {
      process.stderr.write('download_dir is required\n')
      process.exitCode = 2
    } else {
      const path = join(downloadDir, `${taskId}.png`)
      const hostPath = downloadDir.startsWith('/container-data/')
        ? join(process.cwd(), 'bridge', basename(downloadDir), `${taskId}.png`)
        : path
      await writeFile(hostPath, taskId === 'bad-png-task' ? 'not an image' : png)
      emit({
        submit_id: taskId === 'mismatch-task' ? 'different-task' : taskId,
        gen_status: 'success',
        credit_count: 3,
        result_json: { images: [{ path, width: 2048, height: 2048 }], videos: [] },
      })
    }
  }
} else {
  process.stderr.write(`unsupported command ${String(command)}\n`)
  process.exitCode = 2
}
