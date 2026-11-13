// The kernel's door to a store: where its object stands, what it says on
// every request, and what it counts. Its resends are @yaks/durable-object's
// (packages/durable-object/door_test.ts).
import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import {
  ACCEPTED,
  doorOf,
  PLATFORM_OBJECT,
  storeOf as door,
  STORES_AT,
} from './door.ts'
import {
  type Answer,
  namespace,
} from '../../packages/durable-object/testing.ts'
import { PLATFORM_STORE } from '@yaks/platform/names'
import { retry as retryWrite } from './write-log.ts'
import { counts, tallying } from './lib/hops.ts'

// Every store door here sends again without pausing.
let storeOf = (answers: Answer[], name = 'jeff') => {
  let ns = namespace(answers)
  return { ns, store: door(ns, name, undefined, () => Promise.resolve()) }
}

test('a request sums statement counts from each store response', async () => {
  let tally = new Map<string, number>()
  let next = 0
  await tallying(tally, async () => {
    let door = doorOf(() =>
      Promise.resolve(
        new Response('', {
          headers: {
            'x-yak-stmts': String(++next * 2),
            'x-yak-hops': '1',
          },
        }),
      ), 'jeff')
    await Promise.all([door('/query'), door('/query')])
  })
  assertEquals(tally.get('stmts'), 6)
  assertEquals(counts(tally).hops, 4)
})

test('every object is created beside the kernel, on a fresh stub per send', async () => {
  let gone = new Error('Durable Object reset because its code was updated.')
  let app = storeOf([gone, 'ok'], 'ada/cookbook.1f7c3e')
  assertEquals(await (await app.store('/query')).text(), 'ok')
  let directory = storeOf([], PLATFORM_STORE)
  await directory.store('/query')
  let hint = { locationHint: STORES_AT }
  assertEquals([...app.ns.gets, ...directory.ns.gets], [
    ['ada/cookbook.1f7c3e', hint],
    ['ada/cookbook.1f7c3e', hint],
    [PLATFORM_OBJECT, hint],
  ])
})

test('an interrupted recovery command is not silently sent again', async () => {
  let { ns, store } = storeOf([
    new Error(
      'Durable Object storage operation exceeded timeout which caused object to be reset.',
    ),
    Response.json({ writes: [] }),
  ])
  await assertRejects(
    () => retryWrite(store, 1),
    Error,
    'storage operation exceeded timeout',
  )
  assertEquals(ns.sent.length, 1)
})

test('the store door strips a visitor administrative claim and carries only its own vouch', async () => {
  for (
    let header of [
      'x-yak-administrative',
      'x-yak-actor',
      'x-yak-observe',
      ACCEPTED,
    ]
  ) {
    let seen: (string | null)[] = []
    let door = doorOf((req) => {
      seen.push(req.headers.get(header))
      return Promise.resolve(new Response(''))
    }, 'shop')
    let request = () =>
      new Request('https://shop/ws', { headers: { [header]: '1' } })
    await door('/query', request())
    await door('/query', request(), { [header]: '1' })
    assertEquals(seen, [null, '1'])
  }
})

test('Store policy is carried only from Served, never visitor headers', async () => {
  let seen: (string | null)[] = []
  let send = (req: Request) => {
    seen.push(req.headers.get('x-yak-policy'))
    return Promise.resolve(new Response(''))
  }
  let incoming = () =>
    new Request('http://visitor', { headers: { 'x-yak-policy': '999' } })
  await doorOf(send, 'app')('/query', incoming())
  await doorOf(send, 'app', { eid: 'app', access: 'private', policy: 12 })(
    '/query',
    incoming(),
  )
  assertEquals(seen, [null, '12'])
})
