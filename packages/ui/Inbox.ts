/** Thread rows grouped into attention lanes, with an expandable detail. */
import { h } from 'preact'
import { block, type Part, type Props } from './el.ts'
import { Tabs } from './Tabs.ts'
import type { Sheet } from '@yaks/tui/theme'
import type { Colors, Specimen } from './theme.ts'

/** The visual parts of a threaded inbox. All behavior belongs to its caller. */
export let Inbox:
  & Part
  & Record<
    | 'Tools'
    | 'Search'
    | 'Mode'
    | 'Lane'
    | 'Heading'
    | 'Thread'
    | 'Open'
    | 'Title'
    | 'Reason'
    | 'Preview'
    | 'Detail'
    | 'Empty',
    Part
  > = Object.assign(
    block('section', 'Inbox', {
      Tools: 'div',
      Search: 'input',
      Lane: 'section',
      Heading: 'h2',
      Thread: 'article',
      Open: 'button',
      Title: 'span',
      Reason: 'span',
      Preview: 'span',
      Detail: 'div',
      Empty: 'p',
    }),
    {
      Mode: ({ class: extra, ...props }: Props) =>
        h(Tabs.Tab, {
          ...props,
          class: ['Inbox_Mode', extra].filter(Boolean).join(' '),
        }),
    },
  )

/** What it is, in a line. */
export let description =
  'Newest words and attention reasons, one row per thread.'

/** Compact rows, with each control on a line the terminal can select. */
export let sheet = (c: Colors): Sheet => ({
  Inbox_Heading: { fg: c.heading, bold: true, gap: true },
  Inbox_Open: { block: true },
  Inbox_Title: { bold: true },
  Inbox_Reason: { fg: c.dim },
  Inbox_Preview: { fg: c.dim, ellipsis: true },
  Inbox_Detail: { indent: 2 },
  Inbox_Empty: { fg: c.dim },
  Inbox_Mode: { block: true },
})

/** Needs, replies, an expanded conversation and an empty lane. */
export let specimens = (): Specimen[] => [
  [
    'Inbox, Tools, Search, Mode, Lane, Heading, Thread-unread, Open, Title, Reason, Preview, Detail, Empty',
    h(
      Inbox,
      {},
      h(
        Inbox.Tools,
        {},
        h(Inbox.Search, { placeholder: 'Search your threads…' }),
        h(Inbox.Mode, { mod: 'on', type: 'button' }, 'Both'),
        h(Inbox.Mode, { type: 'button' }, 'Said'),
        h(Inbox.Mode, { type: 'button' }, 'Received'),
      ),
      h(
        Inbox.Lane,
        {},
        h(Inbox.Heading, {}, 'Needs you · 1'),
        h(
          Inbox.Thread,
          { mod: 'unread' },
          h(
            Inbox.Open,
            { type: 'button', 'aria-expanded': true },
            h(Inbox.Title, {}, 'Choose a route'),
            h(Inbox.Reason, {}, 'blocking · decision'),
            h(Inbox.Preview, {}, 'Train or bus?'),
          ),
          h(Inbox.Detail, {}, 'A conversation and its answer controls.'),
        ),
      ),
      h(
        Inbox.Lane,
        {},
        h(Inbox.Heading, {}, 'Replies · 1'),
        h(
          Inbox.Thread,
          {},
          h(
            Inbox.Open,
            { type: 'button', 'aria-expanded': false },
            h(Inbox.Title, {}, 'Trip conversation'),
            h(Inbox.Reason, {}, 'reply to your words'),
            h(Inbox.Preview, {}, 'Platform seven.'),
          ),
        ),
      ),
      h(
        Inbox.Lane,
        {},
        h(Inbox.Heading, {}, 'Updates · 0'),
        h(Inbox.Empty, {}, 'No threads here.'),
      ),
    ),
  ],
]
