// Projections as grammar (T-22618, D-22567 §3): a subscription DECLARES the
// columns it reads, the server answers only those, and a delta ships only when
// a projected column — or membership — moves. The offender this exists for is
// the `.session!` chrome sub, which unprojected put 6.22 MB of every session's
// whole history on the wire so a strip of coloured dots could paint.
//
// Three seams, proven where each lives: the cut itself (subs.ts `projected`,
// pure), the sub answering through it (subserve over an in-memory graph, no
// socket — the same door server.ts and wsworker.ts both wire), and the client's
// column-level honesty (live.ts `loaded`, in live_test.ts beside the rest of
// landSub).
import { assertEquals, assertStringIncludes } from '@std/assert'
import { fieldsOf, parseQuery, PROJECT } from './query.ts'
import { projected } from './subs.ts'
import { select, where } from './sql.ts'
import type { Change } from './types.ts'
import { uuid } from './types.ts'
import { addSource, clearSources } from './source.ts'

Deno.env.set('DB_PATH', ':memory:')
let { apply } = await import('./db.ts')
let { open } = await import('./store/sqlite.ts')
let { subserve } = await import('./subserve.ts')
let { bareDb } = await import('./testdb.ts')

let fields = (line: string) => fieldsOf(parseQuery(line))!

// ── the cut ────────────────────────────────────────────────────────────────

Deno.test('projected: keeps the named columns, drops the rest', () => {
  let cut = projected(fields('.fields=session.status,doc.title'))
  assertEquals(
    cut([{
      eid: 'e1',
      name: 'session',
      comp: { status: 'running', final_text: 'a novel', cwd: '/tmp' },
    }]),
    [{ eid: 'e1', name: 'session', comp: { status: 'running' } }],
  )
})

Deno.test('projected: the spine always rides, whatever the projection', () => {
  let cut = projected(fields('.fields=session.status'))
  let spine: Change[] = [{
    eid: 'e1',
    name: 'entity',
    comp: { eid: 'e1', num: 7 },
  }]
  // eid + num are the row's IDENTITY, not a column — a client that cannot name
  // a row cannot render one.
  assertEquals(cut(spine), spine)
  assertEquals(projected([])(spine), spine)
})

Deno.test('projected: an unnamed component says nothing at all', () => {
  let cut = projected(fields('.fields=session.status'))
  assertEquals(cut([{ eid: 'e1', name: 'brief', comp: { text: 'hi' } }]), [])
})

Deno.test('projected: a patch touching no projected column projects to nothing', () => {
  let cut = projected(fields('.fields=session.status'))
  // This is the whole point — a projected sub pays ZERO traffic for a column it
  // does not read, and subserve never sends an empty frame.
  assertEquals(cut([{ eid: 'e1', name: 'session', comp: { cwd: '/tmp' } }]), [])
})

Deno.test('projected: a deletion is membership news, never column news', () => {
  let cut = projected(fields('.fields=session.status'))
  let deaths: Change[] = [
    { eid: 'e1', name: 'entity', comp: null },
    { eid: 'e1', name: 'brief', comp: null },
  ]
  // Cutting either would strand a row the client must drop.
  assertEquals(cut(deaths), deaths)
})

Deno.test('projected: a precondition survives the cut', () => {
  // M-17876: every hop SPREADS a change. If `was` were lost here the guard
  // would stop guarding while the caller still believed it was protected.
  let c = {
    eid: 'e1',
    name: 'session',
    comp: { status: 'running', cwd: '/tmp' },
    was: { status: 'abc123' },
  } as Change
  assertEquals(projected(fields('.fields=session.status'))([c])[0].was, {
    status: 'abc123',
  })
})

// ── the grammar ────────────────────────────────────────────────────────────

Deno.test('.fields=eid is the eids-only projection', () => {
  assertEquals(fields('.fields=eid'), [])
  assertEquals(
    projected(fields('.fields=eid'))([{
      eid: 'e1',
      name: 'session',
      comp: { status: 'running' },
    }]),
    [],
  )
})

Deno.test('.fields= with no columns is still refused', () => {
  // A caller who wrote no columns meant to write some — that is a typo, not the
  // eids-only ask, which has its own spelling.
  let bad = false
  try {
    parseQuery('.fields=')
  } catch {
    bad = true
  }
  assertEquals(bad, true)
})

Deno.test('select: the eids-only projection asks SQL what where() asks', () => {
  let ps = parseQuery('.session!&.fields=eid')
  assertEquals(select(ps), where(ps))
})

// ── the sub ────────────────────────────────────────────────────────────────

type Frame = {
  sub?: string
  changes?: Change[]
  drop?: string[]
  replace?: boolean
  fields?: unknown[]
  error?: string
  reference?: string
}

// One subserve over one graph, collecting the frames it sends. No socket and no
// server: subserve is db-parameterized on purpose, so the subscription contract
// tests without either.
let dial = (db: ReturnType<typeof open>) => {
  let frames: Frame[] = []
  let sv = subserve(db, (json) => frames.push(JSON.parse(json) as Frame))
  return { sv, frames }
}

let mint = (db: ReturnType<typeof open>, comp: Record<string, unknown>) => {
  let eid = uuid()
  apply(db, [{ eid, name: 'session', comp: comp as Change['comp'] }])
  return eid
}

Deno.test('a projected sub answers only its columns', () => {
  let db = bareDb()
  mint(db, { id: 's1', turn: 'busy', cwd: '/tmp', model: 'opus' })
  let { sv, frames } = dial(db)
  let q = '.session!&.fields=session.turn'
  sv.frame({ sub: `q:${q}`, q })
  let comps = Object.fromEntries(
    frames[0].changes!.map((c) => [c.name, c.comp]),
  )
  assertEquals(comps.session, { turn: 'busy' })
  // The spine rides so the client can name the row; nothing else does.
  assertEquals(Object.keys(comps).sort(), ['entity', 'session'])
  // And the reply STATES the projection it answered under.
  assertEquals(frames[0].fields, fields(q))
  db.close()
})

Deno.test('a subscription exception is addressed and recorded as read telemetry', () => {
  let db = bareDb()
  let session = mint(db, { id: 'read-failure' })
  let { sv, frames } = dial(db)
  sv.frame({
    sub: `entries:${session}`,
    q: '.priority=not-a-priority',
  })
  let frame = frames[0]
  assertEquals(frame.sub, `entries:${session}`)
  assertEquals(frame.replace, true)
  assertEquals(frame.changes, [])
  assertStringIncludes(frame.error ?? '', 'priority')
  assertStringIncludes(frame.reference ?? '', 'entries:S-')
  let stored = db.prepare(`
    select source, name, session_id, ok, error, detail
    from tool_call order by rowid desc limit 1
  `).get() as Record<string, unknown>
  assertEquals(stored.source, 'srv')
  assertEquals(stored.name, 'subscription read')
  assertEquals(stored.session_id, session)
  assertEquals(stored.ok, 0)
  assertStringIncludes(String(stored.error), 'priority')
  assertEquals(stored.detail, frame.reference)
})

Deno.test('an expected missing entry source is a refusal, not ready-empty', () => {
  let db = bareDb()
  let session = mint(db, { id: 'expected-provider-session' })
  addSource({ entries: () => undefined })
  try {
    let { sv, frames } = dial(db)
    sv.frame({
      sub: `entries:${session}`,
      q: `.entry.session=${session}`,
    })
    assertEquals(frames[0].replace, true)
    assertStringIncludes(frames[0].error ?? '', 'entry source missing')
    assertStringIncludes(frames[0].reference ?? '', 'entries:S-')
  } finally {
    clearSources()
  }
})

Deno.test('a full sub is unchanged by the projection machinery', () => {
  let db = bareDb()
  mint(db, { id: 's1', turn: 'busy', cwd: '/tmp' })
  let { sv, frames } = dial(db)
  sv.frame({ sub: 'q:.session!', q: '.session!' })
  let session = frames[0].changes!.find((c) => c.name == 'session')!
  assertEquals(session.comp!.cwd, '/tmp')
  // No projection asked for, none stated.
  assertEquals(frames[0].fields, undefined)
  db.close()
})

Deno.test('a text sub uses SQLite FTS for incremental add and remove', () => {
  let db = bareDb()
  let eid = uuid()
  let first: Change[] = [{
    eid,
    name: 'doc',
    comp: { title: 'ộ', body: '' },
  }]
  apply(db, first)
  let { sv, frames } = dial(db)
  sv.frame({ sub: 'q:o', q: 'o' })
  assertEquals(frames[0].changes, [])

  frames.length = 0
  let add: Change[] = [{ eid, name: 'doc', comp: { title: 'o' } }]
  apply(db, add)
  sv.maintain(add)
  assertEquals(
    frames[0].changes?.some((c) => c.eid == eid && c.name == 'entity'),
    true,
  )

  frames.length = 0
  let remove: Change[] = [{ eid, name: 'doc', comp: { title: 'ộ' } }]
  apply(db, remove)
  sv.maintain(remove)
  assertEquals(frames[0].drop, [eid])
  db.close()
})

Deno.test('a projected sub sleeps through an unprojected column', () => {
  let db = bareDb()
  let eid = mint(db, { id: 's1', turn: 'busy' })
  let { sv, frames } = dial(db)
  let q = '.session!&.fields=session.turn'
  sv.frame({ sub: `q:${q}`, q })
  frames.length = 0
  let batch: Change[] = [{ eid, name: 'session', comp: { cwd: '/elsewhere' } }]
  apply(db, batch)
  sv.maintain(batch)
  // Membership did not move and no projected column did either, so there is
  // nothing to say — and an empty frame is never sent.
  assertEquals(frames, [])
  db.close()
})

Deno.test('a projected sub ships a projected column the moment it moves', () => {
  let db = bareDb()
  let eid = mint(db, { id: 's1', turn: 'busy' })
  let { sv, frames } = dial(db)
  let q = '.session!&.fields=session.turn'
  sv.frame({ sub: `q:${q}`, q })
  frames.length = 0
  let batch: Change[] = [{
    eid,
    name: 'session',
    comp: { turn: 'idle', cwd: '/elsewhere' },
  }]
  apply(db, batch)
  sv.maintain(batch)
  assertEquals(frames.length, 1)
  // The delta is re-projected too: the moved column rides, its neighbour in the
  // same patch does not.
  assertEquals(frames[0].changes, [{
    eid,
    name: 'session',
    comp: { turn: 'idle' },
  }])
  db.close()
})

Deno.test('a projected sub still reports births and deaths', () => {
  let db = bareDb()
  let { sv, frames } = dial(db)
  let q = '.session!&.fields=session.turn'
  sv.frame({ sub: `q:${q}`, q })
  frames.length = 0
  // A birth ADDs — projected, but never empty: the spine always rides.
  let eid = uuid()
  let born: Change[] = [{
    eid,
    name: 'session',
    comp: { id: 's2', turn: 'busy', cwd: '/tmp' },
  }]
  apply(db, born)
  sv.maintain(born)
  assertEquals(frames[0].changes!.map((c) => c.name).sort(), [
    'entity',
    'session',
  ])
  frames.length = 0
  let dead: Change[] = [{ eid, name: 'entity', comp: null }]
  apply(db, dead)
  sv.maintain(dead)
  assertEquals(frames[0].changes, [{ eid, name: 'entity', comp: null }])
  db.close()
})

Deno.test('two projections of one query are two subs', () => {
  let db = bareDb()
  let eid = mint(db, { id: 's1', turn: 'busy', cwd: '/tmp' })
  let { sv, frames } = dial(db)
  let thin = '.session!&.fields=session.turn'
  let wide = '.session!&.fields=session.turn,session.cwd'
  sv.frame({ sub: `q:${thin}`, q: thin })
  sv.frame({ sub: `q:${wide}`, q: wide })
  frames.length = 0
  let batch: Change[] = [{ eid, name: 'session', comp: { cwd: '/elsewhere' } }]
  apply(db, batch)
  sv.maintain(batch)
  // One query, one member set each, two different answers — which is exactly
  // what makes projection part of a sub's IDENTITY rather than a hint.
  assertEquals(frames.map((f) => f.sub), [`q:${wide}`])
  assertEquals(frames[0].changes, [{
    eid,
    name: 'session',
    comp: { cwd: '/elsewhere' },
  }])
  db.close()
})

Deno.test('an eids-only sub carries membership and no columns', () => {
  let db = bareDb()
  mint(db, { id: 's1', turn: 'busy', cwd: '/tmp' })
  let { sv, frames } = dial(db)
  let q = '.session!&.fields=eid'
  sv.frame({ sub: `q:${q}`, q })
  assertEquals(frames[0].changes!.map((c) => c.name), ['entity'])
  assertEquals(frames[0].fields, [])
  db.close()
})

Deno.test('a route sub is never projected — it loads one entity whole', () => {
  let db = bareDb()
  let eid = mint(db, { id: 's1', turn: 'busy', cwd: '/tmp' })
  let { sv, frames } = dial(db)
  sv.frame({ sub: `route:${eid}` })
  let session = frames[0].changes!.find((c) => c.name == 'session')!
  assertEquals(session.comp!.cwd, '/tmp')
  db.close()
})

Deno.test('an addressed sub projects one row without a bespoke read door', () => {
  let db = bareDb()
  let eid = mint(db, { id: 's1', turn: 'busy', cwd: '/tmp' })
  let { sv, frames } = dial(db)
  sv.frame({ sub: `want:${eid}`, q: `id=${eid}&.fields=session.turn` })
  assertEquals(frames[0].changes!.map((c) => c.name).sort(), [
    'entity',
    'session',
  ])
  let session = frames[0].changes!.find((c) => c.name == 'session')!.comp!
  assertEquals(session.turn, 'busy')
  db.close()
})

// The chrome projection the Tray actually opens must round-trip the wire, or
// live.ts silently falls back to the in-memory resolver and the 6.22 MB comes
// straight back — with nothing failing to say so.
Deno.test('the session chrome line parses to a projection', async () => {
  let { sessionDetail } = await import('./live.ts')
  let ps = parseQuery(sessionDetail)
  assertEquals(ps.some((p) => p.op == PROJECT), true)
  assertEquals(fieldsOf(ps)!.length > 10, true)
})
