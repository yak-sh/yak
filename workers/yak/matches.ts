// A space's Matches (D-453, T-160577): where its members tap between the
// sides of a round of pair matches, most often drafts of one of its apps, at
// `/<space>/matches` (@yaks/platform/routes `talkPath('matches', …)`).
// The rounds and every pick are @yaks/trial's, in the space's Operator store
// (operator-trials.ts `matching`); this draws them and sends a pick back.
//
// One pair at a time, the one the rating of the person's own picks says is
// worth picking in next, under its question: each side drawn as what it is
// (a draft in a frame at the reader's own preview link, a picture, prose, an
// attempt's parts), a button under each, Neither, and why, typed before the
// tap. Under it, where every side stands so far, with what was measured of
// it: what the Operator's decision carries into each choice.
import { type ComponentChildren, h } from 'preact'
import { Button, Card, Empty, Field, Form, Preview } from '@yaks/ui/parts'
import { talkPath } from '@yaks/platform/routes'
import { markdown } from '@yaks/session/conversation'
import type { Env } from './env.ts'
import type { Space } from './directory.ts'
import type { Who } from './session.ts'
import { operatorDoor } from './build-door.ts'
import { bySha, draftAt, fileAnswer } from './updates.ts'
import type { Tapped, Tapping } from './operator-trials.ts'

/** The rounds a member may pick in, with how many pairs are left for them. */
export type Rounds = {
  rounds: { round: string; title: string; left: number; of: number }[]
}

/** What the page asks the Operator's store: the rounds, one round, or a
 * pick in one. */
export let matchesOf = (
  env: Env,
  space: Space,
  who: Who,
  args: Record<string, unknown> = {},
) => operatorDoor(env, space, who, 'matches', args)

let here = (space: Space, round?: string) =>
  `${talkPath('matches', space.slug)}${
    round ? `?round=${encodeURIComponent(round)}` : ''
  }`

// A side drawn as what it is.
let side = (space: Space, round: string, s: Tapped, parts: string[]) => {
  let eid = s.entity.eid
  let output = (s.writing as { output?: Record<string, string> })?.output
  if (output) {
    return h(
      'div',
      { class: 'Update_Prose' },
      parts.filter((p) => output[p]).map((p) => h('p', null, output[p])),
    )
  }
  let file = s.artifact as { media_type?: string; address?: string } | undefined
  if (file) {
    let at = `${here(space, round)}&side=${encodeURIComponent(eid)}${
      file.address ? bySha({ address: file.address }) : ''
    }`
    return String(file.media_type).startsWith('image/')
      ? h('img', { class: 'Update_Picture', src: at, alt: '' })
      : h('a', { href: at, target: '_blank', rel: 'noopener' }, 'Open file')
  }
  let doc = s.doc as { title?: string; body?: string } | undefined
  if (doc) {
    return h(
      'div',
      { class: 'Update_Prose' },
      doc.title ? h('b', null, doc.title) : null,
      doc.body ? markdown(doc.body) : null,
    )
  }
  // Anything else is a draft of one of the space's apps.
  return h(
    Preview,
    { class: 'Update_Draft' },
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

let form = (space: Space, t: Tapping, ...inner: ComponentChildren[]) =>
  h(
    'form',
    { class: 'Update_Form Page_Form', method: 'post', action: here(space) },
    h(Form.Hidden, { name: 'round', value: t.round }),
    h(Form.Hidden, { name: 'pair', value: String(t.card!.n) }),
    ...inner,
  )

// The pair to pick in: its question, the two sides each over its button,
// then why and Neither.
let pairCard = (space: Space, t: Tapping) => {
  let c = t.card!
  return h(
    Card,
    { class: 'Update Update-needs', id: 'pair' },
    h('p', { class: 'Update_Words' }, c.question ?? 'Which would you choose?'),
    form(
      space,
      t,
      h(Field, {
        class: 'Update_Input',
        name: 'why',
        'aria-label': 'Why, if you like',
        placeholder: 'Why, if you like',
      }),
      h(
        'ul',
        { class: 'Update_Choices Update_Choices-shown' },
        (['first', 'second'] as const).map((which) =>
          h(
            'li',
            { class: 'Update_Choice' },
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
    ),
  )
}

// Where every side stands, highest first.
let standing = (t: Tapping) =>
  t.places.some((p) => !p.measured.startsWith('Not picked'))
    ? h(
      Card,
      { class: 'Update' },
      h('p', { class: 'Update_Words' }, h('b', null, 'So far')),
      h(
        'ol',
        { class: 'Update_Choices' },
        t.places.map((p) =>
          h('li', null, h('b', null, p.label), `: ${p.measured}`)
        ),
      ),
    )
    : null

/** What the Matches page shows: the rounds to pick in, or one round's next
 * pair and where its sides stand. */
export let matches = (space: Space, read: Rounds | Tapping) => {
  if ('rounds' in read) {
    return h(
      'div',
      null,
      read.rounds.length
        ? h(
          Card,
          { class: 'Update' },
          h(
            'p',
            { class: 'Note Update_About' },
            `${space.operator} asks you to pick between drafts here before one is released.`,
          ),
          h(
            'ul',
            { class: 'Update_Choices' },
            read.rounds.map((r) =>
              h(
                'li',
                null,
                h('a', { href: here(space, r.round) }, r.title || 'A round'),
                r.left ? ` · ${r.left} to pick` : ' · nothing left to pick',
              )
            ),
          ),
        )
        : h(
          'div',
          { class: 'Talk_Hello' },
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
    h('p', { class: 'Note Update_About' }, read.title),
    read.card ? pairCard(space, read) : h(
      Card,
      { class: 'Update' },
      h(
        'p',
        { class: 'Update_Words' },
        `Nothing left to pick here: your ${read.picked} pick${
          read.picked == 1 ? '' : 's'
        } settle the rest.`,
      ),
    ),
    standing(read),
  )
}

/** A picture a side of a round is (`?round=<round>&side=<eid>`), undefined
 * for a read that names none. */
export let sideAnswer = async (
  req: Request,
  env: Env,
  space: Space,
  who: Who,
): Promise<Response | undefined> => {
  let q = new URL(req.url).searchParams
  if (!q.has('side')) return undefined
  let file = await matchesOf(env, space, who, {
    round: q.get('round') ?? '',
    side: q.get('side'),
  }).catch((e) => e?.status == 404 ? null : Promise.reject(e)) as
    | { address: string; media_type: string }
    | null
  return file
    ? fileAnswer(env, space, file, req)
    : new Response('That file is missing.', { status: 404 })
}

/** A pick sent from the page: written as the person's, and the round opens
 * again at its next pair. */
export let matchesAnswer = async (
  req: Request,
  env: Env,
  space: Space,
  who: Who,
) => {
  let form = await req.formData()
  let field = (name: string) => String(form.get(name) ?? '')
  await matchesOf(env, space, who, {
    round: field('round'),
    pair: Number(field('pair')),
    chose: field('chose'),
    why: field('why').trim(),
  })
  return new Response(null, {
    status: 303,
    headers: { location: here(space, field('round')) },
  })
}
