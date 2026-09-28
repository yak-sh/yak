// One hero's tick never completes another hero's village task.
import { assertEquals, assertNotEquals } from '@std/assert'
import { greeting } from '../vale/villagers.ts'
import { finished, WELCOME } from '../vale/village-tasks.ts'
import { completed, completionEid } from './state.js'

Deno.test('a village task completion belongs to one hero', async () => {
  let task = WELCOME, first = crypto.randomUUID(), second = crypto.randomUUID()
  let eid = await completionEid(task, first)
  assertEquals(eid, await completionEid(task, first))
  assertNotEquals(eid, await completionEid(task, second))
  let rows = [{ village_done: { task, player: first } }]
  assertEquals([...completed(rows, first)], [task])
  assertEquals([...completed(rows, second)], [])
  assertEquals(finished(rows, task, first), true)
  assertEquals(finished(rows, task, second), false)
  assertEquals(greeting('pip', 'Come see my sign.', false), 'Come see my sign.')
  assertEquals(
    greeting('pip', 'Come see my sign.', true).includes(
      'found my welcome sign',
    ),
    true,
  )
  assertEquals(greeting('wren', 'Follow the road.', true), 'Follow the road.')
})
