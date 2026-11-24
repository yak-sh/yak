/**
 * The Profile page in the browser (D-475 step 3). The page is drawn from the
 * person's rows (./profile-view.ts), and here it is drawn again from the tab's
 * page graph as they move: a name changed in another tab, a space made or
 * given away, a browser that signs in or out shows at once. Its Save bar
 * writes the person's `account` row through the graph (./account-browser.ts),
 * and signing a browser out is a `signOut{session}` row written through it;
 * signing every one out leaves for the sign-in page.
 *
 * The view is `[data-view="profile"]`, saying what it draws for in
 * `data-profile-view` (`ProfileView`).
 *
 * @module
 */
import { type ComponentChildren, Fragment, h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import type { Bundle } from '@yaks/graph'
import type { Client } from '@yaks/client'
import { mint } from '@yaks/graph'
import { leaving, morph, PAGE } from '@yaks/ui/navigate'
import {
  ACCOUNT,
  accountOf,
  accountWords,
  SIGNED_IN,
  signedInOf,
} from './account-rows.ts'
import { refusal, savesAccount, tell } from './account-browser.ts'
import { pageGraph } from './page-graph.ts'
import { type ProfileView, profileView } from './profile-view.ts'
import { pickedOf, SIDE_SPACES, sideWords } from './side-rows.ts'

/** The Profile view. */
export let VIEW = '[data-view="profile"]'

let made = (doc: Document, node: ComponentChildren) => {
  let t = doc.createElement('template')
  t.innerHTML = renderToString(h(Fragment, null, node))
  return t.content
}

// The rows the page carried for its first paint stay as they are.
let KEPT = { leave: (n: Node) => (n as Element).localName == 'script' }

/** Draw `root` again from the rows its graph holds; nothing until the
 * account is in. */
export let drawProfile = (
  root: HTMLElement,
  view: ProfileView,
  rows: { account: Bundle[]; spaces: Bundle[]; browsers: Bundle[] },
): void => {
  let account = accountOf(rows.account)
  if (!account) return
  let next = root.cloneNode(false) as HTMLElement
  next.append(
    made(
      root.ownerDocument,
      profileView(
        view,
        account,
        pickedOf(rows.spaces),
        signedInOf(rows.browsers),
      ),
    ),
  )
  morph(root, next, KEPT)
}

/** Keep the Profile view `root` drawn from `graph`, and write through it;
 * `leave` goes to the sign-in page once every browser is signed out. The
 * answer lets go of it all. */
export let bindProfile = (
  root: HTMLElement,
  graph: Pick<Client, 'watch' | 'mutate'>,
  leave: () => void = () => location.assign('/login'),
): () => void => {
  let view = JSON.parse(root.dataset.profileView!) as ProfileView
  let account = graph.watch(ACCOUNT)
  let spaces = graph.watch(SIDE_SPACES)
  let browsers = graph.watch(SIGNED_IN)
  let draw = () => {
    drawProfile(root, view, {
      account: account.value,
      spaces: spaces.value,
      browsers: browsers.value,
    })
    savesAccount(root, graph, view.person, () => account.value)
  }
  let off = [account, spaces, browsers].map((w) => w.subscribe(draw))
  let submit = async (e: Event) => {
    let form = e.target as HTMLFormElement
    let session = form.dataset.signOut
    if (session === undefined) return
    e.preventDefault()
    let card = form.closest<HTMLElement>('.Card') ?? form
    tell(card, '')
    try {
      await graph.mutate([{ entity: { eid: mint() }, signOut: { session } }])
      if (session == 'all') leave()
    } catch (error) {
      tell(
        card,
        refusal(error, 'That browser is still signed in. Try again.'),
        true,
      )
    }
  }
  root.addEventListener('submit', submit)
  draw()
  return () => {
    root.removeEventListener('submit', submit)
    for (let stop of off) stop()
    for (let w of [account, spaces, browsers]) w.close()
  }
}

let start = (doc: Document = document) => {
  let bound = new Set<Element>()
  let each = () => {
    for (let root of doc.querySelectorAll<HTMLElement>(VIEW)) {
      if (bound.has(root)) continue
      bound.add(root)
      let { person } = JSON.parse(root.dataset.profileView!) as ProfileView
      let stop = bindProfile(
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
