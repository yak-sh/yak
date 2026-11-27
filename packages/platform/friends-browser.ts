/**
 * The Friends page in the browser (D-475 step 3): drawn again from the tab's
 * page graph as the person's account row moves, and "Show when I'm online"
 * saved through it (./account-browser.ts). Friends themselves are the dock's
 * (./friends-dock-browser.ts).
 *
 * The view is `[data-view="friends"]`, saying what it draws for in
 * `data-friends-view` (`FriendsView`).
 *
 * @module
 */
import { createElement as h, Fragment, type ReactNode } from 'react'
import { renderToString } from 'preact-render-to-string'
import type { Client } from '@yaks/client'
import { leaving, morph, PAGE } from '@yaks/ui/navigate'
import { ACCOUNT, accountOf, accountWords } from './account-rows.ts'
import { savesAccount } from './account-browser.ts'
import { type FriendsView, friendsView } from './friends-view.ts'
import { pageGraph } from './page-graph.ts'

/** The Friends view. */
export let VIEW = '[data-view="friends"]'

let made = (doc: Document, node: ReactNode) => {
  let t = doc.createElement('template')
  t.innerHTML = renderToString(h(Fragment, null, node))
  return t.content
}

// What a redraw leaves: the rows the page carried for its first paint.
let KEPT = { leave: (n: Node) => (n as Element).localName == 'script' }

/** Draw `root` again from the account rows `graph` holds for it. */
export let drawFriends = (
  root: HTMLElement,
  view: FriendsView,
  rows: Parameters<typeof accountOf>[0],
): void => {
  let account = accountOf(rows)
  if (!account) return
  let next = root.cloneNode(false) as HTMLElement
  next.append(made(root.ownerDocument, friendsView(view, account)))
  morph(root, next, KEPT)
}

/** Keep the Friends view `root` drawn from `graph`, and save its setting
 * through it; the answer lets go. */
export let bindFriends = (
  root: HTMLElement,
  graph: Pick<Client, 'watch' | 'mutate'>,
): () => void => {
  let view = JSON.parse(root.dataset.friendsView!) as FriendsView
  let account = graph.watch(ACCOUNT)
  let draw = () => {
    drawFriends(root, view, account.value)
    savesAccount(root, graph, view.person, () => account.value)
  }
  let off = account.subscribe(draw)
  draw()
  return () => {
    off()
    account.close()
  }
}

let start = (doc: Document = document) => {
  let bound = new Set<Element>()
  let each = () => {
    for (let root of doc.querySelectorAll<HTMLElement>(VIEW)) {
      if (bound.has(root)) continue
      bound.add(root)
      let { person } = JSON.parse(root.dataset.friendsView!) as FriendsView
      let stop = bindFriends(root, pageGraph([accountWords], person))
      leaving(doc).addEventListener('abort', () => {
        bound.delete(root)
        stop()
      }, { once: true })
    }
  }
  each()
  doc.addEventListener(PAGE, each)
}

if (typeof document != 'undefined') start()
