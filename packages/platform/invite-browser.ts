/**
 * The Invite page in the browser (D-475 step 5). The page is drawn from the
 * person's invite and their spaces (./invite-view.ts), and here it is drawn
 * again from the tab's page graph as they move: a friend who signs up with
 * it or builds their first app, a name or a space renamed elsewhere, shows at
 * once. The way chosen, Text or Email, stays chosen.
 *
 * The view is `[data-view="invite"]`, saying what it draws for in
 * `data-invite-view` (`InviteView`).
 *
 * @module
 */
import { Fragment, h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import type { Bundle } from '@yaks/graph'
import type { Client } from '@yaks/client'
import { leaving, morph, PAGE } from '@yaks/ui/navigate'
import { accountWords, INVITE_PAGE, inviteOf } from './account-rows.ts'
import { type InviteView, inviteView } from './invite-view.ts'
import { pageGraph } from './page-graph.ts'
import { pickedOf, SIDE_SPACES, sideWords } from './side-rows.ts'

/** The Invite view. */
export let VIEW = '[data-view="invite"]'

// The rows the page carried for its first paint stay as they are.
let KEPT = { leave: (n: Node) => (n as Element).localName == 'script' }

/** Draw `root` again from the rows its graph holds; nothing until the
 * invite is in. */
export let drawInvite = (
  root: HTMLElement,
  view: InviteView,
  rows: { invite: Bundle[]; spaces: Bundle[] },
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
}

/** Keep the Invite view `root` drawn from `graph`; the answer lets go. */
export let bindInvite = (
  root: HTMLElement,
  graph: Pick<Client, 'watch'>,
): () => void => {
  let view = JSON.parse(root.dataset.inviteView!) as InviteView
  let invite = graph.watch(INVITE_PAGE)
  let spaces = graph.watch(SIDE_SPACES)
  let draw = () =>
    drawInvite(root, view, { invite: invite.value, spaces: spaces.value })
  let off = [invite.subscribe(draw), spaces.subscribe(draw)]
  draw()
  return () => {
    for (let stop of off) stop()
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
