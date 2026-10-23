// How what this package declares is drawn. `views`, portable for every
// interface: a comment in a list is a passage (@yaks/render's `passage`), who
// wrote it, when, what it is on, and the words around what was sought. Its
// component faces are loaded only by a browser or terminal painter.
import type { Bundle } from '@yaks/graph'
import type { ComponentRenderer } from '@yaks/preact'
import { parse } from '@yaks/query/core'
import { define, type Registry } from '@yaks/render'
import { passage } from '@yaks/render/views'

let prop = (b: Bundle, comp: string, name: string): unknown =>
  (b[comp] as Record<string, unknown> | undefined)?.[name]

/** A comment's `Tile`. */
export let views: Registry = define([{
  view: 'Tile',
  match: parse('.comment'),
  ...passage({
    texts: (b) => [prop(b, 'doc', 'body'), prop(b, 'doc', 'title')],
    where: (b) => {
      let target = prop(b, 'comment', 'target')
      return typeof target == 'string' ? ['on', target] : undefined
    },
  }),
}])

export let componentViews = (): Promise<
  { renderers: ComponentRenderer<Bundle>[] }
> => import('./component-views.tsx').then((m) => m.views)
