/**
 * The Friends page (Your account), drawn from the person's rows
 * (./account-rows.ts): who's online now and when the rest last were, online
 * first, the first few unless the person asked for all; a message to each and
 * the apps of theirs they let the person into; adding a friend; and "Show
 * when I'm online". The server draws it for the first paint, and the browser
 * draws it again as the rows move (./friends-browser.ts).
 *
 * @module
 */
import { h } from 'preact'
import { render } from '@yaks/preact'
import { define } from '@yaks/render'
import { loadVocab } from '@yaks/vocab'
import { once } from '@yaks/fp'
import { Card } from '@yaks/ui/Card'
import { Dot } from '@yaks/ui/Dot'
import { Field } from '@yaks/ui/Field'
import { Form } from '@yaks/ui/Form'
import { Identity } from '@yaks/ui/Identity'
import { Rows } from '@yaks/ui/Rows'
import { Time } from '@yaks/ui/Time'
import type { Account, Befriended, Shared } from './account-rows.ts'
import { app } from './app-tile.ts'
import {
  empty,
  fieldsOf,
  heading,
  labeled,
  option,
  said,
  saving,
  send,
} from './page-parts.ts'
import { online, seenWords } from './presence.ts'
import { managePath } from './routes.ts'

/** What the Friends page says about itself beside the rows: whose it is,
 * the zone its spaces answer under, and whether it shows every friend. */
export type FriendsView = { person: string; apex: string; all: boolean }

// The app tile (./app-tile.ts), matched against the words it draws alone.
let tiles = define([app])
let words = once(() =>
  loadVocab([{
    $defs: {
      app: {
        component: true,
        type: 'object',
        properties: {
          slug: { type: 'string' },
          access: { type: ['string', 'null'] },
          source: { type: ['string', 'null'] },
          generatedIcon: { type: 'string' },
        },
      },
      doc: {
        component: true,
        type: 'object',
        properties: { title: { type: 'string' } },
      },
      home: { component: true, type: 'object' },
    },
  }])
)

/** An app someone let the reader into, as a row of their list. */
let appTile = (a: Shared, around: Record<string, unknown>) =>
  render(
    tiles,
    { entity: { eid: a.eid }, app: { slug: a.slug }, doc: { title: a.title } },
    'List.Tile',
    words(),
    around,
  )

// "Show when I'm online": the person's `presence{hidden}`, the same one
// choice Profile has, saved as it changes.
export let showing = (hidden: boolean, page: 'friends' | 'profile') =>
  labeled(
    `presence-${page}`,
    'Show when I’m online',
    h(
      Field,
      { choose: true, id: `presence-${page}`, name: 'presence' },
      option('shown', 'Yes', !hidden),
      option('hidden', 'No', hidden),
    ),
    hidden
      ? 'Your friends don’t see when you’re on yaks.app, and you don’t see when they are.'
      : 'Your friends see when you’re on yaks.app or when you last were, and which of your apps they could open themselves. Nobody else does.',
  )

// How many friends the list shows before "Show all": every one online, then
// the most recently active up to this many (pages.css `.Friends`).
let FEW = 6

// One friend: their initial and a green dot while they are online, "Online
// now" or "Active 3 hours ago" under their name, kept current by
// @yaks/platform/friends-browser. Pressed, it opens what friends can do: send
// them a message, which lands in their Updates, and open the apps of theirs
// they let this person into.
let friendRow = (f: Befriended, apex: string, now: number) => {
  let here = online(f.seen)
  let words = seenWords(f.seen, now)
  return h(
    Rows.Item,
    {
      as: 'li',
      class: here ? 'Friend Friend-here' : 'Friend',
      'data-friend': f.person,
      'data-key': f.person,
    },
    h(
      'details',
      { class: 'Friend_Fold' },
      h(
        'summary',
        { class: 'Friend_Summary' },
        h(
          Identity,
          { as: 'span' },
          h(
            Identity.Avatar,
            { class: 'Friend_Avatar' },
            (f.name.trim()[0] ?? '?').toUpperCase(),
            h(Dot, {
              mod: 'positive',
              class: 'Friend_Dot',
              'data-friend-dot': '',
              hidden: !here,
              role: 'img',
              'aria-label': 'Online',
            }),
          ),
          h(
            Identity.Text,
            null,
            h(Identity.Name, null, f.name),
            h(
              Identity.Note,
              { 'data-friend-seen': '', hidden: !words },
              !here && f.seen?.last
                ? ['Active ', h(Time, { at: f.seen.last, now })]
                : words,
            ),
          ),
        ),
      ),
      h(
        'div',
        { class: 'Friend_Body' },
        h(
          Form,
          {
            class: 'Page_Form',
            method: 'post',
            action: managePath('friends'),
            'data-friend-message': f.person,
          },
          labeled(
            `friend-say-${f.person}`,
            `Message ${f.name}`,
            h(Field, {
              lines: true,
              id: `friend-say-${f.person}`,
              name: 'say',
              rows: 2,
              maxlength: 4000,
              required: true,
              placeholder: 'Write a message…',
            }),
            'It lands in their Updates, where they can reply.',
          ),
          h(Form.Actions, null, send('Send')),
          said(),
        ),
        h(Form.Label, { as: 'p' }, 'Shared with you'),
        f.shared.length
          ? h(
            Rows,
            { as: 'ul' },
            f.shared.map((a) => {
              let host = `${a.space}.${apex}`
              return appTile(a, { at: `https://${host}`, host, editor: true })
            }),
          )
          : h(Form.Hint, { as: 'p' }, `Nothing of ${f.name}’s yet.`),
      ),
    ),
  )
}

// Friends (Your account): who's online now and when the rest last were,
// online first, the first few unless the person asked for all; adding a
// friend; and "Show when I'm online".
export let friendsView = (
  view: FriendsView,
  all: Befriended[],
  account: Pick<Account, 'hidden'>,
  now = Date.now(),
) => {
  let more = all.length -
    Math.max(FEW, all.filter((f) => online(f.seen)).length)
  return [
    h(
      Card,
      null,
      heading('Friends'),
      all.length
        ? [
          h(
            Rows,
            {
              as: 'ul',
              class: view.all ? 'Friends Friends-all' : 'Friends',
              'data-friends': managePath('friends'),
            },
            all.map((f) => friendRow(f, view.apex, now)),
          ),
          more > 0 && !view.all
            ? h(
              Rows.Note,
              null,
              h(
                'a',
                { href: `${managePath('friends')}?all` },
                `Show all ${all.length} friends`,
              ),
            )
            : null,
        ]
        : empty(
          'No friends here yet',
          h(
            'p',
            null,
            'Add someone by their yaks.app sign-in email, or say yes to a request in your Updates.',
          ),
        ),
      h(
        Form,
        {
          class: 'Page_Form',
          method: 'post',
          action: managePath('friends'),
          'data-friend-ask': '',
        },
        labeled(
          'friend-email',
          'Add a friend',
          h(Field, {
            id: 'friend-email',
            name: 'email',
            type: 'email',
            required: true,
            autocomplete: 'off',
            spellcheck: 'false',
            placeholder: 'friend@example.com',
          }),
          'They become your friend once they say yes in their Updates.',
        ),
        h(Form.Actions, null, send('Ask')),
        said(),
      ),
    ),
    saving(
      managePath('friends'),
      h(Card, null, fieldsOf(showing(account.hidden, 'friends'))),
    ),
  ]
}
