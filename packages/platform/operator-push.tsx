/** @jsxImportSource preact */
// What the Operator tells or asks a person, drawn as a notification
// (@yaks/push/notice): the `Push` view of the row it is about, chosen the way
// every view is (@yaks/render), the most specific match winning. Its title
// says what happened, and its body is the row's own words. Its tag is the
// row, so a newer notification about it replaces the older one, and once the
// row is read or answered the notification is taken away by that tag.
import type { Bundle, Comp } from '@yaks/graph'
import { type FunctionComponent, h } from 'preact'
import { blocks, parse as markdown } from '@yaks/markdown/structural'
import { Action, Notification } from '@yaks/push/notice'
import { parse } from '@yaks/query'
import { define, type Registration } from '@yaks/render'

/** What a notification needs beside its row: the Operator's name, where
 * pressing it opens, the space's icon and the badge, and where an answer
 * is posted (its Updates). */
export type Telling = {
  operator: string
  open: string
  icon: string
  badge: string
  answer: string
}

type Props = { e: Bundle; ctx: Telling }

let part = (e: Bundle, name: string) => (e[name] ?? {}) as Comp
let text = (v: unknown) => String(v ?? '').trim()

// Words written in Markdown, as elements the push host reads as text.
let Words = ({ said }: { said: string }) => <>{blocks(markdown(said), h)}</>

// A notification about row `e`, opening where `ctx` says, titled `title`.
let Told = (
  { e, ctx, title, children }: Props & { title: string; children?: unknown },
) => (
  <Notification
    title={title}
    tag={e.entity.eid}
    url={ctx.open}
    icon={ctx.icon}
    badge={ctx.badge}
  >
    {children}
  </Notification>
)

/** Something the Operator tells them: its subject over its words. */
export let Notice = ({ e, ctx }: Props) => (
  <Told
    e={e}
    ctx={ctx}
    title={text(part(e, 'doc').title) || `${ctx.operator} sent a note`}
  >
    <Words said={text(part(e, 'doc').body)} />
  </Told>
)

/** The Operator's answer to words they left before it came: its own
 * words, never the words it answers. */
export let Reply = ({ e, ctx }: Props) => (
  <Told e={e} ctx={ctx} title={`${ctx.operator} replied`}>
    <Words said={text(part(e, 'doc').body)} />
  </Told>
)

/** A question the Operator asks them. */
export let Asked = ({ e, ctx }: Props) => (
  <Told e={e} ctx={ctx} title={`${ctx.operator} asked`}>
    <Words said={text(part(e, 'decision').question)} />
  </Told>
)

// The most buttons a notification shows (Chrome's `Notification.maxActions`).
let BUTTONS = 2

/** Something the Operator needs their OK for, answered by its buttons
 * where the platform shows them. */
export let Approval = ({ e, ctx }: Props) => {
  let choices = (part(e, 'decision').choices ?? []) as { label: string }[]
  return (
    <Told e={e} ctx={ctx} title={`${ctx.operator} needs your OK`}>
      <Words said={text(part(e, 'decision').question)} />
      {choices.length <= BUTTONS &&
        choices.map(({ label }) => (
          <Action
            action={label}
            title={label}
            post={ctx.answer}
            form={{ choose: e.entity.eid, choice: label }}
          />
        ))}
    </Told>
  )
}

/** A `Push` view: its match and its component. */
export type PushView = Registration & { Render: FunctionComponent<Props> }

/** The Operator's notifications, by what they are about. */
export let pushViews = define<PushView>([
  { view: 'Push', match: parse('.notification'), Render: Notice },
  { view: 'Push', match: parse('.notification .reply'), Render: Reply },
  { view: 'Push', match: parse('.decision'), Render: Asked },
  {
    view: 'Push',
    match: parse('.decision .operator_approval'),
    Render: Approval,
  },
  { view: 'Push', match: parse('.decision .approval_ask'), Render: Approval },
])
