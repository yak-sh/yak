// Deno reports one op per ten simulated turns; the ratchet divides by the
// values (ten times entities) to record ns/value. Boot and cleanup are excluded.
import {
  RELAY_ENTITIES,
  RELAY_TICKS,
  relayBenchmarkName,
  relayFixture,
} from './relay-fixture.ts'

for (const entities of RELAY_ENTITIES) {
  Deno.bench({
    name: relayBenchmarkName(entities),
    fn: async (b) => {
      const fixture = await relayFixture(entities)
      try {
        b.start()
        fixture.run(RELAY_TICKS)
        b.end()
      } finally {
        await fixture.close()
      }
    },
  })
}
