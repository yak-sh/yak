/** Draw a page from a Preact views module and follow its draft. @module */
import { type ComponentChild, type FunctionComponent, h, render } from 'preact'
import {
  type Host as PageHost,
  host as followed,
  type Page as PageOf,
  type Views as ViewsOf,
} from '@yaks/render/host'
import {
  entity,
  type EntityProps,
  type HostRegistry,
  Registry,
  Vocabulary,
} from './mod.ts'

export { addressed, type Draft, taken } from '@yaks/render/host'
export type Views = ViewsOf<HostRegistry>
export type Host = PageHost<HostRegistry>
export type Page = PageOf<
  HostRegistry,
  (Entity: FunctionComponent<EntityProps>) => ComponentChild
>

/** Bind the views module to the page's store and redraw when it changes. */
export let host = (page: Page): Promise<Host> =>
  followed(page, (root, bound, registry, view) => {
    let Entity = entity({ ...bound, registry })
    root.replaceChildren()
    return {
      draw: (next, words) =>
        render(
          h(
            Vocabulary.Provider,
            { value: words },
            h(Registry.Provider, { value: next }, view(Entity)),
          ),
          root,
        ),
      close: () => render(null, root),
    }
  })
