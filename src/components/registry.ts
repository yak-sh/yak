// The app's one registry and its Ent-to-bundle boundary. Selection, tab
// applicability, overlay precedence and action union belong to @yaks/render;
// the Preact host owns mounting. Native column controls join the curated list.
import {
  actions,
  applicable as offered,
  type Bundle,
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
import { type ComponentRenderer } from '@yaks/preact'
import type { JSX } from 'preact'
import { parseProp, propAt } from '../props.ts'
import { ent, findEid, mutate } from '../live.ts'
import { editorViews } from './editors.tsx'
import { and, present } from '@yaks/query'
import { type Ent, viewRenames } from '../types.ts'
import { fleetVocab } from '../vocab/fleet_vocab.ts'

export type Renderer = ComponentRenderer<Ent> & {
  file?: { ext: string; mime: string; text: (e: Ent) => string }
  show?: (value: string | null) => JSX.Element | null
}
export type Entry = Renderer | PortableRenderer
export type Render = Renderer['Render']
export type Action = { label: string; run: () => void; mod?: string }
export type Contributor = Contribution<Action, Ent>

export let alias = viewRenames
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
  aliases: alias,
  vocab,
})

// Ent flattens the spine and adds display/edge data. Queries read components;
// native views and action factories still receive the original Ent.
export let bundle = (e: Ent): Bundle => ({
  ...Object.fromEntries(
    Object.entries(e).filter(([, row]) =>
      row && typeof row == 'object' && !Array.isArray(row)
    ),
  ),
  entity: { eid: e.eid, num: e.num },
})

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
export let resolve = (e: Ent, view?: string): Renderer =>
  select(registry, bundle(e), view, vocab)! as Renderer

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
