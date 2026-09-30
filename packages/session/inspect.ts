/**
 * How a transcript reads in the inspector (@yaks/inspect), registered in this
 * package's `/views` facet ahead of the page any entity has.
 *
 * - `Inspect.Turn`, for an entry: one turn of the conversation, said by who
 *   said it: a person's words by the person, a model's by `agent`, a tool
 *   called or its answer quiet, by what was called.
 * - `Inspect.Conversation`, for an entry: the turns either side of it in its
 *   transcript, it lit among them, each a link to its own page. What any page
 *   showing words said in a conversation asks for (a belief citing them).
 * - `Inspect.Page`, for an entry: the entry inside its conversation.
 * - `Inspect.Page`, for a session: what it is running (its status, model and
 *   worktree), its brief, and its latest turns.
 *
 * Every part it has no better way to say is the inspector's (`io.show`).
 *
 * @module
 */

import { type ComponentChildren, h, type JSX } from 'preact'
import { parse } from '@yaks/query'
import * as ui from '@yaks/ui'
import { Markdown } from '@yaks/markdown'
import {
  type Answer,
  type Bundle,
  type Io,
  mention,
  Part,
  type Props,
  useNamed,
  usePageNotes,
  type View,
} from '@yaks/inspect'
import { SESSION } from './comp.ts'
import { CALL, ENTRY, OUTPUT, RESULT } from './native.ts'
import { kindOf, textOf } from './status.ts'

/** Where an entry sits: its transcript, and its place in it. */
export type At = { session: string; seq: number }

/**
 * The query that reads the entries beside one in its transcript, the way
 * `grep -C` reads around a line: `n` of them ahead of it (`before`, nearest
 * first) or behind it (`after`, in order), every component of each. A
 * transcript is ordered by `entry.seq`, which may skip numbers, so entries are
 * asked for by position, never by a range of numbers.
 *
 * ```ts
 * import { beside } from './inspect.ts'
 * beside({ session: 's1', seq: 12 }, 'before', 3)
 * // '.entry.session=s1&.entry.seq<12&*&.order=-entry.seq&.limit=3'
 * ```
 */
export let beside = (at: At, way: 'before' | 'after', n: number): string =>
  `.${ENTRY}.session=${at.session}&.${ENTRY}.seq${
    way == 'before' ? '<' : '>'
  }` +
  `${at.seq}&*&.order=${way == 'before' ? '-' : ''}${ENTRY}.seq&.limit=${n}`

/** How much of a turn that is not lit reads before it is cut. */
export let TURN = 320

/** How many turns either side of an entry its page shows. */
export let AROUND = 8

/** How many of a session's latest turns its page shows. */
export let LATEST = 12

type Comp = Record<string, unknown>
let comp = (b: Bundle | undefined, name: string): Comp =>
  (b?.[name] ?? {}) as Comp
let str = (b: Bundle | undefined, name: string, prop: string): string => {
  let v = comp(b, name)[prop]
  return typeof v == 'string' ? v : ''
}
let rows = (a?: Answer): Bundle[] => a?.rows ?? []
let cut = (text: string, n: number) =>
  text.length > n ? text.slice(0, n - 1).trimEnd() + '…' : text

// Where an entry sits, if it is one.
let placed = (b: Bundle): At | undefined => {
  let session = str(b, ENTRY, 'session')
  let seq = comp(b, ENTRY).seq
  return session && typeof seq == 'number' ? { session, seq } : undefined
}

// What a tool was called with, in a line: what the caller said it was for,
// else its arguments.
let called = (b: Bundle): string => {
  let args = comp(b, CALL).args as Comp | undefined
  let why = typeof args?.description == 'string' ? args.description : ''
  return cut(why || JSON.stringify(args ?? {}), 160)
}

/** What a turn is drawn with: whether it is the one the page is about, and
 * whether it is said whole (by default, the one it is about). */
export type TurnCtx = { on?: boolean; whole?: boolean }

/** An entry as one turn of its conversation: who said it, linked to the
 * turn's own page, and what. */
export let EntryTurn = ({ e, io, ctx }: Props): JSX.Element => {
  let { on, whole = on } = ctx as TurnCtx
  let kind = kindOf(e)
  let said = textOf(e)
  let by = str(e, 'created', 'by')
  let to = str(e, CALL, 'to')
  useNamed(io, [kind == 'input' ? by : '', to])
  let who = kind == 'input' && by
    ? io.name(by)
    : OUTPUT in e || CALL in e || RESULT in e
    ? 'agent'
    : kind ?? io.kind(e)
  let text: ComponentChildren = CALL in e
    ? ['called ', to ? mention(io, to) : 'a tool', ': ', called(e)]
    : RESULT in e
    ? ['answered: ', cut(said.trim() || '…', 160)]
    : said
    ? h(Markdown, { source: whole ? said : cut(said, TURN) })
    : kind ?? io.kind(e)
  return h(
    ui.Turns.Turn,
    {
      mod: on ? 'on' : (!said || CALL in e || RESULT in e) && 'quiet',
      'data-turn': e.entity.eid,
    },
    h(ui.Turns.Who, { href: on ? undefined : io.link(e.entity.eid) }, who),
    h(ui.Turns.Text, {}, text),
  )
}

/** What a conversation around an entry is drawn with: how many turns either
 * side, and whether the entry is said whole. */
export type ConversationCtx = {
  before?: number
  after?: number
  whole?: boolean
}

/** The turns either side of an entry in its transcript, it lit among them. */
export let Conversation = ({ e, io, ctx }: Props): JSX.Element | null => {
  let { before = AROUND, after = AROUND, whole = true } = ctx as ConversationCtx
  let at = placed(e)
  let got = io.ask(
    at
      ? {
        before: beside(at, 'before', before),
        after: beside(at, 'after', after),
      }
      : {},
  )
  let ahead = rows(got.before).toReversed()
  let behind = rows(got.after)
  if (!at) return null
  return h(
    ui.Turns,
    { 'data-conversation': e.entity.eid },
    ahead.length == before
      ? h(ui.Turns.More, {}, 'earlier turns are in ', mention(io, at.session))
      : null,
    [...ahead, e, ...behind].map((b) =>
      io.show(b, 'Inspect.Turn', { on: b == e, whole: b == e && whole })
    ),
  )
}

/** An entry's page: the entry inside its conversation. */
export let EntryPage = ({ e, io }: Props): JSX.Element => {
  let notes = usePageNotes(io, e, ['Conversation'])
  let at = placed(e)
  let by = str(e, 'created', 'by')
  useNamed(io, [at?.session, by])
  let sub = [
    kindOf(e) == 'input' && by
      ? ['said by ', mention(io, by)]
      : kindOf(e) ?? 'an entry',
    at ? [' in ', mention(io, at.session), ` · turn ${at.seq}`] : null,
  ]
  return h(
    'div',
    { 'data-inspect': e.entity.eid },
    io.show(e, 'Inspect.Head', { sub, notes: notes.get('') }),
    h(
      Part,
      {
        io,
        eid: e.entity.eid,
        subject: io.id(e),
        heading: 'Conversation',
        notes,
      },
      io.show(e, 'Inspect.Conversation', {}),
    ),
    io.show(e, 'Inspect.Facts', { notes, skip: [ENTRY] }),
    io.show(e, 'Inspect.Links', { notes }),
    io.show(e, 'Inspect.History', { notes }),
  )
}

// What a session is running, in a line: its status, the model it asks, and
// the worktree it works in.
let running = (io: Io, e: Bundle): ComponentChildren[] => {
  let status = str(e, SESSION, 'status')
  let model = str(e, 'using', 'model')
  let branch = str(e, 'worktree', 'branch')
  let path = str(e, 'worktree', 'path')
  return [
    status || 'no status',
    model ? [' · asks ', mention(io, model)] : null,
    branch || path ? [' · in ', branch || path] : null,
  ]
}

/** A session's latest turns, oldest first. */
let Latest = (
  { e, io, notes }: { e: Bundle; io: Io; notes: Map<string, Bundle[]> },
): JSX.Element => {
  let eid = e.entity.eid
  let line = `.${ENTRY}.session=${eid}`
  let got = io.ask({
    turns: `${line}&*&.order=-${ENTRY}.seq&.limit=${LATEST}`,
    total: { query: `${line}&.count`, once: true },
  })
  let turns = rows(got.turns).toReversed()
  return h(
    Part,
    {
      io,
      eid,
      subject: io.id(e),
      heading: 'Latest turns',
      count: got.total?.count,
      note: h(
        'a',
        { href: io.find(`${line}&.order=${ENTRY}.seq`) },
        'every turn',
      ),
      notes,
    },
    !turns.length
      ? h(ui.Rows.More, {}, got.turns?.ready ? 'nothing said yet' : '…')
      : h(ui.Turns, {}, turns.map((b) => io.show(b, 'Inspect.Turn', {}))),
  )
}

/** A session's page. */
export let SessionPage = ({ e, io }: Props): JSX.Element => {
  let notes = usePageNotes(io, e, ['Latest turns'])
  useNamed(io, [str(e, 'using', 'model')])
  let brief = str(e, 'brief', 'text')
  return h(
    'div',
    { 'data-inspect': e.entity.eid },
    io.show(e, 'Inspect.Head', { sub: running(io, e), notes: notes.get('') }),
    brief
      ? h(
        ui.Section,
        { 'data-brief': '' },
        h(ui.Body, {}, h(Markdown, { source: brief })),
      )
      : null,
    h(Latest, { e, io, notes }),
    io.show(e, 'Inspect.Facts', { notes, skip: ['brief'] }),
    io.show(e, 'Inspect.Links', { notes, skip: [`${ENTRY}.session`] }),
    io.show(e, 'Inspect.History', { notes }),
  )
}

/** The pages and parts this package draws in the inspector. */
export let inspectViews: View[] = [
  { view: 'Inspect.Turn', match: parse(`.${ENTRY}`), Render: EntryTurn },
  {
    view: 'Inspect.Conversation',
    match: parse(`.${ENTRY}`),
    Render: Conversation,
  },
  { view: 'Inspect.Page', match: parse(`.${ENTRY}`), Render: EntryPage },
  { view: 'Inspect.Page', match: parse(`.${SESSION}`), Render: SessionPage },
]
