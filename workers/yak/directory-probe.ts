// Directory decisions over rows in memory. App Stores stay behind their own
// namespace, so a test of a route need not install the platform's Store.
import { type Bundle, graph, signed } from '@yaks/graph'
import { secrets } from '@yaks/secrets'
import { plugins as trash } from './facets/trash-graph.ts'
import { plugins as meter } from './facets/meter-graph.ts'
import { vaultOf } from './vault.ts'
import type { Options } from './facets/store.ts'
import { ram } from '@yaks/ram'
import { refusal } from '@yaks/api'
import { status } from '@yaks/graph/errors'
import { assertEquals } from '@std/assert'
import { useUntil } from './used.ts'
import { doorOf, PLATFORM_OBJECT, PLATFORM_STORE } from './door.ts'
import { EPOCH, READS } from './directory-copy.ts'
import type { Env } from './env.ts'
import { vouchOf } from './graph.ts'
import { metaOf } from './meta.ts'
import { platformVocab } from './vocab.ts'
import { platform as runtime } from './testing.ts'

let vocab = platformVocab()

/** The directory's graph and wire, without a Durable Object or effects pool. */
export let rows = (env: Partial<Env> = {}) => {
  let g = graph({ vocab, storage: ram(vocab) })
  g.use(
    secrets(vaultOf(env), (rows) => g.apply(rows, { trusted: true }), vocab),
  )
  let options = { store: { meta: false } } as Options
  for (
    let plugin of [...trash(undefined, options), ...meter(undefined, options)]
  ) g.use(plugin)
  let revision = 0
  let fetch = async (req: Request): Promise<Response> => {
    let url = new URL(req.url)
    let headers = { [EPOCH]: String(revision) }
    try {
      if (url.pathname == '/used') {
        assertEquals(req.method, 'POST')
        assertEquals(req.headers.get('x-yak-kernel'), '1')
        let { eid, word } = await req.json() as { eid: string; word?: string }
        let mark = word == 'changed' || word == 'errored' ? word : 'used'
        let [row] = await g.read(`.entity.eid=${eid} ?${mark}`)
        if (!row) return Response.json({}, { status: 404 })
        let at = useUntil()
        let previous = (row[mark] as { at?: string } | undefined)?.at
        if (
          !previous || Date.parse(previous) <
            Date.parse(at) - (mark == 'used' ? 0 : 3_600_000)
        ) {
          await g.apply([{
            entity: { eid },
            [mark]: { at: mark == 'used' ? at : new Date().toISOString() },
          }], { trusted: true, stamp: false })
        }
        return Response.json({
          at: mark == 'used' && previous && previous > at ? previous : at,
        })
      }
      if (url.pathname == READS) {
        return Response.json(
          await Promise.all(
            url.searchParams.getAll('q').map(async (q) => ({
              status: 200,
              epoch: String(revision),
              body: JSON.stringify(await g.read(q)),
            })),
          ),
          { headers },
        )
      }
      if (url.pathname == '/query') {
        return Response.json(await g.read(url.searchParams.get('q') ?? ''), {
          headers,
        })
      }
      if (url.pathname == '/apply' && req.method == 'POST') {
        let v = vouchOf(req)
        let actor = v.person || v.via
          ? {
            ...(v.person ? { by: v.actor ?? v.person } : {}),
            ...(v.via ? { via: v.via } : {}),
          }
          : null
        let out = await g.apply(signed(await req.json() as Bundle[], actor), {
          trusted: req.headers.get('x-yak-kernel') == '1',
          stamp: url.searchParams.get('stamp') != '0',
        })
        return Response.json(out, { headers })
      }
      throw new Error(
        `Unhandled directory fixture request: ${req.method} ${url.pathname}`,
      )
    } catch (e) {
      return Response.json(refusal(e), { status: status(e), headers })
    }
  }
  return { graph: g, fetch, meta: metaOf(doorOf(fetch, PLATFORM_STORE)) }
}

/** Runtime bindings with the directory's decisions served by a RAM graph.
 * Store-specific behavior keeps using the runtime's app namespace. */
export let hosting = <T extends ReturnType<typeof runtime>>(scenario: T): T => {
  // Copy fencing is a Store behavior; its tests retain the complete boundary.
  if (scenario.env.SERVING_COPY) return scenario
  let directory = rows(scenario.env)
  let stores = scenario.env.STORE
  scenario.env.STORE = {
    idFromName: (name) => name,
    get: (name, options) =>
      String(name) == PLATFORM_OBJECT
        ? { fetch: directory.fetch }
        : stores.get(name, options),
  }
  scenario.env.META = directory.meta
  return scenario
}

/** Runtime bindings with a RAM directory. */
export let platform = (secret: string, vars: Partial<Env> = {}) =>
  hosting(runtime(secret, vars))
