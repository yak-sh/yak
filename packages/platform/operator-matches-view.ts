/**
 * A space's Matches page (`/<space>/matches`, D-453): where its members tap
 * between the sides of a round of pair matches, most often drafts of one of
 * its apps. It is drawn from one row (./operator-matches.ts): the rounds to
 * pick in, or with `?round=` one round. The server draws it for the first
 * paint, and the browser draws it again as the row moves
 * (./operator-matches-browser.ts), sending each pick through the page graph.
 *
 * One pair at a time, the one the rating of the person's own picks says is
 * worth picking in next, under its question: each side drawn as what it is
 * (a draft in a frame at the reader's own preview link, a picture, prose, an
 * attempt's parts), a button under each, Neither, and why, typed before the
 * tap. Under it, where every side stands so far, with what was measured of
 * it: what the Operator's decision carries into each choice.
 *
 * @module
 */
import { createElement as h } from 'react'
import { Button } from '@yaks/ui/Button'
import { Card } from '@yaks/ui/Card'
import { Empty } from '@yaks/ui/Empty'
import { Field } from '@yaks/ui/Field'
import { Form } from '@yaks/ui/Form'
import { Preview } from '@yaks/ui/Preview'
import { markdown } from '@yaks/session/prose'
import { talkPath } from './routes.ts'
import { bySha, draftAt } from './updates-view.ts'
import type { Matches, Tapped, Tapping } from './operator-matches.ts'

/** What the page says beside its row: whose it is, the space and what its
 * Operator is called, and the round its address asks for (empty for the
 * rounds). */
export type MatchesView = {
  person: string
  space: { eid: string; slug: string; operator: string }
  round: string
}

/** The page's address in `space`: its rounds, or one round. */
export let matchesAt = (space: { slug: string }, round = ''): string =>
  `${talkPath('matches', space.slug)}${
    round ? `?round=${encodeURIComponent(round)}` : ''
  }`

// A side drawn as what it is.
let side = (
  space: MatchesView['space'],
  round: string,
  s: Tapped,
  parts: string[],
) => {
  let eid = s.entity.eid
  let output = (s.writing as { output?: Record<string, string> })?.output
  if (output) {
    return h(
      'div',
      { className: 'Update_Prose' },
      parts.filter((p) => output[p]).map((p) => h('p', null, output[p])),
    )
  }
  let file = s.artifact as { media_type?: string; address?: string } | undefined
  if (file) {
    let at = `${matchesAt(space, round)}&side=${encodeURIComponent(eid)}${
      file.address ? bySha({ address: file.address }) : ''
    }`
    return String(file.media_type).startsWith('image/')
      ? h('img', { className: 'Update_Picture', src: at, alt: '' })
      : h('a', { href: at, target: '_blank', rel: 'noopener' }, 'Open file')
  }
  let doc = s.doc as { title?: string; body?: string } | undefined
  if (doc) {
    return h(
      'div',
      { className: 'Update_Prose' },
      doc.title ? h('b', null, doc.title) : null,
      doc.body ? markdown(doc.body) : null,
    )
  }
  // Anything else is a draft of one of the space's apps.
  return h(
    Preview,
    { className: 'Update_Draft' },
    h(
      Preview.Address,
      { href: draftAt(space, eid), target: '_blank', rel: 'noopener' },
      'Open the draft',
    ),
    h(Preview.Frame, {
      mod: 'flat',
      src: draftAt(space, eid),
      loading: 'lazy',
      title: 'A draft',
    }),
  )
}

// The pair to pick in: its question, why, the two sides each over its
// button, then Neither and what a refused pick said.
let pairCard = (space: MatchesView['space'], t: Tapping) => {
  let c = t.card!
  return h(
    Card,
    { className: 'Update Update-needs', id: 'pair' },
    h(
      'p',
      { className: 'Update_Words' },
      c.question ?? 'Which would you choose?',
    ),
    h(
      'form',
      { className: 'Update_Form Page_Form', 'data-pick': '' },
      h(Form.Hidden, { name: 'round', value: t.round }),
      h(Form.Hidden, { name: 'pair', value: String(c.n) }),
      h(Field, {
        className: 'Update_Input',
        name: 'why',
        'aria-label': 'Why, if you like',
        placeholder: 'Why, if you like',
      }),
      h(
        'ul',
        { className: 'Update_Choices Update_Choices-shown' },
        (['first', 'second'] as const).map((which) =>
          h(
            'li',
            { className: 'Update_Choice' },
            side(space, t.round, c[which], t.parts),
            h(
              Button,
              { mod: 'go', name: 'chose', value: which },
              `${c[which].label}`,
            ),
          )
        ),
      ),
      h(Button, { name: 'chose', value: 'neither' }, 'Neither'),
      h('p', {
        className: 'Form_Hint',
        role: 'status',
        'data-said': '',
        hidden: true,
      }),
    ),
  )
}

// Where every side stands, highest first.
let standing = (t: Tapping) =>
  t.places.some((p) => !p.measured.startsWith('Not picked'))
    ? h(
      Card,
      { className: 'Update' },
      h('p', { className: 'Update_Words' }, h('b', null, 'So far')),
      h(
        'ol',
        { className: 'Update_Choices' },
        t.places.map((p) =>
          h('li', null, h('b', null, p.label), `: ${p.measured}`)
        ),
      ),
    )
    : null

/** The Matches page as `view` asks it, drawn from `read`: the rounds to pick
 * in, or one round's next pair and where its sides stand. */
export let matchesView = (view: MatchesView, read: Matches) => {
  let { space } = view
  if ('rounds' in read) {
    return h(
      'div',
      null,
      read.rounds.length
        ? h(
          Card,
          { className: 'Update' },
          h(
            'p',
            { className: 'Note Update_About' },
            `${space.operator} asks you to pick between drafts here before one is released.`,
          ),
          h(
            'ul',
            { className: 'Update_Choices' },
            read.rounds.map((r) =>
              h(
                'li',
                null,
                h(
                  'a',
                  { href: matchesAt(space, r.round) },
                  r.title || 'A round',
                ),
                r.left ? ` · ${r.left} to pick` : ' · nothing left to pick',
              )
            ),
          ),
        )
        : h(
          'div',
          { className: 'Talk_Hello' },
          h(Empty.Title, { mod: 'welcome' }, 'Nothing to pick'),
          h(
            'p',
            null,
            `When ${space.operator} makes several drafts to choose between, you pick between them here.`,
          ),
        ),
    )
  }
  return h(
    'div',
    null,
    h('p', { className: 'Note Update_About' }, read.title),
    read.card ? pairCard(space, read) : h(
      Card,
      { className: 'Update' },
      h(
        'p',
        { className: 'Update_Words' },
        read.picked == 1
          ? 'Nothing left to pick here: your pick settles the rest.'
          : `Nothing left to pick here: your ${read.picked} picks settle the rest.`,
      ),
    ),
    standing(read),
  )
}
