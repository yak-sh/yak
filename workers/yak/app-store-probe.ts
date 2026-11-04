// The app wire over a supplied graph: RAM for routing and uploads, SQLite
// for blob-backed search and private scope. Production authority and read
// seams stay shared; the Store owns installation and runtime duties.
import { AsyncLocalStorage } from 'node:async_hooks'
import { api, json, refuse, subscriptions } from '@yaks/api'
import { apiDoc } from '@yaks/api/vocab'
import {
  type Actor,
  type ApplyOpts,
  type Bundle,
  type Graph,
  graph,
  type ReadOpts,
  signed,
  type Tool,
} from '@yaks/graph'
import { type Mode, personalsIn, policy } from '@yaks/member'
import { type Hibernation, sockets } from '@yaks/durable-object'
import { runner } from '@yaks/tools'
import { answerOf, toolEid } from '@yaks/tools/result'
import { ram } from '@yaks/ram'
import { cleanup } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import { PLATFORM_OBJECT, USES } from './door.ts'
import type { Env } from './env.ts'
import { appGuard, authenticating, vouchOf } from './app-authority.ts'
import { appDoc, appVocab } from './vocab.ts'
import { appRead } from './app-read.ts'
import { lowering, vouching } from './app-writes.ts'
import type { Hit } from '@yaks/fts'
import { kinded, naming } from './app-subs.ts'
import { asking, screened } from './listing.ts'

let base = appVocab()
let vocab = loadVocab([...base.docs, apiDoc], base.keywords)

export type Composition = {
  app?: { eid: string; mode: Mode; manifest: VocabDoc }
  declaration?: VocabDoc
  graph?: (vocab: Vocab) => Graph
  settled?: (graph: Graph) => Promise<void>
  tools?: (vocab: Vocab) => Tool[]
  found?: (graph: Graph, text: string, opts: ReadOpts, limit: number) => Hit[]
  sockets?: Hibernation
}

export let appWire = (vocab: Vocab, name: string, composition: Composition) => {
  let g = composition.graph?.(vocab) ?? graph({ vocab, storage: ram(vocab) })
  let request = new AsyncLocalStorage<Request>()
  if (composition.app) {
    let { eid, mode, manifest } = composition.app
    g.apply([{ entity: { eid }, access: { mode } }], { trusted: true })
    g.use(lowering(() => vocab))
    g.use(vouching({
      app: () => eid,
      authority: () => {
        let req = request.getStore()
        return req ? vouchOf(req) : undefined
      },
    }))
    g.use(appGuard(eid, vocab, manifest, {
      level: () => {
        let req = request.getStore()
        return req ? vouchOf(req).level : undefined
      },
    }))
  }
  let view: Graph = {
    ...g,
    apply: (rows, options) => {
      let req = request.getStore()
      return g.apply(rows, {
        ...options,
        ...req
          ? {
            trusted: req.headers.get('x-yak-kernel') == '1',
            stamp: new URL(req.url).searchParams.get('stamp') != '0',
          }
          : {},
      })
    },
  }
  let subs = subscriptions(view)
  let authenticate = authenticating(
    policy(g.storage),
    () => composition.app?.eid ?? null,
  )
  let live = composition.sockets && sockets(
    naming(subs, {
      query: (line) =>
        asking(
          line,
          screened((word) => !!vocab.comp(word), false),
          personalsIn(vocab),
        ),
      kind: (row) => kinded(vocab, row),
    }),
    composition.sockets,
  )
  let run = composition.tools && runner({
    ...g,
    apply: (rows, options) => g.apply(rows, { ...options, trusted: true }),
  }, { host: g, tools: composition.tools(vocab) })
  let read = (req: Request): ReadOpts => ({
    person: vouchOf(req).person,
    administrative: req.headers.get('x-yak-administrative') == '1',
  })
  let serve = api({
    graph: view,
    subs,
    authenticate,
    writeParams: ['stamp'],
    read,
  })
  let query = composition.found && appRead({
    graph: g,
    vocab,
    route: serve,
    authenticate,
    read,
    own: false,
    spoke: () => {},
    trusted: () => ({
      ...g,
      read: (line) => g.read(line, { administrative: true }),
    }),
    found: (text, opts, limit) => composition.found!(g, text, opts, limit),
    speak: (rows) => rows,
    taught: (answer) => Promise.resolve(answer),
  })
  let route = async (req: Request) => {
    let path = new URL(req.url).pathname
    if (path == '/call' && run) {
      if (req.method != 'POST' || req.headers.get('x-yak-kernel') != '1') {
        return json({ error: 'NotFound', message: 'no route' }, 404)
      }
      try {
        let { name, args, id, source } = await req.json()
        await run.ensure([name])
        let answer = answerOf(
          await run.call(
            signed([{
              entity: { eid: id },
              call: { to: toolEid(name), args, id, source },
            }], await authenticate(req))[0],
          ),
          id,
        )
        let failure = answer.find((b) => b.refusal || b.exception)
        return failure
          ? json({
            error: 'Refused',
            message: (failure.content as { body: string }).body,
          }, failure.exception ? 500 : 400)
          : json(answer)
      } catch (error) {
        return refuse(error, req)
      }
    }
    if (path == '/uses') return Response.json({})
    if (path == '/vocab' && composition.declaration) {
      if (req.method == 'GET') return Response.json(composition.declaration)
      if (req.method == 'POST' && req.headers.get('x-yak-kernel') == '1') {
        assertEquals(appDoc(await req.json()), composition.declaration)
        return Response.json({ comps: vocab.comps })
      }
    }
    // The Store descriptor identifies which app door a route reached.
    if (path == '/graph') return Response.json({ db: `do:${name}` })
    let answer = await request.run(
      req,
      () => path == '/query' && query ? query(req) : serve(req),
    )
    if (path == '/query') {
      if (answer.ok && !query) {
        let rows = await answer.json()
        answer = json(
          Array.isArray(rows) ? rows.map((row) => kinded(vocab, row)) : rows,
          answer.status,
        )
      }
      answer.headers.set(USES, '{}')
    }
    return answer
  }
  let fetch = async (req: Request) => {
    let answer = await request.run(req, () => route(req))
    await composition.settled?.(g)
    return answer
  }
  let write = (
    req: Request,
    rows: Bundle[],
    actor: Actor | null,
    opts: ApplyOpts = {},
  ) => request.run(req, () => g.apply(signed(rows, actor), opts))
  return { graph: g, subs, fetch, authenticate, live, write }
}

/** The graph API's receipt words beside the app's declared vocabulary. */
export let wireVocab = (words: Vocab) =>
  words.comp('apply_receipt')
    ? words
    : loadVocab([...words.docs, apiDoc], words.keywords)

/** Keep each app's API rows apart, with the fixture's directory unchanged. */
export let stores = (
  env: Env,
  words = vocab,
  composition: Composition = {},
) => {
  words = wireVocab(words)
  let directory = env.STORE
  let held = new Map<string, ReturnType<typeof appWire>>()
  let at = (name: string) => {
    let found = held.get(name)
    if (!found) held.set(name, found = appWire(words, name, composition))
    return found
  }
  env.STORE = {
    idFromName: (name) => name,
    get: (name, options) =>
      String(name) == PLATFORM_OBJECT
        ? directory.get(name, options)
        : at(String(name)),
  }
  cleanup(() => {
    for (let store of held.values()) store.subs.stop()
  })
  return at
}
