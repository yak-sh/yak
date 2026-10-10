// The app's one registry and its Ent-to-bundle boundary. Selection, tab
// applicability, overlay precedence and action union belong to @yaks/render;
// the Preact host owns mounting. This page is also the host its UX
// components (@yaks/ux) are handed at the root: what a bundle they emit
// writes, where their own state lives (the page's graph, ./fields.tsx), and
// where what the person types waits (their drafts, ./drafts.ts).
import {
  actions,
  applicable as offered,
  type Bundle,
  type Context,
  type Contributor as Contribution,
  define as registryOf,
  type EditOptions,
  extend as overlay,
  type Patch,
  type Renderer as PortableRenderer,
  resolve as select,
} from '@yaks/render'
import { type ComponentRenderer, type Events, render } from '@yaks/preact'
import type { Host } from '@yaks/ux'
import { Float } from '@yaks/ui'
import { type ComponentChild, h } from 'preact'
import { short } from '@yaks/id'
import { parseProp, propAt } from '../props.ts'
import {
  backlinks,
  cache,
  capable,
  ent,
  findEid,
  mutate,
  parents,
  problem,
  row,
} from '../live.ts'
import { useRows } from './subscriptions.ts'
import { names as edgeNames } from '@yaks/edge'
import { and, present } from '@yaks/query'
import { type Ent, idOf, kindOf, statusOf, vocab } from '../types.ts'
import { archetypeTables, rememberArchetype } from '../live_archetypes.ts'
import { mdInline } from '../md.ts'
import { Dot } from './Dot.tsx'
import { ago } from './Stamp.tsx'
import { fields, front } from './fields.tsx'
import { drafts } from '@yaks/draft/input'
import { rows } from './hits.ts'
import { wells } from './wells.ts'
import { type Offer, tabOffers } from './offers.ts'

export type Renderer = ComponentRenderer<Ent> & {
  plugin?: string
  file?: { ext: string; mime: string; text: (e: Ent) => string }
}
export type Entry = (Renderer | PortableRenderer) & { plugin?: string }
export type Render = Renderer['Render']
export type Action = { label: string; run: () => void; mod?: string }
export type Contributor = Contribution<Action, Ent> & { plugin?: string }

export { vocab }
// The fleet adds its input language (P2, relative times and human ids);
// @yaks/render still owns column patches and vocabulary validation.
let editOptions: EditOptions = {
  parse: (input, column) => {
    let p = propAt(column.comp, column.prop)
    return p ? parseProp(p, input, { resolve: findEid }) : input
  },
}
export let registry = registryOf<Entry, Action, Ent>([], {
  vocab,
  archetypes: archetypeTables,
})

// Ent flattens the spine and adds display/edge data. Queries read components;
// native views and action factories still receive the original Ent.
export let bundle = (e: Ent): Bundle => {
  rememberArchetype(cache.peek()[e.eid])
  let entity = { ...(e.entity as object), eid: e.eid, num: e.num }
  // Presence selection reads only the spine. Bodies and derived task status
  // are projected lazily when a value predicate or the selected view asks.
  let row = (key: string) => {
    if (key == 'entity') return entity
    let value = e[key]
    if (!value || typeof value != 'object' || Array.isArray(value)) return
    return key == 'task' ? { ...e.task, status: statusOf(e) } : value
  }
  return new Proxy({ entity } as Bundle, {
    get: (_target, key) => typeof key == 'string' ? row(key) : undefined,
    ownKeys: () => [
      ...new Set([
        'entity',
        ...Object.keys(e).filter((k) => row(k)),
      ]),
    ],
    getOwnPropertyDescriptor: (_target, key) =>
      typeof key == 'string' && row(key)
        ? { enumerable: true, configurable: true, value: row(key) }
        : undefined,
  })
}

// Kept as the plugin's component-query builder; no predicate callbacks.
export let has = (...names: string[]) => and(...names.map(present))

// Compose native contributions against the same plugin vocabulary as portable
// facets. Cache each composition so renderer selection keeps its fast memo.
let compositions = new WeakMap<
  object,
  { vocab: typeof vocab; entries: unknown[] }
>()
let installed = <T extends { plugin?: string }>(entries: T[]): T[] => {
  let prior = compositions.get(entries)
  if (prior?.vocab == vocab) return prior.entries as T[]
  let selected = entries.filter((entry) =>
    !entry.plugin || capable(entry.plugin)
  )
  compositions.set(entries, { vocab, entries: selected })
  return selected
}

// The tabs: the views packages offer (./offers.ts) ahead of the app's own, so
// an entity a package's view draws opens on it; each one only where some
// installed renderer draws it.
export let define = (rs: Entry[], views: string[]) => {
  let tabs: string[] = [], selected: Entry[] | undefined, ahead: Offer[] = []
  Object.defineProperty(registry, 'renderers', {
    configurable: true,
    set: (entries: Entry[]) => {
      rs = entries
    },
    get: () => installed(rs),
  })
  Object.defineProperty(registry, 'views', {
    configurable: true,
    set: (names: string[]) => {
      views = names
      selected = undefined
    },
    get: () => {
      let entries = installed(rs)
      if (selected != entries || ahead != tabOffers()) {
        selected = entries
        ahead = tabOffers()
        tabs = [...new Set([...ahead.map((t) => t.view), ...views])]
          .filter((view) => entries.some((r) => r.view == view))
      }
      return tabs
    },
  })
}
export let defineActions = (cs: Contributor[]) => {
  Object.defineProperty(registry, 'actions', {
    configurable: true,
    set: (entries: Contributor[]) => {
      cs = entries
    },
    get: () => installed(cs),
  })
}
export let extend = (rs: Entry[]) => overlay(registry, rs)
export let applicable = (e: Ent) => offered(registry, bundle(e), vocab)
export let actionsFor = (e: Ent) => actions(registry, bundle(e), vocab, e)
// Some app callers inspect native component identity before mounting. Preserve
// that API for native views and mount portable selections through the host.
let components = new WeakMap<PortableRenderer, Renderer>()
export let resolve = (e: Ent, view?: string): Renderer => {
  let entry = select(registry, bundle(e), view, vocab)!
  if ('Render' in entry) return entry
  let component = components.get(entry)
  if (!component) {
    component = {
      ...entry,
      Render: ({ e, ...ctx }) => renderView(e, entry.view, ctx),
    }
    components.set(entry, component)
  }
  return component
}

/** Apply a host patch through the fleet's optimistic write path. */
let applyPatch = (eid: string, patch: Patch) =>
  mutate(...Object.entries(patch).map(([name, comp]) => ({ eid, name, comp })))

/** All app views share the same host callbacks, including portable controls. */
export let renderView = (
  e: Ent,
  view?: string,
  ctx: Context & Events = {},
): ComponentChild => {
  let entry = select(registry, bundle(e), view, vocab)
  return entry && !('Render' in entry)
    ? h(Portable, { e, view, ctx, entry })
    : mount(e, view, ctx)
}

// Portable views declare their reference reads; the browser holds them for
// the component's life, just as the CLI looks them up for its answer.
let Portable = ({ e, view, ctx, entry }: {
  e: Ent
  view?: string
  ctx: Context & Events
  entry: PortableRenderer
}) => {
  useRows([e.eid, ...entry.needs?.(bundle(e)) ?? []])
  return mount(e, view, ctx)
}

let mount = (e: Ent, view?: string, ctx: Context & Events = {}) => {
  let context: Context & Events = {
    id: ux.id,
    kind: ux.kind,
    name: ux.name,
    when: ux.when,
    link: (eid: string) => `/${idOf(ent(eid))}`,
    show: (b: Bundle, view: string, extra: Context = {}) =>
      renderView(ent(b.entity.eid), view, extra),
    get: (eid: string) => row(eid).value ? bundle(ent(eid)) : undefined,
    related: (eid: string, relation: string) => {
      let type = edgeNames(vocab)[relation]
      let peers = parents(eid)
        .filter((r) => r.type == type)
        .map((r) => r.parent)
      let links = backlinks(eid).flatMap((ref) => {
        let b = bundle(ent(ref.from))
        let edge = b.edge as { from?: string; to?: string } | undefined
        return b[relation] && edge?.to == eid && edge.from ? [edge.from] : []
      })
      return [...new Set([...peers, ...links])].map((eid) => bundle(ent(eid)))
    },
    onPatch: (patch) => applyPatch(e.eid, patch),
    onError: (error) => {
      problem.value = error instanceof Error ? error.message : String(error)
    },
    ...ctx,
  }
  return render(registry, bundle(e), view, vocab, context, { e, ...context })
}

// What an entity is called: its title, or the id a person reads; one this
// page has never held, its short handle.
let named = (eid: string) => {
  if (!row(eid).value) return short(eid)
  let e = ent(eid)
  return e.doc?.title || idOf(e)
}

// What a UX component emits: a value, written through the optimistic path;
// input it could not read, said where every refusal is.
let write = ({ entity, ...rest }: Bundle) => {
  let no = rest.Refused as { said?: string } | undefined
  if (no) return void (problem.value = no.said ?? '')
  applyPatch(entity.eid, rest as Patch)
}

/** The host this page hands its UX components (@yaks/ux) at the root. */
export let ux: Host = {
  get vocab() {
    return vocab
  },
  front,
  drafts,
  write,
  name: named,
  id: (b) =>
    idOf({ eid: b.entity.eid, kind: kindOf(b), num: Number(b.entity.num) }),
  kind: (b) => kindOf(b),
  when: (at) => ago(at),
  find: rows,
  editing: editOptions,
  values: (well) => wells[well]?.() ?? [],
  get fields() {
    return fields
  },
  markup: mdInline,
  wears: (comp, prop, v) =>
    comp == 'task' && prop == 'status' ? h(Dot, { status: v }) : null,
  Float,
}
