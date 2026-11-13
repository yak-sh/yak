// The transport: MCP over Streamable HTTP, as a plain `Request` → `Response`
// handler, so the same server runs on Deno, on Node, and in a Cloudflare
// Worker.
//
// Every POST is one JSON-RPC request in and one JSON reply out, in whichever
// era its body speaks (./protocol.ts): a legacy request may name a connection
// in `Mcp-Session-Id`, a modern one carries its own envelope and the standard
// headers mirroring it, and `subscriptions/listen` is the one modern request
// answered with a stream. When a caller supplies a session graph, the MCP
// session id names a persisted transcript; a restart preserves it, and two
// isolates share its identity. Any other `GET` is answered 405, as MCP
// specifies for a server without a stream. The handler mounts beside
// @yaks/api's routes without runtime code.
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
  type Authenticate,
  cutOf,
  type Handler,
  json,
  reads,
  refuse,
  type Told,
} from '@yaks/api'
import { TEXT } from '@yaks/api/address'
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
import {
  CAPABILITIES,
  CLIENT,
  isModern,
  MODERN,
  type Request as Rpc,
  SERVER,
  SUBSCRIPTION,
  VERSION,
} from './protocol.ts'

/** How the HTTP handler is built: everything {@link Options} takes except the
 * actor, which is decided per HTTP request. */
export type MountOptions = Omit<Options, 'actor' | 'only'> & {
  /** the graph that owns MCP connection transcripts. Without one, the
   * calling application owns its own Mcp-Session-Id and this transport does
   * not create graph sessions. */
  sessions?: Graph
  /** who is calling — what it returns signs every write the call makes
   * (default: nobody). Throwing `Unauthorized` refuses the request with a
   * 401. */
  authenticate?: Authenticate
  /** The process serving this door: a login of nobody through it is the
   * host's own fallback, which opens a connection of its own. */
  me?: string
  /** the only tools this request is offered, by name, where the way it
   * arrived narrows them (@yaks/api `Offers`); nothing for a request offered
   * every tool. Asked per request, as the actor is. */
  offers?: (request: Request) => string[] | undefined
  /** what this request is told before the server's own instructions, where
   * the way it arrived says so (@yaks/api `Told`): a tunnel's caller is told
   * the text of the persona it writes as. Asked only for `initialize`. */
  told?: Told
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

// The host's own process fallback: a request that named no caller, which the
// host signs as nobody through its process `me`. A process is an instrument,
// never an actor, so it stands in `via` alone.
let fallback = (login: Actor | null, me?: string) =>
  !!me && !login?.by && login?.via == me

/** The connection's own actor wins over its login. An authenticated identity
 * outside the graph remains a fallback when the connection names no actor. */
export let writer = (session: Actor, login: Actor | null): Actor =>
  !session.by && login?.by ? { ...session, by: login.by } : session

// The header is an opaque connection id, not a graph address. A process can
// restart between requests: the graph, rather than this handler, remembers it.
let connected = async (
  graph: Graph,
  id: string | null,
  actor: Actor | null,
  me?: string,
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
  let owner = actor?.by
    ? (await graph.get([actor.by]))[0]?.entity.eid
    : undefined
  let [session] = await graph.apply([{
    entity: { eid: crypto.randomUUID() },
    [SESSION]: {
      id: fresh,
      // A person authenticated by the host remains the actor. The host's
      // process fallback speaks only for itself and is not this connection,
      // which says only that the fallback opened it, for a door that trusts
      // the host's perimeter. session.actor is a reference, so an external
      // identity stays on this request's attribution without making session
      // creation fail.
      ...(owner ? { actor: owner } : {}),
      ...(fallback(actor, me) ? { fallback: true } : {}),
    },
  }], { trusted: true })
  return { session, id: fresh }
}

let object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v == 'object' && !Array.isArray(v)

// A JSON-RPC request, and a notification: what each must be to be one.
let isId = (v: unknown) =>
  typeof v == 'string' || (typeof v == 'number' && Number.isInteger(v))
let isRequest = (v: unknown): v is Rpc =>
  object(v) && v.jsonrpc == '2.0' && isId(v.id) &&
  typeof v.method == 'string' && (v.params === undefined || object(v.params))
let isNotification = (v: unknown) =>
  object(v) && v.jsonrpc == '2.0' && !('id' in v) &&
  typeof v.method == 'string' && (v.params === undefined || object(v.params))
let isResponse = (v: unknown) =>
  object(v) && v.jsonrpc == '2.0' && isId(v.id) &&
  ('result' in v || 'error' in v) && !('method' in v)

// The id a refusal may echo: a request's, when its body named one.
let echoed = (body: unknown) =>
  object(body) && typeof body.method == 'string' && isId(body.id)
    ? body.id
    : null

// A refusal of the modern door, the way its errors have always been laid out.
let rejected = (
  httpStatus: number,
  code: number,
  message: string,
  data?: unknown,
  id: unknown = null,
) =>
  Response.json({
    jsonrpc: '2.0',
    error: { code, message, ...(data === undefined ? {} : { data }) },
    id,
  }, { status: httpStatus })

// The statuses a refusal before any handler runs answers with.
let EARLY: Record<number, number> = {
  [-32700]: 400,
  [-32600]: 400,
  [-32601]: 404,
  [-32022]: 400,
  [-32021]: 400,
  [-32020]: 400,
}

// ---- which era a body speaks -----------------------------------------------
//
// A body names its era: an envelope in `_meta` is modern, anything else is
// legacy. The headers only mirror the body, so a header that disagrees with
// it, or a modern header over a body without its envelope, is refused rather
// than believed.

type Route =
  | { kind: 'legacy' }
  | { kind: 'modern'; message: Record<string, unknown>; revision: string }
  | {
    kind: 'reject'
    status: number
    code: number
    message: string
    data?: unknown
  }

let reject = (
  code: number,
  message: string,
  data?: unknown,
  httpStatus = 400,
): Route => ({ kind: 'reject', status: httpStatus, code, message, data })
let mismatch = (header: string, body: string) =>
  reject(
    -32020,
    `Bad Request: the request headers and body disagree: ${body}`,
    { mismatch: { header, body } },
  )

let metaOf = (params: unknown) =>
  object(params) && object(params._meta) ? params._meta : undefined

// What is wrong with an envelope, first problem first: a required key
// missing, or one of the wrong kind.
let issues = (meta: Record<string, unknown>) => {
  let found: { key: string; problem: string }[] = []
  for (let key of [VERSION, CAPABILITIES]) {
    if (!(key in meta)) found.push({ key, problem: 'missing' })
  }
  let want = (key: string, kind: string, ok: (v: unknown) => boolean) => {
    if (!(key in meta) || ok(meta[key])) return
    let v = meta[key]
    let got = v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v
    found.push({
      key,
      problem: `Invalid input: expected ${kind}, received ${got}`,
    })
  }
  want(VERSION, 'string', (v) => typeof v == 'string')
  want(CAPABILITIES, 'object', object)
  want(CLIENT, 'object', object)
  let client = meta[CLIENT]
  if (object(client)) {
    for (let key of ['name', 'version']) {
      let v = client[key]
      if (typeof v != 'string') {
        let got = v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v
        found.push({
          key: `${CLIENT}.${key}`,
          problem: `Invalid input: expected string, received ${got}`,
        })
      }
    }
  }
  return found
}
let invalid = (issue: { key: string; problem: string }) =>
  reject(
    -32602,
    `Invalid _meta envelope for protocol revision ${
      MODERN[0]
    }: ${issue.key}: ${issue.problem}`,
    { envelope: issue },
  )

let classify = (
  method: string,
  headers: { version?: string; method?: string },
  body: unknown,
): Route => {
  if (method != 'POST') return { kind: 'legacy' }
  if (Array.isArray(body)) {
    if (!body.length) {
      return reject(-32600, 'Bad Request: empty JSON-RPC batch')
    }
    if (
      body.some((m) =>
        metaOf(object(m) ? m.params : undefined)?.[VERSION] !== undefined
      )
    ) {
      return reject(
        -32600,
        `Bad Request: JSON-RPC batches may not contain requests for protocol revision ${
          MODERN[0]
        } or later`,
      )
    }
    return { kind: 'legacy' }
  }
  if (isResponse(body)) return { kind: 'legacy' }
  let request = isRequest(body)
  if (!request && !isNotification(body)) {
    return reject(
      -32600,
      'Bad Request: the request body is not a valid JSON-RPC message',
    )
  }
  let message = body as Record<string, unknown>
  let meta = metaOf(message.params)
  let claim = meta && VERSION in meta
  let claimed = typeof meta?.[VERSION] == 'string'
    ? meta[VERSION] as string
    : undefined
  let modernHeader = headers.version !== undefined && isModern(headers.version)
  let methodDiffers = headers.method !== undefined &&
    headers.method != message.method
  if (!request) {
    if (claim) {
      if (claimed === undefined) {
        return invalid(
          issues(meta!).find((i) => i.key == VERSION) ??
            { key: VERSION, problem: 'expected a protocol version string' },
        )
      }
      if (headers.version !== undefined && headers.version != claimed) {
        return mismatch(
          headers.version,
          `the notification envelope names protocol version ${claimed} but the MCP-Protocol-Version header names ${headers.version}`,
        )
      }
      if (!isModern(claimed)) return { kind: 'legacy' }
    } else if (!modernHeader) return { kind: 'legacy' }
    if (methodDiffers) {
      return mismatch(
        headers.method!,
        `the notification body names method ${message.method} but the Mcp-Method header names ${headers.method}`,
      )
    }
    return { kind: 'modern', message, revision: claimed ?? headers.version! }
  }
  let sound = claim && claimed !== undefined && isModern(claimed) &&
    !issues(meta!).length
  if (message.method == 'initialize' && !sound) {
    if (modernHeader) {
      return mismatch(
        headers.version!,
        'an initialize request (legacy handshake) was sent with a modern MCP-Protocol-Version header',
      )
    }
    return { kind: 'legacy' }
  }
  if (claim) {
    let first = issues(meta!)[0]
    if (first) return invalid(first)
    if (headers.version !== undefined && headers.version != claimed) {
      return mismatch(
        headers.version,
        `the body envelope names protocol version ${claimed} but the MCP-Protocol-Version header names ${headers.version}`,
      )
    }
    if (methodDiffers) {
      return mismatch(
        headers.method!,
        `the body names method ${message.method} but the Mcp-Method header names ${headers.method}`,
      )
    }
    return { kind: 'modern', message, revision: claimed! }
  }
  if (modernHeader) {
    let missing = !meta
      ? ['_meta']
      : issues(meta).filter((i) => i.problem == 'missing').map((i) => i.key)
    let named = missing.length ? missing : [VERSION]
    return reject(
      -32602,
      `Invalid params: the MCP-Protocol-Version header names protocol revision ${headers.version}, but the request is missing the required per-request envelope key(s): ${
        named.join(', ')
      }`,
      { envelope: { missing: named } },
    )
  }
  return { kind: 'legacy' }
}

// RFC 9110's optional whitespace, around a header's value.
let ows = (v: string | null) =>
  v == null ? undefined : v.replace(/^[ \t]+|[ \t]+$/g, '')

// The body field the `Mcp-Name` header mirrors, by method (SEP-2243).
let NAMED: Record<string, string> = {
  'tools/call': 'name',
  'prompts/get': 'name',
  'resources/read': 'uri',
  'tasks/get': 'taskId',
  'tasks/update': 'taskId',
  'tasks/cancel': 'taskId',
}

// A header's value as it was meant: as it is, or out of the Base64 sentinel
// `=?base64?…?=` that carries what a header cannot (undefined when the
// sentinel holds no canonical Base64 of UTF-8).
let decoded = (value: string): string | undefined => {
  if (!value.startsWith('=?base64?') || !value.endsWith('?=')) return value
  let b64 = value.slice(9, -2)
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      b64,
    )
  ) {
    return undefined
  }
  try {
    let bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return undefined
  }
}

// The `Mcp-Name` header against the body it mirrors. ChatGPT sends the body
// alone, so a missing header is read off the body; one that was sent and
// disagrees is refused.
let named = (request: Request, message: Record<string, unknown>) => {
  let field = Object.hasOwn(NAMED, message.method as string)
    ? NAMED[message.method as string]
    : undefined
  let header = ows(request.headers.get('mcp-name'))
  if (!field || header === undefined) return undefined
  let params = object(message.params) ? message.params : {}
  let value = typeof params[field] == 'string' ? params[field] : undefined
  let said = decoded(header)
  if (said === undefined) {
    return mismatch(
      header,
      'the Mcp-Name header carries an invalid Base64 sentinel value',
    )
  }
  if (value !== undefined && said != value) {
    return mismatch(
      header,
      `the body carries params.${field}="${value}" but the Mcp-Name header names "${said}"`,
    )
  }
}

let isJson = (type: string | null) =>
  type == 'application/json' ||
  (type ?? '').split(';', 1)[0].trim().toLowerCase() == 'application/json'

// A body read once, and no further than the protocol's limit.
let MAX = 4 * 1024 * 1024
let bounded = async (request: Request) => {
  let length = Number(request.headers.get('content-length'))
  if (length > MAX) return { tooLarge: true as const }
  let reader = request.body?.getReader()
  let parts: Uint8Array[] = []
  let size = 0
  for (;;) {
    if (!reader) break
    let { done, value } = await reader.read()
    if (done || !value) break
    size += value.byteLength
    if (size > MAX) {
      await reader.cancel()
      return { tooLarge: true as const }
    }
    parts.push(value)
  }
  let bytes = new Uint8Array(size)
  let at = 0
  for (let part of parts) bytes.set(part, at), at += part.byteLength
  return { text: new TextDecoder().decode(bytes) }
}

// ---- subscriptions/listen --------------------------------------------------
//
// The one modern request answered with a stream: the subscription
// acknowledged, then held open with a comment every 15 seconds until the
// caller hangs up. What it may hear is what the server says it announces;
// nothing is published on it here, since a host with news has a stream of
// its own (the yaks.app kernel's GET /mcp).

let KEEPALIVE = 15_000
let LIMIT = 1024

let honored = (
  asked: Record<string, unknown>,
  caps: Record<string, unknown>,
) => {
  let has = (kind: string, bit: string) =>
    (caps[kind] as Record<string, unknown> | undefined)?.[bit] === true
  let out: Record<string, unknown> = {}
  if (asked.toolsListChanged === true && has('tools', 'listChanged')) {
    out.toolsListChanged = true
  }
  if (asked.promptsListChanged === true && has('prompts', 'listChanged')) {
    out.promptsListChanged = true
  }
  if (asked.resourcesListChanged === true && has('resources', 'listChanged')) {
    out.resourcesListChanged = true
  }
  let uris = asked.resourceSubscriptions
  if (Array.isArray(uris) && uris.length && has('resources', 'subscribe')) {
    out.resourceSubscriptions = [...uris]
  }
  return out
}

let filter = (params: unknown) => {
  let asked = object(params) ? params.notifications : undefined
  if (!object(asked)) return undefined
  for (
    let key of [
      'toolsListChanged',
      'promptsListChanged',
      'resourcesListChanged',
    ]
  ) {
    if (asked[key] !== undefined && typeof asked[key] != 'boolean') {
      return undefined
    }
  }
  let uris = asked.resourceSubscriptions
  if (
    uris !== undefined &&
    (!Array.isArray(uris) || uris.some((u) => typeof u != 'string'))
  ) {
    return undefined
  }
  return asked
}

let listening = (open: Set<() => void>) =>
(
  message: Record<string, unknown>,
  signal: AbortSignal,
  caps: Record<string, unknown>,
  info: unknown,
): Response => {
  let id = message.id
  let say = (code: number, text: string) =>
    Response.json({ jsonrpc: '2.0', error: { code, message: text }, id })
  if (open.size >= LIMIT) return say(-32603, 'Subscription limit reached')
  let asked = filter(message.params)
  if (!asked) {
    return say(
      -32602,
      "Invalid params: 'notifications' is required and must be a valid SubscriptionFilter",
    )
  }
  let notifications = honored(asked, caps)
  let bytes = new TextEncoder()
  let frame = (data: unknown) =>
    bytes.encode(`event: message\ndata: ${JSON.stringify(data)}\n\n`)
  let stop = () => {}
  let body = new ReadableStream<Uint8Array>({
    start(out) {
      out.enqueue(frame({
        jsonrpc: '2.0',
        method: 'notifications/subscriptions/acknowledged',
        params: { notifications, _meta: { [SUBSCRIPTION]: id } },
      }))
      if (!Object.keys(notifications).length) {
        out.enqueue(frame({
          jsonrpc: '2.0',
          id,
          result: {
            resultType: 'complete',
            _meta: { [SUBSCRIPTION]: id, [SERVER]: info },
          },
        }))
        out.close()
        return
      }
      let beat = setInterval(
        () => out.enqueue(bytes.encode(': keepalive\n\n')),
        KEEPALIVE,
      )
      let ended = false
      stop = () => {
        if (ended) return
        ended = true
        clearInterval(beat)
        open.delete(stop)
        signal.removeEventListener('abort', stop)
        try {
          out.close()
        } catch { /* already closed */ }
      }
      open.add(stop)
      if (signal.aborted) stop()
      else signal.addEventListener('abort', stop, { once: true })
    },
    cancel: () => stop(),
  })
  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
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
  let report = opts.report ?? logged
  // One runner for the whole handler, not one per HTTP request: the `tool`
  // rows a call references are written once for the process, and a call still
  // running is one run however many requests ask about it.
  let runs = opts.runner
  let running = () =>
    runs ??= runner(opts.calls ?? opts.graph, {
      tools: opts.registry ?? listing(opts),
      host: opts.graph,
      report,
      ...opts.refused ? { refused: opts.refused } : {},
      ...opts.reply ? { reply: opts.reply } : {},
      ...opts.clock ? { clock: opts.clock } : {},
    })
  // A request asking in `x-yak-text` has each answer drawn by the host's
  // views (Options.text), and is told so in the same header.
  let drawing = (request: Request) =>
    request.headers.has(TEXT) ? opts.text : undefined
  let drawn = (request: Request, response: Response) => {
    if (drawing(request)) response.headers.set(TEXT, 'drawn')
    return response
  }
  // What an exchange is told: what the way its request arrived says to read
  // first, then this server's own, both only where it sends instructions.
  let instructing = async (request: Request, exchange?: Exchange) => {
    let own = await instructed(opts, exchange)
    if (!opts.told || (exchange && exchange.method != 'initialize')) return own
    let said = (await opts.told(request))?.trim()
    return said ? [said, own].filter(Boolean).join('\n\n') : own
  }
  let built = async (
    request: Request,
    actor: Actor | null,
    exchange?: Exchange,
  ) =>
    await prepared(
      server({
        ...opts,
        instructions: await instructing(request, exchange),
        actor,
        only: opts.offers?.(request),
        runner: running(),
        text: drawing(request),
        reading: () => reads(request),
        cut: cutOf(request),
      }),
      opts,
      exchange,
    )
  let listen = listening(new Set())

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
      if (!isRequest(body)) {
        // A JSON-RPC notification expects no answer at all; anything else that
        // is not a request is a client bug, reported in JSON-RPC's own terms.
        return isNotification(body)
          ? new Response(null, { status: 202 })
          : refused('not a JSON-RPC request', 400)
      }
      // A request whose run the door already knows (named in `x-via`, or by
      // the harness call its message makes) speaks through that run; only
      // one naming none speaks through a connection of its own. The host's
      // own fallback is its process for nobody, which names none.
      let named = !!actor?.via && !fallback(actor, opts.me)
      let conn = named || !opts.sessions ? undefined : await connected(
        opts.sessions,
        request.headers.get(ID),
        actor,
        opts.me,
      )
      if (
        !named && opts.sessions && request.headers.has(ID) &&
        !conn
      ) {
        return refused('unknown MCP session', 404)
      }
      let caller = conn
        ? writer(await speaking(opts.sessions!, conn.session), actor)
        : actor
      // Whatever else the calling program serves — resources, prompts — is
      // registered before the request is answered, so `resources/list` sees
      // them on the very first call rather than the second.
      let mcp = await built(request, caller, { method: body.method })
      let cancel = () => {}
      let asked = mcp.answer(body, 'legacy', request.signal)
      let late = ms == null ? undefined : new Promise<never>((_, no) => {
        cancel = clock.after(ms, () => no(new Error('mcp timeout')))
      })
      try {
        let { reply } = await (late ? Promise.race([asked, late]) : asked)
        let answer = json(reply)
        if (conn) answer.headers.set(ID, conn.id)
        return drawn(request, answer)
      } finally {
        cancel()
      }
    } catch (err) {
      return refusing(err, request)
    }
  }

  let modern = async (
    request: Request,
    route: Extract<Route, { kind: 'modern' }>,
    actor: Actor | null,
    body: unknown,
  ): Promise<Response> => {
    let { message } = route
    if (!MODERN.includes(route.revision)) {
      return rejected(
        400,
        -32022,
        `Unsupported protocol version: ${route.revision}`,
        { supported: [...MODERN], requested: route.revision },
        echoed(message),
      )
    }
    let asking = isRequest(message) ? message : undefined
    if (asking) {
      let off = named(request, asking)
      if (off?.kind == 'reject') {
        return rejected(off.status, off.code, off.message, off.data, message.id)
      }
    }
    let mcp
    try {
      mcp = await built(request, actor, { method: message.method as string })
    } catch (err) {
      await report(err)
      return rejected(
        500,
        -32603,
        'Internal server error',
        undefined,
        echoed(body),
      )
    }
    if (!asking) return new Response(null, { status: 202 })
    if (asking.method == 'subscriptions/listen') {
      return listen(asking, request.signal, mcp.capabilities(), mcp.info)
    }
    let { reply, early } = await mcp.answer(asking, 'modern', request.signal)
    let code = (reply.error as { code?: number } | undefined)?.code
    return drawn(
      request,
      Response.json(reply, {
        status: early && code !== undefined ? EARLY[code] ?? 200 : 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  }

  return async (request) => {
    try {
      // The host's authentication and security boundary runs before either
      // era, once per request, and is handed the message where it was read: a
      // harness names the run behind a call in the call's `_meta`.
      let who = async (message?: unknown) =>
        (await opts.authenticate?.(request, message)) ?? null
      let modernClaim = request.headers.has('MCP-Protocol-Version')
      let typed = isJson(request.headers.get('content-type'))
      let unsupported = () =>
        rejected(
          415,
          -32000,
          'Unsupported Media Type: Content-Type must be application/json',
        )
      let body: unknown
      if (request.method == 'POST') {
        let read
        try {
          read = await bounded(request)
        } catch {
          if (!modernClaim) return refused('the body is not JSON', 400)
          await who()
          return typed
            ? rejected(
              400,
              -32700,
              'Parse error: the request body could not be read',
            )
            : unsupported()
        }
        if (read.tooLarge) {
          await who()
          return typed
            ? rejected(
              413,
              -32000,
              `Payload Too Large: Request body must not exceed ${MAX} bytes`,
            )
            : unsupported()
        }
        try {
          body = JSON.parse(read.text)
        } catch {
          return refused('the body is not JSON', 400)
        }
      }
      let actor = await who(body)
      let route = classify(request.method, {
        version: ows(request.headers.get('mcp-protocol-version')),
        method: ows(request.headers.get('mcp-method')),
      }, body)
      if (route.kind == 'legacy') return await legacy(request, actor, body)
      // Preserve the pre-envelope door's 400 for bodies that cannot be a
      // request at all. An explicit modern header always belongs to the
      // modern door.
      if (!modernClaim && !object(body)) {
        return await legacy(request, actor, body)
      }
      if (!typed) return unsupported()
      // A refusal of the caller's own input is answered, never reported.
      if (route.kind == 'reject') {
        return json({
          jsonrpc: '2.0',
          id: echoed(body),
          error: {
            code: route.code,
            message: route.message,
            ...route.data === undefined ? {} : { data: route.data },
          },
        }, route.status)
      }
      return await modern(request, route, actor, body)
    } catch (err) {
      return refusing(err, request)
    }
  }
}
