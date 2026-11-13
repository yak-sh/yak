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

import type { Actor, ApplyOpts, Bundle, Graph, ReadOpts } from '@yaks/graph'
import { aggregate, reduced } from '@yaks/graph/read'
import type { Driver } from '@yaks/sql'
import { knownOptions, Refused } from '@yaks/graph/errors'
import { parse } from '@yaks/query'
import { during, parent, peek, scope } from '@yaks/trace'
import { type Authenticate, signed } from './actor.ts'
import { readBody, receiveBody } from './body.ts'
import { fault, json, refusal, refuse, type Tags } from './refuse.ts'
import { published } from './publish.ts'
import {
  binaryHeaders,
  constrained,
  decoded,
  durable,
  IDEMPOTENCY,
  taken,
} from './log.ts'
import { type Door, type Mark, received } from './receipts.ts'
import { admit } from './requests.ts'
import { decode, stringify } from '@yaks/vocab/wire'

/** The HTTP write options, checked before a body or stream can commit. */
export let writeOptions = (
  request: Request,
  extra: string[] = [],
): { check: boolean } => {
  let params = new URL(request.url).searchParams
  knownOptions(Object.fromEntries(params), ['check', ...extra])
  return { check: params.has('check') }
}

/** Context the application gives each incoming write before authentication
 * signs it. Streaming imports call it once per chunk, including checks. */
export type WriteContext = (request: Request, bundles: Bundle[]) => Bundle[]

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
/** Whether a request's body is NDJSON, the import {@link pour} answers. */
export let poured = (request: Request): boolean =>
  (request.headers.get('content-type') ?? '').toLowerCase().includes('ndjson')

// The body's lines as they arrive, each with the 1-based number it was on.
// Nothing is held but the line being read and the tail of the last read, so a
// 10 MB import is never a 10 MB string and never one `JSON.parse`.
let lines = async function* (
  body: ReadableStream<Uint8Array>,
  request: Request,
): AsyncGenerator<[number, string]> {
  let reader = body.getReader()
  let decoder = new TextDecoder()
  let held = ''
  let at = 0
  for (;;) {
    let { done, value } = await receiveBody(request, () => reader.read())
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
let culprit = async (
  graph: Graph,
  chunk: Bundle[],
  cause?: string,
): Promise<number> => {
  for (let i = 0; i < chunk.length; i++) {
    let rest = chunk.filter((_, j) => j != i)
    if (!rest.length) return i
    try {
      await graph.apply(rest, { check: true, ...(cause && { parent: cause }) })
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
 * {"error":"Refused","message":"unknown property:
 * book.colour","line":137,"committed":100}
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
  activity: object = graph,
  context?: WriteContext,
  opts?: ReadOpts,
  params: string[] = [],
  tags?: Tags,
): Response => {
  let body = request.body
  if (!body) throw new Refused('/apply takes one bundle per line')
  let { check } = writeOptions(request, params)
  let cause: string | undefined
  let out = new TransformStream<Uint8Array, Uint8Array>()
  let writer = out.writable.getWriter()
  let bytes = new TextEncoder()
  // Awaited, so a slow reader slows the import down rather than piling the
  // whole response up behind itself.
  let disconnected = false
  let say = async (v: unknown) => {
    if (disconnected) return
    let line = bytes.encode(`${stringify(v)}\n`)
    try {
      await writer.write(line)
    } catch {
      // This identity stream has no transform that can fail: only its reader
      // can cancel it. Losing the reply must not abandon received writes.
      disconnected = true
    }
  }

  let run = async () => {
    let held: Bundle[] = []
    let at: number[] = []
    let committed = 0
    // The line number a refusal belongs to: the line being read, until a
    // chunk is refused and one of its own lines is identified.
    let blame = 0
    let flush = async () => {
      let batch = signed(context ? context(request, held) : held, who)
      let applied: Bundle[]
      try {
        applied = await graph.apply(batch, {
          check,
          ...(cause && { parent: cause }),
        })
      } catch (err) {
        blame = at[await culprit(graph, batch, cause)]
        throw err
      }
      let reply = opts
        ? await graph.answer(published(graph.vocab, applied), {
          ...opts,
          patch: true,
        })
        : applied
      for (let b of published(graph.vocab, asked(held, reply))) await say(b)
      committed += held.length
      held = []
      at = []
    }
    try {
      for await (let [n, line] of lines(body, request)) {
        if (!line.trim()) continue
        blame = n
        held.push(decode(graph.vocab, JSON.parse(line)) as Bundle)
        at.push(n)
        if (held.length == CHUNK) await flush()
      }
      if (held.length) await flush()
    } catch (err) {
      fault(err, `${request.method} ${new URL(request.url).pathname}`, tags)
      await say({ ...refusal(err), line: blame, committed })
    }
  }
  let c = peek(activity)
  let flowing = c
    ? scope(undefined, () => {
      let span = c.begin({
        kind: 'request',
        name: 'http stream apply',
        package: '@yaks/api',
      })
      cause = span?.id
      return during(span, run)
    })
    : run()
  let finished = admit(
    request,
    flowing.catch(async (error) => {
      await writer.abort(error).catch(() => {})
      throw error
    }).finally(async () => {
      if (!disconnected) await writer.close().catch(() => {})
    }),
  )
  // Standalone calls have no listener to observe completion.
  void finished.catch(() => {})
  return new Response(out.readable, {
    headers: { 'content-type': 'application/x-ndjson' },
  })
}

/** A request its host trusts, such as the platform's own bookkeeping: who it
 * writes as, and the graph it writes through, which admits the server-owned
 * properties and stands the caller's guards down. Only a trusted write may
 * keep the last write's provenance (`?stamp=0`). */
export type Trusted = { graph: Graph; actor: Actor | null }

/** What an apply door is built of: the graph a caller writes and how they
 * read it, and what its host decides around a commit, given as data. Each is
 * read as a request needs it, so a host whose graph is built again with each
 * incarnation lends one door for all of them. */
export type Applying = {
  /** the graph a caller writes */
  graph: Graph
  /** Runtime activity stays keyed by the composed graph, not a read overlay. */
  activity?: object
  /** who is writing (default: nobody) */
  authenticate?: Authenticate
  /** The caller's view of the graph, which a write's answer is read in. A
   * `person` here outranks the one `authenticate` names. */
  read?: (
    request: Request,
  ) => ReadOpts | undefined | Promise<ReadOpts | undefined>
  /** Caller write context, applied to JSON batches and every import chunk. */
  write?: WriteContext
  /** Additional apply query parameters interpreted by this host. */
  writeParams?: string[]
  /** Which requests the host trusts, and how ({@link Trusted}); `undefined`
   * for every other, which `authenticate` signs. */
  trust?: (request: Request) => Trusted | undefined
  /** Today's authority to write, which throws for a caller who may not: asked
   * of a durable outbox write before a kept answer is told without the graph
   * deciding again (default: `authenticate`). A trusted request holds it. */
  authorize?: (request: Request) => unknown
  /** The host's door over its write log (./receipts.ts `door`), which keeps
   * its receipts with the input it could not commit yet. */
  log?: Pick<Door, 'bound' | 'applying'>
  /** The host's write log, for a door with no door over it: SQL on the
   * graph's own connection, where a keyed write's receipt is inserted in the
   * transaction that commits it (./receipts.ts `received`). A door with
   * neither refuses a keyed write. */
  db?: Driver
  /** What the host adds to each failure this door reports (./refuse.ts
   * `Tags`, `faults`), such as which of its stores it is: read as one is. */
  tags?: () => Tags
}

/** A host's apply door ({@link applier}). */
export type Applier = {
  /** `POST /apply`: a batch in, as applied out, in the caller's view, or as
   * the log keeps it when `mark` names the write to the log. It never throws:
   * a refusal is answered at its status, and a constraint the batch broke is
   * its refusal. */
  apply: (request: Request, mark?: Mark) => Promise<Response>
  /** Today's authority to write ({@link Applying} `authorize`). */
  authorize: (request: Request) => Promise<void>
  /** A canonical answer as its caller sees it: a kept write's, told again. */
  answer: (request: Request, response: Response) => Promise<Response>
}

/**
 * `POST /apply` — a JSON array of bundles in, that array as applied out. The
 * response body is the array `apply()` returned, including server-written
 * stamps and any entity a cascading delete took with it.
 *
 * `?check=1` asks only whether the array would be accepted: every phase runs
 * and the transaction is rolled back, so nothing is written and no effect
 * observes it, while a refusal is still a refusal. That is what lets one batch be spread over several graphs — ask them all, then commit.
 *
 * A binary envelope is decoded in the graph's words, whether it came as sent
 * or as a write log keeps it (./log.ts `taken`). `content-type:
 * application/x-ndjson` is the same endpoint for an import too big to hold in
 * memory — see {@link pour}.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { graph } from '@yaks/graph'
 * import { ram } from '@yaks/ram'
 * import { loadVocab } from '@yaks/vocab'
 * import { applier } from './doors.ts'
 * let vocab = loadVocab({ $defs: { doc: { component: true, type: 'object',
 *   properties: { title: { type: 'string' } } } } })
 * let g = graph({ vocab, storage: ram(vocab) })
 * let door = applier({ graph: g })
 * let sent = (body: unknown) => new Request('http://g/apply', {
 *   method: 'POST', body: JSON.stringify(body),
 * })
 * let r = await door.apply(sent([{ entity: { eid: 'a' }, doc: { title: 'A' } }]))
 * equal(r.status, 200)
 * equal((await door.apply(sent({}))).status, 400)
 * ```
 */
export let applier = (o: Applying): Applier => {
  let authenticate: Authenticate = (request) =>
    o.authenticate ? o.authenticate(request) : null
  let view = async (request: Request, who?: Actor | null) => ({
    person: who?.by ?? null,
    ...await o.read?.(request),
  })
  let seen = async (request: Request, rows: Bundle[], who?: Actor | null) => {
    let { graph } = o
    return published(
      graph.vocab,
      await graph.answer(published(graph.vocab, rows), {
        ...await view(request, who),
        patch: true,
      }),
    )
  }

  let apply = async (sent: Request, mark: Mark = null): Promise<Response> => {
    let request = sent
    try {
      let { graph } = o
      let activity = o.activity ?? graph
      let params = [...(o.writeParams ?? []), ...(o.trust ? ['stamp'] : [])]
      let { check } = writeOptions(request, params)
      let trusted = o.trust?.(request)
      let writer = trusted?.graph ?? graph
      let key = request.headers.get(IDEMPOTENCY)
      let cause = peek(activity) ? parent(activity, request) : undefined
      if (poured(request)) {
        if (durable(key)) {
          throw new Refused('Durable outbox keys require a JSON apply')
        }
        let who = trusted ? trusted.actor : await authenticate(request)
        return pour(
          writer,
          request,
          who,
          activity,
          o.write,
          await view(request, who),
          params,
          o.tags?.(),
        )
      }
      let { body: text } = await taken(request)
      let body = decoded(graph.vocab, request.headers, text)
      if (!Array.isArray(body)) {
        throw new Refused('/apply takes a JSON array of bundles')
      }
      let who = trusted ? trusted.actor : await authenticate(request)
      if (o.log) {
        let bound = await o.log.bound(request, text, check)
        if (bound instanceof Response) return bound
        request = bound
      }
      let batch = signed(o.write ? o.write(request, body) : body, who)
      let options: ApplyOpts = {
        check,
        ...(trusted && new URL(request.url).searchParams.get('stamp') == '0'
          ? { stamp: false }
          : {}),
        ...(cause && { parent: cause }),
      }
      let applied: Bundle[]
      if (o.log) {
        let out = o.log.applying(
          request,
          mark,
          () => writer.apply(batch, options),
        )
        if (out instanceof Response) return out
        applied = await out
      } else if (key && !check) {
        // A receipt is of the batch as decoded: a binary one's envelope is
        // not what it says.
        let said = binaryHeaders(request.headers) ? stringify(body) : text
        applied = await received(writer, o.db, key, said, who, batch, options)
      } else applied = await writer.apply(batch, options)
      // The log keeps canonical patches; each caller, a resend included, is
      // told its own view.
      return json(
        mark == null
          ? await seen(request, applied, who)
          : published(graph.vocab, applied),
      )
    } catch (e) {
      return refuse(constrained(e), sent, o.tags?.())
    }
  }

  return {
    apply,
    async authorize(request) {
      if (o.trust?.(request)) return
      await (o.authorize ?? authenticate)(request)
    },
    async answer(request, response) {
      if (
        response.status != 200 ||
        response.headers.get('content-type')?.includes('ndjson')
      ) return response
      let rows = decode(o.graph.vocab, await response.json()) as Bundle[]
      return new Response(stringify(await seen(request, rows)), response)
    },
  }
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

/**
 * `GET /query?q=…` or `POST /query` — a query string in, the bundles it
 * selects out.
 *
 * Unless the query asks for a reduction. `.count`, `.distinct=prop` and
 * `.tally=prop` are questions about the selection rather than about its
 * members, and the store answers each with one SQL statement (`rows()` rather
 * than `read()`); the response body is then `{"count":n}`, `{"distinct":[…]}`
 * or `{"tally":{…}}`.
 */
export let ask = async (
  graph: Graph,
  request: Request,
  activity: object = graph,
  opts?: ReadOpts,
): Promise<Response> => {
  let q = request.method == 'GET'
    ? new URL(request.url).searchParams.get('q')
    : lineOf(JSON.parse(await readBody(request)))
  if (q == null) throw new Refused('/query needs a query: ?q=… or a body {q}')
  // Parsed once, here: both `rows()` and `read()` accept the parsed query, so
  // the string is parsed to decide which of them answers, and not parsed
  // again to answer.
  let ast = parse(q)
  let cause = peek(activity) ? parent(activity, request) : undefined
  let options = {
    ...opts,
    signal: request.signal,
    ...(cause && { parent: cause }),
  }
  let op = aggregate(ast)
  try {
    return op
      ? json(reduced(op, await graph.rows(ast, options)))
      : listed(published(graph.vocab, await graph.read(ast, options)))
  } catch (error) {
    if (request.signal.aborted && error === request.signal.reason) {
      throw new Refused('query was interrupted')
    }
    throw error
  }
}

// How much of a listed answer is said per piece of the stream.
let PIECE = 64 * 1024

// A list as its JSON response, said one entity at a time: the bytes
// `JSON.stringify` would write, never built as one string, so a selection of
// any size is sent rather than failing to fit in one. The stream pulls, so a
// slow reader slows the saying.
let listed = (items: unknown[]): Response => {
  let bytes = new TextEncoder()
  let next = 0
  return new Response(
    new ReadableStream<Uint8Array>({
      start: (c) => c.enqueue(bytes.encode('[')),
      pull: (c) => {
        let piece = ''
        while (next < items.length && piece.length < PIECE) {
          piece += (next ? ',' : '') + stringify(items[next++])
        }
        c.enqueue(bytes.encode(next < items.length ? piece : piece + ']'))
        if (next == items.length) c.close()
      },
    }),
    { headers: { 'content-type': 'application/json' } },
  )
}
