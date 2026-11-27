/**
 * A space's People page in the browser (D-475 step 5). The page is drawn from
 * rows (./people-view.ts), and here it is drawn again from the tab's page
 * graph as they move: someone who accepts, an invitation sent or withdrawn,
 * an Operator let in, from this tab or anywhere else, shows without a reload.
 * Each form is an act written through the graph (./people-rows.ts), and says
 * under its button what came of it, or why it was refused, keeping what was
 * typed.
 *
 * The view is `[data-view="people"]`, saying what it draws for in
 * `data-people-view` (`PeopleView`).
 *
 * @module
 */
import { createElement as h, Fragment, type ReactNode } from 'react'
import { renderToString } from 'preact-render-to-string'
import type { Client } from '@yaks/client'
import { mint } from '@yaks/graph'
import { leaving, morph, PAGE } from '@yaks/ui/navigate'
import { refusal, tell } from './account-browser.ts'
import { pageGraph } from './page-graph.ts'
import { type PeopleAct, peopleWords } from './people-rows.ts'
import {
  peopleLines,
  peopleRows,
  type PeopleView,
  peopleView,
  type Watched,
} from './people-view.ts'
import { sideWords } from './side-rows.ts'

/** The People view. */
export let VIEW = '[data-view="people"]'

let made = (doc: Document, node: ReactNode) => {
  let t = doc.createElement('template')
  t.innerHTML = renderToString(h(Fragment, null, node))
  return t.content
}

// What a redraw leaves: the rows the page carried for its first paint.
let KEPT = { leave: (n: Node) => (n as Element).localName == 'script' }

// A form by what it writes and the row it is on, the same across redraws.
let keyOf = (form: HTMLFormElement) =>
  `${form.dataset.people}:${
    form.querySelector<HTMLInputElement>('input[type=hidden]')?.value ?? ''
  }`

/** Draw `root` again from `rows`, once they are in: the owner holds a seat,
 * so there is always one holder. */
export let drawPeople = (
  root: HTMLElement,
  view: PeopleView,
  rows: Watched,
): void => {
  if (!rows.holders.length) return
  let next = root.cloneNode(false) as HTMLElement
  next.append(
    made(root.ownerDocument, peopleView(view, peopleRows(view, rows))),
  )
  morph(root, next, KEPT)
}

// What each form writes, from what it holds.
type Form = HTMLFormElement
let ACTS: Record<PeopleAct, (f: Form) => Record<string, string>> = {
  memberAdd: (f) => {
    let friend = text(f, 'friend')
    return {
      ...friend ? { friend } : { email: text(f, 'invite') },
      ...given(f, 'app', 'role', 'note'),
    }
  },
  memberRemove: (f) => ({ email: text(f, 'remove'), ...given(f, 'app') }),
  inviteAgain: (f) => ({ invite: text(f, 'again') }),
  operatorAdmit: (f) => ({
    operator: text(f, 'operator'),
    ...given(f, 'role'),
  }),
  operatorOut: (f) => ({ operator: text(f, 'unreach') }),
}

// What the field `name` of `f` holds, trimmed.
let text = (f: Form, name: string) =>
  (f.querySelector<HTMLInputElement>(`[name=${name}]`)?.value ?? '').trim()

// The fields among `names` that hold something.
let given = (f: Form, ...names: string[]) =>
  Object.fromEntries(
    names.flatMap((n) => text(f, n) ? [[n, text(f, n)]] : []),
  )

/** Keep the People view `root` drawn from `graph`, and write its forms
 * through it; the answer lets go of both. */
export let bindPeople = (
  root: HTMLElement,
  graph: Pick<Client, 'watch' | 'mutate'>,
): () => void => {
  let view = JSON.parse(root.dataset.peopleView!) as PeopleView
  let watches = Object.entries(peopleLines(view)).map(([name, line]) =>
    [name, graph.watch(line)] as const
  )
  // What each form last said, said again after a redraw draws it afresh.
  let told = new Map<string, [string, boolean]>()
  let say = (form: HTMLFormElement, words: string, refused = false) => {
    told.set(keyOf(form), [words, refused])
    tell(form, words, refused)
  }
  let draw = () => {
    drawPeople(
      root,
      view,
      Object.fromEntries(
        watches.map(([name, w]) => [name, w.value]),
      ) as Watched,
    )
    for (let form of root.querySelectorAll<HTMLFormElement>('[data-people]')) {
      let was = told.get(keyOf(form))
      if (was) tell(form, ...was)
    }
  }
  let off = watches.map(([, w]) => w.subscribe(draw))
  let submit = async (e: Event) => {
    let form = e.target as HTMLFormElement
    let act = form.dataset.people as PeopleAct | undefined
    if (!act || !ACTS[act]) return
    e.preventDefault()
    let button = form.querySelector<HTMLButtonElement>('[type=submit]')
    if (button) button.disabled = true
    say(form, '')
    try {
      let answered = await graph.mutate([{
        entity: { eid: mint() },
        [act]: { space: view.space.eid, ...ACTS[act](form) },
      }])
      let said = answered.map((b) => (b[act] as { said?: string })?.said)
        .find(Boolean)
      // An invitation sent leaves the form ready for the next one.
      for (
        let typed of form.querySelectorAll<HTMLInputElement>(
          '[name=invite],[name=note]',
        )
      ) typed.value = ''
      say(form, said ?? 'Saved.')
    } catch (error) {
      say(form, refusal(error, 'That did not go through. Try again.'), true)
    } finally {
      if (button) button.disabled = false
    }
  }
  root.addEventListener('submit', submit)
  draw()
  return () => {
    root.removeEventListener('submit', submit)
    for (let stop of off) stop()
    for (let [, w] of watches) w.close()
  }
}

let start = (doc: Document = document) => {
  let bound = new Set<Element>()
  let each = () => {
    for (let root of doc.querySelectorAll<HTMLElement>(VIEW)) {
      if (bound.has(root)) continue
      bound.add(root)
      let { person } = JSON.parse(root.dataset.peopleView!) as PeopleView
      let stop = bindPeople(
        root,
        pageGraph([peopleWords, sideWords], person),
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
