/**
 * A space's Matches page in the browser (D-475 step 4). The page is drawn
 * from its `matchesPage` row (./operator-matches-view.ts), and here it is
 * drawn again from the tab's page graph as the row moves: a pick made in the
 * chat or another tab, a round the Operator opened.
 *
 * What the page shows follows its address: the rounds, or `?round=` one
 * round. Each round the rounds name is watched beside them, so following
 * one draws it at once from the rows held. A pick writes `pickMatch` through
 * the graph, which the door does as the person and answers with the round as
 * it then stands; what it refuses is said under the pair.
 *
 * The view is `[data-view="matches"]`, saying what it draws for in
 * `data-matches-view` (`MatchesView`).
 *
 * @module
 */
import { Fragment, h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import type { Client } from '@yaks/client'
import { mint } from '@yaks/graph/identity'
import { leaving, morph, PAGE } from '@yaks/ui/navigate'
import { refusal } from './account-browser.ts'
import { pageGraph } from './page-graph.ts'
import {
  type Matches,
  matchesOf,
  matchesPage,
  matchesWords,
} from './operator-matches.ts'
import { type MatchesView, matchesView } from './operator-matches-view.ts'

/** The Matches view. */
export let VIEW = '[data-view="matches"]'

// The rows the page carried for its first paint stay as they are.
let KEPT = { leave: (n: Node) => (n as Element).localName == 'script' }

/** Draw `root` again from `read`, as `view` asks it. */
export let drawMatches = (
  root: HTMLElement,
  view: MatchesView,
  read: Matches,
): void => {
  let t = root.ownerDocument.createElement('template')
  t.innerHTML = renderToString(h(Fragment, null, matchesView(view, read)))
  let next = root.cloneNode(false) as HTMLElement
  next.append(t.content)
  morph(root, next, KEPT)
}

let saying = (said: HTMLElement | null, words: string) => {
  if (!said) return
  said.textContent = words
  said.hidden = !words
  said.classList.toggle('Form_Hint-negative', !!words)
}

/** Keep the Matches view `root` drawn from `graph`, following the address
 * it is at, and send its picks through it. The answer lets go of it all. */
export let bindMatches = (
  root: HTMLElement,
  graph: Pick<Client, 'watch' | 'mutate'>,
  win:
    & Pick<Window, 'location' | 'history' | 'addEventListener'>
    & Partial<Pick<Window, 'removeEventListener'>> = globalThis,
): () => void => {
  let view = JSON.parse(root.dataset.matchesView!) as MatchesView
  let space = view.space.eid
  let roundIn = (at: URL | Location) =>
    new URLSearchParams(at.search).get('round') ?? ''
  // The round shown, and every line watched: the rounds, each round they
  // name, and the one the address asks for.
  let round = view.round
  let watches = new Map<string, ReturnType<typeof graph.watch>>()
  let offs: (() => void)[] = []
  let watching = (r: string) => {
    if (watches.has(r)) return
    let w = graph.watch(matchesPage(space, r))
    watches.set(r, w)
    offs.push(w.subscribe(draw))
  }
  let draw = () => {
    let rounds = matchesOf(watches.get('')?.value ?? [])
    if (rounds && 'rounds' in rounds) {
      for (let r of rounds.rounds) watching(r.round)
    }
    let read = matchesOf(watches.get(round)?.value ?? [])
    if (read) drawMatches(root, { ...view, round }, read)
  }
  let go = (to: URL, push = true) => {
    let at = `${to.pathname}${to.search}${to.hash}`
    if (push) win.history.pushState(null, '', at)
    else win.history.replaceState(null, '', at)
    round = roundIn(to)
    watching(round)
    draw()
  }
  let click = (e: Event) => {
    let event = e as MouseEvent
    let link = (e.target as Element).closest<HTMLAnchorElement>('a[href]')
    if (
      !link || event.defaultPrevented || event.button > 0 || event.metaKey ||
      event.ctrlKey || event.shiftKey || event.altKey || link.target
    ) return
    let to = new URL(link.getAttribute('href')!, win.location.href)
    if (
      to.origin != win.location.origin || to.pathname != win.location.pathname
    ) return
    event.preventDefault()
    go(to)
  }
  let sent = async (e: Event) => {
    let event = e as SubmitEvent
    let form = (event.target as Element).closest<HTMLFormElement>(
      'form[data-pick]',
    )
    if (!form) return
    event.preventDefault()
    let by = event.submitter as HTMLButtonElement | null
    let field = (name: string) =>
      form.querySelector<HTMLInputElement>(`[name=${name}]`)
    let said = form.querySelector<HTMLElement>('[data-said]')
    let presses = [...form.querySelectorAll('button')]
    for (let b of presses) b.disabled = true
    by?.setAttribute('aria-busy', 'true')
    saying(said, '')
    try {
      let why = field('why')?.value.trim()
      await graph.mutate([{
        entity: { eid: mint() },
        pickMatch: {
          space,
          round: field('round')?.value ?? '',
          pair: Number(field('pair')?.value),
          chose: by?.getAttribute('value') ?? '',
          ...why ? { why } : {},
        },
      }])
      let typed = field('why')
      if (typed) typed.value = ''
    } catch (error) {
      saying(
        said,
        refusal(error, 'Your pick did not reach yaks.app. Try again.'),
      )
    } finally {
      for (let b of presses) b.disabled = false
      by?.removeAttribute('aria-busy')
    }
  }
  let moved = () => go(new URL(win.location.href), false)
  root.addEventListener('click', click)
  root.addEventListener('submit', sent)
  win.addEventListener('popstate', moved)
  watching('')
  watching(round)
  draw()
  return () => {
    root.removeEventListener('click', click)
    root.removeEventListener('submit', sent)
    win.removeEventListener?.('popstate', moved)
    for (let off of offs) off()
    for (let w of watches.values()) w.close()
  }
}

let start = (doc: Document = document) => {
  let bound = new Set<Element>()
  let each = () => {
    for (let root of doc.querySelectorAll<HTMLElement>(VIEW)) {
      if (bound.has(root)) continue
      bound.add(root)
      let { person } = JSON.parse(root.dataset.matchesView!) as MatchesView
      let stop = bindMatches(root, pageGraph([matchesWords], person))
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
