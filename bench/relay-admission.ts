// Ordinary admission at 10 values per second per entity, on a warmed Store.
// Supply a checkout path to compare the same fixture across revisions.
import { RELAY_ENTITIES, relayFixture } from './relay-fixture.ts'

const root = Deno.args[0] ?? new URL('..', import.meta.url).pathname
const N = Number(Deno.args[1] ?? 200)
const median = (a: number[]) =>
  [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
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
      console.log(JSON.stringify({
        variant,
        entities,
        simulated_seconds: N / 10,
        values,
        micros_per_value: +(median(samples) * 1000 / values).toFixed(3),
        cpu_ms_per_entity_second: +(median(samples) * 10 / values).toFixed(4),
        sql_per_value: count.sql / values,
        reads_per_value: count.reads / values,
        write_stmts_per_value: count.writes / values,
        transactions_per_value: count.transactions / values,
        ...(variant == 'store-relay' ? { refused: 0 } : {}),
        note: variant == 'store-relay'
          ? 'synchronous message/admission/coalescing, no observers; fanout timer excluded'
          : 'ordinary graph.apply(check) on durable SQLite + member/schema; rolled back',
      }))
    } finally {
      await fixture.close()
    }
  }
}
