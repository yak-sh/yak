import { api, type Handler, type Tags } from '@yaks/api'
import { aliases } from '@yaks/alias'
import { blobs, sqliteBlobs } from '@yaks/blob'
import { describing } from '@yaks/code/described'
import { docs } from '@yaks/doc'
import type { Clock } from '@yaks/fp'
import { type Field, find, search } from '@yaks/fts'
import { type Bundle, type Graph, graph, type ReadOpts } from '@yaks/graph'
import { ids } from '@yaks/id/graph'
import { keys } from '@yaks/key'
import { personal, policy } from '@yaks/member'
import { type Clause, parse } from '@yaks/query'
import type { Derived, Driver } from '@yaks/sql'
import { storage } from '@yaks/sqlite'
import type { Vocab, VocabDoc } from '@yaks/vocab'
import { authenticating, type Vouch } from './app-authority.ts'
import { appListing, appRead } from './app-read.ts'
import { THROUGH } from './config.ts'
import { plugins as lenses } from './lenses-graph.ts'

let semantic = (c: Clause): boolean =>
  c.kind == 'near' ||
  ('clauses' in c && c.clauses.some(semantic)) ||
  (c.kind == 'pred' && c.where != null && semantic(c.where))

/** Listing reads that the fitted graph can answer without a live registry. */
export let plainListing = ({ pathname, searchParams: q }: URL): boolean => {
  if (
    pathname != '/query' || q.get('listing') != '1' ||
    q.get('live') == '1' || q.get('trusted') == '1' ||
    (q.has('names') && q.get('names') != '0')
  ) return false
  try {
    return !parse(q.get('q') ?? '').clauses.some(semantic)
  } catch {
    return false
  }
}

type Options = {
  driver: Driver
  vocab: Vocab
  derived: Derived
  searchable: Field[]
  name: string
  app: string
  manifest: () => VocabDoc
  clock: Clock
  read: (request: Request) => ReadOpts
  speak: (rows: Bundle[], graph: Graph) => Bundle[] | Promise<Bundle[]>
  vouch: (value: Vouch) => void
  ignore: (row: Bundle) => boolean
  spoke: (line: string) => void
  taught: (answer: Response) => Promise<Response>
  tags: () => Tags
  report: (error: unknown, request: string) => void
}

/** The listing door over already fitted Store tables. The host checks the
 * selected declaration and authorization revision before using this graph. */
export let storeListing = (
  options: Options,
): { graph: Graph; read: Handler } => {
  let { driver, vocab, derived, searchable, name, manifest, read } = options
  let rows = storage(driver, vocab, {
    derived,
    extend: [search(searchable, driver)],
    schemaReady: () => true,
    counts: 'lazy',
    report: (error) => options.report(error, 'store'),
  })
  let g = graph({
    vocab,
    storage: rows,
    clock: options.clock,
    report: (error, { phase, plugin }) =>
      options.report(error, `${plugin} ${phase}`),
    plugins: [
      ...lenses({
        vocab,
        report: (error) => options.report(error, 'lens normalize'),
      }, { store: { name, manifest } }),
      describing,
      keys(vocab),
      ids(vocab),
      aliases(),
      docs(),
      personal(vocab, {}, THROUGH),
      blobs(vocab, sqliteBlobs(rows.statements)),
    ],
  })
  let authenticate = authenticating(
    policy(rows, { ignore: options.ignore }),
    () => options.app,
    options.vouch,
  )
  let route = api({
    graph: g,
    authenticate,
    read,
    tags: options.tags,
    list: appListing({
      vocab,
      read,
      found: (text, opts, limit) =>
        find(driver, searchable, text, { limit, vocab, scope: g.scope(opts) }),
      speak: (rows) => options.speak(rows, g),
    }),
  })
  return {
    graph: g,
    read: appRead({
      graph: g,
      vocab,
      route,
      authenticate,
      read,
      own: false,
      spoke: options.spoke,
      trusted: () => g,
      taught: options.taught,
    }),
  }
}
