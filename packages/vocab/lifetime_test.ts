// The two words a component says about its own state, read off a declaration.

import { assertEquals } from '@std/assert'
import { durableOf, kept, lives, loadVocab, ms, said, syncOf } from './mod.ts'

Deno.test('a declaration answers with its word, or with the default', () => {
  assertEquals(said('peers'), 'peers')
  assertEquals(said('none'), 'none')
  assertEquals(said(undefined), 'server')
  assertEquals(said('sideways'), 'server')
  assertEquals(kept('5s'), '5s')
  assertEquals(kept(undefined), 'forever')
})

Deno.test('a duration is milliseconds; a boundary is not a span', () => {
  assertEquals(ms('250ms'), 250)
  assertEquals(ms('5s'), 5000)
  assertEquals(ms('2m'), 120_000)
  assertEquals(ms('1.5h'), 5_400_000)
  assertEquals(ms('forever'), null)
  assertEquals(ms('connection'), null)
  assertEquals(ms('soon'), null)
  assertEquals([lives('forever'), lives('connection'), lives('5s')], [
    true,
    true,
    true,
  ])
  assertEquals(lives('soon'), false)
})

Deno.test('a component that says nothing syncs to the server, forever', () => {
  let v = loadVocab({
    $defs: {
      task: {
        component: true,
        type: 'object',
        properties: { title: { type: 'string' } },
      },
      presence: {
        component: true,
        type: 'object',
        sync: 'peers',
        durable: 'connection',
        properties: { x: { type: 'number' } },
      },
    },
  })
  assertEquals([syncOf(v, 'task'), durableOf(v, 'task')], ['server', 'forever'])
  assertEquals([syncOf(v, 'presence'), durableOf(v, 'presence')], [
    'peers',
    'connection',
  ])
  // A component this vocabulary never heard of answers like an undeclared one.
  assertEquals([syncOf(v, 'ghost'), durableOf(v, 'ghost')], [
    'server',
    'forever',
  ])
})
