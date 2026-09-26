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
// object, nothing global sits on the write path, and a row leaves the log in
// the very transaction that commits its batch (graph.ts `yak/writes`), which
// is what makes a replay exactly once: a Queue or another object could only
// mark it done after the fact.
// The table is a plain one that no vocabulary, migration or code version owns,
// so whichever code wakes the object next can read it.
//
// A row is a request as the kernel sent it: its headers (the vouch — who
// wrote, at what level) and its body. It leaves when its batch commits. A
// write the store refused on the caller's own input the first time is
// answered and dropped, as it always was; one that failed for any other
// reason stays, and the store replays the log oldest first on its next
// healthy wake. A replay that the store now refuses (a `$was` that moved, a
// property the app no longer declares) is kept as `refused` with the reason and
// reported, never dropped.
import { Refused } from '@yaks/graph'
import { carries } from '@yaks/secrets'
import {
  and,
  col,
  type CreateTable,
  type Driver,
  eq,
  lit,
  op,
  select,
  table,
  val,
} from '@yaks/sql'

let LOG = 'yak_writes'

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
  ],
}

let PENDING = eq(col('state'), lit('pending'))
let at = (seq: number) => eq(col('seq'), val(seq))

/** One kept write. */
export type Kept = { seq: number; headers: string; body: string }

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

/** Keep one write; its place in the log. */
export let keep = (db: Driver, req: Request, body: string): number => {
  let [row] = db.query({
    t: 'insert',
    into: LOG,
    cols: ['at', 'headers', 'body'],
    rows: [[
      val(new Date().toISOString()),
      val(JSON.stringify([...req.headers])),
      val(body),
    ]],
    returning: [col('seq')],
  })
  return Number(row.seq)
}

/** The oldest write still waiting. */
export let oldest = (db: Driver): Kept | null => {
  let [row] = db.query(select({
    cols: [col('seq'), col('headers'), col('body')],
    from: table(LOG),
    where: PENDING,
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
export let waiting = (db: Driver): boolean => oldest(db) != null

/** The write is applied, or answered as refused: it leaves the log. */
export let done = (db: Driver, seq: number) =>
  void db.query({ t: 'delete', from: LOG, where: at(seq) })

/** The write failed again, and waits. */
export let tried = (db: Driver, seq: number) =>
  void db.query({
    t: 'update',
    table: LOG,
    set: { tries: op('+', col('tries'), lit(1)) },
    where: at(seq),
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

/** Whether a write is still in the log, waiting. */
export let held = (db: Driver, seq: number): boolean =>
  db.query(select({
    cols: [lit(1)],
    from: table(LOG),
    where: and(at(seq), PENDING),
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
export let parked = (seq: number, why: string): Response =>
  Response.json({
    error: 'Pending',
    message: `${why} — the write is kept and will be applied, in order, ` +
      'when this app recovers; do not send it again',
    pending: seq,
  }, { status: 202 })
