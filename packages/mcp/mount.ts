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
} from '@modelcontextprotocol/server'
import {
  JSONRPCNotificationSchema,
  JSONRPCRequestSchema,
} from '@modelcontextprotocol/core'
import type { JSONRPCMessage } from '@modelcontextprotocol/server'
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
  /** Legacy one-shot call timeout in ms; modern exchanges use client cancellation. */
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
  ms?: number,
): Promise<unknown> => {
  let [mine, theirs] = InMemoryTransport.createLinkedPair()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await mcp.connect(theirs)
    let reply = new Promise<unknown>((ok, no) => {
      mine.onmessage = ok
      if (ms != null) {
        timer = setTimeout(() => no(new Error('mcp timeout')), ms)
      }
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
  let ms = opts.timeout
  // One runner for the whole handler, not one per HTTP request: the `tool`
  // rows a call references are written once for the process, and a call still
  // running is one run however many requests ask about it.
  let runs = opts.runner ?? runner(opts.calls ?? opts.graph, {
    tools: listing(opts).map(namedTool),
    host: opts.graph,
    report: opts.report ?? logged,
    ...opts.reply ? { reply: opts.reply } : {},
  })
  let actors = new WeakMap<Request, Actor | null>()
  let modern = createMcpHandler(async (context) => {
    let actor = context.requestInfo
      ? actors.get(context.requestInfo) ?? null
      : null
    let built = server({ ...opts, actor, runner: runs })
    await opts.extend?.(built)
    await opts.skills?.(built)
    return built
  }, { legacy: 'reject' })
  let legacy = async (
    request: Request,
    actor: Actor | null,
  ): Promise<Response> => {
    if (request.method != 'POST') {
      return refused(
        'this MCP endpoint accepts POST only — it serves no SSE stream',
        405,
      )
    }
    try {
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
      await opts.skills?.(built)
      let answer = json(await ask(built, rpc.data, ms))
      if (conn) answer.headers.set(ID, conn.id)
      return answer
    } catch (err) {
      return refuse(err, request)
    }
  }
  return async (request) => {
    try {
      // The SDK validates neither tokens nor Host/Origin. The host's existing
      // authentication/security boundary runs before both protocol legs.
      let actor = (await opts.authenticate?.(request)) ?? null
      if (await isLegacyRequest(request)) return await legacy(request, actor)
      // Preserve the pre-envelope door's 400 for bodies that cannot be a
      // request at all. An explicit modern header/claim always belongs to SDK.
      if (!request.headers.has('MCP-Protocol-Version')) {
        let body: unknown
        try {
          body = await request.clone().json()
        } catch {
          return await legacy(request, actor)
        }
        if (!body || typeof body != 'object' || Array.isArray(body)) {
          return await legacy(request, actor)
        }
      }
      // No connection transcript or clientInfo-derived principal in this era.
      actors.set(request, actor)
      try {
        // The SDK owns the exchange lifetime, including SSE and cancellation.
        // Closing here would truncate a response whose stream is still active.
        return await modern.fetch(request)
      } finally {
        actors.delete(request)
      }
    } catch (err) {
      return refuse(err, request)
    }
  }
}
