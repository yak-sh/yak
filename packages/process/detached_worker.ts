import { parentPort } from 'node:worker_threads'
import { command } from './command.ts'
import type { Launch, Launched } from './detached.ts'

parentPort!.on('message', async ({ id, program, options }: Launch) => {
  let answer: Launched = { id }
  try {
    let child = command(program, {
      ...options,
      stdin: 'null',
      stdout: 'null',
      stderr: 'null',
    }).spawn()
    // The short-lived launcher exits after detaching the tracked program.
    // Keep its startup failures on the waiting caller's promise.
    child.unref()
    await child.status
  } catch (error) {
    answer.error = error instanceof Error ? error : new Error(String(error))
  }
  parentPort!.postMessage(answer)
})
