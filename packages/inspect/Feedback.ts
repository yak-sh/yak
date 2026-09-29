/**
 * `Inspect.Feedback`: what people said about a part, where they saw it, and
 * a line to say more. Feedback is a comment aimed at the part
 * (`comment{target}`), so it is shown wherever comments on it are; and it is
 * an open task (`task{}`) as well, one entity wearing both, so it is on every
 * list of open work until someone takes it and fixes what it is about. A
 * comment on anything else reaches only a session that has claimed it
 * (@yaks/session's bus), and nobody claims a component or a property.
 *
 * @module
 */

import { h } from 'preact'
import { Button, Chip, Field, Timeline } from '@yaks/ui'
import type { Bundle, Io, Props } from './host.ts'
import { section, sent, write } from './page.ts'
import { comp, line, str } from './read.ts'
import { rows, waiting } from './rows.ts'

let VIEW = 'Inspect.Feedback'

/** How many comments a part shows. */
export let COMMENTS = 100

/**
 * Feedback on the entity `eid`, as the change that leaves it: a comment on
 * it that is also an open task, titled by what it is about and its first
 * line.
 *
 * ```ts
 * import { feedback } from './Feedback.ts'
 * feedback('c1', 'task', 'status should be an enum\nit is text today')
 * // [{
 * //   entity: { eid: '$feedback' },
 * //   doc: { title: 'task: status should be an enum', body: 'status should be an enum\nit is text today' },
 * //   comment: { target: 'c1' },
 * //   task: {},
 * // }]
 * ```
 */
export let feedback = (eid: string, about: string, text: string): Bundle[] => [{
  entity: { eid: '$feedback' },
  doc: { title: `${about}: ${line(text, 80)}`, body: text },
  comment: { target: eid },
  task: {},
}]

// Whether a comment's task is done: it wears its `completed` mark.
let settled = (b: Bundle) => !!b.completed || !!b.cancelled

let said = (io: Io, b: Bundle) => {
  let c = comp(b, 'created')
  let who = typeof c.by == 'string' ? c.by : ''
  return h(
    Timeline.Item,
    { key: b.entity.eid },
    h(
      Timeline.When,
      {},
      h(
        'a',
        { href: io.link(b.entity.eid) },
        c.at ? io.when(String(c.at)) : io.id(b),
      ),
    ),
    ' ',
    h(Timeline.Who, {}, who ? io.name(who) : ''),
    b.task
      ? [
        ' ',
        h(
          Chip,
          { mod: settled(b) ? 'ghost' : '1' },
          settled(b) ? 'fixed' : 'open',
        ),
      ]
      : null,
    h(Timeline.What, {}, str(b, 'doc', 'body') || str(b, 'doc', 'title')),
  )
}

// A line to say more, sent as feedback.
let Say = ({ e, io }: { e: Bundle; io: Io }) => {
  let submit = (ev: Event & { currentTarget: HTMLFormElement }) => {
    let { body } = sent(ev)
    let eid = e.entity.eid
    if (body) write(io, eid, VIEW, feedback(eid, io.name(eid), body))
  }
  return h(
    'form',
    { class: 'Inspect_Say', onSubmit: submit },
    h(Field, {
      lines: true,
      name: 'body',
      'aria-label': 'feedback',
      placeholder: 'what is wrong here, or could be better…',
    }),
    h(Button, { type: 'submit' }, 'leave feedback'),
  )
}

let Body = ({ e, io, got }: Props) =>
  h(
    'div',
    {},
    waiting(got.rows) ??
      h(Timeline, {}, rows(got.rows).map((b) => said(io, b))),
    io.edits ? h(Say, { e, io }) : null,
  )

/** What people said about a part, and a line to say more. */
export let feedbacks = section({
  view: VIEW,
  match: true,
  title: 'Feedback',
  asks: (e) => ({
    rows: `.comment&.comment.target=${e.entity.eid}&.limit=${COMMENTS}`,
  }),
  count: ({ got }) => got.rows?.ready ? rows(got.rows).length : undefined,
  Body,
})
