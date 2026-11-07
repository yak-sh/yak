import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { addressed, type Bundle } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { short } from '@yaks/id'
import { operatorMemory } from './operator-testing.ts'
import { owns } from './operator-access.ts'
import { remove } from './operator-remove.ts'

let store = operatorMemory()
let id = () => crypto.randomUUID()
let [space, person] = [id(), id()]
let [task, session, root, wake, asked, fired, kept] = [
  id(),
  id(),
  id(),
  id(),
  id(),
  id(),
  id(),
]
let line = (session: string, seq: number, eid = id()): Bundle => ({
  entity: { eid },
  entry: { session, seq },
  content: { body: `line ${seq}` },
})
let request = (eid: string, more: object): Bundle => ({
  entity: { eid },
  operator_request: { space, person, ...more },
  doc: { title: 'words', body: 'words' },
})
let seed: Bundle[] = [
  { entity: { eid: task }, task: {}, doc: { title: 'TEST', body: 'TEST' } },
  { entity: { eid: id() }, comment: { target: task }, doc: { body: 'done' } },
  { entity: { eid: id() }, edge: { from: task, to: session }, contains: {} },
  { entity: { eid: session }, session: { id: session } },
  line(session, 1),
  line(session, 2),
  request(asked, { task }),
  { entity: { eid: root }, session: { id: root } },
  line(root, 1, kept),
  line(root, 2, fired),
  request(id(), { about: wake, channel: 'wake' }),
]
await store.g.apply(seed, { trusted: true })
let wakeRequest = seed.at(-1)!.entity.eid
let told = derivedEid('operator-told|' + wakeRequest)
await store.g.apply([{
  entity: { eid: told },
  notification: {},
  deliver: { to: person },
  doc: { body: 'Wake-up test fired.' },
}], { trusted: true })

let removed = await remove(store, [task, fired, wake])
let left = async () =>
  (await store.g.get(seed.map((b) => b.entity.eid).concat(told)))
    .filter((b) => b && !b.tombstone).map((b) => b!.entity.eid)

test('removing a task takes its comments, sessions and their lines, and its requests', async () => {
  assertEquals(removed.includes(asked), true)
  assertEquals(removed.includes(session), true)
  assertEquals(await left(), [root, kept])
})

test('removing a wake-up takes the requests it fired and what they told in Updates', () => {
  assertEquals([wakeRequest, told].every((e) => removed.includes(e)), true)
})

test('a cancelled subscription, named by its handle, is its owner to remove with what it fired', async () => {
  let [sub, fired] = [id(), id()]
  let tells = derivedEid('operator-told|' + fired)
  await store.g.apply([
    {
      entity: { eid: sub },
      operator_ask: { space, person, say: 'look' },
      operator_subscription: { query: '.doc' },
    },
    request(fired, { about: sub, channel: 'subscription' }),
    { entity: { eid: tells }, notification: {}, deliver: { to: person } },
  ], { trusted: true })
  await store.g.apply([{ entity: { eid: sub }, $delete: true }], {
    trusted: true,
  })
  let [named] = await addressed(store.g, [short(sub)])
  assertEquals(named, sub)
  assertEquals(await owns(store, sub, { space, person }), true)
  assertEquals(await owns(store, sub, { space, person: id() }), false)
  assertEquals((await remove(store, [sub])).sort(), [fired, tells].sort())
})
