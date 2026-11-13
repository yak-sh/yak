// The route table. Four paths, and the two callbacks the application
// supplies; every answer is watched for breaking by ./request.ts `served`.
//
// Attribution is decided here. `authenticate` runs on every request — a read,
// a write and a WebSocket upgrade alike — and what it returns is what signs
// the write; whatever `$actor` a client sent is discarded before the graph
// sees it. `upgrade` is the only step no web standard covers, so a runtime
// other than Deno supplies its own.

import type { Actor, ReadOpts } from '@yaks/graph'
import { Refused } from '@yaks/graph/errors'
import { type Authenticate } from './actor.ts'
import { applier, type Applying, ask } from './doors.ts'
import { denoUpgrade } from './deno.ts'
import { json } from './refuse.ts'
import { type Report, served } from './request.ts'
import { attach, type Upgrade } from './socket.ts'
import { type Subs, subscriptions } from './subs.ts'

import type { Handler } from './routed.ts'

export { type Handler, type Route, routed } from './routed.ts'

/** A check every request passes before any route or door answers it: a
 * plugin's own word on which requests it lets in. It refuses one by throwing
 * (a `Denied`, say, which answers 403), and anything it does not throw at goes
 * on. */
export type Filter = (request: Request) => void | Promise<void>

/** Who a request that reached the host through a plugin's link (a tunnel) is
 * from: its actor, `null` for nobody, or `undefined` for a request that came
 * another way. How a request arrived outranks what it says about itself, so a
 * host asks this before its `authenticate`: a request through a link never
 * names one of the host's own runs. */
export type Arrived = (
  request: Request,
) => Actor | null | undefined | Promise<Actor | null | undefined>

/** The tools a request that reached the host through a plugin's link is
 * offered, by name, or `undefined` for a request that came another way, which
 * is offered every tool. */
export type Offers = (request: Request) => string[] | undefined

/** What a request that reached the host through a plugin's link is told
 * before anything else a door says to read, such as the text of the persona
 * it writes as, or `undefined` for a request told nothing of its own. */
export type Told = (
  request: Request,
) => string | undefined | Promise<string | undefined>

/** How a handler is built: the graph it serves, the callbacks the
 * application supplies, and what its apply door is made of ({@link Applying}). */
export type Options = Applying & {
  /** Caller read context for queries, write replies and socket frames. */
  read?: (
    request: Request,
  ) => ReadOpts | undefined | Promise<ReadOpts | undefined>
  /** the runtime's WebSocket upgrade (default: Deno's) */
  upgrade?: Upgrade
  /** schedule socket relay batches (default: setTimeout) */
  socketTimer?: (fn: () => void, ms: number) => void
  /** clock for socket relay admission (default: Date.now) */
  socketNow?: () => number
  /** the subscription registry (default: a fresh one over `graph`) */
  subs?: Subs
  /** where a request that broke goes, as its `request` bundle (default: the
   * console) */
  report?: Report
}

let nobody: Authenticate = () => null

/** The paths {@link api} answers itself. */
export let DOORS: string[] = ['/apply', '/query', '/ws', '/vocab', '/who']

/**
 * Build the request handler for a graph: `POST /apply`, `GET|POST /query`,
 * `/ws` for live subscriptions, `GET /vocab`, the vocabulary, and `GET /who`,
 * the actor `authenticate` names for the request. Everything
 * else is a 404, every thrown error becomes the refusal body it describes (see
 * the README's Refusals), and an answer at 500 or over goes to `report` as a
 * `request` bundle (./request.ts `served`).
 *
 * ```ts ignore
 * Deno.serve(api({ graph, authenticate }))
 * ```
 */
export let api = (opts: Options): Handler => {
  let { graph } = opts
  let subs = opts.subs ??
    subscriptions(graph, { activity: opts.activity ?? graph })
  let authenticate = opts.authenticate ?? nobody
  let upgrade = opts.upgrade ?? denoUpgrade
  let apply = applier(opts)
  let no = (message: string, code: number) =>
    json({ error: code == 404 ? 'NotFound' : 'NotAllowed', message }, code)

  let door: Handler = async (request) => {
    let path = new URL(request.url).pathname
    // The apply door names its own writer: a request its host trusts names
    // none here.
    if (path == '/apply' && request.method == 'POST') {
      return await apply.apply(request)
    }
    let who = await authenticate(request)
    if (path == '/apply') return no('/apply takes POST', 405)
    let context = opts.read && (path == '/query' || path == '/ws')
      ? await opts.read(request)
      : undefined
    let readOpts: ReadOpts = { ...context, person: who?.by ?? null }
    if (path == '/query') {
      if (request.method != 'GET' && request.method != 'POST') {
        return no('/query takes GET or POST', 405)
      }
      let url = new URL(request.url)
      if (request.method == 'GET' && url.searchParams.get('live') == '1') {
        let q = url.searchParams.get('q')
        if (q == null) throw new Refused('/query needs a query: ?q=…')
        return json(
          await subs.snapshot(q, { ...readOpts, signal: request.signal }),
        )
      }
      return await ask(graph, request, opts.activity ?? graph, readOpts)
    }
    // What a client must load to read and write this graph as it does:
    // the documents and the keyword sets they are written with, for
    // @yaks/vocab `loadVocab(docs, keywords)`.
    if (path == '/vocab') {
      let { docs, keywords } = graph.vocab
      return request.method == 'GET'
        ? json({ docs, keywords })
        : no('/vocab takes GET', 405)
    }
    // Who this door says is calling, for a graph that names its callers by
    // asking this one (./actor.ts `asking`).
    if (path == '/who') {
      return request.method == 'GET' ? json(who) : no('/who takes GET', 405)
    }
    if (path == '/ws') {
      if (
        (request.headers.get('upgrade') ?? '').toLowerCase() != 'websocket'
      ) {
        return no('/ws is a WebSocket endpoint', 405)
      }
      let { socket, response } = upgrade(request)
      attach(subs, socket, opts.socketTimer, opts.socketNow, readOpts, {
        actor: who,
        speaks: readOpts?.speaks,
      })
      return response
    }
    return no(`no route for ${path}`, 404)
  }
  return served(door, {
    graph: opts.activity ?? graph,
    report: opts.report,
    tags: opts.tags,
    route: (request) => {
      let path = new URL(request.url).pathname
      return DOORS.includes(path) ? path : undefined
    },
  })
}
