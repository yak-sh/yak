/**
 * A space's Connections page in the browser (D-475 step 5). The page is drawn
 * from its `connectionsPage` row (./connections-view.ts), and here it is drawn
 * again from the tab's page graph as the row moves: a key saved in another
 * tab, an app given a connection by an agent, a server signed in to.
 *
 * What the page shows follows its address. The hash opens one thing in the
 * page's dialog, drawn from the row at once; one the row does not hold (a
 * service from the integration directory) is asked of the server
 * (`?detail=`). The search, a kind of service and the trash ask the row
 * again, as the page's line names them (./connections-page.ts `askOf`).
 *
 * Each button the page's forms send writes a `connectionAct` through the
 * graph, which the door does as the person: what it says is said where the
 * button was pressed, and a sign-in sends the person to the service. A
 * sign-in into another tab (a broker's) is the form's own post.
 *
 * The view is `[data-view="connections"]`, saying what it draws for in
 * `data-connections-view` (`ConnectionsView`).
 *
 * @module
 */
import { Fragment, h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import type { Bundle } from '@yaks/graph'
import type { Client } from '@yaks/client'
import { mint } from '@yaks/graph'
import { CallError } from '@yaks/tools/errors'
import { leaving, morph, PAGE } from '@yaks/ui/navigate'
import { refusal } from './account-browser.ts'
import { pageGraph } from './page-graph.ts'
import { SAVE_THROUGH, type SavingForm } from './page-parts.ts'
import {
  actedOf,
  askOf,
  type Connections,
  connectionsPage,
  connectionsWords,
  pageOf,
  sentOf,
} from './connections-page.ts'
import {
  type ConnectionsView,
  connectionsView,
  holds,
} from './connections-view.ts'

/** The Connections view. */
export let VIEW = '[data-view="connections"]'

// The rows the page carried for its first paint, and what a press said,
// stay as they are.
let KEPT = {
  leave: (n: Node) => {
    let e = n as Element
    return e.localName == 'script' || e.hasAttribute?.('data-said')
  },
}

/** What the address's hash opens, if anything: `#find` is the search. */
export let openedIn = (hash: string): string | undefined => {
  try {
    let key = decodeURIComponent(hash.slice(1))
    return key && key != 'find' ? key : undefined
  } catch {
    return undefined
  }
}

// What a press came to, said where it was pressed: a refusal where `no`.
let saying = (said: HTMLElement | null, words: string, no = false) => {
  if (!said) return
  said.textContent = words
  said.hidden = !words
  said.classList.toggle('Form_Hint-negative', no)
}

// Whether `dialog` is open over the page, not only open in it, as a
// document that knows no `:modal` says by its being open.
let modal = (dialog: HTMLDialogElement) => {
  try {
    return dialog.matches(':modal')
  } catch {
    return dialog.open
  }
}

/** Draw `root` again from `c`, its dialog open on `opened`. */
export let drawConnections = (
  root: HTMLElement,
  view: ConnectionsView,
  c: Connections,
  opened: string | null,
): void => {
  let doc = root.ownerDocument
  let dialog = root.querySelector<HTMLDialogElement>('dialog')
  // A dialog closes before its content goes, so the page behind it is
  // let go of as it was taken.
  if (!opened && dialog?.open) dialog.close()
  let t = doc.createElement('template')
  t.innerHTML = renderToString(
    h(Fragment, null, connectionsView(view, c, opened)),
  )
  let next = root.cloneNode(false) as HTMLElement
  next.append(t.content)
  morph(root, next, KEPT)
  dialog = root.querySelector<HTMLDialogElement>('dialog')
  if (opened && dialog && !modal(dialog)) {
    if (dialog.open) dialog.close()
    dialog.showModal()
  }
}

/** Keep the Connections view `root` drawn from `graph`, following the
 * address it is at, and send its presses through it. The answer lets go of
 * it all. */
export let bindConnections = (
  root: HTMLElement,
  graph: Pick<Client, 'watch' | 'mutate'>,
  win:
    & Pick<Window, 'location' | 'history' | 'addEventListener'>
    & Partial<Pick<Window, 'removeEventListener'>> = globalThis,
): () => void => {
  let view = JSON.parse(root.dataset.connectionsView!) as ConnectionsView
  let space = view.space.eid
  // What the address asks, and what the watch asks: the same, or with the
  // one thing the dialog opened that the row was not read for.
  let base = view.ask
  let ask = ''
  let held: Connections | undefined
  let watch: ReturnType<typeof graph.watch> | undefined
  let off = () => {}
  let asking = (next: string) => {
    if (watch && next == ask) return
    ask = next
    off()
    watch?.close()
    let now = graph.watch(connectionsPage(space, ask))
    watch = now
    off = now.subscribe(draw)
  }
  let draw = () => {
    let c = watch && pageOf(watch.value)
    if (c) held = c
    if (!held) return
    // The address alone says what is open: its hash, or the `detail` the
    // server drew it opened on.
    let key = openedIn(win.location.hash) ??
      new URLSearchParams(win.location.search).get('detail') ?? undefined
    // One the row was not read for is asked of the server, drawn loading
    // until it answers.
    if (key && !holds(held, key)) {
      let asked = new URLSearchParams(base)
      asked.set('detail', key)
      asking(askOf(asked))
    }
    drawConnections(root, view, held, key ?? null)
    // A form the page's Save bar sends presses through the graph too.
    for (let form of root.querySelectorAll<SavingForm>('form[data-save]')) {
      form[SAVE_THROUGH] = press
    }
  }
  // The page at `to`, whose search is what the page asks of its row.
  let go = (to: URL, push = true) => {
    let at = `${to.pathname}${to.search}${to.hash}`
    if (push) win.history.pushState(null, '', at)
    else win.history.replaceState(null, '', at)
    let next = askOf(to.searchParams)
    if (next != base) asking(base = next)
    draw()
  }
  // A press of one of the page's buttons, the fields its form sent: what
  // the page says of it, or, for a sign-in, the person sent to the service.
  // What the door refuses is thrown as what the page says.
  let press = async (body: FormData): Promise<string> => {
    let answer: Bundle[]
    try {
      answer = await graph.mutate([{
        entity: { eid: mint() },
        connectionAct: {
          space,
          page: `${win.location.pathname}${win.location.search}`,
          form: sentOf(body),
        },
      }])
    } catch (error) {
      throw new CallError(
        'arguments',
        refusal(error, 'That did not reach yaks.app. Try again.'),
      )
    }
    let acted = actedOf(answer)
    if (acted?.go) win.location.assign(acted.go)
    return acted?.say ?? ''
  }
  let here = () => new URL(win.location.href)
  let click = (e: Event) => {
    let event = e as MouseEvent
    let link = (e.target as Element).closest<HTMLAnchorElement>('a[href]')
    if (
      !link || event.defaultPrevented || event.button > 0 || event.metaKey ||
      event.ctrlKey || event.shiftKey || event.altKey || link.target ||
      link.hasAttribute('download')
    ) return
    let to = new URL(link.getAttribute('href')!, win.location.href)
    let now = here()
    if (link.hasAttribute('data-modal-close')) {
      event.preventDefault()
      now.hash = ''
      return go(now)
    }
    if (to.origin != now.origin || to.pathname != now.pathname) return
    event.preventDefault()
    go(to)
  }
  let cancel = (e: Event) => {
    e.preventDefault()
    let now = here()
    now.hash = ''
    go(now)
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  let searching = (form: HTMLFormElement) => {
    let to = new URL(form.action, win.location.href)
    for (let [k, v] of new FormData(form)) to.searchParams.set(k, String(v))
    to.hash = 'find'
    go(to, false)
  }
  let typed = (e: Event) => {
    let form = (e.target as Element).closest<HTMLFormElement>('form[data-find]')
    if (!form) return
    clearTimeout(timer)
    timer = setTimeout(() => searching(form), 200)
  }
  let sent = async (e: Event) => {
    let event = e as SubmitEvent
    let form = event.target as HTMLFormElement
    if (form.matches('[data-find]')) {
      event.preventDefault()
      clearTimeout(timer)
      return searching(form)
    }
    let by = event.submitter as HTMLButtonElement | null
    let target = by?.getAttribute('formtarget') ?? form.getAttribute('target')
    let to = new URL(form.getAttribute('action') ?? '', win.location.href)
    if (
      form.method != 'post' || (target && target != '_self') ||
      to.pathname != win.location.pathname
    ) return
    event.preventDefault()
    let body = new FormData(form, by)
    let said = form.closest('dialog')?.querySelector<HTMLElement>(
      '[data-said]',
    ) ?? root.querySelector<HTMLElement>('[data-said]')
    by?.setAttribute('aria-busy', 'true')
    try {
      saying(said, await press(body))
    } catch (error) {
      saying(said, (error as Error).message, true)
    } finally {
      by?.removeAttribute('aria-busy')
    }
  }
  let moved = () => go(here(), false)
  root.addEventListener('click', click)
  root.addEventListener('cancel', cancel, true)
  root.addEventListener('input', typed)
  root.addEventListener('submit', sent)
  win.addEventListener('popstate', moved)
  asking(base)
  draw()
  return () => {
    clearTimeout(timer)
    root.removeEventListener('click', click)
    root.removeEventListener('cancel', cancel, true)
    root.removeEventListener('input', typed)
    root.removeEventListener('submit', sent)
    win.removeEventListener?.('popstate', moved)
    off()
    watch?.close()
  }
}

let start = (doc: Document = document) => {
  let bound = new Set<Element>()
  let each = () => {
    for (let root of doc.querySelectorAll<HTMLElement>(VIEW)) {
      if (bound.has(root)) continue
      bound.add(root)
      let { person } = JSON.parse(
        root.dataset.connectionsView!,
      ) as ConnectionsView
      let stop = bindConnections(root, pageGraph([connectionsWords], person))
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
