/**
 * The Invite page in the browser (D-475 step 5). The page is drawn from the
 * person's invite and their spaces (./invite-view.ts), and here it is drawn
 * again from the tab's page graph as they move: a friend who signs up with
 * it or builds their first app, a name or a space renamed elsewhere, shows at
 * once. The way chosen, Text or Email, stays chosen. The link's copy button
 * shows, and its share button where the browser can share (`navigator.share`),
 * which hands the browser the link and the words that go with it.
 *
 * The view is `[data-view="invite"]`, saying what it draws for in
 * `data-invite-view` (`InviteView`).
 *
 * @module
 */
import { createElement as h, Fragment } from 'react'
import { renderToString } from 'preact-render-to-string'
import type { Bundle } from '@yaks/graph'
import type { Client } from '@yaks/client'
import { leaving, morph, PAGE } from '@yaks/ui/navigate'
import { copying, shown } from '@yaks/ui/copy-browser'
import { accountWords, INVITE_PAGE, inviteOf } from './account-rows.ts'
import { type InviteView, inviteView } from './invite-view.ts'
import { pageGraph } from './page-graph.ts'
import { pickedOf, SIDE_SPACES, sideWords } from './side-rows.ts'

/** The Invite view. */
export let VIEW = '[data-view="invite"]'

// The rows the page carried for its first paint stay as they are.
let KEPT = { leave: (n: Node) => (n as Element).localName == 'script' }

/** What a browser shares with, where it can. */
export type Sharer = Pick<Navigator, 'share'> | undefined

// The buttons only a script works: copy, and share where the browser can.
let working = (root: HTMLElement, sharer: Sharer) => {
  shown(root)
  for (let go of root.querySelectorAll<HTMLElement>('[data-share]')) {
    go.hidden = !sharer?.share
  }
}

// What sharing the link hands the browser: the link, and why to open it.
let share = (sharer: Sharer, url: string) =>
  sharer?.share({ text: 'Come build apps with me on yaks.app.', url })
    .catch(() => {})

/** Draw `root` again from the rows its graph holds; nothing until the
 * invite is in. */
export let drawInvite = (
  root: HTMLElement,
  view: InviteView,
  rows: { invite: Bundle[]; spaces: Bundle[] },
  sharer: Sharer = globalThis.navigator,
): void => {
  let invite = inviteOf(rows.invite)
  if (!invite) return
  let next = root.cloneNode(false) as HTMLElement
  let t = root.ownerDocument.createElement('template')
  t.innerHTML = renderToString(
    h(Fragment, null, inviteView(view, invite, pickedOf(rows.spaces))),
  )
  next.append(t.content)
  morph(root, next, KEPT)
  working(root, sharer)
}

/** Keep the Invite view `root` drawn from `graph`; the answer lets go. */
export let bindInvite = (
  root: HTMLElement,
  graph: Pick<Client, 'watch'>,
  sharer: Sharer = globalThis.navigator,
): () => void => {
  let view = JSON.parse(root.dataset.inviteView!) as InviteView
  let invite = graph.watch(INVITE_PAGE)
  let spaces = graph.watch(SIDE_SPACES)
  let draw = () =>
    drawInvite(
      root,
      view,
      { invite: invite.value, spaces: spaces.value },
      sharer,
    )
  let click = (e: Event) => {
    let go = (e.target as Element).closest<HTMLElement>('[data-share]')
    if (go) void share(sharer, go.dataset.share!)
  }
  let off = [invite.subscribe(draw), spaces.subscribe(draw)]
  let uncopy = copying(root)
  root.addEventListener('click', click)
  working(root, sharer)
  draw()
  return () => {
    for (let stop of off) stop()
    uncopy()
    root.removeEventListener('click', click)
    invite.close()
    spaces.close()
  }
}

let start = (doc: Document = document) => {
  let bound = new Set<Element>()
  let each = () => {
    for (let root of doc.querySelectorAll<HTMLElement>(VIEW)) {
      if (bound.has(root)) continue
      bound.add(root)
      let { person } = JSON.parse(root.dataset.inviteView!) as InviteView
      let stop = bindInvite(
        root,
        pageGraph([accountWords, sideWords], person),
      )
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
