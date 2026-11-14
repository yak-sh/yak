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
 * Only `h` and hooks, so it paints under any renderer that has them.
 *
 * @module
 */

import { type ComponentChildren, h, type JSX } from 'preact'
import { useLayoutEffect, useRef } from 'preact/hooks'
import type { Bundle } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { Button, Composer, Transcript } from '@yaks/ui/parts'
import { type Drafts, useDrafts } from './host.ts'

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
  lines: Line[]
  /** what the conversation is doing now, said under its lines */
  now?: ComponentChildren
  /** how many lines came before these, that its owner can bring */
  earlier?: number
  /** what scrolls it: the nearest scrolling place around it, or the page */
  pane?: () => HTMLElement | null
  [attribute: string]: unknown
}

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
  { e, onChange, lines, now, earlier, pane, ...rest }: ConversationProps,
): JSX.Element => {
  let { take = TAKE, away = false } = conversingOf(e)
  let drawn = shown(lines, take, earlier)
  let root = useRef<HTMLElement>(null)
  // What the listeners read: the latest of what it was given, the place
  // that scrolls, and where the reader last was in it.
  let at = useRef({ e, onChange, away, pane: null as HTMLElement | null, y: 0 })
  at.current = { ...at.current, e, onChange }
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
  // The folds the reader opened, each by its line and its place in it, open
  // again whenever their line is drawn again, though its words changed
  // ("Reading…" to "Read").
  let folds = useRef(new Set<string>())
  let foldOf = (fold: Element) => {
    let row = fold.closest?.('[id^="row-"]')
    if (!row || fold.localName != 'details') return
    let all: Element[] = [...row.querySelectorAll('details')]
    return `${row.id} ${all.indexOf(fold)}`
  }
  useLayoutEffect(() => {
    let el = root.current
    for (let key of folds.current) {
      let [row, at] = key.split(' ')
      let fold = el?.ownerDocument.getElementById(row)
        ?.querySelectorAll('details')[Number(at)]
      if (fold && el?.contains(fold)) fold.setAttribute('open', '')
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
    // A fold the reader opens or closes, by its line and its place there.
    let toggled = (ev: Event) => {
      let fold = ev.target as Element
      let key = foldOf(fold)
      if (!key) return
      if (fold.hasAttribute('open')) folds.current.add(key)
      else folds.current.delete(key)
    }
    el.addEventListener('toggle', toggled, true)
    p.addEventListener('scroll', scroll, { passive: true })
    win.addEventListener('resize', grown)
    win.addEventListener('hashchange', hash)
    let sizes = win.ResizeObserver ? new win.ResizeObserver(grown) : null
    sizes?.observe(p)
    sizes?.observe(el)
    return () => {
      el.removeEventListener('toggle', toggled, true)
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
          ? h(Transcript.Row, { key: line.id, id: `row-${line.id}` }, line.node)
          : h(Transcript.Row, {
            key: line.id,
            id: `row-${line.id}`,
            dangerouslySetInnerHTML: { __html: line.html },
          })
      ),
    ),
    now == null ? null : h(Transcript.Status, {}, now),
  )
}, { Box })
