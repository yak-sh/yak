// `task undo` — inverseBatch reversed through apply() against an in-memory db.
// The contract: the guarded inverse restores what a batch changed, and REFUSES
// loudly (never clobbers) when a column moved since or the batch deleted an
// entity. Every case drives real apply() batches so the journal, the was-guard,
// and the tombstone rule are the ones under test, not a mock of them.
Deno.env.set('DB_PATH', ':memory:')
let { apply, depsOf, inverseBatch, lastBatch, mutate, snapshot } = await import(
  './db.ts'
)
let { freshDb } = await import('./testdb.ts')
let { statusOf } = await import('./types.ts')
let { assertEquals, assertNotEquals, assertThrows } = await import(
  '@std/assert'
)

let uid = () => crypto.randomUUID()
let compOf = (
  d: ReturnType<typeof freshDb>,
  eid: string,
  name: string,
) => snapshot(d).changes.find((c) => c.eid == eid && c.name == name)?.comp
// The component bag for an entity — every live comp keyed by name, the shape
// statusOf reads a task's DERIVED status off (completed/cancelled/claim).
let bag = (d: ReturnType<typeof freshDb>, eid: string) =>
  Object.fromEntries(
    snapshot(d).changes
      .filter((c) => c.eid == eid && c.comp)
      .map((c) => [c.name, c.comp]),
  )
let statusAt = (d: ReturnType<typeof freshDb>, eid: string) =>
  statusOf(bag(d, eid))
let alive = (d: ReturnType<typeof freshDb>, eid: string) =>
  snapshot(d).changes.some((c) => c.eid == eid)
// Reverse the latest batch that touched an entity — the ergonomic door.
let undoLast = (d: ReturnType<typeof freshDb>, eid: string, via?: string) =>
  apply(d, inverseBatch(d, lastBatch(d, eid)), undefined, via)

let born = (d: ReturnType<typeof freshDb>, eid: string) =>
  apply(d, [
    { eid, name: 'doc', comp: { title: 'x', body: '' } },
    { eid, name: 'task', comp: {} },
  ])

Deno.test('undo restores a component update to its prior value', () => {
  let db = freshDb(), t = uid()
  born(db, t)
  apply(db, [{ eid: t, name: 'completed', comp: {} }]) // → done
  assertEquals(statusAt(db, t), 'done')
  undoLast(db, t)
  assertEquals(statusAt(db, t), 'open')
})

Deno.test('the mutation capability applies batches and guarded undo', () => {
  let db = freshDb(), t = uid()
  let created = mutate(db, [
    { eid: t, name: 'doc', comp: { title: 'x', body: '' } },
    { eid: t, name: 'task', comp: {} },
  ])
  assertEquals(Array.isArray(created), true)
  mutate(db, [{ eid: t, name: 'completed', comp: {} }]) // → done
  assertEquals(Array.isArray(mutate(db, { mutation: 'undo', eid: t })), true)
  assertEquals(statusAt(db, t), 'open')
})

Deno.test('the mutation capability normalizes nested literals atomically', () => {
  let db = freshDb()
  let result = mutate(db, {
    entities: [{
      key: 'goal',
      comps: {
        doc: { title: 'goal' },
        task: {},
      },
      deps: {
        requires: {
          key: 'step',
          comps: {
            doc: { title: 'step' },
            task: {},
          },
        },
      },
    }],
  })
  assertNotEquals(result.aliases.goal, undefined)
  assertNotEquals(result.aliases.step, undefined)
  assertEquals(
    depsOf(db, [result.aliases.goal]),
    [{
      parent: result.aliases.goal,
      child: result.aliases.step,
      type: 'requires',
    }],
  )
  assertEquals(
    result.changes.some((c) =>
      c.eid == result.aliases.goal && c.name == 'dependency'
    ),
    true,
  )
})

Deno.test('a stale nested literal rolls back every entity', () => {
  let db = freshDb(), existing = uid()
  born(db, existing)
  apply(db, [{ eid: existing, name: 'doc', comp: { body: 'moved' } }])
  assertThrows(
    () =>
      mutate(db, {
        entities: [{
          id: existing,
          comps: { doc: { body: 'clobber' } },
          was: { doc: { body: null } },
          deps: {
            requires: {
              key: 'new',
              comps: { doc: { title: 'must roll back' } },
            },
          },
        }],
      }),
    Error,
    'has moved since',
  )
  assertEquals(compOf(db, existing, 'doc')?.body, 'moved')
  assertEquals(
    snapshot(db).changes.some((c) => c.comp?.title == 'must roll back'),
    false,
  )
})

Deno.test('named mutations reject ambiguous targets', () => {
  let db = freshDb(), t = uid()
  born(db, t)
  assertThrows(
    () => mutate(db, { mutation: 'undo' }),
    Error,
    'exactly one',
  )
  assertThrows(
    () => mutate(db, { mutation: 'undo', id: lastBatch(db, t), eid: t }),
    Error,
    'exactly one',
  )
})

Deno.test('undo of a component create deletes just that component', () => {
  let db = freshDb(), t = uid()
  apply(db, [{ eid: t, name: 'doc', comp: { title: 'x', body: '' } }])
  apply(db, [{ eid: t, name: 'task', comp: {} }])
  assertEquals(!!compOf(db, t, 'task'), true)
  undoLast(db, t) // last batch created the task component
  assertEquals(compOf(db, t, 'task'), undefined)
  assertEquals(!!compOf(db, t, 'doc'), true) // entity + doc survive
})

Deno.test('undo of an entity creation deletes the entity', () => {
  let db = freshDb(), t = uid()
  born(db, t)
  undoLast(db, t) // the birth batch → the whole entity is undone
  assertEquals(alive(db, t), false)
})

Deno.test('undo refuses when a guarded column moved since', () => {
  let db = freshDb(), t = uid()
  born(db, t)
  apply(db, [{ eid: t, name: 'task', comp: { priority: 1 } }])
  let batch = lastBatch(db, t)
  apply(db, [{ eid: t, name: 'task', comp: { priority: 2 } }]) // moves it
  assertThrows(
    () => apply(db, inverseBatch(db, batch)),
    Error,
    'has moved since',
  )
  assertEquals(compOf(db, t, 'task')?.priority, 2) // untouched by the refusal
})

Deno.test('the mutation capability preserves guarded undo refusal', () => {
  let db = freshDb(), t = uid()
  born(db, t)
  mutate(db, [{ eid: t, name: 'task', comp: { priority: 1 } }])
  let batch = lastBatch(db, t)
  mutate(db, [{ eid: t, name: 'task', comp: { priority: 2 } }])
  assertThrows(
    () => mutate(db, { mutation: 'undo', id: batch }),
    Error,
    'has moved since',
  )
  assertEquals(compOf(db, t, 'task')?.priority, 2)
})

Deno.test('undo of a creation refuses when the entity was touched since', () => {
  let db = freshDb(), t = uid()
  born(db, t)
  let birth = lastBatch(db, t)
  apply(db, [{ eid: t, name: 'completed', comp: {} }]) // later touch
  assertThrows(
    () => inverseBatch(db, birth),
    Error,
    'was modified after',
  )
  assertEquals(alive(db, t), true) // still alive
})

Deno.test('undo refuses to reverse a deletion — a tombstone is permanent', () => {
  let db = freshDb(), t = uid()
  born(db, t)
  apply(db, [{ eid: t, name: 'entity', comp: null }]) // delete
  let del = lastBatch(db, t)
  assertThrows(
    () => inverseBatch(db, del),
    Error,
    'deletions are permanent',
  )
})

Deno.test('undo flips an edge: a link becomes an unlink', () => {
  let db = freshDb(), a = uid(), b = uid()
  born(db, a)
  born(db, b)
  apply(db, [{
    eid: a,
    name: 'dependency',
    comp: { type: 'requires', child: b },
  }])
  assertEquals(
    snapshot(db).deps.some((d) => d.parent == a && d.child == b),
    true,
  )
  undoLast(db, a) // undo the link
  assertEquals(
    snapshot(db).deps.some((d) => d.parent == a && d.child == b),
    false,
  )
})

Deno.test('undo restores a bool column (wire true/false vs stored 0/1)', () => {
  let db = freshDb(), p = uid()
  apply(db, [
    { eid: p, name: 'doc', comp: { title: 'venture', body: '' } },
    { eid: p, name: 'repo', comp: { path: '/x', push: false } },
  ])
  let before = compOf(db, p, 'repo')?.push
  apply(db, [{ eid: p, name: 'repo', comp: { push: true } }])
  assertNotEquals(compOf(db, p, 'repo')?.push, before) // the write took
  // If the was-guard hashed the wire `true` instead of the stored 1, this undo
  // would refuse as "moved". It restores, proving the stored-shape normalization.
  undoLast(db, p)
  assertEquals(compOf(db, p, 'repo')?.push, before)
})

Deno.test('undoing an undo is a redo', () => {
  let db = freshDb(), t = uid()
  born(db, t)
  apply(db, [{ eid: t, name: 'task', comp: { priority: 5 } }])
  undoLast(db, t)
  assertEquals(compOf(db, t, 'task')?.priority, 0) // undone to birth default
  undoLast(db, t) // undo the undo
  assertEquals(compOf(db, t, 'task')?.priority, 5) // redone
})

Deno.test('undo by explicit batch id reverses that batch, not the latest', () => {
  let db = freshDb(), t = uid()
  born(db, t)
  let priorPriority = compOf(db, t, 'task')?.priority // its birth default
  apply(db, [{ eid: t, name: 'task', comp: { priority: 1 } }])
  let setPriority = lastBatch(db, t)
  apply(db, [{ eid: t, name: 'completed', comp: {} }]) // → done
  // Undo the older priority batch by id while the newer completed mark stands —
  // the was-guard on `priority` still holds because `completed` is a different
  // comp. Undo restores the EXACT prior value (the birth default), not a null.
  apply(db, inverseBatch(db, setPriority))
  assertEquals(compOf(db, t, 'task')?.priority, priorPriority)
  assertEquals(statusAt(db, t), 'done') // status untouched
})

Deno.test('no journal batch #N — a clear refusal, not a silent no-op', () => {
  let db = freshDb()
  assertThrows(() => inverseBatch(db, 999999), Error, 'no journal batch')
})
