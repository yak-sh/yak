// The app's one registry and its Ent-to-bundle boundary. Selection, tab
// applicability, overlay precedence and action union belong to @yaks/render;
// the Preact host owns mounting. No view imports, so plugins and views share it.
import {
  actions,
  applicable as offered,
  type Bundle,
  type Contributor as Contribution,
  define as registryOf,
  extend as overlay,
  resolve as select,
} from '@yaks/render'
import type { ComponentRenderer } from '@yaks/preact'
import { and, present } from '@yaks/query'
import { type Ent, viewRenames } from '../types.ts'
import { fleetVocab } from '../vocab/fleet_vocab.ts'

export type Renderer = ComponentRenderer<Ent> & {
  file?: { ext: string; mime: string; text: (e: Ent) => string }
}
export type Render = Renderer['Render']
export type Action = { label: string; run: () => void; mod?: string }
export type Contributor = Contribution<Action, Ent>

export let alias = viewRenames
export let vocab = fleetVocab()
export let registry = registryOf<Renderer, Action, Ent>([], {
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
  registry.renderers = rs
  registry.views = views
}
export let defineActions = (cs: Contributor[]) => {
  registry.actions = cs
}
export let extend = (rs: Renderer[]) => overlay(registry, rs)
export let applicable = (e: Ent) => offered(registry, bundle(e), vocab)
export let actionsFor = (e: Ent) => actions(registry, bundle(e), vocab, e)
export let resolve = (e: Ent, view?: string): Renderer =>
  select(registry, bundle(e), view, vocab)!
