/** Isolated worker pilot measurements; never opens the default database.
 * deno run -A packages/harness/worker_bench.ts
 */
import { agent } from './run.ts'
import { open } from './store.ts'
import { remote } from './remote.ts'
const cwd = await Deno.makeTempDir()
let results: unknown[] = []
try {
  for (let mode of ['inline', 'worker']) {
    let begin = performance.now()
    let inline = mode == 'inline'
      ? agent({
        h: open(':memory:'),
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
      ? await remote({ db: ':memory:', cwd, fake: true })
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
    results.push({
      mode,
      startupMs: Math.round(startup),
      workMs: Math.round(elapsed),
      maxTimerDelayMs: Math.round(maxDelay),
      ticks,
      entries: entries.length,
      traffic: worker?.traffic,
    })
    if (worker) await worker.close()
    inline?.close()
  }
  console.log(JSON.stringify(results, null, 2))
} finally {
  await Deno.remove(cwd, { recursive: true })
}
