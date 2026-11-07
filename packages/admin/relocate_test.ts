import { test } from '@yaks/testing'
import { assertEquals, assertMatch } from '@std/assert'
import { relocate, renamed } from './relocate.ts'

// A platform of stores, each standing where `at` says; each new object stands
// where the next of `lands` says (the last one again once they run out), and
// the hand-off keeps what `keeps` leaves.
let run = async (o: {
  at: Record<string, string>
  lands?: string[]
  keeps?: (eids: string[]) => string[]
  move?: boolean
}) => {
  let at = { ...o.at }
  let lands = [...o.lands ?? ['IAD']]
  let handed = new Set<string>()
  let prepared: string[] = []
  let said: string[] = []
  let summary = await relocate({
    stores: Object.keys(o.at).map((s) => ({ store: s, at: s })),
    standing: (store) =>
      Promise.resolve(
        at[store] ??= lands.length > 1 ? lands.shift()! : lands[0],
      ),
    eids: (where) =>
      Promise.resolve(
        handed.has(where) ? (o.keeps ?? ((e) => e))(['a', 'b']) : ['a', 'b'],
      ),
    prepare: (_store, to) => (prepared.push(at[to]), Promise.resolve()),
    hand: (store) => (handed.add(store), Promise.resolve()),
    move: o.move ?? true,
    out: (line) => said.push(line.replace(/\.[0-9a-f]{6}/, '.new')),
    stopping: new AbortController().signal,
  })
  return { said, summary, prepared, handed: [...handed] }
}

test('a far app store moves beside the kernel; near ones and others stay', async () => {
  let r = await run({
    at: { 'ada/notes': 'LHR', 'ada/trip': 'ORD', 'ada/notes sample': 'MXP' },
  })
  assertEquals(r.said, [
    'ada/notes  LHR → IAD as ada/notes.new, 2 entities',
    'ada/trip  ORD',
    'ada/notes sample  MXP, far',
  ])
  assertEquals(r.summary, [
    '3 stores, 2 far: ada/notes, ada/notes sample',
    '1 moved',
  ])
})

test('without --move a far store is only said', async () => {
  let r = await run({ at: { 'ada/notes': 'SJC' }, move: false })
  assertEquals([r.said, r.handed], [['ada/notes  SJC, far'], []])
})

test('a store elsewhere in eastern North America is far from the kernel', async () => {
  let r = await run({ at: { 'ada/notes': 'MIA', 'ada/trip': 'IAD' } })
  assertEquals(r.handed, ['ada/notes'])
})

test('a new object that stands far is passed over for another name', async () => {
  let r = await run({ at: { 'ada/notes': 'MIA' }, lands: ['EWR', 'ORD'] })
  assertEquals([r.prepared, r.handed], [['ORD'], ['ada/notes']])
})

test('a store no new object stands near is never copied or handed on', async () => {
  let r = await run({ at: { 'ada/notes': 'SJC' }, lands: ['LHR'] })
  assertEquals([r.prepared, r.handed], [[], []])
  assertEquals(r.summary.at(-1), '1 failed: ada/notes')
})

test('an entity missing after a move stops the sweep', async () => {
  let r = await run({
    at: { 'ada/notes': 'SJC', 'bo/list': 'LHR' },
    keeps: (e) => e.slice(1),
  })
  assertEquals(r.said, [
    'ada/notes  moved to ada/notes.new, and 1 entities are gone',
  ])
})

test('a new name keeps the store legible and swaps its key', () => {
  assertEquals(renamed('ada/notes.e400c1', 'abc123'), 'ada/notes.abc123')
  assertEquals(renamed('ada/notes', 'abc123'), 'ada/notes.abc123')
  assertMatch(renamed('ada/notes'), /^ada\/notes\.[0-9a-f]{6}$/)
})
