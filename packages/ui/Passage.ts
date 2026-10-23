/**
 * A passage of a longer text, standing for it in a list: `By`, the line saying
 * whose words they are, when and where (its parts kept apart by a dot), then
 * `Text`, the words themselves, cut to two lines, each match a `Match`
 * (./Match.ts). `By` may open with a `Title`, the name of a document the words
 * are its own, and holds a `Who`. A passage with only its `Text` is the words
 * alone, under a line that says the rest. Given an `href` the passage is a
 * link (el.ts).
 *
 * The parts are what a portable renderer writes as class names, so a passage
 * drawn by @yaks/render's `passage` reads the same as one made here.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h, toChildArray } from 'preact'
import { block, type Part, type Props } from './el.ts'
import type { Colors, Specimen } from './theme.ts'
import { marked } from './Match.ts'

let Base = block('p', 'Passage', {
  By: 'span',
  Title: 'span',
  Who: 'span',
  Sep: 'span',
  Text: 'span',
})

let { By: Line, Sep } = Base

/** A passage. */
export let Passage: Part & Record<'By' | 'Title' | 'Who' | 'Text', Part> =
  Object.assign(Base, {
    By: ({ children, ...p }: Props) =>
      h(
        Line,
        p,
        toChildArray(children).flatMap((kid, i) =>
          i ? [h(Sep, { key: `sep${i}` }, '·'), kid] : [kid]
        ),
      ),
  })

/** What it is, in a line. */
export let description =
  'A passage of a longer text in a list: who, when, where, and the words.'

/** The byline muted on a line of its own, who in their colour; the words
 * under it, folded at the width. */
export let sheet = (c: Colors): Sheet => ({
  Passage: { block: true },
  Passage_By: { block: true, fg: c.muted, spaced: true, ellipsis: true },
  Passage_Title: { fg: c.text },
  Passage_Who: { fg: c.who },
  Passage_Sep: { fg: c.dim },
  Passage_Text: { block: true, wrap: true },
})

let { By, Title, Who, Text } = Passage

/** Words in a conversation, a document's own, and the words alone. */
export let specimens = (): Specimen[] => [
  [
    'Passage, By, Who, Text',
    h(
      Passage,
      { href: '#entry' },
      h(
        By,
        {},
        h(Who, {}, 'Jeff'),
        h('span', {}, '2 hours ago'),
        h('span', {}, 'in Search rows for words say who said them'),
      ),
      h(
        Text,
        {},
        marked(
          '…entries currently show in the search results as just the full ' +
            'rendering. often \x01miles\x02 \x01long\x02',
        ),
      ),
    ),
  ],
  [
    'Passage, By, Title, Who, Text',
    h(
      Passage,
      { href: '#topic' },
      h(
        By,
        {},
        h(Title, {}, 'Oracle sessions'),
        h(Who, {}, 'tasks-v2 common persona'),
        h('span', {}, '3 days ago'),
      ),
      h(
        Text,
        {},
        'An oracle is not a persona per topic. A session opened on a topic ' +
          'wears one persona, the Oracle, and starts from the topic tree ' +
          'compiled from that topic: the topics it sits within, its cover and ' +
          'contents, what it holds in full, its subtopics as an outline.',
      ),
    ),
  ],
  [
    'Passage, Text',
    h(Passage, {}, h(Text, {}, marked('the result list is \x01good\x02'))),
  ],
]
