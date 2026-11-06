// Directory decisions over rows in memory. App Stores stay behind their own
// namespace, so a test of a route need not install the platform's Store.
import {
  type Bundle,
  type Graph,
  graph,
  signed,
  type Storage,
} from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { secrets } from '@yaks/secrets'
import { effects, type Handlers } from '@yaks/effects'
import { cleanup } from '@yaks/testing'
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
import { EPOCH, fenced, READS, type ServingCopyDoor } from './directory-copy.ts'
import type { Env, Vars } from './env.ts'
import { vouchOf } from './app-authority.ts'
import { directoryOf, directoryRows, part, type Row } from './directory.ts'
import { type Meta, metaOf } from './meta.ts'
import { platformVocab } from './vocab.ts'
import { bindings } from './binding-probe.ts'

let vocab = platformVocab()

type Composition = {
  handlers?: (env: Env, graph: Graph) => Handlers
  copy?: ServingCopyDoor
  storage?: (vocab: Vocab) => Storage
}

/** The directory's graph and wire, with optional effect handlers drained in memory. */
export let rows = (
  env: Partial<Env> = {},
  handlers?: (graph: Graph) => Handlers,
  copy?: ServingCopyDoor,
  storage?: Composition['storage'],
) => {
  let g = graph({ vocab, storage: storage?.(vocab) ?? ram(vocab) })
  g.use(
    secrets(vaultOf(env), (rows) => g.apply(rows, { trusted: true }), vocab),
  )
  let options = { store: { meta: false } } as Options
  for (
    let plugin of [...trash(undefined, options), ...meter(undefined, options)]
  ) g.use(plugin)
  let failures: unknown[] = []
  let fx = handlers && effects(vocab, {
    defer: true,
    report: (error) => void failures.push(error),
    write: (rows) => g.apply(rows, { trusted: true }),
  })
  if (fx && handlers) {
    g.use(fx)
    fx.handle(handlers(g))
    cleanup(() => fx.stop())
  }
  let revision = 0
  let apply = async (entities: Bundle[], req: Request, stamp = true) => {
    let v = vouchOf(req)
    let actor = v.person || v.via
      ? {
        ...(v.person ? { by: v.actor ?? v.person } : {}),
        ...(v.via ? { via: v.via } : {}),
      }
      : null
    let bundles = signed(entities, actor)
    let write = async (at = revision) => {
      let out = await g.apply(bundles, {
        trusted: req.headers.get('x-yak-kernel') == '1',
        stamp,
      })
      revision = at
      return out
    }
    let out = copy
      ? await fenced(copy, write, () => revision, env.CLOCK)
      : await write()
    if (fx) {
      await fx.work(g)
      await fx.idle()
      if (failures.length) throw failures.shift()
    }
    return out
  }
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
        let out = await apply(
          await req.json() as Bundle[],
          req,
          url.searchParams.get('stamp') != '0',
        )
        return Response.json(out, { headers })
      }
      throw new Error(
        `Unhandled directory fixture request: ${req.method} ${url.pathname}`,
      )
    } catch (e) {
      return Response.json(refusal(e), { status: status(e), headers })
    }
  }
  let meta: Meta = {
    door: doorOf(fetch, PLATFORM_STORE),
    query: async (q) => await g.read(q),
    apply: (entities, headers = {}, opts = {}) =>
      apply(
        entities,
        new Request('http://directory/apply', { headers }),
        opts.stamp !== false,
      ),
  }
  let local = part(meta)
  let dir = directoryRows({
    query: async (q) =>
      (await g.read(q) as Row[]).map((row) => ({
        ...row,
        policy: { revision },
      })),
    apply: local.apply,
  })
  return {
    graph: g,
    dir,
    fetch,
    // Physical storage fixtures also measure the store door's round trips.
    meta: storage ? metaOf(meta.door!) : meta,
  }
}

/** Runtime bindings with the directory's decisions served by a RAM graph.
 * Store-specific behavior keeps using the runtime's app namespace. */
export let hosting = <T extends { env: Env }>(
  scenario: T,
  { handlers, copy, storage }: Composition = {},
): T & { dir: ReturnType<typeof directoryRows> } => {
  // Copy fencing is a Store behavior; its tests retain the complete boundary.
  if (scenario.env.SERVING_COPY && !copy) {
    return Object.assign(scenario, { dir: directoryOf(scenario.env.STORE) })
  }
  let stores = scenario.env.STORE
  let directory: ReturnType<typeof rows>
  scenario.env.STORE = {
    idFromName: (name) => name,
    get: (name, options) =>
      String(name) == PLATFORM_OBJECT
        ? { fetch: directory.fetch }
        : stores.get(name, options),
  }
  // Effect handlers register against the namespace they will deliver to.
  // Install its closure before constructing the graph and its handlers.
  directory = rows(
    scenario.env,
    handlers && ((graph) => handlers(scenario.env, graph)),
    copy,
    storage,
  )
  scenario.env.META = directory.meta
  return Object.assign(scenario, { dir: directory.dir })
}

/** Runtime bindings with a RAM directory. */
export let platform = (
  secret: string,
  vars: Vars = {},
  composition: Composition = {},
) => hosting(bindings(secret, vars), composition)
