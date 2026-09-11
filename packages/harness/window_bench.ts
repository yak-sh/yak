/** Isolated transcript transfer comparison. Run with `deno run -A`.
 * Arguments: entries (default 10000), body characters (default 1000), runs (3).
 * Never opens the configured/live harness database.
 */
import { open } from './store.ts'
import { remote } from './remote.ts'
const count = Number(Deno.args[0] ?? 10000)
const length = Number(Deno.args[1] ?? 1000)
const runs = Number(Deno.args[2] ?? 3)
if (![count, length, runs].every((v) => Number.isSafeInteger(v) && v > 0)) {
  throw new Error('positive integer arguments required')
}
const directory = await Deno.makeTempDir({ prefix: 'harness-window-bench-' })
const db = directory + '/bench.sqlite'
const seed = open(db)
for (let offset = 0; offset < count; offset += 250) {
  await seed.g.apply([
    ...offset == 0
      ? [{ entity: { eid: 'session' }, session: { id: 'benchmark' } }]
      : [],
    ...Array.from({ length: Math.min(250, count - offset) }, (_, j) => ({
      entity: { eid: 'e' + (offset + j) },
      entry: { session: 'session', seq: offset + j + 1 },
      content: { body: String(offset + j) + 'x'.repeat(length) },
    })),
  ])
}
seed.close()
try {
  for (let run = 0; run < runs; run++) {
    for (let mode of ['full', 'window']) {
      let r = await remote({ db, cwd: directory, fake: true })
      try {
        let maxStall = 0, previous = performance.now()
        let timer = setInterval(() => {
          let now = performance.now()
          maxStall = Math.max(maxStall, now - previous - 2)
          previous = now
        }, 2)
        let before = performance.now()
        let rows = mode == 'full'
          ? await r.agent.transcript('session')
          : (await r.agent.transcriptWindow!('session')).entries
        let elapsed = performance.now() - before
        await new Promise((resolve) => setTimeout(resolve, 3))
        clearInterval(timer)
        let chars = JSON.stringify(rows).length
        let warm = performance.now()
        if (mode == 'full') await r.agent.transcript('session')
        else await r.agent.transcriptWindow!('session')
        warm = performance.now() - warm
        console.log(
          JSON.stringify({
            run,
            mode,
            count,
            bodyCharacters: length,
            delivered: rows.length,
            serializedCharacters: chars,
            firstMs: Math.round(elapsed),
            warmMs: Math.round(warm),
            maxTimerDelayMs: Math.round(maxStall),
          }),
        )
      } finally {
        await r.close()
      }
    }
  }
} finally {
  await Deno.remove(directory, { recursive: true })
}
