// The transport: MCP over Streamable HTTP, as a plain `Request` → `Response`
// handler, so the same server runs on Deno, on Node, and in a Worker.
//
// It is STATELESS. One JSON-RPC request in, one JSON reply out, no session to
// strand: a restart loses nothing, and two isolates answering the same client
// need to agree about nothing. That costs the server→client half of the
// protocol — there is no SSE stream here, so a `GET` is answered 405, which is
// what the spec says a server without one should say — and buys a door that
// composes beside @yaks/api's without a runtime between them.
//
// The route is not decided here either. This handler answers EVERY request it
// is given, so a host mounts it wherever it likes:
//
//   let door = mcp({ graph, authenticate })
//   if (new URL(request.url).pathname == '/mcp') return door(request)
//
// A server is built per request, around the actor `authenticate` named. That is
// the whole of gate 6: there is no window in which a tool holds a graph and an
// identity that did not come from this door.

import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import {
  type JSONRPCMessage,
  JSONRPCNotificationSchema,
  JSONRPCRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { type Authenticate, type Handler, json, refuse } from '@yaks/api'
import { type Options, server } from './server.ts'

/** How the HTTP door is built: everything {@link Options} takes except the
 * actor, which this door decides per request. */
export type MountOptions = Omit<Options, 'actor'> & {
  /** who is calling — its answer signs every write the call makes (default:
   * nobody). Throwing `Unauthorized` refuses the request with a 401. */
  authenticate?: Authenticate
  /** how long one call may take, in ms (default: 60000) */
  timeout?: number
}

let refused = (message: string, code: number) =>
  json({ error: code == 405 ? 'NotAllowed' : 'Refused', message }, code)

// One JSON-RPC request, answered by a server of its own. The linked pair is
// the SDK's own in-process transport, so the protocol machine is exercised
// exactly as it would be over a socket, with no socket.
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
 * Build the MCP handler for a graph. `POST` carries one JSON-RPC request and
 * answers with one JSON-RPC reply; a notification is answered `202`; anything
 * else is a `405`.
 *
 * ```ts
 * let door = mcp({ graph, authenticate })
 * Deno.serve((request) => door(request))
 * ```
 */
export let mcp = (opts: MountOptions): Handler => {
  let ms = opts.timeout ?? 60_000
  return async (request) => {
    if (request.method != 'POST') {
      return refused('this MCP door takes POST — it serves no stream', 405)
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
        // A notification expects no answer at all; anything else that is not a
        // request is a client bug, said in the client's own protocol.
        return JSONRPCNotificationSchema.safeParse(body).success
          ? new Response(null, { status: 202 })
          : refused('not a JSON-RPC request', 400)
      }
      return json(await ask(server({ ...opts, actor }), rpc.data, ms))
    } catch (err) {
      return refuse(err)
    }
  }
}
