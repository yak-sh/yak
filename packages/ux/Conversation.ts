/**
 * A conversation's lines, newest last, as a reader follows them: it stays at
 * the newest line while lines arrive, until the reader scrolls up to read,
 * and it draws the last `take` lines it is given, more when asked. Its state
 * is `Conversation{take, away}` on the page entity its owner names
 * (`conversationAt`): how many lines back it draws, and whether the reader
 * has scrolled away from the newest. It knows no data names: its owner
 * gives it lines already drawn, and what the conversation is doing now.
 *
 * `Conversation.Box` is where a person writes to it: their words are a draft
 * (the host's `drafts`), Enter sends them and Shift+Enter starts a line, and
 * Send emits them as the bundle its owner says they become, Stop a `Stop`
 * event; the owner says where each goes, and spends the draft once the words
 * are taken.
 *
 * Whether each fold in a line is open is `Disclosure{open}` in the same page
 * graph, on the page entity of the line and the fold's place in it (`Folds`,
 * `useFold`), so a line drawn again keeps its folds as the reader left them
 * though its words changed ("Reading…" to "Read").
 *
 * Only `h` and hooks, so it paints under any renderer that has them.
 *
 * @module
 */

import { type ComponentChildren, createContext, h, type JSX } from 'preact'
import { useContext, useLayoutEffect, useRef } from 'preact/hooks'
import type { Bundle } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { Button, Composer, Transcript } from '@yaks/ui/parts'
import { type Drafts, useDrafts } from './host.ts'
import {
  type Disclosed,
  disclosed,
  Disclosure,
  disclosureAt,
  DisclosureMark,
  type DisclosureProps,
  isOpen,
} from './Disclosure.ts'

/** How many lines it draws before it is asked for more, and how many more
 * each time. */
export let TAKE = 100

/** How close to the newest line, in px, still reads as at it. */
export let NEAR = 120

/** A line, by the id it is put under (`#row-<id>`): drawn here (`node`), or
 * as it was drawn elsewhere, the server's page (`html`), kept as it is until
 * it is given drawn. */
export type Line = { id: string; node?: ComponentChildren; html?: string }

/** What a conversation holds of its own. */
export type Conversing = {
  /** how many lines back it draws */
  take?: number
  /** the reader has scrolled up from the newest line */
  away?: boolean
}

/** The page entity of `owner`'s conversation with `session`. */
export let conversationAt = (owner: string, session: string): string =>
  derivedEid(['Conversation', owner, session].join('|'))

/** Its state, as `e` holds it. */
export let conversingOf = (e?: Bundle): Conversing =>
  (e?.Conversation as Conversing | undefined) ?? {}

/** The bundle it emits: its state, changed. */
export let conversed = (e: Bundle, change: Conversing): Bundle => ({
  entity: { eid: e.entity.eid },
  Conversation: { ...conversingOf(e), ...change },
})

/** Whether the reader is away from the newest line after a scroll from
 * `was` to `now`: back once they are near it, away once they scrolled up,
 * as they were otherwise. */
export let scrolled = (
  away: boolean,
  { was, now, near }: { was: number; now: number; near: boolean },
): boolean => near ? false : now < was ? true : away

/** The lines it draws of those it is given, and how many earlier it does
 * not: those before its `take`, and those its owner was not given
 * (`earlier`). */
export let shown = (
  lines: Line[],
  take = TAKE,
  earlier = 0,
): { lines: Line[]; hidden: number } => {
  let drawn = take >= lines.length ? lines : lines.slice(lines.length - take)
  return { lines: drawn, hidden: lines.length - drawn.length + earlier }
}

/** What its owner gives it. Any other prop goes on the conversation itself. */
export type ConversationProps = {
  e: Bundle
  onChange: (b: Bundle) => void
  /** the page graph's state an eid names: its folds', which it emits through
   * `onChange` too; without it every fold is drawn closed */
  state?: (eid: string) => Bundle | undefined
  lines: Line[]
  /** what the conversation is doing now, said under its lines */
  now?: ComponentChildren
  /** how many lines came before these, that its owner can bring */
  earlier?: number
  /** what scrolls it: the nearest scrolling place around it, or the page */
  pane?: () => HTMLElement | null
  [attribute: string]: unknown
}

// The folds drawn under a conversation: where their state is read and goes;
// and under a line, which line it is and how many folds it has drawn.
type Held = {
  state?: (eid: string) => Bundle | undefined
  onChange?: (b: Bundle) => void
  line?: { at: string; n: number }
}
let Held = createContext<Held>({})

/** What is drawn under it is a line's, `line` its id: each fold in it is
 * owned by the line and its place there. A conversation puts every line it
 * draws under one, and a line inside a fold (a call's turn) is under one of
 * its own. */
export let Folds = (
  { line, children }: { line: string; children?: ComponentChildren },
): JSX.Element => {
  let up = useContext(Held)
  // How many folds it has drawn, kept while it is: a fold drawn again keeps
  // its place though its line drew others before it.
  let placed = useRef({ n: 0 })
  return h(Held.Provider, {
    value: { ...up, line: Object.assign(placed.current, { at: line }) },
    children,
  })
}

/** The state of a fold its line draws, for a `Disclosure` and its
 * `DisclosureMark`: on `disclosureAt` its line and its place in it, the
 * order its line first drew its folds in, which a server's drawing and the
 * page's mounted over it share. Its conversation reads and keeps it; outside
 * one it is closed, and outside a line it is none and the fold is a plain
 * `details`. */
export let useFold = (): Disclosed => {
  let held = useContext(Held)
  let place = useRef<number | null>(null)
  if (!held.line) return {}
  place.current ??= held.line.n++
  let eid = disclosureAt(`${held.line.at} ${place.current}`)
  return {
    e: held.state?.(eid) ?? { entity: { eid } },
    onChange: held.onChange,
  }
}

/** A fold in a line: a `Disclosure` on the state `useFold` gives it. */
export let Fold = (
  props: Omit<DisclosureProps, keyof Disclosed>,
): JSX.Element => h(Disclosure, { ...props, ...useFold() })

export { Disclosure, DisclosureMark }

// The nearest place around `at` that scrolls, or the page.
let scroller = (at: HTMLElement): HTMLElement => {
  let win = at.ownerDocument.defaultView
  for (let p = at.parentElement; p; p = p.parentElement) {
    let y = win?.getComputedStyle?.(p).overflowY
    if (y == 'auto' || y == 'scroll') return p
  }
  let doc = at.ownerDocument
  return (doc.scrollingElement ?? doc.documentElement) as HTMLElement
}

/** What a box's owner gives it. Any other prop goes on its form, which
 * posts as it is where no script runs. */
export type BoxProps = {
  /** where its words are typed, as a draft */
  place: string
  /** the drafts they are kept in; the host's without them */
  drafts?: Drafts
  /** the conversation they go to, which a stop is said on */
  session?: string
  /** the bundle the words become */
  words: (text: string) => Bundle
  /** the words, sent; the draft stays until its owner spends it */
  onSend: (b: Bundle) => void
  /** Stop, pressed: `{entity: {eid: session}, Stop: {}}` */
  onStop: (b: Bundle) => void
  /** the conversation is at work, so Stop shows */
  busy?: boolean
  /** a send is under way, so Send waits */
  sending?: boolean
  /** what it says under itself */
  said?: ComponentChildren
  /** the field's name, the words in a form posted without script */
  name?: string
  placeholder?: string
  /** its owner's, over the field: who the words go to, files held */
  top?: ComponentChildren
  /** its owner's, along its tools before Stop */
  tools?: ComponentChildren
  /** its owner's, beside Send */
  beside?: ComponentChildren
  /** its owner's, in the form before the box */
  children?: ComponentChildren
  [attribute: string]: unknown
}

/** The event Stop emits. */
export let stopped = (session = ''): Bundle => ({
  entity: { eid: session },
  Stop: {},
})

// The box: a form wearing the kit's Composer. Enter submits the form, as
// Send does, so every listener on it hears a send however it was asked for.
let Box = (
  {
    place,
    drafts: supplied,
    session,
    words,
    onSend,
    onStop,
    busy,
    sending,
    said,
    name,
    placeholder,
    top,
    tools,
    beside,
    children,
    ...rest
  }: BoxProps,
): JSX.Element => {
  let drafts = useDrafts(supplied)
  let text = drafts.text(place)
  let send = () => void (!sending && onSend(words(drafts.text(place))))
  return h(
    Composer.Form,
    {
      ...rest,
      'aria-busy': sending ? 'true' : undefined,
      onSubmit: (ev: Event) => {
        ev.preventDefault()
        send()
      },
    },
    children,
    h(
      Composer,
      { 'data-busy': busy ? '' : undefined },
      top,
      h(Composer.Field, {
        lines: true,
        name,
        value: text,
        placeholder,
        'aria-label': placeholder,
        onInput: (ev: Event) =>
          drafts.type(place, (ev.currentTarget as HTMLTextAreaElement).value),
        onKeyDown: (ev: KeyboardEvent) => {
          if (ev.key != 'Enter' || ev.shiftKey || ev.isComposing) return
          ev.preventDefault()
          let form = (ev.currentTarget as HTMLTextAreaElement).form
          if (form?.requestSubmit) form.requestSubmit()
          else send()
        },
      }),
      h(
        Composer.Tools,
        {},
        tools,
        h(
          Composer.Stop,
          { type: 'button', onClick: () => onStop(stopped(session)) },
          'Stop',
        ),
        beside,
        h(Composer.Send, { type: 'submit', disabled: sending }, 'Send'),
      ),
    ),
    h(Composer.Status, { role: 'status' }, said),
  )
}

/** The lines, the newest last, with what it is doing now under them;
 * `Conversation.Box` is where a person writes to it. */
export let Conversation: ((p: ConversationProps) => JSX.Element) & {
  Box: (p: BoxProps) => JSX.Element
} = Object.assign((
  { e, onChange, state, lines, now, earlier, pane, ...rest }: ConversationProps,
): JSX.Element => {
  let { take = TAKE, away = false } = conversingOf(e)
  let drawn = shown(lines, take, earlier)
  let root = useRef<HTMLElement>(null)
  // What the listeners read: the latest of what it was given, the place
  // that scrolls, and where the reader last was in it.
  let at = useRef({
    e,
    onChange,
    state,
    away,
    pane: null as HTMLElement | null,
    y: 0,
  })
  at.current = { ...at.current, e, onChange, state }
  let say = (away: boolean) => {
    if (away == at.current.away) return
    at.current.away = away
    at.current.onChange(conversed(at.current.e, { away }))
  }
  let newest = () => {
    let p = at.current.pane
    if (!p) return
    p.scrollTop = p.scrollHeight
    at.current.y = p.scrollTop
  }
  // A line kept as the server drew it holds folds and marks no state drew:
  // each is opened or closed as the page holds it.
  useLayoutEffect(() => {
    let el = root.current
    if (!el || !state) return
    for (let fold of el.querySelectorAll('[data-disclosure]')) {
      let open = isOpen(state(fold.getAttribute('data-disclosure')!))
      if (open != fold.hasAttribute('open')) fold.toggleAttribute('open', open)
    }
    for (let mark of el.querySelectorAll('[data-disclosure-mark]')) {
      let open = isOpen(state(mark.getAttribute('data-disclosure-mark')!))
      mark.setAttribute('aria-expanded', String(open))
    }
  })
  // Earlier lines are put above where the reader is, who stays there.
  let fromFoot = useRef<number | null>(null)
  let older = () => {
    let p = at.current.pane
    fromFoot.current = p ? p.scrollHeight - p.scrollTop : null
    at.current.away = true
    onChange(conversed(e, { take: take + TAKE, away: true }))
  }
  // Set up before the first paint, so it is first seen at the newest.
  useLayoutEffect(() => {
    let el = root.current
    let win = el?.ownerDocument.defaultView
    if (!el || !win) return
    let p = pane?.() ?? scroller(el)
    at.current.pane = p
    let near = () =>
      !p.clientHeight || p.clientHeight + p.scrollTop >= p.scrollHeight - NEAR
    // What the address names: a line of it, where it opens, or a place
    // outside it, a layer over it (a menu), under which nothing the pane
    // does is the reader's.
    let address = () => {
      let id = decodeURIComponent(win.location?.hash?.slice(1) ?? '')
      let found = id ? el.ownerDocument.getElementById(id) : null
      if (!found) return null
      let inside = el.contains(found)
      return { line: inside ? found : null, over: !inside }
    }
    let opened = () => {
      let line = address()?.line
      if (!line) return void (newest(), say(false))
      line.scrollIntoView({ block: 'center' })
      at.current.y = p.scrollTop
      say(true)
    }
    opened()
    let scroll = () => {
      if (address()?.over) return
      let now = p.scrollTop
      let was = at.current.y
      at.current.y = now
      say(scrolled(at.current.away, { was, now, near: near() }))
    }
    let grown = () => {
      if (!at.current.away && !address()?.over) newest()
    }
    let hash = () => address()?.line ? opened() : grown()
    // A fold of a line kept as the server drew it opens and closes as a
    // browser's does, and the page then holds it so; one drawn from its
    // state only says what it was told.
    let toggled = (ev: Event) => {
      let fold = ev.target as Element
      let eid = fold.getAttribute?.('data-disclosure')
      if (!eid) return
      let open = fold.hasAttribute('open')
      let was = at.current.state?.(eid) ?? { entity: { eid } }
      if (isOpen(was) != open) at.current.onChange(disclosed(was, open))
    }
    // Its marks too, which no script drawn there presses; a mark drawn from
    // its state has said so already.
    let marked = (ev: Event) => {
      let mark = (ev.target as Element).closest?.('[data-disclosure-mark]')
      let eid = mark?.getAttribute('data-disclosure-mark')
      if (!eid || ev.defaultPrevented) return
      let was = at.current.state?.(eid) ?? { entity: { eid } }
      at.current.onChange(disclosed(was, !isOpen(was)))
    }
    el.addEventListener('toggle', toggled, true)
    el.addEventListener('click', marked)
    p.addEventListener('scroll', scroll, { passive: true })
    win.addEventListener('resize', grown)
    win.addEventListener('hashchange', hash)
    let sizes = win.ResizeObserver ? new win.ResizeObserver(grown) : null
    sizes?.observe(p)
    sizes?.observe(el)
    return () => {
      el.removeEventListener('toggle', toggled, true)
      el.removeEventListener('click', marked)
      p.removeEventListener('scroll', scroll)
      win.removeEventListener('resize', grown)
      win.removeEventListener('hashchange', hash)
      sizes?.disconnect()
    }
  }, [])
  // Told it is back at the newest (its owner's "Newest"), it goes there, and
  // it stays there as lines arrive.
  useLayoutEffect(() => {
    at.current.away = away
    if (!away) newest()
  }, [away, lines])
  useLayoutEffect(() => {
    let p = at.current.pane, foot = fromFoot.current
    if (!p || foot == null) return
    fromFoot.current = null
    p.scrollTop = p.scrollHeight - foot
    at.current.y = p.scrollTop
  }, [take])
  return h(
    Held.Provider,
    { value: { state, onChange } },
    h(
      Transcript,
      { ...rest, elRef: root },
      drawn.hidden
        ? h(
          Button,
          { type: 'button', mod: 'quiet', onClick: older },
          `Show ${drawn.hidden} earlier`,
        )
        : null,
      h(
        Transcript.Lines,
        {},
        drawn.lines.map((line) =>
          line.html == null
            ? h(
              Folds,
              { key: line.id, line: line.id },
              h(Transcript.Row, { id: `row-${line.id}` }, line.node),
            )
            : h(Transcript.Row, {
              key: line.id,
              id: `row-${line.id}`,
              dangerouslySetInnerHTML: { __html: line.html },
            })
        ),
      ),
      now == null ? null : h(Transcript.Status, {}, now),
    ),
  )
}, { Box })
