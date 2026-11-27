// The page: start the graph in this tab, put the site and its files in it,
// and draw the page from it with the views module beside this one.
import { createElement as h } from 'react'
import { host } from '@yaks/react/host'
import { yak } from './yak.ts'
import { term } from './term.ts'
import { fileList, files, seed, SITE } from './site.ts'
import { fileOf } from '@yaks/file'
import { Stale } from '@yaks/graph/errors'
import { token } from '@yaks/graph/sha256'
import type { Graph } from '@yaks/graph'
import { css } from '@yaks/diagram'
import { figure } from './figure.ts'
import { turns } from './turns.ts'
import type { Stash } from '@yaks/draft'

/** Start the page in `root`: its graph, its prompt and its drawing. */
export let start = async (
  root: Element,
  opts: {
    fetch?: (path: string) => Promise<Response>
    load?: (url: string) => Promise<{ views: unknown }>
    pace?: { key: number; pause: number }
    /** how long a failed effect waits to be tried again, in ms */
    retry?: number
    /** how the one effect that leaves the tab reaches yaks.app */
    post?: typeof fetch
    /** where what the person types is kept across a reload */
    stash?: Stash
  } = {},
) => {
  let doc = root.ownerDocument
  let read = opts.fetch ??
    ((path: string) => fetch(new URL(path, doc.baseURI)))
  let y = await yak({ retry: opts.retry, fetch: opts.post, stash: opts.stash })
  await y.graph.apply([...seed(), ...fileList()])
  await y.settled()
  let t = term(y, opts.pace ?? { key: 28, pause: 380 })
  let f = figure(y, t)
  let d = turns(y, t)
  let style = doc.createElement('style')
  style.textContent = css
  doc.head.append(style)
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
        turns: d,
        Entity,
      }),
  })
  // The static first screen has links to parts the graph draws on startup.
  let hash = doc.defaultView?.location?.hash
  if (hash) doc.getElementById(hash.slice(1))?.scrollIntoView?.()
  let sources = await files(read)
  await fill(y.graph, sources)
  await y.settled()
  let original = sources.find((b) => b.file?.path == 'style.css')
  restyled(y, doc, original?.content?.body)
  return { yak: y, term: t, figure: f, turns: d, page }
}

// Text arrives after the page can be used. A change or deletion the reader
// made while it was loading takes precedence over the downloaded source.
let fill = async (graph: Graph, sources: Awaited<ReturnType<typeof files>>) => {
  let patches = sources.filter((b) => b.content).map((b) => ({
    entity: b.entity,
    content: b.content,
    $was: { file: { path: token(b.file?.path) }, content: { body: null } },
  }))
  while (patches.length) {
    try {
      await graph.apply(patches)
      return
    } catch (e) {
      if (!(e instanceof Stale)) throw e
      patches = patches.filter((b) => b.entity.eid != e.eid)
    }
  }
}

/** The page wears the style.css its graph holds: a change to that file's
 * contents restyles the page in place of the one it loaded. */
let restyled = (
  y: Awaited<ReturnType<typeof yak>>,
  doc: Document,
  loaded?: string,
) => {
  let eid = fileOf(SITE, 'style.css')
  let body = () => (y.row(eid)?.content as { body?: string } | undefined)?.body
  let paint = () => {
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
    loaded = css
  }
  y.watch(eid, paint)
  paint()
}
