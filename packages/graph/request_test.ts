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

test('a request an authorize hook answers writes at the eids it chose', async () => {
  let shelved = (eid: string) =>
    graph({
      storage: memory(),
      vocab: books,
      plugins: [{
        name: 'test',
        requests: ['$shelve'],
        authorize: (bundles) =>
          bundles.map((b) =>
            b.$shelve ? { entity: { eid }, doc: { title: 'Dune' } } : b
          ),
      }],
    }).apply([{ entity: { eid: '$s' }, $shelve: true }])
  assertEquals((await shelved('b')).map((b) => b.entity.eid), ['b'])
  // Minting is past inside the transaction, so an alias there would be
  // stored as that very eid.
  assertThrows(() => shelved('$b'), Refused, '$b is an alias')
})
