// The transport: MCP over Streamable HTTP, as a plain `Request` → `Response`
// handler, so the same server runs on Deno, on Node, and in a Cloudflare
// Worker.
//
// Legacy traffic gets one JSON-RPC request in and one JSON reply out. Modern
// traffic uses the SDK factory entry, including envelope validation and SSE.
// When a caller supplies a
// session graph, the MCP session id names a persisted transcript; a restart
// preserves it, and two isolates share its identity. There is no SSE stream
// here, so a `GET` is answered 405, as MCP specifies for a server without a
// stream. The handler mounts beside @yaks/api's routes without runtime code.
//
// The route is not decided here either. This handler answers every HTTP
// request it is given, so the calling program mounts it on whatever path it
// likes:
//
//   let handler = mcp({ graph, authenticate })
//   if (new URL(request.url).pathname == '/mcp') return handler(request)
//
// An MCP server object is built per HTTP request, around the actor
// `authenticate` returned. That is what keeps write attribution honest: there
// is no moment at which a tool holds a graph together with an identity that
// did not come from this handler.

import {
  createMcpHandler,
  InMemoryTransport,
  isLegacyRequest,
  PROTOCOL_VERSION_META_KEY,
  readRequestBody,
} from '@modelcontextprotocol/server'
import {
  JSONRPCNotificationSchema,
  JSONRPCRequestSchema,
} from '@modelcontextprotocol/core'
import type { JSONRPCMessage } from '@modelcontextprotocol/server'
import { type Authenticate, type Handler, json, refuse } from '@yaks/api'
import type { Actor, Bundle, Graph } from '@yaks/graph'
import { status } from '@yaks/graph/errors'
import { SESSION, sessionFor, speaking } from '@yaks/session'
import { runner } from '@yaks/tools'
import { type Clock, system } from '@yaks/fp'
import {
  type Exchange,
  instructed,
  listing,
  logged,
  type Options,
  prepared,
  server,
} from './server.ts'

/** How the HTTP handler is built: everything {@link Options} takes except the
 * actor, which is decided per HTTP request. */
export type MountOptions = Omit<Options, 'actor'> & {
  /** the graph that owns MCP connection transcripts. Without one, the
   * calling application owns its own Mcp-Session-Id and this transport does
   * not create graph sessions. */
  sessions?: Graph
  /** who is calling — what it returns signs every write the call makes
   * (default: nobody). Throwing `Unauthorized` refuses the request with a
   * 401. */
  authenticate?: Authenticate
  /** Legacy one-shot call timeout in ms; modern exchanges use client cancellation. */
  timeout?: number
  /** The clock the handler keeps time by: the legacy `timeout`, and its
   * runner's (default the runtime's). */
  clock?: Clock
}

let refused = (message: string, code: number) =>
  json({ error: code == 405 ? 'NotAllowed' : 'Refused', message }, code)

// A refusal is answered here, in its own words. A failure has no answer of
// its own: it is thrown on to the host, whose watch answers it and reports it
// with its error (@yaks/api `served`, the yaks.app kernel's catch-all, which
// hears only what is thrown).
let refusing = (err: unknown, request: Request): Response => {
  if (status(err) >= 500) throw err
  return refuse(err, request)
}

let ID = 'mcp-session-id'
/** The connection's own actor wins over its login. An authenticated identity
 * outside the graph remains a fallback when the connection names no actor. */
export let writer = (session: Actor, login: Actor | null): Actor =>
  !session.by && login?.by && login.by != login.via
    ? { ...session, by: login.by }
    : session

// The header is an opaque connection id, not a graph address. A process can
// restart between requests: the graph, rather than this handler, remembers it.
let connected = async (
  graph: Graph,
  id: string | null,
  actor: Actor | null,
): Promise<{ session: Bundle; id: string } | undefined> => {
  if (id != null) {
    if (!id) return undefined
    let session = await sessionFor(graph, { id }, [
      'session.id',
      'session.actor',
    ])
    let named = session?.[SESSION]
    if (
      !session || !named || typeof named != 'object' || !('id' in named) ||
      named.id != id
    ) return undefined
    return { session, id }
  }
  let fresh = crypto.randomUUID()
  let owner = actor?.by && actor.by != actor.via
    ? (await graph.get([actor.by]))[0]?.entity.eid
    : undefined
  let [session] = await graph.apply([{
    entity: { eid: crypto.randomUUID() },
    [SESSION]: {
      id: fresh,
      // A person authenticated by the host remains the actor. The host's
      // process fallback speaks only for itself and is not this connection.
      // session.actor is a reference, so an external identity stays on this
      // request's attribution without making session creation fail.
      ...(owner ? { actor: owner } : {}),
    },
  }])
  return { session, id: fresh }
}

// The modern protocol's standard headers (SEP-2243) mirror what the body
// already says: its protocol version (in `_meta`), its method, and the name it
// acts on. The SDK refuses a request missing a mirror, and ChatGPT sends the
// body alone, so a missing mirror is filled from the body. A header the client
// sent is kept, so one that disagrees with its body is still refused.
let NAMED: Record<string, string> = {
  'tools/call': 'name',
  'prompts/get': 'name',
  'resources/read': 'uri',
  'tasks/get': 'taskId',
  'tasks/update': 'taskId',
  'tasks/cancel': 'taskId',
}

// A value a header carries as it is, or else in the SDK's Base64 sentinel.
let PLAIN = /^[\x21-\x7e]([\x20-\x7e]*[\x21-\x7e])?$/
let headed = (value: string) =>
  PLAIN.test(value) && !value.startsWith('=?base64?')
    ? value
    : `=?base64?${
      btoa(String.fromCharCode(...new TextEncoder().encode(value)))
    }?=`

let mirrors = (body: unknown): [string, unknown][] => {
  if (!body || typeof body != 'object' || !('method' in body)) return []
  let { method, params } = body as { method: unknown; params?: unknown }
  let p = params && typeof params == 'object'
    ? params as Record<string, unknown>
    : {}
  let meta = p._meta && typeof p._meta == 'object'
    ? p._meta as Record<string, unknown>
    : {}
  let named = typeof method == 'string' ? NAMED[method] : undefined
  return [
    ['mcp-protocol-version', meta[PROTOCOL_VERSION_META_KEY]],
    ['mcp-method', method],
    ['mcp-name', named ? p[named] : undefined],
  ]
}

let mirrored = (request: Request, body: unknown): Request => {
  let missing = mirrors(body).filter(([name, value]) =>
    typeof value == 'string' && !request.headers.has(name)
  )
  if (!missing.length) return request
  let headers = new Headers(request.headers)
  for (let [name, value] of missing) headers.set(name, headed(value as string))
  return new Request(request, { headers })
}

// One JSON-RPC request, answered by an MCP server object of its own. The
// linked pair is the SDK's own in-process transport, so the protocol is
// exercised exactly as it would be over a socket, without opening one.
let ask = async (
  mcp: ReturnType<typeof server>,
  request: JSONRPCMessage,
  ms: number | undefined,
  clock: Clock,
): Promise<unknown> => {
  let [mine, theirs] = InMemoryTransport.createLinkedPair()
  let cancel = () => {}
  try {
    await mcp.connect(theirs)
    let reply = new Promise<unknown>((ok, no) => {
      mine.onmessage = ok
      if (ms != null) {
        cancel = clock.after(ms, () => no(new Error('mcp timeout')))
      }
    })
    await mine.start()
    await mine.send(request)
    return await reply
  } finally {
    cancel()
    await mcp.close()
  }
}

/**
 * Build the HTTP handler for a graph. A `POST` carries one JSON-RPC request
 * and is answered with one JSON-RPC reply; a JSON-RPC notification is answered
 * `202`; any other HTTP method is answered `405`.
 *
 * ```ts ignore
 * let handler = mcp({ graph, authenticate })
 * Deno.serve((request) => handler(request))
 * ```
 */
export let mcp = (opts: MountOptions): Handler => {
  if (opts.sessions && !opts.sessions.vocab.comp(SESSION)) {
    throw new Error('the MCP session graph has no session vocabulary')
  }
  let ms = opts.timeout
  let clock = opts.clock ?? system
  // One runner for the whole handler, not one per HTTP request: the `tool`
  // rows a call references are written once for the process, and a call still
  // running is one run however many requests ask about it.
  let runs = opts.runner
  let running = () =>
    runs ??= runner(opts.calls ?? opts.graph, {
      tools: opts.registry ?? listing(opts),
      host: opts.graph,
      report: opts.report ?? logged,
      ...opts.reply ? { reply: opts.reply } : {},
      ...opts.clock ? { clock: opts.clock } : {},
    })
  let callers = new WeakMap<
    Request,
    { actor: Actor | null; exchange?: Exchange }
  >()
  let modern = createMcpHandler(async (context) => {
    let caller = context.requestInfo
      ? callers.get(context.requestInfo)
      : undefined
    let built = server({
      ...opts,
      instructions: await instructed(opts, caller?.exchange),
      actor: caller?.actor ?? null,
      runner: running(),
    })
    return await prepared(built, opts, caller?.exchange)
  }, {
    legacy: 'reject',
    // The SDK answers what it refuses or fails on itself and throws nothing
    // on to the host's watch, so it is told here or nowhere.
    onerror: (err) =>
      void Promise.resolve((opts.report ?? logged)(err)).catch(logged),
  })
  let legacy = async (
    request: Request,
    actor: Actor | null,
    body: unknown,
  ): Promise<Response> => {
    if (request.method != 'POST') {
      return refused(
        'this MCP endpoint accepts POST only — it serves no SSE stream',
        405,
      )
    }
    try {
      if (Array.isArray(body)) return refused('one request at a time', 400)
      let rpc = JSONRPCRequestSchema.safeParse(body)
      if (!rpc.success) {
        // A JSON-RPC notification expects no answer at all; anything else that
        // is not a request is a client bug, reported in JSON-RPC's own terms.
        return JSONRPCNotificationSchema.safeParse(body).success
          ? new Response(null, { status: 202 })
          : refused('not a JSON-RPC request', 400)
      }
      // A request whose run the door already knows (named in `x-via`, or by
      // the harness call its message makes) speaks through that run; only
      // one naming none speaks through a connection of its own. The host's
      // own fallback is the process acting through itself, which names none.
      let named = !!actor?.via && actor.via != actor.by
      let conn = named || !opts.sessions
        ? undefined
        : await connected(opts.sessions, request.headers.get(ID), actor)
      if (
        !named && opts.sessions && request.headers.has(ID) &&
        !conn
      ) {
        return refused('unknown MCP session', 404)
      }
      let caller = conn
        ? writer(await speaking(opts.sessions!, conn.session), actor)
        : actor
      let exchange = { method: rpc.data.method }
      let built = server({
        ...opts,
        instructions: await instructed(opts, exchange),
        actor: caller,
        runner: running(),
      })
      // Whatever else the calling program serves — resources, prompts — is
      // registered before the request is answered, so `resources/list` sees
      // them on the very first call rather than the second.
      await prepared(built, opts, exchange)
      let answer = json(await ask(built, rpc.data, ms, clock))
      if (conn) answer.headers.set(ID, conn.id)
      return answer
    } catch (err) {
      return refusing(err, request)
    }
  }
  return async (request) => {
    try {
      // The SDK validates neither tokens nor Host/Origin. The host's existing
      // authentication/security boundary runs before both protocol legs, once
      // per request, and is handed the message where it was read: a harness
      // names the run behind a call in the call's `_meta`.
      let who = async (message?: unknown) =>
        (await opts.authenticate?.(request, message)) ?? null
      // Classify and serve from one bounded read. The SDK's predicate and
      // modern handler accept the same parsed body, keeping the protocol's
      // size limit without making more streams just to read the bytes again.
      // A body too large, or one that claims the modern protocol and cannot
      // be read, is the SDK's to answer.
      let modernClaim = request.headers.has('MCP-Protocol-Version')
      let body: unknown
      if (request.method == 'POST') {
        let read
        try {
          // TODO: DOM/Workers declaration merging leaves clone's Cf parameters
          // unbound. Remove this annotation when clone preserves Request's
          // metadata type; the SDK reader uses only its body and headers.
          read = await readRequestBody(request.clone() as Request)
        } catch {
          if (!modernClaim) return refused('the body is not JSON', 400)
          await who()
          return await modern.fetch(request)
        }
        if (read.tooLarge) {
          await who()
          return await modern.fetch(request)
        }
        try {
          body = JSON.parse(read.text)
        } catch {
          return refused('the body is not JSON', 400)
        }
      }
      let actor = await who(body)
      if (await isLegacyRequest(request, body)) {
        return await legacy(request, actor, body)
      }
      // Preserve the pre-envelope door's 400 for bodies that cannot be a
      // request at all. An explicit modern header/claim always belongs to SDK.
      if (!modernClaim) {
        if (!body || typeof body != 'object' || Array.isArray(body)) {
          return await legacy(request, actor, body)
        }
      }
      // No connection transcript or clientInfo-derived principal in this era.
      let exchange = body && typeof body == 'object' && 'method' in body &&
          typeof body.method == 'string'
        ? { method: body.method }
        : undefined
      let sent = mirrored(request, body)
      callers.set(sent, { actor, exchange })
      try {
        // The SDK owns the exchange lifetime, including SSE and cancellation.
        // Closing here would truncate a response whose stream is still active.
        return await modern.fetch(sent, { parsedBody: body })
      } finally {
        callers.delete(sent)
      }
    } catch (err) {
      return refusing(err, request)
    }
  }
}
