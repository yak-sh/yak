// The inspector's views (@yaks/inspect) bound to this page: `Inspect`, an
// entity's page as a card view like any other, in a browser and in the
// terminal alike. What the views ask is answered by the live store's
// subscriptions (a query held while the view asking is mounted, an aggregate
// held or asked once), what they write goes out as this store's changes, and
// their own state lives in `front`, the page's own graph the query fields keep
// theirs in. The map, and every page past this one, is the inspector's own
// page (`/inspect`), which a link here opens.
import { useLayoutEffect, useMemo } from 'preact/hooks'
import {
  type Answer,
  type Ask,
  type Asks,
  at,
  type Bundle,
  type Host,
  inspector,
  mapPath,
  views,
} from '@yaks/inspect'
import { define } from '@yaks/render'
import { parse } from '@yaks/query'
import {
  aggRead,
  dropAgg,
  dropQuery,
  ent,
  findEid,
  holdAgg,
  holdAggOnce,
  holdQuery,
  mutate,
  queryEids,
  querySubscription,
  resolveEid,
  row,
  subscriptionState,
} from '../live.ts'
import { parseQuery, type Pred, resolveRefs } from '../query.ts'
import { type Change, type Ent, idOf, uuid } from '../types.ts'
import { edgeEid } from '../edge.ts'
import { entityPath } from '../url.ts'
import { editOptions, vocab } from './registry.ts'
import { ago } from './Stamp.tsx'
import { navigate } from './nav.tsx'
import { fields, front } from './fields.tsx'
import { Md } from './views/Md.tsx'

// A browser takes input in its controls; the terminal paints them (typeof
// Deno is the seam: undefined in the browser bundle, set in the TUI).
let browser = typeof Deno == 'undefined'

/** The inspector's page for an entity, by eid. */
export let inspectPath = (eid: string) =>
  `${entityPath(idOf(ent(eid)))}?v=Inspect`

// An entity as the store holds it: its components, its eid on its spine.
let held = (eid: string): Bundle | undefined => {
  let r = row(eid).value
  return r ? { ...r, entity: { ...r.entity, eid } } : undefined
}

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

// A write with every id a person typed as the eid it names: the cache knows
// most, the server the rest. An id that names nothing refuses the write.
let resolved = (bundles: Bundle[]): Promise<Bundle[]> =>
  Promise.all(bundles.map(async (b) => {
    let out: Bundle = { ...b }
    for (let [name, row] of Object.entries(b)) {
      if (name == 'entity' || !row || typeof row != 'object') continue
      let comp = { ...row as Record<string, unknown> }
      for (let [prop, v] of Object.entries(comp)) {
        if (typeof v != 'string' || !v) continue
        if (vocab.prop(name, prop)?.category != 'ref') continue
        let eid = await resolveEid(v)
        if (!eid) throw new Error(`no entity '${v}'`)
        comp[prop] = eid
      }
      out[name] = comp
    }
    return out
  }))

// A write, as this store's changes. A `$` alias is a new entity, or an edge,
// whose eid is its ends and relation.
let changes = (bundles: Bundle[]): Change[] =>
  bundles.flatMap((b) => {
    let { entity, $delete, ...rest } = b
    let eid = entity.eid
    if ($delete) return [{ eid, name: 'entity', comp: null }]
    if (eid.startsWith('$')) {
      let edge = rest.edge as { from?: string; to?: string } | undefined
      let rel = Object.keys(rest).find((k) => k != 'edge')
      eid = edge?.from && edge.to && rel
        ? edgeEid(edge.from, rel, edge.to)
        : uuid()
    }
    let fresh = entity.eid.startsWith('$')
    return Object.entries(rest).map(([name, comp], i): Change => ({
      eid,
      name,
      comp: comp as Change['comp'],
      ...fresh && i == 0 && !rest.edge ? { $num: true } : {},
    }))
  })

// What an entity is called: its title, or the id a person reads.
let name = (eid: string) => {
  let e = ent(eid)
  let title = typeof e.doc?.title == 'string' ? e.doc.title : ''
  return title || idOf(e)
}

// The page's own lens a host alone can draw: a document as its Markdown
// file, the one a dragged tab drops.
let own = define([{
  view: 'Inspect.Markdown',
  match: parse('.doc'),
  Render: ({ e }: { e: Bundle }) => <Md e={ent(e.entity.eid)} />,
}])
let registry = { ...views, renderers: [...own.renderers, ...views.renderers] }

// A plain click on a link inside the inspector opens it in place: this page's
// own addresses here, the inspector's in its own page.
let inPlace = (ev: MouseEvent) => {
  if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button != 0) return
  let a = (ev.target as Element | null)?.closest?.('a[href]')
  let href = a?.getAttribute('href') ?? ''
  if (!href.startsWith('/') || at(href)) return
  ev.preventDefault()
  navigate(href)
}

// The host the card view draws the inspector's views through. The map's bar
// is drawn on the inspector's own page, so a line sent here opens it there.
let host: Host = {
  vocab,
  front,
  useAnswers,
  edits: browser,
  // A reference is written as typed, and the write resolves it.
  editing: {
    ...editOptions,
    parse: (input, prop, b) =>
      prop.category == 'ref' ? input : editOptions.parse?.(input, prop, b),
  },
  apply: async (bundles) => mutate(...changes(await resolved(bundles))),
  get: held,
  link: inspectPath,
  find: mapPath,
  id: (b) => idOf(ent(b.entity.eid)),
  kind: (b) => ent(b.entity.eid).kind,
  name,
  when: (at) => ago(at),
  Bar: ({ id }) => (
    <fields.Filter
      id={id}
      placeholder='a query: ._comp, .task&.tally=filed.priority…'
      onKey={(e: KeyboardEvent) => {
        if (e.key != 'Enter') return
        e.preventDefault()
        globalThis.location?.assign(mapPath(fields.text(id).trim()))
      }}
    />
  ),
}
let { Door } = inspector(registry, host)

/** An entity's inspector page, as a card view. */
export let Inspect = ({ e }: { e: Ent }) => {
  let b = held(e.eid)
  return b
    ? (
      <div class='InspectHost' onClick={inPlace}>
        <Door e={b} view='Inspect.Full' />
      </div>
    )
    : null
}
