// The app wire over a graph in memory. These callers test routing, query
// encoding and uploads; Store installation and authorization have their own
// tests through the Store. Kernel writes retain their trusted boundary here.
import { AsyncLocalStorage } from 'node:async_hooks'
import { api, json, subscriptions } from '@yaks/api'
import { apiDoc } from '@yaks/api/vocab'
import { type Graph, graph } from '@yaks/graph'
import { policy } from '@yaks/member'
import { ram } from '@yaks/ram'
import { cleanup } from '@yaks/testing'
import { loadVocab, type Vocab } from '@yaks/vocab'
import { PLATFORM_OBJECT, USES } from './door.ts'
import type { Env } from './env.ts'
import { authenticating } from './graph.ts'
import { appVocab } from './vocab.ts'

let base = appVocab()
let vocab = loadVocab([...base.docs, apiDoc], base.keywords)

let app = (vocab: Vocab, name: string) => {
  let g = graph({ vocab, storage: ram(vocab) })
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
  let serve = api({
    graph: view,
    subs,
    authenticate,
    writeParams: ['stamp'],
  })
  let fetch = async (req: Request) => {
    let path = new URL(req.url).pathname
    if (path == '/uses') return Response.json({})
    // The Store descriptor identifies which app door a route reached.
    if (path == '/graph') return Response.json({ db: `do:${name}` })
    let answer = await request.run(req, () => serve(req))
    if (path == '/query') {
      if (answer.ok) {
        let rows = await answer.json()
        answer = json(
          Array.isArray(rows)
            ? rows.map((row) => ({ kind: vocab.kindOf(row), ...row }))
            : rows,
          answer.status,
        )
      }
      answer.headers.set(USES, '{}')
    }
    return answer
  }
  return { graph: g, subs, fetch, authenticate }
}

/** Keep each app's API rows apart, with the fixture's directory unchanged. */
export let stores = (env: Env, words = vocab) => {
  if (!words.comp('apply_receipt')) {
    words = loadVocab([...words.docs, apiDoc], words.keywords)
  }
  let directory = env.STORE
  let held = new Map<string, ReturnType<typeof app>>()
  let at = (name: string) => {
    let found = held.get(name)
    if (!found) held.set(name, found = app(words, name))
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
