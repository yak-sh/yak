// The colon-command executor reads the graph two ways: over a materialized
// Row[] (the browser cache, a test) and over a SCOPED db reader (the server
// doors, off snapshot — M-21143). This holds the two answers EQUAL for the
// representative verbs — id resolution, a cascade delete, the repo/desk
// enumerations, a comment-minting cancel, a spec-line fix — so the db-backed
// path a hot door now runs can never silently diverge from the rows-fed path
// the tests already trusted. Minted uuids differ per path (fresh eids), so both
// answers are normalized positionally before the compare; a seeded entity emits
// the same uuid on both paths and lands on the same placeholder either way.
import { assertEquals } from '@std/assert'
import { uuid } from './types.ts'
import { commandOut } from './commands.ts'
import { slow } from './testing.ts'

Deno.env.set('DB_PATH', ':memory:')
let { apply, snapshot } = await import('./db.ts')
let { freshDb } = await import('./testdb.ts')
let { rows } = await import('./client.ts')
let { dbReader } = await import('./graph_query.ts')

let world = () => {
  let db = freshDb()
  let P = uuid(), R = uuid(), T = uuid(), S = uuid(), C = uuid()
  let desk = uuid(), scribe = uuid()
  apply(db, [
    { eid: P, name: 'doc', comp: { title: 'Home', body: '' } },
    { eid: P, name: 'project', comp: {} },
    { eid: P, name: 'alias', comp: { slug: 'home' } },
    { eid: R, name: 'doc', comp: { title: 'Repo', body: '' } },
    { eid: R, name: 'project', comp: {} },
    { eid: R, name: 'repo', comp: { path: '/tmp/repo' } },
    { eid: T, name: 'doc', comp: { title: 'A task', body: '' } },
    { eid: T, name: 'task', comp: { project: P } },
    { eid: S, name: 'session', comp: { id: 'sess-1' } },
    // a comment aimed at T — the collateral a cascade delete of T takes
    { eid: C, name: 'doc', comp: { title: '', body: 'a note' } },
    { eid: C, name: 'comment', comp: { target: T } },
    // the scribe desk + its persona, both addressed by alias (DESK)
    { eid: desk, name: 'doc', comp: { title: 'Scribe desk', body: '' } },
    { eid: desk, name: 'task', comp: {} },
    { eid: desk, name: 'alias', comp: { slug: 'scribe-desk' } },
    { eid: scribe, name: 'doc', comp: { title: 'Scribe', body: '' } },
    { eid: scribe, name: 'persona', comp: {} },
    { eid: scribe, name: 'alias', comp: { slug: 'scribe' } },
  ])
  return { db, P, R, T, S }
}

// Replace each distinct uuid with a positional placeholder in first-seen order
// — the only difference between the two paths is the freshly minted eids, and
// both mint them in the same order, so this aligns them without hiding a real
// divergence.
let UUID_G = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
let norm = (r: unknown) => {
  let map = new Map<string, string>()
  return JSON.stringify(r).replace(UUID_G, (u) => {
    let k = u.toLowerCase()
    if (!map.has(k)) map.set(k, `#${map.size}`)
    return map.get(k)!
  })
}

// The two readings of one line over one graph must agree.
let same = (
  db: ReturnType<typeof freshDb>,
  line: string,
  eid?: string,
  session?: string,
) => {
  let overRows = commandOut(rows(snapshot(db)), line, eid, session)
  let overDb = commandOut([], line, eid, session, dbReader(db))
  assertEquals(norm(overDb), norm(overRows), line)
  return overDb
}

slow('db reader == rows: id resolution (:set derefs an alias)', () => {
  let { db, T, P } = world()
  let out = same(db, ':set .project=home', T, 'sess-1')
  assertEquals(out.changes, [{ eid: T, name: 'task', comp: { project: P } }])
})

slow('db reader == rows: :open navigates to a resolved id', () => {
  let { db, T } = world()
  let out = same(db, `:open ${T}`, undefined, 'sess-1')
  assertEquals(out.go, T)
})

slow('db reader == rows: cascade delete names the same collateral', () => {
  let { db, T } = world()
  let out = same(db, `:delete ${T} --cascade`, undefined, 'sess-1')
  assertEquals(out.changes, [{ eid: T, name: 'entity', comp: null }])
  // the comment aimed at T is the dependent both readings must have found
  assertEquals(/\+1 dependent/.test(out.msg ?? ''), true)
})

slow('db reader == rows: :delete without --cascade refuses identically', () => {
  let { db, T } = world()
  // both paths must throw the same "would also delete" refusal
  let a = (() => {
    try {
      commandOut(rows(snapshot(db)), `:delete ${T}`, undefined, 'sess-1')
    } catch (e) {
      return (e as Error).message
    }
  })()
  let b = (() => {
    try {
      commandOut([], `:delete ${T}`, undefined, 'sess-1', dbReader(db))
    } catch (e) {
      return (e as Error).message
    }
  })()
  assertEquals(b, a)
  assertEquals(/would also delete 1 dependent/.test(a ?? ''), true)
})

slow('db reader == rows: :cancel mints the same comment batch', () => {
  let { db, T } = world()
  same(db, ':cancel changed my mind', T, 'sess-1')
})

slow('db reader == rows: :fix spec-line files + enumerates repos', () => {
  let { db } = world()
  same(db, ':fix Build the thing', undefined, 'sess-1')
})

slow('db reader == rows: :scribe reads the desk + busy enumeration', () => {
  let { db, S } = world()
  same(db, `:scribe ${S}`, undefined, 'sess-1')
})

slow('db reader == rows: a bad reference refuses with one message', () => {
  let { db, T } = world()
  let msg = (fn: () => void) => {
    try {
      fn()
    } catch (e) {
      return (e as Error).message
    }
  }
  let a = msg(() =>
    commandOut(rows(snapshot(db)), ':set .project=nope', T, 'sess-1')
  )
  let b = msg(() =>
    commandOut([], ':set .project=nope', T, 'sess-1', dbReader(db))
  )
  assertEquals(b, a)
  assertEquals(/no entity: nope \(\.project\)/.test(a ?? ''), true)
})
