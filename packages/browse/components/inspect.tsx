// Browse supplies the inspector's views with the same held queries, page
// graph and navigation as every other app view. The readings stay in inspect;
// this is only the app's host adapter, not a second inspector or registry.
import { type ComponentChild, h } from 'preact'
import { resolve } from '@yaks/render'
import { signal } from '@preact/signals'
import { useLayoutEffect, useMemo } from 'preact/hooks'
import { parse } from '@yaks/query'
import { all, schemaPages } from '@yaks/inspect/views'
import { inspectViews as memoryViews } from '@yaks/memory/views'
import { inspectViews as sessionViews } from '@yaks/session/views'
import { inspectViews as taskViews } from '@yaks/task/views'
import type { Answer, Ask, Asks, Bundle, Io } from '@yaks/inspect'
import {
  aggRead,
  apply,
  dropAgg,
  dropQuery,
  ent,
  holdAgg,
  holdAggOnce,
  holdQuery,
  queryEids,
  querySubscription,
  row,
  subscriptionState,
} from '../live.ts'
import { parseQuery, type Pred, resolveRefs } from '../query.ts'
import { findEid } from '../live.ts'
import { idOf, kindOf, vocab } from '../types.ts'
import { called } from '@yaks/inspect'
import { bundle, type Entry, extend, registry, renderView } from './registry.ts'
import { front } from './fields.tsx'
import { ago } from './Stamp.tsx'
import { navigate } from './nav.tsx'
import { type Home, type Offer, offerPlaces } from './offers.ts'
import { learnGlyphs } from './icons.tsx'
import type { IconNode } from 'lucide'

let held = (eid: string): Bundle | undefined =>
  row(eid).value ? bundle(ent(eid)) : undefined

let AGGREGATES = ['count', 'tally', 'distinct']

// One ask, read: its line, whether it is an aggregate, and its predicates.
type Plan = {
  line: string
  once: boolean
  agg: boolean
  preds?: Pred[]
  error?: string
}
let plan = (a: Ask): Plan => {
  let line = typeof a == 'string' ? a : a.query
  let once = typeof a != 'string' && a.once
  try {
    let agg = parse(line).clauses.some((c) => AGGREGATES.includes(c.kind))
    return {
      line,
      once,
      agg,
      preds: agg ? undefined : resolveRefs(parseQuery(line), findEid),
    }
  } catch (e) {
    return { line, once, agg: false, error: String(e) }
  }
}

let aggName = (p: Plan) => `inspect:${p.once ? 'once' : 'live'}:${p.line}`

// Hold what an ask needs while its view is mounted.
let hold = (p: Plan): () => void => {
  if (p.error) return () => {}
  if (p.agg) {
    let name = aggName(p)
    p.once ? holdAggOnce(name, p.line) : holdAgg(name, p.line)
    return () => dropAgg(name)
  }
  holdQuery(p.preds!, p.line)
  return () => dropQuery(p.preds!)
}

// What an ask's answer is now: read in the render, so a new answer paints.
let answer = (p: Plan): Answer => {
  if (p.error) return { rows: [], ready: true, error: p.error }
  if (p.agg) {
    let name = aggName(p)
    let state = subscriptionState(name)
    let got = aggRead(name)
    let map = got?.map ?? {}
    let failed = state.status == 'failed' ? state.reason : undefined
    return {
      rows: [],
      ready: !!got?.live,
      error: failed,
      count: got?.live && /\.count\b/.test(p.line) ? map[''] ?? 0 : undefined,
      tally: got?.live && !/\.count\b/.test(p.line) ? map : undefined,
    }
  }
  let state = querySubscription(p.preds!, p.line)?.state
  let rows = queryEids(p.preds!, p.line).value.map(held)
    .filter((b): b is Bundle => !!b)
  return {
    rows,
    ready: !state || state.status == 'ready',
    error: state?.status == 'failed' ? state.reason : undefined,
  }
}

let useAnswers = (asks: Asks): Record<string, Answer> => {
  let key = JSON.stringify(asks)
  let plans = useMemo(
    () => Object.entries(asks).map(([name, a]) => [name, plan(a)] as const),
    [key],
  )
  useLayoutEffect(() => {
    let drops = plans.map(([, p]) => hold(p))
    return () => drops.forEach((drop) => drop())
  }, [key])
  return Object.fromEntries(plans.map(([name, p]) => [name, answer(p)]))
}

// Inspector state is in the page graph; reading it during a render wakes
// that render when an inspector control or history pager changes it, or a
// view sets state of its own there (a @yaks/ux Disclosure's).
let turn = signal(0)
front.watch('.inspector|.table').subscribe(() => turn.value++)

export let inspectIo: Io = {
  vocab,
  ask: useAnswers,
  edits: typeof Deno == 'undefined',
  apply: async (bs) => {
    await apply(bs)
  },
  get: (eid) => row(eid).value ? bundle(ent(eid)) : undefined,
  link: (eid) => `/${idOf(ent(eid))}`,
  find: (q) => `/?q=${encodeURIComponent(q)}`,
  go: (href) => navigate(href),
  id: (b) =>
    idOf({ eid: b.entity.eid, num: Number(b.entity.num), kind: kindOf(b) }),
  kind: kindOf,
  name: (eid) => {
    let e = ent(eid)
    return called(bundle(e), idOf(e), e.kind)
  },
  when: ago,
  state: (eid) => (turn.value, front.ent(eid)),
  set: (bs) => {
    void Promise.resolve(front.mutate(bs)).then(() => turn.value++)
  },
  show: (b, view, ctx = {}) => {
    let e = ent(b.entity.eid)
    let supplied = { ...e, ...b, eid: b.entity.eid, entity: b.entity }
    return renderView(supplied as import('../types.ts').Ent, view, ctx)
  },
  can: (b, view) => !!resolve(registry, b, view, vocab),
}

// The app's registry selects the inspector's parts too: a package's more
// specific reading wins, and io.show comes back through this same registry.
export let adaptViews = (views: import('@yaks/inspect').View[]): Entry[] =>
  views
    .filter((r) => r.view != 'Inspect.Reference.Inline')
    .map((r) => ({
      ...r,
      Render: ({ e, ...ctx }) => {
        let b = bundle(e)
        let got = useAnswers(r.asks?.(b, inspectIo, ctx) ?? {})
        return h(r.Render, { e: b, io: inspectIo, ctx, got })
      },
    }))

export let inspectViews: Entry[] = adaptViews([
  ...await memoryViews(),
  ...await sessionViews(),
  ...await taskViews(),
  ...all,
].filter((r) =>
  (r.view != 'Inspect.Page' || schemaPages.includes(r)) &&
  r.view != 'Inspect.Reference.Inline'
))

// Query and map pages are chosen by the same registry as entity pages. The
// temporary bundle identifies the page; its query is caller context, not data
// written into the server graph.
export let InspectPage = (
  { query, map }: { query?: string; map?: boolean },
) => {
  let b = { entity: { eid: map ? 'browse-map' : `browse-query:${query}` } }
  let entry = resolve(registry, b, map ? 'Inspect.Map' : 'Inspect.Query', vocab)

  return entry && 'Render' in entry
    ? h(entry.Render, {
      e: {
        eid: map ? 'browse-map' : `browse-query:${query}`,
        entity: { eid: map ? 'browse-map' : `browse-query:${query}` },
        num: 0,
        kind: 'entity',
        refs: [],
        kids: [],
      } as import('../types.ts').Ent,
      query,
    })
    : null
}

/** What a package's `./views` facet offers the app: its renderers, its
 * inspector views, the pages it lists in the sidebar, the owner's home page,
 * tabs on what its views draw, and the glyphs those wear. */
export type Facet = {
  views?: import('@yaks/render').Registry<
    Entry | import('@yaks/inspect').View
  >
  componentViews?:
    | import('@yaks/render').Registry<Entry>
    | (() =>
      | import('@yaks/render').Registry<Entry>
      | Promise<import('@yaks/render').Registry<Entry>>)
  inspectViews?:
    | import('@yaks/inspect').View[]
    | (() =>
      | import('@yaks/inspect').View[]
      | Promise<import('@yaks/inspect').View[]>)
  destinations?: import('../navigation.ts').Destination[]
  home?: Home
  tabs?: Offer[]
  icons?: Record<string, IconNode>
}

/** Merge configured contributions without registering query-backed views as
 * native components. The same entry may be offered under both facet exports;
 * it is mounted once, through the query adapter. */
export let contributedViews = async (facets: Facet[]): Promise<Entry[]> =>
  (await Promise.all(facets.map(async (f) => {
    let views = typeof f.inspectViews == 'function'
      ? await f.inspectViews()
      : f.inspectViews ?? []
    let components = typeof f.componentViews == 'function'
      ? await f.componentViews()
      : f.componentViews
    let adapted = new Set<unknown>(views)
    return [
      ...adaptViews(views),
      ...[...f.views?.renderers ?? [], ...components?.renderers ?? []].filter((
        r,
      ): r is Entry => !adapted.has(r)),
    ]
  }))).flat()

/** Take in what the configured packages offer, before the app paints: their
 * views, destinations, home page, tabs and glyphs. Every door does this the
 * same way. */
export let contribute = async (facets: Facet[]): Promise<void> => {
  extend(await contributedViews(facets))
  offerPlaces({
    home: facets.find((f) => f.home)?.home,
    tabs: facets.flatMap((f) => f.tabs ?? []),
    destinations: facets.flatMap((f) => f.destinations ?? []),
  })
  for (let f of facets) learnGlyphs(f.icons ?? {})
}

/** What waits at an offered place for an entity, as `children` says it; none
 * while nothing does or it is still unknown. */
export let Waiting = (
  { offer, eid, children }: {
    offer: Offer
    eid: string
    children: (n: number) => ComponentChild
  },
) => {
  let n = offer.waiting?.(bundle(ent(eid)), inspectIo)
  return n ? <>{children(n)}</> : null
}
