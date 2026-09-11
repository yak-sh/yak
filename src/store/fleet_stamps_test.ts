// Fixed expectations, not a comparison against another invocation of apply.
import { assert, assertEquals, assertThrows } from '@std/assert'
import type { ApplyOpts, Bundle } from '@yaks/graph'
import { apply, fleetGraphOf, journalSince, readComp } from '../db.ts'
import { fed, trace } from '../effects.ts'
import { bareDb } from '../testdb.ts'
import { sha } from '../sha.ts'
import type { Sql } from './sql.ts'
import type { FleetWrite } from './fleet_stamps.ts'
import { asChanges } from './wire.ts'

let first = '2026-09-01T01:02:03.000Z'
let next = '2026-09-02T04:05:06.000Z'
let write = (
  db: Sql,
  bs: Bundle[],
  context: FleetWrite = {},
  opts: ApplyOpts = {},
) => {
  let out = fleetGraphOf(db).write(bs, context, { now: first, ...opts })
  assert(!(out instanceof Promise))
  return out
}
let row = (db: Sql, eid: string, name: string) => {
  let c = readComp(db, eid, name)
  return c && Object.fromEntries(Object.entries(c).filter(([k]) => k != 'eid'))
}
let fixture = () => {
  let db = bareDb()
  write(db, [
    {
      entity: { eid: 'human' },
      person: {},
      email: { address: 'human@example.com' },
    },
    {
      entity: { eid: 'project' },
      project: {},
      repo: { path: '/tmp/fleet-stamp-golden' },
    },
    { entity: { eid: 'persona' }, persona: {} },
    { entity: { eid: 'client' }, client: { actor: 'human' } },
    {
      entity: { eid: 'run' },
      session: { id: 'run-label', actor: 'project', persona: 'persona' },
    },
  ])
  return db
}
let stamp = (by: string | null, via: string | null, at = first) => ({
  at,
  by,
  via,
})

Deno.test('fleet provenance: explicit authors, resolved persona/instrument and a single clock', () => {
  let db = fixture()
  let out = write(db, [
    { entity: { eid: 'a' }, doc: { title: 'A' }, created: { by: 'human' } },
    { entity: { eid: 'anonymous' }, task: {}, created: { by: null } },
    { entity: { eid: 'b' }, task: {} },
  ], { writer: 'run-label' })
  assertEquals(row(db, 'anonymous', 'created'), stamp(null, 'run'))
  assertEquals(row(db, 'a', 'created'), stamp('human', 'run'))
  assertEquals(row(db, 'b', 'created'), stamp('persona', 'run'))
  assertEquals(row(db, 'a', 'updated'), undefined)
  assertEquals(new Set(out.map((b) => b.entity.eid)).size, out.length)
  write(
    db,
    [
      {
        entity: { eid: 'a' },
        doc: { title: 'Edit' },
        updated: { by: 'human' },
      },
      { entity: { eid: 'b' }, brief: { text: 'edit' } },
    ],
    { writer: 'run-label' },
    { now: next },
  )
  assertEquals(row(db, 'a', 'created'), stamp('human', 'run'))
  assertEquals(row(db, 'a', 'updated'), stamp('human', 'run', next))
  assertEquals(row(db, 'b', 'updated'), stamp('persona', 'run', next))
  let log = journalSince(db, 0).at(-1)!
  assertEquals([log.ts, log.actor, log.via, log.trace], [
    next,
    'persona',
    'run',
    null,
  ])
  assertEquals(log.batch.filter((c) => c.name == 'updated'), [
    { eid: 'a', name: 'updated', comp: { by: 'human' } },
  ])
})

Deno.test('fleet provenance: settled writes are absent from stamps, trace and journal', () => {
  let db = fixture()
  write(db, [{
    entity: { eid: 'a' },
    doc: { title: 'A', body: 'body' },
    task: {},
    favorite: {},
  }])
  let cursor = journalSince(db, 0).at(-1)!.rowid
  let t = fed()
  assertEquals(
    write(
      db,
      [
        {
          entity: { eid: 'a' },
          doc: { title: 'A', body: 'body' },
          task: {},
          favorite: {},
          brief: null,
        },
      ],
      { writer: 'client', trace: t },
      { now: next },
    ),
    [],
  )
  assertEquals(row(db, 'a', 'updated'), undefined)
  assertEquals(row(db, 'a', 'favorite'), { at: first })
  assertEquals(journalSince(db, cursor), [])
  assertEquals(t, fed())
  write(db, [{ entity: { eid: 'a' }, doc: { title: 'A', body: '' } }], {}, {
    now: next,
  })
  assertEquals(row(db, 'a', 'updated'), stamp(null, null, next))
  assertEquals(
    journalSince(db, cursor)[0].batch.filter((c) => c.name == 'doc'),
    [
      { eid: 'a', name: 'doc', comp: { body: '' } },
    ],
  )
})

Deno.test('fleet provenance: edges touch both endpoints, reassertion touches nothing', () => {
  let db = fixture()
  write(db, [{ entity: { eid: 'a' }, task: {} }, {
    entity: { eid: 'b' },
    task: {},
  }])
  let edge = [{
    entity: { eid: 'ab' },
    edge: { from: 'a', to: 'b' },
    requires: {},
  }]
  let out = write(db, edge, { writer: 'client' }, { now: next })
  for (let eid of ['a', 'b']) {
    assertEquals(row(db, eid, 'updated'), stamp('human', 'client', next))
    assert(out.some((b) => b.entity.eid == eid && b.updated))
  }
  assertEquals(row(db, 'ab', 'created'), stamp('human', 'client', next))
  let cursor = journalSince(db, 0).at(-1)!.rowid
  assertEquals(write(db, edge), [])
  assertEquals(journalSince(db, cursor), [])
  write(db, [{ entity: { eid: 'ab' }, edge: null, requires: null }], {
    writer: 'run-label',
  })
  for (let eid of ['a', 'b']) {
    assertEquals(row(db, eid, 'updated'), stamp('persona', 'run'))
  }
})

Deno.test('fleet lifecycle: a mixed touch batch heals only blank sessions, in touch order', () => {
  let db = fixture()
  write(db, [
    ...['a', 'b'].map((eid) => ({
      entity: { eid },
      session: { id: eid, cwd: '/tmp/fleet-stamp-golden/tree' },
    })),
    { entity: { eid: 'abstract' }, session: { id: 'abstract' } },
    {
      entity: { eid: 'named' },
      session: {
        id: 'named',
        cwd: '/tmp/fleet-stamp-golden/tree',
        actor: 'human',
      },
    },
  ])
  // Historical rows can have a cwd but no actor. A title-only touch heals
  // them from their current cwd, even when no session patch was submitted.
  db.prepare(`update session set actor = null where id in ('a', 'b')`).run()
  let cursor = journalSince(db, 0).at(-1)!.rowid
  write(
    db,
    ['b', 'plain', 'named', 'abstract', 'a'].map((eid) => ({
      entity: { eid },
      doc: { title: eid },
    })),
  )
  assertEquals(row(db, 'a', 'session')?.actor, 'project')
  assertEquals(row(db, 'b', 'session')?.actor, 'project')
  assertEquals(row(db, 'named', 'session')?.actor, 'human')
  assertEquals(row(db, 'abstract', 'session')?.actor, null)
  assertEquals(row(db, 'plain', 'session'), undefined)
  assertEquals(
    journalSince(db, cursor)[0].batch.filter((c) => c.name == 'session'),
    ['b', 'a'].map((eid) => ({
      eid,
      name: 'session',
      comp: { actor: 'project' },
    })),
  )
})

Deno.test('fleet memory: birth proposal and existing acceptance have distinct person rules', () => {
  let db = fixture()
  write(db, [{ entity: { eid: 'agent-memory' }, memory: {} }], {
    writer: 'run-label',
  })
  assertEquals(row(db, 'agent-memory', 'proposed'), stamp('persona', 'run'))
  write(db, [{ entity: { eid: 'human-memory' }, memory: {} }], {
    writer: 'client',
  })
  assertEquals(row(db, 'human-memory', 'proposed'), undefined)
  write(db, [{ entity: { eid: 'old' }, task: {} }])
  write(db, [{ entity: { eid: 'old' }, memory: {} }], { writer: 'run-label' })
  assertEquals(row(db, 'old', 'proposed'), undefined)
  assertThrows(
    () =>
      write(db, [{
        entity: { eid: 'agent-memory' },
        decided: { verdict: 'approved', by: 'human' },
      }], { writer: 'run-label' }),
    Error,
    'a person decides',
  )
  write(db, [{
    entity: { eid: 'agent-memory' },
    decided: { verdict: 'approved' },
  }], { writer: 'client' })
  assertEquals(row(db, 'agent-memory', 'decided')?.by, 'human')
  // A new memory may relay a decision at birth, before auto-proposal. Naming
  // a human does NOT bypass the existing-proposal guard above.
  write(db, [{
    entity: { eid: 'relayed' },
    memory: {},
    decided: { verdict: 'approved', by: 'human' },
  }], { writer: 'run-label' })
  assertEquals(row(db, 'relayed', 'decided')?.by, 'human')
  assertEquals(row(db, 'relayed', 'proposed'), stamp('persona', 'run'))
})

Deno.test('fleet lifecycle: canonical facets mirror, session actor fills from current cwd', () => {
  let db = fixture()
  let out = write(db, [{
    entity: { eid: 's' },
    session: { id: 'new-run' },
    worktree: { cwd: '/tmp/fleet-stamp-golden/tree' },
    runtime: { pid: 42, pane: 'pane', transcript: 'log' },
  }], { writer: 'new-run' })
  assertEquals(row(db, 's', 'session')?.actor, 'project')
  assertEquals(row(db, 's', 'created'), stamp('project', 's'))
  assertEquals(
    (out.find((b) => b.entity.eid == 's')?.session as Record<string, unknown>)
      ?.cwd,
    '/tmp/fleet-stamp-golden/tree',
  )
  write(db, [{ entity: { eid: 's' }, runtime: null }])
  for (let col of ['pid', 'pane', 'transcript']) {
    assertEquals(row(db, 's', 'session')?.[col], null)
  }
  write(db, [{ entity: { eid: 's' }, worktree: null }])
  assertEquals(row(db, 's', 'session')?.cwd, null)
  assertEquals(row(db, 's', 'session')?.actor, 'project')
})

Deno.test('fleet lifecycle: claim release pushes ordered resume, retake and settlement pop', () => {
  let db = fixture()
  write(db, [{ entity: { eid: 'a' }, task: {}, claim: { session: 'run' } }, {
    entity: { eid: 'b' },
    task: {},
    claim: { session: 'run' },
  }])
  let t = trace()
  write(
    db,
    [{ entity: { eid: 'a' }, claim: null }, {
      entity: { eid: 'b' },
      claim: null,
    }],
    { trace: t },
    { now: next },
  )
  assertEquals(row(db, 'a', 'resume'), { actor: 'project', at: next, rank: 1 })
  assertEquals(row(db, 'b', 'resume'), { actor: 'project', at: next, rank: 2 })
  assertEquals(t.removed.get('a'), ['claim'])
  let pop = fed()
  write(db, [{ entity: { eid: 'a' }, claim: { session: 'run' } }, {
    entity: { eid: 'b' },
    completed: {},
  }], { trace: pop })
  assertEquals(row(db, 'a', 'resume'), undefined)
  assertEquals(row(db, 'b', 'resume'), undefined)
  assertEquals(pop.removed.get('a'), ['resume'])
  assertEquals(pop.removed.get('b'), ['resume'])
  assertEquals(journalSince(db, 0).at(-1)!.trace?.removed, pop.removed)
  // Cascading away the holder still has its old actor available to resume.
  write(db, [{ entity: { eid: 'run' }, tombstone: {} }], {}, { now: next })
  assertEquals(row(db, 'a', 'claim'), undefined)
  assertEquals(row(db, 'a', 'resume'), { actor: 'project', at: next, rank: 1 })
})

Deno.test('fleet lifecycle: stamp families preserve named by and insertion clocks', () => {
  let db = fixture()
  write(db, [{
    entity: { eid: 'a' },
    task: {},
    decided: {
      by: 'human',
      verdict: 'approved',
      at: '2020-01-01T00:00:00.000Z',
    },
    favorite: {},
    opened: {},
  }], { writer: 'run-label' })
  assertEquals(row(db, 'a', 'decided'), {
    ...stamp('human', 'run', '2020-01-01T00:00:00.000Z'),
    verdict: 'approved',
  })
  assertEquals(row(db, 'a', 'opened')?.by, 'persona')
  assertEquals(row(db, 'a', 'opened')?.via, 'run')
  write(
    db,
    [{
      entity: { eid: 'a' },
      decided: { at: '2021-01-01T00:00:00.000Z' },
      favorite: {},
    }],
    { writer: 'client' },
    { now: next },
  )
  assertEquals(row(db, 'a', 'decided'), {
    ...stamp('human', 'run', '2021-01-01T00:00:00.000Z'),
    verdict: 'approved',
  })
  assertEquals(row(db, 'a', 'favorite'), { at: first })
  write(
    db,
    [{ entity: { eid: 'a' }, favorite: null }, {
      entity: { eid: 'a' },
      favorite: {},
    }],
    {},
    { now: next },
  )
  assertEquals(row(db, 'a', 'favorite'), { at: next })
})

Deno.test('fleet lifecycle: trusted imports and mail sender reach return and journal', () => {
  let db = fixture()
  let out = write(
    db,
    [{ entity: { eid: 'entry' }, entry: { session: 'run', seq: 1 } }],
    { imports: new Map([['entry', { source: 'run.jsonl', line: 7 }]]) },
    { trusted: true },
  )
  assertEquals(row(db, 'entry', 'imported'), { source: 'run.jsonl', line: 7 })
  assertEquals(out.find((b) => b.entity.eid == 'entry')?.entity, {
    eid: 'entry',
    num: null,
    archetype: String(readComp(db, 'entry', 'entity')?.archetype),
  })
  assertEquals(
    journalSince(db, 0).at(-1)!.batch.find((c) => c.name == 'imported')?.comp,
    { source: 'run.jsonl', line: 7 },
  )
  write(db, [{ entity: { eid: 'mail' }, mail: {} }], { writer: 'client' })
  assertEquals(row(db, 'mail', 'mail')?.from, 'human@example.com')
  write(db, [{ entity: { eid: 'unsigned' }, mail: {} }], {
    writer: 'run-label',
  })
  assertEquals(row(db, 'unsigned', 'mail')?.from, null)
})

Deno.test('fleet journal: operations stay ordered, only the last new row gets defaults', () => {
  let db = bareDb(), t = fed()
  let out = write(db, [
    { entity: { eid: 'a' }, doc: { title: 'one', body: 'first' } },
    { entity: { eid: 'a' }, doc: { title: 'two' } },
    { entity: { eid: 'a' }, doc: null },
    { entity: { eid: 'a' }, doc: { body: 'last' } },
  ], { trace: t })
  assertEquals(out.find((b) => b.entity.eid == 'a')?.doc, {
    title: '',
    body: 'last',
  })
  let log = journalSince(db, 0)[0]
  assertEquals(log.batch.filter((c) => c.name == 'doc'), [
    { eid: 'a', name: 'doc', comp: { title: 'one', body: 'first' } },
    { eid: 'a', name: 'doc', comp: { title: 'two' } },
    { eid: 'a', name: 'doc', comp: null },
    { eid: 'a', name: 'doc', comp: { title: '', body: 'last' } },
  ])
  assertEquals(log.batch.filter((c) => c.name == 'blob').map((c) => c.eid), [
    sha('first'),
    sha('last'),
  ])
  assertEquals(log.trace, { created: t.created, removed: t.removed })
  assertEquals(
    t.created,
    new Set([`blob ${sha('first')}`, `blob ${sha('last')}`, 'doc a']),
  )
  assertEquals(t.removed, new Map([['a', ['doc']]]))
})

Deno.test('fleet trace: casualties answer only death; rollback leaves journal and trace untouched', () => {
  let db = fixture()
  write(db, [{ entity: { eid: 'a' }, task: {} }, {
    entity: { eid: 'comment' },
    comment: { target: 'a' },
  }])
  let t = fed()
  let out = write(db, [{ entity: { eid: 'a' }, tombstone: {} }], { trace: t })
  assert(
    out.some((b) => b.archetype),
    'new tombstone descriptor rides the batch',
  )
  assertEquals(out.filter((b) => !b.archetype).flatMap(asChanges), [{
    eid: 'a',
    name: 'entity',
    comp: null,
  }, { eid: 'comment', name: 'entity', comp: null }])
  assert(t.removed.get('a')?.includes('task'))
  assert(t.removed.get('comment')?.includes('comment'))
  let cursor = journalSince(db, 0).at(-1)!.rowid, dry = fed()
  write(db, [{ entity: { eid: 'dry' }, memory: {}, doc: { title: 'Dry' } }], {
    trace: dry,
  }, { check: true })
  assertEquals(row(db, 'dry', 'memory'), undefined)
  assertEquals(journalSince(db, cursor), [])
  assertEquals(dry, fed())
  fleetGraphOf(db).use({
    name: 'fail',
    hooks: {
      commit: () => {
        throw new Error('late failure')
      },
    },
  })
  assertThrows(
    () =>
      write(db, [{ entity: { eid: 'rollback' }, task: {} }], { trace: dry }),
    Error,
    'late failure',
  )
  assertEquals(journalSince(db, cursor), [])
  assertEquals(dry, fed())
})

Deno.test('live apply observers and Trace publish only after the outer commit', () => {
  let kept = crypto.randomUUID(), rolledBack = crypto.randomUUID()
  let db = bareDb(), t = fed(), seen: string[] = [], calls = 0
  let g = fleetGraphOf(db)
  g.use({
    name: 'outer-commit-golden',
    hooks: {
      effect: (bs) => {
        assertEquals(db.inTransaction, false)
        calls++
        seen.push(...new Set(bs.filter((b) => b.task).map((b) => b.entity.eid)))
        return bs
      },
    },
  })
  let put = (eid: string) => apply(db, [{ eid, name: 'task', comp: {} }], t)
  assertThrows(() =>
    db.transaction(() => {
      put(rolledBack)
      assertEquals(t, fed())
      assertEquals(seen, [])
      throw new Error('outer rollback')
    })
  )
  assertEquals(readComp(db, rolledBack, 'task'), undefined)
  assertEquals(t, fed())
  assertEquals(seen, [])
  assertEquals(journalSince(db, 0), [])
  db.transaction(() => {
    put(kept)
    assertEquals(t, fed())
    assertEquals(seen, [])
  })
  assert(t.created.has(`task ${kept}`))
  assertEquals(seen, [kept])
  assertEquals(calls, 1)
  assertEquals(journalSince(db, 0).length, 1)
})
