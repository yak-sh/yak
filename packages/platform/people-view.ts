/**
 * A space's People page (`/manage/<space>/people`), drawn from rows
 * (./people-rows.ts): the way to invite someone, then who is a member of the
 * whole space and who is invited to it, the Operators of the owner's other
 * spaces working here, and a list for each app anybody is a guest of or
 * invited to. Beside each person is what the owner may do: send an
 * invitation's letter again, and take anyone but an owner off, which for an
 * invitation withdraws it. The server draws it for the first paint, and the
 * browser draws it again as the rows move (./people-browser.ts).
 *
 * Each form is a plain post to the page's address too, named by
 * `data-people`, which the browser sends through the page graph instead.
 *
 * @module
 */
import { type ComponentChildren as Kids, h } from 'preact'
import { possessive } from '@yaks/text/possessive'
import { Button } from '@yaks/ui/Button'
import { Card } from '@yaks/ui/Card'
import { Field } from '@yaks/ui/Field'
import { Form } from '@yaks/ui/Form'
import { Rows } from '@yaks/ui/Rows'
import { Time } from '@yaks/ui/Time'
import type { Bundle } from '@yaks/graph'
import {
  type Admitted,
  admitted,
  admittedOf,
  type Holder,
  holders,
  holdersOf,
  INVITABLE,
  type Invitable,
  invitableOf,
  type PeopleAct,
} from './people-rows.ts'
import { appsOf, pickedOf, SIDE_SPACES, sideApps } from './side-rows.ts'
import { heading, labeled, option, said, send } from './page-parts.ts'
import { managePath } from './routes.ts'

/** What the page says about itself beside the rows: whose it is, and which
 * space's. */
export type PeopleView = {
  person: string
  space: { eid: string; slug: string }
}

/** An app of the space, which an invitation may name. */
export type PeopleApp = { eid: string; slug: string; title: string }

/** A space whose Operator the owner may let in. */
export type PeopleSpace = { eid: string; slug: string; title: string }

/** The rows the page is drawn from: who holds a place, the Operators let in,
 * the space's apps, the spaces the owner may work in, and their friends. */
export type PeopleRows = {
  holders: Holder[]
  admitted: Admitted[]
  apps: PeopleApp[]
  spaces: PeopleSpace[]
  friends: Invitable[]
}

/** The rows of each line the page watches. */
export type Watched = Record<
  'holders' | 'admitted' | 'apps' | 'spaces' | 'friends',
  Bundle[]
>

/** The lines `view` watches, by what the page calls them. */
export let peopleLines = (view: PeopleView): Record<keyof Watched, string> => ({
  holders: holders(view.space.eid),
  admitted: admitted(view.space.eid),
  apps: sideApps(view.space.eid),
  spaces: SIDE_SPACES,
  friends: INVITABLE,
})

/** What the page draws from `rows`. */
export let peopleRows = (view: PeopleView, rows: Watched): PeopleRows => ({
  holders: holdersOf(rows.holders),
  admitted: admittedOf(rows.admitted),
  apps: appsOf(rows.apps, view.space.eid).map(({ eid, slug, title }) => ({
    eid,
    slug,
    title,
  })),
  spaces: pickedOf(rows.spaces).map(({ eid, slug, title }) => ({
    eid,
    slug,
    title,
  })),
  friends: invitableOf(rows.friends),
})

let named = (s: { slug: string; title: string }) => s.title || s.slug

// A label for what may be left empty.
let optional = (label: Kids) => [
  label,
  ' ',
  h(Form.Optional, null, '(optional)'),
]

// A form's hidden field, only when there is something to carry.
let hidden = (name: string, value?: string | null) =>
  value ? h(Form.Hidden, { name, value }) : null

// One of the page's forms: the act it writes (`data-people`), posted to the
// page's address where no script sends it.
let acting = (
  at: PeopleView,
  act: PeopleAct,
  attrs: Record<string, unknown>,
  ...kids: Kids[]
) =>
  h(
    Form,
    {
      method: 'post',
      action: managePath('people', at.space.slug),
      'data-people': act,
      ...attrs,
    },
    ...kids,
  )

// Inviting someone (member_add): a friend or their address, the whole space
// or one app, what they may do there, and a note for the letter if the owner
// wants one.
let inviting = (at: PeopleView, rows: PeopleRows) => {
  let friends = rows.friends
  return h(
    Card,
    null,
    heading('Invite someone'),
    // A seat is no referral (referral.ts `credit` reads only the person's own
    // code), so the month an invite gives is offered where it is earned.
    h(
      Card.Sub,
      null,
      'To bring a friend to yaks.app itself, use ',
      h('a', { href: managePath('invite') }, 'Invite a friend'),
      ': each friend who signs up from it and builds their first app gives ' +
        'your own space one more free month of the Plus plan.',
    ),
    acting(
      at,
      'memberAdd',
      { class: 'Page_Form' },
      friends.length
        ? labeled(
          'invite-friend',
          'A friend',
          h(
            Field,
            { choose: true, id: 'invite-friend', name: 'friend' },
            option('', 'Someone else, by email', true),
            friends.map((f) => option(f.person, f.name, false)),
          ),
        )
        : null,
      labeled(
        'invite-email',
        friends.length ? 'Or their email address' : 'Email address',
        h(Field, {
          id: 'invite-email',
          name: 'invite',
          type: 'email',
          required: !friends.length,
          autocomplete: 'off',
          spellcheck: 'false',
          placeholder: 'friend@example.com',
        }),
      ),
      labeled(
        'invite-app',
        'Invite them to',
        h(
          Field,
          { choose: true, id: 'invite-app', name: 'app' },
          option('', 'Every app here', true),
          rows.apps.map((a) => option(a.slug, a.title || a.slug, false)),
        ),
        'Invited to one app, they can open that app and nothing else here.',
      ),
      labeled(
        'invite-role',
        'They can',
        h(
          Field,
          { choose: true, id: 'invite-role', name: 'role' },
          option('editor', 'Change things', true),
          option('viewer', 'Only look', false),
        ),
      ),
      labeled(
        'invite-note',
        optional('A note for the email'),
        h(Field, {
          lines: true,
          id: 'invite-note',
          placeholder: 'Tell them why you’re inviting them…',
          name: 'note',
          rows: 2,
          maxlength: 500,
        }),
      ),
      h(Form.Actions, null, send('Send invitation')),
      said(),
    ),
  )
}

// One person's row: their name, then one line of where they stand, their
// address first.
let holding = (p: Holder) =>
  h(
    Rows.Main,
    null,
    h(Rows.Name, null, p.name || p.email || 'Someone'),
    h(
      Rows.Meta,
      null,
      p.email ? `${p.email} · ` : null,
      p.held == 'invite'
        ? [
          `${p.role} · `,
          h(
            'span',
            { class: 'People_Waiting' },
            p.sent ? ['invited ', h(Time, { at: p.sent }), ', '] : 'invited, ',
            'not accepted yet',
          ),
        ]
        : p.role,
    ),
  )

// A row's button: one form, its act, what it carries, and what it says of
// what came of it.
let pressing = (
  at: PeopleView,
  act: PeopleAct,
  fields: Kids,
  label: string,
  aria: string,
) =>
  acting(
    at,
    act,
    { class: 'Page_Form Rows_Form' },
    fields,
    h(Button, { type: 'submit', 'aria-label': aria }, label),
    said(),
  )

// What the owner may do to one person: send an invitation again, and take
// anyone but an owner off, which for an invitation withdraws it.
let actions = (at: PeopleView, p: Holder, app?: string) => {
  let them = p.email ?? p.name
  let waits = p.held == 'invite'
  let again = waits
    ? pressing(
      at,
      'inviteAgain',
      hidden('again', p.place),
      'Send again',
      `Send the invitation to ${them} again`,
    )
    : null
  let off = p.email && (p.held != 'seat' || p.role != 'owner')
    ? pressing(
      at,
      'memberRemove',
      [hidden('remove', p.email), hidden('app', app)],
      waits ? 'Withdraw' : 'Remove',
      waits ? `Withdraw the invitation to ${them}` : `Remove ${them}`,
    )
    : null
  return again || off ? h(Rows.Actions, null, again, off) : null
}

// A card listing `all`, each beside what the owner may do to them.
let list = (at: PeopleView, title: string, all: Holder[], app?: string) =>
  all.length
    ? h(
      Card,
      null,
      heading(title),
      h(
        Rows,
        { as: 'ul' },
        all.map((p) =>
          h(
            Rows.Item,
            { as: 'li', key: p.place },
            holding(p),
            actions(at, p, app),
          )
        ),
      ),
    )
    : null

// The Operators of other spaces working here (operator-reach.ts): each with
// what it may do and a Remove, then the owner's other spaces whose Operator
// they may let in.
let operating = (at: PeopleView, rows: PeopleRows) => {
  let ins = rows.admitted
  let offered = rows.spaces.filter((s) =>
    s.eid != at.space.eid && !ins.some((o) => o.operator == s.eid)
  )
  let items = ins.map((o) =>
    h(
      Rows.Item,
      { as: 'li', key: o.operator },
      h(
        'span',
        null,
        `${possessive(named(o))} Operator · ${
          o.role == 'viewer' ? 'only looks' : 'changes things'
        }`,
      ),
      h(
        Rows.Actions,
        null,
        pressing(
          at,
          'operatorOut',
          hidden('unreach', o.operator),
          'Remove',
          `Remove ${possessive(named(o))} Operator`,
        ),
      ),
    )
  )
  let form = offered.length
    ? acting(
      at,
      'operatorAdmit',
      { class: 'Page_Form' },
      labeled(
        'operator-space',
        "Let this space's Operator work here",
        h(
          Field,
          { choose: true, id: 'operator-space', name: 'operator' },
          offered.map((s, i) => option(s.eid, named(s), i == 0)),
        ),
        'Whoever may ask that Operator can have it work here.',
      ),
      labeled(
        'operator-role',
        'It can',
        h(
          Field,
          { choose: true, id: 'operator-role', name: 'role' },
          option('editor', 'Change things', true),
          option('viewer', 'Only look', false),
        ),
      ),
      h(Form.Actions, null, send('Let it in')),
      said(),
    )
    : null
  return items.length || form
    ? h(
      Card,
      null,
      heading('Operators from other spaces'),
      items.length ? h(Rows, { as: 'ul' }, items) : null,
      form,
    )
    : null
}

/** The People page of `at.space`, drawn from `rows`. */
export let peopleView = (at: PeopleView, rows: PeopleRows): Kids => {
  let on = (eid: string, held: Holder['held']) =>
    rows.holders.filter((p) => p.on == eid && p.held == held)
  return [
    inviting(at, rows),
    list(at, 'Members · every app', [
      ...on(at.space.eid, 'seat'),
      ...on(at.space.eid, 'invite'),
    ]),
    operating(at, rows),
    rows.apps.map((a) =>
      list(
        at,
        `${a.title || a.slug} · this app only`,
        [...on(a.eid, 'grant'), ...on(a.eid, 'invite')],
        a.slug,
      )
    ),
  ]
}
