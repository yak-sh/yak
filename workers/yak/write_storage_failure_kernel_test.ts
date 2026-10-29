// The runtime's SQL throws persistently without resetting this incarnation.
// Its writer is answered, and its input stays available for explicit retry.
import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { state } from './testing.ts'
import { writeStorageFailure } from './write_storage_failure_fixture.ts'

test('a storage failure answers its writer and retains input for reviewed recovery', async () => {
  let facts = await writeStorageFailure(
    state('probe/write-storage-failure').storage,
  )
  assertEquals(facts.settled, true)
  assertEquals(facts.response.status, 202)
  assertEquals((facts.response.body as { error: string }).error, 'Pending')
  assertEquals(facts.before, [])
  assertEquals(facts.kept.state, 'interrupted')
  assertEquals(JSON.parse(facts.kept.body), facts.body)
  assertEquals(facts.landed.state, 'applied')
  assertEquals([facts.landed.body, facts.landed.at], [
    facts.kept.body,
    facts.kept.at,
  ])
  assertEquals(facts.after.length, 1)
  assertEquals(facts.after[0].doc.title, 'poisoned-storage')
  assertEquals(facts.replayed, facts.after)
})
