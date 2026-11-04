// The app wire over a graph in memory. These callers test routing, query
// encoding and uploads; Store installation and authorization have their own
// tests through the Store. Kernel writes retain their trusted boundary here.
import { AsyncLocalStorage } from 'node:async_hooks'
import { api, json, refuse, subscriptions } from '@yaks/api'
import { apiDoc } from '@yaks/api/vocab'
import { type Graph, graph, signed, type Tool } from '@yaks/graph'
import { personalsIn, policy } from '@yaks/member'
import { type Hibernation, sockets } from '@yaks/durable-object'
import { runner } from '@yaks/tools'
import { answerOf, toolEid } from '@yaks/tools/result'
import { ram } from '@yaks/ram'
import { cleanup } from '@yaks/testing'
import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import { PLATFORM_OBJECT, USES } from './door.ts'
import type { Env } from './env.ts'
import { authenticating } from './graph.ts'
import { appVocab } from './vocab.ts'
import { kinded, naming } from './app-subs.ts'
import { asking, screened } from './listing.ts'

let base = appVocab()
let vocab = loadVocab([...base.docs, apiDoc], base.keywords)

type Composition = {
  declaration?: VocabDoc
  graph?: (vocab: Vocab) => Graph
  settled?: (graph: Graph) => Promise<void>
  tools?: (vocab: Vocab) => Tool[]
  sockets?: Hibernation
}

let app = (vocab: Vocab, name: string, composition: Composition) => {
  let g = composition.graph?.(vocab) ?? graph({ vocab, storage: ram(vocab) })
  let request = new AsyncLocalStorage<Request>()
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
  let authenticate = authenticating(policy(g.storage), () => null)
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
  let serve = api({
    graph: view,
    subs,
    authenticate,
    writeParams: ['stamp'],
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
    if (path == '/vocab' && composition.declaration && req.method == 'GET') {
      return Response.json(composition.declaration)
    }
    // The Store descriptor identifies which app door a route reached.
    if (path == '/graph') return Response.json({ db: `do:${name}` })
    let answer = await request.run(req, () => serve(req))
    if (path == '/query') {
      if (answer.ok) {
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
    let answer = await route(req)
    await composition.settled?.(g)
    return answer
  }
  return { graph: g, subs, fetch, authenticate, live }
}

/** Keep each app's API rows apart, with the fixture's directory unchanged. */
export let stores = (
  env: Env,
  words = vocab,
  composition: Composition = {},
) => {
  if (!words.comp('apply_receipt')) {
    words = loadVocab([...words.docs, apiDoc], words.keywords)
  }
  let directory = env.STORE
  let held = new Map<string, ReturnType<typeof app>>()
  let at = (name: string) => {
    let found = held.get(name)
    if (!found) held.set(name, found = app(words, name, composition))
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
