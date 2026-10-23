// The `@yaks/persona/views` facet: the desk where personas and skills are
// written, a persona's or a skill's binder, loaded only by an interface that
// draws them (./inspect.ts); the tab a persona or a skill opens on; and the
// page the sidebar offers, Context, every persona and skill on the desk.
import type { View } from '@yaks/inspect'
import NotebookPen from 'lucide/dist/esm/icons/notebook-pen.mjs'
// TODO(T-132250): Deno 2.9.1's bundler, under the workspace's
// lazy-dynamic-imports (deno.json), cannot load a jsr package a bundle reaches
// only through a dynamic import, and @yaks/web's app.js bundles this facet
// with ./inspect.ts (and through it skill-text.ts's @std/yaml) behind one.
// Imported here, @std/yaml is in the bundle's static graph, so it loads.
// Remove once the bundler builds the whole graph.
import '@std/yaml'

/** The desk, the workshop and the binders, as the inspector draws them. */
export let inspectViews = (): Promise<View[]> =>
  import('./inspect.ts').then((m) => m.inspectViews)

/** The tab a persona or a skill wears first, so it opens at the desk. */
export let tabs = [{ view: 'Context', icon: 'notebook-pen' }]

/** The page the sidebar offers: every persona and skill, and the field that
 * finds one. */
export let destinations = [
  {
    key: 'context',
    name: 'Context',
    icon: 'notebook-pen',
    view: 'Context.Page',
  },
]

/** The glyph it wears there. */
export let icons = { 'notebook-pen': NotebookPen }
