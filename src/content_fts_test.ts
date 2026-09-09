// Transcript prose is a first-class text source, not a doc with a fake title.
// Exercise storage, query compilation and the hydrated /query answer together.
import { assert, assertEquals, assertThrows } from '@std/assert'
import {
  apply,
  contentFtsPending,
  fillContentFts,
  migrate,
  search,
  textMatches,
} from './db.ts'
import { append } from './entries.ts'
import { evalGraph, evalSub } from './graph_query.ts'
import { parseQuery } from './query.ts'
import { freshDb } from './testdb.ts'
import { connect, open } from './store/sqlite.ts'
import { uuid } from './types.ts'

let indexes = ['content_fts', 'content_gram']
let world = () => {
  let db = freshDb(), session = uuid()
  apply(db, [{ eid: session, name: 'session', comp: { id: uuid() } }])
  return { db, session }
}
let drop = (db: ReturnType<typeof freshDb>) => {
  for (let t of indexes) {
    db.exec(`drop trigger ${t}_ai; drop trigger ${t}_ad;
      drop trigger ${t}_au; drop table ${t};`)
  }
}
let complete = (db: ReturnType<typeof freshDb>) => {
  let slices = 0
  while (fillContentFts(db, 1)) assert(++slices < 100)
  for (let t of indexes) {
    db.exec(`insert into ${t} (${t}, rank) values ('integrity-check', 1)`)
  }
}

Deno.test('content FTS: entry identity, snippets, filters, edits and deletion', () => {
  let { db, session } = world()
  let { eids: [eid] } = append(db, session, [{
    message: { role: 'user' },
    content: { body: 'A transcript xylowidget café under_score 100% sure.' },
  }])
  let doc = uuid()
  apply(db, [{ eid: doc, name: 'doc', comp: { title: 'xylowidget' } }])
  assertEquals(
    new Set(search(db, 'xylowidget').map((h) => h.eid)),
    new Set([doc, eid]),
  )
  let [hit] = search(db, 'xylowidget .message.role=user')
  assertEquals(hit.eid, eid)
  assertEquals(hit.open, eid)
  assertEquals(hit.kind, 'entry')
  assert(hit.snip.includes('\x01xylowidget\x02'))
  assertEquals(search(db, 'xylowid').length, 0) // not implicit prefix or substring
  assertEquals(search(db, 'xylowid* .entry!')[0]?.eid, eid)
  assertEquals(textMatches(db, eid, parseQuery('cafe')[0]), true)
  assertEquals(search(db, '.content.body~=lowid')[0]?.eid, eid)
  let row = evalGraph(db, 'xylowidget .entry!').hits[0]
  assertEquals(row.eid, eid)
  assertEquals(row.comps.entry.session, session)
  assertEquals(row.comps.entry.seq, 1)
  assert(String(row.comps.rank.snip).includes('\x01xylowidget\x02'))
  assertEquals(
    new Set(evalSub(db, 'xylowidget').hits.map((h) => h.eid)),
    new Set([doc, eid]),
  )
  for (let needle of ['lowid', 'under_score', '100%']) {
    assertEquals(
      evalGraph(db, `.content.body~=${needle}`).hits.map((h) => h.eid),
      [eid],
    )
  }
  // An entity with BOTH text sources is still one ranked hit.
  apply(db, [{ eid, name: 'doc', comp: { title: 'xylowidget' } }])
  assertEquals(search(db, 'xylowidget .entry!').length, 1)
  apply(db, [{ eid, name: 'doc', comp: null }])
  db.prepare(
    'update content set body = ? where entity = (select id from entity where eid = ?)',
  )
    .run('replacement quincunx', eid)
  assertEquals(search(db, 'xylowidget .entry!'), [])
  assertEquals(search(db, 'quincunx')[0]?.eid, eid)
  db.prepare(
    'delete from content where entity = (select id from entity where eid = ?)',
  ).run(eid)
  assertEquals(search(db, 'quincunx'), [])
  complete(db)
})

Deno.test('content FTS: additive boot defers build, resumes and tolerates concurrent writes', () => {
  let { db, session } = world()
  let { eids } = append(
    db,
    session,
    ['firstproof', 'oldproof', 'deadproof'].map((body) => ({
      content: { body },
    })),
  )
  drop(db) // a pre-index database, with real historical content
  migrate(db)
  assert(contentFtsPending(db))
  for (let t of indexes) {
    assertEquals(db.prepare(`select count(*) as n from ${t}_docsize`).get(), {
      n: 0,
    })
  }
  assert(fillContentFts(db, 1))
  assertEquals(search(db, 'firstproof')[0]?.eid, eids[0])
  db.prepare(
    'update content set body = ? where entity = (select id from entity where eid = ?)',
  )
    .run('newproof', eids[1]) // old row not yet indexed: no invalid FTS delete
  db.prepare(
    'delete from content where entity = (select id from entity where eid = ?)',
  ).run(eids[2])
  let { eids: [live] } = append(db, session, [{
    content: { body: 'liveproof' },
  }])
  assertEquals(search(db, 'liveproof')[0]?.eid, live) // not waiting on backfill
  migrate(db) // another opener must not reset the durable cursor
  complete(db)
  assertEquals(search(db, 'oldproof'), [])
  assertEquals(search(db, 'deadproof'), [])
  assertEquals(search(db, 'newproof')[0]?.eid, eids[1])
  assert(!contentFtsPending(db))
})

Deno.test('content FTS: boot integrity and actual index counts schedule healing', () => {
  let { db, session } = world()
  append(db, session, [{ content: { body: 'beforeproof' } }])
  db.exec('drop trigger content_fts_au; drop trigger content_gram_au;')
  db.exec("update content set body = 'afterproof'")
  assertThrows(() =>
    db.exec(
      "insert into content_fts (content_fts, rank) values ('integrity-check', 1)",
    )
  )
  db.exec("delete from server_meta where k = 'fts_check'")
  migrate(db)
  assert(contentFtsPending(db))
  complete(db)
  assertEquals(search(db, 'afterproof').length, 1)
  assertEquals(search(db, 'beforeproof'), [])
  // count(*) on an external-content table would miss this completely.
  db.exec("insert into content_gram (content_gram) values ('delete-all')")
  db.exec(
    "insert or replace into server_meta (k, v) values ('fts_check', '2999-01-01')",
  )
  migrate(db)
  assert(contentFtsPending(db))
  complete(db)
  assertEquals(evalGraph(db, '.content.body~=terproof').hits.length, 1)
})

Deno.test('content FTS: substring candidates precede the 5000-entry scan cap', () => {
  let { db, session } = world()
  let { eids: [old] } = append(db, session, [{
    content: { body: 'oldest uniquewidget proof' },
  }])
  // More recent entries would consume the entire old JS fallback budget.
  let owner = db.prepare('select id from entity where eid = ?').get(
    session,
  ) as { id: number }
  db.transaction(() => {
    for (let i = 2; i <= 5002; i++) {
      db.prepare('insert into entity (eid) values (?)').run(uuid())
      db.prepare('insert into entry (entity, session, seq) values (?, ?, ?)')
        .run(db.lastInsertRowId, owner.id, i)
    }
  })
  assertEquals(evalGraph(db, '.content.body~=iquewid').hits.map((h) => h.eid), [
    old,
  ])
  assertEquals(evalGraph(db, 'uniquewidget').hits.map((h) => h.eid), [old])
})

Deno.test('content FTS: open starts the off-thread backfill on a file', async () => {
  let dir = Deno.makeTempDirSync(), path = `${dir}/graph.db`
  let db = open(path)
  try {
    let session = uuid()
    apply(db, [{ eid: session, name: 'session', comp: { id: uuid() } }])
    append(db, session, [{ content: { body: 'workerproof' } }])
    drop(db)
    db.close()
    db = open(path)
    assert(contentFtsPending(db)) // open returned before any worker slice
    let deadline = Date.now() + 10_000
    while (contentFtsPending(db) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    assert(!contentFtsPending(db))
    assertEquals(search(db, 'workerproof').length, 1)
    // Let the worker's completion message close its handle before teardown.
    await new Promise((resolve) => setTimeout(resolve, 50))
    db.close()
    db = connect(path)
    complete(db)
  } finally {
    db.close()
    Deno.removeSync(dir, { recursive: true })
  }
})
