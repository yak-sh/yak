// The write log (T-37968): every write that reaches a store, kept in that
// store's own SQLite before the store applies it, so a store that cannot
// apply it now applies it later instead of losing it. On 2026-09-22 a deploy
// left jill/coaches refusing to boot, and the 888 writes its page sent in
// those 46 minutes were answered with an error and kept nowhere.
//
// Why here, beside the graph and not in the directory, a per-space object or
// a Queue: what fails is the graph above the storage — a schema that will not
// stand, a build that throws — never the SQLite under it, and this table is raised
// before either runs (graph.ts `#start`). Each app's writes stay in its own
// object, nothing global sits on the write path, and a row is removed or
// marked applied in the transaction that commits its batch (`yak/writes`),
// which makes a replay exactly once: a Queue or another object could only
// mark it done after the fact.
// The log tables are plain ones that no vocabulary or app migration owns,
// so whichever code wakes the object next can read it.
//
// A row is a request as the kernel sent it: its headers (the vouch — who
// wrote, at what level) and its body. Ordinary unkeyed writes leave when
// their batch commits; a reviewed retry keeps its body and outcome. A
// write the store refused on the caller's own input the first time is
// answered and dropped, as it always was. While the store cannot start, every
// write waits, and new pending writes replay oldest first on its next healthy
// wake. A write that fails on a store that started is set aside as `failed`,
// so the writes behind it go on, and the next incarnation tries it again: a
// deploy starts one, which is how fixed code reaches it. A reviewed retry
// stays failed until another explicit retry. A replay that the
// store now refuses (a `$was` that moved, a property the app no longer
// declares) is kept as `refused` with the reason and reported, never dropped.
//
// A write the kernel sends carries an idempotency key (door.ts `storeOf`),
// which a resend of it carries too. The row of a keyed write does not leave
// when its batch commits: it stays `applied`, holding the answer it was given,
// for as long as a resend could come (`WINDOW`). A resend is the write it
// repeats: told that answer once applied, and otherwise waiting where the first
// waits. So a write the store committed just before a deploy reset it, and
// that the kernel sent again, is applied once.
import { type Bundle, composed, Refused } from '@yaks/graph'
import { carries } from '@yaks/secrets'
import {
  and,
  col,
  type CreateTable,
  type Driver,
  eq,
  gt,
  isNull,
  lit,
  lt,
  not,
  op,
  or,
  select,
  table,
  val,
} from '@yaks/sql'
import { IDEMPOTENCY } from './door.ts'

let LOG = 'yak_writes'
let KEY = 'idempotency_key'
let ANSWERS = 'yak_write_answers'

export let WRITES: CreateTable = {
  t: 'create table',
  name: LOG,
  ifNot: true,
  cols: [
    { name: 'seq', type: 'integer', pk: true, autoincrement: true },
    { name: 'at', type: 'text', notNull: true },
    { name: 'headers', type: 'text', notNull: true },
    { name: 'body', type: 'text', notNull: true },
    { name: 'state', type: 'text', notNull: true, default: lit('pending') },
    { name: 'tries', type: 'integer', notNull: true, default: lit(0) },
    { name: 'why', type: 'text' },
    { name: KEY, type: 'text' },
    { name: 'answer', type: 'text' },
    { name: 'generation', type: 'integer' },
    { name: 'audit', type: 'integer', notNull: true, default: lit(0) },
    { name: 'status', type: 'integer' },
  ],
}

let PARTS: CreateTable = {
  t: 'create table',
  name: ANSWERS,
  ifNot: true,
  cols: [
    { name: 'seq', type: 'integer', notNull: true },
    { name: 'part', type: 'integer', notNull: true },
    { name: 'body', type: 'text', notNull: true },
  ],
}

/** The log, raised, with every column it predates added: an object keeps its
 * log across code versions, and whichever code wakes it next reads it. */
export let raise = (db: Driver) => {
  db.query(WRITES)
  db.query(PARTS)
  let has = db.query({ t: 'pragma', name: 'table_info', arg: LOG })
    .map((r) => String(r.name))
  for (let add of WRITES.cols) {
    if (!has.includes(add.name)) db.query({ t: 'alter table', table: LOG, add })
  }
  db.query({
    t: 'create index',
    name: `${LOG}_${KEY}`,
    on: LOG,
    cols: [col(KEY)],
    unique: true,
    ifNot: true,
  })
  db.query({
    t: 'create index',
    name: `${ANSWERS}_seq_part`,
    on: ANSWERS,
    cols: [col('seq'), col('part')],
    unique: true,
    ifNot: true,
  })
}

// How long an applied write keeps its answer for a resend. The kernel resends
// at once (door.ts `retryOnce`), so this is room to spare.
let WINDOW = 10 * 60_000

let PENDING = eq(col('state'), lit('pending'))
let FAILED = eq(col('state'), lit('failed'))
let APPLIED = eq(col('state'), lit('applied'))
let RUNNING = eq(col('state'), lit('running'))
let INTERRUPTED = eq(col('state'), lit('interrupted'))
let UNREVIEWED = eq(col('state'), lit('unreviewed'))
let AUDIT = eq(col('audit'), lit(1))
let at = (seq: number) => eq(col('seq'), val(seq))

let outcome = (db: Driver, seq: number) => {
  let rows = db.query(select({
    cols: [col('body')],
    from: table(ANSWERS),
    where: at(seq),
    order: [col('part')],
  }))
  if (!rows.length) throw new Error(`audited write ${seq} has no outcome`)
  return rows.map((r) => String(r.body)).join('')
}

// A reset rolls the graph transaction back, but not this earlier marker. A
// committed write changes or removes its log row in the graph transaction.
export let started = (db: Driver, seq: number) =>
  void db.query({
    t: 'update',
    table: LOG,
    set: { state: lit('running'), tries: op('+', col('tries'), lit(1)) },
    where: and(at(seq), PENDING),
  })

// A running marker survives a reset. Older code could leave a pending write
// after starting it, so every row it left is unreviewed until someone reads
// the body and deliberately retries. New writes carry a generation and retain
// ordinary automatic replay while they have not started.
export let interrupted = (db: Driver) => {
  let running = db.query({
    t: 'update',
    table: LOG,
    set: {
      state: lit('interrupted'),
      why: lit(
        'the Store reset while applying this write; inspect before retrying',
      ),
    },
    where: RUNNING,
    returning: [col('seq')],
  })
  let old = db.query({
    t: 'update',
    table: LOG,
    set: {
      state: lit('unreviewed'),
      why: lit(
        'this write predates attempt tracking; inspect before retrying',
      ),
    },
    where: and(PENDING, isNull(col('generation'))),
    returning: [col('seq')],
  })
  return { running: running.length, unreviewed: old.length }
}

/** Kept writes, with the body only when one is named for inspection. */
export let writes = (db: Driver, seq?: number) =>
  db.query(select({
    cols: [
      col('seq'),
      col('at'),
      col('state'),
      col('tries'),
      col('why'),
      col('status'),
      col('audit'),
      ...(seq == null ? [] : [col('body'), col(KEY), col('answer')]),
    ],
    from: table(LOG),
    where: seq == null ? not(APPLIED) : at(seq),
    order: [col('seq')],
    limit: lit(seq == null ? 100 : 1),
  })).map((r) =>
    seq != null && r.audit == 1 && r.state == 'applied'
      ? { ...r, answer: outcome(db, seq) }
      : r
  )

/** Explicitly retry an interrupted or unreviewed write, keeping its body and
 * key, and keeping its final answer beside them when it commits. */
export let retry = (db: Driver, seq: number): boolean =>
  db.query({
    t: 'update',
    table: LOG,
    set: {
      state: lit('pending'),
      generation: lit(1),
      audit: lit(1),
      why: lit(null),
      answer: lit(null),
      status: lit(null),
    },
    where: and(at(seq), or(INTERRUPTED, UNREVIEWED, and(FAILED, AUDIT))),
    returning: [col('seq')],
  }).length > 0

/** One kept write. */
export type Kept = { seq: number; headers: string; body: string }

/** A write still held for review, without changing its state. */
export let kept = (db: Driver, seq: number): Kept | undefined => {
  let [row] = db.query(select({
    cols: [col('seq'), col('headers'), col('body')],
    from: table(LOG),
    where: and(at(seq), or(INTERRUPTED, UNREVIEWED, and(FAILED, AUDIT))),
    limit: lit(1),
  }))
  return row
    ? {
      seq: Number(row.seq),
      headers: String(row.headers),
      body: String(row.body),
    }
    : undefined
}

/** Whether a request is a write the log keeps: a batch to apply. A dry run
 * (`?check=1`) writes nothing. */
export let logged = (req: Request): boolean => {
  let url = new URL(req.url)
  return req.method == 'POST' && url.pathname == '/apply' &&
    !url.searchParams.has('check')
}

// A Durable Object's SQLite holds at most 2 MB in one row. A bigger body —
// an NDJSON import, which the caller holds as a file and is answered line by
// line — is applied as it comes, without a place in the log.
let ROOM = 1_900_000

/** Whether a body fits in the log. */
export let fits = (body: string): boolean =>
  body.length * 3 <= ROOM || new TextEncoder().encode(body).length <= ROOM

/** Whether a body carries a secret's value (@yaks/secrets `carries`). The log
 * keeps none: a key is kept nowhere but the vault. A body that mentions a
 * secret and cannot be read is taken to carry one. */
export let keyed = (body: string): boolean => {
  if (!body.includes('secret')) return false
  try {
    let said = JSON.parse(body)
    return carries(Array.isArray(said) ? said : said?.entities)
  } catch {
    return true
  }
}

let now = () => new Date().toISOString()

/** Keep one write; its place in the log. The answers no resend can come for
 * any more go as it arrives. */
export let keep = (db: Driver, req: Request, body: string): number => {
  let gone = new Date(Date.now() - WINDOW).toISOString()
  db.query({
    t: 'delete',
    from: LOG,
    where: and(APPLIED, not(AUDIT), lt(col('at'), val(gone))),
  })
  let [row] = db.query({
    t: 'insert',
    into: LOG,
    cols: ['at', 'headers', 'body', KEY, 'generation'],
    rows: [[
      val(now()),
      val(JSON.stringify([...req.headers])),
      val(body),
      val(req.headers.get(IDEMPOTENCY)),
      lit(1),
    ]],
    returning: [col('seq')],
  })
  return Number(row.seq)
}

/** A write the log already holds under an idempotency key. */
export type Sent = {
  seq: number
  state: string
  why: string
  answer: string
  audit: boolean
}

/** The write a key was first sent with, if the log holds it. */
export let first = (db: Driver, key: string): Sent | null => {
  let [row] = db.query(select({
    cols: [col('seq'), col('state'), col('why'), col('answer'), col('audit')],
    from: table(LOG),
    where: eq(col(KEY), val(key)),
  }))
  return row
    ? {
      seq: Number(row.seq),
      state: String(row.state),
      why: String(row.why ?? ''),
      answer: row.audit == 1 && row.state == 'applied'
        ? outcome(db, Number(row.seq))
        : String(row.answer ?? '[]'),
      audit: row.audit == 1,
    }
    : null
}

// Split on Unicode boundaries so every SQLite text value fits the Store's
// row limit and joining the values reproduces the answer byte for byte.
let pieces = function* (text: string) {
  for (let i = 0; i < text.length;) {
    let end = Math.min(i + 300_000, text.length)
    let last = text.charCodeAt(end - 1)
    if (end < text.length && last >= 0xD800 && last <= 0xDBFF) end--
    yield text.slice(i, end)
    i = end
  }
}

/** A committed write, in its batch's own transaction: out of the log, or,
 * sent with a key, kept as `applied` with its answer for a resend to be told.
 * The hook receives phase patches; compose them here to keep exactly what
 * `apply()` returns after the transaction. An audited retry keeps its original
 * body and full answer in chunks. An ordinary keyed answer too big for a row
 * keeps each entity's identity,
 * which is what a caller reads to learn what its aliases minted. */
export let landed = (db: Driver, seq: number, answer: () => Bundle[]) => {
  let [row] = db.query(select({
    cols: [col(KEY), col('audit')],
    from: table(LOG),
    where: at(seq),
  }))
  if (row?.[KEY] == null && row?.audit != 1) return done(db, seq)
  let all = composed(answer())
  let text = JSON.stringify(all)
  if (row.audit == 1) {
    for (let [part, body] of [...pieces(text)].entries()) {
      db.query({
        t: 'insert',
        into: ANSWERS,
        cols: ['seq', 'part', 'body'],
        rows: [[val(seq), val(part), val(body)]],
      })
    }
    db.query({
      t: 'update',
      table: LOG,
      set: { state: lit('applied'), answer: lit(null), status: lit(200) },
      where: at(seq),
    })
    return
  }
  let kept = fits(text) ? text : JSON.stringify(
    all.map(({ entity, $alias }) => ({ entity, $alias })),
  )
  db.query({
    t: 'update',
    table: LOG,
    set: {
      state: lit('applied'),
      ...(row.audit == 1 ? {} : { at: val(now()), body: lit('') }),
      answer: val(kept),
      status: lit(200),
    },
    where: at(seq),
  })
}

/** The oldest write still waiting after `seq`. A replay walks the log forward
 * from one to the next, so it tries no write twice. */
export let next = (db: Driver, seq = 0): Kept | null => {
  let [row] = db.query(select({
    cols: [col('seq'), col('headers'), col('body')],
    from: table(LOG),
    where: and(PENDING, gt(col('seq'), val(seq))),
    order: [col('seq')],
    limit: lit(1),
  }))
  return row
    ? {
      seq: Number(row.seq),
      headers: String(row.headers),
      body: String(row.body),
    }
    : null
}

/** Whether any write is waiting. */
export let waiting = (db: Driver): boolean => next(db) != null

/** The write is answered: it leaves the log, unless it is kept as `applied`
 * for a resend (`landed`). */
export let done = (db: Driver, seq: number) =>
  void db.query({ t: 'delete', from: LOG, where: and(at(seq), not(APPLIED)) })

/** A write that failed on a store that started: set aside with why, so the
 * writes behind it go on. */
export let aside = (db: Driver, seq: number, why: string) =>
  void db.query({
    t: 'update',
    table: LOG,
    set: {
      state: lit('failed'),
      why: val(why),
    },
    where: and(at(seq), or(PENDING, RUNNING)),
  })

/** Every write set aside, waiting again: a new incarnation may be new code. */
export let revived = (db: Driver) =>
  void db.query({
    t: 'update',
    table: LOG,
    set: { state: lit('pending') },
    where: and(FAILED, not(AUDIT)),
  })

/** A replay the store refused: kept, with why, and never replayed again. */
export let dead = (db: Driver, seq: number, why: string) =>
  void db.query({
    t: 'update',
    table: LOG,
    set: { state: lit('refused'), why: val(why) },
    where: at(seq),
  })

/** The request a kept write was, to apply again. */
export let replayed = (k: Kept): Request =>
  new Request('http://store/apply', {
    method: 'POST',
    headers: JSON.parse(k.headers),
    body: k.body,
  })

/** A constraint the batch broke — a unique name already taken, a required
 * column left empty — is the batch's own refusal, not the store failing, and
 * SQLite says which in its message. Left a 500, such a write would wait in
 * the log for code that can never apply it, and hold up every write behind
 * it. */
export let constrained = (e: unknown): unknown =>
  e instanceof Error && /constraint failed/i.test(e.message)
    ? new Refused(e.message)
    : e

/** What an answer said, in its own words. */
export let said = async (r: Response): Promise<string> => {
  let text = await r.text()
  try {
    return String(JSON.parse(text).message ?? text)
  } catch {
    return text
  }
}

/** Whether a write is still in the log, waiting or set aside. */
export let held = (db: Driver, seq: number): boolean =>
  db.query(select({
    cols: [lit(1)],
    from: table(LOG),
    where: and(at(seq), or(PENDING, FAILED, RUNNING)),
  })).length > 0

/** A kept write, as the door that sent it hears it (meta.ts): not applied
 * yet, and not lost. The failure that held it back was reported where it
 * happened, so this is not a defect of its own (sentry.ts `refused`). */
export class Pending extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'Pending'
  }
}

/** What a caller is told when its write is kept but not yet applied. */
export let parked = (seq: number, why: string, review = false): Response =>
  Response.json({
    error: 'Pending',
    message: `${why} — the write is kept and ${
      review
        ? 'needs owner review before it can be retried'
        : 'will be applied when this app recovers'
    }; do not send it again`,
    pending: seq,
  }, { status: 202 })
