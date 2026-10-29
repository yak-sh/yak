// Full graph admission checks at 10 values per second per entity.
import { RELAY_ENTITIES, relayFixture } from './relay-fixture.ts'
import type { Samples } from '@yaks/benchmark'
import { standaloneMain } from './standalone-main.ts'
import { selected } from './selected.ts'

export async function measure(
  args: string[] = [],
): Promise<Record<string, Samples>> {
  let results: Record<string, Samples> = {}

  const root = args[0] ?? new URL('..', import.meta.url).pathname
  const N = Number(args[1] ?? 200)
  for (const entities of RELAY_ENTITIES) {
    let name = 'graph-full-check/' + entities + '-entities'
    if (!selected(name)) continue
    const fixture = await relayFixture(entities, {
      root,
      variant: 'graph-full-check',
    })
    try {
      fixture.reset()
      const sample = await fixture.run(N)
      const count = fixture.counts(), values = N * entities
      results[name] = [{
        value: sample.value / 1000 / values,
        cpu: sample.cpu / 1000 / values,
        source: 'batch',
        counts: { values, entities, simulatedSeconds: N / 10, ...count },
        details: {
          note:
            'ordinary graph.apply(check) on durable SQLite + member/schema; rolled back',
        },
      }]
    } finally {
      await fixture.close()
    }
  }
  return results
}

if (import.meta.main) await standaloneMain('relay-admission')
