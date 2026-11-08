// Schema windows can wait on the disk even when their row count is bounded.
// Keep that connection, its ANALYZE and its write locks off the duty loop.
import type { Config } from './config.ts'
import { type Port, portLink } from '@yaks/sync/port'

type Thread = Port & { terminate: () => void }

export let upkeepThread = async (
  config: Config,
  signal: AbortSignal,
  report: (error: unknown, work: string) => void,
  start: () => Thread = () =>
    new Worker(new URL('./upkeep_worker.ts', import.meta.url), {
      type: 'module',
    }),
): Promise<void> => {
  if (signal.aborted) return
  let worker = start()
  let link = portLink(worker, {
    receive: (work, error) => report(new Error(String(error)), work),
  })
  // Stop cooperatively: ending a worker during its write would leave a lock
  // held until the native call returned, and would discard its failure.
  let stop = () => {
    void link.request('stop', undefined, { timeout: null }).catch(() => {})
  }
  signal.addEventListener('abort', stop, { once: true })
  try {
    await link.request('run', config, { timeout: null })
  } finally {
    signal.removeEventListener('abort', stop)
    link.close()
    worker.terminate()
  }
}
