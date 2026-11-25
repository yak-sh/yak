/**
 * Friends over every signed-in page of yaks.app (T-3528), drawn from the
 * person's rows (./account-rows.ts): a launcher pinned to the corner, saying
 * who is online and how many messages wait, and the panel it opens over the
 * page. The panel lists each friend, online first, with their last message
 * or when they were last on; pressed, a friend's conversation opens in its
 * place, with a box to write in; and a friend is asked by their email.
 *
 * It is drawn again from the tab's page graph each time a row moves or the
 * person moves in it (./friends-dock-browser.ts), from what the tab holds,
 * so opening it and changing conversations draw in one frame. A phone keeps
 * the launcher in the page's bar (`barLauncher`) instead of the corner.
 *
 * @module
 */
import { h } from 'preact'
import type { IconNode } from 'lucide'
import { Badge } from '@yaks/ui/Badge'
import { Button } from '@yaks/ui/Button'
import { Dock } from '@yaks/ui/Dock'
import { Dot } from '@yaks/ui/Dot'
import { Field } from '@yaks/ui/Field'
import { Form } from '@yaks/ui/Form'
import { Icon } from '@yaks/ui/Icon'
import { Identity } from '@yaks/ui/Identity'
import { Loading } from '@yaks/ui/Loading'
import { Rows } from '@yaks/ui/Rows'
import { Transcript } from '@yaks/ui/Transcript'
// @ts-types="@yaks/ui/lucide"
import ChevronLeft from 'lucide/dist/esm/icons/chevron-left.mjs'
// @ts-types="@yaks/ui/lucide"
import Users from 'lucide/dist/esm/icons/users.mjs'
// @ts-types="@yaks/ui/lucide"
import X from 'lucide/dist/esm/icons/x.mjs'
import type { Befriended, FriendMessage } from './account-rows.ts'
import { appTile } from './app-tile.ts'
import { empty, said, send } from './page-parts.ts'
import { online, seenWords } from './presence.ts'
import { possessive } from '@yaks/text'

/** Whose the dock is, and the zone their friends' spaces answer under. */
export type DockView = { person: string; apex: string }

/** Where the person is in the dock: the friend whose conversation is open,
 * if any, and the message a toast says just came, if any. */
export type DockAt = { friend?: string; toast?: string }

/** A message as the dock holds it. */
export type Held = FriendMessage & { eid: string }

/** The dock's element, which a swap leaves as it stands (@yaks/ui/navigate
 * `KEPT`). */
export let DOCK = 'friends'

/** The panel the launchers open. */
export let PANEL = 'friends-panel'

/** How many online friends' faces a launcher shows. */
let FACES = 3

let glyph = (of: IconNode) => h(Icon, { of })

let initial = (name: string) => (name.trim()[0] ?? '?').toUpperCase()

/** The messages from `friend` to `me` not yet read. */
export let unread = (messages: Held[], me: string, friend?: string): Held[] =>
  messages.filter((m) =>
    m.to == me && !m.read && (friend == undefined || m.from == friend)
  )

/** The messages between `me` and `friend`, oldest first. */
export let between = (messages: Held[], me: string, friend: string): Held[] =>
  messages.filter((m) =>
    (m.from == me && m.to == friend) || (m.from == friend && m.to == me)
  )

// What a launcher says: the faces of a few friends online and the word, or
// in a bar the friends glyph wearing a green dot while any is online, and
// how many messages wait.
let launcherParts = (friends: Befriended[], waiting: number, word: boolean) => {
  let here = friends.filter((f) => online(f.seen))
  let said = [
    waiting ? `${waiting} unread` : '',
    here.length ? `${here.length} online` : '',
  ].filter(Boolean).join(', ')
  return {
    label: said ? `Friends: ${said}` : 'Friends',
    kids: [
      word
        ? [
          h(
            Dock.Faces,
            { 'aria-hidden': 'true' },
            here.slice(0, FACES).map((f) =>
              h(Dock.Face, { key: f.person, title: f.name }, initial(f.name))
            ),
          ),
          h(
            Dock.Word,
            null,
            here.length ? `Friends · ${here.length} online` : 'Friends',
          ),
        ]
        : [
          glyph(Users),
          here.length ? h(Dot, { mod: 'positive', class: 'Dock_Here' }) : null,
        ],
      waiting ? h(Badge, { 'data-dock-waiting': '' }, String(waiting)) : null,
    ],
  }
}

/** The launcher a phone keeps in the page's bar, opening the dock's panel. */
export let barLauncher = (
  friends: Befriended[] = [],
  messages: Held[] = [],
  me = '',
) => {
  let { label, kids } = launcherParts(
    friends,
    unread(messages, me).length,
    false,
  )
  return h(
    Dock.Launcher,
    {
      mod: 'bar',
      type: 'button',
      popovertarget: PANEL,
      'data-dock-bar': '',
      title: label,
      'aria-label': label,
    },
    kids,
  )
}

let close = () =>
  h(
    Button,
    {
      mod: 'quiet',
      type: 'button',
      popovertarget: PANEL,
      popovertargetaction: 'hide',
      title: 'Close friends',
      'aria-label': 'Close friends',
    },
    glyph(X),
  )

let face = (f: Befriended) =>
  h(
    Identity.Avatar,
    { class: 'Friend_Avatar' },
    initial(f.name),
    online(f.seen)
      ? h(Dot, {
        mod: 'positive',
        class: 'Friend_Dot',
        role: 'img',
        'aria-label': 'Online',
      })
      : null,
  )

// One friend in the list: their face, their name, their last message or
// when they were last on, and how many of theirs wait.
let friendRow = (f: Befriended, mine: Held[], me: string, now: number) => {
  let last = mine.at(-1)
  let waiting = unread(mine, me).length
  let note = last
    ? `${last.from == me ? 'You: ' : ''}${last.words}`
    : seenWords(f.seen, now)
  return h(
    Rows.Item,
    { as: 'li', 'data-key': f.person },
    h(
      Identity,
      {
        as: 'button',
        type: 'button',
        class: 'Dock_Friend',
        'data-dock-friend': f.person,
      },
      face(f),
      h(
        Identity.Text,
        null,
        h(Identity.Name, null, f.name),
        note ? h(Identity.Note, null, note) : null,
      ),
      waiting
        ? h(Identity.Action, null, h(Badge, null, String(waiting)))
        : null,
    ),
  )
}

let asking = () =>
  h(
    Form,
    { class: 'Dock_Ask', 'data-friend-ask': '' },
    h(Form.Label, { for: 'dock-friend-email' }, 'Add a friend'),
    h(
      'div',
      { class: 'Dock_Line' },
      h(Field, {
        id: 'dock-friend-email',
        name: 'email',
        type: 'email',
        required: true,
        autocomplete: 'off',
        spellcheck: 'false',
        placeholder: 'Their yaks.app email',
      }),
      send('Ask'),
    ),
    said(),
  )

// Every friend, online first, with what each last said; while the rows are
// not in yet, that they are coming.
let list = (
  view: DockView,
  friends: Befriended[] | undefined,
  messages: Held[],
  now: number,
) => {
  let here = friends?.filter((f) => online(f.seen)).length ?? 0
  return [
    h(
      Dock.Head,
      null,
      h(
        Dock.Title,
        null,
        h(Identity.Name, null, 'Friends'),
        h(
          Identity.Note,
          { as: 'p' },
          friends?.length ? `${here} of ${friends.length} online` : '',
        ),
      ),
      close(),
    ),
    h(
      Dock.Body,
      null,
      !friends ? h(Loading, null, 'Finding your friends…') : friends.length
        ? h(
          Rows,
          { as: 'ul', class: 'Dock_Friends' },
          friends.map((f) =>
            friendRow(
              f,
              between(messages, view.person, f.person),
              view.person,
              now,
            )
          ),
        )
        : empty(
          'No friends here yet',
          h(
            'p',
            null,
            'Ask someone by their yaks.app email, or say yes to a request in your Updates.',
          ),
        ),
    ),
    h(Dock.Foot, null, asking()),
  ]
}

// One message: mine at the right, theirs at the left, and under the last of
// a run, when, and whether an Operator wrote it.
let line = (
  m: Held,
  next: Held | undefined,
  me: string,
  name: string,
  now: number,
) => {
  let mine = m.from == me
  let end = !next || next.from != m.from ||
    Date.parse(next.at) - Date.parse(m.at) > 10 * 60_000
  return h(
    Transcript.Entry,
    { mod: mine ? 'theirs' : 'other', 'data-key': m.eid },
    h(Transcript.Bubble, null, m.words),
    end || m.operator
      ? h(
        Transcript.Meta,
        null,
        m.operator ? `${mine ? 'Your' : possessive(name)} Operator · ` : null,
        h(Transcript.When, { at: m.at, now } as never),
      )
      : null,
  )
}

// A friend's conversation in place of the list: back to it, who they are and
// where, what they shared, what was said, and a box to say more.
let conversation = (
  view: DockView,
  f: Befriended,
  messages: Held[],
  now: number,
) => {
  let talk = between(messages, view.person, f.person)
  let seen = seenWords(f.seen, now)
  return [
    h(
      Dock.Head,
      null,
      h(
        Button,
        {
          mod: 'quiet',
          type: 'button',
          'data-dock-back': '',
          title: 'All friends',
          'aria-label': 'All friends',
        },
        glyph(ChevronLeft),
      ),
      h(
        Dock.Title,
        null,
        h(
          Identity,
          { as: 'div', class: 'Dock_Who' },
          face(f),
          h(
            Identity.Text,
            null,
            h(Identity.Name, null, f.name),
            seen ? h(Identity.Note, null, seen) : null,
          ),
        ),
      ),
      close(),
    ),
    h(
      Dock.Body,
      { 'data-dock-said': f.person },
      f.shared.length
        ? h(
          'details',
          { class: 'Dock_Shared' },
          h(
            'summary',
            null,
            `${f.shared.length} ${f.shared.length == 1 ? 'app' : 'apps'} of ${
              possessive(f.name)
            } open to you`,
          ),
          h(
            Rows,
            { as: 'ul' },
            f.shared.map((a) => {
              let host = `${a.space}.${view.apex}`
              return appTile(
                { eid: a.eid, slug: a.slug, title: a.title },
                { at: `https://${host}`, host, editor: true },
              )
            }),
          ),
        )
        : null,
      talk.length
        ? h(
          Transcript.Lines,
          null,
          talk.map((m, i) => line(m, talk[i + 1], view.person, f.name, now)),
        )
        : h(
          Identity.Note,
          { as: 'p', class: 'Dock_Quiet' },
          `Say hello to ${f.name}.`,
        ),
    ),
    h(
      Dock.Foot,
      null,
      h(
        Form,
        {
          class: 'Dock_Say',
          'data-friend-message': f.person,
          // Each friend's own box, so a draft never moves to another.
          'data-key': f.person,
        },
        h(Field, {
          lines: true,
          id: 'dock-say',
          name: 'say',
          rows: 1,
          maxlength: 4000,
          required: true,
          enterkeyhint: 'send',
          placeholder: `Message ${f.name}`,
          'aria-label': `Message ${f.name}`,
        }),
        send('Send'),
        said(),
      ),
    ),
  ]
}

/** What the dock holds: its panel, the list or a friend's conversation, a
 * toast where one is said, and the launcher. */
export let dockView = (
  view: DockView,
  friends: Befriended[] | undefined,
  messages: Held[],
  at: DockAt = {},
  now: number = Date.now(),
) => {
  let open = at.friend && friends?.find((f) => f.person == at.friend)
  let waiting = unread(messages, view.person)
  let { label, kids } = launcherParts(friends ?? [], waiting.length, true)
  let toast = at.toast && messages.find((m) => m.eid == at.toast)
  let from = toast && friends?.find((f) => f.person == toast.from)
  return [
    h(
      Dock.Panel,
      {
        id: PANEL,
        popover: 'manual',
        'aria-label': open ? `${open.name} and you` : 'Friends',
        'data-dock-on': open ? open.person : '',
      },
      open
        ? conversation(view, open, messages, now)
        : list(view, friends, messages, now),
    ),
    from && toast
      ? h(
        Dock.Toast,
        {
          type: 'button',
          role: 'status',
          'data-dock-friend': from.person,
          'data-dock-toast': toast.eid,
        },
        h('b', null, from.name),
        ': ',
        toast.words,
      )
      : null,
    h(
      Dock.Launcher,
      {
        type: 'button',
        popovertarget: PANEL,
        title: label,
        'aria-label': label,
      },
      kids,
    ),
  ]
}

/** The dock as a page draws it before its rows are in: the launcher, and the
 * panel it will draw into. */
export let dock = (view: DockView) =>
  h(
    Dock,
    {
      id: DOCK,
      'data-kept': '',
      'data-friends-dock': JSON.stringify(view),
    },
    dockView(view, undefined, []),
  )
