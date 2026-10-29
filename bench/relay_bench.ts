// One value from submission through admission and staging, excluding fanout.
import {
  RELAY_ENTITIES,
  relayBenchmarkName,
  relayFixture,
} from './relay-fixture.ts'

for (const entities of RELAY_ENTITIES) {
  const fixture = await relayFixture(entities)
  addEventListener('unload', () => fixture.close())
  Deno.bench({
    name: relayBenchmarkName(entities),
    fn: async (b) => {
      await fixture.next(b)
    },
  })
}
