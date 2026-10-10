// A descriptor that does not hash to its id is never trusted, and a read the
// host refused is asked again on the next render.
import { test } from './testing.ts'
import { assertEquals, assertThrows } from '@std/assert'
import { eidOf } from '@yaks/archetype'
import { archetypeTables } from './live_archetypes.ts'
import { applyLocal, config } from './live.ts'
import { host } from './host_testing.ts'
import { tick } from './testing.ts'

test('malformed or misaddressed descriptors are never trusted', () => {
  let descriptor = (id: string, tables: string) =>
    applyLocal([
      { eid: id, name: 'entity', comp: { eid: id } },
      { eid: id, name: 'archetype', comp: { tables } },
    ])
  // Raw replicated values are cached without domain validation. Readers must
  // never trust malformed descriptor text or a mismatched identity.
  descriptor('bad-json', 'not JSON')
  assertThrows(() => archetypeTables('bad-json'), SyntaxError)
  // Names that hash to another id are refused when read.
  descriptor('wrong-id', '["task"]')
  assertThrows(() => archetypeTables('wrong-id'), Error, 'wrong-id')
})

test('failed descriptor reads release and can retry on the next render', async () => {
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
})
