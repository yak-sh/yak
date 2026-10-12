// The runtime's SQL throws persistently without resetting this incarnation.
// Its writer is answered, and its input stays available for explicit retry.
import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { workerd } from './probe.ts'

test('a storage failure answers its writer and retains input for reviewed recovery', async () => {
  let r = await fetch(`${workerd().base}/__play_cost/?write-storage-failure`)
  assertEquals(r.status, 200, await r.clone().text())
  let facts = await r.json()
  assertEquals(facts.settled, true)
  assertEquals(facts.response.status, 202)
  assertEquals(facts.response.body.error, 'Pending')
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
