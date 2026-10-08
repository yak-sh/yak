/** Thread rows grouped into attention lanes, with an expandable detail. */
import { h } from 'preact'
import { block, type Part, type Props } from './el.ts'
import { Field } from './Field.ts'
import { Tabs } from './Tabs.ts'
import type { Sheet } from '@yaks/tui/theme'
import type { Colors, Specimen } from './theme.ts'

/** The visual parts of a threaded inbox. All behavior belongs to its caller. */
export let Inbox:
  & Part
  & Record<
    | 'Tools'
    | 'Mode'
    | 'Lane'
    | 'Heading'
    | 'Summary'
    | 'Thread'
    | 'Reason'
    | 'Detail'
    | 'Empty',
    Part
  > = Object.assign(
    block('section', 'Inbox', {
      Tools: 'div',
      Lane: 'section',
      Heading: 'h2',
      Summary: 'p',
      Thread: 'article',
      Reason: 'span',
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
  Inbox_Reason: { fg: c.dim },
  Inbox_Summary: { fg: c.dim },
  Inbox_Detail: { indent: 2 },
  Inbox_Empty: { fg: c.dim },
  Inbox_Mode: { block: true },
})

/** Needs, replies, an expanded conversation and an empty lane; a flat
 * list that says what it holds in all. */
export let specimens = (): Specimen[] => [
  [
    'Inbox, Tools, Mode, Lane, Heading, Thread-unread, Reason, Detail, Empty',
    h(
      Inbox,
      {},
      h(
        Inbox.Tools,
        {},
        h(Field, { placeholder: 'Search your threads…' }),
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
            'div',
            {},
            'A shared entity renderer goes here.',
            h(Inbox.Reason, {}, 'blocking · decision'),
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
            'div',
            {},
            'A shared entity renderer goes here.',
            h(Inbox.Reason, {}, 'reply to your words'),
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
  [
    'Inbox, Summary, Thread, Reason, Empty',
    h(
      Inbox,
      {},
      h(Inbox.Summary, {}, '10 items · 2 unread'),
      h(
        Inbox.Thread,
        { mod: 'unread' },
        h(
          'div',
          {},
          h(Inbox.Reason, {}, 'knock'),
          ' A shared entity renderer goes here.',
        ),
      ),
      h(Inbox.Empty, {}, '+9 more'),
    ),
  ],
]
