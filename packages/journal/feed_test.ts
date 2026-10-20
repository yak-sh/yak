/// <reference lib="deno.ns" />
// The feed: what one host hears of the commits another makes to the same
// store, journaled or not, and how long the store keeps them for it. Each case
// gets two hosts over a store of its own, built when the file loads, and
// times only the commits and the hearing.

import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { feedDdl, feedOf, follow } from './feed.ts'
import { ddl } from './log.ts'
import { logFor, plugins, schema } from './graph.ts'
import { mem } from '../sqlite/testing.ts'
import { add, statements } from '@yaks/sqlite'
import { sync, wiki, wikiLog } from './testing.ts'

// Two hosts over one database: this one, following the feed, and another
// writing to it — a `yak` command beside `yak serve`, say. Both have written
// what the cases write once, so a case pays for no first write.
let hosts = (opts: { page?: number } = {}) => {
  let w = wikiLog()
  let g = w.g()
  let them = w.other()
  for (let host of [g, them.g]) {
    sync(host.apply([
      { entity: { eid: 'w1' }, page: { title: 'warm', text: 'warm' } },
      { entity: { eid: 'w2' }, render: { state: 'warm' } },
    ]))
  }
  let next = follow(w.f, opts)
  return { g, j: w.j, them, next }
}
let page = (title: string) => (eid: string): Bundle => ({
  entity: { eid },
  page: { title },
})
// What was heard, without the number and the stamps every commit carries.
let heard = (next: () => { applied: Bundle[] }[]) =>
  next().map((h) =>
    h.applied.map(({ entity, created: _c, updated: _u, ...rest }) => ({
      entity: { eid: entity.eid },
      ...rest,
    }))
  )

// What another host committed is heard whole: the text a store keeps by its
// address as the text, and what the journal leaves out (`render`) beside what
// it keeps.
let own = hosts()
test('a follower hears what another host committed, and not its own', () => {
  sync(own.g.apply([page('mine')('p1')]))
  let theirs = [
    { entity: { eid: 'p2' }, page: { title: 'theirs', text: 'a long body' } },
    { entity: { eid: 'r1' }, render: { state: 'owed' } },
  ]
  sync(own.them.g.apply(theirs))
  assertEquals(heard(own.next), [theirs])
  assertEquals(own.next(), [])
})

let doomed = hosts()
sync(doomed.g.apply([
  page('Kickoff')('p1'),
  { entity: { eid: 'n1' }, note: { text: 'aside', page: 'p1' } },
]))
doomed.next()
test('a follower hears a deletion as the patches that made it', () => {
  sync(doomed.them.g.apply([{ entity: { eid: 'p1' }, $delete: true }]))
  let [{ applied }] = doomed.next()
  assertEquals(applied.filter((b) => b.$delete).map((b) => b.entity.eid), [
    'p1',
    'n1',
  ])
})

let burst = hosts({ page: 2 })
test('a follower pages through a burst without losing any of it', () => {
  for (let i = 1; i <= 5; i++) sync(burst.them.g.apply([page('p')(`p${i}`)]))
  let eids = burst.next().map((h) => h.applied[0].entity.eid)
  assertEquals(eids, ['p1', 'p2', 'p3', 'p4', 'p5'])
})

// Two feeds over a bare table, on a clock of their own.
let clocked = () => {
  let db = mem()
  for (let s of feedDdl()) db.query(s)
  let clock = { t: 0 }
  let o = {
    rows: (s: Parameters<typeof db.query>[0]) => db.query(s),
    keep: 1000,
    now: () => clock.t,
  }
  return { clock, mine: feedOf(o), theirs: feedOf(o) }
}

let binary = clocked()
let reading = follow(binary.mine)
test('bytes cross the feed whole', () => {
  let bytes = new Uint8Array([19, 0, 255, 128])
  binary.theirs.write([{ entity: { eid: 'd1' }, doc: { bytes } }])
  assertEquals(reading()[0].applied, [{
    entity: { eid: 'd1' },
    doc: { bytes },
  }])
})

let aging = clocked()
let missed: number[] = []
let away = follow(aging.mine, { missed: (n) => missed.push(n) })
test('the feed keeps a commit for a while, and says what a follower missed', () => {
  let { clock, theirs } = aging
  let eids = () => away().map((h) => h.applied[0].entity.eid)
  theirs.write([page('a')('p1')])
  clock.t = 500
  theirs.write([page('b')('p2')])
  clock.t = 2000
  theirs.write([page('c')('p3')])
  assertEquals(eids(), ['p3'])
  assertEquals(missed, [2])
  clock.t = 5000
  theirs.write([page('d')('p4')])
  assertEquals(eids(), ['p4'])
  assertEquals(missed, [2])
})

test('a store an older journal made takes the host once it is opened again', () => {
  let db = mem()
  let old = ddl().map((s) =>
    s.t == 'create table' && s.name == 'journal_tx'
      ? { ...s, cols: s.cols.filter((c) => c.name != 'host') }
      : s
  )
  for (let s of old) db.query(s)
  let columns = () =>
    db.query({ t: 'pragma', name: 'table_info', arg: 'journal_tx' })
      .map((c) => String(c.name))
  assertEquals(columns().includes('host'), false)
  add(db, schema())
  let host = { storage: { statements: statements(db) } }
  plugins({ ...host, vocab: wiki })
  assertEquals(columns().includes('host'), true)
})

test('a journal requires storage that offers statements', () => {
  let host = { storage: {} }
  assertThrows(
    () => logFor(host),
    Error,
    'this storage offers no SQL statements',
  )
})
