// The page: start the graph in this tab, put the site and its files in it,
// and draw the page from it with the views module beside this one.
import { h } from 'preact'
import { host } from '@yaks/preact/host'
import { yak } from './yak.ts'
import { term } from './term.ts'
import { files, seed, SITE } from './site.ts'
import { fileOf } from '@yaks/file'
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
  let f = figure(y)
  let style = root.ownerDocument.createElement('style')
  style.textContent = css
  root.ownerDocument.head.append(style)
  restyled(y, root.ownerDocument)
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

/** The page wears the style.css its graph holds: a change to that file's
 * contents restyles the page in place of the one it loaded. */
let restyled = (y: Awaited<ReturnType<typeof yak>>, doc: Document) => {
  let eid = fileOf(SITE, 'style.css')
  let body = () => (y.row(eid)?.content as { body?: string } | undefined)?.body
  let loaded = body()
  y.watch(eid, () => {
    let css = body()
    if (css == null || css == loaded) return
    let own = doc.querySelector<HTMLStyleElement>('style[data-site]')
    if (!own) {
      own = doc.createElement('style')
      own.dataset.site = ''
      doc.head.append(own)
      for (let link of doc.querySelectorAll('link[rel="stylesheet"]')) {
        if (link.getAttribute('href')?.endsWith('style.css')) link.remove()
      }
    }
    own.textContent = css
  })
}
