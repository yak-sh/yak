// The app's one registry and its Ent-to-bundle boundary. Selection, tab
// applicability, overlay precedence and action union belong to @yaks/render;
// the Preact host owns mounting. Native column controls join the curated list.
import {
  actions,
  applicable as offered,
  type Bundle,
  type Context,
  type Contributor as Contribution,
  define as registryOf,
  edit,
  type EditOptions,
  editors,
  extend as overlay,
  type Patch,
  properties,
  type Renderer as PortableRenderer,
  resolve as select,
} from '@yaks/render'
import { type ComponentRenderer, type Events, render } from '@yaks/preact'
import type { JSX } from 'preact'
import { parseProp, propAt } from '../props.ts'
import { ent, findEid, mutate, problem } from '../live.ts'
import { editorViews } from './editors.tsx'
import { and, present } from '@yaks/query'
import { type Ent, statusOf } from '../types.ts'
import { archetypeTables } from '../live_archetypes.ts'
import { fleetVocab } from '../vocab/fleet_vocab.ts'

export type Renderer = ComponentRenderer<Ent> & {
  file?: { ext: string; mime: string; text: (e: Ent) => string }
  show?: (value: string | null) => JSX.Element | null
}
export type Entry = Renderer | PortableRenderer
export type Render = Renderer['Render']
export type Action = { label: string; run: () => void; mod?: string }
export type Contributor = Contribution<Action, Ent>

export let vocab = fleetVocab()
// The fleet adds its input language (P2, relative times and human ids); the
// package still owns column patches and vocabulary validation.
export let editOptions: EditOptions = {
  parse: (input, column) => {
    let p = propAt(column.comp, column.prop)
    return p ? parseProp(p, input, { resolve: findEid }) : input
  },
}
let columns = (): Entry[] => [
  ...editorViews(),
  ...editors(vocab, editOptions),
  properties(vocab),
]
export let registry = registryOf<Entry, Action, Ent>(columns(), {
  vocab,
  archetypes: archetypeTables,
})

// Ent flattens the spine and adds display/edge data. Queries read components;
// native views and action factories still receive the original Ent.
export let bundle = (e: Ent): Bundle => {
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

export let define = (rs: Renderer[], views: string[]) => {
  registry.renderers = [...rs, ...columns()]
  registry.views = views
}
export let defineActions = (cs: Contributor[]) => {
  registry.actions = cs
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

/** Column renderers share the entity registry and its qualified view walk. */
export let columnView = (e: Ent, comp: string, col: string, view = 'Edit') =>
  vocab.column(comp, col)
    ? select(registry, bundle(e), view, vocab, { comp, col })
    : undefined

/** A validated column patch; the browser decides when to apply it. */
export let editColumn = (
  e: Ent,
  ctx: { comp: string; col: string },
  value: unknown,
) => edit(vocab, ctx, editOptions).run(bundle(e), value)

/** Apply a host patch through the fleet's optimistic write path. */
export let applyPatch = (eid: string, patch: Patch) =>
  mutate(...Object.entries(patch).map(([name, comp]) => ({ eid, name, comp })))

export let writeColumn = (
  eid: string,
  comp: string,
  col: string,
  value: unknown,
) => applyPatch(eid, editColumn(ent(eid), { comp, col }, value))

/** The app reads derived values through its bundle projection too. */
export let columnValue = (e: Ent, comp: string, col: string): unknown => {
  let row = bundle(e)[comp]
  return row && typeof row == 'object' ? row[col] : undefined
}

export let canEdit = (comp: string, col: string): boolean => {
  let info = vocab.comp(comp)
  return !!info?.wire && info.writable.includes(col)
}

/** All app views share the same host callbacks, including portable controls. */
export let renderView = (e: Ent, view?: string, ctx: Context & Events = {}) => {
  let context: Context & Events = {
    onPatch: (patch) => applyPatch(e.eid, patch),
    onError: (error) => {
      problem.value = error instanceof Error ? error.message : String(error)
    },
    ...ctx,
  }
  return render(registry, bundle(e), view, vocab, context, { e, ...context })
}
