import { native as more } from './More.ts'
import { native as pairs } from './Pairs.ts'
import { native as attachments } from './Attachments.ts'
import { native as notice } from './Notice.ts'
import { native as body } from './Body.ts'
/** Messages, their replies and the marks describing each entry. @module */
import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { block, type Part } from './el.ts'
import type { Colors, Native, Specimen } from './theme.ts'
import { Time } from './Time.ts'

/** Messages, their replies and the marks describing each entry. */
export let Transcript:
  & Part
  & Record<
    | 'Lines'
    | 'Row'
    | 'Bubble'
    | 'Via'
    | 'Entry'
    | 'Meta'
    | 'When'
    | 'Reply'
    | 'Status'
    | 'Error',
    Part
  > = block('div', 'Transcript', {
    Lines: 'div',
    Row: 'div',
    Bubble: 'p',
    Via: 'span',
    Entry: 'div',
    Meta: 'div',
    When: Time as Part,
    Reply: 'div',
    Status: 'p',
    Error: 'div',
  })
/** What this part presents. */
export let description =
  'Messages, their replies and the marks describing each entry.'
/** The same parts in a terminal. */
export let sheet = (c: Colors): Sheet => ({
  Transcript: { col: true, gap: true },
  Transcript_Lines: { col: true, gap: true },
  Transcript_Bubble: { fg: c.text, bg: c.surface, wrap: true },
  Transcript_Meta: { fg: c.muted, row: true },
  Transcript_Reply: { wrap: true },
  Transcript_Status: { hidden: true },
})
/** A complete example. */
export let specimens = (): Specimen[] => [
  [
    'Transcript, variants',
    h(
      Transcript,
      {},
      h(
        Transcript.Row,
        {},
        h(
          Transcript.Entry,
          { mod: 'hidden' },
          h(
            Transcript.Bubble,
            {},
            h(Transcript.Via, {}, 'By email'),
            'Earlier words',
          ),
          h(Transcript.Meta, {}, 'Yesterday'),
        ),
      ),
      h(Transcript.Status, {}, 'Working'),
    ),
  ],
  [
    'Transcript',
    h(
      Transcript,
      {},
      h(
        Transcript.Lines,
        {},
        h(
          Transcript.Entry,
          { mod: 'theirs' },
          h(Transcript.Bubble, {}, 'Can you help?'),
          h(
            Transcript.Meta,
            {},
            h(Transcript.When, {
              at: '2026-11-06T15:42:00Z',
              now: 1794238920000,
            } as never),
          ),
        ),
        h(
          Transcript.Entry,
          { mod: 'step' },
          h(Transcript.Meta, {}, 'Read the recipes app'),
        ),
        h(Transcript.Reply, {}, 'Yes. What would you like to do?'),
        h(Transcript.Error, {}, 'The recipes app did not answer.'),
      ),
    ),
  ],
]

/** The same interface on a native host. */
export let native = (c: Colors): Native => ({
  Transcript_Lines: { gap: 14, padding: 16 },
  Transcript_Bubble: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
    backgroundColor: c.surface,
    borderRadius: 18,
    paddingVertical: 8,
    paddingHorizontal: 14,
    fontSize: 16,
    color: c.text,
  },
  Transcript_Via: { color: c.dim },
  Transcript_Entry: { gap: 4 },
  'Transcript_Entry-hidden': { opacity: 0.5 },
  Transcript_Meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  Transcript_When: { fontSize: 12, color: c.dim },
  Transcript_Reply: { gap: 8, fontSize: 16, color: c.text },
  Transcript_Error: { gap: 6 },
  Transcript_Status: { fontSize: 15, color: c.muted, paddingHorizontal: 16 },
})

/** The native parts a transcript composes, without loading a stylesheet. */
export let transcriptLook = (c: Colors): Native => ({
  ...body(c),
  ...more(c),
  ...pairs(c),
  ...attachments(c),
  ...notice(c),
  ...native(c),
})
