// The write log (T-37968): every write that reaches a store, kept in that
// store's own SQLite before the store applies it, so a store that cannot
// apply it now applies it later instead of losing it. On 2026-09-22 a deploy
// left jill/coaches refusing to boot, and the 888 writes its page sent in
// those 46 minutes were answered with an error and kept nowhere.
//
// Why here, beside the graph and not in the directory, a per-space object or
// a Queue: what fails is the graph above the storage — a migration refused, a
// build that throws — never the SQLite under it, and this table is raised
// before either runs (graph.ts `#start`). Each app's writes stay in its own
// object, nothing global sits on the write path, and a row leaves the log in
// the very transaction that commits its batch (graph.ts `yak/writes`), which
// is what makes a replay exactly once: a Queue or another object could only
// mark it done after the fact.
// The shape is raw SQL that no vocabulary, migration or code version owns,
// so whichever code wakes the object next can read it.
//
// A row is a request as the kernel sent it: its headers (the vouch — who
// wrote, at what level) and its body. It leaves when its batch commits. A
// write the store refused on the caller's own input the first time is
// answered and dropped, as it always was; one that failed for any other
// reason stays, and the store replays the log oldest first on its next
// healthy wake. A replay that the store now refuses (a `$was` that moved, a
// column the app no longer declares) is kept as `refused` with the reason and
// reported, never dropped.
import type { DurableSql } from '@yaks/durable-object'
import { Refused } from '@yaks/graph'

export let WRITES = `create table if not exists yak_writes (
    seq integer primary key autoincrement,
    at text not null,
    headers text not null,
    body text not null,
    state text not null default 'pending',
    tries integer not null default 0,
    why text
  )`

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

/** Keep one write; its place in the log. */
export let keep = (sql: DurableSql, req: Request, body: string): number => {
  let [row] = sql.exec(
    'insert into yak_writes (at, headers, body) values (?, ?, ?) ' +
      'returning seq',
    new Date().toISOString(),
    JSON.stringify([...req.headers]),
    body,
  ).toArray()
  return Number(row.seq)
}

/** The oldest write still waiting. */
export let oldest = (sql: DurableSql): Kept | null => {
  let [row] = sql.exec(
    "select seq, headers, body from yak_writes where state = 'pending' " +
      'order by seq limit 1',
  ).toArray()
  return row
    ? {
      seq: Number(row.seq),
      headers: String(row.headers),
      body: String(row.body),
    }
    : null
}

/** Whether any write is waiting. */
export let waiting = (sql: DurableSql): boolean => oldest(sql) != null

/** The write is applied, or answered as refused: it leaves the log. */
export let done = (sql: DurableSql, seq: number) =>
  void sql.exec('delete from yak_writes where seq = ?', seq)

/** The write failed again, and waits. */
export let tried = (sql: DurableSql, seq: number) =>
  void sql.exec('update yak_writes set tries = tries + 1 where seq = ?', seq)

/** A replay the store refused: kept, with why, and never replayed again. */
export let dead = (sql: DurableSql, seq: number, why: string) =>
  void sql.exec(
    "update yak_writes set state = 'refused', why = ? where seq = ?",
    why,
    seq,
  )

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
export let held = (sql: DurableSql, seq: number): boolean =>
  sql.exec(
    "select 1 from yak_writes where seq = ? and state = 'pending'",
    seq,
  ).toArray().length > 0

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
