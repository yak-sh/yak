import { assertEquals, assertThrows } from '@std/assert'
import { books, memory } from './testing.ts'
import { graph } from './graph.ts'
import { Refused } from './admit.ts'

let g = (requests?: string[]) =>
  graph({
    storage: memory(),
    vocab: books,
    plugins: requests ? [{ name: 'test', requests }] : [],
  })

Deno.test('a request no plugin answers is refused, and the message names it', () => {
  let err = assertThrows(
    () => g().apply([{ entity: { eid: 'b' }, $num: true }]),
    Refused,
  )
  assertEquals(
    err.message,
    'unknown request: $num — this graph answers $delete, $was, $actor, ' +
      '$alias, $quiet',
  )
})

Deno.test('a plugin that declares a request lets it through', async () => {
  let out = await g(['$num']).apply([{ entity: { eid: 'b' }, $num: true }])
  assertEquals(out.map((b) => b.entity.eid), ['b'])
})

Deno.test('the core answers its own without a plugin', async () => {
  let out = await g().apply([{
    entity: { eid: 'b' },
    doc: { title: 'Dune' },
    $was: { doc: { title: null } },
  }])
  assertEquals(out.length, 1)
})
