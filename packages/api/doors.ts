// The two HTTP doors. Both are thin on purpose: read the request, hand the
// graph a query or a batch, answer with JSON. Everything that decides anything
// — what a caller may write, whether a precondition still holds, who gets told
// — lives in @yaks/graph or in the registry, not here.
//
// `/apply` has a second spelling for a load too big to hold: NDJSON, one
// bundle per line, applied in chunks and answered as it goes (`pour`). It is
// the same door, the same `apply()` and the same refusals — what changes is
// that neither the request nor the answer is ever whole in memory.

import { type Bundle, type Change, type Graph, Refused } from '@yaks/graph'
import type { Entity } from '@yaks/graph'
import { signed } from './actor.ts'
import { json, refusal } from './refuse.ts'

/**
 * How many bundles go into one transaction when a load arrives a line at a
 * time. It is the width the D1 adapter's round-trip clamp counts — 50 bundles
 * cost the same two trips as one (packages/d1 `hops_test.ts`) — so a chunk is
 * as wide as the network carries for free.
 */
export let CHUNK = 50

// Whether a load arrives a line at a time. `application/x-ndjson` is the
// spelling the guide shows; `application/ndjson` is the same media type
// without the historical `x`, and both are written in the wild.
let poured = (request: Request): boolean =>
  (request.headers.get('content-type') ?? '').toLowerCase().includes('ndjson')

// The body's lines as they arrive, each with the 1-based number it was on.
// Nothing is held but the line being read and the tail of the last read, so a
// 10 MB load is never a 10 MB string and never one `JSON.parse`.
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

// Which bundle of a refused chunk was the one. A chunk is a transaction, so
// the refusal names the batch and not a line — and somebody staring at a 10 MB
// file needs the line. So the refused chunk is rehearsed with one bundle left
// out at a time (`check`, rolled back before it commits): the bundle whose
// absence lets the rest through is the offender. Nothing is rehearsed until
// something has already gone wrong, and when no single bundle owns the refusal
// — two bad lines, or a batch refused as a whole — the chunk's first line
// stands.
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

/**
 * `POST /apply` with `content-type: application/x-ndjson` — one bundle per
 * line, applied {@link CHUNK} at a time, and answered the same way: the
 * composed bundles, one JSON object per line, written as each chunk commits.
 * Blank lines are skipped. Neither half is ever whole in memory, so a load is
 * bounded by the file rather than by the parser or the transaction.
 *
 * The status is 200 whatever happens, because the first bundles are on the
 * wire before a later line can refuse. So a refusal is the LAST line of the
 * body instead — what `apply()` threw, plus two numbers:
 *
 * ```json
 * {"error":"Refused","message":"unknown column: book.colour","line":137,"committed":100}
 * ```
 *
 * `line` is the 1-based line the offending bundle was on, and `committed` how
 * many bundles landed before it. Nothing after that line is read. (Under
 * `?check=1` every chunk is rehearsed and rolled back, so `committed` counts
 * what would have landed.)
 *
 * **An alias resolves within its own chunk and nowhere else.** A bundle naming
 * `$x` and the bundle minting it have to fall in the same run of {@link CHUNK}
 * lines, because that run is the whole batch the graph is ever shown.
 */
export let pour = (
  graph: Graph,
  request: Request,
  who: Entity | null,
): Response => {
  let body = request.body
  if (!body) throw new Refused('/apply takes one bundle per line')
  let check = new URL(request.url).searchParams.has('check')
  let out = new TransformStream<Uint8Array, Uint8Array>()
  let writer = out.writable.getWriter()
  let bytes = new TextEncoder()
  // Awaited, so a slow reader slows the load down rather than piling the whole
  // answer up behind itself.
  let say = (v: unknown) => writer.write(bytes.encode(`${JSON.stringify(v)}\n`))

  let run = async () => {
    let held: Bundle[] = []
    let at: number[] = []
    let committed = 0
    // The line a refusal belongs to: the line being read, until a chunk
    // refuses and names one of its own.
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
      for (let b of applied) await say(b)
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
 * `POST /apply` — a batch of bundles in, the batch as applied out. The body is
 * a JSON array (a `Change`); the response is the array `apply()` returned,
 * casualties and stamps included.
 *
 * `?check=1` asks only whether the batch would be taken: every phase runs and
 * the transaction is rolled back, so nothing is written and no effect observes
 * it, while a refusal is still a refusal. That is what lets one batch be
 * spread over several graphs — ask them all, then commit.
 *
 * `content-type: application/x-ndjson` is the same door for a load too big to
 * hold whole — see {@link pour}.
 */
export let write = async (
  graph: Graph,
  request: Request,
  who: Entity | null,
): Promise<Response> => {
  if (poured(request)) return pour(graph, request, who)
  let body = await request.json()
  if (!Array.isArray(body)) {
    throw new Refused('/apply takes a JSON array of bundles')
  }
  let check = new URL(request.url).searchParams.has('check')
  return json(await graph.apply(signed(body, who), { check }))
}

// The query line a request names: `?q=` on a GET, and on a POST either a bare
// JSON string or `{ q }`.
let lineOf = (body: unknown): string | null => {
  if (typeof body == 'string') return body
  if (body && typeof body == 'object' && 'q' in body) {
    return typeof body.q == 'string' ? body.q : null
  }
  return null
}

/**
 * `GET /query?q=…` or `POST /query` — a query line in, the bundles it selects
 * out.
 */
export let ask = async (graph: Graph, request: Request): Promise<Response> => {
  let q = request.method == 'GET'
    ? new URL(request.url).searchParams.get('q')
    : lineOf(await request.json())
  if (q == null) throw new Refused('/query needs a query: ?q=… or a body {q}')
  return json(await graph.read(q))
}
