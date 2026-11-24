/**
 * The Friends page in the browser (D-475 step 3). The page is drawn from the
 * person's rows (./friends-view.ts), and here it is drawn again from the tab's
 * page graph as they move: a friend who comes online, says yes, or lets the
 * person into an app shows at once. A message and a friend asked are written
 * through the graph (./account-rows.ts `friendMessage`, `friendAsk`): the form
 * says what came of it, or why it was refused.
 *
 * While the page is open it says where the person is, every {@link EVERY}
 * and on coming back to the tab, to the page's own address, so friends see
 * them on yaks.app too; closing the tab says they left.
 *
 * The view is `[data-view="friends"]`, saying what it draws for in
 * `data-friends-view` (`FriendsView`).
 *
 * @module
 */
import { type ComponentChildren, Fragment, h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import type { Client } from '@yaks/client'
import { mint } from '@yaks/graph'
import { leaving, morph, PAGE } from '@yaks/ui/navigate'
import {
  ACCOUNT,
  accountOf,
  accountWords,
  FRIENDS,
  friendsOf,
} from './account-rows.ts'
import { type FriendsView, friendsView } from './friends-view.ts'
import { pageGraph } from './page-graph.ts'
import { managePath } from './routes.ts'

/** How often an open page says where the person is. */
export let EVERY = 30_000

/** The Friends view. */
export let VIEW = '[data-view="friends"]'

let made = (doc: Document, node: ComponentChildren) => {
  let t = doc.createElement('template')
  t.innerHTML = renderToString(h(Fragment, null, node))
  return t.content
}

// What a redraw leaves as the person set it, a friend's fold they opened,
// and the rows the page carried for its first paint.
let KEPT = {
  keeps: (_: Element, name: string) => name == 'open',
  leave: (n: Node) => (n as Element).localName == 'script',
}

/** Draw `root` again from the rows `graph` holds for it. */
export let drawFriends = (
  root: HTMLElement,
  view: FriendsView,
  rows: {
    account: Parameters<typeof accountOf>[0]
    friends: Parameters<typeof friendsOf>[0]
  },
): void => {
  let account = accountOf(rows.account)
  if (!account) return
  let next = root.cloneNode(false) as HTMLElement
  next.append(
    made(
      root.ownerDocument,
      friendsView(view, friendsOf(rows.friends), account),
    ),
  )
  morph(root, next, KEPT)
}

// What a form says of what came of it, under its button.
let tell = (form: HTMLFormElement, words: string, refused = false) => {
  let said = form.querySelector<HTMLElement>('[data-said]')
  if (!said) return
  said.textContent = words
  said.hidden = !words
  said.classList.toggle('Form_Hint-negative', refused)
}

/** Keep the Friends view `root` drawn from `graph`, and write its forms
 * through it; the answer lets go of both. */
export let bindFriends = (
  root: HTMLElement,
  graph: Pick<Client, 'watch' | 'mutate'>,
): () => void => {
  let view = JSON.parse(root.dataset.friendsView!) as FriendsView
  let account = graph.watch(ACCOUNT)
  let friends = graph.watch(FRIENDS)
  let draw = () =>
    drawFriends(root, view, { account: account.value, friends: friends.value })
  let off = [account.subscribe(draw), friends.subscribe(draw)]
  let submit = async (e: Event) => {
    let form = e.target as HTMLFormElement
    let to = form.dataset.friendMessage
    let asking = form.hasAttribute('data-friend-ask')
    if (to === undefined && !asking) return
    e.preventDefault()
    let field = form.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      asking ? '[name=email]' : '[name=say]',
    )!
    let said = field.value.trim()
    if (!said) return
    tell(form, '')
    try {
      await graph.mutate([{
        entity: { eid: mint() },
        ...asking
          ? { friendAsk: { email: said } }
          : { friendMessage: { to, words: said } },
      }])
      field.value = ''
      tell(
        form,
        asking
          ? 'Asked. They’ll see it in their Updates.'
          : 'Sent. It is in their Updates.',
      )
    } catch (error) {
      tell(form, (error as Error).message || 'That could not be sent.', true)
    }
  }
  root.addEventListener('submit', submit)
  draw()
  return () => {
    root.removeEventListener('submit', submit)
    for (let stop of off) stop()
    account.close()
    friends.close()
  }
}

/** Say where the person is from this page until it is left. */
export let present = (doc: Document = document): void => {
  let address = managePath('friends')
  let lifetime = leaving(doc)
  let tab = () =>
    doc.visibilityState != 'visible'
      ? 'background'
      : doc.hasFocus()
      ? 'here'
      : 'background'
  let say = (state = tab()) =>
    void fetch(address, {
      method: 'POST',
      credentials: 'same-origin',
      body: new URLSearchParams({ tab: state }),
    }).catch(() => {})
  let timer = setInterval(() => !doc.hidden && say(), EVERY)
  let window = doc.defaultView!
  doc.addEventListener('visibilitychange', () => say(), { signal: lifetime })
  window.addEventListener('focus', () => say(), { signal: lifetime })
  window.addEventListener('pagehide', () => {
    navigator.sendBeacon(address, new URLSearchParams({ tab: 'away' }))
  }, { signal: lifetime })
  lifetime.addEventListener('abort', () => clearInterval(timer), { once: true })
  say()
}

let start = (doc: Document = document) => {
  let bound = new Set<Element>()
  let each = () => {
    for (let root of doc.querySelectorAll<HTMLElement>(VIEW)) {
      if (bound.has(root)) continue
      bound.add(root)
      let { person } = JSON.parse(root.dataset.friendsView!) as FriendsView
      let stop = bindFriends(root, pageGraph([accountWords], person))
      present(doc)
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
