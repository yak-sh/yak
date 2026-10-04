// Ordinary admission at 10 values per second per entity, on a warmed Store.
// Supply a checkout path to compare the same fixture across revisions.
import { RELAY_ENTITIES, relayFixture } from './relay-fixture.ts'
import type { Samples } from '@yaks/benchmark'
import { standaloneMain } from './standalone.ts'

export async function measure(
  args: string[] = [],
): Promise<Record<string, Samples>> {
  let results: Record<string, Samples> = {}

  const root = args[0] ?? new URL('..', import.meta.url).pathname
  const N = Number(args[1] ?? 200)
  for (const entities of RELAY_ENTITIES) {
    for (const variant of ['store-relay', 'graph-full-check']) {
      const fixture = await relayFixture(entities, { root, variant })
      try {
        const samples: number[] = []
        for (let round = 0; round < 3; round++) {
          fixture.reset()
          const start = performance.now()
          fixture.run(N)
          samples.push(performance.now() - start)
        }
        const count = fixture.counts(), values = N * entities
        results[variant + '/' + entities + '-entities'] = samples.map(
          (value) => ({
            value: value * 1000 / values,
            source: 'batch',
            counts: { values, entities, simulatedSeconds: N / 10, ...count },
            details: {
              note: variant == 'store-relay'
                ? 'synchronous message/admission/coalescing, no observers; fanout timer excluded'
                : 'ordinary graph.apply(check) on durable SQLite + member/schema; rolled back',
            },
          }),
        )
      } finally {
        await fixture.close()
      }
    }
  }
  return results
}

if (import.meta.main) await standaloneMain('relay-admission')
