// The page: start the graph in this tab, put the site and its files in it,
// and draw the page from it with the views module beside this one.
import { h } from 'preact'
import { host } from '@yaks/preact/host'
import { yak } from './yak.ts'
import { term } from './term.ts'
import { files, seed, SITE } from './site.ts'
import { css } from '@yaks/diagram'
import { figure } from './figure.ts'

/** Start the page in `root`: its graph, its prompt and its drawing. */
export let start = async (
  root: Element,
  opts: {
    fetch?: (path: string) => Promise<Response>
    load?: (url: string) => Promise<{ views: unknown }>
    pace?: { key: number; pause: number }
  } = {},
) => {
  let y = await yak()
  await y.graph.apply(seed())
  let read = opts.fetch ??
    ((path: string) => fetch(new URL(path, root.ownerDocument.baseURI)))
  await y.graph.apply(await files(read))
  await y.settled()
  let t = term(y, opts.pace ?? { key: 28, pause: 380 })
  let f = figure(y, t)
  let style = root.ownerDocument.createElement('style')
  style.textContent = css
  root.ownerDocument.head.append(style)
  let page = await host({
    root,
    views: 'views.ts',
    load: opts.load as never,
    vocab: y.vocab,
    store: (eid) => y.row(eid),
    subscribe: (eid, notify) => y.watch(eid, notify),
    draw: (Entity) =>
      h(Entity, {
        eid: SITE,
        view: 'Page',
        yak: y,
        term: t,
        figure: f,
        Entity,
      }),
  })
  return { yak: y, term: t, figure: f, page }
}
