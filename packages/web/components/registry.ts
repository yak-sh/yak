// The app's one registry and its Ent-to-bundle boundary. Selection, tab
// applicability, overlay precedence and action union belong to @yaks/render;
// the Preact host owns mounting. The property editors (@yaks/editors) join
// the curated list, and this page is their host: they read its store, write
// through its changes, and are drawn through this registry.
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
import { bind, editorViews } from '@yaks/editors'
import { h, type JSX } from 'preact'
import { short } from '@yaks/id'
import { parseProp, propAt } from '../props.ts'
import {
  cache,
  ent,
  findEid,
  mode,
  mutate,
  problem,
  row,
  want,
} from '../live.ts'
import { and, present } from '@yaks/query'
import { type Ent, idOf, kindOf, statusOf, vocab } from '../types.ts'
import { archetypeTables, rememberArchetype } from '../live_archetypes.ts'
import { mdInline } from '../md.ts'
import { Dot } from './Dot.tsx'
import { ago } from './Stamp.tsx'
import { fields } from './fields.tsx'
import { rows } from './hits.ts'
import { wells } from './wells.ts'

export type Renderer = ComponentRenderer<Ent> & {
  file?: { ext: string; mime: string; text: (e: Ent) => string }
  show?: (value: string | null) => JSX.Element | null
}
export type Entry = Renderer | PortableRenderer
export type Render = Renderer['Render']
export type Action = { label: string; run: () => void; mod?: string }
export type Contributor = Contribution<Action, Ent>

export { vocab }
// The fleet adds its input language (P2, relative times and human ids);
// @yaks/render still owns column patches and vocabulary validation.
let editOptions: EditOptions = {
  parse: (input, column) => {
    let p = propAt(column.comp, column.prop)
    return p ? parseProp(p, input, { resolve: findEid }) : input
  },
}
let columns = (): Entry[] => editorViews<Ent>()
export let registry = registryOf<Entry, Action, Ent>(columns(), {
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
let columnView = (e: Ent, comp: string, col: string, view = 'Edit') =>
  vocab.prop(comp, col)
    ? select(registry, bundle(e), view, vocab, { comp, prop: col })
    : undefined

/** Apply a host patch through the fleet's optimistic write path. */
let applyPatch = (eid: string, patch: Patch) =>
  mutate(...Object.entries(patch).map(([name, comp]) => ({ eid, name, comp })))

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

// What an entity is called: its title, or the id a person reads; one this
// page has never held, its short handle.
let named = (eid: string) => {
  if (!row(eid).value) return short(eid)
  let e = ent(eid)
  return e.doc?.title || idOf(e)
}

// The editors' host is this page.
bind({
  vocab,
  get: (eid) => row(eid).value ? bundle(ent(eid)) : undefined,
  apply: (change) =>
    change.forEach(({ entity, ...patch }) =>
      applyPatch(entity.eid, patch as Patch)
    ),
  problem: (message) => void (problem.value = message),
  name: named,
  id: (b) =>
    idOf({ eid: b.entity.eid, kind: kindOf(b), num: Number(b.entity.num) }),
  kind: (b) => kindOf(b),
  when: (at) => ago(at),
  find: rows,
  editing: editOptions,
  renderView: (eid, view, ctx) => renderView(ent(eid), view, ctx),
  columnView: (eid, comp, prop, view) => columnView(ent(eid), comp, prop, view),
  values: (well) => wells[well]?.() ?? [],
  get fields() {
    return fields
  },
  markup: mdInline,
  want,
  mode: (m) => void (mode.value = m),
  wears: (comp, prop, v) =>
    comp == 'task' && prop == 'status' ? h(Dot, { status: v }) : null,
})
