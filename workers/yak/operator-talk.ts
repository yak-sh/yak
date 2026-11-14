// The Operator chat page's conversation, drawn by @yaks/ux's `Conversation`
// on the server (operator-view.ts `talk`) and again in the browser over what
// the server drew, as part of `_talk.js` (operator-rows.ts).
//
// The page holds the lines the server drew as it drew them, and a page graph
// (@yaks/client) that the entries its socket sends (operator-draw.ts `Lines`)
// are put into, with the reply being written and where its reader is
// (`Conversation{take, away}`) and which of its folds are open
// (`Disclosure{open}`). A line a step sent is drawn here from the
// entries it reads, as the server draws it; the rest stay as the server drew
// them, since the data behind a whole conversation is about twice its
// drawing. The reply being written is a page-only row of the shape the
// harness streams one in (packages/harness/streaming_test.ts): an `output`
// whose `content` grows, drawn as a settled reply is.
//
// `Talk`, `heard` and `reread` are pure; operator-talk-browser.ts reads what
// the server drew (`parsed`) and mounts it (`mountTalk`).
import { type ComponentChildren as Node, h } from 'preact'
import type { Bundle } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import {
  Conversation,
  conversationAt,
  conversingOf,
  TAKE,
} from '@yaks/ux/conversation'
import { drawLines, type Lines } from './operator-draw.ts'

/** A line as the page holds it: the entries it reads once a step has sent
 * it (`uses`), else as the server drew it (`html`); and whether it is the
 * person's own words, which the page never takes off. */
export type Kept = {
  id: string
  uses?: string[]
  html?: string
  mine?: boolean
}

/** What its lines are drawn with beside their entries: a frame's `Lines`
 * but its lines and entries, gathered from every frame. */
export type Beside = Omit<Lines, 'lines' | 'entries'>

/** The conversation as the page holds it. */
export type Held = {
  task: string
  /** the sequence the page's reads start after */
  from?: string
  /** what it is doing now, in words, and whether it is still at it */
  now: string
  pending: boolean
  /** what the yak beside the box shows (mascot.ts `Doing`) */
  doing?: string
  /** how many lines came before those it holds */
  earlier: number
  lines: Kept[]
  beside: Beside
}

/** What the conversation is drawn with, on the server and on the page. */
export type TalkProps = {
  task: string
  lines: { id: string; node?: Node; html?: string }[]
  now: string
  pending: boolean
  doing?: string
  from?: string | number
  earlier?: number
  e: Bundle
  onChange: (b: Bundle) => void
  /** the page graph's state, where its folds are open or closed */
  state?: (eid: string) => Bundle | undefined
  pane?: () => HTMLElement | null
}

/** The page entity holding where `task`'s reader is. */
export let readerAt = (task: string): string => conversationAt('operator', task)

/** The conversation: its lines, and under them what it is doing now, which
 * a screen reader hears; the yak beside the box shows it. How many lines
 * came before those drawn is said on it (`data-earlier`), for the page. */
export let Talk = (
  { task, lines, now, pending, doing, from, earlier = 0, ...rest }: TalkProps,
) => {
  let take = conversingOf(rest.e).take ?? TAKE
  let before = earlier + Math.max(0, lines.length - take)
  return h(Conversation, {
    ...rest,
    lines,
    earlier,
    now: h('span', { 'data-now': '' }, now),
    'data-task': task,
    'data-from': from,
    'data-pending': pending ? '' : undefined,
    'data-doing': pending ? doing : undefined,
    'data-earlier': before || undefined,
  })
}

// A helper, by what started it, or the first thing it was told.
let helperKey = (h: Lines['helpers'][number]) =>
  h.call ?? h.session ?? h.entries[0]?.entity.eid

let kept = <K extends 'person' | 'called' | 'opens'>(
  key: K,
  now: Partial<Beside>,
  was: Beside,
) => {
  let value = now[key] ?? was[key]
  return value == null ? {} : { [key]: value }
}

/** What the page holds once a frame's lines have come: each line in its
 * place, or after the others when new, drawn from its entries from now on,
 * and what they are drawn with gathered. A line of the person's own words
 * stays theirs, however it came. */
export let heard = (was: Held, sent: Lines): Held => {
  let lines = [...was.lines]
  let theirs = new Set(
    drawLines(sent).flatMap((l) => l.is == 'theirs' ? [l.id] : []),
  )
  for (let { id, uses } of sent.lines) {
    let at = lines.findIndex((l) => l.id == id)
    let mine = theirs.has(id) || at >= 0 && lines[at].mine ? { mine: true } : {}
    if (at >= 0) lines[at] = { id, uses, ...mine }
    else lines.push({ id, uses, ...mine })
  }
  let helpers = new Map(was.beside.helpers.map((h) => [helperKey(h), h]))
  for (let h of sent.helpers ?? []) helpers.set(helperKey(h), h)
  let b = was.beside
  return {
    ...was,
    lines,
    beside: {
      tools: { ...b.tools, ...sent.tools },
      offers: { ...b.offers, ...sent.offers },
      threads: { ...b.threads, ...sent.threads },
      helpers: [...helpers.values()],
      ...b.ids || sent.ids ? { ids: { ...b.ids, ...sent.ids } } : {},
      ...kept('person', sent, b),
      ...kept('called', sent, b),
      ...kept('opens', sent, b),
    },
  }
}

/** A read of the whole conversation over what the page held: the read's
 * lines, after those the page held before them when the read starts later
 * (its newest `take`); and the person's own words the page showed that the
 * read left out, put back where they were (`missing`, which the tracker
 * hears of). */
export let reread = (
  was: Held | null,
  read: Held,
): { held: Held; missing: string[] } => {
  if (!was || was.task != read.task) return { held: read, missing: [] }
  let ids = new Set(read.lines.map((l) => l.id))
  let first = was.lines.findIndex((l) => ids.has(l.id))
  let before = read.earlier > 0 && first > 0 ? was.lines.slice(0, first) : []
  for (let line of before) ids.add(line.id)
  let lines = [...before, ...read.lines]
  let missing: string[] = []
  was.lines.forEach((line, i) => {
    if (!line.mine || ids.has(line.id)) return
    missing.push(line.id)
    let after = was.lines.slice(0, i).reverse().find((l) => ids.has(l.id))
    let at = after ? lines.findIndex((l) => l.id == after.id) + 1 : 0
    lines.splice(at, 0, line)
    ids.add(line.id)
  })
  return {
    held: {
      ...read,
      lines,
      earlier: Math.max(0, read.earlier - before.length),
      from: was.from ?? read.from,
      beside: was.beside,
    },
    missing,
  }
}

/** The page-only row of the reply being written in `task`. */
export let typingAt = (task: string): string =>
  derivedEid(['Operator reply being written', task].join('|'))
