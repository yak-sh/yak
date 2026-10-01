// The store mover (mover.ts) through a Store's own doors: rows moved from the
// alarm after boot, a rehearsal that moves nothing, and a failing batch that
// leaves the store serving until fixed code arrives.
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { doorOf } from './door.ts'
import { Store } from './graph.ts'
import { KERNEL, metaOf } from './meta.ts'
import type { Rehearsal, Rule, Standing } from './mover.ts'
import { state } from './testing.ts'

let NAME = 'ada/notes'

// An app whose rows say a word two ways, the way a rename leaves them.
let WORDS = JSON.stringify({
  $defs: {
    was: { properties: { word: { type: 'string' } } },
    now: { properties: { word: { type: 'string' } } },
  },
})

let rule = (o: Partial<Rule> = {}): Rule => ({
  mark: 'yak/store/now/1',
  find: '.was',
  move: (row) => [{
    entity: row.entity,
    was: null,
    now: { word: (row.was as { word: string }).word },
  }],
  live: 'apps',
  ...o,
})

// One app store holding `n` rows in the old shape, and the doors onto it.
let store = async (n: number, ...rules: Rule[]) => {
  let ctx = state()
  let o = new Store(ctx, {}, rules)
  let fetch = (r: Request) => o.fetch(r)
  let door = doorOf(fetch, NAME)
  let meta = metaOf(door)
  let post = async (path: string, body?: string) =>
    await (await door(path, { method: 'POST', body }, KERNEL)).json()
  await post('/vocab', WORDS)
  let rows = Array.from({ length: n }, (_, i) => ({
    entity: { eid: crypto.randomUUID() },
    was: { word: `w${i}` },
  }))
  for (let i = 0; i < n; i += 100) {
    await meta.apply(rows.slice(i, i + 100) as Bundle[], KERNEL)
  }
  return {
    wake: (...rules: Rule[]) => o = new Store(ctx, {}, rules),
    alarm: () => o.alarm(),
    query: (q: string) => meta.query(q),
    moves: async () => (await post('/move')).rules as Standing[],
    held: async () => (await post('/move')).alarm as string | null,
    rehearse: async () => (await post('/move?rehearse=1')).rules as Rehearsal[],
  }
}

let count = async (s: { query: (q: string) => Promise<Bundle[]> }, q: string) =>
  (await s.query(q)).length

test('a live rule moves every row from the alarm, and says it is done', async () => {
  let s = await store(250, rule())
  // Woken, a store owing rows says the alarm it will move them from.
  assert(Date.parse(String(await s.held())) <= Date.now())
  let [first] = await s.query('.was')
  for (let i = 0; i < 5 && (await s.moves())[0]?.done == null; i++) {
    await s.alarm()
  }
  let [said] = await s.moves()
  assertEquals([said.moved, !!said.done], [250, true])
  assertEquals(await count(s, '.was'), 0)
  assertEquals(await count(s, '.now'), 250)
  let [moved] = await s.query(`.eid=${first.entity.eid}&.now`)
  assertEquals(moved.now, first.was)
})

test('a rehearsal says what a rule would move, and moves nothing', async () => {
  let s = await store(250, rule({ live: undefined }))
  let [r] = await s.rehearse()
  assertEquals([r.rows, r.moved, r.failed], [250, 250, undefined])
  await s.alarm()
  assertEquals(await count(s, '.was'), 250)
  let [said] = await s.moves()
  assertEquals([said.live, said.done], [false, undefined])
})

test('a failing batch unwinds, the store serves, and a fix finishes it', async () => {
  let broken = rule({
    move: (row) => {
      if ((row.was as { word: string }).word == 'w3') throw new Error('no')
      return rule().move(row)
    },
  })
  let s = await store(5, broken)
  assertEquals((await s.rehearse())[0].failed, 'no')
  await s.alarm()
  assertEquals((await s.moves())[0].failed, 'no')
  assertEquals(await count(s, '.was'), 5)
  s.wake(rule())
  await s.alarm()
  assertEquals(await count(s, '.now'), 5)
  assert((await s.moves())[0].done)
})

test('a rule reading words a store does not speak is done there', async () => {
  let s = await store(1, rule({ find: '.nowhere' }))
  assertEquals((await s.rehearse())[0].unspoken, 'nowhere')
  await s.alarm()
  let [said] = await s.moves()
  assertEquals([said.unspoken, said.moved, !!said.done], ['nowhere', 0, true])
})
