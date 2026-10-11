// A descriptor that does not hash to its id is never trusted, and a read the
// host refused is asked again on the next render.
import { test as liveTest } from './testing.ts'
import { test } from '@yaks/testing'
import { assertEquals, assertIsError } from '@std/assert'
import { eidOf } from '@yaks/archetype'
import { archetypeTables } from './live_archetypes.ts'
import { cache, clearForTest, config } from './live.ts'
import { host } from './host_testing.ts'
import { tick } from './testing.ts'

// Raw replicated values need no domain validation until a reader asks. Prepare
// the two fixed refused reads once and retain their error type and identity.
cache.value = {
  'bad-json': {
    entity: { eid: 'bad-json', num: 0 },
    archetype: { tables: 'not JSON' },
  },
  'wrong-id': {
    entity: { eid: 'wrong-id', num: 0 },
    archetype: { tables: '["task"]' },
  },
}
let rejected = (id: string): unknown => {
  try {
    archetypeTables(id)
  } catch (error) {
    return error
  }
}
let malformed = rejected('bad-json')
let misaddressed = rejected('wrong-id')
clearForTest()

test('malformed or misaddressed descriptors are never trusted', () => {
  assertIsError(malformed, SyntaxError)
  assertIsError(misaddressed, Error, 'wrong-id')
})

liveTest(
  'failed descriptor reads release and can retry on the next render',
  async () => {
    let prior = config.host
    config.host = 'archetypes.test'
    let answers = 0
    let wire = host(() =>
      answers++
        ? { bundles: [] }
        : { refused: { error: 'read', message: 'unavailable' } }
    )
    try {
      let id = eidOf(['retry_plugin'])
      let asks = () =>
        wire.asked().filter((a) =>
          a.subscribe == `.entity.eid=${id}&.fields=archetype.tables`
        )
      let gone = (a: { id: string }) =>
        wire.sent.filter((m) => m.unsubscribe == a.id).length
      assertEquals(archetypeTables(id), undefined)
      await tick()
      await tick()
      assertEquals(asks().length, 1)
      assertEquals(gone(asks()[0]), 1)
      archetypeTables(id)
      await tick()
      await tick()
      assertEquals(asks().length, 2)
      // An authoritative empty answer releases the read and does not loop.
      archetypeTables(id)
      await tick()
      assertEquals(asks().length, 2)
      assertEquals(gone(asks()[1]), 1)
    } finally {
      config.host = prior
      wire.free()
    }
  },
)
