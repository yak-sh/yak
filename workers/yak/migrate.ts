// The one-pass move from the fleet-shaped store (src/store/schema.json, whose
// Durable Object class went with T-33807) to the packages-shaped one (graph.ts,
// @yaks/sqlite from a loaded vocabulary). Nothing here imports that class: the
// pass reads the old tables BY NAME, which is why it outlives the code that
// wrote them and must stay until every deployed object has been touched once.
// Jeff, 2026-09-05: "there are a few users! can't just drop" — so this is a DATA
// migration, and the rows a deployed object holds are the whole subject.
//
// Three things happen, in this order, and the order is the safety:
//
//   1. EXPORT   {@link taken} reads every old table as it stands and
//               {@link lines} writes it out as JSON lines. The caller puts that
//               in R2 before a row moves, so a migration that is wrong is still
//               a migration nothing was lost to. This is the restore path.
//   2. CARRY    {@link carry} runs the whole pass inside ONE `transactionSync`:
//               the derived objects go, the base tables are renamed aside, the
//               new schema is planted, the rows are copied across, and the
//               counts are read back. A throw anywhere unwinds all of it and
//               the object is bit-for-bit what it was.
//   3. RECONCILE per table, old count against new, with every expected delta
//               NAMED ({@link Moved.note}). One that does not reconcile throws
//               {@link Refused}, which is the rollback — the caller then serves
//               the old rows read-only and says so.
//
// ## What is not a straight copy
// The layouts agree almost everywhere: both spell the spine `entity(id, eid,
// num)`, both key a component table by an integer `entity` referencing it, and
// both name a component after its word. So the spine and `tombstone` are not
// touched at all — every integer id, every `num`, every tombstone survives
// because nothing moves them — and a component the new vocabulary also names is
// copied column-for-column over the columns the two have in common. Four things
// are not that:
//
//   doc.body      was an integer pointing at a `blob` entity whose text sat in
//                 `blob_text(entity, value)`; it is now the text's own SHA-256,
//                 with the text in @yaks/blob's `blob_text(sha, value)`. Same
//                 table name, different table — which is exactly why the old one
//                 is renamed aside before the new one is planted.
//   references    the fleet wrote the tag for `referenced` under its present
//                 tense, and an edge's eid is derived from `from|tag|to` — so
//                 the tag is rewritten AND the entity re-addressed under the new
//                 spelling (`update entity set eid`, which keeps the integer id
//                 and so keeps every row that points at it).
//   recalled      wore `source` and `at`; the relation is a bare tag now, so
//                 both columns are dropped and said so in the report.
//   member.role   @yaks/member's roster has two seats (`owner|member`) and hands
//                 out levels as `grant{app, person, access}`. An app's store
//                 therefore splits: an owner keeps the seat, and anyone else
//                 becomes a `member` plus a grant at the level they had. The
//                 DIRECTORY does NOT split — its vocabulary declares the three
//                 seats itself (vocab.ts `platformDoc`), so its rows copy whole.
//
// ## What cannot be carried
// The fleet's other ~100 words (`card`, `pin`, `mail`, `session`, the journal…)
// are not in any store's vocabulary now, so there is no table for their rows to
// go to. They are in the export, they are named in the report with their row
// counts, and the tables are dropped — which is step 4 of T-33809. The JOURNAL
// is one of them: nothing in workers/yak installs @yaks/journal, so an app store
// has no `batch`/`delta` table to carry `journal_tx`/`journal_change`/
// `journal_field` into. It is archived to R2 with the rest and said so.
import { driver, type DurableStorage, reserved } from '@yaks/durable-object'
import { edgeEid } from '@yaks/edge'
import { sha256 } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'

/** The slice of an R2 bucket an export needs. */
export type Bucket = {
  put(key: string, value: string | ArrayBuffer | Uint8Array): Promise<unknown>
}

/** The object's own key-value slots beside its SQL — where the OLD store kept
 * everything it remembered (its name, the app's `vocab.json`, the words it
 * borrows, its tools). `ctx.storage.kv`, which graph.ts's Store does not use. */
export type Slots = {
  get(key: string): unknown
  put(key: string, value: unknown): void
}

/** The words the old store kept in {@link Slots}, in the order they are read. */
export let SLOTS = [
  'name',
  'vocab',
  'uses',
  'tools',
  'schema',
  'schema_version',
]

/** The marker written when a pass reconciles, so it never runs twice. */
export let MARK = 'yak/store/packages/1'

/** The two tables the two layouts spell identically, and so never move. */
let SPINE = ['entity', 'tombstone']

/** This object's own memory in the NEW store (graph.ts `KV`), which the pass
 * writes but never reads out of the old schema. */
let KEEP = [...SPINE, 'yak_kv']

/** A table renamed aside for the length of the pass. */
let ASIDE = 'yak_old_'

type Row = Record<string, unknown>

/** A Durable Object's SQLite as @yaks/sqlite drives it. */
export type Drive = ReturnType<typeof driver>

let q = (name: string): string => `"${name.replaceAll('"', '""')}"`

/** A refusal that unwinds the pass: the counts did not reconcile, or the new
 * schema would not stand over the old rows. It carries the report, so the
 * caller can archive what it learned even though nothing was written. */
export class Refused extends Error {
  report: Report
  constructor(report: Report) {
    super(report.message ?? 'the migration did not reconcile')
    this.name = 'Refused'
    this.report = report
  }
}

/** One table's move: how many rows it had, how many it has, and — when those
 * are not the same number — why. */
export type Moved = { table: string; from: number; to: number; note?: string }

/** What the pass did, written beside the export. */
export type Report = {
  store: string
  app: string | null
  at: string
  ok: boolean
  message?: string
  mark: string
  /** the tables that moved, old count against new */
  moved: Moved[]
  /** the fleet's other words: no vocabulary names them, so the rows live in the
   * export and nowhere else */
  dropped: { table: string; rows: number }[]
  /** where the rows this report is about were written */
  export: string
}

// ---- the export ------------------------------------------------------------

/** Every old table, as it stands. */
export type Taken = {
  store: string
  at: string
  slots: Record<string, string>
  tables: { name: string; rows: Row[] }[]
}

/**
 * Whether this object still holds the FLEET-shaped store. The journal is the
 * tell: `journal_tx` is the old schema's and only the old schema's — the new
 * store installs no journal at all — so a table by that name is an object that
 * has not moved, and its absence is one that never was or already has.
 */
export let stale = (storage: DurableStorage): boolean =>
  driver(storage).query(
    `select 1 as n from sqlite_master where type = 'table' and name = ?`,
    ['journal_tx'],
  ).length > 0

/**
 * Every definition of one type that is THIS OBJECT'S — the single place the
 * pass learns what tables there are, so both halves of it, the export and the
 * carry, enumerate the same list.
 *
 * `reserved` (@yaks/durable-object) is what it is not: SQLite's catalogue and
 * Cloudflare's own tables. The runtime lists `_cf_KV` here like any other and
 * then refuses to read it — which is how a pass that took `sqlite_master` at
 * its word threw `SQLITE_AUTH` in every deployed object and none of the local
 * ones, where nothing creates that table (T-34019).
 */
let named = (d: Drive, type: string): { name: string; sql: string }[] =>
  d.query('select name, sql from sqlite_master where type = ?', [type])
    .map((r) => ({ name: String(r.name), sql: String(r.sql ?? '') }))
    .filter((t) => !reserved(t.name))

let columns = (d: Drive, table: string): string[] =>
  d.query(`pragma table_info(${q(table)})`, []).map((r) => String(r.name))

/**
 * Every DEFINITION this object stands on, dropped: its views, its triggers and
 * its full-text indexes.
 *
 * They hold no rows of their own — a view is a query, a trigger is a rule, and
 * an external-content FTS5 index is an inverted copy of rows that live
 * somewhere else — and `create ... if not exists` says nothing about one that is
 * already standing. So re-raising them is the only way a changed shape reaches a
 * store that has an older one, and dropping them costs only the rebuild below.
 * Dropping a virtual table takes its shadow tables with it.
 */
export let recut = (d: Drive) => {
  for (let t of named(d, 'trigger')) {
    d.exec(`drop trigger if exists ${q(t.name)}`)
  }
  for (let v of named(d, 'view')) d.exec(`drop view if exists ${q(v.name)}`)
  for (let f of shadowed(d)) d.exec(`drop table if exists ${q(f)}`)
}

/** Every full-text index refilled from the content it mirrors — what a freshly
 * raised external-content index needs, because the rows it indexes were written
 * before it existed. */
export let rebuild = (d: Drive) => {
  for (let f of shadowed(d)) {
    d.exec(`insert into ${q(f)}(${q(f)}) values ('rebuild')`)
  }
}

let count = (d: Drive, table: string): number => {
  let [row] = d.query(`select count(*) as n from ${q(table)}`, [])
  return Number(row?.n ?? 0)
}

let stands = (d: Drive, table: string): boolean =>
  d.query(
    `select 1 as n from sqlite_master where type = 'table' and name = ?`,
    [table],
  ).length > 0

// A full-text index is several tables — the virtual one and its shadows — and
// the shadows are derived bytes nobody restores from. The virtual table's own
// name prefixes every one of them, which is how they are told apart.
let shadowed = (d: Drive): string[] =>
  named(d, 'table').filter((t) => /using\s+fts\d/i.test(t.sql)).map((t) =>
    t.name
  )

/**
 * Everything the object holds, read out of the OLD schema: its key-value slots
 * and every base table's rows. Synchronous, and it writes nothing — this runs
 * before the pass, so that what it hands back can reach R2 first.
 */
export let taken = (storage: DurableStorage, slots?: Slots): Taken => {
  let d = driver(storage)
  let held: Record<string, string> = {}
  for (let k of SLOTS) {
    let v = slots?.get(k)
    if (v != null) held[k] = String(v)
  }
  let fts = shadowed(d)
  let skip = (name: string) =>
    name == 'yak_kv' || fts.some((f) => name == f || name.startsWith(`${f}_`))
  return {
    store: held.name ?? '',
    at: new Date().toISOString(),
    slots: held,
    tables: named(d, 'table').filter((t) => !skip(t.name)).map((t) => ({
      name: t.name,
      rows: d.query(`select * from ${q(t.name)}`, []),
    })),
  }
}

let B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

// Bytes as text, so a column holding an embedding or an image survives a JSON
// line. Hand-rolled because the export must not depend on a runtime global that
// the workerd stand-in and the deploy might spell differently.
let base64 = (bytes: Uint8Array): string => {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    let n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    let has = bytes.length - i
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] +
      (has > 1 ? B64[(n >> 6) & 63] : '=') + (has > 2 ? B64[n & 63] : '=')
  }
  return out
}

let plain = (v: unknown): unknown =>
  v instanceof ArrayBuffer
    ? { $bytes: base64(new Uint8Array(v)) }
    : v instanceof Uint8Array
    ? { $bytes: base64(v) }
    : v

/**
 * The export as bytes: one JSON object per line — a header, the object's slots,
 * then one line per table carrying its columns and its rows. Line-oriented so a
 * restore reads it a table at a time, and so a diff between two exports of the
 * same object is readable.
 */
export let lines = (t: Taken): string =>
  [
    JSON.stringify({
      kind: 'store',
      store: t.store,
      at: t.at,
      tables: t.tables.map((x) => x.name),
    }),
    JSON.stringify({ kind: 'slots', slots: t.slots }),
    ...t.tables.map((x) =>
      JSON.stringify({
        kind: 'rows',
        table: x.name,
        rows: x.rows.map((r) =>
          Object.fromEntries(Object.entries(r).map(([k, v]) => [k, plain(v)]))
        ),
      })
    ),
  ].join('\n') + '\n'

/** Where one object's export is written: its own name, then the moment. Kept
 * after the pass — it is the restore path, not a scratch file. */
export let keyOf = (store: string, at: string): string =>
  `store/${store || 'unnamed'}/${at.replaceAll(':', '-')}`

// ---- the pass --------------------------------------------------------------

/** What the pass needs to know that the storage cannot tell it. */
export type Carry = {
  /** the object's own name, which says whether it is the directory */
  store: string
  /** the app this store holds, when the kernel has said — what a split grant is
   * ON. Absent, a level that cannot be carried is named in the report instead of
   * being invented. */
  app: string | null
  /** the vocabulary the new schema is raised from */
  vocab: Vocab
  /** raise that schema — graph.ts's own boot, so there is one planting */
  plant: () => void
  /** the id a mirrored grant is filed under (graph.ts `grantEid`) */
  grantEid: (app: string, person: string) => string
  /** where the export went, for the report */
  export: string
}

// The one relation the fleet spelled in the present tense. Everything else wears
// the same word in both stores, so this is the whole rename table.
let RENAMED: Record<string, string> = { references: 'referenced' }

let ins = (d: Drive, sql: string, params: unknown[]) =>
  d.query(sql, params as never[])

// The integer id of an eid, minting the spine row when there is none. Only the
// split grant needs this: every other row the pass writes rides an id the old
// store already had.
let idOf = (d: Drive, eid: string, minted: { n: number }): number => {
  let [row] = d.query('select id from entity where eid = ?', [eid])
  if (row) return Number(row.id)
  ins(
    d,
    'insert into entity (eid, num) select ?, ' +
      '(select coalesce(max(num), 0) + 1 from entity)',
    [eid],
  )
  minted.n++
  return Number(d.query('select id from entity where eid = ?', [eid])[0].id)
}

/**
 * The whole pass, synchronously — run it inside `transactionSync`, because a
 * throw is how it refuses and the rollback is how it leaves nothing behind.
 *
 * Returns the report when the counts reconcile; throws {@link Refused},
 * carrying the same report, when they do not.
 */
export let carry = (storage: DurableStorage, o: Carry): Report => {
  let d = driver(storage)
  let at = new Date().toISOString()
  let moved: Moved[] = []
  let dropped: { table: string; rows: number }[] = []
  let report = (ok: boolean, message?: string): Report => ({
    store: o.store,
    app: o.app,
    at,
    ok,
    message,
    mark: MARK,
    moved,
    dropped,
    export: o.export,
  })

  // Every definition goes first: leaving one standing would make renaming the
  // table under it rewrite something we are about to replace, and the new
  // schema's own would not raise over the old ones anyway. The search index is
  // filled by its triggers as the doc rows land below, which is why the blob
  // rows are written before the row that addresses them.
  recut(d)
  // A named index would collide with one the new vocabulary declares under the
  // same name; an implicit one (a UNIQUE column) has no SQL and goes with its
  // table.
  for (let i of named(d, 'index')) {
    if (i.sql) d.exec(`drop index if exists ${q(i.name)}`)
  }

  // The base tables, moved aside. The spine is NOT one of them: `entity` and
  // `tombstone` are spelled identically in both layouts, so every integer id,
  // every `num` and every death survives by not being touched.
  let before = { entity: count(d, 'entity'), tombstone: count(d, 'tombstone') }
  let old: string[] = []
  for (let t of named(d, 'table')) {
    if (KEEP.includes(t.name) || t.name.startsWith(ASIDE)) continue
    d.exec(`alter table ${q(t.name)} rename to ${q(ASIDE + t.name)}`)
    old.push(t.name)
  }
  let aside = (name: string) => ASIDE + name
  let there = (name: string) => old.includes(name)
  let from = (name: string) => there(name) ? count(d, aside(name)) : 0

  // The new schema, raised by the object itself, over the spine that stayed.
  // A unique index the vocabulary declares is raised here too, so rows that
  // cannot satisfy it throw out of this transaction rather than landing.
  o.plant()

  let words = o.vocab.all.filter((w) => w != 'entity')
  let carried = new Set<string>()

  // Everything that is a straight copy: the columns the two layouts share, by
  // name. A column the old store had and the vocabulary does not declare has no
  // home and is left behind (named below); a column the vocabulary declares and
  // the old store never had is simply null.
  // A word another word is renamed INTO is filled by that rename below, never
  // here — otherwise a store that held both spellings would write the same
  // entity twice.
  let renamed = new Set(Object.values(RENAMED))
  for (let comp of words) {
    if (comp == 'doc' || renamed.has(comp) || !there(comp)) continue
    let want = new Set(columns(d, comp))
    let have = columns(d, aside(comp)).filter((c) => want.has(c))
    let lost = columns(d, aside(comp)).filter((c) => !want.has(c))
    d.exec(
      `insert into ${q(comp)} (${have.map(q).join(', ')}) ` +
        `select ${have.map(q).join(', ')} from ${q(aside(comp))}`,
    )
    carried.add(comp)
    moved.push({
      table: comp,
      from: from(comp),
      to: count(d, comp),
      ...(lost.length ? { note: `dropped columns: ${lost.join(', ')}` } : {}),
    })
  }

  // `doc.body`: the text out of the old blob backend, addressed by its own
  // SHA-256 and stored under that address in the new one. Two rows become two
  // rows of different shapes; the prose is the same prose.
  let bodies = 0
  if (there('doc')) {
    let rows = there('blob_text')
      ? d.query(
        `select d.entity as id, d.title as title, d.body as at, ` +
          `b.value as body ` +
          `from ${q(aside('doc'))} d left join ${q(aside('blob_text'))} b ` +
          `on b.entity = d.body`,
        [],
      )
      : d.query(
        `select entity as id, title as title, body as at, null as body ` +
          `from ${q(aside('doc'))}`,
        [],
      )
    let seen = new Set<string>()
    // A doc that ADDRESSES a body the blob table does not hold. Every body a
    // store wrote went in there, so this is a row nobody can read — and a body
    // that cannot be read is exactly the thing this pass may not lose.
    let unread = rows.filter((r) => r.at != null && r.body == null).length
    if (unread) {
      throw new Refused(report(
        false,
        `${unread} doc rows address a body the blob table does not hold`,
      ))
    }
    for (let r of rows) {
      let body = r.body == null ? null : String(r.body)
      let sha = body == null ? null : sha256(body)
      if (sha != null && !seen.has(sha)) {
        seen.add(sha)
        ins(
          d,
          'insert or ignore into blob_text (sha, value) values (?, ?)',
          [sha, body],
        )
      }
      ins(d, 'insert into doc (entity, title, body) values (?, ?, ?)', [
        Number(r.id),
        r.title == null ? null : String(r.title),
        sha,
      ])
    }
    bodies = seen.size
    carried.add('doc')
    moved.push({ table: 'doc', from: from('doc'), to: count(d, 'doc') })
    moved.push({
      table: 'blob_text',
      from: from('blob_text'),
      to: count(d, 'blob_text'),
      note: `content-addressed: ${bodies} distinct bodies, ` +
        `the old blob entities are kept as they were`,
    })
  }

  // `references` → `referenced`, and the edge re-addressed with it: an edge's
  // eid is derived from `from|tag|to`, so the tag's new spelling is a new
  // address. The integer id does not move, so every row that points at this
  // edge still points at it.
  for (let [was, now] of Object.entries(RENAMED)) {
    if (!there(was) || !words.includes(now)) continue
    d.exec(
      `insert into ${q(now)} (entity) select entity from ${q(aside(was))}`,
    )
    let ends = there('edge')
      ? d.query(
        `select r.entity as id, f.eid as "from", t.eid as "to" ` +
          `from ${q(aside(was))} r ` +
          `join ${q(aside('edge'))} g on g.entity = r.entity ` +
          `join entity f on f.id = g."from" ` +
          `join entity t on t.id = g."to"`,
        [],
      )
      : []
    for (let e of ends) {
      ins(d, 'update entity set eid = ? where id = ?', [
        edgeEid(String(e.from), now, String(e.to)),
        Number(e.id),
      ])
    }
    carried.add(now)
    moved.push({
      table: now,
      from: from(was),
      to: count(d, now),
      note: `was "${was}"; ${ends.length} edges re-addressed under the new ` +
        `spelling (the other ${from(was) - ends.length} carry no edge row)`,
    })
  }

  // The roster. @yaks/member's seat is `owner|member` and a level is a `grant`;
  // the directory's own `member` declares the three seats itself, so it copies
  // whole and nothing splits.
  let seats = o.vocab.column('member', 'role')?.values ?? []
  let splits = words.includes('grant') && !seats.includes('editor')
  let grants = 0
  let stranded = 0
  // Spine rows the pass MINTED rather than found: a grant is a new entity, and
  // so is the app it is on when this store has never written a row about it.
  // The only rows this pass adds, and the reconciliation names them.
  let minted = { n: 0 }
  if (splits && carried.has('member')) {
    let rows = d.query(
      `select m.entity as id, p.eid as person, m.role as role ` +
        `from ${q(aside('member'))} m left join entity p on p.id = m.person`,
      [],
    )
    for (let r of rows) {
      let was = String(r.role ?? '')
      if (was == 'owner' || !was) continue
      ins(d, `update ${q('member')} set role = 'member' where entity = ?`, [
        Number(r.id),
      ])
      if (!o.app || r.person == null) {
        stranded++
        continue
      }
      let person = String(r.person)
      let eid = o.grantEid(o.app, person)
      ins(
        d,
        `insert or ignore into ${q('grant')} ` +
          `(entity, app, person, access) values (?, ?, ?, ?)`,
        [
          idOf(d, eid, minted),
          idOf(d, o.app, minted),
          idOf(d, person, minted),
          was,
        ],
      )
      grants++
    }
    moved.push({
      table: 'grant',
      from: 0,
      to: count(d, 'grant'),
      note: `minted from ${grants} non-owner member rows` +
        (stranded ? `; ${stranded} had no app to be a grant on` : ''),
    })
  }

  // Every word the new vocabulary names and the old store never had: the table
  // is standing and empty, which is what it should be.
  for (let comp of words) {
    if (carried.has(comp) || !stands(d, comp)) continue
    moved.push({ table: comp, from: 0, to: count(d, comp) })
  }
  moved.push({
    table: 'entity',
    from: before.entity,
    to: count(d, 'entity'),
    ...(minted.n
      ? { note: `${minted.n} minted for the grants and what they are on` }
      : {}),
  })
  moved.push({
    table: 'tombstone',
    from: before.tombstone,
    to: count(d, 'tombstone'),
  })

  // The fleet's other words. No vocabulary names them, so their rows have
  // nowhere to go: the export is where they live now, and the report says so.
  for (let name of old) {
    if (carried.has(name) || RENAMED[name] || name == 'blob_text') continue
    let rows = count(d, aside(name))
    if (rows) dropped.push({ table: name, rows })
  }

  // THE RULE. Every table carries across the number of rows it had, and the
  // three exceptions are each a delta this pass can name:
  //   blob_text  was one row per body, is one row per DISTINCT body
  //   grant      had none, has one per non-owner seat the split moved
  //   entity     gains one spine row per entity those grants named into being
  // Anything else that does not match is a copy that lost or gained a row, and
  // there is no version of that worth marking done.
  let SAID = ['grant', 'blob_text', 'entity']
  let off = moved.filter((m) => !SAID.includes(m.table) && m.from != m.to)
  let spine = moved.find((m) => m.table == 'entity')!
  if (spine.to != spine.from + minted.n) off.push(spine)
  if (off.length) {
    throw new Refused(report(
      false,
      `the counts did not reconcile: ` +
        off.map((m) => `${m.table} ${m.from}→${m.to}`).join(', '),
    ))
  }
  if (splits && grants != count(d, 'grant')) {
    throw new Refused(report(
      false,
      `grant: minted ${grants}, stored ${count(d, 'grant')}`,
    ))
  }

  // The tables aside, gone. A few of the fleet's point at each other rather
  // than at the spine (`blob_text` and `image` both key to `blob`), and dropping
  // a parent while a child still holds rows is a foreign-key failure — so a drop
  // that will not go yet is simply tried again on the next pass, which is the
  // dependency order without having to read it. `pragma foreign_keys` is not the
  // way out: SQLite ignores it inside a transaction, and this is all one.
  let left = old
  while (left.length) {
    let again: string[] = []
    for (let name of left) {
      try {
        d.exec(`drop table if exists ${q(aside(name))}`)
      } catch {
        again.push(name)
      }
    }
    if (again.length == left.length) {
      throw new Refused(report(
        false,
        `these tables would not drop: ${again.join(', ')}`,
      ))
    }
    left = again
  }
  return report(true)
}
