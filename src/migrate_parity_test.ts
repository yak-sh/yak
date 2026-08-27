// The copy-parity harness — the correctness ARBITER for the eid→id storage
// reshape (T-18874, D-18866). The fast suite CANNOT certify this reshape on its
// own: SQLite is loosely typed, so a missed eid→id translation compares against
// the wrong column and matches NOTHING silently — a green test over a wrong
// join. This harness instead pins the invariants the reshape must preserve BYTE
// for BYTE, so a dropped translation shows up as a snapshot that stops matching.
//
// It is schema-agnostic on purpose: it asserts only wire-observable truth
// (snapshot() entities/components/edges, all keyed by permanent EIDs; the
// tombstone/num contract; apply() round-trip determinism), so it is GREEN on the
// current eid-keyed code and stays the arbiter after the spine flips to
// `id INTEGER PRIMARY KEY, eid TEXT UNIQUE`. As the reshape lands, wire the
// legacy eid→id migration into open() and test #1 (the VACUUM-copy round-trip)
// certifies it: snapshot(migrated copy) must equal snapshot(original).
//
// slow() tier — it writes real db files, VACUUMs, and re-opens (no 1ms budget).
// Run under TASKS_SLOW via `deno task test:all`.
import { slow } from './testing.ts'
import { assertEquals, assertStringIncludes } from '@std/assert'

// open() the LIVE graph is refused under `deno test`; every db here is a fresh
// temp file or :memory:, so the guard never fires. DB_PATH must be set before
// db.ts is imported (its module-init opens the default graph) — a throwaway
// :memory: keeps that import off any real file.
Deno.env.set('DB_PATH', ':memory:')
let { apply, open, snapshot, human } = await import('./db.ts')
import type { Change, Snapshot } from './types.ts'
// DatabaseSync as a VALUE — test #4 below writes a raw eid-keyed legacy fixture
// through a plain connection (never open(), the code under test) and needs the
// constructor, not just the type.
import { DatabaseSync } from './sqlite.ts'

let uid = () => crypto.randomUUID()
let tmp = () => Deno.makeTempFileSync({ prefix: 'parity-', suffix: '.db' })

// An empty migrated graph — open()'s full schema with the demo seed stripped, so
// snapshot() holds ONLY what a test writes and carries no persona `home` (whose
// derived `reads` edges would double under a dep replay). FK off so table order
// doesn't matter while clearing.
let unseeded = (): DatabaseSync => {
  let db = open(':memory:')
  db.exec('pragma foreign_keys = off')
  for (
    let { name } of db.prepare(
      `select name from sqlite_master where type = 'table'
         and name not like 'sqlite_%'
         and name not like '%_fts%'
         and name not like '%_gram%'`,
    ).all() as { name: string }[]
  ) db.exec(`delete from ${name}`)
  db.exec('pragma foreign_keys = on')
  return db
}

// Only the entity/component/edge CONTENT is what parity means — cursor is the
// journal high-water mark and epoch is minted per process, neither part of the
// graph's identity. Sort into a stable order so two byte-different files (a
// VACUUM copy, a replay) that hold the SAME graph compare equal regardless of
// row order.
let key = (c: Change) => `${c.name} ${c.eid}`
// A REPLAY into an empty graph re-runs apply()'s WRITE-TIME machinery, so two
// families legitimately differ from the original while the graph's identity is
// preserved: `num` is server-allocated and never rides the wire back in, and the
// `created`/`updated` provenance stamps are minted fresh (new clock, new via).
// A byte-for-byte VACUUM copy keeps both, so it compares strict; `lax` drops
// exactly these write-time artifacts for the replay comparison. Everything the
// reshape actually touches — entity EIDs, every scalar, every {eid} reference,
// every edge — still compares exactly.
let VOLATILE = new Set(['created', 'updated'])
let canon = (snap: Snapshot, lax = false) => ({
  changes: [...snap.changes]
    .filter((c) => !(lax && VOLATILE.has(c.name)))
    .sort((a, b) => key(a) < key(b) ? -1 : 1)
    .map((c) =>
      lax && c.name == 'entity' && c.comp
        ? { ...c, comp: { eid: (c.comp as { eid: unknown }).eid } }
        : c
    ),
  deps: [...snap.deps].sort((a, b) =>
    JSON.stringify(a) < JSON.stringify(b) ? -1 : 1
  ),
})

let parity = (a: Snapshot, b: Snapshot, why: string, lax = false) =>
  assertEquals(canon(a, lax), canon(b, lax), why)

// A representative graph: the demo seed open() plants, plus a few hand-built
// entities that exercise every shape the reshape touches — a component owner
// key, an {eid} reference column (comment.target, card.target), and an edge
// (dependency). The seed alone already carries tasks, boards, people and edges.
let populate = (db: DatabaseSync) => {
  let task = uid(), note = uid(), card = uid()
  apply(db, [
    { eid: task, name: 'doc', comp: { title: 'parity subject', body: 'body' } },
    { eid: task, name: 'task', comp: { status: 'open', priority: 1 } },
    { eid: note, name: 'doc', comp: { title: '', body: 'a comment' } },
    { eid: note, name: 'comment', comp: { target: task } }, // {eid} reference
    { eid: card, name: 'card', comp: { target: task, view: 'Show' } },
  ])
  // An edge between two entities that already exist (both endpoints must be
  // present for the edge to land) — the card depends on the task.
  apply(db, [{
    eid: card,
    name: 'dependency',
    comp: { type: 'requires', child: task },
  }])
  return { task, note, card }
}

// #1 — THE copy-parity substrate the reshape's cutover rehearsal (T-18882)
// runs at scale. snapshot() of a VACUUM copy must equal snapshot() of the
// original: same entities, same components, same edges, IDENTICAL wire EIDs.
// Today the copy is a plain duplicate so this is trivially green; once open()
// carries the legacy eid→id migration, opening the copy MIGRATES it, and this
// becomes the assertion that the migration preserved the whole graph.
slow('copy-parity: snapshot survives a VACUUM copy + reopen', () => {
  let a = tmp(), b = tmp()
  try {
    let orig = open(a)
    populate(orig)
    let before = snapshot(orig)
    orig.exec(`vacuum into '${b.replaceAll("'", "''")}'`)
    orig.close()
    let copy = open(b) // once open() migrates, THIS is the migration under test
    parity(before, snapshot(copy), 'VACUUM copy diverged from the original')
    copy.close()
  } finally {
    for (let p of [a, b]) Deno.removeSync(p)
  }
})

// #2 — the tombstone / no-recycle invariant (C-19754 finding #2). Post-flip the
// spine is `id INTEGER PRIMARY KEY`, which RECYCLES a deleted row's id — so the
// reshape must tombstone in-spine and never physically delete the row, or a
// later entity inherits a dead one's id and its historical references. The
// wire-observable contract that pins this, green in BOTH schemas: a deleted
// entity leaves the snapshot, its num is never reissued to a new entity, and its
// eid never resurrects.
let numOf = (snap: Snapshot, eid: string) =>
  (snap.changes.find((c) => c.name == 'entity' && c.eid == eid)
    ?.comp as { num?: number } | undefined)?.num

slow(
  'tombstone: a deleted entity leaves the graph and its num is never reissued',
  () => {
    let db = open(':memory:')
    let t = uid()
    apply(db, [
      { eid: t, name: 'doc', comp: { title: 'doomed' } },
      { eid: t, name: 'task', comp: { status: 'open' } },
    ])
    let deadNum = numOf(snapshot(db), t)
    apply(db, [{ eid: t, name: 'entity', comp: null }])
    // gone from every component read and from the snapshot
    assertEquals(
      snapshot(db).changes.some((c) => c.eid == t),
      false,
      'a tombstoned entity still rides the snapshot',
    )
    // the dead num is NOT recycled — a fresh entity gets a higher one
    let n = uid()
    apply(db, [{ eid: n, name: 'doc', comp: { title: 'fresh' } }])
    let freshNum = numOf(snapshot(db), n)!
    assertEquals(freshNum > deadNum!, true, 'the allocator reissued a dead num')
    // nothing resurrects the eid
    apply(db, [{ eid: t, name: 'doc', comp: { title: 'zombie' } }])
    assertEquals(
      snapshot(db).changes.some((c) => c.eid == t),
      false,
      'a tombstoned eid was resurrected',
    )
    db.close()
  },
)

// #3 — apply() round-trip determinism: a snapshot fed back into an empty graph
// reproduces itself. This is the write-side mirror of #1 — it exercises apply()'s
// owner-key and {eid}-reference resolution (the paths that gain the eid→id
// translation) and proves they invert snapshot()'s projection exactly.
slow('apply round-trip: replaying a snapshot reproduces the graph', () => {
  let src = unseeded()
  populate(src)
  let snap = snapshot(src)
  let dst = unseeded()
  apply(dst, snap.changes)
  apply(
    dst,
    snap.deps.map((d) => ({
      eid: d.parent,
      name: 'dependency',
      comp: {
        type: d.type,
        child: d.child,
        ...('ord' in d ? { ord: d.ord } : {}),
      },
    })) as Change[],
  )
  parity(
    snap,
    snapshot(dst),
    'a replayed snapshot did not reproduce itself',
    true,
  )
  src.close()
  dst.close()
})

// #4 — LEGACY eid→id MIGRATION CORRECTNESS (the certifying arbiter, T-19881).
// Tests #1–#3 build their "before" state with THIS code, so pre-flip they
// compare eid-keyed↔eid-keyed and post-flip id-keyed↔id-keyed — they never run
// the ONE path cutover (T-18883) executes: the flipped open() MIGRATING a real
// eid-keyed legacy graph. This builds that graph by RAW SQL — today's pre-flip
// shape, HARDCODED so it stays eid-keyed after db.ts's `schema` flips — feeds it
// to open(), and certifies the migration end to end.
//
// Committable TODAY: pre-flip, open() produces an eid-keyed schema, so there is
// no migration to certify and this SKIPS (green). Post-flip it RUNS and every
// assertion is mandatory — the arbiter arms the instant the spine flips. Flip
// `FORCE` true during development to run the post-flip assertions against pre-
// flip code and watch them go red for the RIGHT reason: the `id`-keyed spine is
// absent (the MIGRATION is missing, not the fixture — open() still accepts the
// fixture and snapshot() still reads it).

let cols = (db: DatabaseSync, table: string) =>
  (db.prepare(`select name from pragma_table_info('${table}')`).all() as {
    name: string
  }[]).map((r) => r.name)

// Does the CURRENT code key the spine by an integer id (post-flip) rather than
// by eid (pre-flip)? Read it off a throwaway open() so the committed skip never
// depends on a pre-flip open() digesting the raw legacy fixture.
let idKeyed = () => {
  let p = open(':memory:')
  let flipped = cols(p, 'entity').includes('id')
  p.close()
  return flipped
}

// Today's pre-flip schema shape, HARDCODED (not read from db.ts's `schema`, which
// flips) — a representative subset: the spine; the component owner keys; {eid}
// reference columns (comment.target, card.target, conflict.target, result.call,
// created.by); a dependency edge; and the separate tombstone table a pre-flip
// delete leaves behind. conflict/result/created are here to carry the REAL-DATA
// anomaly cases (T-18874): a NOT NULL ref to a deleted entity (dropped), a
// NULLABLE ref to one (nulled), and an orphaned component row (skipped). NOTE the
// legacy ref columns carry no `references` clause on purpose — a live graph's
// pointers to a since-deleted entity are exactly the dangling values the reshape
// must tolerate, so the fixture must be free to hold them.
let LEGACY_DDL = `
  create table entity (eid text primary key, num integer not null unique);
  create table doc (eid text primary key references entity(eid),
    title text not null, body text not null default '');
  create table task (eid text primary key references entity(eid),
    status text not null default 'open', priority real not null default 0);
  create table comment (eid text primary key references entity(eid),
    target text references entity(eid));
  create table card (eid text primary key references entity(eid),
    target text not null references entity(eid), view text not null);
  create table conflict (eid text primary key references entity(eid),
    target text not null, loser text not null, holder text not null,
    at text not null);
  create table result (eid text primary key references entity(eid),
    call text not null);
  create table created (eid text primary key references entity(eid),
    at text not null, "by" text, via text);
  create table dependency (parent text not null references entity(eid),
    type text not null, child text not null references entity(eid),
    ord integer, primary key (parent, type, child));
  create table tombstone (eid text primary key, num integer, deleted_at text not null);
`

// A representative eid-keyed legacy graph written straight to the file with a
// plain connection — NEVER through open() (the code under test). Returns the
// eids so the assertions can name them. Beyond the clean shapes it carries the
// real-data reference classes (T-18874) split by their two targets: `dead`, a
// pre-existing TOMBSTONE (in the tombstone table, absent from the old entity
// table), whose inbound refs the reshape CARRIES FORWARD (D-18866) by minting a
// retained spine row; and `ghost`, a genuine ghost referenced by nothing on the
// spine and NOT tombstoned, whose inbound refs the reshape cleans. Plus an
// orphaned component row absent from the spine.
let legacyGraph = (path: string) => {
  let raw = new DatabaseSync(path)
  // foreign_keys OFF: the anomaly rows POINT at a since-deleted entity — the very
  // condition a live graph reaches by deletion and the reshape must tolerate — so
  // the fixture writes them straight, exactly as the eid-keyed readers left them.
  raw.exec('pragma foreign_keys = off')
  raw.exec(LEGACY_DDL)
  let task = uid(), note = uid(), card = uid(), dead = uid()
  let conf = uid(), res = uid(), orphan = uid(), ghost = uid()
  // A live task; a comment aimed at it ({eid} ref); a card aimed at it ({eid}
  // ref) that also `requires` it (an edge); and a tombstoned entity (`dead`)
  // holding num 5 so the no-recycle check has teeth.
  //
  // The reference cases:
  //   - KEEP-REFS to `dead` (a pre-existing tombstone): a result whose NOT NULL
  //     `call` and a created whose NULLABLE `via` both point at it. The reshape
  //     carries `dead` into the spine, so BOTH rows survive and RESOLVE — the
  //     fidelity D-18866 requires, not a drop/null.
  //   - DANGLING refs to `ghost` (a genuine ghost, no spine + no tombstone): a
  //     conflict whose NOT NULL `target` dangles (row DROPPED) and a created
  //     whose NULLABLE `by` dangles (ref NULLED, row kept).
  //   - an `orphan` doc+task pair with no spine row at all (rows SKIPPED).
  // conf/res own real spine rows so they are NOT orphans — only their refs vary.
  raw.exec(
    `insert into entity (eid, num) values ` +
      `('${task}', 1), ('${note}', 2), ('${card}', 3), ` +
      `('${conf}', 4), ('${res}', 6);` +
      `insert into doc (eid, title, body) values ` +
      `('${task}', 'legacy task', 'body one'), ('${note}', '', 'a comment'), ` +
      `('${orphan}', 'orphan doc', 'no spine');` +
      `insert into task (eid, status, priority) values ` +
      `('${task}', 'wip', 2), ('${orphan}', 'open', 0);` +
      `insert into comment (eid, target) values ('${note}', '${task}');` +
      `insert into card (eid, target, view) values ('${card}', '${task}', 'Show');` +
      `insert into conflict (eid, target, loser, holder, at) values ` +
      `('${conf}', '${ghost}', 'S-1', 'S-2', '2026-01-01T00:00:00Z');` +
      `insert into result (eid, call) values ('${res}', '${dead}');` +
      `insert into created (eid, at, "by", via) values ` +
      `('${task}', '2026-01-01T00:00:00Z', '${ghost}', '${dead}');` +
      `insert into dependency (parent, type, child, ord) values ` +
      `('${card}', 'requires', '${task}', null);` +
      `insert into tombstone (eid, num, deleted_at) values ` +
      `('${dead}', 5, '2026-01-01T00:00:00Z');`,
  )
  raw.close()
  return { task, note, card, dead, conf, res, orphan, ghost }
}

// Development toggle (see the header). Committed false so the branch stays green.
let FORCE = false

slow(
  'migrate: the flipped open() migrates a real eid-keyed legacy db',
  () => {
    if (!idKeyed() && !FORCE) {
      // The migration does not exist yet; there is nothing to certify. This is
      // the committed-green state — the arbiter arms the moment the spine flips.
      console.error(
        'migrate-legacy: spine still eid-keyed (pre-flip) — SKIP until T-18874 lands',
      )
      return
    }
    let path = tmp()
    try {
      let { task, note, card, dead, conf, res, orphan, ghost } = legacyGraph(
        path,
      )
      // The reshape REPORTS what it cleaned to stderr (M-16612); capture it so
      // the counts are asserted, not just the surviving rows.
      let logs: string[] = []
      let origErr = console.error
      console.error = (...a: unknown[]) => void logs.push(a.join(' '))
      let db: ReturnType<typeof open>
      try {
        db = open(path) // pre-flip: a no-op reopen; post-flip: THE migration
      } finally {
        console.error = origErr
      }
      let report = logs.join('\n')

      // 1. The spine flipped: an integer id ALONGSIDE the permanent eid.
      let spine = cols(db, 'entity')
      assertEquals(
        spine.includes('id'),
        true,
        'entity spine has no integer id — migration absent',
      )
      assertEquals(
        spine.includes('eid'),
        true,
        'entity lost its eid — the wire identity is gone',
      )

      // 2. Every component owner key is now an `entity` int that RESOLVES back
      //    to its original eid. Join each table to the spine and confirm the
      //    count is whole (no owner failed to resolve) — the loose-typing class.
      for (
        let [name, want] of [['doc', 2], ['task', 1], ['comment', 1], [
          'card',
          1,
        ]] as [string, number][]
      ) {
        assertEquals(
          cols(db, name).includes('entity'),
          true,
          `${name} owner key is not entity int`,
        )
        let joined = (db.prepare(
          `select count(*) as n from "${name}" t join entity e on e.id = t.entity`,
        ).get() as { n: number }).n
        assertEquals(
          joined,
          want,
          `${name}: ${want - joined} owner ref(s) did not resolve eid→id`,
        )
      }

      // 3. Referential integrity: every migrated int reference points at a real
      //    spine id. A missed translation leaves a dangling ref FK-check catches.
      assertEquals(
        db.prepare('pragma foreign_key_check').all().length,
        0,
        'a migrated reference dangles — foreign_key_check found orphans',
      )

      // 4. Wire parity: snapshot() reproduces the graph by its PERMANENT eids —
      //    the reshape preserved the wire. Reference columns and the edge still
      //    name the original eids, proving the id→eid projection inverts.
      let snap = snapshot(db)
      let comp = (eid: string, name: string) =>
        snap.changes.find((c) => c.eid == eid && c.name == name)?.comp as
          | Record<string, unknown>
          | undefined
      assertEquals(
        comp(task, 'doc')?.title,
        'legacy task',
        'task doc did not survive',
      )
      assertEquals(
        comp(task, 'task')?.status,
        'wip',
        'task status did not survive',
      )
      assertEquals(
        comp(note, 'comment')?.target,
        task,
        'comment.target did not project back to its eid',
      )
      assertEquals(
        comp(card, 'card')?.target,
        task,
        'card.target did not project back to its eid',
      )
      assertEquals(
        snap.deps.some((d) =>
          d.parent == card && d.child == task && d.type == 'requires'
        ),
        true,
        'the requires edge did not survive as eids',
      )

      // 5. Tombstone survival + no num recycling. The dead entity stays off the
      //    wire, its num is retained, and a fresh entity never inherits it.
      assertEquals(
        snap.changes.some((c) => c.eid == dead),
        false,
        'a tombstoned entity rode the wire',
      )
      let fresh = uid()
      apply(db, [{ eid: fresh, name: 'doc', comp: { title: 'after' } }])
      let freshNum = numOf(snapshot(db), fresh)!
      assertEquals(
        freshNum > 5,
        true,
        `the allocator reissued a dead num (got ${freshNum}, dead held 5)`,
      )

      // 6. No id recycling (C-19754 finding #2): the fresh entity's integer id
      //    strictly exceeds every id already minted — the integer PK never
      //    reuses a deleted row.
      let maxBefore = (db.prepare(
        `select max(id) as m from entity where eid != ?`,
      ).get(fresh) as { m: number }).m
      let freshId =
        (db.prepare('select id from entity where eid = ?').get(fresh) as {
          id: number
        }).id
      assertEquals(
        freshId > maxBefore,
        true,
        'a fresh id did not exceed the max — a rowid recycled',
      )

      // 7. REAL-DATA ANOMALIES (T-18874): the class the clean fixtures missed.
      //    open() must COMPLETE (it did — we are here) and clean each anomaly per
      //    policy, never crash on the constraint-tight schema.
      let n = (sql: string, ...args: (string | number)[]) =>
        (db.prepare(sql).get(...args) as { n: number }).n

      // 7a. Orphaned component rows (owner eid has no spine) are SKIPPED — gone
      //     from their tables and never on the wire. The live doc/task counts
      //     (asserted whole in #2) already exclude them; this pins the orphan eid.
      assertEquals(
        snap.changes.some((c) => c.eid == orphan),
        false,
        'an orphaned component row rode the wire',
      )
      assertEquals(
        n(
          `select count(*) as n from doc_value t join entity e on e.id = t.entity
           where e.eid = ?`,
          orphan,
        ),
        0,
        'the orphan doc row survived the reshape',
      )

      // 7b. A NOT NULL reference to a GENUINE GHOST (no spine, no tombstone) →
      //     the whole row DROPPED (it is about a corpse and has no valid id).
      //     conflict.target → ghost was the only conflict row, so the table is
      //     empty; its OWNER `conf` survives as a bare spine row (only the
      //     component row is dead data). `ghost` itself never gains a spine row.
      assertEquals(
        n('select count(*) as n from conflict'),
        0,
        'conflict row not dropped',
      )
      assertEquals(
        n('select count(*) as n from entity where eid = ?', conf),
        1,
        'a dropped-component owner lost its spine row',
      )
      assertEquals(
        n('select count(*) as n from entity where eid = ?', ghost),
        0,
        'a genuine ghost gained a spine row',
      )

      // 7c. A NULLABLE reference to a genuine ghost → the ref is NULLED and the
      //     row KEPT. The created row for the task stands, with `by` cleared.
      assertEquals(
        n(
          `select count(*) as n from created c join entity e on e.id = c.entity
           where e.eid = ? and c."by" is null`,
          task,
        ),
        1,
        'created.by was not nulled (or the row was dropped)',
      )

      // 7d. D-18866 FIDELITY: a KEEP-REF to a PRE-EXISTING TOMBSTONE resolves
      //     rather than dropping or nulling. `dead` lived only in the tombstone
      //     table (no old entity row); the reshape carries it into the spine as
      //     a retained row keeping its grave num, so every reference history
      //     holds to it stays valid.
      //     - `dead` is now a spine row carrying its num (5), still tombstoned
      //       (off the wire, asserted in #5).
      assertEquals(
        n('select count(*) as n from entity where eid = ? and num = 5', dead),
        1,
        'a pre-existing tombstone was not carried into the spine with its num',
      )
      //     - its id is STRICTLY ABOVE the max seeded from the old entity table
      //       — a carried grave never collides with a live id. (Excludes the
      //       post-migration `fresh` mint, whose id is higher still.)
      assertEquals(
        (db.prepare(
          `select case when (select id from entity where eid = ?)
                          > (select max(id) from entity where eid not in (?, ?))
                       then 1 else 0 end as n`,
        ).get(dead, dead, fresh) as { n: number }).n,
        1,
        'a carried tombstone id did not exceed the live spine max',
      )
      //     - the NOT NULL keep-ref (result.call → dead) SURVIVES and resolves.
      assertEquals(
        n(
          `select count(*) as n from result r join entity e on e.id = r.call
           where e.eid = ?`,
          dead,
        ),
        1,
        'a NOT NULL keep-ref to a tombstone was dropped instead of resolving',
      )
      assertEquals(comp(res, 'result')?.call, dead, 'result.call lost its eid')
      //     - the NULLABLE keep-ref (created.via → dead) SURVIVES and resolves.
      assertEquals(
        comp(task, 'created')?.via,
        dead,
        'created.via to a tombstone was nulled instead of resolving',
      )
      //     - human() names the carried grave by its full id (num-based), not
      //       the short-eid fallback a spine-less tombstone would force — the
      //       unification across pre- and post-cutover deaths.
      assertStringIncludes(
        human(db, dead),
        '-5',
        'human() did not name the carried tombstone by its num',
      )

      // 7e. The reshape REPORTED exactly what it cleaned (M-16612) — counts, not
      //     silence. Only the genuine-ghost refs are cleaned now; the keep-refs
      //     to `dead` resolve and appear NOWHERE in the report.
      assertStringIncludes(report, 'doc — skipped 1 orphan row(s)')
      assertStringIncludes(report, 'task — skipped 1 orphan row(s)')
      assertStringIncludes(report, 'conflict.target — dropped 1 row(s)')
      assertStringIncludes(
        report,
        'created.by — nulled 1 dangling reference(s)',
      )
      assertEquals(
        report.includes('result.call'),
        false,
        'a resolved keep-ref was reported as an anomaly',
      )
      assertStringIncludes(
        report,
        'cleaned 2 orphan row(s), 1 dropped row(s), 1 nulled reference(s)',
      )

      db.close()
    } finally {
      Deno.removeSync(path)
    }
  },
)
