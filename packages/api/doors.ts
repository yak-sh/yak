// The two HTTP endpoints, `/apply` and `/query`. Both are thin on purpose:
// read the request, hand the graph a query or an array of bundles, respond
// with JSON. Everything that decides anything — what a caller may write,
// whether a precondition still holds, who gets notified — lives in
// @yaks/graph or in the subscription registry, not here.
//
// `/apply` also accepts an import too big to hold in memory: NDJSON, one
// bundle per line, applied in chunks and responded to as it goes (`pour`). It
// is the same endpoint, the same `apply()` and the same refusals — what
// changes is that neither the request body nor the response body is ever
// whole in memory.

import { type Bundle, type Change, type Graph, Refused } from '@yaks/graph'
import type { Actor, Row } from '@yaks/graph'
import { parse, type Query } from '@yaks/query'
import { signed } from './actor.ts'
import { json, refusal } from './refuse.ts'

/**
 * How many bundles go into one transaction when an import arrives one bundle
 * per line. It is the width the D1 adapter's round-trip limit counts — 50
 * bundles cost the same two round trips as one (packages/d1 `hops_test.ts`) —
 * so a chunk is as wide as the network carries for free.
 */
export let CHUNK = 50

// Whether this request body is NDJSON. `application/x-ndjson` is the media
// type the guide shows; `application/ndjson` is the same one without the
// historical `x`, and both are used in practice.
let poured = (request: Request): boolean =>
  (request.headers.get('content-type') ?? '').toLowerCase().includes('ndjson')

// The body's lines as they arrive, each with the 1-based number it was on.
// Nothing is held but the line being read and the tail of the last read, so a
// 10 MB import is never a 10 MB string and never one `JSON.parse`.
let lines = async function* (
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<[number, string]> {
  let reader = body.getReader()
  let decoder = new TextDecoder()
  let held = ''
  let at = 0
  for (;;) {
    let { done, value } = await reader.read()
    let text = done ? decoder.decode() : decoder.decode(value, { stream: true })
    if (text) {
      let parts = (held + text).split('\n')
      held = parts.pop()!
      for (let p of parts) yield [++at, p]
    }
    if (done) break
  }
  if (held) yield [++at, held]
}

// Which bundle of a refused chunk caused the refusal. A chunk is one
// transaction, so the error names the whole chunk and not a line — and
// somebody staring at a 10 MB file needs the line number. So the refused
// chunk is re-applied with one bundle left out at a time (with `check`, which
// rolls back before it commits): the bundle whose absence lets the rest
// through is the offender. Nothing is re-applied until something has already
// gone wrong, and when no single bundle is responsible — two bad lines, or a
// chunk refused as a whole — the chunk's first line is reported.
let culprit = async (graph: Graph, chunk: Change): Promise<number> => {
  for (let i = 0; i < chunk.length; i++) {
    let rest = chunk.filter((_, j) => j != i)
    if (!rest.length) return i
    try {
      await graph.apply(rest, { check: true })
      return i
    } catch {
      // Still refused: that bundle was not what broke it.
    }
  }
  return 0
}

// The lines of a chunk as the graph returned them, in the graph's order. A
// bundle whose entity was minted through an alias comes back under `$alias`;
// every other one comes back under its eid.
let asked = (held: Bundle[], applied: Bundle[]): Bundle[] => {
  let keys = new Set(held.map((b) => b.entity.eid))
  return applied.filter((b) => keys.has(b.$alias ?? b.entity.eid))
}

/**
 * `POST /apply` with `content-type: application/x-ndjson` — one bundle per
 * line, applied {@link CHUNK} at a time, and responded to the same way: the
 * composed bundles, one JSON object per line, written as each chunk commits.
 * Blank lines are skipped. Neither body is ever whole in memory, so an import
 * is bounded by the file rather than by the parser or the transaction.
 *
 * The response is line for line: a bundle a plugin adds alongside the ones
 * sent (an archetype descriptor, an entity deleted by a cascade) is the
 * graph's own bookkeeping, not a line the importer wrote, and is left out.
 *
 * The status is 200 whatever happens, because the first bundles have already
 * been written to the response before a later line can be refused. So a
 * refusal is the last line of the body instead — what `apply()` threw, plus
 * two numbers:
 *
 * ```json
 * {"error":"Refused","message":"unknown column: book.colour","line":137,"committed":100}
 * ```
 *
 * `line` is the 1-based line the offending bundle was on, and `committed` how
 * many bundles were written before it. Nothing after that line is read.
 * (Under `?check=1` every chunk is rolled back, so `committed` counts what
 * would have been written.)
 *
 * **An alias resolves within its own chunk and nowhere else.** A bundle
 * naming `$x` and the bundle minting it have to fall in the same run of
 * {@link CHUNK} lines, because that run is the whole array the graph is ever
 * shown.
 */
export let pour = (
  graph: Graph,
  request: Request,
  who: Actor | null,
): Response => {
  let body = request.body
  if (!body) throw new Refused('/apply takes one bundle per line')
  let check = new URL(request.url).searchParams.has('check')
  let out = new TransformStream<Uint8Array, Uint8Array>()
  let writer = out.writable.getWriter()
  let bytes = new TextEncoder()
  // Awaited, so a slow reader slows the import down rather than piling the
  // whole response up behind itself.
  let say = (v: unknown) => writer.write(bytes.encode(`${JSON.stringify(v)}\n`))

  let run = async () => {
    let held: Bundle[] = []
    let at: number[] = []
    let committed = 0
    // The line number a refusal belongs to: the line being read, until a
    // chunk is refused and one of its own lines is identified.
    let blame = 0
    let flush = async () => {
      let batch = signed(held, who)
      let applied: Bundle[]
      try {
        applied = await graph.apply(batch, { check })
      } catch (err) {
        blame = at[await culprit(graph, batch)]
        throw err
      }
      for (let b of asked(held, applied)) await say(b)
      committed += held.length
      held = []
      at = []
    }
    try {
      for await (let [n, line] of lines(body)) {
        if (!line.trim()) continue
        blame = n
        held.push(JSON.parse(line) as Bundle)
        at.push(n)
        if (held.length == CHUNK) await flush()
      }
      if (held.length) await flush()
    } catch (err) {
      await say({ ...refusal(err), line: blame, committed })
    }
  }
  run().catch(() => {}).finally(() => writer.close().catch(() => {}))
  return new Response(out.readable, {
    headers: { 'content-type': 'application/x-ndjson' },
  })
}

/**
 * `POST /apply` — a JSON array of bundles in, that array as applied out. The
 * request body is a `Change`; the response body is the array `apply()`
 * returned, including server-written stamps and any entity a cascading delete
 * took with it.
 *
 * `?check=1` asks only whether the array would be accepted: every phase runs
 * and the transaction is rolled back, so nothing is written and no effect
 * observes it, while a refusal is still a refusal. That is what lets one set
 * of changes be spread over several graphs — ask them all, then commit.
 *
 * `content-type: application/x-ndjson` is the same endpoint for an import too
 * big to hold in memory — see {@link pour}.
 */
export let write = async (
  graph: Graph,
  request: Request,
  who: Actor | null,
): Promise<Response> => {
  if (poured(request)) return pour(graph, request, who)
  let body = await request.json()
  if (!Array.isArray(body)) {
    throw new Refused('/apply takes a JSON array of bundles')
  }
  let check = new URL(request.url).searchParams.has('check')
  return json(await graph.apply(signed(body, who), { check }))
}

// The query string a request carries: `?q=` on a GET, and on a POST either a
// bare JSON string or `{ q }`.
let lineOf = (body: unknown): string | null => {
  if (typeof body == 'string') return body
  if (body && typeof body == 'object' && 'q' in body) {
    return typeof body.q == 'string' ? body.q : null
  }
  return null
}

/** The three query clauses that reduce a selection to a value instead of
 * naming its members. A query carrying one is asking a different question, so
 * `/query` reads it off the parsed query before anything gathers a bundle
 * nobody asked for. */
type Agg = 'count' | 'distinct' | 'tally'
let AGGS = new Set(['count', 'distinct', 'tally'])
let aggregate = (ast: Query): Agg | undefined =>
  ast.clauses.find((c) => AGGS.has(c.kind))?.kind as Agg | undefined

/** An aggregate's rows as the JSON response body. The compiled statement
 * returns one `{value, n}` row per value (`.count!` under the empty key,
 * since no tally keeps an empty one), and each clause has its own shape: a
 * count is the number, a distinct the values, a tally the map. Sorted by
 * value, so two stores answering the same question answer in the same
 * order. */
let reduced = (op: Agg, rows: Row[]): unknown => {
  if (op == 'count') return { count: Number(rows[0]?.n ?? 0) }
  let values = rows.map((r) => String(r.value)).sort()
  if (op == 'distinct') return { distinct: values }
  let at = new Map(rows.map((r) => [String(r.value), Number(r.n ?? 0)]))
  return { tally: Object.fromEntries(values.map((v) => [v, at.get(v)])) }
}

/**
 * `GET /query?q=…` or `POST /query` — a query string in, the bundles it
 * selects out.
 *
 * Unless the query asks for a reduction. `.count!`, `.distinct=col` and
 * `.tally=col` are questions about the selection rather than about its
 * members, and the store answers each with one SQL statement (`rows()` rather
 * than `read()`); the response body is then `{"count":n}`, `{"distinct":[…]}`
 * or `{"tally":{…}}`.
 */
export let ask = async (graph: Graph, request: Request): Promise<Response> => {
  let q = request.method == 'GET'
    ? new URL(request.url).searchParams.get('q')
    : lineOf(await request.json())
  if (q == null) throw new Refused('/query needs a query: ?q=… or a body {q}')
  // Parsed once, here: both `rows()` and `read()` accept the parsed query, so
  // the string is parsed to decide which of them answers, and not parsed
  // again to answer.
  let ast = parse(q)
  let op = aggregate(ast)
  return json(op ? reduced(op, await graph.rows(ast)) : await graph.read(ast))
}
