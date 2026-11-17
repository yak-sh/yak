import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { TOLD, toldBackfill, toldMoved } from './told-move.ts'
import { operatorMemory } from './operator-testing.ts'
import { updatesOf } from './operator-updates.ts'
import type { OperatorStore } from './operator-store.ts'

let [person, space, app] = [0, 1, 2].map(() => crypto.randomUUID())

// A store holding what the old code wrote: notifications told in
// `deliver{to}`, one emailed (`deliver.tried`), and a letter that is not one.
let kept = async (old = 51) => {
  let marks = new Map<string, string>()
  let store = {
    ...operatorMemory(),
    marks: { get: (k: string) => marks.get(k), set: marks.set.bind(marks) },
  } as unknown as OperatorStore
  let eid = (i: number) =>
    `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
  let told: Bundle[] = Array.from({ length: old }, (_, i) => ({
    entity: { eid: eid(i) },
    notification: i % 2 ? { about: app } : {},
    deliver: {
      to: i % 3 ? person : space,
      ...i == 1 ? { tried: '2026-11-01T00:00:00.000Z' } : {},
    },
    doc: { body: `told ${i}` },
  }))
  let letter = crypto.randomUUID()
  await store.g.apply([
    ...told,
    {
      entity: { eid: letter },
      mail: { from: 'a@example.com', to: 'b@example.com' },
      deliver: { to: person },
    },
  ], { trusted: true })
  return { store, marks, letter }
}

let shape = async (store: OperatorStore) =>
  (await store.g.read('.notification *')).map((b) => [
    (b.notification as { to?: string }).to,
    (b.notification as { about?: string }).about,
    b.deliver,
  ])

test('notifications move whom they tell into notification{to}, a batch an alarm, once', async () => {
  let { store, marks, letter } = await kept()
  let passes = [await toldBackfill(store), await toldBackfill(store)]
  assertEquals([...passes, await toldBackfill(store)], [true, false, false])
  assertEquals(marks.get(TOLD), 'done')
  let moved = await shape(store)
  assertEquals(moved.length, 51)
  assertEquals(moved.filter(([, , d]) => d).length, 0)
  assertEquals(moved.filter(([to]) => to == person).length, 34)
  assertEquals(moved.filter(([to]) => to == space).length, 17)
  assertEquals(moved.filter(([, about]) => about == app).length, 25)
  let [kept_] = await store.g.get([letter])
  assertEquals(kept_.deliver, { to: person })
})

test("a person's Updates finish the pass before reading", async () => {
  let { store, marks } = await kept(3)
  let { updates } = await updatesOf(store, person, space)
  assertEquals(marks.get(TOLD), 'done')
  assertEquals(updates.map((u) => u.words).sort(), [
    'told 0',
    'told 1',
    'told 2',
  ])
})

test('a store kept nowhere owes no pass', async () => {
  let { g } = operatorMemory()
  assertEquals(await toldBackfill({ g }), false)
  await toldMoved({ g })
})
