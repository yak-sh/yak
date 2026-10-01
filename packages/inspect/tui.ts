/**
 * The inspector in a terminal: `yak inspect`, a rendering mode of the CLI
 * (./cli.ts). The same host, views, index and stack of pages the page draws
 * (./live.ts, ./Frame.ts), over a @yaks/client box connected to the server
 * this config's `yak serve` runs, painted by @yaks/tui in @yaks/ui's
 * Everforest sheet: the index and the top page as framed columns, and a
 * strip three wide for each page under it. Values paint as values; editing
 * is the page's.
 *
 * Keys: Tab moves between the index and the top page, the one with the keys
 * framed in the accent. j and k walk its rows and links; Enter (or l) stacks
 * what the walk is on; h or Backspace returns to the page under the top one;
 * a press on a strip returns to it; ↑ ↓ PgUp PgDn scroll; `/` types in the
 * index's field (Enter runs it as a query, Escape leaves it); q quits.
 *
 * @module
 */

import { signal } from '@preact/signals'
import { h } from 'preact'
import { useLayoutEffect, useRef } from 'preact/hooks'
import { client } from '@yaks/client'
import { desk, docs as draftDocs, drafts } from '@yaks/draft'
import { mint } from '@yaks/graph'
import { filters } from '@yaks/filter'
import { docs as fieldDocs } from '@yaks/filter/vocab'
import { parse as human } from '@yaks/id'
import {
  type Key,
  type MouseEvent,
  quit,
  run,
  Scroll,
  type TElement,
  useKeys,
} from '@yaks/tui'
import { everforest, kits, sheet } from '@yaks/ui'
import { cut, panesOf } from '@yaks/ux'
import { docs as uxDocs } from '@yaks/ux/vocab'
import { loadVocab } from '@yaks/vocab'
import { inspector } from './door.ts'
import { frame } from './Frame.ts'
import { docs as own } from './front.ts'
import { live } from './live.ts'
import { INSPECT, me, put, STACK, stack } from './state.ts'
import { HOME, pagePath, queryPath, stackOf } from './where.ts'
import { composed } from './views.ts'
import type { View } from './host.ts'

// What the walk is on wears the painter's own mark for a selected row, in
// the theme's colours (@yaks/ui `sheet`).
let FOCUS = 'List_Selected'

// The panes, in the order Tab walks them.
let PANES = ['index', 'page'] as const
type Pane = typeof PANES[number]

// Whether a word names an entity rather than being a query: a human id
// (`T-9`), a short handle (`#3b5bc70420`) or an eid.
let names = (word: string): boolean =>
  !!human(word) || /^#[0-9a-f]+$/i.test(word) ||
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(word)

/** Where `yak inspect <word>` opens: the entity it names, or the page of the
 * query it is. */
export let start = (word = ''): string =>
  word && names(word) ? pagePath(word) : queryPath(word)

let elements = (el: TElement) =>
  el.childNodes.filter((n): n is TElement => 'localName' in n)

// The pane element named `pane`, under `el`: the index, or the top page of
// the stack.
let paneOf = (el: TElement | null, pane: Pane): TElement | undefined => {
  if (!el) return
  if (
    pane == 'index'
      ? el.attr('data-pane') == 'index'
      : el.className.split(/\s+/).includes('Stack_Pane')
  ) return el
  for (let k of elements(el)) {
    let found = paneOf(k, pane)
    if (found) return found
  }
}

// What a walk stops on under `el`, in the order they paint: each row a press
// picks, and each link that is not inside one.
let stops = (el: TElement | undefined): TElement[] =>
  !el ? [] : el.attr('data-pick') ? [el] : [
    ...el.localName == 'a' && el.attr('href') ? [el] : [],
    ...elements(el).flatMap(stops),
  ]

// The stop the walk is on wears FOCUS, and no other does; its pane scrolls
// to it (@yaks/tui `reveal`).
let mark = (all: TElement[], on?: TElement) => {
  for (let el of all) {
    let cls = el.className.split(/\s+/).filter((c) => c && c != FOCUS)
    if (el == on) cls.push(FOCUS)
    let next = cls.join(' ')
    if (next != el.className) el.className = next
    if (el == on) el.setAttribute('reveal', '')
    else if (el.attr('reveal') != null) el.removeAttribute('reveal')
  }
}

// The link a click landed in, if it landed in one.
let linkOf = (el: TElement | null | undefined): string | undefined => {
  for (let n = el; n; n = n.parentNode as TElement | null) {
    if (n.localName == 'a' && n.attr('href')) return n.attr('href')
  }
}

/**
 * Hold the inspector in this terminal until q or Ctrl-C, over the server at
 * `url`, opening at `href` (an inspector address), with `more` views ahead
 * of its own (./plugins.ts).
 */
export let open = async (
  url: string,
  href: string,
  more: View[] = [],
): Promise<void> => {
  let answered = await fetch(`${url}/vocab`).catch(() => undefined)
  if (!answered?.ok) {
    await answered?.body?.cancel()
    throw new Error(`yak inspect reads through yak serve, and ${url} is not up`)
  }
  let { docs, keywords } = await answered.json()
  let vocab = loadVocab(docs, keywords)
  let box = client(vocab, [], {
    url,
    signal,
    vault: false,
    wireVault: false,
    // Who wrote a row, and when, is the server's to say.
    provenance: () => null,
    // The terminal is the page: a refused query says why where it was asked
    // (./live.ts), and a lost socket reconnects on its own.
    report: () => {},
  })
  let front = client(
    loadVocab([...fieldDocs, ...draftDocs, ...uxDocs, ...own]),
    [drafts()],
    { vault: false, wireVault: false },
  )
  // What is typed in the bar waits in the page's own graph, gone with it.
  let typer = mint()
  let fields = filters(front, {
    vocab,
    drafts: desk(front, { by: () => typer }),
  })
  let typing = signal(false)
  let host = live({ box, front, edits: false })
  let door = inspector(composed(more), host)
  let Frame = frame(door, {
    fields,
    Bar: ({ id }) =>
      h(fields.Filter, {
        id,
        active: typing.value,
        placeholder: '/ to find, or a query',
      }),
    Scroll: ({ id, on, children }) =>
      h(Scroll, { id, grow: '1', follow: false, keyboard: on }, children),
  })

  // The stack the terminal opens on; where each pane's walk is, the top
  // page's starting over whenever the stack moves.
  let panes = stackOf(href) ?? [HOME]
  front.mutate([{ entity: { eid: STACK }, Stack: { panes } }])
  let walk = signal<Record<Pane, number>>({ index: -1, page: -1 })
  front.watch('.Stack').subscribe(() =>
    walk.value = { ...walk.value, page: -1 }
  )
  let back = () => {
    let b = stack(door.io)
    let n = panesOf(b).length
    if (n > 1) front.mutate([cut(b, n - 2)])
  }
  let pane = (): Pane => me(door.io).pane ?? 'page'
  let turn = () =>
    front.mutate(put({ pane: pane() == 'index' ? 'page' : 'index' }))

  // Typing in the index's field: the list takes its keys first.
  let type = (k: Key): boolean => {
    let text = fields.text(INSPECT)
    let caret = fields.row(INSPECT)?.caret ?? text.length
    let put = (t: string, c: number) => fields.type(INSPECT, t, c)
    let pressed = (name: string) => fields.press(INSPECT, name)
    if (k.name == 'char' || k.name == 'paste') {
      let s = k.text ?? ''
      put(text.slice(0, caret) + s + text.slice(caret), caret + s.length)
    } else if (k.name == 'backspace' && caret > 0) {
      put(text.slice(0, caret - 1) + text.slice(caret), caret - 1)
    } else if (k.name == 'left') put(text, Math.max(0, caret - 1))
    else if (k.name == 'right') put(text, Math.min(text.length, caret + 1))
    else if (k.name == 'tab') pressed('Tab')
    else if (k.name == 'up') pressed('ArrowUp')
    else if (k.name == 'down') pressed('ArrowDown')
    else if (k.name == 'escape' && !pressed('Escape')) typing.value = false
    else if (k.name == 'enter' && !pressed('Enter')) {
      typing.value = false
      host.go(queryPath(text.trim()))
    }
    return true
  }

  let App = () => {
    let root = useRef<TElement>(null)
    let here = () => stops(paneOf(root.current, pane()))
    let step = (d: number) => {
      let all = here()
      if (!all.length) return
      let now = Math.max(-1, walk.value[pane()])
      let to = Math.max(0, Math.min(all.length - 1, now + d))
      walk.value = { ...walk.value, [pane()]: to }
    }
    let follow = () => {
      let on = here()[walk.value[pane()]]
      let row = on?.attr('data-pick')
      let to = row ? host.link(row) : on?.attr('href')
      if (to) host.go(to)
    }
    let press = (k: Key): boolean => {
      if (typing.value) return type(k)
      let c = k.name == 'char' ? k.text : undefined
      if (c == 'q') quit()
      else if (c == '/') {
        front.mutate(put({ pane: 'index' }))
        typing.value = true
      } else if (k.name == 'tab') turn()
      else if (c == 'j' || c == 'k') step(c == 'j' ? 1 : -1)
      else if (k.name == 'enter' || c == 'l') follow()
      else if (k.name == 'backspace' || c == 'h') back()
      else return false
      return true
    }
    // Keys typed faster than a read arrive as one run of characters: each is
    // its own press, the way it was typed.
    useKeys((k) =>
      k.name == 'char' && !k.alt && (k.text?.length ?? 0) > 1
        ? [...k.text!].map((text) => press({ ...k, text })).some(Boolean)
        : press(k)
    )
    // After every render, the walk wears FOCUS where it was left, in the
    // pane with the keys; a step renders again.
    let walked = walk.value
    useLayoutEffect(() => {
      for (let p of PANES) {
        let all = stops(paneOf(root.current, p))
        mark(all, p == pane() ? all[walked[p]] : undefined)
      }
    })
    return h(
      'div',
      { col: '' },
      h('div', {
        ref: root,
        grow: '1',
        col: '',
        onClick: (e: MouseEvent) => {
          let to = linkOf(e.target as TElement)
          if (to && stackOf(to)) host.go(to)
        },
      }, h(Frame, null)),
      h(
        'div',
        { class: 'Muted' },
        typing.value
          ? 'Enter runs the query · Escape leaves the field'
          : `${pane()} · Tab panes · j k walk · Enter opens · h back · ` +
            '/ find · q quit',
      ),
    )
  }

  try {
    await run(App, { sheet: sheet({ kits, theme: everforest }) })
  } finally {
    box.close()
    front.close()
  }
}
