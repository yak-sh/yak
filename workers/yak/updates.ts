import { answerTransfer, transferUpdates } from './app-transfer.ts'
import {
  answerFriend,
  friendUpdates,
  messageUpdates,
  replyFriend,
} from './friends.ts'
import { Empty, Form } from '@yaks/ui/parts'
// Updates from the Operator (T-140508): what happened in a space, as messages
// from its Operator a person can reply to, at `/<space>/updates`
// (@yaks/platform/routes `talkPath('updates', …)`), beside the chat app's side
// (operator-page.ts `updatesPage`). They are @yaks/inbox's, read in the
// Operator's store (operator-updates.ts): what needs the person first, with a
// button for each choice, then what happened, newest first. A choice, or
// words about one, go into their conversation, and the chat they went to
// opens. Every space's together are at `/updates` (`allUpdates`), the
// same read across the spaces a person talks with an Operator in
// (`updatesAcross`), and how many wait in each badges the Operator switcher
// (`waitingAcross`, space-picker.ts `acrossBadge`).
import { Time } from '@yaks/ui/parts'
import type { Env } from './env.ts'
import type { Space } from './directory.ts'
import type { Who } from './session.ts'
import { cloneElement, type ComponentChildren, Fragment, h } from 'preact'
import { Button, Card, Field, More, Preview, State } from '@yaks/ui/parts'
import { operatorDoor } from './build-door.ts'
import { backTo, chatPath, talkPath } from '@yaks/platform/routes'
import { spaceHost } from '@yaks/platform/host'
import { browserImmutable } from '@yaks/platform/kept'
import type { Shown, Update } from './operator-updates.ts'
import { lastDay } from './views.ts'
import { markdown, PICTURES } from '@yaks/session/conversation'
import { caught } from './defects.ts'
import type { Choice } from '@yaks/task'
import { attachmentKey } from './attachments.ts'
import { type Directory, directoryOf } from './directory.ts'
import { EID, inApp } from './tool.ts'
import { linkOf } from './preview.ts'
import { updateAnchor } from './operator-lists.ts'
import { draftsOf, theirs } from './written.ts'
import { CallError, refused as toolRefused } from '@yaks/tools/errors'
import { refusal } from '@yaks/api/refuse'
import { status } from '@yaks/graph/errors'
import { writes } from '@yaks/member'
import {
  actionKinds,
  answerField,
  type InboxAction,
  type InboxReceipt,
} from '@yaks/inbox/actions'
import type { Clock } from './timing.ts'

/** A space a person reads Updates in, and who they are there. */
export type Seat = { space: Space; who: Who }

/** One of a person's Updates, with the space whose Operator wrote it. */
export type Placed = Update & { space: Space }

/** A person's Updates, and how many wait on them: what needs them, and what
 * they have not read, which the side counts beside "Updates from
 * <Operator>" and the Operator switcher beside each space. */
export type Updates = { updates: Placed[]; waiting: number }

/** A space whose Operator did not answer, and how it failed. */
export type Missed = { space: Space; error: unknown }

/** What reading Updates asks of each space: what they read now marked read
 * (`seen`), or the notices they dismissed (`dismissed`). */
type Asking = { seen?: boolean; dismissed?: boolean }

/** A person's Updates across the spaces they stand in: @yaks/inbox read in
 * each space's Operator store (operator-updates.ts), as one list, what needs
 * them first and then newest first, each with its space, and how many wait
 * on them in all and in each space (`by`, by slug). A space whose Operator
 * did not answer is left out, its failure in `missed` for the caller. One space's Updates
 * are this read of that space alone (`updatesOf`). */
export let updatesAcross = async (
  env: Env,
  seats: Seat[],
  { seen = false, dismissed = false }: Asking = {},
): Promise<
  Updates & { by: Map<string, number>; missed: Missed[] }
> => {
  let args = dismissed ? { dismissed } : seen ? { seen } : {}
  let missed: Missed[] = []
  let read = await Promise.all(seats.map(async ({ space, who }) => {
    try {
      let [{ updates, waiting }, offers] = await Promise.all([
        operatorDoor(env, space, who, 'updates', args) as Promise<
          { updates: Update[]; waiting: number }
        >,
        dismissed ? [] : offersOf(env, space, who, seen),
      ])
      return {
        space,
        waiting: waiting + offers.filter((u) => u.needs).length,
        updates: [...updates, ...offers].map((u) => ({ ...u, space })),
      }
    } catch (error) {
      missed.push({ space, error })
      return { space, waiting: 0, updates: [] }
    }
  }))
  let updates = read.flatMap((r) => r.updates).sort((a, b) =>
    +b.needs - +a.needs || b.at.localeCompare(a.at)
  )
  return {
    updates,
    waiting: read.reduce((n, r) => n + r.waiting, 0),
    by: new Map(read.map((r) => [r.space.slug, r.waiting])),
    missed,
  }
}

/** A person's Updates in one space. `seen` marks what they read now as
 * read. */
export let updatesOf = async (
  env: Env,
  space: Space,
  who: Who,
  seen = false,
): Promise<Updates> => {
  let { updates, waiting, missed } = await updatesAcross(env, [{
    space,
    who,
  }], { seen })
  if (missed.length) throw missed[0].error
  return { updates, waiting }
}

/** The notices a person dismissed in a space, newest first. */
export let dismissedOf = async (
  env: Env,
  space: Space,
  who: Who,
): Promise<Updates> => {
  let { updates, waiting, missed } = await updatesAcross(env, [{
    space,
    who,
  }], { dismissed: true })
  if (missed.length) throw missed[0].error
  return { updates, waiting }
}

/** How many of a person's Updates wait on them in each of their spaces, by
 * slug: the count each space's own Updates badge says, asked alone. A space
 * whose Operator did not answer is reported and left out. */
export let waitingAcross = async (
  env: Env,
  seats: Seat[],
): Promise<Record<string, number>> =>
  Object.fromEntries(
    (await Promise.all(seats.map(async ({ space, who }) => {
      try {
        let [{ waiting }, offers] = await Promise.all([
          operatorDoor(env, space, who, 'updates', { count: true }) as Promise<
            { waiting: number }
          >,
          offersOf(env, space, who),
        ])
        return [[space.slug, waiting + offers.filter((u) => u.needs).length]]
      } catch (e) {
        caught(e, { request: 'updates waiting', space: space.slug })
        return []
      }
    }))).flat(),
  )

/** The apps an update can be about, by eid, where they open. */
export type Apps = { eid: string; slug: string; title: string }[]

// Where an update leads: the chat it came from (the person's own
// conversation where it names none), and the app it is about.
let leads = (env: Env, space: Space, u: Update, apps: Apps) => {
  let chat = seeing(space, u)
  let app = apps.find((a) => a.eid == u.about)
  return [chat, ...app ? [' · ', opening(env, space, app)] : []]
}

/** Where an update opens its chat: the conversation it came from, at the
 * entry it was written from, drawn from just before that entry so an old
 * one is on the page (operator-page.ts `chatPage`, `from`), and named in the
 * address the page scrolls to and marks (`row-<entry>`). */
export let chatAt = (space: Space, u: Pick<Update, 'from'>) => {
  let at = chatPath(space.slug, u.from?.chat)
  let { entry, seq } = u.from ?? {}
  return entry ? `${at}${seq ? `?from=${seq - 1}` : ''}#row-${entry}` : at
}

// The link to the chat an update came from.
let seeing = (space: Space, u: Update) =>
  h('a', { href: chatAt(space, u) }, 'See the chat')

// A link opening one of the space's apps.
let opening = (env: Env, space: Space, app: Apps[number]) =>
  h('a', {
    href: `https://${spaceHost(env, space.slug)}/${app.slug}/`,
    target: '_blank',
    rel: 'noopener',
  }, `Open ${app.title || app.slug}`)

// What the directory holds for a person beside their Operator's
// Updates: apps offered to the space, friend requests and suggestions, and
// messages from friends, which reading (`seen`) marks read.
let offersOf = async (env: Env, space: Space, who: Who, seen = false) =>
  (await Promise.all([
    transferUpdates(env, space, who),
    friendUpdates(env, space, who),
    messageUpdates(env, space, who, seen),
  ])).flat()

/** Where an update's card is drawn: its space, and the page it is on where
 * that is not the space's own Updates (`back`), which a choice or a
 * dismissal returns to. */
type At = { space: Space; back?: string }

// A reply carries a request id so sending it twice sends it once.
let form = (
  { space, back }: At,
  fields: [string, string][],
  ...inner: ComponentChildren[]
) =>
  h(
    'form',
    {
      class: 'Update_Form Page_Form',
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
  h('div', { class: 'Update_Words' }, markdown(text))

// When it happened, said the human way.
let stamp = (u: Update) => h(Time, { at: u.at, class: 'Update_When' })

let head = (
  u: Update,
  title: ComponentChildren,
  where: ComponentChildren,
  ...actions: ComponentChildren[]
) =>
  h(
    Card.Head,
    { class: 'Update_Head' },
    title,
    h('div', { class: 'Update_Byline' }, where, stamp(u), ...actions),
  )

let subject = (u: Update) =>
  u.subject ? h(Card.Title, { class: 'Update_Subject' }, u.subject) : null

// Where what a choice shows is read: a file kept in the space, through the
// question that shows it, or an app's draft, at the reader's own preview
// link (`shownAnswer`).
let shownAt = (space: Space, u: Update, s: Shown) =>
  s.artifact
    ? `${talkPath('updates', space.slug)}?shown=${
      encodeURIComponent(u.eid)
    }&eid=${encodeURIComponent(s.eid)}${bySha(s.artifact)}`
    : draftAt(space, s.eid)

// What a choice shows, drawn by its components: a picture, a file to open,
// prose, or else an app, its draft in a frame.
let showing = (space: Space, u: Update, s: Shown) => {
  let at = shownAt(space, u, s)
  if (s.artifact) {
    return s.artifact.media_type.startsWith('image/')
      ? h('img', { class: 'Update_Picture', src: at, alt: s.choice })
      : h('a', { href: at, target: '_blank', rel: 'noopener' }, 'Open file')
  }
  if (s.doc) {
    return h(
      'div',
      { class: 'Update_Prose' },
      s.doc.title ? h('b', null, s.doc.title) : null,
      s.doc.body ? markdown(s.doc.body) : null,
    )
  }
  return h(
    Preview,
    { class: 'Update_Draft' },
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
      { class: 'Update_Choices Update_Choices-shown' },
      choices.map((c, i) =>
        h(
          'li',
          { class: 'Update_Choice' },
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
let needsCard = (at: At, u: Update, where: ComponentChildren = null) => {
  let { space } = at
  let choices = [...u.choices ?? []].sort((a, b) =>
    +(b.label == u.recommended) - +(a.label == u.recommended)
  )
  let header = head(
    u,
    h(State, {
      class: 'Update_Needs',
      mod: 'negative',
      'data-inbox-pending': '',
    }, 'Needs you'),
    where,
    h('span', { class: 'Update_Meta' }, seeing(space, u)),
  )
  if (u.shown?.length) {
    return h(
      Card,
      { class: 'Update Update-needs', id: updateAnchor(u.eid) },
      header,
      words(u.words),
      shownChoices(at, u, choices),
      other(at, u),
      replying(at, u),
    )
  }
  return h(
    Card,
    { class: 'Update Update-needs', id: updateAnchor(u.eid) },
    header,
    words(u.words),
    choices.length
      ? h(
        Fragment,
        null,
        h(
          'ul',
          { class: 'Update_Choices' },
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
      class: 'Update_Input',
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
      { class: 'Update_Other', 'data-inbox-pending': '' },
      h(More.Summary, {}, 'Other'),
      h(More.Body, {}, box),
    )
    : box
}

// A way to send the Operator words about an update, opened in place.
let replying = (at: At, u: Update) =>
  h(
    More,
    { mod: 'quiet', class: 'Update_Reply' },
    h(More.Summary, {}, `Ask ${at.space.operator} about it`),
    h(
      More.Body,
      {},
      form(
        at,
        [['reply', u.eid]],
        h(Field, {
          class: 'Update_Input',
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
  where: ComponentChildren,
  field: [string, string],
  answers: Answer[],
  prompt?: string,
) =>
  h(
    Card,
    { class: 'Update', id: updateAnchor(u.eid) },
    head(u, subject(u), where),
    h(
      'p',
      { class: 'Update_Words' },
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
  where: ComponentChildren,
  { friend, name }: NonNullable<Update['message']>,
) =>
  h(
    Card,
    { class: 'Update', id: updateAnchor(u.eid) },
    head(
      u,
      subject(u),
      where,
      u.unread ? h(State, { mod: 'positive' }, 'New') : null,
    ),
    h('p', { class: 'Update_Words' }, u.words),
    form(
      at,
      [['message', friend]],
      h(Field, {
        class: 'Update_Input',
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
  env: Env,
  at: At,
  u: Update,
  apps: Apps,
  where: ComponentChildren = null,
) => {
  let { space } = at
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
      class: u.unread ? 'Update Update-new' : 'Update',
      id: updateAnchor(u.eid),
    },
    head(u, subject(u), where, away),
    words(u.words),
    h(
      'p',
      { class: 'Update_Meta' },
      leads(env, space, u, apps),
      u.unread ? [' · ', h(State, { mod: 'positive' }, 'New')] : null,
    ),
    replying(at, u),
  )
}

let card = (
  env: Env,
  at: At,
  u: Update,
  apps: Apps,
  where: ComponentChildren = null,
) => {
  let drawn = drawCard(env, at, u, apps, where)
  return cloneElement(
    drawn,
    {
      'data-inbox-card': crypto.randomUUID(),
      'data-inbox-waits': u.needs ? at.space.slug : undefined,
    },
    drawn.props.children,
    h('output', {
      class: 'Update_Status',
      'data-inbox-status': '',
      tabindex: -1,
      hidden: true,
    }),
  )
}

/** The notices a person dismissed, newest first, and the way back to the
 * rest. */
export let dismissedUpdates = (
  env: Env,
  space: Space,
  { updates }: { updates: Update[]; waiting: number },
  apps: Apps = [],
) =>
  h(
    Fragment,
    null,
    h(
      'p',
      { class: 'Note Update_About' },
      'What you dismissed. Each comes back to your Updates when something new happens on it. ',
      h('a', { href: talkPath('updates', space.slug) }, 'Back to Updates'),
    ),
    updates.length
      ? updates.map((u) => card(env, { space }, u, apps))
      : h('p', { class: 'Update_Meta' }, 'Nothing dismissed.'),
  )

/** How long the Updates page waits on the last day's visits before it is
 * drawn without them: they are a curiosity, never worth a slow page. */
export let VISITS_WAIT = 1500

/** Each app's visits in the last day, or none where they are not switched on
 * or not answered within `wait`. */
export let visitsOf = async (
  env: Env,
  apps: Apps,
  wait = VISITS_WAIT,
): Promise<Map<string, number> | undefined> => {
  let asked = apps.length ? lastDay(env, apps.map((a) => a.eid)) : null
  if (!asked) return undefined
  let timer: number | undefined
  try {
    return await Promise.race([
      asked,
      new Promise<undefined>((done) => timer = setTimeout(done, wait)),
    ])
  } catch (e) {
    caught(e, { request: 'updates visits' })
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

let COUNT = new Intl.NumberFormat('en')

/** The Operator's word on the last day, said when the page is drawn: the
 * visits across the apps and the busiest of them, when there are any to
 * count. How many things need the person is the side's bell to say. The
 * server knows no one's clock, so it is the last day and not today. */
export let lastDayLine = (
  apps: Apps,
  views: Map<string, number> | undefined,
) => {
  let said: string[] = []
  if (views && apps.length) {
    let counted = apps.map((a) => ({ a, n: views.get(a.eid) ?? 0 }))
      .filter((c) => c.n > 0).sort((x, y) => y.n - x.n)
    let total = counted.reduce((sum, c) => sum + c.n, 0)
    said.push(
      total
        ? `In the last day, your apps had ${COUNT.format(total)} visit${
          total == 1 ? '' : 's'
        }.`
        : 'Nobody visited your apps in the last day.',
    )
    if (counted.length > 1) {
      said.push(`${counted[0].a.title || counted[0].a.slug} was the busiest.`)
    }
  }
  return said.join(' ')
}

/** What the Updates page shows under its bar: the day, then what waits on
 * the person, the rows of their servers' `lists` that wait before the
 * Updates that need them, then what happened. */
export let updates = (
  env: Env,
  space: Space,
  { updates }: { updates: Update[]; waiting: number },
  lists: ComponentChildren = null,
  apps: Apps = [],
  views?: Map<string, number>,
  friends?: string,
) => {
  let day = lastDayLine(apps, views)
  return h(
    Fragment,
    null,
    h(
      'p',
      { class: 'Note Update_About' },
      `${space.operator} writes here when something happens in your apps, and asks here when something needs you. Ask about any of it, and the chat opens.`,
    ),
    day
      ? h(
        Card,
        { class: 'Update Update-day' },
        h('p', {
          class: 'Update_Words',
        }, day),
      )
      : null,
    friends
      ? h(
        Card,
        { class: 'Update Update-day' },
        h('p', { class: 'Update_Words' }, friends),
      )
      : null,
    lists,
    updates.length ? updates.map((u) => card(env, { space }, u, apps)) : h(
      'div',
      { class: 'Talk_Hello' },
      h(Empty.Title, { mod: 'welcome' }, 'Nothing yet'),
      h(
        'p',
        null,
        `When ${space.operator} finishes something, fixes an app, or someone joins, it shows here.`,
      ),
    ),
    h(
      'p',
      { class: 'Update_Meta' },
      h(
        'a',
        { href: talkPath('updates', space.slug) + '?dismissed' },
        'See what you dismissed',
      ),
    ),
  )
}

/** The person's Updates from every space's Operator, at `/updates`. */
export let ALL = talkPath('updates')

// Which space and Operator an update came from, leading to that space's own
// Updates.
let whereFrom = (space: Space) =>
  h(
    'a',
    { class: 'Update_Where', href: talkPath('updates', space.slug) },
    `${space.title || space.slug} · ${space.operator}`,
  )

/** The person's Updates from every space's Operator together, newest first
 * with what needs them ahead: each card names the space and Operator it came
 * from, acts as it does on that space's page, and comes back here. A space
 * whose Operator did not answer says so. `apps` are each space's, by slug. */
export let allUpdates = (
  env: Env,
  { updates }: Updates,
  apps: Map<string, Apps>,
  missed: Space[] = [],
) =>
  h(
    Fragment,
    null,
    h(
      'p',
      { class: 'Note Update_About' },
      'What the Operator of each of your spaces wrote or asked you, together. Ask about any of it, and its chat opens.',
    ),
    missed.map((space) =>
      h(
        'p',
        { class: 'Note' },
        `${space.operator} in ${
          space.title || space.slug
        } could not be reached just now. Open this page again to try.`,
      )
    ),
    updates.length
      ? updates.map((u) =>
        card(
          env,
          { space: u.space, back: ALL },
          u,
          apps.get(u.space.slug) ?? [],
          whereFrom(u.space),
        )
      )
      : h(
        'div',
        { class: 'Talk_Hello' },
        h(Empty.Title, { mod: 'welcome' }, 'Nothing yet'),
        h(
          'p',
          null,
          'When an Operator finishes something, fixes an app, or someone joins one of your spaces, it shows here.',
        ),
      ),
  )

/** Commit the action where the card came from and return its receipt. */
let commitAction = async (
  env: Env,
  space: Space,
  who: Who,
  { kind, target, answer }: InboxAction,
  receipt: boolean,
): Promise<InboxReceipt> => {
  switch (kind) {
    case 'transfer': {
      let kind = await answerTransfer(env, space, who, target, answer)
      return {
        label: answer == 'decline'
          ? 'Declined'
          : kind == 'domain'
          ? 'Domain accepted'
          : 'App accepted',
      }
    }
    case 'friend': {
      let standing = await answerFriend(env, who, target, answer, receipt)
      return {
        label: answer == 'declined'
          ? 'Dismissed'
          : standing == 'friend'
          ? 'Friends'
          : 'Request sent',
      }
    }
    case 'dismiss':
      await operatorDoor(env, space, who, 'updates', { dismiss: target })
      return { label: 'Dismissed' }
    case 'choose':
      await operatorDoor(env, space, who, 'updates', {
        choose: target,
        choice: answer,
      })
      return { label: 'Answer sent' }
  }
}

let readAction = async (req: Request) => {
  if (req.headers.get('content-type')?.split(';')[0] != 'application/json') {
    throw new CallError('arguments', 'Send the action as JSON.')
  }
  let items = await req.json()
  if (!Array.isArray(items) || items.length != 1) {
    throw new CallError('arguments', 'Send one action from an Updates card.')
  }
  let { entity, inboxAction: action } = items[0] ?? {}
  if (
    typeof entity?.eid != 'string' || !EID.test(entity.eid) ||
    typeof action?.space != 'string' || !EID.test(action.space) ||
    !actionKinds.includes(action.kind) ||
    typeof action.target != 'string' || !EID.test(action.target) ||
    typeof action.answer != 'string'
  ) {
    throw new CallError('arguments', 'Send one action from an Updates card.')
  }
  return {
    entity: { eid: entity.eid } as { eid: string },
    action: action as InboxAction,
  }
}

/** The page graph's write door. It only needs the space and the caller's seat. */
export let updatesApply = async (
  req: Request,
  env: Env,
  dir: Directory,
  person: string,
  until: number | undefined,
  c: Clock,
): Promise<Response> => {
  try {
    let { entity, action } = await readAction(req)
    let { space, role, administrative } = await c.time(
      'updates_seat',
      () => dir.seat(action.space, person, true),
    )
    let who = {
      person,
      role: administrative ? 'owner' as const : role ?? null,
      until,
      administrative,
    }
    if (!space || space.trashed || !writes(who.role)) {
      throw new CallError('access', 'That Updates card is no longer available.')
    }
    let inboxReceipt = await c.time(
      `updates_${action.kind}`,
      () => commitAction(env, space, who, action, true),
    )
    return Response.json([{ entity, inboxReceipt }])
  } catch (error) {
    if (error instanceof CallError) {
      return Response.json({ error: error.code, message: error.message }, {
        status: toolRefused(error).status,
      })
    }
    let code = (error as { status?: number } | null)?.status ?? status(error)
    if (code >= 400 && code < 500) {
      return Response.json(refusal(error), { status: code })
    }
    caught(error, { request: 'Updates action' })
    // A failed round trip may have committed the action. Let sync retry.
    return new Response(null, { status: 503 })
  }
}

/** A choice or dismissal stays in Updates. A message opens its chat. */
export let updatesAnswer = async (
  req: Request,
  env: Env,
  space: Space,
  who: Who,
) => {
  let form = await req.formData()
  let field = (name: string) => String(form.get(name) ?? '')
  // Back to the page the card was on: the space's Updates, or every space's.
  let to = new URL(
    backTo(env, field('back'), talkPath('updates', space.slug)),
  )
  let back = to.pathname + to.search
  let kind = actionKinds.find((kind) => form.has(kind))
  if (kind) {
    await commitAction(env, space, who, {
      kind,
      space: space.eid,
      target: field(kind),
      answer: field(answerField(kind)),
    }, false)
    return new Response(null, { status: 303, headers: { location: back } })
  }
  if (form.has('message')) {
    await replyFriend(env, who, field('message'), field('say'))
    return new Response(null, { status: 303, headers: { location: back } })
  }
  let { request } = await operatorDoor(
    env,
    space,
    who,
    'updates',
    { reply: field('reply'), say: field('say'), id: field('id') },
  ) as { request?: string }
  return new Response(null, {
    status: 303,
    headers: {
      location: request ? chatPath(space.slug, request) : back,
    },
  })
}

/** A file kept in the space, as a page shows it: a picture in place, and
 * anything else saved. */
export let fileAnswer = async (
  env: Env,
  space: Space,
  file: { address: string; media_type: string },
  req?: Request,
) => {
  let kept = await env.BLOBS.get(attachmentKey(space, file.address))
  if (!kept) return new Response('That file is missing.', { status: 404 })
  let shows = PICTURES.includes(file.media_type)
  return new Response(kept.body, {
    headers: {
      'content-type': shows ? file.media_type : 'application/octet-stream',
      'content-disposition': shows ? 'inline' : 'attachment',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "sandbox; default-src 'none'",
      'cache-control': named(req, file)
        ? browserImmutable
        : 'private, no-store',
    },
  })
}

/** A kept file's address said by its bytes (`?sha=`, `shownAt`): asked for
 * by it, the browser keeps it for good, since those bytes never change. */
export let bySha = (file: { address: string }) =>
  `&sha=${encodeURIComponent(file.address)}`
let named = (req: Request | undefined, file: { address: string }) =>
  !!req && new URL(req.url).searchParams.get('sha') == file.address

/** Where a draft of one of the space's apps is read in a page's frame: the
 * reader's own preview link of it (`shownAnswer`). */
export let draftAt = (space: Space, draft: string) =>
  `${talkPath('updates', space.slug)}?draft=${encodeURIComponent(draft)}`

/** What a choice of a person's question shows, read from their Updates
 * (`?shown=<question>&eid=<file>`): a file kept in the space, a picture
 * opening in place and anything else saved; or an app's draft
 * (`?draft=<app>`), sent on to the reader's own preview link (preview.ts
 * `linkOf`), which the platform lets the page frame. Undefined for a read
 * that names neither. */
export let shownAnswer = async (
  req: Request,
  env: Env,
  space: Space,
  who: Who,
): Promise<Response | undefined> => {
  let q = new URL(req.url).searchParams
  let missing = (what: string) =>
    new Response(`That ${what} is missing.`, { status: 404 })
  if (q.has('shown')) {
    let file = await operatorDoor(env, space, who, 'updates', {
      shown: q.get('shown'),
      eid: q.get('eid') ?? '',
    }).catch((e) => e?.status == 404 ? null : Promise.reject(e)) as
      | { address: string; media_type: string }
      | null
    return file ? fileAnswer(env, space, file, req) : missing('file')
  }
  if (!q.has('draft')) return undefined
  if (!env.SESSION_SECRET) return missing('draft')
  let dir = directoryOf(env.STORE)
  // A draft by its own id, or an app's, whose draft is the reader's own
  // (written.ts `theirs`).
  let shown = q.get('draft')!
  if (!/^[0-9a-f-]{36}$/i.test(shown)) return missing('draft')
  let named = await dir.draftAt(shown)
  let held = await dir.appAt(named?.app ?? shown)
  if (!held || held.app.space != space.eid) return missing('draft')
  let ctx = { env, dir, person: who.person ?? '' }
  let found = await inApp(ctx, { space: space.slug, app: held.app.slug })
    .catch((e) => e instanceof CallError ? null : Promise.reject(e))
  if (!found) return missing('draft')
  let of = named?.draft ??
    theirs(await draftsOf(dir, found.app), found.who)
  if (!of) return missing('draft')
  let { at } = await linkOf(ctx, space, found.app, found.who, of)
  return new Response(null, { status: 302, headers: { location: at } })
}
