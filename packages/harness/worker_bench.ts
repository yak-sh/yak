/** Isolated worker pilot measurements; never opens the default database.
 * deno run -A packages/harness/worker_bench.ts
 */
import { local } from './local.ts'
import { remote } from './remote.ts'
import { at, harness } from './testing.ts'
import type { Samples } from '@yaks/benchmark'
import { standaloneMain } from '../../bench/standalone.ts'

export async function measure(
  _args: string[] = [],
): Promise<Record<string, Samples>> {
  const cwd = await Deno.makeTempDir()
  let results: Record<string, Samples> = {}
  try {
    for (let mode of ['inline', 'worker']) {
      let begin = performance.now()
      let inline = mode == 'inline'
        ? local({
          h: await harness(),
          cwd,
          name: 'fake',
          model: () =>
            Promise.resolve({
              id: 'r',
              model: 'fake',
              items: [{ kind: 'assistant', text: 'ok' }],
            }),
        })
        : undefined
      let worker = mode == 'worker'
        ? await remote({ config: at(':memory:'), cwd, fake: true })
        : undefined
      let a = inline ?? worker!.agent
      let startup = performance.now() - begin
      let last = performance.now(), maxDelay = 0, ticks = 0
      let timer = setInterval(() => {
        let now = performance.now()
        maxDelay = Math.max(maxDelay, now - last - 2)
        last = now
        ticks++
      }, 2)
      begin = performance.now()
      let id = await a.start('x'.repeat(100_000))
      for (let i = 0; i < 10; i++) {
        await a.send(id, 'tool-like output ' + i + '\n' + 'x'.repeat(100_000))
      }
      if (inline) await inline.idle(id)
      else await worker!.idle(id)
      let entries = await a.transcript(id)
      await new Promise((resolve) => setTimeout(resolve, 0))
      let elapsed = performance.now() - begin
      clearInterval(timer)
      let counts = { ticks, entries: entries.length }
      results[mode + '/startup'] = { value: startup, counts }
      results[mode + '/work'] = {
        value: elapsed,
        counts,
        details: worker?.traffic,
      }
      results[mode + '/timer-delay'] = { value: maxDelay, counts }
      if (worker) await worker.close()
      await inline?.close()
    }
    return results
  } finally {
    await Deno.remove(cwd, { recursive: true })
  }
}

if (import.meta.main) await standaloneMain('harness-worker')
