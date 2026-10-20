// One hero's tick never completes another hero's village task.
import { test } from '@yaks/testing'
import { assertEquals, assertNotEquals } from '@std/assert'
import { finished, WELCOME } from '../vale/village-tasks.ts'
import { completed, completionEid } from './state.js'

let task = WELCOME, first = crypto.randomUUID(), second = crypto.randomUUID()
// Digests answer through the runtime's crypto thread, whatever else it is
// running; derive them as the file loads and check them below.
let [eid, again, other] = await Promise.all([
  completionEid(task, first),
  completionEid(task, first),
  completionEid(task, second),
])

test('a village task completion belongs to one hero', () => {
  assertEquals(eid, again)
  assertNotEquals(eid, other)
  let rows = [{ village_done: { task, player: first } }]
  assertEquals([...completed(rows, first)], [task])
  assertEquals([...completed(rows, second)], [])
  assertEquals(finished(rows, task, first), true)
  assertEquals(finished(rows, task, second), false)
})
