// The transport: MCP over Streamable HTTP, as a plain `Request` → `Response`
// handler, so the same server runs on Deno, on Node, and in a Cloudflare
// Worker.
//
// It is STATELESS. One JSON-RPC request in, one JSON reply out, with no MCP
// session to strand: a restart loses nothing, and two isolates answering the
// same client need to agree about nothing. That costs the server→client half
// of the protocol — there is no SSE stream here, so a `GET` is answered 405,
// which is what the MCP spec says a server without a stream should answer —
// and it buys a handler that mounts beside @yaks/api's HTTP routes with no
// runtime-specific code between them.
//
// The route is not decided here either. This handler answers EVERY HTTP
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
import { namedTool } from '@yaks/graph'
import { runner } from '@yaks/tools'
import { listing, type Options, server } from './server.ts'

/** How the HTTP handler is built: everything {@link Options} takes except the
 * actor, which is decided per HTTP request. */
export type MountOptions = Omit<Options, 'actor'> & {
  /** who is calling — what it returns signs every write the call makes
   * (default: nobody). Throwing `Unauthorized` refuses the request with a
   * 401. */
  authenticate?: Authenticate
  /** how long one call may take, in ms (default: 60000) */
  timeout?: number
}

let refused = (message: string, code: number) =>
  json({ error: code == 405 ? 'NotAllowed' : 'Refused', message }, code)

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
 * ```ts
 * let handler = mcp({ graph, authenticate })
 * Deno.serve((request) => handler(request))
 * ```
 */
export let mcp = (opts: MountOptions): Handler => {
  let ms = opts.timeout ?? 60_000
  // ONE runner for the whole handler, not one per HTTP request: the `tool`
  // rows a call references are written once for the process, and a call still
  // running is one run however many requests ask about it.
  let runs = opts.runner ?? runner(opts.calls ?? opts.graph, {
    tools: listing(opts).map(namedTool),
    host: opts.graph,
    report: (err: unknown) => console.error('tool failed —', err),
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
      let built = server({ ...opts, actor, runner: runs })
      // Whatever else the calling program serves — resources, prompts — is
      // registered before the request is answered, so `resources/list` sees
      // them on the very first call rather than the second.
      await opts.extend?.(built)
      return json(await ask(built, rpc.data, ms))
    } catch (err) {
      return refuse(err)
    }
  }
}
