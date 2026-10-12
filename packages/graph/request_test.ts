import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes, assertThrows } from '@std/assert'
import { books, memory } from './testing.ts'
import { graph } from './graph.ts'
import { Refused } from './admit.ts'

let g = (requests?: string[]) =>
  graph({
    storage: memory(),
    vocab: books,
    plugins: requests ? [{ name: 'test', requests }] : [],
  })

test('a request no plugin answers is refused, and the message names it', () => {
  let err = assertThrows(
    () => g().apply([{ entity: { eid: 'b' }, $num: true }]),
    Refused,
  )
  assertStringIncludes(err.message, 'unknown request: $num')
})

test('a plugin that declares a request lets it through', async () => {
  let out = await g(['$num']).apply([{ entity: { eid: 'b' }, $num: true }])
  assertEquals(out.map((b) => b.entity.eid), ['b'])
})

test('the core answers its own without a plugin', async () => {
  let out = await g().apply([{
    entity: { eid: 'b' },
    doc: { title: 'Dune' },
    $was: { doc: { title: null } },
  }])
  assertEquals(out.length, 1)
})
