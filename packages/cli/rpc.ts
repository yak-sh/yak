// The wire: MCP over Streamable HTTP, hand-rolled, because a client that only
// ever asks three things — `initialize`, `tools/list`, `tools/call` — is
// smaller than the SDK that would answer them and carries no dependency into
// somebody's `deno install`.
//
// ONE POST IS ONE CALL. The door this speaks to is stateless (@yaks/mcp
// `mount.ts`): a request in, a reply out, nothing to strand. So `initialize`
// rides only on the listing path — where the protocol version is negotiated
// and cached beside the roster (store.ts) — and a call made from a cached
// roster costs a single round trip, which is what makes a CLI feel like one.
// A server that answers with a `mcp-session-id` gets it back on every call
// after.
//
// A 401 is the one status read for meaning: the door answers it with the
// `WWW-Authenticate` challenge an MCP client would follow into an OAuth flow,
// and this client has no browser to follow it with — so it says the one
// sentence a person can act on instead.

/** The newest protocol version this client speaks. */
export let PROTOCOL = '2025-06-18'

/** The door said no: a transport failure, or a JSON-RPC error. */
export class Refused extends Error {}

/** Nobody is signed in — the message is the sentence to print. */
export class Unauthorized extends Error {}

/** Where and as whom: the `/mcp` URL, the bearer, and the `fetch` to use
 * (a test hands over a handler, so nothing here needs a socket). */
export type Door = {
  url: string
  token?: string | null
  fetch?: (request: Request) => Response | Promise<Response>
}

/** One JSON-RPC method, asked and answered. */
export type Rpc = (
  method: string,
  params?: unknown,
) => Promise<Record<string, unknown>>

/** `yaks.app` → `https://yaks.app/mcp`; a whole origin is taken as given, so
 * a probe can aim at `http://localhost:8787`. */
export let doorUrl = (host: string): string =>
  (/^https?:\/\//.test(host) ? host : `https://${host}`)
    .replace(/\/+$/, '') + '/mcp'

// A Streamable HTTP server may answer one reply as one SSE event rather than
// as JSON. Only the `data:` lines carry it, and there is only ever one reply
// to one request, so the frames concatenate.
let eventData = (body: string): string =>
  body.split('\n')
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim())
    .join('')

let SIGN_IN = 'not signed in — run `yaks login <token>`, or set YAKS_TOKEN'

/** A client of one door. Ids count up within the process; the session id, if
 * the server minted one, rides on every call after the one that answered it. */
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

/** The handshake, for the listing path: what the server calls itself and
 * which protocol version it agreed to. */
export let initialize = async (ask: Rpc): Promise<Record<string, unknown>> =>
  await ask('initialize', {
    protocolVersion: PROTOCOL,
    capabilities: {},
    clientInfo: { name: 'yaks', version: '0.0.0' },
  })
