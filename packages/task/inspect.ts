/**
 * How a task reads in the inspector (@yaks/inspect), registered in this
 * package's `/views` facet ahead of the page any entity has: its title, and
 * under it where it stands (its status, read through the vocabulary's ladder,
 * its priority, project and assignee, what it is blocked on); what it asks,
 * in full; what was said about it (the comments aimed at it, oldest first,
 * each by who wrote it and when); then the parts any page has (`io.show`),
 * what requires what among its links. A note left in the inspector, a comment
 * that is also a task, shows under its heading rather than among the
 * comments.
 *
 * @module
 */

import { type ComponentChildren, h, type JSX } from 'preact'
import { Markdown } from '@yaks/markdown'
import { parse } from '@yaks/query'
import * as ui from '@yaks/ui'
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
import { TASK } from './comp.ts'
import { statusOf } from './words.ts'

/** How many comments a task's page reads. */
export let COMMENTS = 100

type Comp = Record<string, unknown>
let comp = (b: Bundle | undefined, name: string): Comp =>
  (b?.[name] ?? {}) as Comp
let str = (b: Bundle | undefined, name: string, prop: string): string => {
  let v = comp(b, name)[prop]
  return typeof v == 'string' ? v : ''
}
let rows = (a?: Answer): Bundle[] => a?.rows ?? []

// Where a task stands, in a line.
let standing = (io: Io, e: Bundle): ComponentChildren[] => {
  let status = statusOf(io.vocab, e) || str(e, TASK, 'status') || 'open'
  let filed = comp(e, 'filed')
  let priority = filed.priority
  let project = str(e, 'filed', 'project')
  let assignee = str(e, 'filed', 'assignee')
  let on = str(e, 'blocked', 'on')
  return [
    status,
    priority != null ? ` · P${priority}` : null,
    project ? [' · in ', mention(io, project)] : null,
    assignee ? [' · for ', mention(io, assignee)] : null,
    on ? [' · blocked on ', on] : null,
  ]
}

/** What was said about a task: the comments aimed at it, oldest first. */
let Comments = (
  { e, io, notes }: { e: Bundle; io: Io; notes: Map<string, Bundle[]> },
): JSX.Element | null => {
  let eid = e.entity.eid
  let got = io.ask({
    comments: `.comment.target=${eid}&*&.order=created.at&.limit=${COMMENTS}`,
  })
  // A note left in the inspector is a comment that is also a task; it shows
  // under the heading it was left under instead.
  let all = rows(got.comments).filter((b) => !b[TASK])
  useNamed(io, all.map((b) => str(b, 'created', 'by')))
  if (got.comments?.ready && !all.length) return null
  return h(
    Part,
    {
      io,
      eid,
      subject: io.id(e),
      heading: 'Comments',
      count: got.comments?.ready ? all.length : undefined,
      notes,
    },
    h(
      ui.Notes,
      {},
      all.map((b) => {
        let by = str(b, 'created', 'by')
        let at = str(b, 'created', 'at')
        return h(
          ui.Notes.Item,
          { key: b.entity.eid, 'data-comment': b.entity.eid },
          h(
            ui.Notes.Text,
            {},
            h(Markdown, {
              source: str(b, 'doc', 'body') || str(b, 'doc', 'title'),
            }),
          ),
          h(ui.Notes.Who, {}, by ? mention(io, by) : ''),
          h(
            ui.Notes.When,
            {},
            h('a', { href: io.link(b.entity.eid), title: at }, io.when(at)),
          ),
        )
      }),
    ),
  )
}

/** A task's page. */
export let TaskPage = ({ e, io }: Props): JSX.Element => {
  let notes = usePageNotes(io, e, ['Comments'])
  useNamed(io, [str(e, 'filed', 'project'), str(e, 'filed', 'assignee')])
  return h(
    'div',
    { 'data-inspect': e.entity.eid },
    io.show(e, 'Inspect.Head', { sub: standing(io, e), notes: notes.get('') }),
    io.show(e, 'Inspect.Body'),
    h(Comments, { e, io, notes }),
    io.show(e, 'Inspect.Facts', { notes, skip: [TASK, 'filed', 'blocked'] }),
    io.show(e, 'Inspect.Links', { notes, skip: ['comment.target'] }),
    io.show(e, 'Inspect.History', { notes }),
  )
}

/** The page this package draws in the inspector. */
export let inspectViews: View[] = [
  { view: 'Inspect.Page', match: parse(`.${TASK}`), Render: TaskPage },
]
