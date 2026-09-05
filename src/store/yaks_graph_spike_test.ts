// Integration spike (T-33497, goal V-33493): does @yaks/graph's apply() agree
// with the APP's apply() on the generic rules? The read spike
// (./yaks_sqlite_spike_test.ts) held @yaks/sqlite's answers against the app's
// reader over one real graph; this is the same evidence for WRITES.
//
// Two graphs, one corpus of batches, replayed through both:
//   - the app's own apply() (src/db.ts) over a bare app database, and
//   - @yaks/graph's apply() over @yaks/sqlite bound to ANOTHER bare app
//     database with the fleet vocabulary (src/vocab/fleet_vocab.ts).
// Both return the batch as applied; the two returns are lowered to the app's
// flat {eid, name, comp} spelling and compared.
//
// What is compared is the GENERIC subset — admission, the `$was` guard, patch,
// comp drop, delete + cascade, the created/updated stamps. Everything the app
// does that is fleet policy rather than graph mechanics is pinned below as an
// executable, named gap, the way the read spike pinned its coverage boundary.

import { assert, assertEquals, assertThrows } from '@std/assert'
import { graph } from '@yaks/graph'
import type { Bundle, Graph } from '@yaks/graph'
import { sessions } from '@yaks/session'
import { storage } from '@yaks/sqlite'
import type { Driver } from '@yaks/sqlite'

import { fleetVocab } from '../vocab/fleet_vocab.ts'

Deno.env.set('DB_PATH', ':memory:')
let { open } = await import('./sqlite.ts')
let { apply } = await import('../db.ts')
let { bareDb } = await import('../testdb.ts')
let { uuid } = await import('../types.ts')
let { sha } = await import('../sha.ts')
let { derived: fleetDerived } = await import('../sql_derived.ts')
type Change = {
  eid: string
  name: string
  comp: Record<string, unknown> | null
  was?: Record<string, string | null>
}

let NOW = Date.parse('2026-08-20T15:00:00.000Z')
let V = fleetVocab()

// ---- the two writers -------------------------------------------------------

// Two live databases at once, so testdb's one-clone-at-a-time discipline is
// respected: the app writes into a bareDb() clone, the core into its own
// migrated handle emptied the same way bareDb() empties its snapshot.
let appDb = bareDb()
let coreDb = open(':memory:')
coreDb.exec('pragma foreign_keys = off')
for (
  let { name } of coreDb.prepare(
    `select name from sqlite_master where type = 'table'
       and name not like 'sqlite_%' and name not like '%_fts%'
       and name not like '%_gram%'`,
  ).all() as { name: string }[]
) coreDb.exec(`delete from "${name}"`)
coreDb.exec('pragma foreign_keys = on')

let driver: Driver = {
  query: (sql, params) => coreDb.prepare(sql).all(...params),
  exec: (sql) => coreDb.exec(sql),
}
let core = graph({
  storage: storage(driver, V, { derived: fleetDerived, now: NOW }),
  vocab: V,
})

// Either database read back through the SAME reader — what a test asserting
// about the state (rather than about a return value) asks.
let reader = (db: typeof appDb) =>
  storage(
    {
      query: (sql, params) => db.prepare(sql).all(...params),
      exec: (sql) => db.exec(sql),
    },
    V,
    { derived: fleetDerived, now: NOW },
  )

// A change is the app's wire shape; a bundle is @yaks/graph's. One bundle per
// change keeps the order identical, which is what a batch's semantics rest on.
let asBundle = (c: Change): Bundle =>
  c.name == 'entity' && c.comp == null
    ? { entity: { eid: c.eid }, $delete: true }
    : {
      entity: { eid: c.eid },
      [c.name]: c.comp,
      ...(c.was ? { $was: { [c.name]: c.was } } : {}),
    }

// A bundle lowered back to the flat spelling, so the two returns compare.
let asChanges = (b: Bundle): Change[] => {
  let eid = b.entity.eid
  if (b.$delete || b.tombstone) return [{ eid, name: 'entity', comp: null }]
  let out: Change[] = []
  if (b.entity.num != null) {
    out.push({ eid, name: 'entity', comp: { eid, num: b.entity.num } })
  }
  for (let [name, comp] of Object.entries(b)) {
    if (name == 'entity' || name.startsWith('$')) continue
    out.push({ eid, name, comp: comp as Record<string, unknown> | null })
  }
  return out
}

// ---- how the two returns are compared, and what is deliberately loose ------
//
// Both returns are indexed by (eid, component). The KEY SETS must match
// exactly — both writers must speak about the same entities and the same
// components, including the ones they synthesized. The VALUES are compared
// column by column, with three documented allowances, each a fleet behavior
// pinned as its own gap test below:
//
//   the stamps      `created`/`updated`/`entity` carry a resolved actor and a
//                   server-minted number; both writers write them, with
//                   different values (the app resolves the writing actor from
//                   the box, the core stamps the `$actor` that rode in the
//                   batch). Presence is compared, values are not.
//   a create's echo the app re-reads a newly created row and echoes it WHOLE,
//                   padding the columns the caller never sent with their
//                   stored nulls; the core echoes what it wrote. The app's
//                   extra columns must all be null.
//   blob            the app materializes a doc body as a content-addressed
//                   `blob` entity (db.ts casBodies). The core has no CAS.
let STAMPS = ['created', 'updated', 'entity']

let index = (changes: Change[]): Map<string, Change> => {
  let out = new Map<string, Change>()
  for (let c of changes) {
    if (c.name == 'blob') continue
    out.set(`${c.eid} ${c.name}`, c)
  }
  return out
}

let same = (mine: Change[], theirs: Change[], said: string) => {
  let a = index(mine), b = index(theirs)
  assertEquals([...a.keys()].sort(), [...b.keys()].sort(), `keys: ${said}`)
  for (let [key, m] of a) {
    let t = b.get(key)!
    if (STAMPS.includes(m.name)) continue // presence compared, values are not
    assertEquals(m.comp == null, t.comp == null, `${key} comp-null: ${said}`)
    if (!m.comp || !t.comp) continue
    for (let [col, val] of Object.entries(m.comp)) {
      assertEquals(t.comp[col], val, `${key}.${col}: ${said}`)
    }
    for (let [col, val] of Object.entries(t.comp)) {
      if (col in m.comp) continue
      // `eid` is the identity the app projects into every row it re-reads, and
      // `at` on a bare facet is the app's clocked-presence stamp (db.ts
      // `clocked`) — another server stamp the core does not carry. The rest of
      // a create's padding is the stored nulls.
      if (col == 'eid' && val == t.eid) continue
      if (col == 'at') continue
      assertEquals(
        val,
        null,
        `${key}.${col} is the app's create padding: ${said}`,
      )
    }
  }
}

// Replay one batch through both writers and hold the returns against each
// other. Returns the app's raw return, for a test that wants to look at it.
let both = (changes: Change[]): Change[] => {
  let mine = core.apply(changes.map(asBundle)) as Bundle[]
  let theirs = apply(appDb, changes as never) as unknown as Change[]
  same(mine.flatMap(asChanges), theirs, JSON.stringify(changes))
  return theirs
}

// Both writers refuse the same batch, for the same reason. `who` names the
// core-side writer, so a test about a PLUGIN's rule holds the plugged-in graph
// against the app the same way this holds the bare core against it.
let refuse = (changes: Change[], because: RegExp, who: Graph = core) => {
  let mine: unknown, theirs: unknown
  try {
    who.apply(changes.map(asBundle))
  } catch (e) {
    mine = e
  }
  try {
    apply(appDb, changes as never)
  } catch (e) {
    theirs = e
  }
  assert(mine, `@yaks/graph accepted: ${JSON.stringify(changes)}`)
  assert(theirs, `the app accepted: ${JSON.stringify(changes)}`)
  assert(
    because.test((mine as Error).message),
    `@yaks/graph said: ${(mine as Error).message}`,
  )
  assert(
    because.test((theirs as Error).message),
    `the app said: ${(theirs as Error).message}`,
  )
}

// ---- the corpus ------------------------------------------------------------

let P = uuid(), T1 = uuid(), T2 = uuid(), C1 = uuid()

Deno.test('parity: a create lands the same components', () => {
  both([
    { eid: P, name: 'project', comp: {} },
    {
      eid: T1,
      name: 'task',
      comp: { priority: 1, domain: 'Eng', project: P },
    },
  ])
})

Deno.test('parity: a patch touches only the columns it names', () => {
  both([{ eid: T1, name: 'task', comp: { priority: 2 } }])
})

Deno.test('parity: a null column clears it', () => {
  both([{ eid: T1, name: 'task', comp: { domain: null } }])
})

Deno.test('parity: a null component drops it, the entity survives', () => {
  both([{ eid: T1, name: 'favorite', comp: {} }])
  both([{ eid: T1, name: 'favorite', comp: null }])
})

Deno.test('parity: an unknown component is a forward-compatible no-op', () => {
  both([
    { eid: T1, name: 'audiobook', comp: { minutes: 4 } },
    { eid: T1, name: 'task', comp: { priority: 3 } },
  ])
})

Deno.test('parity: an unknown column refuses the batch', () => {
  refuse([{ eid: T1, name: 'task', comp: { priorty: 1 } }], /task\.priorty/)
})

Deno.test('parity: a server-owned column is dropped from the wire', () => {
  both([
    { eid: T1, name: 'task', comp: { priority: 1 } },
    { eid: T1, name: 'updated', comp: { at: '2020-01-01T00:00:00.000Z' } },
  ])
})

Deno.test('parity: a $was guard passes when the value still holds', () => {
  both([{ eid: T1, name: 'task', comp: { domain: 'Ops' } }])
  both([{
    eid: T1,
    name: 'task',
    comp: { domain: 'Eng' },
    was: { domain: sha('Ops') },
  }])
})

Deno.test('parity: a moved value refuses the whole batch', () => {
  refuse(
    [
      { eid: T2, name: 'task', comp: { priority: 5 } },
      {
        eid: T1,
        name: 'task',
        comp: { domain: 'Nope' },
        was: { domain: sha('Ops') }, // it is 'Eng' now
      },
    ],
    /moved|changed/i,
  )
  // refused WHOLE: neither writer created the other bundle's entity
  assertEquals(core.read(`.priority=5`), [])
})

Deno.test('parity: a delete tombstones the entity and cascades', () => {
  both([
    { eid: T2, name: 'task', comp: { priority: 1 } },
    { eid: C1, name: 'comment', comp: { target: T2 } },
  ])
  both([{ eid: T2, name: 'entity', comp: null }])
})

Deno.test('parity: the two databases themselves agree', () => {
  // Not a return-value comparison: the two graphs, read back through the SAME
  // reader, must agree about what is alive and what it says.
  let told = (db: typeof appDb) =>
    (reader(db).read('.kind=task') as Bundle[]).map((b) =>
      JSON.stringify([b.entity.eid, b.task])
    ).sort()
  assertEquals(told(coreDb), told(appDb))
})

// ---- the gaps, made executable --------------------------------------------
//
// Everything below is a rule the app's apply() has and @yaks/graph's does not.
// None is graph mechanics: each is fleet POLICY, and belongs in the plugin
// that owns the component (a claim lease in @yaks/session, a blob body in
// @yaks/blob) — as a hook on the phase named in each test. Filed under
// V-33493; pinned here so the boundary is executable rather than remembered.

Deno.test('gap: a dead entity takes no patch — but the app still echoes it', () => {
  // Both writers refuse to WRITE a patch aimed at a tombstone (the assertion
  // at the end). They differ in what they say about it: the app leaves the
  // void change in its returned batch, the core drops it, since nothing
  // happened. The core's answer is the one a cache can apply blindly.
  let mine = core.apply([{
    entity: { eid: T2 },
    task: { priority: 9 },
  }]) as Bundle[]
  let theirs = apply(appDb, [
    { eid: T2, name: 'task', comp: { priority: 9 } },
  ] as never) as unknown as Change[]
  assertEquals(mine.flatMap(asChanges), [])
  assertEquals(theirs.length, 1)
  assertEquals(core.read(`.priority=9`), [])
})

Deno.test('gap: a doc body is content-addressed by the app, plain text here', () => {
  // db.ts casBodies materializes every doc body as a `blob` entity and stores
  // doc.body as a reference to it (NOT NULL). @yaks/graph has no CAS — that is
  // @yaks/blob's job — so a doc write through the core cannot satisfy the
  // app's own layout at all.
  let d = uuid()
  let theirs = apply(appDb, [
    { eid: d, name: 'doc', comp: { title: 'a doc', body: 'some prose' } },
  ] as never) as unknown as Change[]
  assert(theirs.some((c) => c.name == 'blob'), 'the app minted a blob entity')
  let threw: unknown
  try {
    core.apply([{ entity: { eid: d }, doc: { title: 'a doc' } }])
  } catch (e) {
    threw = e
  }
  assert(
    /doc\.body/.test(String((threw as Error)?.message)),
    `expected the NOT NULL body reference to refuse, got: ${threw}`,
  )
})

Deno.test('parity: the claim lease and the stop gate, with @yaks/session in', () => {
  // The two rules this file used to pin as gaps. Composing the plugin onto the
  // SAME core database flips both to agreement: the plugin's `precondition`
  // hook refuses what db.ts refuses, for the same reason, and its `audit` hook
  // writes the same conflict record afterwards.
  let leased = graph({
    storage: storage(driver, V, { derived: fleetDerived, now: NOW }),
    vocab: V,
    plugins: [sessions()],
  })
  let s1 = uuid(), s2 = uuid(), t = uuid()
  let setup: Change[] = [
    { eid: s1, name: 'session', comp: { id: 'lease-one' } },
    { eid: s2, name: 'session', comp: { id: 'lease-two' } },
    { eid: t, name: 'task', comp: { priority: 1 } },
    { eid: t, name: 'claim', comp: { session: s1 } },
  ]
  apply(appDb, setup as never)
  leased.apply(setup.map(asBundle))

  // the claim LEASE: another session's take bounces in both
  refuse(
    [{ eid: t, name: 'claim', comp: { session: s2 } }],
    /already claimed/,
    leased,
  )
  // and both audit the bounce as a conflict entity naming the two sides
  let sides = (bs: Bundle[]) =>
    bs.map((b) => {
      let c = b.conflict as Record<string, unknown>
      return [c.target, c.loser, c.holder]
    })
  assertEquals(
    sides(leased.read(`.conflict.target=${t}`) as Bundle[]),
    [[t, s2, s1]],
  )
  assertEquals(
    sides(reader(appDb).read(`.conflict.target=${t}`) as Bundle[]),
    [[t, s2, s1]],
  )

  // the same session re-claiming is a refresh, not a take, in both
  let refresh: Change[] = [{ eid: t, name: 'claim', comp: { session: s1 } }]
  leased.apply(refresh.map(asBundle))
  apply(appDb, refresh as never)
  for (let db of [coreDb, appDb]) {
    assertEquals(
      (reader(db).read(`.claim.session=${s1}`) as Bundle[])
        .map((b) => b.entity.eid),
      [t],
    )
  }

  // a stop_request may only be pulled on a session that is still going
  refuse(
    [{ eid: uuid(), name: 'stop_request', comp: { target: s1 } }],
    /stop_request refused/,
    leased,
  )
})

Deno.test('gap: the fleet rules the core does not carry', () => {
  // Each of these refuses in the app and lands in the core, because each is a
  // rule about a fleet COMPONENT rather than about the graph. The phase each
  // belongs on, when it becomes a plugin, is named beside it. (The claim lease
  // and the stop gate used to be here; they are the test above now.)
  let t = uuid(), m = uuid()
  apply(appDb, [{ eid: t, name: 'task', comp: { priority: 1 } }] as never)
  // an alias slug names exactly one entity (precondition, @yaks/names)
  apply(appDb, [{ eid: t, name: 'alias', comp: { slug: 'taken' } }] as never)
  assertThrows(
    () =>
      apply(
        appDb,
        [{ eid: uuid(), name: 'alias', comp: { slug: 'taken' } }] as never,
      ),
    Error,
    'already names',
  )
  // a memory an agent wrote lands PROPOSED (a stamp hook)
  let out = apply(appDb, [
    { eid: m, name: 'memory', comp: { scope: null } },
  ] as never) as unknown as Change[]
  assert(
    out.some((c) => c.name == 'proposed'),
    'the app stamps a non-person memory proposed',
  )
  // ... and the core, with no plugins, applies each of these as ordinary data
  let t2 = uuid()
  core.apply([
    { entity: { eid: t2 }, task: { priority: 1 } },
    { entity: { eid: t2 }, alias: { slug: 'taken' } },
    { entity: { eid: t2 }, memory: { scope: null } },
  ])
  assertEquals((core.read(`.alias.slug=taken`) as Bundle[]).length, 1)
})

Deno.test("gap: $edit field operators are the app's, not the core's", () => {
  // `{$edit: [...]}` as a column value is a string surgery db.ts resolves
  // before the guard (editOps). The core has no operators: a column value is a
  // value, and an object where a scalar belongs is refused at admission.
  let e = uuid()
  apply(appDb, [{ eid: e, name: 'task', comp: { domain: 'Eng' } }] as never)
  let threw: unknown
  try {
    core.apply([
      { entity: { eid: e }, task: { domain: { $edit: [] } as never } },
    ])
  } catch (err) {
    threw = err
  }
  assert(/scalar/.test(String((threw as Error)?.message)), String(threw))
})

Deno.test('a content-addressed id is derived, not demanded of the caller', () => {
  // Not a gap — the same rule, in two places. The app hard-codes it: an `edge`
  // whose eid is not edgeEid(from, nature, to) is refused, and its bundle door
  // derives that id for a `$alias` (508d83c9, edge.ts saidEid). @yaks/graph
  // has no edges and no idea what one is: the `mint` phase asks the PLUGIN
  // that owns the component how it names itself, which is the same behavior
  // with the fleet's knowledge in the fleet's plugin.
  let [p, c] = [uuid(), uuid()]
  apply(appDb, [
    { eid: p, name: 'task', comp: { priority: 1 } },
    { eid: c, name: 'task', comp: { priority: 1 } },
  ] as never)
  let guess = uuid()
  assertThrows(
    () =>
      apply(appDb, [
        { eid: guess, name: 'edge', comp: { from: p, to: c } },
        { eid: guess, name: 'reads', comp: {} },
      ] as never),
    Error,
    'must be edgeEid',
  )
  // The core, given the same sentence under an alias and a derive for `edge`,
  // names it itself — and says which id it picked.
  let edged = graph({
    storage: storage(driver, V, { derived: fleetDerived, now: NOW }),
    vocab: V,
    plugins: [{
      name: 'edges',
      derive: { edge: (comp) => sha(`${comp.from} reads ${comp.to}`) },
    }],
  })
  let out = edged.apply([
    { entity: { eid: p } },
    { entity: { eid: c } },
    { entity: { eid: '$edge' }, edge: { from: p, to: c } },
    { entity: { eid: '$edge' }, reads: {} },
  ]) as Bundle[]
  let named = out.find((b) => b.$alias == '$edge')!
  assertEquals(named.entity.eid, sha(`${p} reads ${c}`))
})
