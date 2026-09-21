// The client half of MCP over Streamable HTTP, written out by hand: a client
// that only ever sends three requests — `initialize`, `tools/list`,
// `tools/call` — is smaller than the SDK that would answer them, and adds no
// dependency to somebody's `deno install`.
//
// ONE POST IS ONE JSON-RPC REQUEST. The MCP server this talks to is stateless
// (@yaks/mcp `mount.ts`): a request in, a response out, nothing left open. So
// `initialize` is sent only when listing tools — where the protocol version is
// negotiated and cached beside the tool list (store.ts) — and a tool call made
// from a cached list costs a single round trip, which is what makes the CLI
// feel like a local program. A server that responds with an `mcp-session-id`
// gets it back on every request after that.
//
// A 401 is the one status code read for meaning: the server answers it with
// the `WWW-Authenticate` challenge an MCP client would follow into an OAuth
// flow, and this client has no browser to follow it with — so it prints one
// sentence a person can act on instead.

/** The newest MCP protocol version this client supports. */
export let PROTOCOL = '2025-06-18'

/** The server said no: a transport failure, or a JSON-RPC error. */
export class Refused extends Error {}

/** Nobody is signed in — the message is the sentence to print. */
export class Unauthorized extends Error {}

/** Where to call and as whom: the `/mcp` URL, the bearer token, the session
 * this command speaks for, and the `fetch` to use (a test passes a handler, so
 * nothing here needs a socket). */
export type Door = {
  url: string
  token?: string | null
  /** the session this command line is part of, sent on the `x-via` header —
   * it records what wrote something, and is never a credential. A host that
   * stores transcripts resolves it to that session and attributes the writes
   * to it (@yaks/session/routes); one that does not ignores the header. */
  via?: string | null
  fetch?: (request: Request) => Response | Promise<Response>
}

/** Send one JSON-RPC method and return its result. */
export type Rpc = (
  method: string,
  params?: unknown,
) => Promise<Record<string, unknown>>

/** `yaks.app` → `https://yaks.app/mcp`; a full origin is used as given, so a
 * test can point at `http://localhost:8787`. */
export let doorUrl = (host: string): string =>
  (/^https?:\/\//.test(host) ? host : `https://${host}`)
    .replace(/\/+$/, '') + '/mcp'

// A Streamable HTTP server may send its response as a server-sent event
// rather than as JSON. Only the `data:` lines carry it, and there is only ever
// one response per request, so the frames are concatenated.
let eventData = (body: string): string =>
  body.split('\n')
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim())
    .join('')

let SIGN_IN = 'not signed in — run `yaks login <token>`, or set YAKS_TOKEN'

/** A client of one MCP server. Request ids count up within the process; the
 * session id, if the server issued one, is sent on every request after the
 * response that carried it. */
export let rpc = (door: Door): Rpc => {
  let go = door.fetch ?? ((r: Request) => fetch(r))
  let n = 0
  let session: string | null = null
  return async (method, params = {}) => {
    let request = new Request(door.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': PROTOCOL,
        ...(door.token ? { authorization: `Bearer ${door.token}` } : {}),
        ...(door.via ? { 'x-via': door.via } : {}),
        ...(session ? { 'mcp-session-id': session } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++n, method, params }),
    })
    let r = await go(request)
    session ??= r.headers.get('mcp-session-id')
    let text = await r.text()
    if (r.status == 401) throw new Unauthorized(SIGN_IN)
    let said = r.headers.get('content-type')?.includes('text/event-stream')
      ? eventData(text)
      : text
    let reply: {
      result?: Record<string, unknown>
      error?: { code: number; message: string }
    }
    try {
      reply = JSON.parse(said)
    } catch {
      throw new Refused(
        `${door.url} said ${r.status} and not JSON: ${text.slice(0, 200)}`,
      )
    }
    if (reply.error) throw new Refused(reply.error.message)
    if (!reply.result) throw new Refused(`${door.url} said ${r.status}`)
    return reply.result
  }
}

/** A `fetch` that prints one line per response, for `yak --timing`:
 *
 *     POST /mcp 200  door;dur=12, hops;dur=3, total;dur=41
 *
 * `total` is wall-clock milliseconds; `hops` and `r2` are counts.
 *
 * The numbers are the server's own `Server-Timing` header
 * (workers/yak/timing.ts), printed exactly as they arrived, so this line and a
 * `curl -i` agree. A server that sends no such header still gets a line. (The
 * owner checkout prints the same line for the calls it makes outside this
 * server — src/timing.ts.) */
export let timed = (
  say: (line: string) => void,
  go: (request: Request) => Response | Promise<Response> = (r) => fetch(r),
) =>
async (request: Request): Promise<Response> => {
  let res = await go(request)
  let at = new URL(request.url)
  let entries = res.headers.get('server-timing')
  say(
    `${request.method} ${at.pathname}${at.search} ${res.status}${
      entries ? `  ${entries}` : ''
    }`,
  )
  return res
}

/** The `initialize` handshake, sent before listing tools: it returns what the
 * server calls itself and which protocol version it agreed to. */
export let initialize = async (ask: Rpc): Promise<Record<string, unknown>> =>
  await ask('initialize', {
    protocolVersion: PROTOCOL,
    capabilities: {},
    clientInfo: { name: 'yak', version: '0.0.0' },
  })
