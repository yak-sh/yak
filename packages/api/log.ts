/**
 * The write log: a host's keyed writes and their receipts, and the input it
 * could not commit yet, kept in plain SQLite tables beside its graph.
 *
 * - A live keyed request commits its mutation and receipt in one graph
 *   transaction ({@link landing}). Successful input needs no earlier pending
 *   or running row: the caller holds it until acknowledged, and a resend after
 *   a reset either finds the exact committed answer or applies an uncommitted
 *   mutation.
 * - Input that cannot commit is kept with its headers and body, so a host that
 *   is stopped (its row ceiling's window), cannot start, or cannot apply it
 *   recovers without asking the caller to send it again. Pending writes replay
 *   oldest first, one replay at a time (`./receipts.ts` `door`), each live
 *   caller answered as its write lands. Failed writes wait for another incarnation;
 *   interrupted and legacy unreviewed attempts need explicit review. Reviewed
 *   retries keep their input and complete outcome forever.
 * - Every keyed write is kept under its writer's name for its key
 *   ({@link receiptKey}), whichever door it came in at. Ordinary receipts
 *   expire after the resend window; browser outbox receipts and held input
 *   never expire.
 *
 * The tables belong to no vocabulary or app migration. Their place beside
 * the graph makes the receipt and the mutation atomic even when the graph
 * above storage cannot stand. A Store keeps its batches here, a space's
 * Builder the lines a person said while it could not answer them, and every
 * door of @yaks/api its keyed writes' receipts (`./receipts.ts` `received`).
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { open } from '@yaks/sqlite/db'
 * import { done, keep, next, raise, replayed } from './log.ts'
 * let db = open(':memory:')
 * raise(db)
 * let sent = new Request('http://store/apply', { method: 'POST', body: '[]' })
 * let seq = keep(db, sent, '[]')
 * equal([next(db)?.seq, await replayed(next(db)!).text()], [seq, '[]'])
 * done(db, seq)
 * equal(next(db), null)
 * ```
 *
 * @module
 */
import { type Actor, type Bundle, sha256, token } from '@yaks/graph'
import { composed } from '@yaks/graph/bundle'
import { derivedEid } from '@yaks/graph/identity'
import { Refused } from '@yaks/graph/errors'
import { fromBase64, toBase64 } from '@yaks/fp'
import {
  among,
  and,
  col,
  type CreateTable,
  desc,
  type Driver,
  eq,
  type Expr,
  ge,
  gt,
  isNull,
  lit,
  lt,
  not,
  op,
  or,
  select,
  type Stmt,
  table,
  val,
} from '@yaks/sql'
import type { Vocab } from '@yaks/vocab'
import { BINARY, decode, stringify, unpack } from '@yaks/vocab/wire'
import { readBody, receiveBody } from './body.ts'

/** The header a caller names one write by, across its sends. */
export let IDEMPOTENCY = 'idempotency-key'

// ---- a body as the log keeps it ---------------------------------------------

// A binary apply is kept undecoded: decoding needs the words a store's start
// reads, and a write is kept before its store has started, while it may not
// and when it can't. The log holds the envelope as it came, in base64 beside
// the headers that say it is binary, and its store decodes it as it lands.
/** Whether headers say their body is a binary envelope. */
export let binaryHeaders = (headers: Headers): boolean =>
  headers.get('content-type')?.split(';')[0].trim() == BINARY

/** A write's body as the log keeps it, and its bundles as it says them before
 * any decoding, which is what a secret is looked for in. A JSON body is its
 * text, both times; a binary one is its envelope in base64, and the
 * envelope's header with its references. An envelope that can't be read is
 * refused here, while its caller still holds it.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { binary, BINARY } from '@yaks/vocab/wire'
 * import { opened, taken } from './log.ts'
 * let raw = binary([{ entity: { eid: 'a' }, photo: { bytes: Uint8Array.of(7) } }])
 * let sent = (body: BodyInit, type = BINARY) =>
 *   new Request('http://store/apply', { method: 'POST', headers: { 'content-type': type }, body })
 * let { body, told } = await taken(sent(raw))
 * equal(told, '[{"entity":{"eid":"a"},"photo":{"bytes":{"$bytes":0,"length":1}}}]')
 * equal(opened(new Headers({ 'content-type': BINARY }), body), raw)
 * equal(await taken(sent('[]', 'application/json')), { body: '[]', told: '[]' })
 * equal(opened(new Headers(), '[]'), '[]')
 * ```
 */
export let taken = async (
  request: Request,
): Promise<{ body: string; told: string }> => {
  if (!binaryHeaders(request.headers)) {
    let body = await readBody(request)
    return { body, told: body }
  }
  let raw = new Uint8Array(
    await receiveBody(request, () => request.arrayBuffer()),
  )
  return { body: toBase64(raw), told: JSON.stringify(unpack(raw).value) }
}

/** A kept body as it was sent: the envelope of a binary one (`taken`), the
 * text of any other. */
export let opened = (
  headers: Headers,
  body: string,
): string | Uint8Array<ArrayBuffer> =>
  binaryHeaders(headers) ? fromBase64(body) : body

/** What a kept body says once its words are known: a binary one's envelope
 * decoded in them, as a JSON one's base64 values are. Only declared binary
 * properties interpret payload references.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { loadVocab } from '@yaks/vocab'
 * import { binary, BINARY } from '@yaks/vocab/wire'
 * import { decoded, taken } from './log.ts'
 * let vocab = loadVocab({ $defs: { photo: { component: true, type: 'object',
 *   properties: { bytes: { type: 'string', contentEncoding: 'base64' } } } } })
 * let bundle = { entity: { eid: 'a' }, photo: { bytes: Uint8Array.of(7) } }
 * let { body } = await taken(new Request('http://store/apply', {
 *   method: 'POST', headers: { 'content-type': BINARY }, body: binary([bundle]),
 * }))
 * equal(decoded(vocab, new Headers({ 'content-type': BINARY }), body), [bundle])
 * equal(decoded(vocab, new Headers(), '[{"photo":{"bytes":{"$bytes":"Bw==","encoding":"base64"}}}]'),
 *   [{ photo: { bytes: Uint8Array.of(7) } }])
 * ```
 */
export let decoded = (
  vocab: Pick<Vocab, 'def'>,
  headers: Headers,
  body: string,
): unknown => {
  if (!binaryHeaders(headers)) return decode(vocab, JSON.parse(body))
  let packed = unpack(fromBase64(body))
  return decode(vocab, packed.value, packed.payload)
}

// ---- the log ----------------------------------------------------------------

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

/** The empty write log and its indexes, shared with prepared test stores. */
export let schema = (): Stmt[] => [
  WRITES,
  PARTS,
  {
    t: 'create index',
    name: `${LOG}_${KEY}`,
    on: LOG,
    cols: [col(KEY)],
    unique: true,
    ifNot: true,
  },
  // Ordinary keyed receipts last ten minutes; outbox receipts last forever.
  // Neither pending work nor expiry may scan that retained history.
  {
    t: 'create index',
    name: `${LOG}_pending`,
    on: LOG,
    cols: [col('seq')],
    where: eq(col('state'), lit('pending')),
    ifNot: true,
  },
  {
    t: 'create index',
    name: `${LOG}_expiring`,
    on: LOG,
    cols: [col('at')],
    where: EXPIRABLE,
    ifNot: true,
  },
  {
    t: 'create index',
    name: `${ANSWERS}_seq_part`,
    on: ANSWERS,
    cols: [col('seq'), col('part')],
    unique: true,
    ifNot: true,
  },
  // Waking repairs only interrupted attempts, never successful history.
  ...['running', 'failed'].map((state): Stmt => ({
    t: 'create index',
    name: `${LOG}_${state}`,
    on: LOG,
    cols: [col('seq')],
    where: eq(col('state'), lit(state)),
    ifNot: true,
  })),
]

/** The log, raised, with every column it predates added: an object keeps its
 * log across code versions, and whichever code wakes it next reads it. */
export let raise = (db: Driver): void => {
  db.query(WRITES)
  db.query(PARTS)
  let has = db.query({ t: 'pragma', name: 'table_info', arg: LOG })
    .map((r) => String(r.name))
  for (let add of WRITES.cols) {
    if (!has.includes(add.name)) {
      db.query({ t: 'alter table', table: LOG, add })
    }
  }
  for (let stmt of schema().slice(2)) db.query(stmt)
  // The old index included durable receipts: retire it after its replacement.
  db.query({ t: 'drop', kind: 'index', name: `${LOG}_expiry`, ifExists: true })
}

// How long an applied write keeps its answer for a resend. The kernel resends
// within half a minute (@yaks/durable-object `backoff`), so this is room to
// spare.
let WINDOW = 10 * 60_000
let BATCH = 16

// What a connection knows of its log without reading it: when it last expired
// receipts, and that it holds no waiting write, from the last look until
// something keeps one (`keep`, `retry`, `revived`). Every row in the log is
// written here, so a look is good until one of those runs.
let swept = new WeakMap<object, number>()
let idle = new WeakSet<object>()
let of = (db: Driver): object => db.connection ?? db

let PENDING: Expr = eq(col('state'), lit('pending'))
let FAILED: Expr = eq(col('state'), lit('failed'))
let APPLIED: Expr = eq(col('state'), lit('applied'))
let RUNNING: Expr = eq(col('state'), lit('running'))
let INTERRUPTED: Expr = eq(col('state'), lit('interrupted'))
let UNREVIEWED: Expr = eq(col('state'), lit('unreviewed'))
let AUDIT: Expr = eq(col('audit'), lit(1))
// Case-sensitive, just like the browser's stable key prefix. Keep this in the
// partial index too, so expiry never walks indefinitely retained receipts.
let EXPIRABLE: Expr = and(
  APPLIED,
  not(AUDIT),
  or(isNull(col(KEY)), not(op('glob', col(KEY), lit('outbox:*')))),
)

/** Browser outbox intents need the same answer even after hours offline. */
export let durable = (key: string | null): boolean =>
  key?.startsWith('outbox:') ?? false
let at = (seq: number): Expr => eq(col('seq'), val(seq))

let outcome = (db: Driver, seq: number): string => {
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
export let started = (db: Driver, seq: number): void =>
  void db.query({
    t: 'update',
    table: LOG,
    set: { state: lit('running'), tries: op('+', col('tries'), lit(1)) },
    where: and(at(seq), PENDING),
  })

/** A started write its store stopped before it could apply it
 * (`./receipts.ts` `replays`): waiting again, its try not counted, so the
 * replay after the wait takes it as it was. Its transaction unwound, so
 * nothing of it landed. Without `seq`, every write a reset cut off, for a
 * host that hears a write only in the transaction that lands it, so a reset
 * left nothing of one it started (a Builder's line). */
export let unstarted = (db: Driver, seq?: number): void => {
  idle.delete(of(db))
  db.query({
    t: 'update',
    table: LOG,
    set: { state: lit('pending'), tries: op('-', col('tries'), lit(1)) },
    where: seq == null ? RUNNING : and(at(seq), RUNNING),
  })
}

// A running marker survives a reset. Older code could leave a pending write
// after starting it, so every row it left is unreviewed until someone reads
// the body and deliberately retries. New writes carry a generation and retain
// ordinary automatic replay while they have not started.
export let interrupted = (
  db: Driver,
): { running: number; unreviewed: number } => {
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
export let writes = (
  db: Driver,
  seq?: number,
  recent = false,
): Record<string, unknown>[] =>
  db.query(select({
    cols: [
      col('seq'),
      col('at'),
      col('state'),
      col('tries'),
      col('why'),
      col('status'),
      col('audit'),
      col('headers'),
      ...(seq == null ? [] : [col('body'), col(KEY), col('answer')]),
    ],
    from: table(LOG),
    where: seq == null ? recent ? undefined : not(APPLIED) : at(seq),
    order: [recent ? desc(col('seq')) : col('seq')],
    limit: lit(seq == null ? 100 : 1),
  })).map(({ headers, ...r }) => ({
    ...r,
    kernel: new Headers(JSON.parse(String(headers))).get('x-yak-kernel') ==
      '1',
    ...(seq != null && r.answer == null && r.state == 'applied'
      ? { answer: outcome(db, seq) }
      : {}),
  }))

/** Explicitly retry an interrupted or unreviewed write, keeping its body and
 * key, and keeping its final answer beside them when it commits. */
export let retry = (db: Driver, seq: number): boolean => {
  idle.delete(of(db))
  return db.query({
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
}

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
export let ROOM = 1_900_000

/** Whether a body fits in the log. */
export let fits = (body: string): boolean =>
  body.length * 3 <= ROOM || new TextEncoder().encode(body).length <= ROOM

// A write is stamped, and its receipts expire, on the clock of the host that
// keeps the log; unset, the runtime's.
let stamp = (now: () => number) => new Date(now()).toISOString()

/** Expire a bounded batch of ordinary receipts, never held user input.
 * A backlog is paid down by subsequent writes; an empty tail is checked at
 * most once a tenth of the resend window. An app write never owes the whole
 * directory's idle history. */
let expire = (db: Driver, now: () => number) => {
  let t = now()
  if (t - (swept.get(of(db)) ?? -Infinity) < WINDOW / 10) return
  let gone = new Date(t - WINDOW).toISOString()
  let rows = db.query({
    t: 'delete',
    from: LOG,
    where: among(
      col('seq'),
      select({
        cols: [col('seq')],
        from: table(LOG),
        where: and(EXPIRABLE, lt(col('at'), val(gone))),
        order: [col('at')],
        limit: lit(BATCH),
      }),
    ),
    returning: [col('seq'), col('answer')],
  })
  for (let row of rows) {
    if (row.answer == null) {
      db.query({ t: 'delete', from: ANSWERS, where: at(Number(row.seq)) })
    }
  }
  if (rows.length < BATCH) swept.set(of(db), t)
}

/** Keep one write that cannot commit now; its place in the replay log. */
export let keep = (
  db: Driver,
  req: Request,
  body: string,
  now: () => number = Date.now,
): number => {
  expire(db, now)
  idle.delete(of(db))
  let [row] = db.query({
    t: 'insert',
    into: LOG,
    cols: ['at', 'headers', 'body', KEY, 'generation'],
    rows: [[
      val(stamp(now)),
      val(JSON.stringify([...req.headers])),
      val(body),
      val(req.headers.get(IDEMPOTENCY)),
      lit(1),
    ]],
    returning: [col('seq')],
  })
  return Number(row.seq)
}

// Internal evidence binds both the routed bytes and the original spanning intent.
// Recompute at the host's door: a caller-supplied digest is never evidence.
export let INTENT = 'x-yak-outbox-intent'
let FINGERPRINT = 'x-yak-outbox-fingerprint'
export let fingerprinted = (request: Request, body: string): Request => {
  if (!durable(request.headers.get(IDEMPOTENCY))) return request
  let headers = new Headers(request.headers)
  headers.set(
    FINGERPRINT,
    sha256(JSON.stringify([
      body,
      headers.get(INTENT),
      headers.get('x-yak-person'),
    ])),
  )
  return new Request(request, { headers, body: opened(headers, body) })
}

/**
 * The key the log keeps a write under: its writer's and its sender's key as
 * one name, so one writer's key never reads another's receipt. An outbox
 * key's name is an outbox key too, kept for good ({@link durable}); any
 * other expires after the resend window.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { durable, receiptKey } from './log.ts'
 * let ada = { by: 'ada' }
 * equal(receiptKey(ada, 'k') == receiptKey({ by: 'bob' }, 'k'), false)
 * equal(receiptKey(ada, 'k') == receiptKey(ada, 'k'), true)
 * equal([durable(receiptKey(ada, 'outbox:k')), durable(receiptKey(ada, 'k'))],
 *   [true, false])
 * ```
 */
export let receiptKey = (writer: Actor | null, key: string): string => {
  let id = derivedEid(
    `api receipt|${token([writer?.by ?? null, writer?.via ?? null, key])}`,
  )
  return `${durable(key) ? 'outbox:' : ''}receipt:${id}`
}

// The keys a log names (`receiptKey`) sort in two runs, `outbox:receipt:…`
// and `receipt:…`; a key kept as its sender said it sorts outside both, so
// the key's index finds those alone. A row with no key compares as neither.
let UNNAMED: Expr = or(
  lt(col(KEY), lit('outbox:receipt:')),
  and(ge(col(KEY), lit('outbox:receipt;')), lt(col(KEY), lit('receipt:'))),
  ge(col(KEY), lit('receipt;')),
)

/** A request with its key named by its writer ({@link receiptKey}), as the
 * log keeps it; one with no key as it is. Its body is taken along unread. */
export let owned = (request: Request, writer: Actor | null): Request => {
  let key = request.headers.get(IDEMPOTENCY)
  if (!key) return request
  let headers = new Headers(request.headers)
  headers.set(IDEMPOTENCY, receiptKey(writer, key))
  return new Request(request, { headers })
}

/**
 * Every key the log holds as its sender said it, named by its writer
 * ({@link receiptKey}), in its column and in the headers its write is
 * replayed with: a log kept by code that took a key as it came. `writer` says
 * who sent each, from its request's headers. How many it named; a log named
 * already costs one look at the key's index.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { open } from '@yaks/sqlite/db'
 * import { first, keep, raise, receiptKey, rekey } from './log.ts'
 * let db = open(':memory:')
 * raise(db)
 * let sent = new Request('http://store/apply', {
 *   method: 'POST', headers: { 'idempotency-key': 'k', 'x-by': 'ada' },
 * })
 * keep(db, sent, '[]')
 * let writer = (r: Request) => ({ by: r.headers.get('x-by')! })
 * equal([rekey(db, writer), rekey(db, writer)], [1, 0])
 * equal(first(db, receiptKey({ by: 'ada' }, 'k'))?.seq, 1)
 * ```
 */
export let rekey = (
  db: Driver,
  writer: (request: Request) => Actor | null,
): number => {
  let rows = db.query(select({
    cols: [col('seq'), col(KEY), col('headers')],
    from: table(LOG),
    where: UNNAMED,
  }))
  for (let row of rows) {
    let headers = new Headers(JSON.parse(String(row.headers)))
    let key = receiptKey(
      writer(new Request('http://log/', { headers })),
      String(row[KEY]),
    )
    headers.set(IDEMPOTENCY, key)
    db.query({
      t: 'update',
      table: LOG,
      set: { [KEY]: val(key), headers: val(JSON.stringify([...headers])) },
      where: at(Number(row.seq)),
    })
  }
  return rows.length
}

/** The request a door that names its writes itself keeps a receipt under
 * (`./receipts.ts` `received`): its `key` for the write ({@link
 * receiptKey}), bound to the body `digest` names. */
export let named = (key: string, digest: string): Request =>
  new Request('http://receipt/apply', {
    method: 'POST',
    headers: { [IDEMPOTENCY]: key, [FINGERPRINT]: digest },
  })

/** A write the log already holds under an idempotency key. */
export type Sent = {
  seq: number
  state: string
  why: string
  answer: string
  audit: boolean
}

/** The write a key was first sent with, if the log holds it. */
export let first = (
  db: Driver,
  key: string,
  request?: Request,
): Sent | null => {
  let [row] = db.query(select({
    cols: [
      col('seq'),
      col('state'),
      col('why'),
      col('answer'),
      col('audit'),
      ...(durable(key) && request ? [col('headers')] : []),
    ],
    from: table(LOG),
    where: eq(col(KEY), val(key)),
  }))
  if (row && durable(key) && request) {
    let before = new Headers(JSON.parse(String(row.headers)))
    let digest = request.headers.get(FINGERPRINT)
    if (!digest || before.get(FINGERPRINT) != digest) {
      throw new Refused('outbox key was already used for a different intent')
    }
  }
  return row
    ? {
      seq: Number(row.seq),
      state: String(row.state),
      why: String(row.why ?? ''),
      answer: row.state == 'applied' && row.answer == null
        ? outcome(db, Number(row.seq))
        : String(row.answer ?? '[]'),
      audit: row.audit == 1,
    }
    : null
}

/** Cached acceptance after the caller has checked current write authority.
 * Durable requests must have been fingerprinted from their body at the door. */
export let remembered = (
  db: Driver,
  key: string,
  request: Request,
): Response | null => {
  let was = first(db, key, request)
  return was?.state == 'applied'
    ? new Response(was.answer, {
      headers: { 'content-type': 'application/json' },
    })
    : null
}

// Split on Unicode boundaries so every SQLite text value fits the host's
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

/** A successful live request has no earlier log row. The graph commit hook
 * inserts its receipt in the same transaction as the mutation. With no receipt
 * there is no committed mutation; the caller still holds its unacknowledged
 * input and may resend after a reset. */
export type Receipt = { request: Request }
export let received = (
  db: Driver,
  receipt: Receipt,
  answer: () => Bundle[],
  now: () => number = Date.now,
) => {
  let key = receipt.request.headers.get(IDEMPOTENCY)
  if (!key) return
  expire(db, now)
  let text = stringify(composed(answer()))
  let whole = fits(text)
  // Its sequence number is asked back only for an answer kept in parts: a
  // returned row is a row read.
  let [row] = db.query({
    t: 'insert',
    into: LOG,
    cols: [
      'at',
      'headers',
      'body',
      KEY,
      'generation',
      'state',
      'answer',
      'status',
    ],
    rows: [[
      val(stamp(now)),
      val(JSON.stringify([...receipt.request.headers])),
      lit(''),
      val(key),
      lit(1),
      lit('applied'),
      val(whole ? text : null),
      lit(200),
    ]],
    returning: whole ? undefined : [col('seq')],
  })
  if (!whole) chunks(db, Number(row.seq), text)
}

let chunks = (db: Driver, seq: number, text: string) => {
  for (let [part, body] of [...pieces(text)].entries()) {
    db.query({
      t: 'insert',
      into: ANSWERS,
      cols: ['seq', 'part', 'body'],
      rows: [[val(seq), val(part), val(body)]],
    })
  }
}

/** A committed write, in its batch's own transaction: out of the log, or,
 * sent with a key, kept as `applied` with its answer for a resend to be told.
 * The hook receives phase patches; compose them here to keep exactly what
 * `apply()` returns after the transaction. An audited retry keeps its original
 * body and full answer in chunks. Ordinary large answers use chunks too,
 * so every resend receives the complete canonical answer. */
export let landed = (
  db: Driver,
  seq: number,
  answer: () => Bundle[],
  now: () => number = Date.now,
): void => {
  let [row] = db.query(select({
    cols: [col(KEY), col('audit')],
    from: table(LOG),
    where: at(seq),
  }))
  if (row?.[KEY] == null && row?.audit != 1) return done(db, seq)
  let all = composed(answer())
  let text = stringify(all)
  if (row.audit == 1 || !fits(text)) chunks(db, seq, text)
  db.query({
    t: 'update',
    table: LOG,
    set: {
      state: lit('applied'),
      ...(row.audit == 1 ? {} : { at: val(stamp(now)), body: lit('') }),
      answer: val(row.audit == 1 || !fits(text) ? null : text),
      status: lit(200),
    },
    where: at(seq),
  })
}

/** The oldest write still waiting after `seq`. A replay walks the log forward
 * from one to the next, so it tries no write twice. */
export let next = (db: Driver, seq = 0): Kept | null => {
  if (idle.has(of(db))) return null
  let [row] = db.query(select({
    cols: [col('seq'), col('headers'), col('body')],
    from: table(LOG),
    where: and(PENDING, gt(col('seq'), val(seq))),
    order: [col('seq')],
    limit: lit(1),
  }))
  if (!row && !seq) idle.add(of(db))
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
export let done = (db: Driver, seq: number): void =>
  void db.query({ t: 'delete', from: LOG, where: and(at(seq), not(APPLIED)) })

/** A write that failed on a store that started: set aside with why, so the
 * writes behind it go on. */
export let aside = (db: Driver, seq: number, why: string): void =>
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
export let revived = (db: Driver): void => {
  idle.delete(of(db))
  db.query({
    t: 'update',
    table: LOG,
    set: { state: lit('pending') },
    where: and(FAILED, not(AUDIT)),
  })
}

/** A replay the store refused: kept, with why, and never replayed again. */
export let dead = (db: Driver, seq: number, why: string): void =>
  void db.query({
    t: 'update',
    table: LOG,
    set: { state: lit('refused'), why: val(why) },
    where: at(seq),
  })

/** The request a kept write was, to send `at` its door again (a Store's
 * `/apply` unless said): a binary one's envelope as it came, which its
 * apply door decodes ({@link decoded}). */
export let replayed = (k: Kept, at = 'http://store/apply'): Request => {
  let headers = new Headers(JSON.parse(k.headers))
  return new Request(at, {
    method: 'POST',
    headers,
    body: opened(headers, k.body),
  })
}

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

/** Every write still in the log, oldest first: waiting, under way or set
 * aside, and how many times each was tried. What a host that keeps a
 * person's own words shows them of those words (a Builder's kept lines).
 * One read a state, each on its own index: a log also keeps receipts, and
 * an outbox's for good.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { open } from '@yaks/sqlite/db'
 * import { aside, keep, raise, started, unanswered } from './log.ts'
 * let db = open(':memory:')
 * raise(db)
 * let sent = new Request('http://builder/say', { method: 'POST' })
 * let one = keep(db, sent, 'one'), two = keep(db, sent, 'two')
 * started(db, one)
 * aside(db, one, 'unreachable')
 * equal(unanswered(db).map((k) => [k.seq, k.body, k.tries]), [[one, 'one', 1], [two, 'two', 0]])
 * ```
 */
export let unanswered = (db: Driver): (Kept & { tries: number })[] =>
  [PENDING, RUNNING, FAILED].flatMap((where) =>
    db.query(select({
      cols: [col('seq'), col('headers'), col('body'), col('tries')],
      from: table(LOG),
      where,
    }))
  ).map((r) => ({
    seq: Number(r.seq),
    headers: String(r.headers),
    body: String(r.body),
    tries: Number(r.tries),
  })).sort((a, b) => a.seq - b.seq)

/** A kept write, as the door that sent it hears it (meta.ts): not applied
 * yet, and not lost. The failure that held it back was reported where it
 * happened, so this is not a defect of its own (defects.ts `refused`). A
 * store that kept it while stopped says how long until it lands
 * (`retry.after`, in ms), which a door passes on as `retry-after`. */
export class Pending extends Error {
  retry?: { after: number }
  constructor(message: string, after = 0) {
    super(message)
    this.name = 'Pending'
    if (after > 0) this.retry = { after }
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
