/// <reference lib="deno.ns" />
// The feed: what one host hears of the commits another makes to the same
// store, journaled or not, and how long the store keeps them for it. Each case
// gets two hosts over a store of its own, built when the file loads, and
// times only the commits and the hearing.

import { clock, test } from '@yaks/testing'
import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import type { Bundle, News } from '@yaks/graph'
import { type Feed, feedDdl, feedOf, filled, follow, wrote } from './feed.ts'
import type { Row } from '@yaks/sql'
import { ddl } from './log.ts'
import {
  type Bound,
  type Each,
  feed,
  logFor,
  plugins,
  schema,
  TRIES,
} from './graph.ts'
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
  let follower = follow(w.f, opts)
  // What was heard, its values read from the graph as a host's feed reads them.
  let next = () => {
    let heard = sync(follower())
    let applied = sync(filled(heard.map((h) => h.wrote), w.read))
    return heard.map((h, i) => ({ seq: h.seq, applied: applied[i] }))
  }
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

// What another host committed is heard with its values as the graph holds
// them: the text a store keeps by its address as the text, and what the
// journal leaves out (`render`) beside what it keeps.
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

let later = hosts()
test('a follower reads what the graph holds now, not what was written then', () => {
  let p1 = { eid: 'p1' }
  sync(later.them.g.apply([
    { entity: p1, page: { title: 'first' }, render: { state: 'owed' } },
  ]))
  sync(later.them.g.apply([page('second')('p1')]))
  sync(later.them.g.apply([{ entity: p1, render: null }]))
  let title = { title: 'second' }
  let now: Bundle[][] = [
    [{ entity: p1, page: title, render: null }],
    [{ entity: p1, page: title }],
    [{ entity: p1, render: null }],
  ]
  assertEquals(heard(later.next), now)
})

let burst = hosts({ page: 2 })
test('a follower pages through a burst without losing any of it', () => {
  for (let i = 1; i <= 5; i++) sync(burst.them.g.apply([page('p')(`p${i}`)]))
  let eids = burst.next().map((h) => h.applied[0].entity.eid)
  assertEquals(eids, ['p1', 'p2', 'p3', 'p4', 'p5'])
})

let asyncDb = mem()
for (let statement of feedDdl()) asyncDb.query(statement)
let asyncFeed = feedOf({
  rows: (statement) => {
    if (statement.t == 'select') throw new Error('read on writer')
    return asyncDb.query(statement)
  },
  read: (statement) => Promise.resolve(asyncDb.query(statement)),
  host: 'reader',
})
let asyncWriter = feedOf({ rows: (statement) => asyncDb.query(statement) })

test('a feed writes on its transaction and reads on its supplied connection', async () => {
  let cursor = await asyncFeed.tip()
  asyncFeed.write(wrote([page('mine')('mine')]))
  asyncWriter.write(wrote([page('theirs')('theirs')]))
  assertEquals(await asyncFeed.since(cursor, 10), [
    { seq: cursor + 1 },
    {
      seq: cursor + 2,
      wrote: [{ entity: { eid: 'theirs' }, page: ['title'] }],
    },
  ])
})

test('an asynchronous follower waits for its tip and pages, and retries the failed cursor', async () => {
  let tip = Promise.withResolvers<number>()
  type Page = Awaited<ReturnType<Feed['since']>>
  let first = Promise.withResolvers<Page>()
  let calls: number[] = []
  let reads: (() => Promise<Page>)[] = [
    () => first.promise,
    () => Promise.reject(new Error('busy')),
    () => Promise.resolve([{ seq: 3, wrote: [{ entity: { eid: 'later' } }] }]),
  ]
  let source: Feed<Promise<Row[]>> = {
    host: 'reader',
    write: () => {},
    tip: () => tip.promise,
    since: (cursor) => {
      calls.push(cursor)
      return reads.shift()!()
    },
  }
  let next = follow(source, { page: 2 })
  let pending = next()
  assertEquals(calls, [])
  tip.resolve(0)
  await tip.promise
  first.resolve([
    { seq: 1 },
    { seq: 2, wrote: [{ entity: { eid: 'first' } }] },
  ])
  assertEquals(await pending, [{
    seq: 2,
    wrote: [{ entity: { eid: 'first' } }],
  }])
  assertEquals(calls, [0, 2])
  assertEquals(await next(), [{
    seq: 3,
    wrote: [{ entity: { eid: 'later' } }],
  }])
  assertEquals(calls, [0, 2, 2])
})

test('an asynchronous follower reports a read failure before any commit and tries again', async () => {
  let tries = 0
  let source: Feed<Promise<Row[]>> = {
    host: 'reader',
    write: () => {},
    tip: () => Promise.resolve(0),
    since: () =>
      ++tries == 1 ? Promise.reject(new Error('busy')) : Promise.resolve([]),
  }
  let next = follow(source)
  await assertRejects(next, Error, 'busy')
  assertEquals(await next(), [])
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

let older = clocked()
let mixed = follow(older.mine)
test('a row an older feed kept, values and all, is read for its names', () => {
  older.theirs.write([page('Hi')('p1')] as never)
  assertEquals(mixed()[0].wrote, [{ entity: { eid: 'p1' }, page: ['title'] }])
})

let aging = clocked()
let missed: number[] = []
let away = follow(aging.mine, { missed: (n) => missed.push(n) })
test('the feed keeps a commit for a while, and says what a follower missed', () => {
  let { clock, theirs } = aging
  let eids = () => away().map((h) => h.wrote[0].entity.eid)
  theirs.write(wrote([page('a')('p1')]))
  clock.t = 500
  theirs.write(wrote([page('b')('p2')]))
  clock.t = 2000
  theirs.write(wrote([page('c')('p3')]))
  assertEquals(eids(), ['p3'])
  assertEquals(missed, [2])
  clock.t = 5000
  theirs.write(wrote([page('d')('p4')]))
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

// A host's feed loop over a bare feed table another host writes, its consumer
// `each`, looking each time the test advances its clock. It has looked once
// already, so a case pays for no first read.
let looping = async (each: Each, reader?: Bound['reader']) => {
  let db = mem()
  for (let s of feedDdl()) db.query(s)
  let theirs = feedOf({ rows: (s) => db.query(s) })
  let time = clock()
  let told: unknown[] = []
  let host = {
    storage: { statements: statements(db), get: () => [] },
    reader,
    stopping: new AbortController().signal,
    report: (e: unknown) => void told.push(e),
  }
  feed(host, { every: 1, timer: (fn, ms) => time.after(ms, fn) })(each)
  await time.advance(1)
  let write = (eid: string) => theirs.write(wrote([page('p')(eid)]))
  return { write, told, look: (n = 1) => time.advance(n) }
}
let firsts = (news: News) => news.applied.map((tx) => tx[0].entity.eid)

let optionalNews: News[] = []
let optionalReader = await looping((news) => void optionalNews.push(news), {})
test('a custom reader without SQL or raw storage uses the host feed connection', async () => {
  optionalReader.write('fallback')
  await optionalReader.look()
  assertEquals(optionalNews.map(firsts), [['fallback']])
})

let threaded = (() => {
  let db = mem()
  for (let statement of feedDdl()) db.query(statement)
  let theirs = feedOf({ rows: (statement) => db.query(statement) })
  let time = clock()
  let news: News[] = []
  let host = {
    storage: {
      statements: {
        ...statements(db),
        query: (statement: Parameters<typeof db.query>[0]) => {
          if (statement.t == 'select') throw new Error('read on writer')
          return db.query(statement)
        },
      },
      get: () => {
        throw new Error('get on writer')
      },
    },
    reader: {
      statements: {
        query: (s: Parameters<typeof db.query>[0]) =>
          Promise.resolve(db.query(s)),
      },
      storage: {
        get: (eids: string[]) => Promise.resolve(eids.map(page('remote'))),
      },
      answering: () => false,
    },
    stopping: new AbortController().signal,
    report: (error: unknown) => {
      throw error
    },
  }
  let start = () =>
    feed(host, { every: 1, timer: (fn, ms) => time.after(ms, fn) })(
      (heard) => void news.push(heard),
    )
  return { theirs, time, news, start }
})()

test('a host follows and fills through its reader from the first read', async () => {
  threaded.start()
  threaded.theirs.write(wrote([page('theirs')('remote')]))
  await threaded.time.advance(1)
  assertEquals(threaded.news, [{
    applied: [[{ entity: { eid: 'remote' }, page: { title: 'remote' } }]],
    missed: false,
  }])
})

let gate = Promise.withResolvers<void>()
let handed = Promise.withResolvers<void>()
let slow: News[] = []
let busy = await looping(async (news) => {
  slow.push(news)
  if (slow.length > 1) return
  handed.resolve()
  await gate.promise
})
test('a busy consumer is handed what was heard meanwhile in one call', async () => {
  busy.write('p1')
  let first = busy.look()
  await handed.promise
  for (let eid of ['p2', 'p3', 'p4']) busy.write(eid)
  await busy.look()
  gate.resolve()
  await first
  assertEquals(slow.map(firsts), [['p1'], ['p2', 'p3', 'p4']])
})

let failing: News[] = []
let refusing = await looping((news) => {
  failing.push(news)
  if (failing.length <= TRIES) throw new Error('busy')
})
test('news passed over after failing tells the consumer it missed some', async () => {
  refusing.write('p1')
  await refusing.look(TRIES)
  assertEquals(failing.slice(0, TRIES).map(firsts), Array(TRIES).fill(['p1']))
  assertEquals(failing.slice(TRIES).map((n) => n.missed), [true])
  assertEquals(refusing.told.length, 1)
})
