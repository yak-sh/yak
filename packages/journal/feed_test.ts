/// <reference lib="deno.ns" />
// The feed: a cursor that only moves forward, pages that never overlap, and a
// batch that rebuilds into the bundles it committed — the two things a server
// does with the journal (recast to subscribers, drive effects at most once).

import { assertEquals } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { applied } from './undo.ts'
import { follow } from './feed.ts'
import { ddl, grown } from './log.ts'
import { rules } from './rules.ts'
import { mem } from '../sqlite/testing.ts'
import { sync, wikiGraph, wikiLog } from './testing.ts'

let fixture = (n: number) => {
  let { g, j } = wikiGraph()
  for (let i = 1; i <= n; i++) {
    sync(g.apply([{ entity: { eid: `p${i}` }, page: { title: `page ${i}` } }]))
  }
  return { g, j }
}

Deno.test('the feed hands out the batches after a cursor, in order', () => {
  let f = fixture(5)
  assertEquals(f.j.since(0).map((e) => e.seq), [1, 2, 3, 4, 5])
  assertEquals(f.j.since(3).map((e) => e.seq), [4, 5])
})

Deno.test('an exhausted feed is empty, and the tip is the cursor', () => {
  let f = fixture(2)
  assertEquals(f.j.tip(), 2)
  assertEquals(f.j.since(2), [])
})

Deno.test('a batch carries only its own operations', () => {
  let f = fixture(3)
  let [second] = f.j.since(1)
  assertEquals(second.seq, 2)
  assertEquals(second.patches.map((p) => p.target), ['p2'])
})

Deno.test('a batch from the feed recasts as the bundles it committed', () => {
  let { g, j } = wikiGraph()
  let change: Bundle[] = [
    { entity: { eid: 'p1' }, page: { title: 'Kickoff' } },
    { entity: { eid: 'n1' }, note: { text: 'aside', page: 'p1' } },
  ]
  sync(g.apply(change))
  assertEquals(j.since(0).map((e) => applied(j.at(e.seq)!)), [change])
})

Deno.test('a feed drains what was committed while it was away', () => {
  let f = fixture(2)
  let cursor = f.j.since(0).at(-1)!.seq
  sync(f.g.apply([{ entity: { eid: 'p9' }, page: { title: 'late' } }]))
  assertEquals(f.j.since(cursor).map((e) => e.seq), [3])
})

// Two hosts over one database: this one, following the feed, and another
// writing to it — a `yak` command beside `yak serve`, say.
let hosts = () => {
  let w = wikiLog()
  return { g: w.g(), j: w.j, them: w.other() }
}
let page = (title: string) => (eid: string): Bundle => ({
  entity: { eid },
  page: { title },
})

Deno.test('a follower hears what another host committed, and not its own', () => {
  let { g, j, them } = hosts()
  sync(g.apply([page('before')('p0')]))
  let next = follow(j)
  sync(g.apply([page('mine')('p1')]))
  sync(them.g.apply([page('theirs')('p2')]))
  assertEquals(next().map((h) => h.applied), [[page('theirs')('p2')]])
  assertEquals(next(), [])
})

Deno.test('a follower hears a deletion as the patches that made it', () => {
  let { g, j, them } = hosts()
  sync(g.apply([
    page('Kickoff')('p1'),
    { entity: { eid: 'n1' }, note: { text: 'aside', page: 'p1' } },
  ]))
  let next = follow(j)
  sync(them.g.apply([{ entity: { eid: 'p1' }, $delete: true }]))
  let [{ applied: heard }] = next()
  assertEquals(heard.filter((b) => b.$delete).map((b) => b.entity.eid).sort(), [
    'n1',
    'p1',
  ])
})

Deno.test('a follower pages through a burst without losing any of it', () => {
  let { j, them } = hosts()
  let next = follow(j, { page: 2 })
  for (let i = 1; i <= 5; i++) sync(them.g.apply([page('p')(`p${i}`)]))
  let eids = next().map((h) => h.applied[0].entity.eid)
  assertEquals(eids, ['p1', 'p2', 'p3', 'p4', 'p5'])
})

Deno.test('a store an older journal made takes the host once it is opened again', () => {
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
  assertEquals(grown(columns()).length, 1)
  rules({ sql: db })
  assertEquals(grown(columns()), [])
})
