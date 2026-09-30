/**
 * The inspector in a terminal: `yak inspect`, a rendering mode of the CLI
 * (./cli.ts). The same host and views the page draws (./live.ts), over a
 * @yaks/client box connected to the server this config's `yak serve` runs,
 * painted by @yaks/tui in @yaks/ui's Everforest sheet. Controls paint as
 * values; editing is the page's.
 *
 * Keys: ↑ ↓ PgUp PgDn scroll, Tab and ⇧Tab (or j and k) walk the links, Enter
 * follows one (a click does too), h or Backspace goes back, `/` types a query
 * on the map (Enter runs it, Escape leaves the field), q quits.
 *
 * @module
 */

import { signal } from '@preact/signals'
import { h } from 'preact'
import { useLayoutEffect, useRef } from 'preact/hooks'
import { client } from '@yaks/client'
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
import { everforest, sheet } from '@yaks/ui'
import { loadVocab } from '@yaks/vocab'
import { inspector } from './door.ts'
import { docs as own } from './front.ts'
import { here, live } from './live.ts'
import { at, mapPath, pagePath } from './where.ts'
import { MAP, ran } from './Map.ts'
import { views } from './views.ts'

// The class the focused link wears.
let FOCUS = 'Inspect_Focus'

// Whether a word names an entity rather than being a query: a human id
// (`T-9`), a short handle (`#3b5bc70420`) or an eid.
let names = (word: string): boolean =>
  !!human(word) || /^#[0-9a-f]+$/i.test(word) ||
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(word)

/** Where `yak inspect <word>` opens: the entity it names, or the map with
 * it run as a query. */
export let start = (word = ''): string =>
  word && names(word) ? pagePath(word) : mapPath(word)

// Every link under `el`, in the order they paint.
let linksIn = (el: TElement | null | undefined): TElement[] =>
  !el ? [] : [
    ...el.localName == 'a' && el.attr('href') ? [el] : [],
    ...el.childNodes.flatMap((n) =>
      'localName' in n ? linksIn(n as TElement) : []
    ),
  ]

// The focused link wears FOCUS, and no other does.
let mark = (links: TElement[], on?: TElement) => {
  for (let el of links) {
    let cls = el.className.split(/\s+/).filter((c) => c && c != FOCUS)
    if (el == on) cls.push(FOCUS)
    let next = cls.join(' ')
    if (next != el.className) el.className = next
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
 * `url`, opening at `href` (an inspector address).
 */
export let open = async (url: string, href: string): Promise<void> => {
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
    // The terminal is the page: a refused query says why where it was asked
    // (./live.ts), and a lost socket reconnects on its own.
    report: () => {},
  })
  let front = client(loadVocab([...fieldDocs, ...own]), [], {
    vault: false,
    wireVault: false,
  })
  let fields = filters(front, { vocab })
  let typing = signal(false)
  let host = live({
    box,
    front,
    edits: false,
    Bar: ({ id }) =>
      h(fields.Filter, {
        id,
        active: typing.value,
        placeholder: '/ to type a query',
      }),
  })
  let Here = here(host, inspector(views, host), fields.set)

  // What was followed, the page on screen last.
  let trail = signal([href])
  let focus = signal(-1)
  let go = (to: string) => {
    if (!at(to) || to == trail.value.at(-1)) return
    trail.value = [...trail.value, to]
    focus.value = -1
  }
  let back = () => {
    if (trail.value.length < 2) return
    trail.value = trail.value.slice(0, -1)
    focus.value = -1
  }

  // Typing in the map's bar: the list takes its keys first.
  let type = (k: Key): boolean => {
    let text = fields.text(MAP)
    let caret = fields.row(MAP)?.caret ?? text.length
    let put = (t: string, c: number) => fields.type(MAP, t, c)
    let pressed = (name: string) => fields.press(MAP, name)
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
      let line = text.trim()
      front.mutate(ran(line))
      typing.value = false
      go(mapPath(line))
    }
    return true
  }

  let App = () => {
    let root = useRef<TElement>(null)
    let links = () => linksIn(root.current)
    let walk = (d: number) => {
      let all = links()
      if (!all.length) return
      focus.value = (Math.max(-1, focus.value) + d + all.length) % all.length
    }
    let follow = () => {
      let to = links()[focus.value]?.attr('href')
      if (to) go(to)
    }
    useKeys((k) => {
      if (typing.value) return type(k)
      let c = k.name == 'char' ? k.text : undefined
      if (c == 'q') quit()
      else if (c == '/') {
        go(mapPath(fields.text(MAP)))
        typing.value = true
      } else if (k.name == 'tab') walk(k.shift ? -1 : 1)
      else if (c == 'j' || c == 'k') walk(c == 'j' ? 1 : -1)
      else if (k.name == 'enter' || c == 'l') follow()
      else if (k.name == 'backspace' || c == 'h') back()
      else return false
      return true
    })
    // After every paint of the page, the focus is where it was left.
    useLayoutEffect(() => {
      let all = links()
      mark(all, all[focus.value])
    })
    let now = trail.value.at(-1)!
    let where = at(now) ?? {}
    let on = links()[focus.value]?.attr('href')
    return h(
      'div',
      { col: '' },
      h(
        Scroll,
        { id: `inspect ${now}`, grow: '1', follow: false },
        h('div', {
          ref: root,
          onClick: (e: MouseEvent) => {
            let to = linkOf(e.target as TElement)
            if (to && at(to)) go(to)
          },
        }, h(Here, { where })),
      ),
      h(
        'div',
        { class: 'Inspect_Keys' },
        typing.value
          ? 'Enter runs the query · Escape leaves the field'
          : `${on ? `${on} · ` : ''}Tab links · Enter follows · h back · ` +
            '/ query · q quit',
      ),
    )
  }

  try {
    await run(App, {
      sheet: {
        ...sheet(everforest),
        [FOCUS]: { inverse: true },
        Inspect_Keys: { fg: everforest.colors.dim },
      },
    })
  } finally {
    box.close()
    front.close()
  }
}
