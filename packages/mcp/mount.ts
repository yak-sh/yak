// The transport: MCP over Streamable HTTP, as a plain `Request` → `Response`
// handler, so the same server runs on Deno, on Node, and in a Cloudflare
// Worker.
//
// One JSON-RPC request in, one JSON reply out. When a caller supplies a
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

import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import {
  type JSONRPCMessage,
  JSONRPCNotificationSchema,
  JSONRPCRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { type Authenticate, type Handler, json, refuse } from '@yaks/api'
import { type Actor, type Bundle, type Graph, namedTool } from '@yaks/graph'
import { SESSION, sessionFor, speaking } from '@yaks/session'
import { runner } from '@yaks/tools'
import { listing, logged, type Options, server } from './server.ts'

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
  /** how long one call may take, in ms (default: 60000) */
  timeout?: number
}

let refused = (message: string, code: number) =>
  json({ error: code == 405 ? 'NotAllowed' : 'Refused', message }, code)

let ID = 'mcp-session-id'
let VIA = 'x-via'

// The header is an opaque connection id, not a graph address. A process can
// restart between requests: the graph, rather than this handler, remembers it.
let connected = async (
  graph: Graph,
  id: string | null,
  actor: Actor | null,
): Promise<{ session: Bundle; id: string } | undefined> => {
  if (id != null) {
    if (!id) return undefined
    let session = await sessionFor(graph, id)
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

// One JSON-RPC request, answered by an MCP server object of its own. The
// linked pair is the SDK's own in-process transport, so the protocol is
// exercised exactly as it would be over a socket, without opening one.
let ask = async (
  mcp: ReturnType<typeof server>,
  request: JSONRPCMessage,
  ms: number,
): Promise<unknown> => {
  let [mine, theirs] = InMemoryTransport.createLinkedPair()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await mcp.connect(theirs)
    let reply = new Promise<unknown>((ok, no) => {
      mine.onmessage = ok
      timer = setTimeout(() => no(new Error('mcp timeout')), ms)
    })
    await mine.start()
    await mine.send(request)
    return await reply
  } finally {
    clearTimeout(timer)
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
  let ms = opts.timeout ?? 60_000
  // One runner for the whole handler, not one per HTTP request: the `tool`
  // rows a call references are written once for the process, and a call still
  // running is one run however many requests ask about it.
  let runs = opts.runner ?? runner(opts.calls ?? opts.graph, {
    tools: listing(opts).map(namedTool),
    host: opts.graph,
    report: opts.report ?? logged,
  })
  return async (request) => {
    if (request.method != 'POST') {
      return refused(
        'this MCP endpoint accepts POST only — it serves no SSE stream',
        405,
      )
    }
    try {
      let actor = (await opts.authenticate?.(request)) ?? null
      let body: unknown
      try {
        body = await request.json()
      } catch {
        return refused('the body is not JSON', 400)
      }
      if (Array.isArray(body)) return refused('one request at a time', 400)
      let rpc = JSONRPCRequestSchema.safeParse(body)
      if (!rpc.success) {
        // A JSON-RPC notification expects no answer at all; anything else that
        // is not a request is a client bug, reported in JSON-RPC's own terms.
        return JSONRPCNotificationSchema.safeParse(body).success
          ? new Response(null, { status: 202 })
          : refused('not a JSON-RPC request', 400)
      }
      let via = request.headers.get(VIA)
      let conn = via || !opts.sessions
        ? undefined
        : await connected(opts.sessions, request.headers.get(ID), actor)
      if (
        !via && opts.sessions && request.headers.has(ID) &&
        !conn
      ) {
        return refused('unknown MCP session', 404)
      }
      let caller = conn ? speaking(conn.session) : actor
      if (conn && actor?.by && actor.by != actor.via) {
        caller = { by: actor.by, via: conn.session.entity.eid }
      }
      let built = server({
        ...opts,
        actor: caller,
        runner: runs,
      })
      // Whatever else the calling program serves — resources, prompts — is
      // registered before the request is answered, so `resources/list` sees
      // them on the very first call rather than the second.
      await opts.extend?.(built)
      let answer = json(await ask(built, rpc.data, ms))
      if (conn) answer.headers.set(ID, conn.id)
      return answer
    } catch (err) {
      return refuse(err, request)
    }
  }
}
