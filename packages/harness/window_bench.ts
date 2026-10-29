/** Isolated transcript transfer comparison. Run with `deno run -A`.
 * Arguments: entries (default 10000), body characters (default 1000), runs (3).
 * Never opens the configured/live harness database.
 */
import { remote } from './remote.ts'
import { at, harness } from './testing.ts'
import { type Sample, type Samples, stopwatch } from '@yaks/benchmark'
import { standaloneMain } from '../../bench/standalone-main.ts'
import { fixture } from '../../bench/fixture.ts'

let seeded = fixture(async (path: string, count: number, length: number) => {
  let seed = await harness(path)
  try {
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
  } finally {
    await seed.close()
  }
})

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
  await seeded(db, count, length)
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
          let took = stopwatch()
          let rows = mode == 'full'
            ? await r.agent.transcript('session')
            : (await r.agent.transcriptWindow!('session')).entries
          let elapsed = took()
          await new Promise((resolve) => setTimeout(resolve, 3))
          clearInterval(timer)
          let chars = JSON.stringify(rows).length
          took = stopwatch()
          if (mode == 'full') await r.agent.transcript('session')
          else await r.agent.transcriptWindow!('session')
          let warm = took()
          for (
            let [phase, sample] of Object.entries({
              first: elapsed,
              warm,
            })
          ) {
            let collected = (samples[mode + '/' + phase] ??= []) as Sample[]
            collected.push({
              ...sample,
              details: { timerDelay: maxStall },
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
