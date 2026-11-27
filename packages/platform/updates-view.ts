/**
 * A person's Updates as cards (D-475 step 4): a notice, a question that needs
 * them with its choices, an offer (an app or domain, a friend request), and a
 * friend's message, each with what acts on it. The server draws a space's
 * Updates page with them from the person's rows (./update-rows.ts), and the
 * browser draws the cards again as the rows move (./updates-list-browser.ts).
 * A card's forms are taken by @yaks/inbox's actions through the page graph.
 *
 * @module
 */
import {
  cloneElement,
  createElement as h,
  Fragment,
  type ReactNode,
} from 'react'
import { Button } from '@yaks/ui/Button'
import { Card } from '@yaks/ui/Card'
import { Empty } from '@yaks/ui/Empty'
import { Field } from '@yaks/ui/Field'
import { Form } from '@yaks/ui/Form'
import { More } from '@yaks/ui/More'
import { Preview } from '@yaks/ui/Preview'
import { State } from '@yaks/ui/State'
import { Time } from '@yaks/ui/Time'
import { markdown } from '@yaks/session/prose'
import { actionKinds } from '@yaks/inbox/actions'
import type { Choice } from '@yaks/task'
import { chatPath, talkPath } from './routes.ts'
import type { Bundle } from '@yaks/graph'
import {
  newsOrder,
  type Shown,
  type Update,
  updateAnchor,
  updatesIn,
} from './update-rows.ts'

/** The space a card is drawn in: what links into it, and its Operator's
 * name. */
export type Spot = {
  eid: string
  slug: string
  title?: string
  operator: string
}

/** The apps an update can be about, by eid, where they open. */
export type Apps = { eid: string; slug: string; title: string }[]

/** Where an update opens its chat: the conversation it came from, at the
 * entry it was written from, drawn from just before that entry so an old
 * one is on the page, and named in the address the page scrolls to and marks
 * (`row-<entry>`). */
export let chatAt = (space: Pick<Spot, 'slug'>, u: Pick<Update, 'from'>) => {
  let at = chatPath(space.slug, u.from?.chat)
  let { entry, seq } = u.from ?? {}
  return entry ? `${at}${seq ? `?from=${seq - 1}` : ''}#row-${entry}` : at
}

// The link to the chat an update came from.
let seeing = (space: Spot, u: Update) =>
  h('a', { href: chatAt(space, u) }, 'See the chat')

// A link opening one of the space's apps.
let opening = ({ space, apex }: At, app: Apps[number]) =>
  h('a', {
    href: `https://${space.slug}.${apex}/${app.slug}/`,
    target: '_blank',
    rel: 'noopener',
  }, `Open ${app.title || app.slug}`)

// Where an update leads: the chat it came from (the person's own
// conversation where it names none), and the app it is about.
let leads = (at: At, u: Update, apps: Apps) => {
  let chat = seeing(at.space, u)
  let app = apps.find((a) => a.eid == u.about)
  return [chat, ...app ? [' · ', opening(at, app)] : []]
}

/** Where an update's card is drawn: its space, the zone its spaces answer
 * under, and the page it is on where that is not the space's own Updates
 * (`back`), which a choice or a dismissal returns to. */
export type At = { space: Spot; apex: string; back?: string }

// A reply carries a request id so sending it twice sends it once.
let form = (
  { space, back }: At,
  fields: [string, string][],
  ...inner: ReactNode[]
) =>
  h(
    'form',
    {
      className: 'Update_Form Page_Form',
      method: 'post',
      action: talkPath('updates', space.slug),
      ...actionKinds.some((kind) => kind == fields[0]?.[0])
        ? {
          'data-inbox-action': fields[0][0],
          'data-inbox-space': space.eid,
        }
        : {},
    },
    [
      ...fields,
      ...back ? [['back', back] as [string, string]] : [],
      ['id', crypto.randomUUID()],
    ].map(([name, value]) => h(Form.Hidden, { name, value })),
    ...inner,
  )

// What an update says, in the Markdown the Operator writes it in.
let words = (text: string) =>
  h('div', { className: 'Update_Words' }, markdown(text))

// When it happened, said the human way.
let stamp = (u: Update) => h(Time, { at: u.at, className: 'Update_When' })

let head = (
  u: Update,
  title: ReactNode,
  where: ReactNode,
  ...actions: ReactNode[]
) =>
  h(
    Card.Head,
    { className: 'Update_Head' },
    title,
    h('div', { className: 'Update_Byline' }, where, stamp(u), ...actions),
  )

let subject = (u: Update) =>
  u.subject ? h(Card.Title, { className: 'Update_Subject' }, u.subject) : null

// Where what a choice shows is read: a file kept in the space, through the
// question that shows it, or an app's draft, at the reader's own preview
// link (`shownAnswer`).
let shownAt = (space: Spot, u: Update, s: Shown) =>
  s.artifact
    ? `${talkPath('updates', space.slug)}?shown=${
      encodeURIComponent(u.eid)
    }&eid=${encodeURIComponent(s.eid)}${bySha(s.artifact)}`
    : draftAt(space, s.eid)

// What a choice shows, drawn by its components: a picture, a file to open,
// prose, or else an app, its draft in a frame.
let showing = (space: Spot, u: Update, s: Shown) => {
  let at = shownAt(space, u, s)
  if (s.artifact) {
    return s.artifact.media_type.startsWith('image/')
      ? h('img', { className: 'Update_Picture', src: at, alt: s.choice })
      : h('a', { href: at, target: '_blank', rel: 'noopener' }, 'Open file')
  }
  if (s.doc) {
    return h(
      'div',
      { className: 'Update_Prose' },
      s.doc.title ? h('b', null, s.doc.title) : null,
      s.doc.body ? markdown(s.doc.body) : null,
    )
  }
  return h(
    Preview,
    { className: 'Update_Draft' },
    h(
      Preview.Address,
      { href: at, target: '_blank', rel: 'noopener' },
      'Open the draft',
    ),
    h(Preview.Frame, {
      mod: 'flat',
      src: at,
      loading: 'lazy',
      title: `${s.choice}, the draft`,
    }),
  )
}

// Choices that show something: each a column with what it shows, its words
// and its button under them, side by side where there is room and one above
// the next on a phone.
let shownChoices = (at: At, u: Update, choices: Choice[]) =>
  form(
    at,
    [['choose', u.eid]],
    h(
      'ul',
      { className: 'Update_Choices Update_Choices-shown' },
      choices.map((c, i) =>
        h(
          'li',
          { className: 'Update_Choice' },
          (u.shown ?? []).filter((s) => s.choice == c.label)
            .map((s) => showing(at.space, u, s)),
          h('p', null, h('b', null, c.label), `: ${c.description}`),
          h(
            Button,
            { mod: !i && 'go', name: 'choice', value: c.label },
            c.label,
          ),
        )
      ),
    ),
  )

// What needs a person: the Operator's question, its choices, a button for
// each (the one it recommends first and filled), "Other" for an answer in
// their own words, and below them a way to ask
// about it, opened in place. Choices that show something are drawn with it.
let needsCard = (at: At, u: Update, where: ReactNode = null) => {
  let { space } = at
  let choices = [...u.choices ?? []].sort((a, b) =>
    +(b.label == u.recommended) - +(a.label == u.recommended)
  )
  let header = head(
    u,
    h(State, {
      className: 'Update_Needs',
      mod: 'negative',
      'data-inbox-pending': '',
    }, 'Needs you'),
    where,
    h('span', { className: 'Update_Meta' }, seeing(space, u)),
  )
  if (u.shown?.length) {
    return h(
      Card,
      { className: 'Update Update-needs', id: updateAnchor(u.eid) },
      header,
      words(u.words),
      shownChoices(at, u, choices),
      other(at, u),
      replying(at, u),
    )
  }
  return h(
    Card,
    { className: 'Update Update-needs', id: updateAnchor(u.eid) },
    header,
    words(u.words),
    choices.length
      ? h(
        Fragment,
        null,
        h(
          'ul',
          { className: 'Update_Choices' },
          choices.map((c) =>
            h('li', null, h('b', null, c.label), `: ${c.description}`)
          ),
        ),
        form(
          at,
          [['choose', u.eid]],
          h(
            Card.Actions,
            null,
            choices.map((c, i) =>
              h(
                Button,
                { mod: !i && 'go', name: 'choice', value: c.label },
                c.label,
              )
            ),
          ),
        ),
      )
      : null,
    other(at, u),
    replying(at, u),
  )
}

// The last choice, always there: "Other", opened in place, a box for the
// person's own words, which answer the question as theirs and reach the
// Operator as the answer. A question with no choices asks for their words
// alone, so its box is open.
let other = (at: At, u: Update) => {
  let box = form(
    at,
    [['choose', u.eid]],
    h(Field, {
      className: 'Update_Input',
      lines: true,
      name: 'choice',
      required: true,
      placeholder: 'Your own answer…',
      'aria-label': 'Your own answer',
    }),
    h(Button, { mod: 'go', type: 'submit' }, 'Answer'),
  )
  return u.choices?.length
    ? h(
      More,
      { className: 'Update_Other', 'data-inbox-pending': '' },
      h(More.Summary, {}, 'Other'),
      h(More.Body, {}, box),
    )
    : box
}

// A way to send the Operator words about an update, opened in place.
let replying = (at: At, u: Update) =>
  h(
    More,
    { mod: 'quiet', className: 'Update_Reply' },
    h(More.Summary, {}, `Ask ${at.space.operator} about it`),
    h(
      More.Body,
      {},
      form(
        at,
        [['reply', u.eid]],
        h(Field, {
          className: 'Update_Input',
          lines: true,
          name: 'say',
          required: true,
          'aria-label': `Your words to ${at.space.operator}`,
          placeholder: 'Write a follow-up…',
        }),
        h(Button, { mod: 'go', type: 'submit' }, 'Send'),
      ),
    ),
  )

// A notice put away: it leaves their Updates until something happens on it.
let dismissing = (at: At, u: Update) =>
  form(
    at,
    [['dismiss', u.eid]],
    h(Button, { mod: 'quiet', type: 'submit' }, 'Dismiss'),
  )

// An answer a card's button sends: its value and its label.
type Answer = [string, string]

// Something the directory holds for a person to answer (an app offered to
// them, a friend request): its subject, its words, and a button for each
// answer while it needs them, the first filled.
let offerCard = (
  at: At,
  u: Update,
  where: ReactNode,
  field: [string, string],
  answers: Answer[],
  prompt?: string,
) =>
  h(
    Card,
    { className: 'Update', id: updateAnchor(u.eid) },
    head(u, subject(u), where),
    h(
      'p',
      { className: 'Update_Words' },
      u.words,
      prompt ? h('span', { 'data-inbox-pending': '' }, ` ${prompt}`) : null,
    ),
    u.needs
      ? form(
        at,
        [field],
        h(
          Card.Actions,
          null,
          answers.map(([value, label], i) =>
            h(Button, { mod: !i && 'go', name: 'answer', value }, label)
          ),
        ),
      )
      : null,
  )

// A friend's message: who it is from, their words, when, and a box to
// reply to them.
let messageCard = (
  at: At,
  u: Update,
  where: ReactNode,
  { friend, name, invite }: NonNullable<Update['message']>,
) =>
  h(
    Card,
    { className: 'Update', id: updateAnchor(u.eid) },
    head(
      u,
      subject(u),
      where,
      u.unread ? h(State, { mod: 'positive' }, 'New') : null,
    ),
    h('p', { className: 'Update_Words' }, u.words),
    invite ? h('a', { href: invite, rel: 'noreferrer' }, 'Join game') : null,
    form(
      at,
      [['message', friend]],
      h(Field, {
        className: 'Update_Input',
        lines: true,
        name: 'say',
        required: true,
        maxlength: 4000,
        'aria-label': `Your reply to ${name}`,
        placeholder: `Reply to ${name}…`,
      }),
      h(Button, { mod: 'go', type: 'submit' }, 'Send'),
    ),
  )

// A notice: its subject and a way to put it away, its words, when it came
// and where it came from, and a way to ask about it.
let drawCard = (
  at: At,
  u: Update,
  apps: Apps,
  where: ReactNode = null,
) => {
  if (u.transfer) {
    return offerCard(at, u, where, ['transfer', u.eid], [
      ['accept', u.transfer.kind == 'domain' ? 'Accept domain' : 'Accept app'],
      ...u.transfer.editor
        ? [['accept-with-editor', 'Accept and keep editor'] as Answer]
        : [],
      ['decline', 'Decline'],
    ])
  }
  if (u.message) return messageCard(at, u, where, u.message)
  if (u.friend) {
    return offerCard(
      at,
      u,
      where,
      ['friend', u.friend.person],
      [['approved', 'Add friend'], ['declined', 'Not now']],
      u.friend.suggested
        ? 'Add them as a friend? They see a request only if you do.'
        : undefined,
    )
  }
  if (u.needs) return needsCard(at, u, where)
  let away = u.dismissed ? null : h(Card.Actions, null, dismissing(at, u))
  return h(
    Card,
    {
      className: u.unread ? 'Update Update-new' : 'Update',
      id: updateAnchor(u.eid),
    },
    head(u, subject(u), where, away),
    words(u.words),
    h(
      'p',
      { className: 'Update_Meta' },
      leads(at, u, apps),
      u.unread ? [' · ', h(State, { mod: 'positive' }, 'New')] : null,
    ),
    replying(at, u),
  )
}

/** One of the person's Updates as its card, `where` naming where it came
 * from on a page of several spaces'. A card's id for its actions is fresh
 * each time it is drawn, and kept when it is drawn again in place
 * (./updates-list-browser.ts); `data-key` is the update's. */
export let card = (
  at: At,
  u: Update,
  apps: Apps,
  where: ReactNode = null,
) => {
  let drawn = drawCard(at, u, apps, where)
  return cloneElement(
    drawn,
    {
      'data-key': u.eid,
      'data-inbox-card': crypto.randomUUID(),
      'data-inbox-waits': u.needs ? at.space.slug : undefined,
    },
    drawn.props.children,
    h('output', {
      className: 'Update_Status',
      'data-inbox-status': '',
      tabindex: -1,
      hidden: true,
    }),
  )
}

/** A kept file's address said by its bytes (`?sha=`, `shownAt`): asked for
 * by it, the browser keeps it for good, since those bytes never change. */
export let bySha = (file: { address: string }) =>
  `&sha=${encodeURIComponent(file.address)}`
/** Where a draft of one of the space's apps is read in a page's frame: the
 * reader's own preview link of it (`shownAnswer`). */
export let draftAt = (space: Pick<Spot, 'slug'>, draft: string) =>
  `${talkPath('updates', space.slug)}?draft=${encodeURIComponent(draft)}`

/** What a list of Updates cards says about itself beside the rows: whose
 * they are, the spaces they come from, and the zone apps answer under. With
 * `back`, it is the page of every space's Updates together, where each card
 * names the space it came from and comes back to `back`. */
export type UpdatesView = {
  person: string
  spaces: Spot[]
  apex: string
  back?: string
}

/** An update, and the space it came from. */
export type Placed = Update & { space: Spot }

/** The part of `space` a view carries. */
export let spotOf = (
  { eid, slug, title, operator }: Spot,
): Spot => ({ eid, slug, title, operator })

/** The updates `rows` hold for each of `spaces`, together in the order the
 * page lists them. */
export let placedIn = (rows: Bundle[], spaces: Spot[]): Placed[] =>
  spaces.flatMap((space) =>
    updatesIn(rows, space.eid).map((u) => ({ ...u, space }))
  ).sort(newsOrder)

// Which space and Operator an update came from, leading to that space's own
// Updates.
let whereFrom = (space: Spot) =>
  h(
    'a',
    { className: 'Update_Where', href: talkPath('updates', space.slug) },
    `${space.title || space.slug} · ${space.operator}`,
  )

/** The cards of the person's `updates`, each with the apps of its space
 * (`apps`), or that there are none yet. */
export let cardsView = (
  view: UpdatesView,
  updates: Placed[],
  apps: (space: Spot) => Apps,
): ReactNode =>
  updates.length
    ? updates.map((u) =>
      card(
        { space: u.space, apex: view.apex, back: view.back },
        u,
        apps(u.space),
        view.back ? whereFrom(u.space) : null,
      )
    )
    : h(
      'div',
      { className: 'Talk_Hello' },
      h(Empty.Title, { mod: 'welcome' }, 'Nothing yet'),
      h(
        'p',
        null,
        view.back
          ? 'When an Operator finishes something, fixes an app, or someone joins one of your spaces, it shows here.'
          : `When ${
            view.spaces[0]?.operator
          } finishes something, fixes an app, or someone joins, it shows here.`,
      ),
    )
