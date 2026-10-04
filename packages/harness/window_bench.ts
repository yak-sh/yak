/** Isolated transcript transfer comparison. Run with `deno run -A`.
 * Arguments: entries (default 10000), body characters (default 1000), runs (3).
 * Never opens the configured/live harness database.
 */
import { remote } from './remote.ts'
import { at, harness } from './testing.ts'
import type { Sample, Samples } from '@yaks/benchmark'
import { standaloneMain } from '../../bench/standalone.ts'

export async function measure(
  args: string[] = [],
): Promise<Record<string, Samples>> {
  let samples: Record<string, Samples> = {}
  const count = Number(args[0] ?? 10000)
  const length = Number(args[1] ?? 1000)
  const runs = Number(args[2] ?? 3)
  if (![count, length, runs].every((v) => Number.isSafeInteger(v) && v > 0)) {
    throw new Error('positive integer arguments required')
  }
  const directory = await Deno.makeTempDir({ prefix: 'harness-window-bench-' })
  const db = directory + '/bench.sqlite'
  const seed = await harness(db)
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
        let r = await remote({ config: at(db), cwd: directory, fake: true })
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
          for (
            let [phase, value] of Object.entries({
              first: elapsed,
              warm,
              'timer-delay': maxStall,
            })
          ) {
            let collected = (samples[mode + '/' + phase] ??= []) as Sample[]
            collected.push({
              value,
              source: 'transfer',
              counts: {
                entries: count,
                bodyCharacters: length,
                delivered: rows.length,
                serializedCharacters: chars,
              },
            })
          }
        } finally {
          await r.close()
        }
      }
    }
  } finally {
    await Deno.remove(directory, { recursive: true })
  }
  return samples
}

if (import.meta.main) await standaloneMain('harness-window')
